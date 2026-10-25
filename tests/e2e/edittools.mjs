// Edit PDF's toolbar and markup tools in a real browser: every tool is named
// under its icon; the Eraser removes text with no box left; a scribble with
// the pen crosses a word out; a stamp, a tick,
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
  // Tall enough for the whole page: Firefox drops pointer events below the window, so a stroke there never ends.
  const ctx = await browser.newContext({ acceptDownloads: true, locale: "en-US", viewport: { width: 1280, height: 1700 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const panel = () => page.locator("aside");
  const tool = (key) => page.getByRole("toolbar").getByRole("button", { name: t[key], exact: true });
  let step = "";
  // The saved file's text, and when a word that should be gone is still there,
  // what the page held when it was saved: the evidence for a failure seen only
  // on CI's faster machines.
  const saveText = async (label) => {
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      page.getByRole("button", { name: t["tool.edit.action"], exact: true }).locator("visible=true").first().click(),
    ]);
    const saved = join(downloads, `${name}-${label}.pdf`);
    await dl.saveAs(saved);
    const bytes = new Uint8Array(readFileSync(saved));
    const pdf = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
    return { text: (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(" "), size: bytes.length };
  };
  // The page image's box once the layout has stopped moving: picking a tool
  // changes the side panel, which can resize the page a moment later.
  const settledBox = async () => {
    let last = null;
    for (let i = 0; i < 40; i++) {
      const b = await page.locator("main img").first().boundingBox();
      if (last && b && Math.abs(b.x - last.x) < 0.5 && Math.abs(b.y - last.y) < 0.5 && Math.abs(b.width - last.width) < 0.5) return b;
      last = b;
      await page.waitForTimeout(150);
    }
    return last;
  };
  const evidence = async (first) => {
    const items = await page.evaluate(() => [...document.querySelectorAll("[data-item]")].map((e) => e.dataset.item).join(",") || "none");
    return `saved ${first.size} B of ${readFileSync(letter).length} B, items on page: ${items}`;
  };
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

      step = "cursors";
      // Each tool its own pointer: a pencil, a round eraser, not the same crosshair for all.
      const cursorOf = () => page.evaluate(() => getComputedStyle(document.querySelector("main div.touch-none")).cursor);
      await tool("ed.draw").click();
      const pencil = await cursorOf();
      await tool("ed.erase").click();
      const eraser = await cursorOf();
      if (!pencil.startsWith("url(") || !eraser.startsWith("url(") || pencil === eraser) throw new Error(`cursors: ${pencil.slice(0, 40)} / ${eraser.slice(0, 40)}`);

      step = "erase a drawing";
      await tool("ed.draw").click();
      await drag(at(0.3, 0.55), at(0.5, 0.6));
      if ((await page.locator("[data-item=path]").count()) !== 1) throw new Error("no pencil stroke");
      if (await page.locator("[data-item=path][data-selected]").count()) throw new Error("a fresh stroke is selected");
      // Over it, the pencil stays a pencil: the stroke lets the pointer through to the page.
      const [hx, hy] = at(0.4, 0.575);
      const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-item]")?.getAttribute("data-item") ?? null, [hx, hy]);
      if (under) throw new Error(`the pointer lands on the ${under}, not the page`);
      await tool("ed.erase").click();
      await drag(at(0.4, 0.5), at(0.4, 0.65));
      if (await page.locator("[data-item=path]").count()) throw new Error("the stroke wasn't erased");

      step = "eraser";
      // Along "99-SECRET-12" (Helvetica 14 pt: x 325–425 of 612, baseline 700 of 792): a brush stroke, no box left.
      // It wipes as it goes: before the button is let go, the text it has passed is already covered in the paper's colour.
      await page.mouse.move(...at(322 / 612, 1 - 705 / 792));
      await page.mouse.down();
      await page.mouse.move(...at(430 / 612, 1 - 705 / 792), { steps: 8 });
      const live = await page.evaluate(([x, y]) => {
        const cv = document.querySelector("main canvas[aria-hidden]");
        const r = cv.getBoundingClientRect();
        const d = cv.getContext("2d").getImageData(Math.round(((x - r.left) / r.width) * cv.width), Math.round(((y - r.top) / r.height) * cv.height), 1, 1).data;
        return [...d];
      }, at(375 / 612, 1 - 705 / 792));
      if (live[3] < 200 || live[0] + live[1] + live[2] < 600) throw new Error(`not wiped while erasing: rgba ${live}`);
      await page.mouse.up();
      await page.waitForFunction(() => document.querySelector("main img[data-preview]"), null, { timeout: 30000 });
      if (await page.locator("[data-item=erase]").count()) throw new Error("the eraser left something to pick");

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

  await test("a scribble with the pen crosses a word out", async () => {
    try {
      step = "open";
      await open(page, "/en/edit-pdf");
      await pick(page, [letter]);
      await page.waitForFunction(() => [...document.querySelectorAll("main img")].some((i) => i.src.startsWith("blob:") && i.naturalWidth > 0), null, { timeout: 30000 });
      step = "scribble";
      // Back and forth over "business." (Helvetica 14 pt, x 202-262, baseline 660), as a hand would.
      await tool("ed.draw").click();
      const box = await settledBox();
      const at = (px, py) => [box.x + (box.width * px) / 612, box.y + box.height * (1 - py / 792)];
      await page.mouse.move(...at(200, 664));
      await page.mouse.down();
      for (let k = 0; k < 7; k++) await page.mouse.move(...at(k % 2 ? 200 : 264, 662 + (k % 3) * 2), { steps: 6 });
      await page.mouse.up();
      await page.locator("[data-poof]").first().waitFor({ state: "attached", timeout: 2000 });
      if (await page.locator("[data-item=path]").count()) throw new Error("the scribble stayed as a drawing");
      await page.waitForFunction(() => document.querySelector("main img[data-preview]"), null, { timeout: 30000 });
      step = "save";
      const first = await saveText("scribbled");
      const text = first.text;
      if (/business/.test(text)) throw new Error(`crossed-out word still there: ${text} (${await evidence(first)})`);
      if (!/Thank you for your/.test(text) || !/SECRET/.test(text)) throw new Error(`text around it went: ${text}`);
      return text.slice(0, 70);
    } catch (e) {
      await page.screenshot({ path: join(downloads, `${name}-scribble-failed.png`) }).catch(() => {});
      throw new Error(`${step}: ${e.message} (screens in ${downloads})`);
    }
  });

  await test("a loop with the pen picks an area: highlight it, or erase it", async () => {
    try {
      step = "open";
      await open(page, "/en/edit-pdf");
      await pick(page, [letter]);
      await page.waitForFunction(() => [...document.querySelectorAll("main img")].some((i) => i.src.startsWith("blob:") && i.naturalWidth > 0), null, { timeout: 30000 });
      let box;
      const at = (px, py) => [box.x + (box.width * px) / 612, box.y + box.height * (1 - py / 792)];
      // A loop round a centre in page points, rx by ry.
      const ring = async (cx, cy, rx, ry) => {
        await page.mouse.move(...at(cx + rx, cy));
        await page.mouse.down();
        for (let k = 1; k <= 36; k++) await page.mouse.move(...at(cx + Math.cos((k / 36) * Math.PI * 2) * rx, cy + Math.sin((k / 36) * Math.PI * 2) * ry));
        await page.mouse.up();
      };
      await tool("ed.draw").click();
      box = await settledBox();
      step = "highlight";
      // Round "Dear customer," (x 72-170, baseline 700).
      await ring(120, 704, 60, 14);
      const bar = page.getByRole("toolbar", { name: t["ed.loopActions"] });
      await bar.waitFor({ timeout: 3000 });
      if (await page.locator("[data-item=path]").count()) throw new Error("the loop stayed as a drawing");
      await bar.getByRole("button", { name: t["ed.highlight"], exact: true }).click();
      if ((await page.locator("[data-item=highlight]").count()) !== 1) throw new Error("no highlight");
      step = "erase";
      await tool("ed.draw").click();
      box = await settledBox();
      // Round "Thank you" (x 72-136, baseline 660).
      await ring(104, 664, 38, 12);
      await bar.getByRole("button", { name: t["ed.lassoErase"], exact: true }).click();
      await page.waitForFunction(() => document.querySelector("main img[data-preview]"), null, { timeout: 30000 });
      step = "save";
      const first = await saveText("looped");
      const text = first.text;
      if (/Thank/.test(text)) throw new Error(`erased words still there: ${text} (${await evidence(first)})`);
      if (!/Dear customer/.test(text) || !/business/.test(text)) throw new Error(`text around it went: ${text}`);
      return text.slice(0, 70);
    } catch (e) {
      await page.screenshot({ path: join(downloads, `${name}-loop-failed.png`) }).catch(() => {});
      throw new Error(`${step}: ${e.message} (screens in ${downloads})`);
    }
  });

  await test("Sign PDF and PDF Forms offer ticks, crosses and lines; a tick is saved", async () => {
    try {
      step = "forms";
      await open(page, "/en/pdf-forms");
      await pick(page, [letter]);
      await page.waitForFunction(() => [...document.querySelectorAll("main img")].some((i) => i.src.startsWith("blob:") && i.naturalWidth > 0), null, { timeout: 30000 });
      for (const k of ["ed.check", "ed.cross", "ed.line", "ed.text"]) if (!(await tool(k).isVisible())) throw new Error(`forms: no "${t[k]}"`);
      step = "sign";
      await open(page, "/en/sign-pdf");
      await pick(page, [letter]);
      await page.waitForFunction(() => [...document.querySelectorAll("main img")].some((i) => i.src.startsWith("blob:") && i.naturalWidth > 0), null, { timeout: 30000 });
      for (const k of ["ed.check", "ed.cross", "ed.line"]) if (!(await tool(k).isVisible())) throw new Error(`sign: no "${t[k]}"`);
      const box = await page.locator("main img").first().boundingBox();
      await tool("ed.check").click();
      await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.3);
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
      if ((await page.locator("[data-item=check]").count()) !== 2) throw new Error("ticks on the page");
      step = "save";
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout: 60000 }),
        page.getByRole("button", { name: t["tool.sign.action"], exact: true }).locator("visible=true").first().click(),
      ]);
      const saved = join(downloads, `${name}-signed.pdf`);
      await dl.saveAs(saved);
      const lib = await PDFDocument.load(readFileSync(saved));
      if (lib.getPages()[0].node.Contents() === undefined) throw new Error("no content");
      return "2 ticks saved";
    } catch (e) {
      await page.screenshot({ path: join(downloads, `${name}-sign-failed.png`) }).catch(() => {});
      throw new Error(`${step}: ${e.message} (screens in ${downloads})`);
    }
  });
  await ctx.close();
});
