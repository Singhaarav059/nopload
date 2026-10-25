"use client";

// Clean up scans: phone and office scans come out crooked, grey, sideways
// and framed by the dark scanner lid or table. Each scanned page is drawn,
// turned upright, straightened, trimmed to the paper and whitened, then put
// back as one picture filling the same page, with OCR's invisible text on top
// if asked. Pages that aren't scans (real text, drawings) are left as they are.
//
// The steps reuse OCR's page cleanup (ocrprep.ts); everything works on plain
// arrays of grey or colour samples, so the same code runs in tests.

import {
  PDFDict, PDFName, PDFRawStream, concatTransformationMatrix, degrees, drawObject, popGraphicsState, pushGraphicsState,
  type PDFDocument, type PDFPage,
} from "pdf-lib";
import { zlibSync } from "fflate";
import type { PageViewport, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { abortable, baseName, bytesOf, closePdf, fitScale, openPdf, pdfBlob, pdfjs, renderPage, yieldToPage, type Output, type Progress, type Skipped } from "./common";
import { toPdfError } from "./errors";
import { openForEdit } from "./open";
import { runQpdf } from "./qpdf";
import { encodeJpeg } from "./jpeg";
import { resample, type Pixels } from "./pixels";
import { IMAGE_OPS, SCAN_COVER, engine, imageCover, readPage, toWord, type Recognise } from "./ocr";
import { addInvisibleText } from "./textlayer";
import { deskew, estimateSkew, flattenBackground, looksSideways, otsu, paperGrid, rotate90, type Gray } from "./ocrprep";
import { OCR_LANGS } from "../tools";
import { ocrLangs } from "../ocr-langs";

export type CleanOptions = {
  straighten: boolean;
  whiten: boolean;
  upright: boolean;
  borders: boolean;
  // keep | gray | bw
  color: string;
  dpi: string;
  ocr: boolean;
  ocrLang: string;
};

// The most pixels a page is cleaned at: the drawing and three colour planes,
// each copied as it's turned, straightened and trimmed. 16 million is A4 at
// 400 dpi, so only posters and plans are cleaned at less than asked.
const CLEAN_PIXELS = 16e6;
// The page is measured (orientation, skew, borders) on a copy this big.
const ANALYSIS_SIDE = 1000;
// Below a third of a degree, straightening costs more sharpness than it gains (as for OCR).
const THIN_SKEW = (0.3 * Math.PI) / 180;
// A page with this little real text, under a picture covering most of it, is a scan (as for OCR).
const SCAN_CHARS = 40;
// MozJPEG quality: whitened paper compresses well, and text stays crisp.
const JPEG_QUALITY = 80;

// ── Which pages are scans

const TEXT_OPS = ["showText", "showSpacedText", "nextLineShowText", "nextLineSetSpacingShowText"] as const;

// Characters a page shows. Text drawn invisibly (render mode 3 or 7, the
// layer an earlier OCR left on a scan) doesn't count: such a page is still a
// picture of paper, and its old text layer is replaced.
function shownChars(ops: { fnArray: number[]; argsArray: unknown[][] }, OPS: Record<string, number>) {
  const text = new Set<number>(TEXT_OPS.map((k) => OPS[k]));
  let mode = 0, n = 0;
  const stack: number[] = [];
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i] ?? [];
    if (fn === OPS.save || fn === OPS.paintFormXObjectBegin) stack.push(mode);
    else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd) mode = stack.pop() ?? mode;
    else if (fn === OPS.setTextRenderingMode) mode = Number(args[0]) || 0;
    else if (text.has(fn) && mode !== 3 && mode !== 7) {
      const glyphs = args.find(Array.isArray) as unknown[] | undefined;
      for (const g of glyphs ?? []) {
        const u = (g as { unicode?: unknown } | null)?.unicode;
        if (typeof u === "string") n += u.trim().length;
      }
    }
  });
  return n;
}

// ── Pixels

const channel = (rgba: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, c: number): Gray => {
  const { width: w, height: h, data } = rgba;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = data[i * 4 + c];
  return { w, h, data: out };
};

