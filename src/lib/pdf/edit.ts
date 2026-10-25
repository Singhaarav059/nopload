"use client";

import {
  PDFDocument, PDFPage, PDFFont, StandardFonts, rgb, degrees, BlendMode, PDFArray, PDFName,
  PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFTextField, PDFOptionList, PDFSignature, PDFString,
  PDFHexString, PDFOperator, PDFOperatorNames as Ops, PDFRawStream, decodePDFRawStream,
} from "pdf-lib";
import { baseName, hexToRgb, isWinAnsi, normaliseImage, pageSet, pdfBlob, textToPng, type Output } from "./common";
import { loadPdf } from "./organize";
import { PdfError } from "./errors";
import { contentChanged } from "./contentchange";
import { linkTarget } from "./links";
import { FAMILIES, fontCovering, layoutText, type Family, type LaidOut } from "./fonts";
import { addField } from "./forms";
import { dateFormatOf, isFieldKind, type DateFormat, type FieldKind } from "./formsmeta";

// ── Visual ↔ user space
// Users place things on the page as they see it. A page may carry /Rotate and
// a CropBox that doesn't start at 0,0, so every placement goes through here.

// The part of the page that is seen, built the way pdf.js builds its view (and
// so the editor's): each box normalised, since a rectangle may name any two
// opposite corners; the CropBox clipped to the MediaBox; the MediaBox alone
// when they don't overlap, and US Letter when the MediaBox is empty.
export function viewBox(page: PDFPage) {
  const norm = (r: { x: number; y: number; width: number; height: number }) => ({
    x0: Math.min(r.x, r.x + r.width), y0: Math.min(r.y, r.y + r.height),
    x1: Math.max(r.x, r.x + r.width), y1: Math.max(r.y, r.y + r.height),
  });
  let media = norm(page.getMediaBox());
  if (media.x1 - media.x0 <= 0 || media.y1 - media.y0 <= 0) media = { x0: 0, y0: 0, x1: 612, y1: 792 };
  const crop = norm(page.getCropBox());
  const x0 = Math.max(crop.x0, media.x0), y0 = Math.max(crop.y0, media.y0);
  const x1 = Math.min(crop.x1, media.x1), y1 = Math.min(crop.y1, media.y1);
  const b = x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : media;
  return { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 };
}

export function visualFrame(page: PDFPage) {
  const box = viewBox(page);
  // Like pdf.js, a /Rotate that isn't a multiple of 90 counts as none.
  const angle = page.getRotation().angle;
  const r = angle % 90 ? 0 : ((angle % 360) + 360) % 360;
  const swap = r === 90 || r === 270;
  const vw = swap ? box.height : box.width;
  const vh = swap ? box.width : box.height;
  // (vx, vy) is in points from the visual bottom-left.
  const map = (vx: number, vy: number): [number, number] => {
    switch (r) {
      case 90: return [box.x + box.width - vy, box.y + vx];
      case 180: return [box.x + box.width - vx, box.y + box.height - vy];
      case 270: return [box.x + vy, box.y + box.height - vx];
      default: return [box.x + vx, box.y + vy];
    }
  };
  return { vw, vh, map, rot: r };
}

// pdf-lib appends drawing after the page's own content without restoring the
// graphics state, so a page that leaves a transform open would shift whatever
// we draw. Wrap the original content in q…Q once before drawing on it.
// Content that stops inside an inline image's data (BI … ID with no EI) would
// swallow everything after it, so that image is closed first.
const isolated = new WeakSet<PDFPage>();
export function isolate(page: PDFPage) {
  if (isolated.has(page)) return;
  isolated.add(page);
  const ctx = page.doc.context;
  const close = endsInInlineImage(page) ? "\nEI\nQ" : "Q";
  // A lone content stream becomes an array first; only an array can be wrapped.
  page.node.normalize();
  page.node.wrapContentStreams(ctx.register(ctx.stream("q")), ctx.register(ctx.stream(close)));
}

// The page's content, decoded and joined the way readers join it. A stream
// that can't be decoded is left out: readers draw nothing from it either.
function endsInInlineImage(page: PDFPage) {
  const c = page.node.Contents();
  const refs = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
  const parts: Uint8Array[] = [];
  for (const ref of refs) {
    const s = page.doc.context.lookup(ref);
    if (!(s instanceof PDFRawStream)) continue;
    try {
      parts.push(decodePDFRawStream(s).decode(), new Uint8Array([10]));
    } catch {
      // Unreadable.
    }
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) all.set(p, (at += p.length) - p.length);
  return unterminatedInlineImage(all);
}

// Tokenises content just enough to skip strings, names, comments and inline
// image data; true when the last inline image has no EI.
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([...Array.from("()<>[]{}/%")].map((c) => c.charCodeAt(0)));
export function unterminatedInlineImage(b: Uint8Array) {
  const n = b.length;
  let i = 0;
  while (i < n) {
    const c = b[i];
    if (WS.has(c)) { i++; continue; }
    if (c === 0x25) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; } // %
    if (c === 0x28) { // ( string ), nested, with escapes
      let depth = 0;
      for (; i < n; i++) {
        if (b[i] === 0x5c) i++;
        else if (b[i] === 0x28) depth++;
        else if (b[i] === 0x29 && --depth === 0) { i++; break; }
      }
      continue;
    }
    if (c === 0x3c && b[i + 1] === 0x3c) { i += 2; continue; } // <<
    if (c === 0x3c) { while (i < n && b[i] !== 0x3e) i++; i++; continue; } // <hex>
    if (DELIM.has(c)) { i++; if (c === 0x2f) while (i < n && !WS.has(b[i]) && !DELIM.has(b[i])) i++; continue; }
    const start = i;
    while (i < n && !WS.has(b[i]) && !DELIM.has(b[i])) i++;
    if (i - start === 2 && b[start] === 0x49 && b[start + 1] === 0x44) { // ID
      // Data starts after one white-space byte and ends at white space, "EI", then white space or the end.
      let j = i + 1;
      for (; j + 1 < n; j++) {
        if (b[j] === 0x45 && b[j + 1] === 0x49 && WS.has(b[j - 1]) && (j + 2 === n || WS.has(b[j + 2]) || DELIM.has(b[j + 2]))) break;
      }
      if (j + 1 >= n) return true;
      i = j + 2;
    }
  }
  return false;
}

async function save(doc: PDFDocument) {
  return pdfBlob(await doc.save({ useObjectStreams: true }));
}

// ── Text helpers. Helvetica (not embedded) when it can encode the text, or
// the chosen bundled family; Noto for other scripts; and an image of the text
// as a last resort (no bundled glyph, or the fonts couldn't be fetched).
export type FontChoice = "helvetica" | Family | "noto";
const fontChoice = (v: unknown): FontChoice =>
  v === "noto" || FAMILIES.includes(v as Family) ? (v as FontChoice) : "helvetica";

const standard = new WeakMap<PDFDocument, Map<string, Promise<PDFFont>>>();
function standardFont(doc: PDFDocument, name: StandardFonts) {
  let m = standard.get(doc);
  if (!m) standard.set(doc, (m = new Map()));
  let p = m.get(name);
  if (!p) m.set(name, (p = doc.embedFont(name)));
  return p;
}

// The standard font closest to each family, for when its file can't be fetched.
const FALLBACK: Record<FontChoice, [StandardFonts, StandardFonts]> = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  arimo: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  noto: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  tinos: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  cousine: [StandardFonts.Courier, StandardFonts.CourierBold],
};

async function textLine(doc: PDFDocument, family: FontChoice, text: string, size: number, bold = false): Promise<LaidOut | null> {
  const plain = async () => {
    const font = await standardFont(doc, FALLBACK[family][bold ? 1 : 0]);
    return { width: font.widthOfTextAtSize(text, size), runs: [{ font, text, x: 0 }] };
  };
  if (family === "helvetica" && isWinAnsi(text)) return plain();
  if (text.includes("\n")) return null;
  const laid = await layoutText(doc, text, size, bold, family === "helvetica" || family === "noto" ? undefined : family).catch(() => null);
  return laid ?? (isWinAnsi(text) ? plain() : null);
}

// Text drawn in pieces (a run per font, or an image) is wrapped in a span
// whose /ActualText is the whole string, so readers that honour it extract
// and search it as one word.
function asOneString(page: PDFPage, text: string, pieces: number, draw: () => void) {
  if (pieces < 2 && !/[^\x20-\x7e]/.test(text)) return draw();
  page.pushOperators(PDFOperator.of(Ops.BeginMarkedContentSequence, [PDFName.of("Span"), `<< /ActualText ${PDFHexString.fromText(text).toString()} >>`]));
  draw();
  page.pushOperators(PDFOperator.of(Ops.EndMarkedContent));
}

