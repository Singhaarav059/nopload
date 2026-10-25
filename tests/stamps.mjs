// Page numbers, Bates numbers and watermarks (src/lib/pdf/edit.ts): custom
// templates and number styles, numbers that run on across a set of files
// (run.ts) and its exhibit index, the font families, CJK marks that extract
// as one string, and a page whose content ends inside an inline image.
//
//   node tests/stamps.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load, refOpen, fileOf, ROOT } from "./robustness/env.mjs";

const { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFArray, StandardFonts, decodePDFRawStream } = await import("pdf-lib");
const { pageNumbers, watermark, exhibitIndex } = await load("edit");
const { runTool } = await load("run");
const { pdfium } = await load("pdfium");
const results = { failed: 0 };
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    results.failed++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}
function eq(a, b, what) {
  if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

async function blank(pages, name = "doc.pdf") {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) d.addPage([612, 792]).drawText(`BODY${i + 1}`, { x: 72, y: 700, size: 12, font });
  return fileOf(await d.save(), name);
}

const bytesOf = async (o) => new Uint8Array(await o.blob.arrayBuffer());

// Each page's text as pdf.js gives it, items joined with spaces (as tests/robustness does).
async function texts(bytes) {
  const doc = await refOpen(bytes);
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    out.push((await p.getTextContent()).items.map((x) => x.str).join(" ").replace(/\s+/g, " ").trim());
  }
  await doc.loadingTask.destroy();
  return out;
}

// The first page's text as PDFium extracts it (it honours /ActualText).
async function pdfiumText(bytes) {
  const m = await pdfium();
  const { malloc, free } = m.pdfium.wasmExports;
  const heap = () => m.pdfium.HEAPU8;
  const file = malloc(bytes.length);
  heap().set(bytes, file);
  const doc = m.FPDF_LoadMemDocument(file, bytes.length, "");
  const page = m.FPDF_LoadPage(doc, 0);
  const tp = m.FPDFText_LoadPage(page);
  const n = m.FPDFText_CountChars(tp);
  const buf = malloc((n + 1) * 2);
  m.FPDFText_GetText(tp, 0, n, buf);
  const s = Buffer.from(heap().slice(buf, buf + n * 2)).toString("utf16le");
  free(buf);
  m.FPDFText_ClosePage(tp);
  m.FPDF_ClosePage(page);
  m.FPDF_CloseDocument(doc);
  free(file);
  return s;
}

// A page's content streams, decoded and joined.
async function content(bytes, index = 0) {
  const d = await PDFDocument.load(bytes);
  const c = d.getPages()[index].node.Contents();
  const refs = c instanceof PDFArray ? c.asArray() : [c];
  return refs.map((r) => {
    const s = d.context.lookup(r);
    return s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1") : "";
  }).join("\n");
}

// Embedded fonts: base name and whether the font program is in the file.
async function fonts(bytes) {
  const d = await PDFDocument.load(bytes);
  const out = [];
  for (const [, o] of d.context.enumerateIndirectObjects()) {
    const dict = o instanceof PDFDict ? o : null;
    if (dict?.get(PDFName.of("Type")) !== PDFName.of("FontDescriptor")) continue;
    out.push({ name: String(dict.get(PDFName.of("FontName"))), embedded: ["FontFile", "FontFile2", "FontFile3"].some((k) => dict.has(PDFName.of(k))) });
  }
  return out;
}

const NUM = { position: "bottom-center", numberFormat: "n", startAt: 1, pageRange: "", skipFirst: false, fontSize: 11, color: "#1f2937", facing: false };
const MARK = { markType: "text", markText: "CONFIDENTIAL", fontSize: 56, color: "#d33f6a", imageScale: 40, position: "middle-center", mosaic: false, opacity: 30, rotation: "45", layer: "over", pageRange: "" };

