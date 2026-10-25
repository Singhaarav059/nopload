// Edit PDF's Edit content tool in a real browser: everything a page draws can
// be picked and changed, and the page shows the edited file itself.
//  - a paragraph is retyped in place (wrapping in its own font) and centred
//  - a picture is moved, replaced by a portrait photo, and turned
//  - a rectangle is recoloured; another shape is deleted from the objects list
//  - undo and redo step through it
//  - find and replace changes a word wherever it is
// A scanned page is read with OCR and one of its lines retyped.
// The saved file is read back: the new text is there and the old gone, the
// picture is the replacement's size, the colour is in the content stream and
// the deleted shape's isn't.
//
//   npm run build:static
//   node scripts/serve-static.mjs out 3202 &
//   node tests/e2e/editcontent.mjs chromium
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dict, fixture, open, pick, suite } from "./kit.mjs";

const t = dict("en");
const downloads = mkdtempSync(join(tmpdir(), "e2e-editcontent-"));

const OLD = ["Quarterly revenue rose across every region, led by", "strong demand for the new subscription plans and", "a steady rise in renewals from existing customers."];
const NEW = "Quarterly income held steady in most regions, with renewals carrying the year.";
const brochure = join(downloads, "brochure.pdf");
{
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // A copy: pdf-lib reads the bytes from the start of their buffer, and newer Node can hand a small file back inside a larger one.
  const photo = await doc.embedJpg(new Uint8Array(readFileSync(fixture("images/motion.jpg"))));
  const p = doc.addPage([612, 792]);
  p.drawText("Annual report", { x: 72, y: 720, size: 24, font: bold });
  OLD.forEach((l, i) => p.drawText(l, { x: 72, y: 680 - i * 16, size: 12, font: helv }));
  p.drawImage(photo, { x: 72, y: 420, width: 200, height: 120 });
  p.drawRectangle({ x: 320, y: 420, width: 160, height: 80, color: rgb(0.2, 0.6, 0.3) }); // green, recoloured
  p.drawRectangle({ x: 320, y: 300, width: 160, height: 60, color: rgb(0.9, 0.5, 0.1) }); // orange, deleted
  writeFileSync(brochure, await doc.save());
}

