// ── Editing anything on a page
// Every top-level object of a page through PDFium: text, paths (lines,
// shapes, fills), images, shadings and form XObjects (grouped content, often
// a logo or a whole imported page). Each can be moved, resized, rotated,
// recoloured, put in front or behind, or deleted; an image can be replaced;
// the text of a paragraph (several text objects, line by line) can be set
// again, wrapped to its width in its own font. All changes to a file are
// made in one pass: every target is found by index and checked against what
// was listed before anything changes, so one change can't move another's
// target. FPDFPage_GenerateContent then writes each changed page's content
// again, so nothing removed or replaced is left in it.

import {
  canSetText, fontCovers, fontInfo, geomOf, openDoc, saveDoc, textObjectAt, values, withWide,
  type Box, type Fallback, type FallbackRun, type Mem, type PageGeom,
} from "./pdfium";

export type ObjKind = "text" | "path" | "image" | "shading" | "form";
const KINDS: Record<number, ObjKind> = { 1: "text", 2: "path", 3: "image", 4: "shading", 5: "form" };
export type RGBA = [number, number, number, number];

export type PageObject = {
  index: number; // among the page's top-level objects, back to front
  kind: ObjKind;
  bounds: Box; // user space
  matrix: number[]; // a b c d e f
  // What it was listed as: a change whose target no longer matches is refused.
  sig: string;
  fill: RGBA | null; // text and filled paths
  stroke: RGBA | null; // stroked paths and outlined text
  strokeWidth: number;
  pixels?: [number, number]; // images
  text?: { text: string; font: string; size: number; bold: boolean; italic: boolean; mode: number };
};

const sigOf = (kind: ObjKind, b: Box) => `${kind}:${[b.x0, b.y0, b.x1, b.y1].map((v) => v.toFixed(1)).join(",")}`;

function readObject(x: Mem, page: number, textPage: number, index: number): (PageObject & { handle: number }) | null {
  const { m } = x;
  const o = m.FPDFPage_GetObject(page, index);
  const kind = o ? KINDS[m.FPDFPageObj_GetType(o) as number] : undefined;
  if (!o || !kind) return null;
  const b = values(x, 4, "float", (p) => m.FPDFPageObj_GetBounds(o, p, p + 4, p + 8, p + 12)) ?? [0, 0, 0, 0];
  const bounds = { x0: b[0], y0: b[1], x1: b[2], y1: b[3] };
  const color = (get: (o: number, r: number, g: number, b: number, a: number) => unknown) => values(x, 4, "i32", (p) => get(o, p, p + 4, p + 8, p + 12)) as RGBA | null;
  let fill: RGBA | null = null, stroke: RGBA | null = null;
  if (kind === "text" || kind === "path") {
    fill = color(m.FPDFPageObj_GetFillColor);
    stroke = color(m.FPDFPageObj_GetStrokeColor);
  }
  if (kind === "path") {
    // Fill mode 0 is none; the stroke flag says whether it's outlined.
    const mode = values(x, 2, "i32", (p) => m.FPDFPath_GetDrawMode(o, p, p + 4));
    if (mode && !mode[0]) fill = null;
    if (mode && !mode[1]) stroke = null;
  }
  const obj: PageObject & { handle: number } = {
    handle: o, index, kind, bounds, sig: sigOf(kind, bounds), fill, stroke,
    matrix: values(x, 6, "float", (p) => m.FPDFPageObj_GetMatrix(o, p)) ?? [1, 0, 0, 1, 0, 0],
    strokeWidth: values(x, 1, "float", (p) => m.FPDFPageObj_GetStrokeWidth(o, p))?.[0] ?? 0,
  };
  if (kind === "image") {
    const px = values(x, 2, "i32", (p) => m.FPDFImageObj_GetImagePixelSize(o, p, p + 4));
    if (px) obj.pixels = [px[0] >>> 0, px[1] >>> 0];
  }
  if (kind === "text") {
    const t = textObjectAt(x, page, textPage, index);
    if (t) obj.text = { text: t.text, font: t.font, size: t.size, bold: t.bold, italic: t.italic, mode: m.FPDFTextObj_GetTextRenderMode(o) as number };
  }
  return obj;
}

