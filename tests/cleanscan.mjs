// Clean up scans: a PDF of two scan-like pages (grey paper, 3° crooked, on a
// dark scanner bed, the second also turned on its side) and one page of real
// text goes through the tool as the workspace runs it (runTool). The scans
// must come back upright, straight, white and without the border, at their
// page size; the text page untouched; and with OCR on (a stand-in engine),
// searchable. Then the looks: greyscale and black and white pictures, and
// photos left looking like photos.
//
//   node tests/cleanscan.mjs
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from "pdf-lib";
import { load, openPdf, check, eq, nodeCanvas } from "./lib/load.mjs";

nodeCanvas();
globalThis.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
const results = { failed: 0 };
const test = check(results);
const { TOOLS, defaultOptions } = await load("../tools");
const { runTool } = await load("run");
const { engine } = await load("ocr");
const { cleanImage, whiten } = await load("cleanscan");
const { deskew, estimateSkew, grayOf, grayPng, rotate90 } = await load("ocrprep");

const deg = Math.PI / 180;
const DPI = 150;
const W = 880, H = 1240; // the paper, in pixels at 150 dpi (A5)
const M = 60; // the scanner bed showing around it
const PAPER = 188, BED = 30;

// The original document: a dark letterhead bar top left (to tell which way
// up a page is), then lines of text.
function documentImage() {
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.fillRect(70, 60, 260, 50);
  ctx.font = "24px DejaVu Sans";
  const words = "The quarterly budget keeps the library open longer, with help desk staff through the holidays and a reading group for older people. Please bring your signed form back by Friday; ask the front desk if anything is unclear.".split(" ");
  let y = 180;
  for (let line = 0; y < H - 90; line++, y += 40) {
    const start = (line * 7) % words.length;
    ctx.fillText(Array.from({ length: 9 }, (_, k) => words[(start + k) % words.length]).join(" "), 70, y);
  }
  return grayOf(ctx.getImageData(0, 0, W, H));
}

// As a phone or a cheap scanner gives it: grey paper, on a dark bed, turned 3° clockwise.
function scanOf(doc) {
  const frame = { w: W + 2 * M, h: H + 2 * M, data: new Uint8Array((W + 2 * M) * (H + 2 * M)).fill(BED) };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) frame.data[(y + M) * frame.w + x + M] = Math.round((doc.data[y * W + x] * PAPER) / 255);
  return deskew(frame, -3 * deg, BED);
}

const docImage = documentImage();
const scan = scanOf(docImage);
const sideways = rotate90(scan, 1);

async function inputPdf() {
  const pdf = await PDFDocument.create();
  for (const img of [scan, sideways]) {
    const png = await pdf.embedPng(grayPng(img));
    const [w, h] = [(img.w * 72) / DPI, (img.h * 72) / DPI];
    pdf.addPage([w, h]).drawImage(png, { x: 0, y: 0, width: w, height: h });
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([420, 595]).drawText("A typed page with real text on it, which stays exactly as it is.", { x: 40, y: 540, size: 10, font });
  return pdf.save();
}
const input = await inputPdf();

const options = (extra = {}) => ({ ...defaultOptions(TOOLS.find((t) => t.id === "cleanScans")), dpi: String(DPI), ...extra });
const run = async (extra) => {
  const [out] = await runTool("cleanScans", [new File([input], "scans.pdf")], options(extra));
  return { out, bytes: new Uint8Array(await out.blob.arrayBuffer()) };
};

// A page of the result as a viewer shows it (its /Rotate applied), grey, at 150 dpi.
async function shown(bytes, n) {
  // pdf.js takes the buffer over: it gets a copy.
  const page = await (await openPdf(bytes.slice())).getPage(n);
  const vp = page.getViewport({ scale: DPI / 72 });
  const c = createCanvas(Math.round(vp.width), Math.round(vp.height));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return grayOf(ctx.getImageData(0, 0, c.width, c.height));
}
const darkIn = (g, x0, y0, x1, y1, below = 100) => {
  let n = 0;
  for (let y = Math.round(y0 * g.h); y < Math.round(y1 * g.h); y++)
    for (let x = Math.round(x0 * g.w); x < Math.round(x1 * g.w); x++) if (g.data[y * g.w + x] < below) n++;
  return n / ((Math.round(x1 * g.w) - Math.round(x0 * g.w)) * (Math.round(y1 * g.h) - Math.round(y0 * g.h)));
};
const median = (g) => {
  const s = Array.from(g.data.filter((_, i) => i % 7 === 0)).sort((a, b) => a - b);
  return s[s.length >> 1];
};
const contents = async (bytes, n) => {
  const doc = await PDFDocument.load(bytes);
  const c = doc.getPage(n - 1).node.Contents();
  const parts = c instanceof PDFRawStream ? [c] : c.asArray().map((r) => doc.context.lookup(r));
  return Buffer.concat(parts.map((p) => Buffer.from(decodePDFRawStream(p).decode()))).toString("latin1");
};
const pictures = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  return doc.context.enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream && String(o.dict.get(PDFName.of("Subtype"))) === "/Image")
    .map(([, o]) => ({ bits: Number(String(o.dict.get(PDFName.of("BitsPerComponent")))), space: String(o.dict.get(PDFName.of("ColorSpace"))), filter: String(o.dict.get(PDFName.of("Filter"))), size: o.contents.length }));
};

