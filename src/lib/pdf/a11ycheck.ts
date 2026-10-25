"use client";

// An accessibility check, run in the browser on what Make PDF accessible
// returns (src/lib/pdf/tag.ts), toward WCAG 2.1 AA and PDF/UA-1. Like
// pdfacheck.ts it covers what files most often get wrong, not the whole
// standard; a person with a screen reader stays the final judge.
//
//   title      a title, shown in the window bar (DisplayDocTitle)    WCAG 2.4.2
//   lang       the document's language                               WCAG 3.1.1
//   tagged     marked, with a structure tree                         WCAG 1.3.1
//   headings   headings, no level skipped                            WCAG 1.3.1, 2.4.6
//   figures    every Figure has alt text; no untagged pictures       WCAG 1.1.1
//   order      the content is in the tag tree, not loose on the page WCAG 1.3.2
//   ocr        pages that are pictures of text, with no text         WCAG 1.4.5
//   fonts      fonts embedded                                        PDF/UA-1 7.21.4.1
//   unicode    text maps to Unicode, and pdf.js reads it cleanly     PDF/UA-1 7.21.7
//   links      links have a description                              WCAG 2.4.4
//   forms      form fields have a tooltip (TU)                       WCAG 4.1.2
//   tables     tagged tables have header cells (TH)                  WCAG 1.3.1
//   contrast   text against a white page                             WCAG 1.4.3
//   bookmarks  bookmarks in a document over 20 pages                 WCAG 2.4.5
//
// The catalog, structure tree, links and fields are read for the whole file.
// Page content (text, pictures, colours, fonts) is read on at most
// MAX_PAGES pages spread through the file, so a 2,000-page file costs about
// what a 60-page one does; the report says how many were read.

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFObject } from "pdf-lib";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { closePdf, openPdf, type Progress } from "./common";
import { contentBytes, tokens, type Token } from "./content";

export type A11yStatus = "pass" | "warn" | "fail" | "na";
export const A11Y_CHECKS = ["title", "lang", "tagged", "headings", "figures", "order", "ocr", "fonts", "unicode", "links", "forms", "tables", "contrast", "bookmarks"] as const;
export type A11yCheck = (typeof A11Y_CHECKS)[number];
// `key`: the message, "<check>.<what>" (a11y.msg.<key> in the dictionary),
// with `count` as {n} and `value` as {value} when it has one. `pages`: pages
// affected, numbered from 1, at most MAX_LISTED of them; `pagesTotal` counts them all.
export type A11yResult = { id: A11yCheck; status: A11yStatus; count: number; pages: number[]; pagesTotal: number; key: string; value?: number };
export type A11yReport = { pages: number; inspected: number; title: string; lang: string; results: A11yResult[] };

// Pages whose content is read, and pages listed per check.
export const MAX_PAGES = 60;
const MAX_LISTED = 20;
// Structure elements walked, so a tree with millions of them (one per word) can't stall the page.
const MAX_ELEMS = 200_000;
// A document longer than this needs bookmarks to find one's way (Acrobat's checker uses the same).
const BOOKMARK_PAGES = 20;
// Share of a page pictures must cover, with no text on it, for it to count as a scan.
const SCAN_COVER = 0.3;

const N = (s: string) => PDFName.of(s);

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const ID: M = [1, 0, 0, 1, 0, 0];
const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

const textOf = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText().trim() : "");

// The pages to read: all of them, or MAX_PAGES spread evenly from the first to the last.
export function samplePages(total: number, max = MAX_PAGES): number[] {
  if (total <= max) return Array.from({ length: total }, (_, i) => i);
  return [...new Set(Array.from({ length: max }, (_, k) => Math.round((k * (total - 1)) / (max - 1))))];
}

// WCAG 2.1 contrast of an sRGB colour (0-1 channels) against white.
export function contrastOnWhite([r, g, b]: [number, number, number]) {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return 1.05 / (l + 0.05);
}

