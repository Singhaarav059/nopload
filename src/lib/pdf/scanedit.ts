"use client";

// Editing a scanned page's text (Edit PDF's Edit content tool): the page is
// read with OCR, line by line, each line with its box on the page, its size,
// and the colours of its ink and of the paper behind it, so a retyped line
// can empty its old place to the paper's colour and be drawn in the ink's.

import type { FracRect } from "./edit";
import type { Family } from "./fonts";

export type ScanLine = { key: string; text: string; box: FracRect; size: number; ink: string; paper: string; family: Family };

// Rendered at up to 300 dpi: enough for Tesseract, and colours sampled from it.
const DPI = 300;

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

// `turned`: the page reads sideways or upside down, which this can't retype.
export async function scanLines(file: File, pageIndex: number, lang: string, signal?: AbortSignal): Promise<{ lines: ScanLine[]; turned: boolean }> {
  const [{ docFor }, { renderPage }, { engine, readPage }, { grayOf }] = await Promise.all([import("./thumbs"), import("./common"), import("./ocr"), import("./ocrprep")]);
  const page = await (await docFor(file)).getPage(pageIndex + 1);
  const canvas = await renderPage(page, DPI / 72, "#ffffff", { signal });
  const W = canvas.width, H = canvas.height;
  const rgba = canvas.getContext("2d")!.getImageData(0, 0, W, H);
  canvas.width = canvas.height = 0;
  // Pixels per point, as drawn (fitScale may have drawn a poster smaller).
  const scale = W / page.getViewport({ scale: 1 }).width;
  const { recognise, stop } = await engine.create(lang, 1, signal);
  let read;
  try {
    read = await readPage(recognise, grayOf(rgba));
  } finally {
    await stop();
  }
  if (read.turns) return { lines: [], turned: true };

  const byLine = new Map<number, typeof read.words>();
  for (const w of read.words) byLine.set(w.line, [...(byLine.get(w.line) ?? []), w]);
  const lines: ScanLine[] = [];
  for (const [n, words] of byLine) {
    // Corners: baseline start, baseline end, top of the start (image pixels).
    const x0 = Math.min(...words.map((w) => w.corners[0][0])), x1 = Math.max(...words.map((w) => w.corners[1][0]));
    const top = Math.min(...words.map((w) => w.corners[2][1]));
    const base = Math.max(...words.map((w) => (w.corners[0][1] + w.corners[1][1]) / 2));
    const rise = base - top;
    if (rise < 3 || x1 <= x0) continue;
    // The tallest letters stand about three quarters of the type size above the baseline; descenders go a fifth below.
    const sizePx = rise / 0.75;
    const pad = Math.max(1, sizePx * 0.06);
    const bx0 = Math.max(0, x0 - pad), bx1 = Math.min(W, x1 + pad);
    const by0 = Math.max(0, top - pad), by1 = Math.min(H, base + sizePx * 0.22 + pad);
    const { ink, paper } = colours(rgba, bx0, by0, bx1, by1);
    lines.push({
      key: `scan${pageIndex}:${n}`,
      text: words.map((w) => w.text).join(" "),
      box: { x: bx0 / W, y: by0 / H, w: (bx1 - bx0) / W, h: (by1 - by0) / H },
      size: Math.round((sizePx / scale) * 2) / 2,
      ink, paper, family: "arimo",
    });
  }
  return { lines: lines.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x), turned: false };
}

// The ink: the darkest twentieth of the line's pixels; the paper: the lightest half.
function colours(img: ImageData, x0: number, y0: number, x1: number, y1: number) {
  const px: [number, number, number, number][] = [];
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 40000)));
  for (let y = Math.floor(y0); y < y1; y += step)
    for (let x = Math.floor(x0); x < x1; x += step) {
      const i = (y * img.width + x) * 4;
      const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      px.push([0.299 * r + 0.587 * g + 0.114 * b, r, g, b]);
    }
  px.sort((a, b) => a[0] - b[0]);
  const avg = (list: typeof px) => {
    const n = Math.max(1, list.length);
    return hex(list.reduce((s, p) => s + p[1], 0) / n, list.reduce((s, p) => s + p[2], 0) / n, list.reduce((s, p) => s + p[3], 0) / n);
  };
  return { ink: avg(px.slice(0, Math.max(1, Math.round(px.length / 20)))), paper: avg(px.slice(Math.floor(px.length / 2))) };
}
