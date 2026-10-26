// Work in progress survives a change of language (src/lib/session.ts): the
// file open in the editor and the changes made to it are on the page in the
// new language, and still there on going Back; a tool opened afresh starts
// empty.
//
//   node tests/e2e/session.mjs [chromium] [firefox] [webkit]   (see kit.mjs)
import { dict, open, pick, suite } from "./kit.mjs";

const t = dict("en");

await suite(async ({ browser, test }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const pageImage = () => page.waitForFunction(() => [...document.querySelectorAll("main img")].some((i) => i.src.startsWith("blob:") && i.naturalWidth > 0));
  const rects = () => page.locator("[data-item=rect]").count();

  await test("an edit made, then the language changed: the file and the edit are still there", async () => {
    let step = "open";
    try {
      await open(page, "/en/edit-pdf");
      await pick(page, ["report.pdf"]);
      await pageImage();
      step = "draw";
      await page.getByRole("toolbar").getByRole("button", { name: t["ed.rect"], exact: true }).click();
      const box = await page.locator("main img").first().boundingBox();
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7, { steps: 5 });
      await page.mouse.up();
      if ((await rects()) !== 1) throw new Error("no rectangle drawn");
      step = "to Hindi";
      await page.getByRole("button", { name: t["nav.language"] }).click();
      await page.locator('a[hreflang="hi"]').click();
      await page.waitForURL(/\/hi\//);
      await pageImage();
      await page.locator("[data-item=rect]").first().waitFor();
      step = "back";
      await page.goBack();
      await page.waitForURL(/\/en\/edit-pdf/);
      await pageImage();
      await page.locator("[data-item=rect]").first().waitFor();
      return "file and rectangle kept in Hindi, and after Back";
    } catch (e) {
      throw new Error(`${step}: ${e.message.split("\n")[0]} at ${page.url()}`);
    }
  });

  await test("a tool opened afresh starts empty", async () => {
    const fresh = await ctx.newPage();
    await open(fresh, "/en/edit-pdf");
    await fresh.waitForTimeout(1500);
    if (await fresh.locator("main img[src^='blob:']").count()) throw new Error("the kept file came back in a new tab");
    await fresh.close();
    return "empty";
  });
  await ctx.close();
});