const greyOf = (planes: Gray[]): Gray => {
  if (planes.length === 1) return planes[0];
  const [r, g, b] = planes.map((p) => p.data);
  const out = new Uint8Array(r.length);
  for (let i = 0; i < out.length; i++) out[i] = (r[i] * 77 + g[i] * 150 + b[i] * 29) >> 8;
  return { w: planes[0].w, h: planes[0].h, data: out };
};

const shrink = (g: Gray, side: number): Gray => {
  const s = Math.min(1, side / Math.max(g.w, g.h));
  if (s === 1) return g;
  const p = resample({ ...g, ch: 1 } as Pixels, Math.max(1, Math.round(g.w * s)), Math.max(1, Math.round(g.h * s)));
  return { w: p.w, h: p.h, data: p.data };
};

const crop = (g: Gray, r: Rect): Gray => {
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  if (w === g.w && h === g.h) return g;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(g.data.subarray((r.y0 + y) * g.w + r.x0, (r.y0 + y) * g.w + r.x1), y * w);
  return { w, h, data: out };
};

// The level `share` of the pixels are at or below, skipping those `skip` marks.
function percentile(g: Gray, share: number, skip?: (i: number) => boolean) {
  const hist = new Float64Array(256);
  let n = 0;
  for (let i = 0; i < g.data.length; i += 3) {
    if (skip?.(i)) continue;
    hist[g.data[i]]++;
    n++;
  }
  let acc = 0;
  for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= n * share) return v;
  return 255;
}

// Real colour, not the faint tint of scanned paper or the fringes along black text.
function colourful(rgba: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }) {
  const { data } = rgba;
  let n = 0, coloured = 0;
  for (let i = 0; i < data.length; i += 4 * 7) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 48) coloured++;
    n++;
  }
  return coloured > n * 0.003;
}

// ── Borders

type Rect = { x0: number; y0: number; x1: number; y1: number };

// The scanner lid or table around the paper: dark pixels joined to the edge
// of the image, and a little more for the paper's shadowed edge. 255 there,
// 0 on the paper; null when there is no such border, or when it would be
// most of the image (a dark photo rather than a frame around paper).
export function borderMask(g: Gray, paper: number): Gray | null {
  const { w, h } = g;
  const dark = Math.min(paper * 0.6, paper - 50);
  let out = new Uint8Array(w * h);
  const stack: number[] = [];
  let count = 0;
  const push = (i: number) => {
    if (out[i] || g.data[i] >= dark) return;
    out[i] = 255;
    count++;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  if (count < w * h * 0.002 || count > w * h * 0.75) return null;
  for (let pass = 0; pass < 2; pass++) {
    const grown = out.slice();
    for (let i = 0; i < w * h; i++) {
      if (out[i]) continue;
      const x = i % w;
      if ((x > 0 && out[i - 1]) || (x < w - 1 && out[i + 1]) || (i >= w && out[i - w]) || (i < w * (h - 1) && out[i + w])) grown[i] = 255;
    }
    out = grown;
  }
  return { w, h, data: out };
}

// The paper's rectangle: edge rows and columns that are mostly border come off.
export function trimRect(m: Gray): Rect {
  let x0 = 0, y0 = 0, x1 = m.w, y1 = m.h;
  const row = (y: number) => {
    let n = 0;
    for (let x = x0; x < x1; x++) if (m.data[y * m.w + x] > 127) n++;
    return n / (x1 - x0);
  };
  const col = (x: number) => {
    let n = 0;
    for (let y = y0; y < y1; y++) if (m.data[y * m.w + x] > 127) n++;
    return n / (y1 - y0);
  };
  for (let pass = 0; pass < 2; pass++) {
    while (y1 - y0 > 1 && row(y0) > 0.5) y0++;
    while (y1 - y0 > 1 && row(y1 - 1) > 0.5) y1--;
    while (x1 - x0 > 1 && col(x0) > 0.5) x0++;
    while (x1 - x0 > 1 && col(x1 - 1) > 0.5) x1--;
  }
  return { x0, y0, x1, y1 };
}

// ── Orientation

// Latin, Cyrillic and Greek lines carry more ink above their letters' middle
// band (capitals, b d f h k l t) than below it (g j p q y). A page whose
// lines clearly have it the other way round is upside down. Other scripts
// (Chinese, Devanagari…) give no clear answer and are left as they are.
export function upsideDown(g: Gray): boolean {
  const t = otsu(g);
  const rows = new Float64Array(g.h);
  let ink = 0;
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++)
      if (g.data[y * g.w + x] < t) { rows[y]++; ink++; }
  // Mostly-dark pages (photos) have no lines to read.
  if (ink > g.w * g.h * 0.4) return false;
  const peak = rows.reduce((a, b) => Math.max(a, b), 0);
  if (!peak) return false;
  let above = 0, below = 0, lines = 0;
  for (let y = 0; y < g.h; ) {
    if (rows[y] <= peak * 0.04) { y++; continue; }
    let end = y;
    while (end < g.h && rows[end] > peak * 0.04) end++;
    if (end - y >= 4) {
      let top = 0;
      for (let k = y; k < end; k++) top = Math.max(top, rows[k]);
      let c0 = y, c1 = end - 1;
      while (rows[c0] < top * 0.5) c0++;
      while (rows[c1] < top * 0.5) c1--;
      for (let k = y; k < c0; k++) above += rows[k];
      for (let k = c1 + 1; k < end; k++) below += rows[k];
      lines++;
    }
    y = end;
  }
  return lines >= 3 && below > above * 1.5;
}

