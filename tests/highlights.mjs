// The viewer's highlights saved into the PDF (src/lib/pdf/highlights.ts):
// real Highlight annotations over the place they were made, on upright and
// turned pages alike, with the highlighted text and an appearance, and the
// rest of the file unchanged.
//
//   node tests/highlights.mjs
import { PDFDocument, PDFName, StandardFonts, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { withHighlights } from "../src/lib/pdf/highlights.ts";

let failed = 0;
const test = async (label, fn) => {
  try {
    const r = await fn();
    console.log(`ok    ${label}${r ? `: ${r}` : ""}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${label}: ${e.message}`);
  }
};
const ok = (c, what) => {
  if (!c) throw new Error(what);
};
const near = (a, b, what) => ok(Math.abs(a - b) < 0.6, `${what}: ${a} vs ${b}`);

// A 600×800 page with a word at 100,700 (PDF space), and the same page turned.
async function make(angle) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.drawText("Highlight me", { x: 100, y: 700, size: 20, font: await doc.embedFont(StandardFonts.Helvetica) });
  if (angle) page.setRotation(degrees(angle));
  return doc.save();
}

// Where (fraction of the page as shown) the PDF point lands, per rotation.
const shown = { 0: (x, y) => [x / 600, 1 - y / 800], 90: (x, y) => [y / 800, x / 600], 180: (x, y) => [1 - x / 600, y / 800], 270: (x, y) => [1 - y / 800, 1 - x / 600] };

for (const angle of [0, 90, 180, 270]) {
  await test(`a highlight lands on the word, page turned ${angle}°`, async () => {
    // The box from PDF (100,695)–(220,720) expressed as shown.
    const [ax, ay] = shown[angle](100, 720), [bx, by] = shown[angle](220, 695);
    const box = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
    const out = await withHighlights(await make(angle), [{ id: "1", page: 0, boxes: [box], color: "yellow", text: "Highlight me" }]);
    const pdf = await getDocument({ data: out, verbosity: 0 }).promise;
    const [annot] = await (await pdf.getPage(1)).getAnnotations();
    ok(annot?.subtype === "Highlight", `annotation: ${annot?.subtype}`);
    ok(annot.contentsObj?.str === "Highlight me", `contents: ${annot.contentsObj?.str}`);
    const [x1, y1, x2, y2] = annot.rect;
    near(x1, 100, "left"); near(y1, 695, "bottom"); near(x2, 220, "right"); near(y2, 720, "top");
    return annot.rect.map((n) => Math.round(n)).join(",");
  });
}

await test("an appearance is included, and the page's text is untouched", async () => {
  const src = await make(0);
  const out = await withHighlights(src, [{ id: "1", page: 0, boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.03 }], color: "green", text: "x" }]);
  const doc = await PDFDocument.load(out);
  const annots = doc.getPage(0).node.Annots();
  const dict = doc.context.lookup(annots.get(0));
  ok(dict.get(PDFName.of("AP")), "no appearance");
  const pdf = await getDocument({ data: out, verbosity: 0 }).promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join("");
  ok(text.includes("Highlight me"), `text: ${text}`);
});

await test("several highlights on several pages, none dropped", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  doc.addPage([600, 800]);
  const out = await withHighlights(await doc.save(), [
    { id: "a", page: 0, boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }, { x: 0.1, y: 0.13, w: 0.1, h: 0.02 }], color: "yellow", text: "a" },
    { id: "b", page: 1, boxes: [{ x: 0.5, y: 0.5, w: 0.2, h: 0.02 }], color: "pink", text: "b" },
    { id: "c", page: 7, boxes: [{ x: 0.5, y: 0.5, w: 0.2, h: 0.02 }], color: "pink", text: "no such page" },
  ]);
  const pdf = await getDocument({ data: out, verbosity: 0 }).promise;
  const counts = await Promise.all([1, 2].map(async (n) => (await (await pdf.getPage(n)).getAnnotations()).length));
  ok(counts[0] === 1 && counts[1] === 1, `annotations per page: ${counts}`);
  return counts.join(" + ");
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