// The page's objects, back to front, with its geometry. Text objects with no
// visible characters and objects with no area are left out.
export async function pageObjects(bytes: Uint8Array, pageIndex: number): Promise<{ geom: PageGeom; objects: PageObject[] }> {
  const { x, doc, close } = await openDoc(bytes);
  const { m } = x;
  try {
    const page = m.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`PDFium could not load page ${pageIndex + 1}`);
    const textPage = m.FPDFText_LoadPage(page);
    try {
      const objects: PageObject[] = [];
      const n = m.FPDFPage_CountObjects(page) as number;
      for (let i = 0; i < n; i++) {
        const o = readObject(x, page, textPage, i);
        if (!o) continue;
        if (o.kind === "text" && !o.text?.text.trim()) continue;
        if (o.bounds.x1 - o.bounds.x0 <= 0 && o.bounds.y1 - o.bounds.y0 <= 0) continue;
        const { handle: _h, ...rest } = o; // eslint-disable-line @typescript-eslint/no-unused-vars
        objects.push(rest);
      }
      return { geom: geomOf(x, page), objects };
    } finally {
      m.FPDFText_ClosePage(textPage);
      m.FPDF_ClosePage(page);
    }
  } finally {
    close();
  }
}

// Whether PDFium opens the file and its first page.
export async function pdfiumOpens(bytes: Uint8Array): Promise<boolean> {
  try {
    const { x, doc, close } = await openDoc(bytes);
    try {
      const page = x.m.FPDF_LoadPage(doc, 0);
      if (!page) return false;
      x.m.FPDF_ClosePage(page);
      return true;
    } finally {
      close();
    }
  } catch {
    return false;
  }
}

// ── Changes

export type Target = { index: number; sig: string };
// A replacement picture: a JPEG goes in as it is; anything else as pixels
// (BGRA, which keeps transparency).
export type NewImage = { jpeg: Uint8Array; width: number; height: number } | { bgra: Uint8Array; width: number; height: number };

export type ObjectChange = Target & {
  page: number;
  remove?: boolean;
  transform?: number[]; // user space, applied on top of the object's own matrix
  fill?: RGBA;
  stroke?: RGBA;
  strokeWidth?: number;
  image?: NewImage;
  order?: "front" | "back";
};

// New text for one text object, in place: the object keeps its font, spacing
// and position when the font has the glyphs, else it is replaced by objects
// in bundled fonts. "" deletes it.
export type TextChange = Target & { page: number; text: string; move?: number[]; fill?: RGBA; was?: string };

// New text for a paragraph: its text objects are replaced by lines set in
// the first object's font (or bundled fonts where it lacks glyphs), wrapped
// to the paragraph's width, at its line spacing and alignment. `width` (user
// space points) re-wraps it to a new width; `scale` scales the type; `move`
// (user space) shifts it; "\n" starts a new line.
export type ParagraphChange = {
  page: number;
  parts: Target[];
  text: string;
  move?: number[];
  scale?: number;
  width?: number;
  fill?: RGBA;
  align?: Align;
};
export type Align = "left" | "center" | "right" | "justify";

export type ContentResult = {
  page: number;
  index: number;
  font?: string;
  fallback?: string[]; // bundled fonts used instead of `font`
  error?: "changed" | "script" | "glyphs" | "page" | "image";
};

// What's the same whatever the text: a paragraph's frame, read from its objects.
export type Frame = {
  // Unit vectors along the baseline and up from it, user space.
  dir: [number, number];
  up: [number, number];
  // The first line's baseline at the paragraph's left edge, user space.
  origin: [number, number];
  width: number; // along the baseline
  gap: number; // between baselines
  align: Align;
  scale: number; // the text matrix's scale: user points per text-space point
};

type Live = { handle: number; matrix: number[]; size: number; font: number; fill: RGBA; stroke: RGBA | null; mode: number; text: string; bounds: Box };


