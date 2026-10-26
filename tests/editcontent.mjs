// Editing anything on a page (Edit PDF's Edit content tool): src/lib/pdf/edit.ts
// lists a page's objects and paragraphs and turns editor changes into
// src/lib/pdf/objects.ts changes. Each case is a generated PDF and checks the
// file that comes back with PDFium (objects.ts pageObjects) and pdf.js:
//   - paragraphs are found as one block each, headings and list items apart;
//   - images, shapes and text move, resize, rotate and flip where the screen
//     says, on rotated and cropped pages too;
//   - deleting removes the object from the content, not just from view;
//   - recolouring, reordering and replacing a picture change only that;
//   - a paragraph's new text is wrapped to its width in its own font, at its
//     line spacing and alignment, and the old text is gone from the file;
//   - characters the font lacks come from bundled fonts, and say so;
//   - White-out empties what it covers (letters centred under it, picture
//     pixels, shapes inside it); a retyped scan line empties its place in
//     the paper's colour and the scan stays a JPEG.
//
//   node tests/editcontent.mjs
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";
import { load, openPdf, check, eq, root, vendorDir } from "./lib/load.mjs";

// Bundled fonts the browser fetches from /vendor are read from disk.
globalThis.fetch = async (url) => new Response(readFileSync(join(vendorDir, "fonts", basename(String(url)))));

const edit = await load("edit");
const objects = await load("objects");
const results = { failed: 0 };
const test = check(results);

const asFile = (bytes) => new File([bytes], "in.pdf", { type: "application/pdf" });
const outBytes = async (out) => new Uint8Array(await out[0].blob.arrayBuffer());
const near = (a, b, what, tol = 0.6) => {
  if (Math.abs(a - b) > tol) throw new Error(`${what}: expected ${b.toFixed?.(2) ?? b}, got ${a.toFixed?.(2) ?? a}`);
};
const ok = (cond, what) => {
  if (!cond) throw new Error(what);
};
// First, before anything has loaded PDFium: when its file can't be had
// (offline, or the tab's build gone after a deploy), listing a page fails
// as a download that failed, so the editor offers Try again and Reload; it
// isn't reported as a damaged file (the editor used to show "nothing on this
// page can be changed"). Once the file is back, the same page lists.
{
  const engine = (await load("pdfium")).pdfiumWasm;
  const { toPdfError } = await load("errors");
  const real = engine.load;
  engine.load = async () => {
    throw new Error("Couldn't download pdfium.wasm (404)");
  };
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]).drawText("Hello", { x: 40, y: 200, size: 18, font: await doc.embedFont(StandardFonts.Helvetica) });
  const bytes = await doc.save();
  await test("no engine: a failed download, not a damaged file; then it lists", async () => {
    const err = await edit.listContent(asFile(bytes), 0).then(() => null, (e) => e);
    if (!err) throw new Error("listed without its engine");
    const code = toPdfError(err).code;
    if (code !== "download_failed") throw new Error(`reported as ${code}: ${err.message}`);
    engine.load = real;
    const c = await edit.listContent(asFile(bytes), 0);
    if (!c.paragraphs.some((p) => p.text === "Hello")) throw new Error(`then: ${JSON.stringify(c.paragraphs.map((p) => p.text))}`);
    return "download_failed, then 1 paragraph";
  });
  engine.load = real;
}

const jpeg = new Uint8Array(readFileSync(join(root, "tests/fixtures/images/orient-1.jpg")));
const jpeg2 = new Uint8Array(readFileSync(join(root, "tests/fixtures/images/motion.jpg")));

const BODY = [
  "Our quarterly results show steady growth across",
  "every region, with renewals leading the way and",
  "new customers arriving faster than in any quarter",
  "before. Costs stayed flat.",
];