// ── Page content

// What one page's content streams hold, as far as the checks care.
type PageScan = {
  chars: number; untaggedChars: number;
  images: number; untaggedImages: number; imageArea: number;
  lowContrast: number; lowest: number;
};
type FontUse = { dict: PDFDict; pages: Set<number> };
type Space = "gray" | "rgb" | "cmyk" | "tint" | "unknown";
type Gs = { ctm: M; fill: [number, number, number] | null; space: Space; size: number; tr: number };

// Walks a page's content (and the forms it draws) once: text and pictures,
// whether each sits in numbered marked content (tagged), an artifact, or
// neither; the colour and size text is drawn at; the fonts it uses.
// Contrast is measured against white: what is drawn behind the text (a
// coloured box, a photo) isn't tracked, which would mean rasterising the
// page. Text in a light colour on a dark box is reported, so the check only
// warns and the report says to look at such places by eye.
function scanPage(doc: PDFDocument, pageIndex: number, fonts: Map<string, FontUse>): PageScan {
  const ctx = doc.context;
  const page = doc.getPage(pageIndex);
  const scan: PageScan = { chars: 0, untaggedChars: 0, images: 0, untaggedImages: 0, imageArea: 0, lowContrast: 0, lowest: 21 };
  const seenForms = new Set<string>();

  const spaceOf = (name: string, res: PDFDict | undefined): Space => {
    if (name === "DeviceGray" || name === "CalGray" || name === "G") return "gray";
    if (name === "DeviceRGB" || name === "CalRGB" || name === "RGB") return "rgb";
    if (name === "DeviceCMYK" || name === "CMYK") return "cmyk";
    const cs = res?.lookup(N("ColorSpace"));
    const v = cs instanceof PDFDict ? cs.lookup(N(name)) : undefined;
    const arr = v instanceof PDFArray ? v : undefined;
    const fam = arr?.lookup(0);
    if (v instanceof PDFName) return spaceOf(v.decodeText(), undefined);
    if (!(fam instanceof PDFName)) return "unknown";
    const f = fam.decodeText();
    if (f === "Separation" || f === "DeviceN") return "tint";
    if (f === "ICCBased") {
      const s = arr!.lookup(1);
      const n = s instanceof PDFStream ? s.dict.lookup(N("N")) : undefined;
      const k = n instanceof PDFNumber ? n.asNumber() : 0;
      return k === 1 ? "gray" : k === 3 ? "rgb" : k === 4 ? "cmyk" : "unknown";
    }
    return spaceOf(f, undefined);
  };
  const colour = (space: Space, v: number[]): [number, number, number] | null => {
    if (space === "gray" && v.length === 1) return [v[0], v[0], v[0]];
    if (space === "rgb" && v.length === 3) return [v[0], v[1], v[2]];
    if (space === "cmyk" && v.length === 4) return [(1 - v[0]) * (1 - v[3]), (1 - v[1]) * (1 - v[3]), (1 - v[2]) * (1 - v[3])];
    // A spot colour at full tint is solid ink: dark, at a guess.
    if (space === "tint" && v.length >= 1) return [1 - v[0], 1 - v[0], 1 - v[0]];
    return null;
  };

  const walk = (b: Uint8Array, res: PDFDict | undefined, start: Gs, marked: ("mcid" | "artifact" | "other")[], depth: number) => {
    let gs: Gs = { ...start };
    const stack: Gs[] = [];
    let tmScale = 1;
    let operands: Token[] = [];
    const nums = () => operands.flatMap((t) => ("num" in t ? [t.num] : []));
    const where = () => (marked.includes("artifact") ? "artifact" : marked.includes("mcid") ? "tagged" : "loose");
    const show = (chars: number) => {
      if (!chars) return;
      const w = where();
      if (w === "artifact") return;
      scan.chars += chars;
      if (w === "loose") scan.untaggedChars += chars;
      // Invisible text (render mode 3, an OCR layer; 7, a clip) has no contrast to speak of.
      if (gs.tr === 3 || gs.tr === 7 || !gs.fill) return;
      const ratio = contrastOnWhite(gs.fill);
      // Large text (18 pt and up) needs 3:1; the rest 4.5:1. Bold isn't known
      // here, so 14 pt bold text is held to 4.5:1.
      const size = gs.size * tmScale * scaleOf(gs.ctm);
      if (ratio < (size >= 18 ? 3 : 4.5)) {
        scan.lowContrast++;
        scan.lowest = Math.min(scan.lowest, ratio);
      }
    };
    const image = () => {
      const w = where();
      if (w === "artifact") return;
      scan.images++;
      scan.imageArea += Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2]);
      if (w === "loose") scan.untaggedImages++;
    };
    for (const t of tokens(b)) {
      if ("inline" in t) {
        image();
        operands = [];
        continue;
      }
      if (!("op" in t)) {
        operands.push(t);
        continue;
      }
      const v = nums();
      switch (t.op) {
        case "q": stack.push({ ...gs }); break;
        case "Q": gs = stack.pop() ?? gs; break;
        case "cm": if (v.length === 6) gs.ctm = mul(v as M, gs.ctm); break;
        case "BT": tmScale = 1; break;
        case "Tm": if (v.length === 6) tmScale = scaleOf(v as M); break;
        case "Tr": if (v.length === 1) gs.tr = v[0]; break;
        case "Tf": {
          if (v.length) gs.size = v[v.length - 1];
          const name = operands.find((x) => "name" in x) as { name: string } | undefined;
          const fd = res?.lookup(N("Font"));
          const ref = name && fd instanceof PDFDict ? fd.get(N(name.name)) : undefined;
          const dict = ref ? ctx.lookup(ref) : undefined;
          if (dict instanceof PDFDict) {
            const key = ref instanceof PDFRef ? ref.toString() : `${pageIndex}:${name!.name}`;
            const use = fonts.get(key) ?? { dict, pages: new Set<number>() };
            use.pages.add(pageIndex);
            fonts.set(key, use);
          }
          break;
        }
        case "Tj": case "'": case "\"": {
          const s = operands.findLast((x) => "str" in x) as { str: Uint8Array } | undefined;
          show(s?.str.length ?? 0);
          break;
        }
        case "TJ": show(operands.reduce((n, x) => n + ("str" in x ? x.str.length : 0), 0)); break;
        case "g": gs.space = "gray"; gs.fill = colour("gray", v); break;
        case "rg": gs.space = "rgb"; gs.fill = colour("rgb", v); break;
        case "k": gs.space = "cmyk"; gs.fill = colour("cmyk", v); break;
        case "cs": {
          const name = operands.find((x) => "name" in x) as { name: string } | undefined;
          gs.space = name ? spaceOf(name.name, res) : "unknown";
          // Choosing a colour space sets its initial colour: black, or full tint.
          gs.fill = gs.space === "unknown" ? null : [0, 0, 0];
          break;
        }
        // A pattern (a name operand) or an indexed colour can't be judged.
        case "sc": case "scn": gs.fill = operands.some((x) => "name" in x) ? null : colour(gs.space, v); break;
        case "BMC": case "BDC": {
          const tag = operands.find((x) => "name" in x) as { name: string } | undefined;
          let kind: "mcid" | "artifact" | "other" = tag?.name === "Artifact" ? "artifact" : "other";
          if (kind === "other" && t.op === "BDC") {
            if (operands.some((x) => "name" in x && x.name === "MCID")) kind = "mcid";
            else {
              // Properties named from the resources: /P /MC0 BDC.
              const prop = operands.filter((x) => "name" in x)[1] as { name: string } | undefined;
              const props = res?.lookup(N("Properties"));
              const d = prop && props instanceof PDFDict ? props.lookup(N(prop.name)) : undefined;
              if (d instanceof PDFDict && d.has(N("MCID"))) kind = "mcid";
            }
          }
          marked.push(kind);
          break;
        }
        case "EMC": marked.pop(); break;
        case "Do": {
          const name = operands.findLast((x) => "name" in x) as { name: string } | undefined;
          const xo = res?.lookup(N("XObject"));
          const ref = name && xo instanceof PDFDict ? xo.get(N(name.name)) : undefined;
          const x = ref ? ctx.lookup(ref) : undefined;
          if (!(x instanceof PDFRawStream)) break;
          const sub = x.dict.lookup(N("Subtype"));
          if (sub === N("Image")) image();
          else if (sub === N("Form") && depth < 6) {
            // A form drawn many times is read once per page, so a tiled pattern of forms stays cheap.
            const key = ref instanceof PDFRef ? ref.toString() : "";
            if (key && seenForms.has(key)) break;
            if (key) seenForms.add(key);
            const mat = x.dict.lookup(N("Matrix"));
            const m = mat instanceof PDFArray && mat.size() === 6 ? (mat.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0)) as M) : ID;
            const fres = x.dict.lookup(N("Resources"));
            for (const inner of contentBytes(x, doc)) walk(inner, fres instanceof PDFDict ? fres : res, { ...gs, ctm: mul(m, gs.ctm) }, [...marked], depth + 1);
          }
          break;
        }
      }
      operands = [];
    }
  };

  const res = page.node.Resources();
  for (const b of contentBytes(page.node.get(N("Contents")), doc)) walk(b, res, { ctm: ID, fill: [0, 0, 0], space: "gray", size: 0, tr: 0 }, [], 0);
  return scan;
}