console.log(`      input skew ${(estimateSkew(scan) / deg).toFixed(1)}°, paper ${PAPER}, bed ${BED}`);

// ── Without OCR: the cleanup itself

const plain = await run({ cleanOcr: false });
await test("both scans cleaned, the text page not", async () => {
  eq(plain.out.note, "cleaned:2", "note");
  eq((await PDFDocument.load(plain.bytes)).getPageCount(), 3, "page count");
});

await test("the text page is untouched", async () => {
  eq(await contents(plain.bytes, 3), await contents(input, 3), "content stream");
});

for (const [n, name] of [[1, "crooked scan"], [2, "sideways scan"]]) {
  const g = await shown(plain.bytes, n);
  await test(`${name}: upright, the right way round`, async () => {
    eq(g.h > g.w, true, `portrait as shown (${g.w}×${g.h})`);
    // The letterhead bar is top left, not bottom right.
    const tl = darkIn(g, 0.05, 0.03, 0.45, 0.12), br = darkIn(g, 0.55, 0.88, 0.95, 0.97);
    if (!(tl > 0.15 && tl > br * 3)) throw new Error(`letterhead not top left (top left ${tl.toFixed(3)}, bottom right ${br.toFixed(3)})`);
  });
  await test(`${name}: straight`, async () => {
    const skew = estimateSkew(g) / deg;
    if (Math.abs(skew) >= 0.5) throw new Error(`still ${skew.toFixed(2)}° crooked`);
    console.log(`      skew left ${skew.toFixed(2)}°`);
  });
  await test(`${name}: white paper, no dark border`, async () => {
    const m = median(g);
    if (m < 245) throw new Error(`paper is ${m}, not white`);
    // The outer 3% on every side: no bed left there.
    const edges = [darkIn(g, 0, 0, 1, 0.03), darkIn(g, 0, 0.97, 1, 1), darkIn(g, 0, 0, 0.03, 1), darkIn(g, 0.97, 0, 1, 1)];
    if (Math.max(...edges) > 0.01) throw new Error(`dark edges: ${edges.map((e) => e.toFixed(3)).join(", ")}`);
    console.log(`      paper ${m}, darkest edge ${(Math.max(...edges) * 100).toFixed(2)}% dark`);
  });
}

await test("the scans keep their page size", async () => {
  const [a, b] = [await PDFDocument.load(input), await PDFDocument.load(plain.bytes)];
  for (const i of [0, 1]) {
    const [p, q] = [a.getPage(i).getSize(), b.getPage(i).getSize()];
    if (Math.abs(p.width - q.width) > 0.01 || Math.abs(p.height - q.height) > 0.01) throw new Error(`page ${i + 1}: ${p.width}×${p.height} became ${q.width}×${q.height}`);
  }
});

await test("keep colour stores a grey scan as one grey JPEG a page", async () => {
  const imgs = await pictures(plain.bytes);
  eq(imgs.length, 2, "pictures");
  for (const i of imgs) eq(`${i.space} ${i.filter} ${i.bits}`, "/DeviceGray /DCTDecode 8", "picture");
});

// ── With OCR: a stand-in engine that reads two words where the letterhead is.

let recognised = 0;
engine.create = async () => ({
  recognise: async () => {
    recognised++;
    return {
      confidence: 92,
      blocks: [{ paragraphs: [{ lines: [{ words: [
        { text: "Quarterly", confidence: 92, bbox: { x0: 70, y0: 160, x1: 230, y1: 186 } },
        { text: "budget", confidence: 92, bbox: { x0: 240, y0: 160, x1: 330, y1: 186 } },
      ] }] }] }],
    };
  },
  stop: async () => {},
});

await test("make searchable: the cleaned scans get a text layer", async () => {
  const { out, bytes } = await run({});
  eq(out.note, "cleaned:2", "note");
  eq(recognised >= 2, true, `pages read (${recognised})`);
  const pdf = await openPdf(bytes.slice());
  for (const n of [1, 2]) {
    const text = (await (await pdf.getPage(n).then((p) => p.getTextContent()))).items.map((i) => i.str).join(" ");
    if (!/Quarterly budget/.test(text)) throw new Error(`page ${n} text: "${text}"`);
  }
  eq(await contents(bytes, 3), await contents(input, 3), "text page content");
});