async function drawLabel(
  doc: PDFDocument, page: PDFPage, family: FontChoice, text: string,
  o: {
    vx: number; vy: number; size: number; color: string; anchor: "left" | "center" | "right"; opacity?: number; angle?: number; bold?: boolean;
    // Wider text is drawn smaller to fit.
    maxWidth?: number;
  },
) {
  isolate(page);
  const f = visualFrame(page);
  const c = hexToRgb(o.color);
  const extra = o.angle ?? 0;
  const a = (extra * Math.PI) / 180;
  const fit = (width: number) => (o.maxWidth && width > o.maxWidth ? o.maxWidth / width : 1);
  const line = await textLine(doc, family, text, o.size, o.bold);
  if (line) {
    const k = fit(line.width);
    const size = o.size * k, width = line.width * k;
    const dx = o.anchor === "center" ? -width / 2 : o.anchor === "right" ? -width : 0;
    // Offset along the rotated baseline so rotated labels stay anchored.
    asOneString(page, text, line.runs.length, () => {
      for (const run of line.runs) {
        const [x, y] = f.map(o.vx + (dx + run.x * k) * Math.cos(a), o.vy + (dx + run.x * k) * Math.sin(a));
        page.drawText(run.text, { x, y, size, font: run.font, color: rgb(c.r, c.g, c.b), opacity: o.opacity ?? 1, rotate: degrees(f.rot + extra) });
      }
    });
    return { width, height: size };
  }
  const img = await textToPng(text, o.size, o.color, `${o.bold ? 700 : 500} {s}px system-ui, sans-serif`);
  const png = await doc.embedPng(img.png);
  const k = fit(img.width);
  const w = img.width * k, h = img.height * k;
  const dx = o.anchor === "center" ? -w / 2 : o.anchor === "right" ? -w : 0;
  const [x, y] = f.map(o.vx + dx * Math.cos(a) + h * 0.2 * Math.sin(a), o.vy + dx * Math.sin(a) - h * 0.2 * Math.cos(a));
  asOneString(page, text, 1, () => page.drawImage(png, { x, y, width: w, height: h, opacity: o.opacity ?? 1, rotate: degrees(f.rot + extra) }));
  return { width: w, height: h };
}

// ── Numbers in a style: 1, i, I, a, A. Roman numerals stop at 3999 and
// letters at 0; beyond those the number is written in digits.
export function formatNumber(n: number, style: string) {
  if ((style === "i" || style === "I") && n >= 1 && n < 4000) {
    const parts: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    for (const [v, s] of parts) while (n >= v) { out += s; n -= v; }
    return style === "i" ? out.toLowerCase() : out;
  }
  if ((style === "a" || style === "A") && n >= 1) {
    // a…z, aa…az, ba…
    let out = "";
    for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(97 + ((k - 1) % 26)) + out;
    return style === "A" ? out.toUpperCase() : out;
  }
  return String(n);
}

// {filename} and {date} in user text; {date} is the local date as YYYY-MM-DD.
function fillVariables(text: string, file: File) {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return text.replaceAll("{filename}", baseName(file.name)).replaceAll("{date}", date);
}

const MARGINS: Record<string, [number, number]> = { small: [9, 0.025], normal: [18, 0.045], large: [36, 0.08] };

// ── Previews (P2-12, StampPreview.tsx). `onto` makes a stamping tool draw into
// a document it is given, on one page only, instead of opening the file.
export type Onto = { doc: PDFDocument; only: number };

// The marks alone, as the tool would draw them on page `index` (0-based) of
// a `total`-page file whose pages are shown at w × h points: blank pages
// carrying only the watermark, number or header. Drawn with the same code as
// the real output, so the preview's geometry is the output's.
export async function markLayer(
  tool: "watermark" | "pageNumbers" | "headerFooter", file: File, o: Record<string, unknown>,
  page: { w: number; h: number; index: number; total: number },
  labels?: { page: string; pageOf: string; nOf: string },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Every page is there (numbering counts them), but only one is drawn on.
  for (let i = 0; i < page.total; i++) doc.addPage([page.w, page.h]);
  const onto = { doc, only: page.index };
  const s = (v: unknown) => String(v ?? ""), n = (v: unknown) => Number(v) || 0;
  if (tool === "watermark") {
    await watermark(file, {
      markType: s(o.markType), markText: s(o.markText), markImage: o.markImage as File | undefined, fontSize: n(o.fontSize), color: s(o.color),
      imageScale: n(o.imageScale), position: s(o.position), mosaic: !!o.mosaic, opacity: 100, rotation: n(o.rotation), layer: "over",
      pageRange: s(o.pageRange), font: s(o.font), markBox: !!o.markBox, tileSpacing: n(o.tileSpacing) || 100,
    }, onto);
  } else if (tool === "pageNumbers") {
    await pageNumbers(file, {
      position: s(o.position), numberFormat: s(o.numberFormat), startAt: n(o.startAt) || 1, pageRange: s(o.pageRange),
      skipFirst: n(o.skipFirstPages), skipLast: n(o.skipLastPages), fontSize: n(o.fontSize), color: s(o.color), facing: !!o.facing,
      template: s(o.template), numberStyle: s(o.numberStyle) || "1", margin: s(o.margin), font: s(o.font),
      batesPrefix: s(o.batesPrefix), batesDigits: n(o.batesDigits), counter: { next: n(o.startAt) || 1 }, labels,
    }, onto);
  } else {
    await headerFooter(file, {
      header: s(o.hfHeader), footer: s(o.hfFooter), align: s(o.hfAlign), font: s(o.font), fontSize: n(o.fontSize), color: s(o.color),
      margin: s(o.margin), pageRange: s(o.pageRange), skipFirst: n(o.hfSkipFirst),
    }, onto);
  }
  // Only the page drawn on is kept, so the layer is small and renders as page 1.
  for (let i = page.total - 1; i >= 0; i--) if (i !== page.index) doc.removePage(i);
  return doc.save({ addDefaultPage: false });
}

// ── Page numbers
export async function pageNumbers(
  file: File,
  o: {
    position: string; numberFormat: string; startAt: number; pageRange: string;
    // Pages left unnumbered at each end (true means 1, as the old toggle did).
    skipFirst: number | boolean; skipLast?: number;
    fontSize: number; color: string; facing: boolean;
    // Custom: {page} and {pages}, plus {filename} and {date}.
    template?: string; numberStyle?: string; margin?: string; font?: string;
    // Bates: prefix and a zero-padded counter. Pass the same counter to every
    // file of a batch so the numbers run on.
    batesPrefix?: string; batesDigits?: number; counter?: { next: number };
    // Translated templates: "Page {n}", "Page {n} of {total}", "{n} of {total}".
    labels?: { page: string; pageOf: string; nOf: string };
  },
  onto?: Onto,
): Promise<Output[]> {
  const doc = onto?.doc ?? (await loadPdf(file, file.name));
  const family = fontChoice(o.font);
  const pages = doc.getPages();
  const total = pages.length;
  const chosen = pageSet(o.pageRange, total);
  const skipFirst = o.skipFirst === true ? 1 : Math.max(0, Number(o.skipFirst) || 0);
  const skipLast = Math.max(0, Number(o.skipLast) || 0);
  const numbered = [...chosen].filter((i) => i >= skipFirst && i < total - skipLast).sort((a, b) => a - b);
  const count = numbered.length;
  const labels = o.labels ?? { page: "Page {n}", pageOf: "Page {n} of {total}", nOf: "{n} of {total}" };
  const style = o.numberStyle ?? "1";
  const fill = (tpl: string, n: number, total: number) =>
    tpl.replace("{n}", formatNumber(n, style)).replace("{total}", formatNumber(total, style));
  const digits = Math.min(12, Math.max(1, Math.round(o.batesDigits ?? 6)));
  const [mMin, mFrac] = MARGINS[o.margin ?? "normal"] ?? MARGINS.normal;
  const [vert, horiz] = o.position.split("-");
  for (let k = 0; k < numbered.length; k++) {
    const i = numbered[k];
    const page = pages[i];
    const n = o.numberFormat === "bates" && o.counter ? o.counter.next++ : o.startAt + k;
    if (onto && i !== onto.only) continue;
    const last = o.startAt + count - 1;
    const text =
      o.numberFormat === "bates" ? `${o.batesPrefix ?? ""}${String(n).padStart(digits, "0")}`
      : o.numberFormat === "custom" ? fillVariables(o.template ?? "{page}", file).replaceAll("{page}", formatNumber(n, style)).replaceAll("{pages}", formatNumber(last, style))
      : o.numberFormat === "pageN" ? fill(labels.page, n, last)
      : o.numberFormat === "nOfTotal" ? fill(labels.nOf, n, last)
      : o.numberFormat === "pageNOfTotal" ? fill(labels.pageOf, n, last)
      : formatNumber(n, style);
    const { vw, vh } = visualFrame(page);
    // On a very small page the margin and the text shrink so the label stays on it.
    const margin = Math.min(Math.max(mMin, Math.min(vw, vh) * mFrac), Math.min(vw, vh) * 0.1);
    const size = Math.min(o.fontSize, (vh - 2 * margin) * 0.8);
    let h = horiz;
    // Facing pages: outer edge alternates.
    if (o.facing && h !== "center" && (n % 2 === 0)) h = h === "left" ? "right" : "left";
    const vx = h === "left" ? margin : h === "right" ? vw - margin : vw / 2;
    const vy = vert === "top" ? vh - margin - size * 0.75 : margin;
    await drawLabel(doc, page, family, text, {
      vx, vy, size, color: o.color, anchor: h === "left" ? "left" : h === "right" ? "right" : "center", maxWidth: vw - 2 * margin,
    });
  }
  if (onto) return [];
  return [{ name: `${baseName(file.name)}-numbered.pdf`, blob: await save(doc) }];
}