await test("custom template: 'Sheet {page}/{pages}' gives 'Sheet 2/3' on page 2", async () => {
  const [o] = await pageNumbers(await blank(3), { ...NUM, numberFormat: "custom", template: "Sheet {page}/{pages}" });
  const t = await texts(await bytesOf(o));
  for (let i = 0; i < 3; i++) if (!t[i].includes(`Sheet ${i + 1}/3`)) throw new Error(`page ${i + 1}: ${JSON.stringify(t[i])}`);
});

await test("number styles: i, I, a, A", async () => {
  const want = { i: ["i", "ii", "iii", "iv"], I: ["I", "II", "III", "IV"], a: ["a", "b", "c", "d"], A: ["A", "B", "C", "D"] };
  for (const [style, labels] of Object.entries(want)) {
    const [o] = await pageNumbers(await blank(4), { ...NUM, numberFormat: "custom", template: "[{page}/{pages}]", numberStyle: style });
    const t = await texts(await bytesOf(o));
    labels.forEach((l, i) => { if (!t[i].includes(`[${l}/${labels[3]}]`)) throw new Error(`${style} page ${i + 1}: ${JSON.stringify(t[i])}`); });
  }
});

await test("skip the first 1 and last 2 pages", async () => {
  const [o] = await pageNumbers(await blank(5), { ...NUM, numberFormat: "custom", template: "<{page}>", skipFirst: 1, skipLast: 2 });
  const t = await texts(await bytesOf(o));
  eq(JSON.stringify(t.map((s) => s.match(/<(\d+)>/)?.[1] ?? null)), JSON.stringify([null, "1", "2", null, null]), "labels");
});

await test("Bates: an offset of 3 starts a 3-page file at ABC000004", async () => {
  const [o] = await pageNumbers(await blank(3), { ...NUM, numberFormat: "bates", batesPrefix: "ABC", batesDigits: 6, offset: 3 });
  eq(JSON.stringify(await texts(await bytesOf(o))), JSON.stringify(["BODY1 ABC000004", "BODY2 ABC000005", "BODY3 ABC000006"]), "labels");
});

// ── A set numbered as one (run.ts, continueNumbers), and its exhibit index.
// The options as the workspace sends them: every default, then the test's own.
const RUN = {
  position: "bottom-center", numberFormat: "n", startAt: 1, pageRange: "", skipFirstPages: 0, skipLastPages: 0, fontSize: 11,
  color: "#1f2937", facing: false, template: "{page} / {pages}", numberStyle: "1", margin: "normal", font: "helvetica",
  batesPrefix: "", batesDigits: 6, continueNumbers: false, exhibitIndex: false,
};
const BATES = { ...RUN, numberFormat: "bates", batesPrefix: "DOC", batesDigits: 6, continueNumbers: true };
const set = async () => [await blank(3, "a.pdf"), await blank(2, "b.pdf")];
// Each output's pages, with the body text taken out: just the labels.
const labelsOf = async (outs) => Promise.all(outs.map(async (o) => (await texts(await bytesOf(o))).map((t) => t.replace(/^BODY\d+\s*/, ""))));
const json = (v) => JSON.stringify(v);

await test("continue numbering: files of 3 and 2 pages get DOC000001-3 and DOC000004-5", async () => {
  const out = await runTool("pageNumbers", await set(), BATES);
  eq(json(out.map((o) => o.name)), json(["a-numbered.pdf", "b-numbered.pdf"]), "outputs");
  eq(json(await labelsOf(out)), json([["DOC000001", "DOC000002", "DOC000003"], ["DOC000004", "DOC000005"]]), "labels");
});

await test("continue numbering: the first file starts at First number", async () => {
  const out = await runTool("pageNumbers", await set(), { ...BATES, startAt: 10 });
  eq(json(await labelsOf(out)), json([["DOC000010", "DOC000011", "DOC000012"], ["DOC000013", "DOC000014"]]), "labels");
});

await test("continue numbering: pages left unnumbered don't use up numbers", async () => {
  const out = await runTool("pageNumbers", await set(), { ...RUN, numberFormat: "custom", template: "<{page}>", skipFirstPages: 1, continueNumbers: true });
  eq(json(await labelsOf(out)), json([["", "<1>", "<2>"], ["", "<3>"]]), "labels");
});