const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1];

// The paragraph's frame from its objects (at least one). `size` is the first
// object's font size, for the line spacing of a one-line paragraph.
export function frameOf(parts: { matrix: number[]; bounds: Box; size?: number }[]): Frame {
  const [a, b, c, d] = parts[0].matrix;
  const scale = Math.hypot(a, b) || 1;
  const dir: [number, number] = [a / scale, b / scale];
  // Up is perpendicular to the baseline, on the side the text's y axis points.
  const cross = a * d - b * c;
  const up: [number, number] = cross >= 0 ? [-dir[1], dir[0]] : [dir[1], -dir[0]];
  // Each object's baseline origin and extent along the baseline.
  const lines = parts.map((p) => {
    const corners = [[p.bounds.x0, p.bounds.y0], [p.bounds.x1, p.bounds.y0], [p.bounds.x0, p.bounds.y1], [p.bounds.x1, p.bounds.y1]];
    const along = corners.map((q) => dot(q, dir));
    return { base: dot([p.matrix[4], p.matrix[5]], up), left: Math.min(...along), right: Math.max(...along) };
  });
  // Objects on one baseline make one line.
  const sorted = [...lines].sort((p, q) => q.base - p.base);
  const rows: { base: number; left: number; right: number }[] = [];
  for (const l of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.base - l.base) < 2) {
      row.left = Math.min(row.left, l.left);
      row.right = Math.max(row.right, l.right);
    } else rows.push({ ...l });
  }
  const left = Math.min(...rows.map((r) => r.left));
  const right = Math.max(...rows.map((r) => r.right));
  const gaps = rows.slice(1).map((r, i) => rows[i].base - r.base).sort((p, q) => p - q);
  const size = (parts[0].size ?? 12) * scale;
  const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  // Alignment: which edge the lines share (the last line is often short).
  const body = rows.length > 2 ? rows.slice(0, -1) : rows;
  const tol = 1.5;
  const sameLeft = body.every((r) => Math.abs(r.left - left) < tol);
  const sameRight = body.every((r) => Math.abs(r.right - right) < tol);
  const mids = body.map((r) => (r.left + r.right) / 2);
  const sameMid = mids.every((v) => Math.abs(v - (left + right) / 2) < tol);
  const align: Align = rows.length < 2 ? "left" : sameLeft && sameRight && rows.length > 2 ? "justify" : sameLeft ? "left" : sameRight ? "right" : sameMid ? "center" : "left";
  const top = rows[0].base;
  return {
    dir, up, scale, align, width: right - left,
    gap: gap || size * 1.2,
    origin: [dir[0] * left + up[0] * top, dir[1] * left + up[1] * top],
  };
}

// Lines of `text` no wider than `width`: words at spaces, and anywhere in
// scripts written without them. `w` measures a string.
export function wrap(text: string, width: number, w: (s: string) => number): string[][] {
  const out: string[][] = [];
  for (const para of text.split("\n")) {
    const words = para.match(/[⺀-鿿가-힯豈-﫿＀-￯]|[^\s⺀-鿿가-힯豈-﫿＀-￯]+/g) ?? [];
    let line: string[] = [];
    const flush = () => {
      out.push(line);
      line = [];
    };
    for (let word of words) {
      // A word longer than the line is cut where it must be.
      while (w(word) > width && word.length > 1) {
        let n = word.length - 1;
        while (n > 1 && w(word.slice(0, n)) > width) n--;
        if (line.length) flush();
        line.push(word.slice(0, n));
        flush();
        word = word.slice(n);
      }
      const next = [...line, word];
      if (line.length && w(joinWords(next)) > width) flush();
      line.push(word);
    }
    flush();
    // A paragraph's end is marked for justification (its last line isn't justified).
    (out[out.length - 1] as string[] & { last?: boolean }).last = true;
  }
  return out;
}

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯]/;
// Words of a line joined as they'll be shown: a space between words, none
// next to a CJK character.
export const joinWords = (words: string[]) => words.reduce((s, w, i) => (i && !CJK.test(w[0]) && !CJK.test(words[i - 1].slice(-1)) ? `${s} ${w}` : s + w), "");