await test("a scan cleaned again keeps one text layer, not two", async () => {
  const { bytes } = await run({});
  const [again] = await runTool("cleanScans", [new File([bytes], "scans-clean.pdf")], options({}));
  eq(again.note, "cleaned:2", "an OCRed scan still counts as a scan");
  const page = await (await openPdf(new Uint8Array(await again.blob.arrayBuffer()))).getPage(1);
  const text = (await page.getTextContent()).items.map((i) => i.str).join(" ");
  eq(text.match(/Quarterly/g)?.length, 1, `"Quarterly" on the page (text: "${text}")`);
});

// ── Looks

await test("greyscale: grey JPEGs", async () => {
  const imgs = await pictures((await run({ cleanOcr: false, cleanColor: "gray" })).bytes);
  for (const i of imgs) eq(`${i.space} ${i.filter} ${i.bits}`, "/DeviceGray /DCTDecode 8", "picture");
});

await test("black and white: one bit a pixel, smaller than the JPEGs", async () => {
  const bw = await pictures((await run({ cleanOcr: false, cleanColor: "bw" })).bytes);
  const grey = await pictures(plain.bytes);
  for (const i of bw) eq(`${i.space} ${i.filter} ${i.bits}`, "/DeviceGray /FlateDecode 1", "picture");
  const [a, b] = [bw.reduce((s, i) => s + i.size, 0), grey.reduce((s, i) => s + i.size, 0)];
  if (a >= b) throw new Error(`black and white ${a} bytes, grey ${b}`);
  console.log(`      pictures: black and white ${(a / 1024).toFixed(0)} KB, grey ${(b / 1024).toFixed(0)} KB`);
});

await test("all off: the page is redrawn but not changed", async () => {
  const { out, bytes } = await run({ cleanOcr: false, cleanStraighten: false, cleanUpright: false, cleanBorders: false, cleanWhiten: false });
  eq(out.note, "cleaned:2", "note");
  const g = await shown(bytes, 1);
  // Still crooked, still grey, still on the bed.
  if (Math.abs(estimateSkew(g) / deg) < 2) throw new Error("straightened anyway");
  if (median(g) > 200) throw new Error("whitened anyway");
});

// Whitening leaves a photo on the page looking like one: a smooth gradient
// patch keeps its tones instead of being blown out to white.
await test("whitening keeps a photo's shading", async () => {
  const w = 600, h = 800;
  const g = { w, h, data: new Uint8Array(w * h).fill(PAPER) };
  for (let y = 300; y < 600; y++) for (let x = 100; x < 500; x++) g.data[y * w + x] = 40 + Math.round(((x - 100) / 400) * 140);
  const [out] = whiten([g]);
  const at = (x, y) => out.data[y * w + x];
  if (at(50, 50) < 250) throw new Error(`paper ${at(50, 50)}`);
  // Dark, middle and light parts of the photo stay distinct, none of them white.
  const [dark, mid, light] = [at(130, 450), at(300, 450), at(470, 450)];
  if (!(dark < mid - 40 && mid < light - 40 && light < 245)) throw new Error(`photo tones ${dark}, ${mid}, ${light}`);
});

await test("cancelling stops the run", async () => {
  const ctl = new AbortController();
  ctl.abort(new Error("cancelled"));
  let error = null;
  try {
    await runTool("cleanScans", [new File([input], "scans.pdf")], options({ cleanOcr: false }), undefined, undefined, ctl.signal);
  } catch (e) {
    error = e;
  }
  eq(error?.message, "cancelled", "error");
});

// The cleanup on its own, as pixels.
const rgbaOf = (g) => {
  const data = new Uint8ClampedArray(g.w * g.h * 4);
  for (let i = 0; i < g.data.length; i++) data.set([g.data[i], g.data[i], g.data[i], 255], i * 4);
  return { width: g.w, height: g.h, data };
};
// Turned each way: the quarter turns it takes to come back upright.
for (const [k, back] of [[0, 0], [1, 3], [2, 2], [3, 1]]) {
  await test(`cleanImage: scan turned ${k * 90}° comes back with ${back} quarter turns`, async () => {
    const r = await cleanImage(rgbaOf(rotate90(scan, k)), { straighten: true, whiten: true, upright: true, borders: true }, false);
    eq(r.turns, back, "turns");
    eq(r.trimmed, true, "trimmed");
    if (Math.abs(r.skew / deg - 3) > 0.5) throw new Error(`skew ${(r.skew / deg).toFixed(2)}°`);
  });
}

console.log(results.failed ? `\n${results.failed} failed` : "\nall passed");
process.exit(results.failed ? 1 : 0);