// ── Header and footer: a line of text at the top and/or bottom of each
// page, with {page}, {pages}, {filename} and {date} filled in.
export async function headerFooter(
  file: File,
  o: { header: string; footer: string; align: string; font?: string; fontSize: number; color: string; margin?: string; pageRange: string; skipFirst: number },
  onto?: Onto,
): Promise<Output[]> {
  const doc = onto?.doc ?? (await loadPdf(file, file.name));
  const family = fontChoice(o.font);
  const pages = doc.getPages();
  const total = pages.length;
  const chosen = pageSet(o.pageRange, total);
  const [mMin, mFrac] = MARGINS[o.margin ?? "normal"] ?? MARGINS.normal;
  const anchor = o.align === "left" ? "left" : o.align === "right" ? "right" : "center";
  const header = fillVariables(o.header.trim(), file), footer = fillVariables(o.footer.trim(), file);
  for (let i = 0; i < total; i++) {
    if (!chosen.has(i) || i < Math.max(0, o.skipFirst || 0) || (onto && i !== onto.only)) continue;
    const page = pages[i];
    const { vw, vh } = visualFrame(page);
    const margin = Math.min(Math.max(mMin, Math.min(vw, vh) * mFrac), Math.min(vw, vh) * 0.1);
    const size = Math.min(o.fontSize, (vh - 2 * margin) * 0.4);
    const vx = anchor === "left" ? margin : anchor === "right" ? vw - margin : vw / 2;
    const fill = (t: string) => t.replaceAll("{page}", String(i + 1)).replaceAll("{pages}", String(total));
    const draw = (text: string, vy: number) => drawLabel(doc, page, family, fill(text), { vx, vy, size, color: o.color, anchor, maxWidth: vw - 2 * margin });
    if (header) await draw(header, vh - margin - size * 0.75);
    if (footer) await draw(footer, margin);
  }
  if (onto) return [];
  return [{ name: `${baseName(file.name)}-header-footer.pdf`, blob: await save(doc) }];
}

// Moves the content stream pdf-lib just added to the front, so it renders under the page.
function sendLastStreamToBack(page: PDFPage, before: number) {
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray)) return;
  const added: ReturnType<PDFArray["get"]>[] = [];
  while (contents.size() > before) {
    added.unshift(contents.get(contents.size() - 1));
    contents.remove(contents.size() - 1);
  }
  added.reverse().forEach((ref) => contents.insert(0, ref));
}

function contentCount(page: PDFPage) {
  const c = page.node.Contents();
  return c instanceof PDFArray ? c.size() : c ? 1 : 0;
}

// ── Watermark
export async function watermark(
  file: File,
  o: {
    markType: string; markText: string; markImage?: File; fontSize: number; color: string; imageScale: number;
    position: string; mosaic: boolean; opacity: number; rotation: string | number; layer: string; pageRange: string;
    // Font family, a white box behind the mark, and the gap between tiles (100 = default).
    font?: string; markBox?: boolean; tileSpacing?: number;
  },
  onto?: Onto,
): Promise<Output[]> {
  const doc = onto?.doc ?? (await loadPdf(file, file.name));
  const family = fontChoice(o.font);
  const pages = doc.getPages();
  const chosen = pageSet(o.pageRange, pages.length);
  const opacity = o.opacity / 100;
  const angle = Number(o.rotation) || 0;
  const a = (angle * Math.PI) / 180;
  const spacing = Math.min(4, Math.max(0.5, (o.tileSpacing ?? 100) / 100));
  const markText = fillVariables(o.markText, file);

  let image: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
  let line: LaidOut | null = null;
  let textImg: { png: Uint8Array; width: number; height: number } | null = null;
  if (o.markType === "image") {
    if (!o.markImage) throw new PdfError("missing_image");
    const img = await normaliseImage(o.markImage);
    image = img.kind === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
  } else {
    line = await textLine(doc, family, markText, o.fontSize, true);
    if (!line) textImg = await textToPng(markText, o.fontSize, o.color, "700 {s}px system-ui, sans-serif");
  }
  const textImage = textImg ? await doc.embedPng(textImg.png) : null;

  for (let i = 0; i < pages.length; i++) {
    if (!chosen.has(i) || (onto && i !== onto.only)) continue;
    const page = pages[i];
    isolate(page);
    const before = contentCount(page);
    const f = visualFrame(page);
    let mw: number, mh: number;
    if (image) {
      const scale = (Math.min(f.vw, f.vh) * (o.imageScale / 100)) / Math.max(image.width, image.height);
      mw = image.width * scale;
      mh = image.height * scale;
    } else if (textImage && textImg) {
      mw = textImg.width;
      mh = textImg.height;
    } else {
      mw = line!.width;
      // About the capital height: Helvetica-Bold's box (0.925 em) × 0.72.
      mh = o.fontSize * 0.666;
    }
    // Text that wouldn't fit on the page, turned as it is, is drawn smaller.
    const k = image ? 1 : Math.min(1,
      (f.vw * 0.9) / (Math.abs(mw * Math.cos(a)) + Math.abs(mh * Math.sin(a))),
      (f.vh * 0.9) / (Math.abs(mw * Math.sin(a)) + Math.abs(mh * Math.cos(a))));
    mw *= k;
    mh *= k;

    const draw = (cx: number, cy: number) => {
      // (cx, cy) is the visual centre of the mark. Rotate the bottom-left corner around it.
      const corner = (dx: number, dy: number) => f.map(
        cx + (dx - mw / 2) * Math.cos(a) - (dy - mh / 2) * Math.sin(a),
        cy + (dx - mw / 2) * Math.sin(a) + (dy - mh / 2) * Math.cos(a),
      );
      const [x, y] = corner(0, 0);
      const rotate = degrees(f.rot + angle);
      if (o.markBox && !image) {
        const pad = Math.max(4, o.fontSize * 0.3) * k;
        const [bx, by] = corner(-pad, -pad);
        page.drawRectangle({ x: bx, y: by, width: mw + 2 * pad, height: mh + 2 * pad, rotate, color: rgb(1, 1, 1), opacity });
      }
      if (image) page.drawImage(image, { x, y, width: mw, height: mh, opacity, rotate });
      else if (textImage) asOneString(page, markText, 1, () => page.drawImage(textImage, { x, y, width: mw, height: mh, opacity, rotate }));
      else {
        const c = hexToRgb(o.color);
        asOneString(page, markText, line!.runs.length, () => {
          for (const run of line!.runs) {
            const [rx, ry] = corner(run.x * k, 0);
            page.drawText(run.text, { x: rx, y: ry, size: o.fontSize * k, font: run.font, color: rgb(c.r, c.g, c.b), opacity, rotate });
          }
        });
      }
    };

    if (o.mosaic) {
      const stepX = (mw * 1.6 + 40) * spacing;
      const stepY = (mh * 3 + 40) * spacing;
      let row = 0;
      for (let cy = stepY / 2; cy < f.vh + stepY; cy += stepY, row++)
        for (let cx = (row % 2 ? stepX / 2 : 0); cx < f.vw + stepX; cx += stepX) draw(cx, cy);
    } else {
      const [vert, horiz] = o.position.split("-");
      const pad = 24 + Math.max(mw, mh) / 2;
      const cx = horiz === "left" ? pad : horiz === "right" ? f.vw - pad : f.vw / 2;
      const cy = vert === "top" ? f.vh - pad : vert === "bottom" ? pad : f.vh / 2;
      draw(cx, cy);
    }
    if (o.layer === "under") sendLastStreamToBack(page, before);
  }
  if (onto) return [];
  return [{ name: `${baseName(file.name)}-watermarked.pdf`, blob: await save(doc) }];
}

// ── Crop. Rect is in visual fractions (0–1, top-left origin).
export type FracRect = { x: number; y: number; w: number; h: number };

export async function crop(file: File, rects: Map<number, FracRect> | FracRect): Promise<Output[]> {
  const doc = await loadPdf(file, file.name);
  doc.getPages().forEach((page, i) => {
    const r = rects instanceof Map ? rects.get(i) : rects;
    if (!r) return;
    const f = visualFrame(page);
    const [x1, y1] = f.map(r.x * f.vw, (1 - r.y - r.h) * f.vh);
    const [x2, y2] = f.map((r.x + r.w) * f.vw, (1 - r.y) * f.vh);
    const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    page.setCropBox(x, y, w, h);
    page.setMediaBox(x, y, w, h);
    page.setTrimBox(x, y, w, h);
    page.setBleedBox(x, y, w, h);
    page.setArtBox(x, y, w, h);
  });
  return [{ name: `${baseName(file.name)}-cropped.pdf`, blob: await save(doc) }];
}