// Sets the change's text as new objects in the paragraph's place.
async function typeset(
  x: Mem, doc: number, page: number, parts: Live[], c: ParagraphChange, frame: Frame,
  fonts: { font: number; name: string; covers: (t: string) => boolean }, fallback: Fallback, loadFont: (run: FallbackRun) => Promise<number>,
): Promise<{ made: number[]; fallback?: string[] } | null> {
  const { m } = x;
  const first = parts[0];
  const size = first.size * (c.scale ?? 1);
  const scale = frame.scale;
  const width = c.width ?? frame.width;
  const gap = frame.gap * (c.scale ?? 1);
  const align = c.align ?? frame.align;
  const text = c.text.replace(/\r/g, "");
  // Which font draws each character: the paragraph's own, else bundled runs
  // (a character always gets the same font, so a map is enough).
  const plain = text.replace(/\n/g, " ");
  const charFont = new Map<string, number>();
  let used: string[] | undefined;
  if (!fonts.covers(plain)) {
    const runs = await fallback(plain, fontInfo(x, fonts.font));
    if (!runs) return null;
    for (const r of runs) {
      const f = await loadFont(r);
      if (!f) return null;
      for (const ch of Array.from(r.text)) charFont.set(ch, f);
    }
    used = [...new Set(runs.map((r) => r.name))];
  }
  const advance = (font: number, ch: string) => (values(x, 1, "float", (p) => m.FPDFFont_GetGlyphWidth(font, ch.codePointAt(0)!, size, p))?.[0] ?? size * 0.5) * scale;
  // Widths by character and font: the wrap measures many substrings.
  const cache = new Map<string, number>();
  const measure = (s: string) => {
    let total = 0;
    for (const ch of Array.from(s)) {
      const f = charFont.get(ch) ?? fonts.font;
      const k = `${f}:${ch}`;
      let v = cache.get(k);
      if (v === undefined) cache.set(k, (v = advance(f, ch)));
      total += v;
    }
    return total;
  };
  const lines = wrap(text, width, measure);
  const matrix = first.matrix.slice(0, 4);
  const fill = c.fill ?? first.fill;
  const made: number[] = [];
  const put = (s: string, at: [number, number]) => {
    // Runs of one font, each its own object.
    let pos = at;
    let run = "";
    let runFont = -1;
    const emit = () => {
      if (!run) return true;
      const obj = m.FPDFPageObj_CreateTextObj(doc, runFont, size) as number;
      if (!obj || !withWide(x, run, (p) => m.FPDFText_SetText(obj, p))) {
        if (obj) m.FPDFPageObj_Destroy(obj);
        return false;
      }
      const mp = x.malloc(24);
      [...matrix, pos[0], pos[1]].forEach((v, i) => m.pdfium.setValue(mp + 4 * i, v, "float"));
      m.FPDFPageObj_SetMatrix(obj, mp);
      x.free(mp);
      m.FPDFPageObj_SetFillColor(obj, ...fill);
      if (first.stroke) m.FPDFPageObj_SetStrokeColor(obj, ...first.stroke);
      if (first.mode >= 0) m.FPDFTextObj_SetTextRenderMode(obj, first.mode);
      made.push(obj);
      const wv = measure(run);
      pos = [pos[0] + frame.dir[0] * wv, pos[1] + frame.dir[1] * wv];
      run = "";
      return true;
    };
    for (const ch of Array.from(s)) {
      const f = charFont.get(ch) ?? fonts.font;
      if (f !== runFont && run) if (!emit()) return false;
      runFont = f;
      run += ch;
    }
    return emit();
  };
  const [ox, oy] = c.move ? [frame.origin[0] + c.move[0], frame.origin[1] + c.move[1]] : frame.origin;
  for (const [li, words] of lines.entries()) {
    if (!words.length) continue;
    const base: [number, number] = [ox - frame.up[0] * gap * li, oy - frame.up[1] * gap * li];
    const at = (offset: number): [number, number] => [base[0] + frame.dir[0] * offset, base[1] + frame.dir[1] * offset];
    const last = (words as string[] & { last?: boolean }).last;
    if (align === "justify" && !last && words.length > 1) {
      // Words placed one by one, the spare width shared between the gaps.
      const total = words.reduce((n, w) => n + measure(w), 0);
      const space = (width - total) / (words.length - 1);
      let offset = 0;
      for (const w of words) {
        if (!put(w, at(offset))) return made.splice(0).forEach((h) => m.FPDFPageObj_Destroy(h)), null;
        offset += measure(w) + space;
      }
      continue;
    }
    const s = joinWords(words);
    const lw = measure(s);
    const offset = align === "center" ? (width - lw) / 2 : align === "right" ? width - lw : 0;
    if (!put(s, at(offset))) return made.splice(0).forEach((h) => m.FPDFPageObj_Destroy(h)), null;
  }
  return { made, fallback: used };
}

