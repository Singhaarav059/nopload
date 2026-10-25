// Make PDF accessible's report (src/lib/pdf/a11ycheck.ts, a11yreport.ts): an
// untagged file fails the tag, title and language checks and passes them
// once tagged; a picture without alt text, a scanned page, a skipped heading
// level, light text and a field without a tooltip are each flagged; the HTML
// report comes back beside the PDF, with the file's name and title escaped
// and no scripts.
//
//   node tests/a11y.mjs
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";
import { load, check, eq } from "./lib/load.mjs";

globalThis.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
const results = { failed: 0 };
const test = check(results);
const ok = (v, what) => {
  if (!v) throw new Error(what);
};
const { checkA11y, samplePages, contrastOnWhite, MAX_PAGES } = await load("a11ycheck");
const { a11yHtml } = await load("a11yreport");
const { tagPdf } = await load("tag");
const { runTool } = await load("run");
const asFile = (bytes, name = "in.pdf") => new File([bytes], name, { type: "application/pdf" });
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const result = (r, id) => r.results.find((x) => x.id === id);
const statusOf = (r, id) => result(r, id).status;
// A 2 x 2 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwnwEIGBgYGBgAAPf8Af/sQs3wAAAAAElFTkSuQmCC", "base64");
const body = "Revenue grew steadily through the year, led by new customers in the south.";

// A heading and paragraphs, with no title, language or tags; optionally a picture.
async function plain({ picture = false, color } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  page.drawText("Annual report", { x: 60, y: 770, size: 26, font: bold });
  for (let k = 0; k < 3; k++) page.drawText(body, { x: 60, y: 720 - k * 15, size: 11, font, color });
  if (picture) page.drawImage(await doc.embedPng(PNG), { x: 60, y: 420, width: 160, height: 120 });
  return doc.save();
}

// Page 1: a scan (a picture over the whole page, no text). Page 2: text.
async function scanned() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await doc.embedPng(PNG);
  doc.addPage([595, 842]).drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  doc.addPage([595, 842]).drawText(body, { x: 60, y: 720, size: 11, font });
  return doc.save();
}

// Tagged by hand: an H1, then an H3 with no H2 between.
async function skipped() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const f = page.node.newFontDictionary("F", font.ref).decodeText();
  page.node.set(PDFName.of("Contents"), ctx.register(ctx.stream(
    `/H1 <</MCID 0>> BDC BT /${f} 24 Tf 60 770 Td (Title) Tj ET EMC\n/H3 <</MCID 1>> BDC BT /${f} 14 Tf 60 730 Td (Detail) Tj ET EMC`)));
  const root = ctx.register(ctx.obj({ Type: "StructTreeRoot" }));
  const docElem = ctx.register(ctx.obj({ Type: "StructElem", S: "Document", P: root }));
  const h1 = ctx.register(ctx.obj({ Type: "StructElem", S: "H1", P: docElem, Pg: page.ref, K: 0 }));
  const h3 = ctx.register(ctx.obj({ Type: "StructElem", S: "H3", P: docElem, Pg: page.ref, K: 1 }));
  ctx.lookup(docElem).set(PDFName.of("K"), ctx.obj([h1, h3]));
  ctx.lookup(root).set(PDFName.of("K"), docElem);
  doc.catalog.set(PDFName.of("StructTreeRoot"), root);
  doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
  return doc.save();
}

await test("untagged: the tag, title and language checks fail; after tagging they pass", async () => {
  const src = await plain();
  const before = await checkA11y(src);
  eq(statusOf(before, "tagged"), "fail", "tagged before");
  eq(statusOf(before, "title"), "fail", "title before");
  eq(statusOf(before, "lang"), "fail", "lang before");
  eq(statusOf(before, "order"), "fail", "reading order before");
  eq(statusOf(before, "headings"), "na", "headings before");
  const [out] = await tagPdf(asFile(src), { title: "", lang: "" });
  const after = await checkA11y(await bytesOf(out.blob));
  for (const id of ["tagged", "title", "lang", "order", "headings", "unicode", "contrast"]) eq(statusOf(after, id), "pass", `${id} after`);
  eq(result(after, "title").key, "title.ok", "title key");
  // Tagging doesn't embed fonts: pdf-lib's standard Helvetica stays outside the file (PDF/UA-1 7.21.4.1).
  eq(result(after, "fonts").key, "fonts.notEmbedded", "fonts after");
  eq(result(after, "fonts").count, 2, "Helvetica and Helvetica-Bold");
  eq(statusOf(after, "bookmarks"), "na", "bookmarks on 1 page");
  eq(after.inspected, 1, "pages read");
});