// ── Editor objects (Edit PDF, Sign PDF)
export type EditorItem = {
  id: string;
  page: number;
  kind: "text" | "image" | "rect" | "ellipse" | "line" | "path" | "highlight" | "whiteout" | "textEdit" | "paraEdit" | "objEdit" | "scanEdit"
    | "erase" | "arrow" | "underline" | "strike" | "note" | "link" | "stamp" | "check" | "cross" | FieldKind;
  // Visual fractions of the page, top-left origin.
  x: number; y: number; w: number; h: number;
  color?: string;
  fill?: string | null;
  stroke?: number; // points
  fontSize?: number; // points
  bold?: boolean;
  text?: string;
  image?: string; // data URL
  points?: [number, number][]; // fractions, for path and line
  // Form fields (see forms.ts).
  name?: string;
  options?: string[];
  required?: boolean;
  multiple?: boolean;
  multiline?: boolean;
  dateFormat?: DateFormat;
  tooltip?: string;
  // textEdit, paraEdit, objEdit: what on the page it changes (see listText,
  // listContent) and how it was, so the item's own fields say what changed.
  // `text` "" (or `removed`) deletes it.
  source?: {
    index: number; was: string; x: number; y: number; font?: string; angle?: number;
    sig?: string; w?: number; h?: number; kind?: ContentKind; parts?: Target[];
    size?: number; color?: string; fill?: string | null; stroke?: number; align?: Align; pixels?: [number, number]; lines?: number;
  };
  // objEdit and paraEdit: degrees counter-clockwise, flips, deletion, order.
  rotate?: number;
  flipX?: boolean;
  flipY?: boolean;
  removed?: boolean;
  order?: "front" | "back";
  align?: Align;
  // scanEdit: a line of a scan read with OCR, retyped. Its box on the scan is
  // emptied to `fill` (the paper's colour) and the text drawn in `color` (the
  // ink's), in `family`, no wider than the box.
  family?: Family;
  // link: where it goes (linkTarget); note: its text is `text`.
  url?: string;
};

export { linkTarget } from "./links";

function dataUrlBytes(url: string) {
  const b64 = url.split(",")[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, png: url.startsWith("data:image/png") };
}

export async function applyItems(doc: PDFDocument, items: EditorItem[]) {
  const pages = doc.getPages();
  const form = items.some((i) => isFieldKind(i.kind)) ? doc.getForm() : null;
  for (const it of items) {
    const page = pages[it.page];
    if (!page) continue;
    isolate(page);
    const f = visualFrame(page);
    const vx = it.x * f.vw;
    const vyTop = (1 - it.y) * f.vh;
    const w = it.w * f.vw;
    const h = it.h * f.vh;
    const [x, y] = f.map(vx, vyTop - h); // visual bottom-left of the box
    const rotate = degrees(f.rot);
    const color = hexToRgb(it.color ?? "#111827");
    const c = rgb(color.r, color.g, color.b);
    const fill = it.fill ? (() => { const v = hexToRgb(it.fill!); return rgb(v.r, v.g, v.b); })() : undefined;
    switch (it.kind) {
      case "text": {
        const size = it.fontSize ?? 14;
        const lines = (it.text ?? "").split("\n");
        for (let li = 0; li < lines.length; li++) {
          if (!lines[li]) continue;
          await drawLabel(doc, page, "helvetica", lines[li], {
            vx, vy: vyTop - size * 0.86 - li * size * 1.25, size, color: it.color ?? "#111827", anchor: "left", bold: it.bold,
          });
        }
        break;
      }
      case "arrow": {
        const pts = it.points ?? [];
        if (pts.length < 2) break;
        const [[ax, ay], [bx, by]] = [pts[0], pts[pts.length - 1]].map(([px, py]) => [px * f.vw, (1 - py) * f.vh]);
        const sw = it.stroke ?? 2;
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 1) break;
        const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
        const head = Math.min(len * 0.6, Math.max(8, sw * 4));
        // The shaft stops where the head starts, so a thick line doesn't poke through its tip.
        const [sx, sy] = [bx - ux * head * 0.8, by - uy * head * 0.8];
        page.drawLine({ start: pt(f, ax, ay), end: pt(f, sx, sy), thickness: sw, color: c, lineCap: 1 });
        const wing = (k: number) => {
          const a = Math.atan2(uy, ux) + Math.PI + k * 0.45;
          return [bx + Math.cos(a) * head, by + Math.sin(a) * head];
        };
        const tri = [[bx, by], wing(1), wing(-1)].map(([px, py]) => pt(f, px, py));
        page.drawSvgPath(`M${tri[0].x} ${-tri[0].y} L${tri[1].x} ${-tri[1].y} L${tri[2].x} ${-tri[2].y} Z`, { x: 0, y: 0, color: c, borderWidth: 0 });
        break;
      }
      case "underline":
      case "strike": {
        // Under the line's letters, or through the middle of its small letters.
        const along = vyTop - h * (it.kind === "underline" ? 0.94 : 0.58);
        const thickness = Math.max(0.6, Math.min(3, h * 0.07));
        page.drawLine({ start: pt(f, vx, along), end: pt(f, vx + w, along), thickness, color: c });
        break;
      }
      case "check":
      case "cross": {
        const sw = Math.max(1, Math.min(w, h) * 0.13);
        const at = (fx: number, fy: number) => pt(f, vx + fx * w, vyTop - fy * h);
        const strokes = it.kind === "check" ? [[[0.12, 0.55], [0.4, 0.82]], [[0.4, 0.82], [0.88, 0.18]]] : [[[0.18, 0.18], [0.82, 0.82]], [[0.82, 0.18], [0.18, 0.82]]];
        for (const [[x0, y0], [x1, y1]] of strokes) page.drawLine({ start: at(x0, y0), end: at(x1, y1), thickness: sw, color: c, lineCap: 1 });
        break;
      }
      case "stamp": {
        // In capitals, as the editor shows it.
        const label = (it.text ?? "").trim().toLocaleUpperCase();
        if (!label) break;
        page.drawRectangle({ x, y, width: w, height: h, rotate, borderColor: c, borderWidth: Math.max(1.5, h * 0.07), borderOpacity: 0.9 });
        const size = Math.min(h * 0.55, it.fontSize ?? h * 0.55);
        await drawLabel(doc, page, "helvetica", label, { vx: vx + w / 2, vy: vyTop - h / 2 - size * 0.35, size, color: it.color ?? "#d33f6a", anchor: "center", bold: true, maxWidth: w * 0.88, opacity: 0.9 });
        break;
      }
      case "note":
      case "link": {
        // Real annotations: a comment readers open, or a link they follow. The box in user space.
        const corners = [[vx, vyTop], [vx + w, vyTop], [vx, vyTop - h], [vx + w, vyTop - h]].map(([px, py]) => f.map(px, py));
        const rect = [Math.min(...corners.map((q) => q[0])), Math.min(...corners.map((q) => q[1])), Math.max(...corners.map((q) => q[0])), Math.max(...corners.map((q) => q[1]))];
        let dict: Record<string, unknown> | null = null;
        if (it.kind === "note") {
          if (!(it.text ?? "").trim()) break;
          dict = { Type: "Annot", Subtype: "Text", Rect: rect, Contents: PDFHexString.fromText(it.text!), Name: "Comment", F: 4, C: [color.r, color.g, color.b], M: PDFString.fromDate(new Date()) };
        } else {
          const target = linkTarget(it.url ?? "", pages.length);
          if (!target) break;
          const action = "uri" in target
            ? { A: doc.context.obj({ Type: "Action", S: "URI", URI: PDFString.of(target.uri) }) }
            : { Dest: doc.context.obj([pages[target.page].ref, PDFName.of("Fit")]) };
          dict = { Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0], F: 4, ...action };
        }
        page.node.addAnnot(doc.context.register(doc.context.obj(dict as never)));
        break;
      }
      case "scanEdit": {
        const text = (it.text ?? "").replace(/\s+/g, " ").trim();
        if (it.removed || !text) break;
        const size = it.fontSize ?? 12;
        // Room: to the right margin (as wide as the left one), or the box's width once it's been resized; longer text is drawn smaller.
        const resized = it.source?.w !== undefined && Math.abs(it.source.w - it.w) > 1e-4;
        const room = resized ? w : Math.max(w, (1 - it.x - Math.max(it.x, 0.04)) * f.vw);
        // The box's top is the line's tallest letters, about three quarters of the size above its baseline.
        await drawLabel(doc, page, it.family ?? "arimo", text, { vx, vy: vyTop - size * 0.78, size, color: it.color ?? "#111827", anchor: "left", bold: it.bold, maxWidth: room });
        break;
      }
      case "image": {
        if (!it.image) break;
        const { bytes, png } = dataUrlBytes(it.image);
        const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        page.drawImage(img, { x, y, width: w, height: h, rotate });
        break;
      }
      case "rect":
      case "whiteout":
        page.drawRectangle({
          x, y, width: w, height: h, rotate,
          color: it.kind === "whiteout" ? rgb(1, 1, 1) : fill,
          borderColor: it.kind === "whiteout" ? undefined : c,
          borderWidth: it.kind === "whiteout" ? 0 : it.stroke ?? 2,
        });
        break;
      case "highlight":
        page.drawRectangle({ x, y, width: w, height: h, rotate, color: c, opacity: 0.38, blendMode: BlendMode.Multiply });
        break;
      case "ellipse": {
        const [cx, cy] = f.map(vx + w / 2, vyTop - h / 2);
        page.drawEllipse({ x: cx, y: cy, xScale: w / 2, yScale: h / 2, rotate, color: fill, borderColor: c, borderWidth: it.stroke ?? 2 });
        break;
      }
      case "line":
      case "path": {
        const pts = it.points ?? [];
        if (pts.length < 2) break;
        // SVG path in visual points, y down, anchored at the visual top-left.
        const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${(px * f.vw).toFixed(2)} ${(py * f.vh).toFixed(2)}`).join(" ");
        const [ox, oy] = f.map(0, f.vh);
        page.drawSvgPath(d, { x: ox, y: oy, borderColor: c, borderWidth: it.stroke ?? 2, rotate, borderLineCap: 1 });
        break;
      }
      default:
        if (isFieldKind(it.kind)) await addField(doc, form!, page, f, { ...it, kind: it.kind }, { vx, vy: vyTop - h, w, h });
    }
  }
}

// Changes to the page's own content go first (PDFium), then what was added on top (pdf-lib).
// A point in visual points (y up), as pdf-lib wants it.
const pt = (f: ReturnType<typeof visualFrame>, vx: number, vy: number) => {
  const [x, y] = f.map(vx, vy);
  return { x, y };
};

export const isContentEdit = (i: EditorItem) => i.kind === "textEdit" || i.kind === "paraEdit" || i.kind === "objEdit" || i.kind === "scanEdit";

export { contentChanged } from "./contentchange";

// White-out empties what's under it; a retyped scan line empties its old
// place, then is drawn like an added item.
export async function editPdf(file: File, items: EditorItem[], suffix: string): Promise<Output[]> {
  const changed = items.filter((i) => isContentEdit(i) && contentChanged(i));
  const edits = [...changed, ...items.filter((i) => i.kind === "whiteout" || i.kind === "erase")];
  const added = items.filter((i) => i.kind !== "erase" && (!isContentEdit(i) || (i.kind === "scanEdit" && changed.includes(i))));
  const name = `${baseName(file.name)}-${suffix}.pdf`;
  if (!edits.length) {
    const doc = await loadPdf(file, file.name);
    await applyItems(doc, added);
    return [{ name, blob: await save(doc) }];
  }
  let out: Awaited<ReturnType<typeof applyContent>>;
  try {
    out = await applyContent(file, edits);
  } catch (e) {
    // White-out alone still covers what's under it where the file can't be changed underneath.
    if (!changed.length && !edits.some((i) => i.kind === "erase")) {
      const doc = await loadPdf(file, file.name);
      await applyItems(doc, added);
      return [{ name, blob: await save(doc) }];
    }
    throw e;
  }
  const { bytes, note } = out;
  if (!added.length) return [{ name, blob: pdfBlob(bytes), note }];
  const doc = await loadPdf(new File([bytes as BlobPart], file.name, { type: "application/pdf" }), file.name);
  await applyItems(doc, added);
  return [{ name, blob: await save(doc), note }];
}

export { moveLayer } from "./layers";

// ── The page's own text (PDFium text objects)

// A text object as the editor shows it: box in visual fractions (top-left
// origin), size in points as seen, angle in degrees counter-clockwise on screen.
export type TextBox = { index: number; text: string; font: string; size: number; box: FracRect; angle: number; color: string; bold: boolean; italic: boolean };

type PageGeom = import("./pdfium").PageGeom;

// visualFrame for a page PDFium read, and its inverse.
function frameOf(g: PageGeom) {
  const rect = (b: PageGeom["media"]) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });
  const media = rect(g.media);
  const crop = g.crop ? rect(g.crop) : media;
  const f = visualFrame({ getMediaBox: () => media, getCropBox: () => crop, getRotation: () => ({ angle: g.rotate }) } as unknown as PDFPage);
  const [ox, oy] = f.map(0, 0);
  const [ax, ay] = f.map(1, 0);
  const [bx, by] = f.map(0, 1);
  const u = [ax - ox, ay - oy], v = [bx - ox, by - oy];
  const det = u[0] * v[1] - u[1] * v[0];
  // User-space vector → visual vector.
  const back = (x: number, y: number): [number, number] => [(x * v[1] - y * v[0]) / det, (u[0] * y - u[1] * x) / det];
  return { ...f, u, v, toVisual: (x: number, y: number) => back(x - ox, y - oy), back };
}

// A box on screen (visual fractions) → its bounds in user space.
function userBox(g: PageGeom, r: FracRect): import("./pdfium").Box {
  const f = frameOf(g);
  const corners = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([fx, fy]) => f.map(fx * f.vw, (1 - fy) * f.vh));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// Fractions of the page moved on screen → points moved in user space.
function moveDelta(g: PageGeom, [fx, fy]: [number, number]): [number, number] {
  const f = frameOf(g);
  const dvx = fx * f.vw, dvy = -fy * f.vh;
  return [dvx * f.u[0] + dvy * f.v[0], dvx * f.u[1] + dvy * f.v[1]];
}

const fileBytes = async (file: File) => new Uint8Array(await file.arrayBuffer());

export async function listText(file: File, page: number): Promise<TextBox[]> {
  const { textObjects } = await import("./pdfium");
  const { geom, objects } = await textObjects(await fileBytes(file), page);
  const f = frameOf(geom);
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return objects.map((o) => {
    const b = o.bounds;
    const corners = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => f.toVisual(x, y));
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    const [a, bb] = o.matrix;
    const dir = f.back(a, bb);
    return {
      index: o.index, text: o.text, font: o.font, bold: o.bold, italic: o.italic,
      size: o.size * Math.hypot(a, bb),
      box: { x: Math.min(...xs) / f.vw, y: 1 - Math.max(...ys) / f.vh, w: (Math.max(...xs) - Math.min(...xs)) / f.vw, h: (Math.max(...ys) - Math.min(...ys)) / f.vh },
      angle: (Math.atan2(dir[1], dir[0]) * 180) / Math.PI,
      color: `#${hex(o.fill[0])}${hex(o.fill[1])}${hex(o.fill[2])}`,
    };
  });
}