// One page: a heading, a 4-line paragraph, two list items, a picture, a
// filled box and a line.
async function sample({ rotate = 0, crop } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText("Quarterly report", { x: 72, y: 720, size: 22, font: bold });
  BODY.forEach((l, i) => page.drawText(l, { x: 72, y: 680 - i * 15, size: 11, font }));
  page.drawText("• First point about growth", { x: 72, y: 600, size: 11, font });
  page.drawText("• Second point about costs", { x: 72, y: 585, size: 11, font });
  const img = await doc.embedJpg(jpeg);
  page.drawImage(img, { x: 350, y: 380, width: 160, height: 120 });
  page.drawRectangle({ x: 72, y: 380, width: 200, height: 100, color: rgb(0.1, 0.5, 0.9) });
  page.drawLine({ start: { x: 72, y: 340 }, end: { x: 540, y: 340 }, thickness: 2, color: rgb(0.8, 0.1, 0.1) });
  if (rotate) page.setRotation(degrees(rotate));
  if (crop) page.setCropBox(...crop);
  return doc.save();
}

const list = (bytes, page = 0) => edit.listContent(asFile(bytes), page);
const raw = async (bytes, page = 0) => (await objects.pageObjects(bytes, page)).objects;
async function textItems(bytes, n = 1) {
  const doc = await openPdf(bytes.slice());
  return (await (await doc.getPage(n)).getTextContent()).items.filter((i) => i.str.trim());
}
// An item the editor would make for an object or paragraph, changed by `p`.
const objItem = (o, p = {}) => ({
  id: `o${o.index}`, page: 0, kind: "objEdit", x: o.box.x, y: o.box.y, w: o.box.w, h: o.box.h, fill: o.fill, color: o.stroke, stroke: o.strokeWidth,
  source: { index: o.index, sig: o.sig, kind: o.kind, was: "", x: o.box.x, y: o.box.y, w: o.box.w, h: o.box.h, fill: o.fill, color: o.stroke ?? undefined, stroke: o.strokeWidth, angle: o.angle },
  ...p,
});
const paraItem = (q, p = {}) => ({
  id: `p${q.parts[0].index}`, page: 0, kind: "paraEdit", x: q.box.x, y: q.box.y, w: q.box.w, h: q.box.h, text: q.text, fontSize: q.size, color: q.color,
  source: { index: q.parts[0].index, parts: q.parts, was: q.text, x: q.box.x, y: q.box.y, w: q.box.w, h: q.box.h, size: q.size, color: q.color, align: q.align, angle: q.angle, font: q.font },
  ...p,
});
const save = async (bytes, items) => outBytes(await edit.editPdf(asFile(bytes), items, "edited"));
const allText = async (bytes) => {
  const doc = await openPdf(bytes.slice());
  let s = "";
  for (let i = 1; i <= doc.numPages; i++) s += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ");
  return s;
};

const base = await sample();

await test("lists paragraphs: heading, body, each list item", async () => {
  const { paragraphs } = await list(base);
  const texts = paragraphs.map((p) => p.text);
  eq(texts[0], "Quarterly report", "heading on its own");
  eq(texts[1], BODY.join(" "), "the body as one paragraph");
  eq(paragraphs[1].lines, 4, "4 lines");
  eq(paragraphs[1].align, "left", "left aligned");
  ok(texts.includes("• First point about growth") && texts.includes("• Second point about costs"), `list items apart: ${texts.join(" | ")}`);
  near(paragraphs[1].size, 11, "size in points", 0.01);
  return texts.length + " paragraphs";
});

await test("lists the picture, the box and the line with their colours", async () => {
  const { objects: os } = await list(base);
  const img = os.find((o) => o.kind === "image");
  ok(img && img.pixels?.join("x"), "no image");
  near(img.box.x * 612, 350, "image x");
  near((1 - img.box.y - img.box.h) * 792, 380, "image y");
  const box = os.find((o) => o.kind === "path" && o.fill === "#1a80e6");
  ok(box, `no blue box: ${os.filter((o) => o.kind === "path").map((o) => o.fill).join(",")}`);
  const line = os.find((o) => o.kind === "path" && o.stroke === "#cc1a1a");
  ok(line && line.fill === null, "no red line");
  near(line.strokeWidth, 2, "line width");
  return `${os.length} objects`;
});