const textOf = async (path) => {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  return (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(" ");
};
const pageOf = async (path) => {
  const doc = await PDFDocument.load(readFileSync(path));
  const page = doc.getPages()[0];
  const c = page.node.Contents();
  const refs = c && "asArray" in c ? c.asArray() : [page.node.get(PDFName.of("Contents"))];
  const content = refs.map((r) => Buffer.from(decodePDFRawStream(doc.context.lookup(r)).decode()).toString("latin1")).join("\n");
  const images = [];
  const xo = page.node.Resources()?.lookup(PDFName.of("XObject"));
  for (const [, ref] of xo?.entries() ?? []) {
    const s = doc.context.lookup(ref);
    if (s instanceof PDFRawStream && s.dict.get(PDFName.of("Subtype"))?.toString() === "/Image") {
      images.push([s.dict.get(PDFName.of("Width")).asNumber(), s.dict.get(PDFName.of("Height")).asNumber()]);
    }
  }
  return { content, images };
};

await suite(async ({ name, browser, test }) => {
  const ctx = await browser.newContext({ acceptDownloads: true, locale: "en-US", viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const panel = () => page.locator("aside");
  // The page shown is the edited file once its preview has caught up.
  const settled = async () => {
    await page.waitForFunction(() => !document.querySelector("aside [data-previewing]"), null, { timeout: 30000 });
    const err = await panel().locator("[role=alert]").count();
    if (err) throw new Error(`preview failed: ${await panel().locator("[role=alert]").innerText()}`);
  };

  let step = "";
  await test("text, pictures and shapes change in place; the page shows the result", async () => {
    try {
      step = "open";
      await open(page, "/en/edit-pdf");
      await pick(page, [brochure]);
      await page.waitForFunction(() => [...document.querySelectorAll("main img")].some((i) => i.src.startsWith("blob:") && i.naturalWidth > 0), null, { timeout: 30000 });
      await page.getByRole("button", { name: t["ed.editContent"], exact: true }).click();
      await page.locator("[data-content=text]").first().waitFor();

      step = "paragraph found";
      // The three lines are one paragraph; the heading is its own.
      const para = page.getByRole("button", { name: `${t["ed.objText"]}: ${OLD.join(" ").slice(0, 60)}…`, exact: true });
      await para.waitFor();
      if ((await page.locator("[data-content=text]").count()) !== 2) throw new Error(`paragraphs: ${await page.locator("[data-content=text]").count()}`);

      step = "retype";
      await para.dblclick();
      const box = page.locator("[data-content-editing]");
      await box.fill(NEW);
      await box.press("Escape");
      await panel().getByRole("button", { name: t["ed.alignCenter"] }).click();
      await settled();
      if (!(await page.locator("img[data-preview]").count())) throw new Error("the page isn't the preview");

      step = "picture";
      await page.locator("[data-content=image]").click();
      await panel().getByText("Picture 200×120").first().waitFor();
      const sel = page.locator("[data-content-item=image][data-selected]");
      const b = await sel.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 30, { steps: 5 });
      await page.mouse.up();
      const moved = await sel.boundingBox();
      if (Math.abs(moved.x - b.x - 40) > 3 || Math.abs(moved.y - b.y - 30) > 3) throw new Error(`moved to ${JSON.stringify(moved)} from ${JSON.stringify(b)}`);
      // Replaced by a portrait photo, then turned.
      await panel().locator("input[type=file]").setInputFiles(fixture("images/orient-1.jpg"));
      await panel().getByRole("button", { name: t["ed.rotateRight"] }).click();
      await settled();

      step = "shape colour";
      // The bigger rectangle (biggest first on the page).
      const shapes = page.locator("[data-content=path]");
      if ((await shapes.count()) !== 2) throw new Error(`shapes: ${await shapes.count()}`);
      await shapes.first().click();
      await panel().getByRole("button", { name: `${t["ed.fill"]}: ${t["color.red"]}`, exact: true }).click();
      await settled();

      step = "objects list";
      const list = panel().locator("[data-objects-list] button");
      const n = await list.count();
      if (n !== 5) throw new Error(`objects listed: ${n}`);
      // The orange one: the smaller shape, last of the shapes in the list's top-down order.
      const shapeRows = panel().locator("[data-objects-list] button", { hasText: t["ed.objShape"] });
      await shapeRows.nth(0).click();
      await page.keyboard.press("Delete");
      await page.locator("[data-removed]").waitFor();
      await settled();

      step = "undo, redo";
      await page.getByRole("button", { name: t["ed.undo"], exact: true }).click();
      await page.locator("[data-removed]").waitFor({ state: "detached" });
      await page.getByRole("button", { name: t["ed.redo"], exact: true }).click();
      await page.locator("[data-removed]").waitFor();
      await settled();
      step = "find and replace";
      await page.keyboard.press("Escape");
      await panel().getByText(t["ed.findReplace"]).click();
      await panel().getByRole("textbox", { name: t["ed.find"] }).fill("annual");
      await panel().getByRole("textbox", { name: t["ed.replaceWith"] }).fill("Yearly");
      await panel().getByRole("button", { name: t["ed.replaceAll"] }).click();
      await panel().getByText(/^1 replacement on 1 page/).waitFor();
      await settled();
      await page.screenshot({ path: join(downloads, `${name}-editor.png`) });

      step = "save";
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout: 60000 }),
        page.getByRole("button", { name: t["tool.edit.action"], exact: true }).locator("visible=true").first().click(),
      ]);
      const saved = join(downloads, `${name}-${dl.suggestedFilename()}`);
      await dl.saveAs(saved);

      step = "result";
      const text = await textOf(saved);
      for (const w of ["Quarterly income held steady", "renewals carrying the year", "Yearly report"]) if (!text.includes(w)) throw new Error(`no "${w}" in ${text}`);
      if (/revenue rose|subscription|Annual/.test(text)) throw new Error(`old text still there: ${text}`);
      const { content, images } = await pageOf(saved);
      if (!images.some(([w, h]) => w === 120 && h === 200)) throw new Error(`images: ${JSON.stringify(images)}`);
      if (images.some(([w, h]) => w === 200 && h === 120)) throw new Error(`old picture still there: ${JSON.stringify(images)}`);
      // (PDFium writes numbers without a leading zero.)
      if (!/0?\.82\d* 0?\.24\d* 0?\.41\d* rg/.test(content)) throw new Error("no red fill");
      if (/0?\.9\d* 0?\.5\d* 0?\.1\d* rg/.test(content) || /0?\.2\d* 0?\.6\d* 0?\.3\d* rg/.test(content)) throw new Error("deleted or recoloured shape's colour still there");
      return `${text.slice(0, 80)}… ${JSON.stringify(images)}`;
    } catch (e) {
      await page.screenshot({ path: join(downloads, `${name}-failed.png`) }).catch(() => {});
      throw new Error(`${step}: ${e.message} (screens in ${downloads})`);
    }
  });

  await test("a scanned page is read with OCR and a line retyped in place", async () => {
    try {
      step = "open scan";
      await open(page, "/en/edit-pdf");
      await pick(page, ["scanned.pdf"]);
      await page.waitForFunction(() => [...document.querySelectorAll("main img")].some((i) => i.src.startsWith("blob:") && i.naturalWidth > 0), null, { timeout: 30000 });
      await page.getByRole("button", { name: t["ed.editContent"], exact: true }).click();
      await panel().getByText(t["ed.scanPage"]).waitFor();

      step = "read";
      await panel().getByRole("button", { name: t["ed.scanRead"] }).click();
      await page.locator("[data-content=scan]").first().waitFor({ timeout: 120000 });
      const lines = await page.locator("[data-content=scan]").count();

      step = "retype";
      const first = page.locator("[data-content=scan]").first();
      const was = await first.getAttribute("title");
      await first.dblclick();
      const box = page.locator("[data-content-editing]");
      await box.fill("Nopload edited this scan");
      await box.press("Enter");
      await settled();

      step = "save";
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout: 60000 }),
        page.getByRole("button", { name: t["tool.edit.action"], exact: true }).locator("visible=true").first().click(),
      ]);
      const saved = join(downloads, `${name}-scan-${dl.suggestedFilename()}`);
      await dl.saveAs(saved);
      const text = await textOf(saved);
      if (!text.includes("Nopload edited this scan")) throw new Error(`no new line in ${text.slice(0, 200)}`);
      return `${lines} lines read; "${was}" retyped`;
    } catch (e) {
      await page.screenshot({ path: join(downloads, `${name}-scan-failed.png`) }).catch(() => {});
      throw new Error(`${step}: ${e.message} (screens in ${downloads})`);
    }
  });
  await ctx.close();
});