// Bundled fonts for new text an object's own font can't show: the
// metric-compatible stand-in for the font (Arimo, Tinos, Cousine, Carlito,
// Caladea) where it has the glyph, else a Noto slice (CJK, and scripts the
// stand-in lacks).
type Kit = { hasGlyphForCodePoint(cp: number): boolean };
const fallbackFaces = new Map<string, Promise<{ sfnt: Uint8Array; kit: Kit } | null>>();
const STAND_INS = { arimo: "Arimo", tinos: "Tinos", cousine: "Cousine", carlito: "Carlito", caladea: "Caladea" } as const;
const NOTO = { jp: "Noto Sans JP", kr: "Noto Sans KR", sc: "Noto Sans SC", tc: "Noto Sans TC", arabic: "Noto Sans Arabic", thai: "Noto Sans Thai", devanagari: "Noto Sans Devanagari" } as const;
const notoName = (file: string) => {
  const key = Object.keys(NOTO).find((k) => file.startsWith(`noto-sans-${k}-`)) as keyof typeof NOTO | undefined;
  return key ? NOTO[key] : "Noto Sans";
};

function fallbackFace(key: string, woff: () => Promise<Uint8Array | null>) {
  let p = fallbackFaces.get(key);
  if (!p) {
    p = (async () => {
      const [{ woffToSfnt }, { default: fontkit }] = await Promise.all([import("./pdfa"), import("@pdf-lib/fontkit")]);
      const w = await woff();
      if (!w) return null;
      const sfnt = woffToSfnt(w);
      return { sfnt, kit: fontkit.create(sfnt) as unknown as Kit };
    })();
    p.catch(() => fallbackFaces.delete(key));
    fallbackFaces.set(key, p);
  }
  return p;
}