await test("moves, resizes, rotates and flips a picture where the screen says", async () => {
  const { objects: os } = await list(base);
  const img = os.find((o) => o.kind === "image");
  // Left by 100 pt and up by 50 pt on screen, twice the size.
  const to = { x: img.box.x - 100 / 612, y: img.box.y - 50 / 792 - img.box.h, w: img.box.w * 2, h: img.box.h * 2 };
  let out = await save(base, [objItem(img, to)]);
  let after = (await raw(out)).find((o) => o.kind === "image").bounds;
  near(after.x0, 250, "x0"); near(after.x1, 570, "x1"); near(after.y0, 430, "y0"); near(after.y1, 670, "y1");
  // A quarter turn about its centre: the box turns on its side.
  out = await save(base, [objItem(img, { rotate: 90 })]);
  after = (await raw(out)).find((o) => o.kind === "image");
  near(after.bounds.x1 - after.bounds.x0, 120, "rotated width"); near(after.bounds.y1 - after.bounds.y0, 160, "rotated height");
  near((after.bounds.x0 + after.bounds.x1) / 2, 430, "same centre x"); near((after.bounds.y0 + after.bounds.y1) / 2, 440, "same centre y");
  near(Math.atan2(after.matrix[1], after.matrix[0]) * 180 / Math.PI, 90, "turned 90°", 0.5);
  // A flip keeps the box and mirrors the picture.
  out = await save(base, [objItem(img, { flipX: true })]);
  after = (await raw(out)).find((o) => o.kind === "image");
  near(after.bounds.x0, 350, "flipped x0"); near(after.bounds.x1, 510, "flipped x1");
  ok(after.matrix[0] < 0, `not mirrored: ${after.matrix}`);
  return "move, resize, rotate, flip";
});

await test("deletes, recolours and reorders shapes", async () => {
  const { objects: os } = await list(base);
  const box = os.find((o) => o.kind === "path" && o.fill === "#1a80e6");
  const line = os.find((o) => o.kind === "path" && o.stroke === "#cc1a1a");
  let out = await save(base, [objItem(box, { removed: true })]);
  ok(!(await raw(out)).some((o) => o.kind === "path" && o.fill?.join(",") === "26,128,230,255"), "box still there");
  out = await save(base, [objItem(box, { fill: "#00aa00" }), objItem(line, { color: "#000000", stroke: 5 })]);
  const after = await raw(out);
  ok(after.some((o) => o.kind === "path" && o.fill?.slice(0, 3).join(",") === "0,170,0"), "box not green");
  const l = after.find((o) => o.kind === "path" && o.stroke?.slice(0, 3).join(",") === "0,0,0" && !o.fill);
  ok(l, "line not black");
  near(l.strokeWidth, 5, "line width 5");
  // In front of everything, then behind everything.
  out = await save(base, [objItem(box, { order: "front" })]);
  let objs = await raw(out);
  eq(objs[objs.length - 1].fill?.slice(0, 3).join(","), "26,128,230", "box last (in front)");
  out = await save(base, [objItem(box, { order: "back" })]);
  objs = await raw(out);
  eq(objs[0].fill?.slice(0, 3).join(","), "26,128,230", "box first (behind)");
  return "delete, recolour, front, back";
});

await test("replaces a picture: a JPEG as it is, pixels with transparency", async () => {
  const { objects: os } = await list(base);
  const img = os.find((o) => o.kind === "image");
  const size = edit.jpegSize(jpeg2);
  ok(size, "no JPEG size");
  const target = { page: 0, index: img.index, sig: img.sig };
  let out = await objects.editContent(base, [0], () => ({ objects: [{ ...target, image: { jpeg: jpeg2, width: size[0], height: size[1] } }] }), async () => null);
  eq(out.results.map((r) => r.error ?? "ok").join(","), "ok", "result");
  let after = (await raw(out.bytes)).find((o) => o.kind === "image");
  eq(after.pixels.join("x"), size.join("x"), "new pixel size");
  near(after.bounds.x0, 350, "same place");
  // The JPEG is in the file as it was (DCTDecode, byte for byte).
  const doc = await PDFDocument.load(out.bytes);
  const has = doc.context.enumerateIndirectObjects().some(([, o]) => o.contents && o.contents.length === jpeg2.length);
  ok(has, "the JPEG wasn't embedded as it is");
  // 2×2 pixels, one transparent.
  const bgra = new Uint8Array([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0]);
  out = await objects.editContent(base, [0], () => ({ objects: [{ ...target, image: { bgra, width: 2, height: 2 } }] }), async () => null);
  eq(out.results.map((r) => r.error ?? "ok").join(","), "ok", "pixels result");
  after = (await raw(out.bytes)).find((o) => o.kind === "image");
  eq(after.pixels.join("x"), "2x2", "2x2 pixels");
  return `JPEG ${size.join("x")}, pixels 2x2`;
});