// ── Fonts

const PREDEFINED_ORDERINGS = new Set(["Japan1", "GB1", "CNS1", "Korea1", "KR"]);
// Glyph names a font program made up (g12, glyph7, cid00042): no Unicode behind them.
const MADE_UP = /^(g|glyph|cid|index|c|G|a)\d+$/i;

// Whether a font's program is in the file, and whether its text maps to Unicode.
function fontInfo(f: PDFDict): { embedded: boolean; unicode: boolean } {
  const sub = f.lookup(N("Subtype"));
  const hasToUnicode = f.has(N("ToUnicode"));
  const descriptorOf = (d: PDFDict) => {
    const fd = d.lookup(N("FontDescriptor"));
    return fd instanceof PDFDict ? fd : undefined;
  };
  const embeddedIn = (fd: PDFDict | undefined) => !!fd && (fd.has(N("FontFile")) || fd.has(N("FontFile2")) || fd.has(N("FontFile3")));
  if (sub === N("Type3")) {
    // Drawn with the file's own procedures: embedded by nature; Unicode only through ToUnicode or known names.
    return { embedded: true, unicode: hasToUnicode || differencesKnown(f) };
  }
  if (sub === N("Type0")) {
    const kids = f.lookup(N("DescendantFonts"));
    const cid = kids instanceof PDFArray ? kids.lookup(0) : undefined;
    const fd = cid instanceof PDFDict ? descriptorOf(cid) : undefined;
    const enc = f.lookup(N("Encoding"));
    const info = cid instanceof PDFDict ? cid.lookup(N("CIDSystemInfo")) : undefined;
    const ordering = info instanceof PDFDict ? textOf(info.lookup(N("Ordering"))) : "";
    // Identity-H says nothing about the characters: without ToUnicode, a CJK
    // collection pdf.js has tables for is the only way back to text.
    const identity = enc instanceof PDFName && /^Identity-[HV]$/.test(enc.decodeText());
    const unicode = hasToUnicode || (!identity && enc instanceof PDFName) || PREDEFINED_ORDERINGS.has(ordering);
    return { embedded: embeddedIn(fd), unicode };
  }
  // Simple fonts: a standard encoding, or differences with real glyph names.
  return { embedded: embeddedIn(descriptorOf(f)), unicode: hasToUnicode || differencesKnown(f) };
}