const fallbackRuns: import("./pdfium").Fallback = async (text, like) => {
  const [{ pdfaFonts, pickFamily }, faces, { notoFaceFor }] = await Promise.all([import("./pdfa"), import("../office/faces"), import("./fonts")]);
  // The stand-in by name first (a Tinos or Liberation Serif subset), then by pdfa.ts's rules.
  const named = (Object.keys(STAND_INS) as (keyof typeof STAND_INS)[]).find((k) => new RegExp(k, "i").test(like.name));
  const liberation = /liberation.?mono/i.test(like.name) ? "cousine" : /liberation.?serif/i.test(like.name) ? "tinos" : /liberation.?sans/i.test(like.name) ? "arimo" : undefined;
  const family = named ?? liberation ?? (pickFamily(like.name, like.flags) as keyof typeof STAND_INS);
  // CJK forms by the replaced font's name.
  const prefer = /JP|Japan|Mincho|Gothic|Meiryo|Hiragino|YuGo|YuMin|Osaka/i.test(like.name) ? "jp"
    : /KR|Korea|Malgun|Batang|Gulim|Dotum|Gungsuh/i.test(like.name) ? "kr"
    : /TC|Hant|HK|MingLiU|Taiwan/i.test(like.name) ? "tc"
    : /SC|Hans|SimSun|SimHei|YaHei|GB|Song|Kai/i.test(like.name) ? "sc" : undefined;
  type Pick = { key: string; name: string; face: { sfnt: Uint8Array; kit: Kit } };
  const pick = async (cp: number): Promise<Pick | null> => {
    for (const subset of faces.subsetsOf(family)) {
      if (!faces.inSubset(subset, cp)) continue;
      const file = faces.fontFile(family, like.bold, like.italic, subset);
      const face = await fallbackFace(file, () => pdfaFonts.load(file)).catch(() => null);
      if (face?.kit.hasGlyphForCodePoint(cp)) return { key: file, name: STAND_INS[family], face };
    }
    const noto = await notoFaceFor(cp, text, like.bold, prefer).catch(() => null);
    if (!noto) return null;
    const face = await fallbackFace(noto.file, async () => noto.bytes);
    return face?.kit.hasGlyphForCodePoint(cp) ? { key: noto.file, name: notoName(noto.file), face } : null;
  };
  const runs: (Pick & { text: string })[] = [];
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0)!;
    const last = runs[runs.length - 1];
    if (last && last.face.kit.hasGlyphForCodePoint(cp)) {
      last.text += ch;
      continue;
    }
    const p = await pick(cp);
    if (!p) return null;
    if (last && last.key === p.key) last.text += ch;
    else runs.push({ ...p, text: ch });
  }
  return runs.map((r) => ({ text: r.text, key: r.key, name: r.name, font: async () => r.face.sfnt }));
};

// Whether new text for a text object keeps its font, for the editor to say
// before saving. `fallback` names the bundled fonts used instead (null: none can).
export async function textFonts(file: File, page: number, index: number, text: string):
  Promise<{ kept: true; font: string } | { kept: false; font: string; fallback: string | null } | { unsupported: true }> {
  const { textFontCheck } = await import("./pdfium");
  const r = await textFontCheck(await fileBytes(file), page, index, text, fallbackRuns);
  if ("unsupported" in r || r.kept) return r;
  return { kept: false, font: r.font, fallback: r.fallback ? r.fallback.join(", ") : null };
}

// ── Everything on the page (Edit PDF's Edit content tool, objects.ts)

export type ContentKind = import("./objects").ObjKind;
export type Align = import("./objects").Align;
type Target = import("./objects").Target;

// One object as the editor shows it: its box in visual fractions (top-left
// origin), the angle it's turned on screen (degrees counter-clockwise) and,
// for paths, its colours.
export type ContentObject = {
  index: number; sig: string; kind: ContentKind;
  box: FracRect; angle: number;
  fill: string | null; stroke: string | null; strokeWidth: number;
  pixels?: [number, number];
};

// Text as paragraphs: the text objects that make one (lines, or pieces of
// lines), read in order.
export type Paragraph = {
  parts: Target[];
  text: string; box: FracRect; angle: number;
  font: string; size: number; // visual points
  color: string; bold: boolean; italic: boolean;
  align: Align; lines: number;
  // More than one font, size or colour: editing sets it all like the first part.
  mixed: boolean;
  // Text that isn't drawn (an OCR layer over a scan).
  invisible: boolean;
};

const hexOf = (c: number[] | null) => (c ? `#${c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}` : null);
const rgbaOf = (hex: string): import("./objects").RGBA => {
  const v = hexToRgb(hex);
  return [Math.round(v.r * 255), Math.round(v.g * 255), Math.round(v.b * 255), 255];
};

type Raw = import("./objects").PageObject;
type Placed = { o: Raw; box: FracRect; angle: number; dir: [number, number]; up: [number, number]; base: number; left: number; right: number; size: number };

// The file as the content editor reads and writes it: through the shared
// load pre-pass (open.ts: owner-only encryption removed, a damaged file
// repaired, a locked one refused), then, when PDFium still can't open it or
// its first page (garbage before the header, a page tree too deep or looping),
// with its page tree rebuilt by qpdf. Listing and saving both start from
// these same bytes, so what was listed is what's changed.
const editable = new WeakMap<File, Promise<Uint8Array>>();
function contentBytes(file: File): Promise<Uint8Array> {
  let p = editable.get(file);
  if (!p) {
    p = (async () => {
      const [{ openForEdit }, { pdfiumOpens }] = await Promise.all([import("./open"), import("./objects")]);
      const { bytes, doc } = await openForEdit(await fileBytes(file), file.name);
      if (await pdfiumOpens(bytes)) return bytes;
      // pdf-lib read it: written out again, with one flat page tree.
      try {
        const flat = await flatPages(doc);
        if (await pdfiumOpens(flat)) return flat;
      } catch {
        /* qpdf next */
      }
      const { runQpdf } = await import("./qpdf");
      try {
        const { output } = await runQpdf(bytes, (i, o) => ["--deterministic-id", "--decode-level=none", i, "--pages", i, "--", o]);
        if (await pdfiumOpens(output)) return output;
      } catch {
        /* reported below */
      }
      throw new PdfError("damaged", file.name);
    })();
    p.catch(() => editable.delete(file));
    editable.set(file, p);
  }
  return p;
}

// The document written out with every page directly under one page tree
// node, each page carrying the attributes it inherited from the levels that
// are gone.
async function flatPages(doc: PDFDocument): Promise<Uint8Array> {
  const pages = doc.getPages();
  const ctx = doc.context;
  const tree = ctx.obj({ Type: "Pages", Kids: pages.map((p) => p.ref), Count: pages.length });
  const ref = ctx.register(tree);
  for (const p of pages) {
    for (const name of ["Resources", "MediaBox", "CropBox", "Rotate"]) {
      const key = PDFName.of(name);
      const v = p.node.getInheritableAttribute(key);
      if (v && !p.node.get(key)) p.node.set(key, v);
    }
    p.node.set(PDFName.of("Parent"), ref);
  }
  doc.catalog.set(PDFName.of("Pages"), ref);
  return doc.save({ useObjectStreams: false, addDefaultPage: false });
}

// The page's objects, and its text grouped into paragraphs.
export async function listContent(file: File, page: number): Promise<{ objects: ContentObject[]; paragraphs: Paragraph[] }> {
  const { pageObjects } = await import("./objects");
  const { geom, objects } = await pageObjects(await contentBytes(file), page);
  const f = frameOf(geom);
  const boxOf = (b: Raw["bounds"]): FracRect => {
    const corners = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => f.toVisual(x, y));
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    return { x: Math.min(...xs) / f.vw, y: 1 - Math.max(...ys) / f.vh, w: (Math.max(...xs) - Math.min(...xs)) / f.vw, h: (Math.max(...ys) - Math.min(...ys)) / f.vh };
  };
  const angleOf = (mx: number[]) => {
    const d = f.back(mx[0], mx[1]);
    return (Math.atan2(d[1], d[0]) * 180) / Math.PI;
  };
  const list: ContentObject[] = objects.map((o) => ({
    index: o.index, sig: o.sig, kind: o.kind, box: boxOf(o.bounds),
    angle: o.kind === "path" || o.kind === "shading" ? 0 : angleOf(o.matrix),
    fill: hexOf(o.fill), stroke: hexOf(o.stroke), strokeWidth: o.strokeWidth, pixels: o.pixels,
  }));
  // Text in visual points: each object's baseline, extent along it, and size.
  const placed: Placed[] = objects.filter((o) => o.kind === "text" && o.text).map((o) => {
    const [a, b] = o.matrix;
    const d = f.back(a, b);
    const len = Math.hypot(d[0], d[1]) || 1;
    const dir: [number, number] = [d[0] / len, d[1] / len];
    const up: [number, number] = [-dir[1], dir[0]];
    const origin = f.toVisual(o.matrix[4], o.matrix[5]);
    const corners = [[o.bounds.x0, o.bounds.y0], [o.bounds.x1, o.bounds.y0], [o.bounds.x0, o.bounds.y1], [o.bounds.x1, o.bounds.y1]].map(([x, y]) => f.toVisual(x, y));
    const along = corners.map((c) => c[0] * dir[0] + c[1] * dir[1]);
    return {
      o, box: boxOf(o.bounds), angle: angleOf(o.matrix), dir, up,
      base: origin[0] * up[0] + origin[1] * up[1],
      left: Math.min(...along), right: Math.max(...along),
      size: o.text!.size * Math.hypot(a, b),
    };
  });
  return { objects: list, paragraphs: paragraphsOf(placed) };
}

const START = /^\s*([•◦▪●○■\-–*]|\d{1,3}[.)]|[a-z][.)])\s/;