await test("continue numbering: 'of total' and {pages} count the whole set", async () => {
  const of = await runTool("pageNumbers", await set(), { ...RUN, numberFormat: "nOfTotal", continueNumbers: true });
  eq(json(await labelsOf(of)), json([["1 of 5", "2 of 5", "3 of 5"], ["4 of 5", "5 of 5"]]), "n of total");
  const custom = await runTool("pageNumbers", await set(), { ...RUN, numberFormat: "custom", template: "{page}/{pages}", startAt: 3, continueNumbers: true });
  eq(json(await labelsOf(custom)), json([["3/7", "4/7", "5/7"], ["6/7", "7/7"]]), "custom");
});

await test("off: each file is numbered on its own, Bates included", async () => {
  const out = await runTool("pageNumbers", await set(), { ...BATES, continueNumbers: false });
  eq(json(await labelsOf(out)), json([["DOC000001", "DOC000002", "DOC000003"], ["DOC000001", "DOC000002"]]), "labels");
});

await test("a job saved before the choice existed: Bates still runs on", async () => {
  const old = { ...BATES };
  delete old.continueNumbers;
  delete old.exhibitIndex;
  const out = await runTool("pageNumbers", await set(), old);
  eq(json(await labelsOf(out)), json([["DOC000001", "DOC000002", "DOC000003"], ["DOC000004", "DOC000005"]]), "labels");
});

await test("exhibit index: one more PDF listing each file, its numbers and page count", async () => {
  const files = [await blank(3, "a.pdf"), await blank(2, "合同.pdf"), await blank(1, "c.pdf")];
  const out = await runTool("pageNumbers", files, { ...BATES, exhibitIndex: true });
  eq(json(out.map((o) => o.name)), json(["a-numbered.pdf", "合同-numbered.pdf", "c-numbered.pdf", "exhibit-index.pdf"]), "outputs");
  const [index] = await texts(await bytesOf(out[3]));
  for (const want of ["Exhibit index", "# File Numbers Pages", "1 a.pdf DOC000001 – DOC000003 3", "3 c.pdf DOC000006 1"]) {
    if (!index.includes(want)) throw new Error(`missing ${JSON.stringify(want)} in ${JSON.stringify(index)}`);
  }
  // The Chinese name is drawn with an embedded Noto font, not as an image, so it can be found.
  if (!/2 合同\s*\.pdf DOC000004 – DOC000005 2/.test(index)) throw new Error(`row 2: ${JSON.stringify(index)}`);
});

await test("exhibit index: translated headings, and off unless asked for", async () => {
  const labels = { page: "Seite {n}", pageOf: "Seite {n} von {total}", nOf: "{n} von {total}", index: { title: "Anlagenverzeichnis", file: "Datei", numbers: "Nummern", pages: "Seiten" } };
  const out = await runTool("pageNumbers", await set(), { ...BATES, exhibitIndex: true }, undefined, labels);
  const [index] = await texts(await bytesOf(out[2]));
  if (!index.startsWith("Anlagenverzeichnis # Datei Nummern Seiten")) throw new Error(JSON.stringify(index));
  eq((await runTool("pageNumbers", await set(), BATES)).length, 2, "outputs without the index");
  // Hidden with continueNumbers off, so it does nothing then even if set.
  eq((await runTool("pageNumbers", await set(), { ...BATES, continueNumbers: false, exhibitIndex: true })).length, 2, "outputs with numbering per file");
});