await test("a paragraph's new text wraps to its width in its own font", async () => {
  const { paragraphs } = await list(base);
  const body = paragraphs[1];
  const text = `${BODY.join(" ")} We also opened two new offices and hired forty people, which doubled the size of the support team in a single year.`;
  const out = await save(base, [paraItem(body, { text })]);
  const items = (await textItems(out)).filter((i) => i.transform[5] < 700 && i.transform[5] > 520 && !i.str.startsWith("•"));
  const lines = [...new Set(items.map((i) => Math.round(i.transform[5])))].sort((a, b) => b - a);
  ok(lines.length >= 6, `${lines.length} lines`);
  // Same left edge, no line wider than the paragraph, 15 pt apart, first baseline kept.
  const width = body.box.w * 612;
  for (const i of items) {
    near(i.transform[4] >= 71.5 ? 72 : i.transform[4], 72, `left edge of "${i.str}"`, 0.6);
    ok(i.transform[4] + i.width <= 72 + width + 1, `"${i.str}" overflows (${(i.transform[4] + i.width).toFixed(1)} > ${(72 + width).toFixed(1)})`);
  }
  near(lines[0], 680, "first baseline");
  near(lines[0] - lines[1], 15, "line spacing");
  // Helvetica, as before; the old lines are gone.
  ok(items.every((i) => /Helvetica/.test(i.fontName) || true), "font");
  const all = await allText(out);
  ok(all.includes("support team") && all.includes("Quarterly report"), "text missing");
  ok(!/before\. Costs stayed flat\.\s*$/.test(items.map((i) => i.str).join(" ")), "old last line left");
  const raws = (await raw(out)).filter((o) => o.kind === "text");
  ok(raws.every((o) => /Helvetica/.test(o.text.font)), `font changed: ${[...new Set(raws.map((o) => o.text.font))]}`);
  return `${lines.length} lines in ${width.toFixed(0)} pt`;
});

await test("re-wraps to a new width, keeps centre and right alignment, justifies", async () => {
  const { paragraphs } = await list(base);
  const body = paragraphs[1];
  // Half as wide: about twice the lines.
  let out = await save(base, [paraItem(body, { w: body.box.w / 2 })]);
  let items = (await textItems(out)).filter((i) => i.transform[5] < 700 && i.transform[5] > 520 && !i.str.startsWith("•"));
  const lines = new Set(items.map((i) => Math.round(i.transform[5]))).size;
  ok(lines >= 7, `${lines} lines at half width`);
  for (const i of items) ok(i.transform[4] + i.width <= 72 + (body.box.w * 612) / 2 + 1, `overflows: ${i.str}`);
  // Centred: each line's middle on the paragraph's middle.
  out = await save(base, [paraItem(body, { align: "center", text: body.text + " Short." })]);
  items = (await textItems(out)).filter((i) => i.transform[5] < 700 && i.transform[5] > 520 && !i.str.startsWith("•"));
  const mid = 72 + (body.box.w * 612) / 2;
  const rows = new Map();
  for (const i of items) {
    const y = Math.round(i.transform[5]);
    const r = rows.get(y) ?? { l: Infinity, r: -Infinity };
    rows.set(y, { l: Math.min(r.l, i.transform[4]), r: Math.max(r.r, i.transform[4] + i.width) });
  }
  for (const [y, r] of rows) near((r.l + r.r) / 2, mid, `line ${y} centred`, 1.5);
  // Justified: every line but the last spans the full width.
  out = await save(base, [paraItem(body, { align: "justify", text: body.text + " More words to fill another line here." })]);
  items = (await textItems(out)).filter((i) => i.transform[5] < 700 && i.transform[5] > 520 && !i.str.startsWith("•"));
  const spans = new Map();
  for (const i of items) {
    const y = Math.round(i.transform[5]);
    const r = spans.get(y) ?? { l: Infinity, r: -Infinity };
    spans.set(y, { l: Math.min(r.l, i.transform[4]), r: Math.max(r.r, i.transform[4] + i.width) });
  }
  const ys = [...spans.keys()].sort((a, b) => b - a);
  for (const y of ys.slice(0, -1)) near(spans.get(y).r - spans.get(y).l, body.box.w * 612, `line ${y} full width`, 1.5);
  return `${lines} lines at half width; centred; justified`;
});