// Lines, then paragraphs: lines of one size, font and colour, a steady line
// spacing apart and overlapping across, each starting under the last unless
// it's indented (a new paragraph's first line) or starts a list item.
function paragraphsOf(placed: Placed[]): Paragraph[] {
  const byAngle = new Map<number, Placed[]>();
  for (const p of placed) {
    const k = Math.round(p.angle);
    byAngle.set(k, [...(byAngle.get(k) ?? []), p]);
  }
  const out: Paragraph[] = [];
  for (const group of byAngle.values()) {
    // Lines: pieces on one baseline, near each other.
    const sorted = [...group].sort((p, q) => q.base - p.base || p.left - q.left);
    type Line = { parts: Placed[]; base: number; left: number; right: number; size: number };
    const lines: Line[] = [];
    for (const p of sorted) {
      const line = lines.find((l) => Math.abs(l.base - p.base) < 0.35 * Math.max(l.size, p.size) && p.left - l.right < 1.0 * p.size && p.right - l.left > -1.0 * p.size && Math.abs(l.size - p.size) < 0.5 * p.size);
      if (line) {
        line.parts.push(p);
        line.left = Math.min(line.left, p.left);
        line.right = Math.max(line.right, p.right);
      } else lines.push({ parts: [p], base: p.base, left: p.left, right: p.right, size: p.size });
    }
    for (const l of lines) l.parts.sort((p, q) => p.left - q.left);
    lines.sort((p, q) => q.base - p.base || p.left - q.left);
    // A short line sharing its baseline with another is a table cell (or a
    // label beside a value): its column isn't a paragraph.
    const cell = (l: Line) => l.right - l.left < 14 * l.size && lines.some((o) => o !== l && Math.abs(o.base - l.base) < 0.35 * l.size);
    const styleOf = (l: Line) => {
      const p = l.parts[0];
      return `${p.o.text!.font}|${p.size.toFixed(1)}|${p.o.fill?.join(",")}`;
    };
    const textOf = (l: Line) => l.parts.reduce((s, p, i) => {
      const t = p.o.text!.text;
      if (!i) return t;
      const gap = p.left - l.parts[i - 1].right;
      return s + (gap > 0.2 * p.size && !/\s$/.test(s) && !/^\s/.test(t) ? " " : "") + t;
    }, "");
    // Paragraphs, top to bottom.
    type Para = { lines: Line[]; style: string; left: number; right: number; gap: number; size: number };
    const paras: Para[] = [];
    for (const l of lines) {
      const style = styleOf(l);
      const text = textOf(l);
      const p = paras.findLast((q) => {
        const last = q.lines[q.lines.length - 1];
        const g = last.base - l.base;
        if (q.style !== style || g < 0.9 * q.size || g > 2.1 * q.size) return false;
        if (q.gap && Math.abs(g - q.gap) > 0.25 * q.gap) return false;
        if (l.right < q.left || l.left > q.right) return false;
        if (START.test(text) || l.left > q.left + q.size) return false;
        if (cell(l) || cell(last)) return false;
        return true;
      });
      if (p) {
        p.gap ||= p.lines[p.lines.length - 1].base - l.base;
        p.lines.push(l);
        p.left = Math.min(p.left, l.left);
        p.right = Math.max(p.right, l.right);
      } else paras.push({ lines: [l], style, left: l.left, right: l.right, gap: 0, size: l.size });
    }
    for (const q of paras) {
      const parts = q.lines.flatMap((l) => l.parts);
      // Lines joined with a space, a word broken by a hyphen at a line end joined again.
      const text = q.lines.map(textOf).reduce((s, t, i) => (!i ? t : /\p{L}-$/u.test(s) && /^\p{Ll}/u.test(t) ? s.slice(0, -1) + t : `${s.replace(/\s+$/, "")} ${t.replace(/^\s+/, "")}`), "");
      const boxes = parts.map((p) => p.box);
      const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
      const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
      const first = parts[0];
      const tol = 1.5;
      const body = q.lines.length > 2 ? q.lines.slice(0, -1) : q.lines;
      const sameLeft = body.every((l) => Math.abs(l.left - q.left) < tol), sameRight = body.every((l) => Math.abs(l.right - q.right) < tol);
      const sameMid = body.every((l) => Math.abs((l.left + l.right) / 2 - (q.left + q.right) / 2) < tol);
      out.push({
        parts: parts.map((p) => ({ index: p.o.index, sig: p.o.sig })),
        text, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, angle: first.angle,
        font: first.o.text!.font, size: first.size, color: hexOf(first.o.fill) ?? "#000000",
        bold: first.o.text!.bold, italic: first.o.text!.italic,
        align: q.lines.length < 2 ? "left" : sameLeft && sameRight && q.lines.length > 2 ? "justify" : sameLeft ? "left" : sameRight ? "right" : sameMid ? "center" : "left",
        lines: q.lines.length,
        mixed: new Set(parts.map((p) => `${p.o.text!.font}|${p.size.toFixed(1)}|${p.o.fill?.join(",")}`)).size > 1,
        invisible: parts.every((p) => p.o.text!.mode === 3),
      });
    }
  }
  return out.sort((p, q) => p.box.y - q.box.y || p.box.x - q.box.x);
}

// 3×3 affine matrices as [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f.
type Mat = [number, number, number, number, number, number];
const mul = (p: Mat, q: Mat): Mat => [
  p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
];
const inv = (p: Mat): Mat => {
  const det = p[0] * p[3] - p[1] * p[2];
  return [p[3] / det, -p[1] / det, -p[2] / det, p[0] / det, (p[2] * p[5] - p[3] * p[4]) / det, (p[1] * p[4] - p[0] * p[5]) / det];
};

// The user-space transform that takes what's in `from` (visual fractions) to
// `to`, turned `rotate` degrees counter-clockwise about its centre on screen
// and flipped as asked: what moving, resizing, rotating and flipping an
// object on screen does to it in the file.
export function boxTransform(g: PageGeom, from: FracRect, to: FracRect, rotate = 0, flipX = false, flipY = false): number[] {
  const f = frameOf(g);
  // Visual points, y up from the bottom-left.
  const fx = from.x * f.vw, fy = (1 - from.y - from.h) * f.vh, fw = from.w * f.vw, fh = from.h * f.vh;
  const tx = to.x * f.vw, ty = (1 - to.y - to.h) * f.vh, tw = to.w * f.vw, th = to.h * f.vh;
  const sx = fw ? tw / fw : 1, sy = fh ? th / fh : 1;
  const cx = tx + tw / 2, cy = ty + th / 2;
  const r = (rotate * Math.PI) / 180;
  let v: Mat = [1, 0, 0, 1, -fx, -fy];
  v = mul([sx, 0, 0, sy, 0, 0], v);
  v = mul([1, 0, 0, 1, tx, ty], v);
  // Flips and rotation about the new box's centre.
  v = mul([1, 0, 0, 1, -cx, -cy], v);
  v = mul([flipX ? -1 : 1, 0, 0, flipY ? -1 : 1, 0, 0], v);
  v = mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0], v);
  v = mul([1, 0, 0, 1, cx, cy], v);
  // Visual → user space and back.
  const [ox, oy] = f.map(0, 0);
  const M: Mat = [f.u[0], f.u[1], f.v[0], f.v[1], ox, oy];
  return mul(mul(M, v), inv(M));
}

// A JPEG's size from its header (SOFn), or null.
export function jpegSize(b: Uint8Array): [number, number] | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
    i += 2 + len;
  }
  return null;
}

// A replacement picture for objects.ts, upright (a phone photo's EXIF
// turn applied): a plain JPEG as it is, anything else (PNG, WebP, HEIC,
// TIFF, a CMYK JPEG, which some readers draw inverted) as pixels, at most
// 4096 on a side.
async function newImage(dataUrl: string): Promise<import("./objects").NewImage> {
  const { pdfImages, jpegInfo } = await import("./images");
  let bytes: Uint8Array = dataUrlBytes(dataUrl).bytes;
  const plain = (b: Uint8Array) => {
    const i = jpegInfo(b);
    return i && i.orientation === 1 && i.components === 3 ? i : null;
  };
  let info = plain(bytes);
  if (info) return { jpeg: bytes, width: info.width, height: info.height };
  for await (const img of pdfImages(new Blob([bytes as BlobPart]), { upright: true })) {
    bytes = img.bytes;
    break;
  }
  info = plain(bytes);
  if (info) return { jpeg: bytes, width: info.width, height: info.height };
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  const scale = Math.min(1, 4096 / Math.max(bmp.width, bmp.height));
  const [width, height] = [Math.max(1, Math.round(bmp.width * scale)), Math.max(1, Math.round(bmp.height * scale))];
  const c = document.createElement("canvas");
  [c.width, c.height] = [width, height];
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  c.width = c.height = 0;
  const bgra = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) [bgra[i], bgra[i + 1], bgra[i + 2], bgra[i + 3]] = [rgba[i + 2], rgba[i + 1], rgba[i], rgba[i + 3]];
  return { bgra, width, height };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
const sameBox = (a: FracRect, b: { x: number; y: number; w?: number; h?: number }) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w ?? a.w) && near(a.h, b.h ?? a.h);