// The part of the page that is seen, in user space.
function viewOf(g: PageGeom): Box {
  const m = g.media, c = g.crop;
  const n = (b: Box) => ({ x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1) });
  const mm = n(m);
  if (!c) return mm;
  const cc = n(c);
  const v = { x0: Math.max(cc.x0, mm.x0), y0: Math.max(cc.y0, mm.y0), x1: Math.min(cc.x1, mm.x1), y1: Math.min(cc.y1, mm.y1) };
  return v.x1 > v.x0 && v.y1 > v.y0 ? v : mm;
}

// When a text object (already set to its new text) runs past the seen page
// along its baseline: the width from its start to the page's edge, less a
// small margin, to wrap it in. Null when it fits, or when there's no room
// worth wrapping in.
function roomOnLine(x: Mem, page: number, o: Live, view: Box): number | null {
  const b = values(x, 4, "float", (p) => x.m.FPDFPageObj_GetBounds(o.handle, p, p + 4, p + 8, p + 12));
  if (!b) return null;
  const f = frameOf([o]);
  const corners = (q: Box) => [[q.x0, q.y0], [q.x1, q.y0], [q.x0, q.y1], [q.x1, q.y1]];
  const edge = Math.max(...corners(view).map((p) => dot(p, f.dir)));
  const end = Math.max(...corners({ x0: b[0], y0: b[1], x1: b[2], y1: b[3] }).map((p) => dot(p, f.dir)));
  if (end <= edge + 0.5) return null;
  const room = edge - dot(f.origin, f.dir) - Math.min(2, (edge - dot(f.origin, f.dir)) * 0.02);
  return room > o.size * f.scale ? room : null;
}

// The index of `handle` among the page's objects now, or -1.
function indexOf(x: Mem, page: number, handle: number) {
  const n = x.m.FPDFPage_CountObjects(page) as number;
  for (let i = 0; i < n; i++) if (x.m.FPDFPage_GetObject(page, i) === handle) return i;
  return -1;
}

// Calls `fn` with an FPDF_FILEACCESS that reads `data`, for PDFium functions
// that load a file through callbacks (a JPEG, here).
function withFileAccess<T>(x: Mem, data: Uint8Array, fn: (access: number) => T): T {
  const mod = x.m.pdfium as unknown as { addFunction: (f: (...a: number[]) => number, sig: string) => number; removeFunction: (p: number) => void };
  const buf = x.malloc(data.length);
  x.heap().set(data, buf);
  // int GetBlock(void* param, unsigned long position, unsigned char* pBuf, unsigned long size)
  const getBlock = mod.addFunction((_param: number, position: number, out: number, size: number) => {
    if (position + size > data.length) return 0;
    x.heap().copyWithin(out, buf + position, buf + position + size);
    return 1;
  }, "iiiii");
  // { unsigned long m_FileLen; GetBlock*; void* m_Param } in 32-bit WebAssembly.
  const access = x.malloc(12);
  x.m.pdfium.setValue(access, data.length, "i32");
  x.m.pdfium.setValue(access + 4, getBlock, "i32");
  x.m.pdfium.setValue(access + 8, 0, "i32");
  try {
    return fn(access);
  } finally {
    x.free(access);
    mod.removeFunction(getBlock);
    x.free(buf);
  }
}

