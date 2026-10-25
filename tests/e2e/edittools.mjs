// Edit PDF's toolbar and markup tools in a real browser: every tool is named
// under its icon; the Eraser removes text with no box left; a stamp, a tick,
// an arrow, a note and a link are added. The saved file is read back: the
// erased words are gone, the stamp's word is there, and the note and link are
// real annotations.
//
//   npm run build:static
//   node scripts/serve-static.mjs out 3202 &
//   node tests/e2e/edittools.mjs chromium
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dict, open, pick, suite } from "./kit.mjs";

const t = dict("en");
const downloads = mkdtempSync(join(tmpdir(), "e2e-edittools-"));
const letter = join(downloads, "letter.pdf");
{
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([612, 792]);
  p.drawText("Dear customer, your invoice number is 99-SECRET-12.", { x: 72, y: 700, size: 14, font: helv });
  p.drawText("Thank you for your business.", { x: 72, y: 660, size: 14, font: helv });
  writeFileSync(letter, await doc.save());
}

await suite(async ({ name, browser, test }) => {
  const ctx = await browser.newContext({ acceptDownloads: true, locale: "en-US", viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const panel = () => page.locator("aside");
  const tool = (key) => page.getByRole("toolbar").getByRole("button", { name: t[key], exact: true });
  let step = "";
  await test("labelled tools; Eraser, stamp, tick, arrow, note and link", async () => {
    try {
      step = "open";
      await open(page, "/en/edit-pdf");
      await pick(page, [letter]);
      await page.waitForFunction(() => [...document.querySelectorAll("main img")].some((i) => i.src.startsWith("blob:") && i.naturalWidth > 0), null, { timeout: 30000 });
      const img = page.locator("main img").first();
      const box = await img.boundingBox();
      const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
      const drag = async ([x0, y0], [x1, y1]) => {
        await page.mouse.move(x0, y0);
        await page.mouse.down();
        await page.mouse.move(x1, y1, { steps: 5 });
        await page.mouse.up();
      };

      step = "labels";
      for (const k of ["ed.editContent", "ed.erase", "ed.whiteout", "ed.stampText", "ed.note", "ed.link", "ed.arrow", "ed.underline", "ed.strike", "ed.check", "ed.cross"]) {
        const b = tool(k);
        if (!(await b.isVisible())) throw new Error(`no visible "${t[k]}" tool`);
        if ((await b.innerText()).trim() !== t[k]) throw new Error(`"${t[k]}" isn't written on its button`);
      }

      step = "eraser";
      // Over "99-SECRET-12" (x 372–466 pt of 612, baseline 700 of 792).
      await tool("ed.erase").click();
      await drag(at(366 / 612, 1 - 716 / 792), at(474 / 612, 1 - 694 / 792));
      await page.waitForFunction(() => document.querySelector("main img[data-preview]"), null, { timeout: 30000 });

      step = "stamp";
      await tool("ed.stampText").click();
      await panel().getByRole("button", { name: t["ed.stamp.paid"], exact: true }).click();
      await page.mouse.click(...at(0.7, 0.4));

      step = "tick and arrow";
      await tool("ed.check").click();
      await page.mouse.click(...at(0.1, 0.5));
      await tool("ed.arrow").click();
      await drag(at(0.2, 0.6), at(0.4, 0.65));

      step = "note";
      await tool("ed.note").click();
      await page.mouse.click(...at(0.9, 0.1));
      await panel().getByRole("textbox", { name: t["ed.noteText"] }).fill("Please check the total");

      step = "link";
      await tool("ed.link").click();
      await drag(at(0.12, 1 - 672 / 792), at(0.5, 1 - 655 / 792));
      const url = panel().getByRole("textbox", { name: t["ed.linkTo"] });
      await url.fill("javascript:alert(1)");
      await panel().getByText(t["ed.linkBad"]).waitFor();
      await url.fill("nopload.app/help");
      await panel().getByText("Opens https://nopload.app/help").waitFor();
      await page.screenshot({ path: join(downloads, `${name}-tools.png`) });

      step = "save";
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout: 60000 }),
        page.getByRole("button", { name: t["tool.edit.action"], exact: true }).locator("visible=true").first().click(),
      ]);
      const saved = join(downloads, `${name}-${dl.suggestedFilename()}`);
      await dl.saveAs(saved);

      step = "result";
      const pdf = await getDocument({ data: new Uint8Array(readFileSync(saved)), verbosity: 0 }).promise;
      const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(" ");
      if (/SECRET/.test(text)) throw new Error(`erased text still there: ${text}`);
      if (!/Dear customer/.test(text) || !/Thank you/.test(text)) throw new Error(`text around it went: ${text}`);
      if (!/PAID/.test(text)) throw new Error(`no stamp: ${text}`);
      const lib = await PDFDocument.load(readFileSync(saved));
      const annots = lib.getPages()[0].node.Annots()?.asArray().map((r) => lib.context.lookup(r)) ?? [];
      const sub = (a) => String(a.get(PDFName.of("Subtype")));
      const note = annots.find((a) => sub(a) === "/Text");
      if (note?.get(PDFName.of("Contents"))?.decodeText() !== "Please check the total") throw new Error("no note");
      const link = annots.find((a) => sub(a) === "/Link");
      const uri = link && lib.context.lookup(link.get(PDFName.of("A")))?.get(PDFName.of("URI"))?.decodeText();
      if (uri !== "https://nopload.app/help") throw new Error(`link: ${uri}`);
      return text.slice(0, 70);
    } catch (e) {
      await page.screenshot({ path: join(downloads, `${name}-failed.png`) }).catch(() => {});
      throw new Error(`${step}: ${e.message} (screens in ${downloads})`);
    }
  });
  await ctx.close();
});