function differencesKnown(f: PDFDict) {
  const enc = f.lookup(N("Encoding"));
  if (!(enc instanceof PDFDict)) return true; // a named encoding, or the font's own (left to the extraction check)
  const diffs = enc.lookup(N("Differences"));
  if (!(diffs instanceof PDFArray)) return true;
  const names = diffs.asArray().filter((x): x is PDFName => x instanceof PDFName).map((x) => x.decodeText());
  // Mostly made-up names: the text comes out as nonsense.
  return names.filter((n) => MADE_UP.test(n)).length * 2 < names.length || !names.length;
}

// pdf.js's text with characters that mean the mapping failed: the
// replacement character, private-use code points, control characters.
const GARBLED = /[�-\u0000-\u0008\u000E-\u001F]/g;

// ── Structure tree

type Tree = {
  elems: number;
  headings: { level: number; page?: number }[];
  figures: { alt: boolean; page?: number }[];
  tables: { th: boolean; page?: number }[];
};

function readTree(doc: PDFDocument, root: PDFDict, pageOf: (o: PDFObject | undefined) => number | undefined): Tree {
  const ctx = doc.context;
  const tree: Tree = { elems: 0, headings: [], figures: [], tables: [] };
  const roleMap = root.lookup(N("RoleMap"));
  const standard = (s: string) => {
    let r = s;
    for (let i = 0; i < 5 && roleMap instanceof PDFDict && !/^(H[1-6]?|Figure|Table|TH|TD|TR|P|Link)$/.test(r); i++) {
      const m = roleMap.lookup(N(r));
      if (!(m instanceof PDFName)) break;
      r = m.decodeText();
    }
    return r;
  };
  const seen = new Set<string>();
  // Returns whether a TH sits at or under this point, for the table above it.
  const visit = (o: PDFObject | undefined, page: number | undefined, depth: number): boolean => {
    if (tree.elems > MAX_ELEMS || depth > 200 || !o) return false;
    if (o instanceof PDFRef) {
      if (seen.has(o.toString())) return false;
      seen.add(o.toString());
    }
    const v = o instanceof PDFRef ? ctx.lookup(o) : o;
    if (v instanceof PDFArray) {
      let th = false;
      for (const x of v.asArray()) th = visit(x, page, depth + 1) || th;
      return th;
    }
    if (!(v instanceof PDFDict)) return false; // an MCID
    const type = v.lookup(N("Type"));
    if (type === N("MCR") || type === N("OBJR")) return false;
    const s = v.lookup(N("S"));
    if (!(s instanceof PDFName)) return visit(v.get(N("K")), page, depth + 1);
    tree.elems++;
    const role = standard(s.decodeText());
    const pg = pageOf(v.get(N("Pg"))) ?? page;
    const alt = !!(textOf(v.lookup(N("Alt"))) || textOf(v.lookup(N("ActualText"))));
    const h = role.match(/^H([1-6]?)$/);
    // In document order: an element before its children.
    if (h) tree.headings.push({ level: h[1] ? Number(h[1]) : 0, page: pg });
    if (role === "Figure") tree.figures.push({ alt, page: pg });
    const th = visit(v.get(N("K")), pg, depth + 1);
    if (role === "Table") {
      tree.tables.push({ th, page: pg });
      return false;
    }
    return th || role === "TH";
  };
  visit(root.get(N("K")), undefined, 0);
  return tree;
}