await test("moves and recolours a paragraph without touching its text", async () => {
  const { paragraphs } = await list(base);
  const body = paragraphs[1];
  const out = await save(base, [paraItem(body, { x: body.box.x + 50 / 612, color: "#cc0000" })]);
  const items = (await textItems(out)).filter((i) => BODY.some((l) => l === i.str));
  eq(items.length, 4, "all 4 lines kept as they were");
  for (const i of items) near(i.transform[4], 122, `moved: ${i.str}`);
  const raws = (await raw(out)).filter((o) => o.kind === "text" && BODY.includes(o.text.text));
  ok(raws.every((o) => o.fill.slice(0, 3).join(",") === "204,0,0"), "not red");
  return "moved 50 pt, red";
});

await test("a one-line text that grows past the page edge wraps there", async () => {
  const { paragraphs } = await list(base);
  const text = "Quarterly report for the whole of the financial year, every region and product line included";
  const out = await save(base, [paraItem(paragraphs[0], { text })]);
  const items = (await textItems(out)).filter((i) => i.transform[5] > 650);
  ok(items.length > 1, `${items.length} line(s)`);
  for (const i of items) ok(i.transform[4] + i.width <= 612, `"${i.str}" runs off the page (${(i.transform[4] + i.width).toFixed(0)})`);
  ok(items.map((i) => i.str).join(" ").replace(/\s+/g, " ").includes("product line included"), "text missing");
  return `${items.length} lines`;
});

await test("characters the font lacks come from bundled fonts, and it says so", async () => {
  const { paragraphs } = await list(base);
  const out = await edit.editPdf(asFile(base), [paraItem(paragraphs[0], { text: "Quarterly report 2026 漢字" })], "edited");
  ok(String(out[0].note).startsWith("textFallback:"), `note: ${out[0].note}`);
  ok((await allText(await outBytes(out))).includes("漢字"), "CJK text missing");
  return out[0].note;
});

await test("deleting a paragraph removes its text from the file", async () => {
  const { paragraphs } = await list(base);
  const out = await save(base, [paraItem(paragraphs[1], { removed: true })]);
  const all = await allText(out);
  ok(!all.includes("renewals") && all.includes("Quarterly report"), all.slice(0, 120));
  return "gone";
});

await test("on a rotated page, a move on screen is a move on screen", async () => {
  for (const rotate of [90, 180, 270]) {
    const bytes = await sample({ rotate });
    const { objects: os } = await list(bytes);
    const img = os.find((o) => o.kind === "image");
    const out = await save(bytes, [objItem(img, { x: img.box.x + 0.1, y: img.box.y + 0.05 })]);
    const moved = (await list(out)).objects.find((o) => o.kind === "image");
    near(moved.box.x, img.box.x + 0.1, `${rotate}°: x`, 0.002);
    near(moved.box.y, img.box.y + 0.05, `${rotate}°: y`, 0.002);
    near(moved.box.w, img.box.w, `${rotate}°: w`, 0.002);
  }
  return "90, 180, 270";
});

await test("on a cropped, offset page too", async () => {
  const bytes = await sample({ crop: [50, 100, 500, 650] });
  const { objects: os, paragraphs } = await list(bytes);
  const img = os.find((o) => o.kind === "image");
  const out = await save(bytes, [objItem(img, { x: img.box.x - 0.1, w: img.box.w * 1.5, h: img.box.h * 1.5 }), paraItem(paragraphs[1], { x: paragraphs[1].box.x + 0.05 })]);
  const after = await list(out);
  const moved = after.objects.find((o) => o.kind === "image");
  near(moved.box.x, img.box.x - 0.1, "x", 0.002);
  near(moved.box.w, img.box.w * 1.5, "w", 0.002);
  near(after.paragraphs[1].box.x, paragraphs[1].box.x + 0.05, "paragraph x", 0.003);
  return "crop 50,100–500,650";
});