await test("exhibit index: a long set runs onto more pages, the headings on each", async () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ name: `file-${i + 1}.pdf`, pages: 2, first: 2 * i + 1, last: 2 * i + 2 }));
  const index = await exhibitIndex(rows, { numberFormat: "bates", batesPrefix: "X", batesDigits: 4 });
  const pages = await texts(await bytesOf(index));
  if (pages.length < 2) throw new Error(`${pages.length} page`);
  pages.forEach((t, i) => {
    if (!t.includes("# File Numbers Pages")) throw new Error(`page ${i + 1} has no headings`);
    if (!t.endsWith(`Page ${i + 1} of ${pages.length}`)) throw new Error(`page ${i + 1} footer: ${JSON.stringify(t.slice(-30))}`);
  });
  const all = pages.join(" ");
  if (!all.includes("80 file-80.pdf X0159 – X0160 2")) throw new Error("last row missing");
  eq(all.match(/file-\d+\.pdf/g).length, 80, "rows");
});

await test("continue numbering: a file that can't be read stops the run, naming it", async () => {
  const bad = fileOf(new TextEncoder().encode("%PDF-1.7\nnot really"), "broken.pdf");
  const seen = [];
  const files = [await blank(3, "a.pdf"), bad, await blank(2, "b.pdf")];
  let err;
  try {
    await runTool("pageNumbers", files, BATES, undefined, undefined, undefined, (i, state) => seen.push(`${i}:${state}`));
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error("no error");
  eq(err.fileName, "broken.pdf", "file named");
  eq(json(seen), json(["1:fail"]), "file states");
  // Numbered per file, the batch leaves it out and goes on, as before.
  const out = await runTool("pageNumbers", files, { ...BATES, continueNumbers: false });
  eq(json(out.map((o) => o.name)), json(["a-numbered.pdf", "b-numbered.pdf"]), "per file");
});

await test("one file: the same with continue numbering on or off, and as pageNumbers alone", async () => {
  for (const format of ["bates", "nOfTotal", "custom"]) {
    const o = { ...RUN, numberFormat: format, batesPrefix: "DOC", template: "{page}/{pages}", startAt: 4, skipFirstPages: 1 };
    const off = await runTool("pageNumbers", [await blank(3, "a.pdf")], o);
    const on = await runTool("pageNumbers", [await blank(3, "a.pdf")], { ...o, continueNumbers: true });
    const [alone] = await pageNumbers(await blank(3, "a.pdf"), {
      ...NUM, numberFormat: format, batesPrefix: "DOC", batesDigits: 6, template: "{page}/{pages}", startAt: 4, skipFirst: 1,
    });
    eq(json(on.map((x) => x.name)), json(["a-numbered.pdf"]), `${format}: outputs`);
    eq(json(await labelsOf(on)), json(await labelsOf(off)), `${format}: on and off`);
    eq(json(await labelsOf(off)), json(await labelsOf([alone])), `${format}: runTool and pageNumbers`);
  }
});

await test("margins: large sits further from the edge than small", async () => {
  const y = async (margin) => {
    const [o] = await pageNumbers(await blank(1), { ...NUM, margin });
    const doc = await refOpen(await bytesOf(o));
    const item = (await (await doc.getPage(1)).getTextContent()).items.find((x) => x.str === "1");
    return item.transform[5];
  };
  const small = await y("small"), normal = await y("normal"), large = await y("large");
  if (!(small < normal && normal < large)) throw new Error(`baselines small ${small}, normal ${normal}, large ${large}`);
});

await test("watermark: the Times font choice embeds a serif font", async () => {
  const [o] = await watermark(await blank(1), { ...MARK, font: "tinos" });
  const f = await fonts(await bytesOf(o));
  if (!f.some((x) => /Tinos/.test(x.name) && x.embedded)) throw new Error(`fonts: ${JSON.stringify(f)}`);
  const t = await texts(await bytesOf(o));
  if (!t[0].includes("CONFIDENTIAL")) throw new Error(`text: ${t[0]}`);
});

await test("page numbers: the monospace font choice embeds Cousine", async () => {
  const [o] = await pageNumbers(await blank(1), { ...NUM, font: "cousine" });
  const f = await fonts(await bytesOf(o));
  if (!f.some((x) => /Cousine/.test(x.name) && x.embedded)) throw new Error(`fonts: ${JSON.stringify(f)}`);
});

await test("watermark: '机密文件' extracts as one string, with no spaces", async () => {
  const [o] = await watermark(await blank(1), { ...MARK, markText: "机密文件" });
  const bytes = await bytesOf(o);
  const s = await content(bytes);
  // The runs (one per font slice) sit inside one marked-content span that carries the whole text.
  const m = s.match(/\/ActualText\s*<([0-9A-Fa-f]+)>[^]*?BDC([^]*?)EMC/);
  if (!m) throw new Error("no /ActualText span around the mark");
  eq(Buffer.from(m[1], "hex").swap16().toString("utf16le").replace(/^﻿/, ""), "机密文件", "ActualText");
  if ((m[2].match(/\bTj\b/g) ?? []).length < 2) throw new Error("the span doesn't hold the runs");
  const text = await pdfiumText(bytes);
  if (!text.includes("机密文件")) throw new Error(`PDFium text: ${JSON.stringify(text)}`);
});

await test("watermark: {filename} and {date}", async () => {
  const [o] = await watermark(await blank(1, "Q3 report.pdf"), { ...MARK, markText: "{filename} {date}", rotation: "0" });
  const t = (await texts(await bytesOf(o)))[0];
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (!t.includes(`Q3 report ${today}`)) throw new Error(JSON.stringify(t));
});

await test("watermark: continuous angle, background box and tile spacing", async () => {
  const [o] = await watermark(await blank(1), { ...MARK, rotation: 30, markBox: true });
  const s = await content(await bytesOf(o));
  // The box is a white filled path drawn just before the text.
  if (!/1 1 1 rg[^]*?\bf\s[^]*?BT/.test(s)) throw new Error("no background box");
  if (!/0\.866\d* 0\.5 -0\.5 0\.866\d* [\d.]+ [\d.]+ Tm/.test(s.replace(/0\.49999+\d*/g, "0.5"))) throw new Error("text not at 30°");
  const tiles = async (tileSpacing) => {
    const [t] = await watermark(await blank(1), { ...MARK, mosaic: true, tileSpacing });
    return ((await content(await bytesOf(t))).match(/\bTj\b/g) ?? []).length;
  };
  const tight = await tiles(60), loose = await tiles(200);
  if (!(tight > loose)) throw new Error(`tiles at 60%: ${tight}, at 200%: ${loose}`);
});

await test("malformed-content.pdf: page 5 (content ends inside an inline image) shows 'Page 5 of 7'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stamps-"));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, "tests/robustness/gen.mjs"), dir, "^malformed-content"], { stdio: ["ignore", "ignore", "inherit"] });
    if (r.status !== 0) throw new Error("gen.mjs failed");
    const f = fileOf(readFileSync(join(dir, "malformed-content.pdf")), "malformed-content.pdf");
    const [o] = await pageNumbers(f, { ...NUM, numberFormat: "pageNOfTotal" });
    const t = await texts(await bytesOf(o));
    if (!t[4].includes("Page 5 of 7")) throw new Error(`page 5: ${JSON.stringify(t[4])}`);
    const [w] = await watermark(f, MARK);
    const wt = await texts(await bytesOf(w));
    if (!wt[4].includes("CONFIDENTIAL")) throw new Error(`watermark page 5: ${JSON.stringify(wt[4])}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("a 3 x 3 pt page: the label and the mark shrink to stay on it", async () => {
  // pdf.js leaves out glyphs that fall outside the page, so text found means text on the page.
  const d = await PDFDocument.create();
  d.addPage([3, 3]);
  const f = fileOf(await d.save(), "tiny.pdf");
  const [o] = await pageNumbers(f, { ...NUM, numberFormat: "pageNOfTotal" });
  eq((await texts(await bytesOf(o)))[0], "Page 1 of 1", "label");
  const [w] = await watermark(f, MARK);
  eq((await texts(await bytesOf(w)))[0], "CONFIDENTIAL", "mark");
});

console.log(results.failed ? `\n${results.failed} failed` : "\nall passed");
process.exit(results.failed ? 1 : 0);