// A number tree (the parent tree) as a map, up to `limit` entries.
function numberTree(doc: PDFDocument, node: PDFObject | undefined, out = new Map<number, PDFObject>(), depth = 0, limit = 500_000) {
  const d = node instanceof PDFRef ? doc.context.lookup(node) : node;
  if (!(d instanceof PDFDict) || depth > 30 || out.size > limit) return out;
  const nums = d.lookup(N("Nums"));
  if (nums instanceof PDFArray) {
    for (let i = 0; i + 1 < nums.size(); i += 2) {
      const k = nums.lookup(i);
      if (k instanceof PDFNumber) out.set(k.asNumber(), nums.get(i + 1));
    }
  }
  const kids = d.lookup(N("Kids"));
  if (kids instanceof PDFArray) for (const k of kids.asArray()) numberTree(doc, k, out, depth + 1, limit);
  return out;
}

// ── The check

export async function checkA11y(bytes: Uint8Array, progress?: Progress, signal?: AbortSignal): Promise<A11yReport> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  const ctx = doc.context;
  const pages = doc.getPages();
  const index = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  const pageOf = (o: PDFObject | undefined) => (o instanceof PDFRef ? index.get(o.toString()) : undefined);
  const results: A11yResult[] = [];
  const add = (id: A11yCheck, status: A11yStatus, what: string, count = 0, affected: Iterable<number | undefined> = [], value?: number) => {
    const all = [...new Set([...affected].filter((p): p is number => p !== undefined))].sort((a, b) => a - b);
    results.push({ id, status, count, pages: all.slice(0, MAX_LISTED).map((p) => p + 1), pagesTotal: all.length, key: `${id}.${what}`, ...(value !== undefined ? { value } : {}) });
  };
  const cat = doc.catalog;

  // ── Title and language
  const title = doc.getTitle()?.trim() ?? "";
  const prefs = cat.lookup(N("ViewerPreferences"));
  const shown = prefs instanceof PDFDict && String(prefs.lookup(N("DisplayDocTitle"))) === "true";
  add("title", !title ? "fail" : shown ? "pass" : "warn", !title ? "missing" : shown ? "ok" : "notShown");
  const lang = textOf(cat.lookup(N("Lang")));
  add("lang", !lang ? "fail" : /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i.test(lang) ? "pass" : "warn", !lang ? "missing" : /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i.test(lang) ? "ok" : "invalid");

  // ── Tags
  const markInfo = cat.lookup(N("MarkInfo"));
  const marked = markInfo instanceof PDFDict && String(markInfo.lookup(N("Marked"))) === "true";
  const root = cat.lookup(N("StructTreeRoot"));
  const tree = root instanceof PDFDict ? readTree(doc, root, pageOf) : null;
  const tagged = !!tree && tree.elems > 0;
  add("tagged", !tree ? "fail" : !tree.elems ? "fail" : marked ? "pass" : "warn", !tree ? "missing" : !tree.elems ? "empty" : marked ? "ok" : "notMarked", tree?.elems ?? 0);

  // ── Headings: none skipped, the first an H1 (Matterhorn 14-002, 14-003).
  if (!tagged) add("headings", "na", "na");
  else if (!tree.headings.length) add("headings", "warn", "none");
  else {
    const skips: (number | undefined)[] = [];
    let prev = 0;
    for (const h of tree.headings) {
      if (!h.level) continue; // a plain H has no level to skip
      if (h.level > prev + 1) skips.push(h.page ?? -1);
      prev = h.level;
    }
    if (skips.length) add("headings", "fail", "skipped", skips.length, skips.filter((p) => p !== -1));
    else add("headings", "pass", "ok", tree.headings.length);
  }

  // ── Page content, on the sampled pages
  const sample = samplePages(pages.length);
  const fonts = new Map<string, FontUse>();
  const scans = new Map<number, PageScan>();
  const textChars = new Map<number, { chars: number; bad: number }>();
  const pdf = await openPdf(bytes);
  try {
    for (const [k, i] of sample.entries()) {
      signal?.throwIfAborted();
      scans.set(i, scanPage(doc, i, fonts));
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      const str = content.items.map((x) => ((x as TextItem).str ?? "")).join("").replace(/\s+/g, "");
      textChars.set(i, { chars: str.length, bad: str.match(GARBLED)?.length ?? 0 });
      page.cleanup();
      progress?.(k + 1, sample.length + 1);
    }
  } finally {
    await closePdf(pdf);
  }
  const area = (i: number) => {
    const { width, height } = pages[i].getSize();
    return Math.max(1, width * height);
  };

  // ── Figures: alt text on every Figure, and no picture outside the tags.
  const noAlt = tree?.figures.filter((f) => !f.alt) ?? [];
  const loose = [...scans].filter(([, s]) => s.untaggedImages > 0);
  const looseCount = loose.reduce((n, [, s]) => n + s.untaggedImages, 0);
  const anyImage = [...scans.values()].some((s) => s.images > 0) || !!tree?.figures.length;
  if (!anyImage) add("figures", "na", "none");
  else if (noAlt.length + looseCount) add("figures", "fail", "noAlt", noAlt.length + looseCount, [...noAlt.map((f) => f.page), ...loose.map(([i]) => i)]);
  else add("figures", "pass", "ok", tree?.figures.length ?? 0);

  // ── Reading order: content outside the tag tree is read in no particular
  // order, or not at all. Whether the tree's order matches the layout is
  // left to a person: judging that needs the page's columns and meaning.
  const withText = [...scans].filter(([, s]) => s.chars > 0);
  if (!withText.length) add("order", "na", "noText");
  else if (!tagged) add("order", "fail", "untagged", withText.length, withText.map(([i]) => i));
  else {
    const bad = withText.filter(([, s]) => s.untaggedChars > 20 && s.untaggedChars > s.chars * 0.1);
    add("order", bad.length ? "fail" : "pass", bad.length ? "loose" : "ok", bad.length, bad.map(([i]) => i));
  }

  // ── Real text: a page with pictures over much of it and no text is a scan.
  const scanned = [...scans].filter(([i, s]) => (textChars.get(i)?.chars ?? 0) < 10 && s.imageArea / area(i) >= SCAN_COVER);
  if (![...scans.values()].some((s) => s.images > 0)) add("ocr", "na", "noImages");
  else add("ocr", scanned.length ? "fail" : "pass", scanned.length ? "scanned" : "ok", scanned.length, scanned.map(([i]) => i));

  // ── Fonts: embedded, and mapped to Unicode.
  const infos = [...fonts.values()].map((u) => ({ ...u, ...fontInfo(u.dict) }));
  if (!infos.length) {
    add("fonts", "na", "none");
  } else {
    const missing = infos.filter((f) => !f.embedded);
    // The 14 standard fonts (Helvetica, Times, Courier, Symbol, ZapfDingbats)
    // every reader has: PDF/UA wants them embedded, WCAG doesn't, so a warning.
    const std = /^(?:[A-Z]{6}\+)?(Helvetica|Times|Courier|Symbol|ZapfDingbats|Arial|TimesNewRoman)/i;
    const onlyStandard = missing.every((f) => std.test(String(f.dict.get(N("BaseFont")) ?? "").replace(/^\//, "")));
    add("fonts", !missing.length ? "pass" : onlyStandard ? "warn" : "fail", missing.length ? "notEmbedded" : "ok", missing.length || infos.length, missing.flatMap((f) => [...f.pages]));
  }
  const unmapped = infos.filter((f) => !f.unicode);
  const garbled = [...textChars].filter(([, t]) => t.bad > Math.max(3, t.chars * 0.05));
  if (!infos.length && !garbled.length) add("unicode", "na", "none");
  else if (unmapped.length) add("unicode", "fail", "unmapped", unmapped.length, [...unmapped.flatMap((f) => [...f.pages]), ...garbled.map(([i]) => i)]);
  else if (garbled.length) add("unicode", "fail", "garbled", garbled.length, garbled.map(([i]) => i));
  else add("unicode", "pass", "ok");

  // ── Links and form fields, on every page.
  let parents: Map<number, PDFObject> | null = null;
  const parentAlt = (key: number) => {
    parents ??= root instanceof PDFDict ? numberTree(doc, root.get(N("ParentTree"))) : new Map();
    const e = parents.get(key);
    const d = e instanceof PDFRef ? ctx.lookup(e) : e;
    return d instanceof PDFDict && !!(textOf(d.lookup(N("Alt"))) || textOf(d.lookup(N("ActualText"))));
  };
  const links = { all: 0, bare: [] as number[], untagged: [] as number[] };
  const fields = { all: 0, bare: [] as number[] };
  for (const [i, p] of pages.entries()) {
    const annots = p.node.lookup(N("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (const a of annots.asArray()) {
      const d = a instanceof PDFRef ? ctx.lookup(a) : a;
      if (!(d instanceof PDFDict)) continue;
      const sub = d.lookup(N("Subtype"));
      if (sub === N("Link")) {
        links.all++;
        const sp = d.lookup(N("StructParent"));
        if (!textOf(d.lookup(N("Contents"))) && !(sp instanceof PDFNumber && parentAlt(sp.asNumber()))) links.bare.push(i);
        if (tagged && !(sp instanceof PDFNumber)) links.untagged.push(i);
      } else if (sub === N("Widget")) {
        fields.all++;
        // The tooltip is on the field, which may be the widget or one of its parents.
        let f: PDFDict | undefined = d, tu = "";
        for (let k = 0; f && k < 10 && !tu; k++) {
          tu = textOf(f.lookup(N("TU")));
          const up: PDFObject | undefined = f.lookup(N("Parent"));
          f = up instanceof PDFDict ? up : undefined;
        }
        if (!tu) fields.bare.push(i);
      }
    }
  }
  if (!links.all) add("links", "na", "none");
  else if (links.bare.length) add("links", "fail", "noText", links.bare.length, links.bare);
  else if (links.untagged.length) add("links", "warn", "untagged", links.untagged.length, links.untagged);
  else add("links", "pass", "ok", links.all);
  if (!fields.all) add("forms", "na", "none");
  else add("forms", fields.bare.length ? "fail" : "pass", fields.bare.length ? "noTooltip" : "ok", fields.bare.length || fields.all, fields.bare);

  // ── Tables
  if (!tree?.tables.length) add("tables", "na", "none");
  else {
    const bare = tree.tables.filter((t) => !t.th);
    add("tables", bare.length ? "fail" : "pass", bare.length ? "noHeaders" : "ok", bare.length || tree.tables.length, bare.map((t) => t.page));
  }

  // ── Contrast (approximate: see scanPage)
  const low = [...scans].filter(([, s]) => s.lowContrast > 0);
  if (!withText.length) add("contrast", "na", "noText");
  else if (low.length) {
    const lowest = Math.min(...low.map(([, s]) => s.lowest));
    add("contrast", "warn", "low", low.reduce((n, [, s]) => n + s.lowContrast, 0), low.map(([i]) => i), Math.floor(lowest * 10) / 10);
  } else add("contrast", "pass", "ok");

  // ── Bookmarks
  const outlines = cat.lookup(N("Outlines"));
  const hasOutline = outlines instanceof PDFDict && outlines.has(N("First"));
  if (pages.length <= BOOKMARK_PAGES) add("bookmarks", "na", "short", pages.length);
  else add("bookmarks", hasOutline ? "pass" : "fail", hasOutline ? "ok" : "missing", pages.length);

  progress?.(1, 1);
  return { pages: pages.length, inspected: sample.length, title, lang, results };
}

// How many checks passed, warned and failed (not-applicable ones aside).
export function tally(r: A11yReport) {
  const n = (s: A11yStatus) => r.results.filter((x) => x.status === s).length;
  return { passed: n("pass"), warnings: n("warn"), failed: n("fail") };
}

// Checks the tagger put right: failing or warning on the original, passing on the result.
export function fixedBy(before: A11yReport, after: A11yReport): A11yCheck[] {
  return after.results.filter((r) => r.status === "pass" && ["fail", "warn"].includes(before.results.find((b) => b.id === r.id)?.status ?? "")).map((r) => r.id);
}