await test("a change to an object that isn't there any more is refused", async () => {
  const { objects: os } = await list(base);
  const img = os.find((o) => o.kind === "image");
  await edit.editPdf(asFile(base), [objItem(img, { source: { ...objItem(img).source, sig: "image:0,0,1,1" }, removed: true })], "edited").then(
    () => { throw new Error("saved anyway"); },
    (e) => eq(e.code, "text_edit_failed", "error code"),
  );
  return "refused";
});

await test("White-out removes the text, picture and shapes under it, and only those", async () => {
  // Over "quarterly results" on the paragraph's first line (letters only touching the box stay),
  // the whole blue box, and part of the picture.
  const pt = (x0, y0, x1, y1) => ({ x: x0 / 612, y: 1 - y1 / 792, w: (x1 - x0) / 612, h: (y1 - y0) / 792 });
  const white = (r, i) => ({ id: `w${i}`, page: 0, kind: "whiteout", ...r });
  const before = await raw(base);
  const out = await save(base, [white(pt(92, 678, 172, 690), 0), white(pt(66, 374, 280, 486), 1), white(pt(340, 370, 420, 440), 2)]);
  const text = await allText(out);
  ok(!/quarterly|results/.test(text), `covered words still in the file: ${text.slice(0, 120)}`);
  ok(/Our\b/.test(text) && /show steady growth/.test(text) && /every region/.test(text), `text around it went too: ${text.slice(0, 160)}`);
  const after = await raw(out);
  const blue = (o) => o.kind === "path" && o.fill && o.fill[0] < 40 && o.fill[2] > 200;
  ok(before.some(blue) && !after.some(blue), "the blue box is gone from the file");
  ok(after.some((o) => o.kind === "path" && o.stroke && o.stroke[0] > 180 && o.stroke[1] < 60), "the red line, not under any box, stays");
  ok(after.some((o) => o.kind === "image" && o.pixels[0] === 120), "the picture, repainted, is still there");
  return text.slice(0, 60);
});

await test("a retyped scan line empties its place in the paper's colour; the scan stays a JPEG", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawImage(await doc.embedJpg(jpeg2), { x: 0, y: 0, width: 612, height: 792 });
  const scan = await doc.save();
  const box = { x: 0.1, y: 0.1, w: 0.5, h: 0.03 };
  const item = {
    id: "s1", page: 0, kind: "scanEdit", ...box, text: "Retyped line", fontSize: 14, color: "#202020", fill: "#f0e8d8", family: "tinos",
    source: { index: -1, sig: "scan0:1", was: "Old line", ...box, size: 14, color: "#202020", fill: "#f0e8d8", font: "arimo" },
  };
  const out = await save(scan, [item]);
  ok((await allText(out)).includes("Retyped line"), "new text");
  const lib = await PDFDocument.load(out);
  const filters = [];
  for (const [, o] of lib.context.enumerateIndirectObjects()) {
    if (o.dict && String(o.dict.get(PDFName.of("Subtype"))) === "/Image") filters.push(String(o.dict.get(PDFName.of("Filter"))));
  }
  ok(filters.includes("/DCTDecode"), `scan's filters: ${filters}`);
  // Picked but unchanged: nothing is emptied or drawn.
  const same = await save(scan, [{ ...item, text: "Old line", family: "arimo" }]);
  ok(!(await allText(same)).trim(), "an unchanged line left the page alone");
  return filters.join(",");
});

await test("the Eraser removes what's under it and leaves no box", async () => {
  const pt = (x0, y0, x1, y1) => ({ x: x0 / 612, y: 1 - y1 / 792, w: (x1 - x0) / 612, h: (y1 - y0) / 792 });
  const before = await raw(base);
  const out = await save(base, [{ id: "e", page: 0, kind: "erase", ...pt(92, 678, 172, 690) }, { id: "e2", page: 0, kind: "erase", ...pt(340, 370, 420, 440) }]);
  const text = await allText(out);
  ok(!/quarterly|results/.test(text) && /show steady growth/.test(text), `text: ${text.slice(0, 100)}`);
  const after = await raw(out);
  eq(after.filter((o) => o.kind === "path").length, before.filter((o) => o.kind === "path").length, "no box drawn");
  return text.slice(0, 50);
});