function setImage(x: Mem, page: number, handle: number, image: NewImage): boolean {
  const { m } = x;
  const pages = x.malloc(4);
  m.pdfium.setValue(pages, page, "i32");
  try {
    if ("jpeg" in image) {
      if (withFileAccess(x, image.jpeg, (access) => m.FPDFImageObj_LoadJpegFileInline(pages, 1, handle, access))) return true;
      return false;
    }
    const stride = image.width * 4;
    const buf = x.malloc(image.bgra.length);
    x.heap().set(image.bgra, buf);
    // FPDFBitmap_BGRA is 4.
    const bmp = m.FPDFBitmap_CreateEx(image.width, image.height, 4, buf, stride);
    try {
      return Boolean(bmp && m.FPDFImageObj_SetBitmap(pages, 1, handle, bmp));
    } finally {
      if (bmp) m.FPDFBitmap_Destroy(bmp);
      x.free(buf);
    }
  } finally {
    x.free(pages);
  }
}

export type ContentChanges = { objects?: ObjectChange[]; texts?: TextChange[]; paragraphs?: ParagraphChange[] };

// Applies the changes to `pages`, in one pass. `forPage` gives each page's
// changes once its geometry is known (moves made on screen depend on its
// rotation and boxes). Results say which font each text change used, and
// why a change failed.
export async function editContent(
  bytes: Uint8Array, pages: number[], forPage: (page: number, geom: PageGeom) => ContentChanges, fallback: Fallback,
): Promise<{ bytes: Uint8Array; results: ContentResult[] }> {
  const { x, doc, close } = await openDoc(bytes);
  const { m } = x;
  const results: ContentResult[] = [];
  const buffers: number[] = [];
  const loaded = new Map<string, number>();
  const loadFont = async (run: FallbackRun) => {
    let f = loaded.get(run.key);
    if (f === undefined) {
      const data = await run.font();
      const p = x.malloc(data.length);
      x.heap().set(data, p);
      buffers.push(p);
      // FPDF_FONT_TRUETYPE, as a CID font so any character can be encoded.
      f = m.FPDFText_LoadFont(doc, p, data.length, 2, true) as number;
      loaded.set(run.key, f);
    }
    return f;
  };
  try {
    for (const pageIndex of [...new Set(pages)].sort((p, q) => p - q)) {
      const page = m.FPDF_LoadPage(doc, pageIndex);
      if (!page) {
        results.push({ page: pageIndex, index: -1, error: "page" });
        continue;
      }
      const geom = geomOf(x, page);
      const changes = forPage(pageIndex, geom);
      const mine = { objects: changes.objects ?? [], texts: changes.texts ?? [], paragraphs: changes.paragraphs ?? [] };
      const all = [...mine.objects, ...mine.texts, ...mine.paragraphs.flatMap((c) => c.parts.map((p) => ({ ...p, page: c.page })))];
      const tp = m.FPDFText_LoadPage(page);
      try {
        // Every target, found before anything changes.
        const found = new Map<number, (PageObject & { handle: number }) | null>();
        for (const t of all) if (!found.has(t.index)) found.set(t.index, readObject(x, page, tp, t.index));
        const ok = (t: Target) => {
          const o = found.get(t.index);
          // An item from before signatures (listText) is checked by its text instead, where it's used.
          return o && (!t.sig || o.sig === t.sig) ? o : null;
        };
        const live = (t: Target): Live | null => {
          const o = ok(t);
          const raw = o && textObjectAt(x, page, tp, t.index);
          if (!o || !raw) return null;
          return { handle: o.handle, matrix: o.matrix, size: raw.size, font: raw.fontHandle, fill: raw.fill, stroke: o.stroke, mode: o.text?.mode ?? 0, text: raw.text, bounds: o.bounds };
        };
        const gone = new Set<number>();
        const drop = (handle: number) => {
          m.FPDFPage_RemoveObject(page, handle);
          m.FPDFPageObj_Destroy(handle);
          gone.add(handle);
        };

        // Paragraphs: new objects where the first part was, the parts removed.
        for (const c of mine.paragraphs) {
          const parts = c.parts.map(live);
          if (parts.some((p) => !p)) {
            for (const p of c.parts) results.push({ page: pageIndex, index: p.index, error: "changed" });
            continue;
          }
          const ps = parts as Live[];
          if (!canSetText(c.text.replace(/\n/g, " "))) {
            results.push({ page: pageIndex, index: c.parts[0].index, error: "script" });
            continue;
          }
          const frame = frameOf(ps);
          const font = { font: ps[0].font, name: fontInfo(x, ps[0].font).name, covers: (t: string) => fontCovers(x, doc, page, ps[0].font, t) };
          const set = c.text.trim() ? await typeset(x, doc, page, ps, c, frame, font, fallback, loadFont) : { made: [] as number[] };
          if (!set) {
            results.push({ page: pageIndex, index: c.parts[0].index, font: font.name, error: "glyphs" });
            continue;
          }
          const at = Math.min(...ps.map((p) => indexOf(x, page, p.handle)).filter((i) => i >= 0));
          for (const p of ps) drop(p.handle);
          set.made.forEach((obj, k) => m.FPDFPage_InsertObjectAtIndex(page, obj, Math.max(0, at) + k));
          results.push({ page: pageIndex, index: c.parts[0].index, font: font.name, fallback: set.fallback });
        }

        // Text objects changed in place.
        for (const c of mine.texts) {
          const o = live(c);
          if (!o || gone.has(o.handle) || (c.was !== undefined && o.text !== c.was)) {
            results.push({ page: pageIndex, index: c.index, error: "changed" });
            continue;
          }
          const name = fontInfo(x, o.font).name;
          if (!c.text) {
            drop(o.handle);
            results.push({ page: pageIndex, index: c.index, font: name });
            continue;
          }
          if (!canSetText(c.text)) {
            results.push({ page: pageIndex, index: c.index, font: name, error: "script" });
            continue;
          }
          const [dx, dy] = c.move ?? [0, 0];
          if (c.text === o.text || fontCovers(x, doc, page, o.font, c.text)) {
            if (c.text !== o.text && !withWide(x, c.text, (p) => m.FPDFText_SetText(o.handle, p))) {
              results.push({ page: pageIndex, index: c.index, font: name, error: "glyphs" });
              continue;
            }
            // Longer text that would run off the page wraps instead, in the room left on the line.
            const room = c.text !== o.text ? roomOnLine(x, page, o, viewOf(geom)) : null;
            if (room) {
              withWide(x, o.text, (p) => m.FPDFText_SetText(o.handle, p));
              const set = await typeset(x, doc, page, [o], { page: pageIndex, parts: [c], text: c.text, move: c.move, fill: c.fill, width: room }, frameOf([o]),
                { font: o.font, name, covers: (t: string) => fontCovers(x, doc, page, o.font, t) }, fallback, loadFont);
              if (!set) {
                results.push({ page: pageIndex, index: c.index, font: name, error: "glyphs" });
                continue;
              }
              const at = indexOf(x, page, o.handle);
              drop(o.handle);
              set.made.forEach((obj, k) => m.FPDFPage_InsertObjectAtIndex(page, obj, Math.max(0, at) + k));
              results.push({ page: pageIndex, index: c.index, font: name, fallback: set.fallback });
              continue;
            }
            if (dx || dy) m.FPDFPageObj_Transform(o.handle, 1, 0, 0, 1, dx, dy);
            if (c.fill) m.FPDFPageObj_SetFillColor(o.handle, ...c.fill);
            results.push({ page: pageIndex, index: c.index, font: name });
            continue;
          }
          // New objects in bundled fonts, each run starting where the last one's advance ends.
          const runs = await fallback(c.text, fontInfo(x, o.font));
          if (!runs) {
            results.push({ page: pageIndex, index: c.index, font: name, error: "glyphs" });
            continue;
          }
          const [a, b, cc, d, e, f] = o.matrix;
          const made: number[] = [];
          let advance = 0;
          for (const run of runs) {
            const font = await loadFont(run);
            const obj = font ? (m.FPDFPageObj_CreateTextObj(doc, font, o.size) as number) : 0;
            if (!obj || !withWide(x, run.text, (p) => m.FPDFText_SetText(obj, p))) {
              if (obj) m.FPDFPageObj_Destroy(obj);
              made.splice(0).forEach((h) => m.FPDFPageObj_Destroy(h));
              break;
            }
            const mp = x.malloc(24);
            [a, b, cc, d, e + a * advance + dx, f + b * advance + dy].forEach((v, i) => m.pdfium.setValue(mp + 4 * i, v, "float"));
            m.FPDFPageObj_SetMatrix(obj, mp);
            x.free(mp);
            m.FPDFPageObj_SetFillColor(obj, ...(c.fill ?? o.fill));
            if (o.stroke) m.FPDFPageObj_SetStrokeColor(obj, ...o.stroke);
            if (o.mode >= 0) m.FPDFTextObj_SetTextRenderMode(obj, o.mode);
            for (const ch of run.text) advance += values(x, 1, "float", (p) => m.FPDFFont_GetGlyphWidth(font, ch.codePointAt(0)!, o.size, p))?.[0] ?? 0;
            made.push(obj);
          }
          if (made.length !== runs.length) {
            results.push({ page: pageIndex, index: c.index, font: name, error: "glyphs" });
            continue;
          }
          const at = indexOf(x, page, o.handle);
          drop(o.handle);
          made.forEach((obj, k) => m.FPDFPage_InsertObjectAtIndex(page, obj, Math.max(0, at) + k));
          results.push({ page: pageIndex, index: c.index, font: name, fallback: [...new Set(runs.map((r) => r.name))] });
        }

        // Any object: picture, colours, placement, order, removal.
        for (const c of mine.objects) {
          const o = ok(c);
          if (!o || gone.has(o.handle)) {
            results.push({ page: pageIndex, index: c.index, error: "changed" });
            continue;
          }
          if (c.remove) {
            drop(o.handle);
            results.push({ page: pageIndex, index: c.index });
            continue;
          }
          if (c.image) {
            if (o.kind !== "image" || !setImage(x, page, o.handle, c.image)) {
              results.push({ page: pageIndex, index: c.index, error: "image" });
              continue;
            }
          }
          if (c.fill) m.FPDFPageObj_SetFillColor(o.handle, ...c.fill);
          if (c.stroke) m.FPDFPageObj_SetStrokeColor(o.handle, ...c.stroke);
          if (c.strokeWidth !== undefined) m.FPDFPageObj_SetStrokeWidth(o.handle, c.strokeWidth);
          if (c.transform) {
            const [a, b, cc, d, e, f] = c.transform;
            m.FPDFPageObj_Transform(o.handle, a, b, cc, d, e, f);
            // A clipped object (a cropped picture) takes its clip along.
            m.FPDFPageObj_TransformClipPath(o.handle, a, b, cc, d, e, f);
          }
          if (c.order) {
            m.FPDFPage_RemoveObject(page, o.handle);
            if (c.order === "front") m.FPDFPage_InsertObject(page, o.handle);
            else m.FPDFPage_InsertObjectAtIndex(page, o.handle, 0);
          }
          results.push({ page: pageIndex, index: c.index });
        }

        if (!m.FPDFPage_GenerateContent(page)) {
          for (const r of results) if (r.page === pageIndex && !r.error) r.error = "page";
        }
      } finally {
        m.FPDFText_ClosePage(tp);
        m.FPDF_ClosePage(page);
      }
    }
    return { bytes: saveDoc(x, doc), results };
  } finally {
    close();
    buffers.forEach((p) => x.free(p));
  }
}