// The editor's changes to the page's own content, applied to the file.
async function applyContent(file: File, items: EditorItem[]) {
  const { editContent } = await import("./objects");
  // Replacement pictures are decoded first: the change list is built synchronously per page.
  const pictures = new Map<string, import("./objects").NewImage>();
  for (const it of items) if (it.kind === "objEdit" && it.image) pictures.set(it.id, await newImage(it.image));
  const pages = [...new Set(items.map((i) => i.page))];
  const forPage = (page: number, geom: PageGeom) => {
    const objects: import("./objects").ObjectChange[] = [];
    const texts: import("./objects").TextChange[] = [];
    const paragraphs: import("./objects").ParagraphChange[] = [];
    const erase: import("./objects").Erase[] = [];
    for (const it of items.filter((i) => i.page === page)) {
      if (it.kind === "whiteout" || it.kind === "scanEdit" || it.kind === "erase") {
        const r = it.kind === "scanEdit" ? { x: it.source!.x, y: it.source!.y, w: it.source!.w ?? it.w, h: it.source!.h ?? it.h } : it;
        const fill = it.kind === "scanEdit" && it.fill ? rgbaOf(it.fill) : it.kind === "erase" ? ("around" as const) : undefined;
        erase.push({ box: userBox(geom, r), ...(fill ? { fill } : {}) });
        continue;
      }
      const src = it.source!;
      const from = { x: src.x, y: src.y, w: src.w ?? it.w, h: src.h ?? it.h };
      const box = { x: it.x, y: it.y, w: it.w, h: it.h };
      if (it.kind === "objEdit") {
        const target = { page, index: src.index, sig: src.sig! };
        if (it.removed) {
          objects.push({ ...target, remove: true });
          continue;
        }
        const c: import("./objects").ObjectChange = { ...target };
        if (!sameBox(from, box) || it.rotate || it.flipX || it.flipY) c.transform = boxTransform(geom, from, box, it.rotate ?? 0, it.flipX, it.flipY);
        if (it.fill && it.fill !== src.fill) c.fill = rgbaOf(it.fill);
        if (it.color && it.color !== src.color) c.stroke = rgbaOf(it.color);
        if (it.stroke !== undefined && it.stroke !== src.stroke) c.strokeWidth = it.stroke;
        if (pictures.has(it.id)) c.image = pictures.get(it.id);
        if (it.order) c.order = it.order;
        objects.push(c);
        continue;
      }
      // Text: a paragraph (paraEdit), or one object as listText gave it (textEdit).
      const parts = src.parts ?? [{ index: src.index, sig: src.sig ?? "" }];
      const text = it.text ?? "";
      const moved = !near(it.x, src.x) || !near(it.y, src.y);
      const move = moved ? moveDelta(geom, [it.x - src.x, it.y - src.y]) : undefined;
      const fill = it.color && it.color !== src.color ? rgbaOf(it.color) : undefined;
      if (it.removed || !text.trim()) {
        for (const p of parts) objects.push({ page, ...p, remove: true });
        continue;
      }
      const scale = it.fontSize && src.size ? it.fontSize / src.size : 1;
      const rewrap = !near(it.w, src.w ?? it.w) || (it.align && it.align !== src.align) || !near(scale, 1) || text.includes("\n");
      if (text === src.was && !rewrap) {
        // Moved or recoloured only: each part keeps its exact text and font.
        for (const p of parts) objects.push({ page, ...p, ...(move ? { transform: [1, 0, 0, 1, move[0], move[1]] } : {}), ...(fill ? { fill } : {}) });
        continue;
      }
      if (parts.length === 1 && !rewrap) {
        texts.push({ page, ...parts[0], text, move, fill, was: src.parts ? undefined : src.was });
        continue;
      }
      // Width along the text: the box's side that runs with it.
      const f = frameOf(geom);
      const upright = Math.abs(Math.sin(((src.angle ?? 0) * Math.PI) / 180)) < 0.5;
      const width = !near(it.w, src.w ?? it.w) || !near(it.h, src.h ?? it.h) ? (upright ? it.w * f.vw : it.h * f.vh) : undefined;
      paragraphs.push({ page, parts, text, move, scale, width, fill, align: it.align });
    }
    return { objects, texts, paragraphs, erase };
  };
  let out;
  try {
    out = await editContent(await contentBytes(file), pages, forPage, fallbackRuns);
  } catch (e) {
    throw e instanceof PdfError ? e : new PdfError("damaged", file.name, e);
  }
  if (out.results.some((r) => r.error)) throw new PdfError("text_edit_failed", file.name, out.results.filter((r) => r.error));
  const swaps = [...new Set(out.results.filter((r) => r.fallback?.length).map((r) => `${r.font} → ${r.fallback!.join(", ")}`))];
  return { bytes: out.bytes, note: swaps.length ? `textFallback:${swaps.join("; ")}` : undefined };
}

// ── Forms
export type FieldInfo = {
  name: string;
  type: "text" | "checkbox" | "dropdown" | "radio" | "list" | "date" | "signature" | "other";
  value: string | boolean | string[];
  options?: string[];
  multiline?: boolean;
  required?: boolean;
  tooltip?: string;
  dateFormat?: DateFormat;
  page: number;
  rect?: { x: number; y: number; w: number; h: number }; // visual fractions
};

export async function readFields(file: File): Promise<FieldInfo[]> {
  const doc = await loadPdf(file, file.name);
  const pages = doc.getPages();
  const form = doc.getForm();
  return form.getFields().map((field) => {
    const widget = field.acroField.getWidgets()[0];
    let page = 0;
    let rect: FieldInfo["rect"];
    if (widget) {
      const pRef = widget.P();
      const idx = pRef ? pages.findIndex((p) => p.ref === pRef) : -1;
      page = idx >= 0 ? idx : pages.findIndex((p) => (p.node.Annots()?.asArray() ?? []).some((a) => a === widget.dict || doc.context.lookup(a) === widget.dict));
      page = Math.max(0, page);
      const r = widget.getRectangle();
      const f = visualFrame(pages[page]);
      const box = viewBox(pages[page]);
      // Approximate for unrotated pages; rotated pages fall back to the side list.
      if (f.rot === 0) rect = { x: (r.x - box.x) / f.vw, y: 1 - (r.y - box.y + r.height) / f.vh, w: r.width / f.vw, h: r.height / f.vh };
    }
    const tu = field.acroField.dict.lookup(PDFName.of("TU"));
    const tooltip = tu instanceof PDFString || tu instanceof PDFHexString ? tu.decodeText() : undefined;
    const base = { name: field.getName(), page, rect, required: field.isRequired(), tooltip };
    if (field instanceof PDFTextField) {
      const dateFormat = dateFormatOf(tooltip);
      if (dateFormat) return { ...base, type: "date", value: field.getText() ?? "", dateFormat };
      return { ...base, type: "text", value: field.getText() ?? "", multiline: field.isMultiline() };
    }
    if (field instanceof PDFCheckBox) return { ...base, type: "checkbox", value: field.isChecked() };
    if (field instanceof PDFDropdown) return { ...base, type: "dropdown", value: field.getSelected()[0] ?? "", options: field.getOptions() };
    if (field instanceof PDFOptionList) return { ...base, type: "list", value: field.getSelected(), options: field.getOptions() };
    if (field instanceof PDFRadioGroup) return { ...base, type: "radio", value: field.getSelected() ?? "", options: field.getOptions() };
    if (field instanceof PDFSignature) return { ...base, type: "signature", value: "" };
    return { ...base, type: "other", value: "" };
  });
}

export async function fillForm(
  file: File, values: Record<string, string | boolean | string[]>, newItems: EditorItem[], flatten: boolean,
): Promise<Output[]> {
  const doc = await loadPdf(file, file.name);
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field) continue;
    try {
      if (field instanceof PDFTextField) field.setText(String(value));
      else if (field instanceof PDFCheckBox) {
        if (value) field.check();
        else field.uncheck();
      }
      else if (field instanceof PDFDropdown && value) field.select(String(value));
      else if (field instanceof PDFOptionList && Array.isArray(value)) field.select(value);
      else if (field instanceof PDFRadioGroup && value) field.select(String(value));
    } catch {
      // A value the field rejects (bad option, too long) is skipped, not fatal.
    }
  }
  await applyItems(doc, newItems);
  // Helvetica can only draw Western European text. Give each field that shows
  // anything else a bundled font that covers all of it.
  for (const field of form.getFields()) {
    const shown = field instanceof PDFTextField ? [field.getText() ?? ""]
      : field instanceof PDFDropdown ? field.getSelected()
      : field instanceof PDFOptionList ? field.getOptions()
      : [];
    const text = shown.join(" ");
    if (isWinAnsi(text) || !field.needsAppearancesUpdate()) continue;
    const covering = await fontCovering(doc, text).catch(() => null);
    if (!covering) continue;
    try {
      (field as PDFTextField | PDFDropdown | PDFOptionList).updateAppearances(covering);
    } catch {
      // Left dirty; handled by the fallback below.
    }
  }
  try {
    form.updateFieldAppearances(font);
  } catch {
    // Non-WinAnsi values keep the viewer-generated appearance (NeedAppearances).
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), doc.context.obj(true));
  }
  if (flatten) form.flatten();
  return [{ name: `${baseName(file.name)}-filled.pdf`, blob: await save(doc) }];
}