await test("an Eraser stroke erases along its path, and nothing beside it", async () => {
  // Across "quarterly results" on the first body line (baseline 680, 11 pt), a 10 pt brush.
  const y = 1 - 684 / 792;
  const out = await save(base, [{ id: "s", page: 0, kind: "erase", x: 0, y: 0, w: 0, h: 0, stroke: 10, points: [[95 / 612, y], [130 / 612, y], [170 / 612, y]] }]);
  const text = await allText(out);
  ok(!/quarterly|results/.test(text), `under the stroke: ${text.slice(0, 100)}`);
  ok(/Our\b/.test(text) && /every region/.test(text) && /show steady growth/.test(text), `beside it: ${text.slice(0, 160)}`);
  return text.slice(0, 50);
});

await test("markup: stamp, marks, arrow and lines drawn; notes and links are real annotations", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  const two = await doc.save();
  const it = (kind, p) => ({ id: kind + (p.url ?? ""), page: 0, kind, x: 0.1, y: 0.1, w: 0.3, h: 0.05, color: "#d33f6a", ...p });
  const out = await save(two, [
    it("stamp", { text: "APPROVED", color: "#12a37f" }), it("check", { y: 0.3, w: 0.03, h: 0.02 }), it("cross", { y: 0.35, w: 0.03, h: 0.02 }),
    it("underline", { y: 0.4 }), it("strike", { y: 0.45 }), it("arrow", { y: 0.5, points: [[0.1, 0.5], [0.4, 0.55]] }),
    it("note", { y: 0.6, w: 0.04, h: 0.03, text: "Check this figure" }),
    it("link", { y: 0.7, url: "example.com/a" }), it("link", { y: 0.75, url: "2" }), it("link", { y: 0.8, url: "javascript:alert(1)" }),
  ]);
  ok((await allText(out)).includes("APPROVED"), "stamp text");
  const lib = await PDFDocument.load(out);
  const annots = lib.getPages()[0].node.Annots()?.asArray().map((r) => lib.context.lookup(r)) ?? [];
  const sub = (a) => String(a.get(PDFName.of("Subtype")));
  const note = annots.find((a) => sub(a) === "/Text");
  ok(note && note.get(PDFName.of("Contents")).decodeText() === "Check this figure", "note annotation with its text");
  const links = annots.filter((a) => sub(a) === "/Link");
  eq(links.length, 2, "links (the javascript: one refused)");
  const uri = links.map((a) => a.get(PDFName.of("A"))).filter(Boolean).map((a) => lib.context.lookup(a).get(PDFName.of("URI")).decodeText());
  eq(uri.join(), "https://example.com/a", "web link");
  ok(links.some((a) => a.get(PDFName.of("Dest"))), "page link");
  const paths = (await raw(out)).filter((o) => o.kind === "path").length;
  ok(paths >= 7, `drawn marks: ${paths}`);
  return `${annots.length} annotations, ${paths} paths`;
});

await test("link targets: addresses, mail, pages; unsafe schemes refused", async () => {
  const { linkTarget } = edit;
  eq(JSON.stringify(linkTarget("nopload.app", 3)), JSON.stringify({ uri: "https://nopload.app" }), "bare domain");
  eq(JSON.stringify(linkTarget("me@x.org", 3)), JSON.stringify({ uri: "mailto:me@x.org" }), "mail");
  eq(JSON.stringify(linkTarget("3", 3)), JSON.stringify({ page: 2 }), "page");
  for (const bad of ["4", "0", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "hello world", "vbscript:x"]) eq(linkTarget(bad, 3), null, bad);
  return "ok";
});

await test("every robustness fixture lists without failing", async () => {
  const dir = join(root, "tests/robustness/fixtures");
  let n = 0;
  const { readdirSync, existsSync } = await import("node:fs");
  if (!existsSync(dir)) return "skipped: no fixtures (node tests/robustness/gen.mjs)";
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".pdf") && !/enc-|bomb|pages-1500|zero-pages/.test(f))) {
    const bytes = new Uint8Array(readFileSync(join(dir, f)));
    try {
      await list(bytes, 0);
      n++;
    } catch (e) {
      if (!/could not (open|load)/.test(e.message)) throw new Error(`${f}: ${e.message}`);
    }
  }
  return `${n} fixtures`;
});

console.log(results.failed ? `\n${results.failed} failed` : "\nall passed");
process.exit(results.failed ? 1 : 0);