await test("a picture without alt text is flagged, untagged and tagged", async () => {
  const src = await plain({ picture: true });
  const before = result(await checkA11y(src), "figures");
  eq(before.status, "fail", "before");
  eq(before.count, 1, "an untagged picture");
  const [out] = await tagPdf(asFile(src), { title: "", lang: "" });
  const after = result(await checkA11y(await bytesOf(out.blob)), "figures");
  eq(after.status, "fail", "after");
  eq(after.key, "figures.noAlt", "key");
  eq(after.count, 1, "a Figure without Alt");
  eq(after.pages.join(), "1", "page");
});

await test("a page that is only a picture needs OCR; a page of text doesn't", async () => {
  const r = result(await checkA11y(await scanned()), "ocr");
  eq(r.status, "fail", "status");
  eq(r.key, "ocr.scanned", "key");
  eq(r.pages.join(), "1", "pages");
  eq(statusOf(await checkA11y(await plain({ picture: true })), "ocr"), "pass", "a small picture beside text");
});

await test("a heading that skips a level is flagged", async () => {
  const r = result(await checkA11y(await skipped()), "headings");
  eq(r.status, "fail", "status");
  eq(r.key, "headings.skipped", "key");
  eq(r.count, 1, "one skip");
  eq(r.pages.join(), "1", "page");
});

await test("light grey text is flagged for contrast; black text passes", async () => {
  const r = result(await checkA11y(await plain({ color: rgb(0.8, 0.8, 0.8) })), "contrast");
  eq(r.status, "warn", "status");
  eq(r.count, 3, "three lines");
  ok(r.value > 1 && r.value < 2, `lowest contrast ${r.value}`);
  ok(Math.abs(contrastOnWhite([0, 0, 0]) - 21) < 0.01, "black on white is 21:1");
  ok(Math.abs(contrastOnWhite([0.4627, 0.4627, 0.4627]) - 4.54) < 0.05, "#767676 is 4.54:1");
});

await test("a form field without a tooltip is flagged", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  form.createTextField("name").addToPage(page, { x: 60, y: 700, width: 200, height: 20 });
  const field = form.createTextField("email");
  field.addToPage(page, { x: 60, y: 660, width: 200, height: 20 });
  field.acroField.dict.set(PDFName.of("TU"), PDFString.of("Your email address"));
  const r = result(await checkA11y(await doc.save()), "forms");
  eq(r.status, "fail", "status");
  eq(r.count, 1, "one field");
});

await test("long files: page content is read on a spread of pages", () => {
  const s = samplePages(1000);
  eq(s.length, MAX_PAGES, "how many");
  eq(s[0], 0, "first");
  eq(s.at(-1), 999, "last");
  eq(samplePages(5).join(), "0,1,2,3,4", "a short file whole");
});

await test("through runTool: the report beside the PDF, escaped, with no script and nothing loaded", async () => {
  const name = "<img src=x onerror=alert(1)>.pdf";
  const out = await runTool("accessible", [asFile(await plain({ picture: true }), name)], { accTitle: "<script>alert(1)</script>", accLang: "" });
  eq(out.length, 2, "outputs");
  eq(out[0].note, "tagged:1:1", "the PDF's note");
  eq(out[1].name, "<img src=x onerror=alert(1)>-accessibility.html", "report name");
  ok(/^a11y:\d+:\d+:\d+$/.test(out[1].note), `note ${out[1].note}`);
  const html = await out[1].blob.text();
  ok(!/<script/i.test(html), "no script");
  ok(!/<img/i.test(html), "no img element");
  ok(!/<[^>]+\s(src|href)=|url\(|@import/i.test(html), "nothing loaded");
  ok(html.includes("&lt;img src=x onerror=alert(1)&gt;.pdf"), "file name escaped");
  ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "title escaped");
  ok(/data-check="figures" data-status="fail"/.test(html), "the figure check failing");
  ok(/data-fixed>[^<]*Document title[^<]*Document language[^<]*Tags for assistive technology/.test(html), "what tagging fixed");
  const [, passed, warnings, failed] = out[1].note.split(":").map(Number);
  eq(passed + warnings + failed, (html.match(/data-status="(pass|warn|fail)"/g) ?? []).length, "note counts the checks");
});

await test("the report's words come from the dictionary given; right to left where the language is", async () => {
  const r = await checkA11y(await plain());
  const html = a11yHtml(r, { file: "x.pdf", t: (k) => `[${k}]`, locale: "ar" });
  ok(html.includes("<h1>[a11y.reportTitle]</h1>"), "the title's key");
  ok(html.includes("[a11y.msg.tagged.missing]"), "a message's key");
  ok(html.includes('<html lang="ar" dir="rtl">'), "lang and dir");
  ok(!/Accessibility report/.test(html), "no English left");
});

console.log(results.failed ? `\n${results.failed} failed` : "\nall passed");
process.exit(results.failed ? 1 : 0);