// Where a point of an image lands once the image is turned `k` quarter turns clockwise.
const turnPoint = (x: number, y: number, w: number, h: number, k: number): [number, number] =>
  k === 1 ? [h - y, x] : k === 2 ? [w - x, h - y] : k === 3 ? [y, w - x] : [x, y];

// ── Whitening

// Whitens the paper and leaves pictures alone. The paper colour is measured
// in blocks (ocrprep.ts paperGrid, per colour channel, so yellowed paper
// turns white rather than pale yellow); dividing by it turns shadows and
// tints white. A photo would be washed out by the same division, so blocks
// that aren't paper (few pixels near their brightest), in a patch too big to
// be a line of text, only get the paper's overall brightening. The two blend
// over a block or two, so there is no seam.
export function whiten(planes: Gray[]): Gray[] {
  const g = greyOf(planes);
  const grid = paperGrid(g);
  const { B, bw, bh } = grid;
  // Paper blocks: a third of their pixels or more within 32 levels of the brightest.
  const near = new Float32Array(bw * bh);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const k = Math.floor(y / B) * bw + Math.floor(x / B);
      if (g.data[y * g.w + x] >= grid.max[k] - 32) near[k]++;
    }
  const paper = new Uint8Array(bw * bh);
  let paperBlocks = 0;
  for (let k = 0; k < bw * bh; k++) {
    const bx = k % bw, by = Math.floor(k / bw);
    const size = (Math.min(g.w, (bx + 1) * B) - bx * B) * (Math.min(g.h, (by + 1) * B) - by * B);
    if (near[k] >= size / 3 && grid.max[k] >= 96) { paper[k] = 1; paperBlocks++; }
  }
  // Hardly any paper: a photo, not a document. Left as it is.
  if (paperBlocks < bw * bh * 0.2) return planes;
  // Patches of non-paper blocks big enough to be pictures.
  const weight = new Float32Array(bw * bh).fill(1);
  const seen = new Uint8Array(bw * bh);
  for (let k = 0; k < bw * bh; k++) {
    if (paper[k] || seen[k]) continue;
    const patch: number[] = [];
    const stack = [k];
    seen[k] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      patch.push(j);
      const x = j % bw;
      for (const n of [x > 0 ? j - 1 : -1, x < bw - 1 ? j + 1 : -1, j - bw, j + bw])
        if (n >= 0 && n < bw * bh && !paper[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
    }
    const xs = patch.map((j) => j % bw), ys = patch.map((j) => Math.floor(j / bw));
    const big = patch.length >= 12 && Math.max(...xs) - Math.min(...xs) >= 2 && Math.max(...ys) - Math.min(...ys) >= 2;
    if (big) for (const j of patch) weight[j] = 0;
  }
  // A picture's smooth, light parts look like paper block by block. They join
  // the picture while they are clearly darker than the paper itself.
  const maxima = Array.from(grid.max).filter((_, k) => paper[k]).sort((a, b) => a - b);
  const paperMax = maxima[maxima.length >> 1];
  const grow: number[] = [];
  for (let k = 0; k < bw * bh; k++) if (!weight[k]) grow.push(k);
  while (grow.length) {
    const j = grow.pop()!;
    const x = j % bw;
    for (const n of [x > 0 ? j - 1 : -1, x < bw - 1 ? j + 1 : -1, j - bw, j + bw])
      if (n >= 0 && n < bw * bh && weight[n] && grid.max[n] < paperMax - 16) { weight[n] = 0; grow.push(n); }
  }
  const soft = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) { sum += weight[yy * bw + xx]; n++; }
        }
      soft[y * bw + x] = sum / n;
    }

  return planes.map((p) => {
    const level = planes.length === 1 ? grid.level : paperGrid(p).level;
    // The paper's overall colour in this channel, for the pictures.
    const levels = Array.from(level).filter((_, k) => paper[k]).sort((a, b) => a - b);
    const overall = Math.min(1.3, Math.max(1, 255 / Math.max(1, levels[levels.length >> 1])));
    const out = new Uint8Array(p.w * p.h);
    for (let y = 0; y < p.h; y++) {
      const fy = Math.min(bh - 1, Math.max(0, y / B - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < p.w; x++) {
        const fx = Math.min(bw - 1, Math.max(0, x / B - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0;
        const a = y0 * bw + x0, b = y0 * bw + x1, c = y1 * bw + x0, d = y1 * bw + x1;
        const bg = (level[a] * (1 - tx) + level[b] * tx) * (1 - ty) + (level[c] * (1 - tx) + level[d] * tx) * ty;
        const w = (soft[a] * (1 - tx) + soft[b] * tx) * (1 - ty) + (soft[c] * (1 - tx) + soft[d] * tx) * ty;
        const v = p.data[y * p.w + x];
        const flat = bg < 40 ? v : (v * 255) / bg;
        // On paper, the last few levels go to pure white: no grain, no faint grey.
        const onPaper = Math.min(255, (flat * 255) / 235);
        out[y * p.w + x] = Math.min(255, Math.round(w * onPaper + (1 - w) * v * overall));
      }
    }
    return { w: p.w, h: p.h, data: out };
  });
}

// ── One page

export type Cleaned = { planes: Gray[]; turns: number; skew: number; trimmed: boolean };

// Cleans one drawn page. `colour`: keep three channels, else grey only.
// `turns`: the clockwise quarter turns it was given; `skew`: the angle it was straightened by.
export async function cleanImage(
  rgba: { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
  o: Pick<CleanOptions, "straighten" | "whiten" | "upright" | "borders">,
  colour: boolean,
  signal?: AbortSignal,
): Promise<Cleaned> {
  const step = async () => {
    await yieldToPage();
    signal?.throwIfAborted();
  };
  const grey = { w: rgba.width, h: rgba.height, data: new Uint8Array(rgba.width * rgba.height) };
  for (let i = 0; i < grey.data.length; i++) grey.data[i] = (rgba.data[i * 4] * 77 + rgba.data[i * 4 + 1] * 150 + rgba.data[i * 4 + 2] * 29) >> 8;
  let planes: Gray[] = colour ? [0, 1, 2].map((c) => channel(rgba, c)) : [grey];
  let small = shrink(grey, ANALYSIS_SIDE);
  const { w: W, h: H } = grey;
  const at = (i: number, m: Gray) => Math.min(m.h - 1, Math.floor(((Math.floor(i / W) + 0.5) * m.h) / H)) * m.w + Math.min(m.w - 1, Math.floor((((i % W) + 0.5) * m.w) / W));

  // The border, found before anything moves, and painted the paper's colour
  // so it plays no part in measuring the page.
  let border = o.borders ? borderMask(small, percentile(small, 0.9)) : null;
  const skip = border ? (i: number) => border!.data[at(i, border!)] > 0 : undefined;
  const paperColour = planes.map((p) => percentile(p, 0.9, skip));
  if (border) {
    for (const [c, p] of planes.entries()) for (let i = 0; i < p.data.length; i++) if (border.data[at(i, border)]) p.data[i] = paperColour[c];
    const paperGrey = percentile(grey, 0.9, skip);
    small = { ...small, data: small.data.map((v, i) => (border!.data[i] ? paperGrey : v)) };
  }
  await step();

  // Upright: on its side when the ink lines up in columns; which way round
  // is settled once it is straight. Then straightened, measured on the turned page.
  let turns = 0;
  if (o.upright && looksSideways(flattenBackground(small))) turns = 1;
  small = rotate90(small, turns);
  if (border) border = rotate90(border, turns);
  let skew = 0;
  if (o.straighten) {
    const found = estimateSkew(flattenBackground(small));
    if (Math.abs(found) > THIN_SKEW) skew = found;
  }
  if (skew) {
    small = deskew(small, skew, percentile(small, 0.9));
    if (border) border = deskew(border, skew, 255);
  }
  if (o.upright && upsideDown(flattenBackground(small))) {
    turns += 2;
    if (border) border = rotate90(border, 2);
  }
  await step();
  // A half turn and the straightening commute (both are about the centre), so one pass each.
  planes = planes.map((p, c) => deskew(rotate90(p, turns), skew, paperColour[c]));
  await step();

  // Trimmed to the paper, unless that would leave less than a quarter of the image.
  let trimmed = false;
  if (border) {
    const r = trimRect(border);
    const fw = planes[0].w / border.w, fh = planes[0].h / border.h;
    const full: Rect = {
      x0: Math.floor(r.x0 * fw), y0: Math.floor(r.y0 * fh),
      x1: Math.min(planes[0].w, Math.ceil(r.x1 * fw)), y1: Math.min(planes[0].h, Math.ceil(r.y1 * fh)),
    };
    const area = (full.x1 - full.x0) * (full.y1 - full.y0);
    if (area >= planes[0].w * planes[0].h * 0.25 && area < planes[0].w * planes[0].h) {
      planes = planes.map((p) => crop(p, full));
      trimmed = true;
    }
  }
  if (o.whiten) {
    await step();
    planes = whiten(planes);
  }
  return { planes, turns, skew, trimmed };
}

// ── Back into the PDF

type Encoded = { bytes: Uint8Array; w: number; h: number; filter: string; space: string; bits: number };

// Colour and grey as JPEG (MozJPEG, true greyscale for grey). Black and
// white as one bit a pixel, deflated: a text page is a fraction of its JPEG.
async function encode(planes: Gray[], mode: string): Promise<Encoded> {
  const { w, h } = planes[0];
  if (mode === "bw") {
    const g = greyOf(planes);
    // Paper is white by now, so the split is between ink and paper; kept away from the extremes.
    const t = Math.min(200, Math.max(110, otsu(g)));
    const row = Math.ceil(w / 8);
    const bits = new Uint8Array(row * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (g.data[y * w + x] >= t) bits[y * row + (x >> 3)] |= 0x80 >> (x & 7);
    return { bytes: zlibSync(bits, { level: 9 }), w, h, filter: "FlateDecode", space: "DeviceGray", bits: 1 };
  }
  if (planes.length === 1) return { bytes: await encodeJpeg({ w, h, ch: 1, data: planes[0].data }, JPEG_QUALITY), w, h, filter: "DCTDecode", space: "DeviceGray", bits: 8 };
  const rgb = new Uint8Array(w * h * 3);
  const [r, g, b] = planes.map((p) => p.data);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = r[i];
    rgb[i * 3 + 1] = g[i];
    rgb[i * 3 + 2] = b[i];
  }
  return { bytes: await encodeJpeg({ w, h, ch: 3, data: rgb }, JPEG_QUALITY), w, h, filter: "DCTDecode", space: "DeviceRGB", bits: 8 };
}

// Where the picture goes on the page as shown at `rotation`: as large as fits, centred.
function placement(vp: PageViewport, w: number, h: number) {
  const s = Math.min(vp.width / w, vp.height / h);
  const ox = (vp.width - w * s) / 2, oy = (vp.height - h * s) / 2;
  // A pixel of the picture, in the viewport's coordinates.
  return { s, at: (x: number, y: number): [number, number] => [ox + x * s, oy + y * s] };
}

// The same page object gets the picture as its only content, so links into
// it, bookmarks and its annotations still work; its size stays and the
// rotation becomes the one it is read upright at.
function rebuild(doc: PDFDocument, page: PDFPage, img: Encoded, vp: PageViewport, rotation: number) {
  const ctx = doc.context;
  const ref = ctx.register(PDFRawStream.of(ctx.obj({
    Type: "XObject", Subtype: "Image", Width: img.w, Height: img.h, ColorSpace: img.space, BitsPerComponent: img.bits, Filter: img.filter,
  }) as PDFDict, img.bytes));
  const node = page.node;
  // An old thumbnail would show the page as it was; a transparency group has nothing left to group.
  for (const k of ["Thumb", "Group"]) node.delete(PDFName.of(k));
  node.set(PDFName.of("Contents"), ctx.obj([]));
  node.set(PDFName.of("Resources"), ctx.obj({}));
  page.setRotation(degrees(rotation));
  const { at } = placement(vp, img.w, img.h);
  // The picture's corners in PDF space: bottom-left, bottom-right, top-left.
  const [p0, p1, p2] = [at(0, img.h), at(img.w, img.h), at(0, 0)].map(([x, y]) => vp.convertToPdfPoint(x, y) as [number, number]);
  const name = node.newXObject("Scan", ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(p1[0] - p0[0], p1[1] - p0[1], p2[0] - p0[0], p2[1] - p0[1], p0[0], p0[1]),
    drawObject(name),
    popGraphicsState(),
  );
}

// ── The tool

// The file is opened as readers see it (openForEdit). Each scanned page is
// drawn at the chosen dpi (less when too big for the device), cleaned, and
// put back; with `ocr`, read by OCR's Tesseract workers and given an
// invisible text layer. A page that can't be drawn or cleaned is left as it
// is and named in `skipped`. `signal` stops everything: workers terminated,
// drawing cancelled, documents closed. `note`: "cleaned:<pages cleaned>".
export async function cleanScans(file: File, o: CleanOptions, progress?: Progress, signal?: AbortSignal): Promise<Output[]> {
  const input = await bytesOf(file);
  const opened = await openForEdit(input, file.name);
  signal?.throwIfAborted();
  const src = await openPdf(opened.bytes);
  try {
    const r = await cleanPages(src, opened.doc, file.name, o, progress, signal);
    const name = `${baseName(file.name)}-clean.pdf`;
    if (!r.cleaned) return [{ name, blob: pdfBlob(input), note: "cleaned:0", skipped: r.skipped }];
    let bytes = await opened.doc.save({ useObjectStreams: true, addDefaultPage: false });
    // pdf-lib keeps the old scans nothing refers to now; qpdf writes only what is still used.
    try {
      bytes = (await runQpdf(bytes, (i, out) => ["--object-streams=generate", i, out])).output;
    } catch {
      /* keep pdf-lib's file */
    }
    return [{ name, blob: pdfBlob(bytes), note: `cleaned:${r.cleaned}`, skipped: r.skipped }];
  } finally {
    await closePdf(src);
  }
}

async function cleanPages(src: PDFDocumentProxy, doc: PDFDocument, name: string, o: CleanOptions, progress?: Progress, signal?: AbortSignal) {
  const { OPS } = await pdfjs();
  const images = new Set<number>(IMAGE_OPS.map((k) => OPS[k]));
  const todo: number[] = [];
  for (let i = 1; i <= src.numPages; i++) {
    signal?.throwIfAborted();
    const page = await src.getPage(i);
    const ops = await page.getOperatorList();
    if (shownChars(ops, OPS as Record<string, number>) <= SCAN_CHARS && imageCover(ops, OPS as Record<string, number>, page.view, images) >= SCAN_COVER) todo.push(i);
    page.cleanup();
  }
  const pages = doc.getPages();
  const skipped: Skipped[] = [];
  let done = src.numPages - todo.length, cleaned = 0;
  progress?.(done, src.numPages);
  if (!todo.length) return { cleaned, skipped: undefined };

  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  const count = o.ocr ? Math.max(1, Math.min(4, Math.floor(cores / 2), todo.length)) : 1;
  const ocrEngine = o.ocr ? await engine.create(ocrLangs(o.ocrLang, OCR_LANGS).join("+"), count, signal) : null;
  const recognise: Recognise = (g) => abortable(ocrEngine!.recognise(g), signal);
  const scale = Number(o.dpi) / 72 || 200 / 72;
  try {
    // With OCR, the next page is cleaned while the workers read the last ones.
    let next = 0;
    await Promise.all(Array.from({ length: o.ocr ? count + 1 : 1 }, async () => {
      while (next < todo.length) {
        const i = todo[next++];
        if (!pages[i - 1]) {
          progress?.(++done, src.numPages);
          continue;
        }
        try {
          await cleanOne(await abortable(src.getPage(i), signal), doc, pages[i - 1], o, scale, ocrEngine ? recognise : null, signal);
          cleaned++;
        } catch (e) {
          if (signal?.aborted) throw signal.reason;
          skipped.push({ file: name, page: i, code: toPdfError(e, name).code });
        }
        progress?.(++done, src.numPages);
      }
    }));
  } finally {
    await ocrEngine?.stop();
  }
  signal?.throwIfAborted();
  return { cleaned, skipped: skipped.length ? skipped : undefined };
}

async function cleanOne(view: PDFPageProxy, doc: PDFDocument, page: PDFPage, o: CleanOptions, scale: number, recognise: Recognise | null, signal?: AbortSignal) {
  const canvas = await renderPage(view, fitScale(view, scale, undefined, CLEAN_PIXELS), "#ffffff", { signal });
  let rgba: ImageData;
  try {
    rgba = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    canvas.width = canvas.height = 0;
    view.cleanup();
  }
  // "keep" keeps colour only where there is some: a grey scan stays one channel.
  const colour = o.color === "keep" && colourful(rgba);
  let { planes, turns } = await cleanImage(rgba, o, colour, signal);

  // OCR reads the cleaned page. Tesseract's confidence settles what the
  // shape of the lines can't: a page still upside down or the wrong way round reads
  // as noise until it is turned, so its turn is taken when the reading is confident.
  let words: { text: string; corners: [number, number][] }[] = [];
  if (recognise) {
    const read = await readPage(recognise, greyOf(planes));
    words = read.words;
    const extra = o.upright && read.confidence >= 60 ? read.turns : 0;
    if (extra) {
      const { w, h } = planes[0];
      words = words.map((wd) => ({ ...wd, corners: wd.corners.map(([x, y]) => turnPoint(x, y, w, h, extra)) }));
      planes = planes.map((p) => rotate90(p, extra));
      turns += extra;
    }
  }
  signal?.throwIfAborted();
  const mode = o.color === "gray" ? "gray" : o.color === "bw" ? "bw" : "keep";
  const img = await encode(mode === "keep" ? planes : [greyOf(planes)], mode);
  // The page keeps the rotation it was drawn at, plus the turns that made it upright.
  const rotation = (view.rotate + turns * 90) % 360;
  const vp = view.getViewport({ scale: 1, rotation });
  rebuild(doc, page, img, vp, rotation);
  if (words.length) {
    const { at } = placement(vp, img.w, img.h);
    addInvisibleText(doc, page, words.map((wd) => toWord(wd.text, wd.corners.map(([x, y]) => at(x, y)), vp)));
  }
}
