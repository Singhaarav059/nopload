// Work in progress survives a change of language (src/lib/session.ts): the
// file open in the editor and the changes made to it are on the page in the
// new language, and still there on going Back; a tool opened afresh starts
// empty. Two tabs changing language at once each get their own work back,
// and no password is kept along the way.
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
  await test("two tabs change language together: each gets its own work back", async () => {
    const tabs = [await ctx.newPage(), await ctx.newPage()];
    try {
      for (const [n, p] of tabs.entries()) {
        await open(p, "/en/edit-pdf");
        await pick(p, ["report.pdf"]);
        await p.waitForFunction(() => [...document.querySelectorAll("main img")].some((i) => i.src.startsWith("blob:") && i.naturalWidth > 0));
        // Tab 1 one rectangle, tab 2 two: told apart afterwards.
        for (let k = 0; k <= n; k++) {
          await p.getByRole("toolbar").getByRole("button", { name: t["ed.rect"], exact: true }).click();
          const box = await p.locator("main img").first().boundingBox();
          await p.mouse.move(box.x + box.width * 0.2, box.y + box.height * (0.3 + k * 0.2));
          await p.mouse.down();
          await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * (0.4 + k * 0.2), { steps: 5 });
          await p.mouse.up();
        }
      }
      await Promise.all(tabs.map(async (p) => {
        await p.getByRole("button", { name: t["nav.language"] }).click();
        await p.locator('a[hreflang="hi"]').click();
      }));
      const counts = [];
      for (const p of tabs) {
        await p.waitForURL(/\/hi\//);
        await p.locator("[data-item=rect]").first().waitFor();
        await p.waitForTimeout(500);
        counts.push(await p.locator("[data-item=rect]").count());
      }
      if (counts[0] !== 1 || counts[1] !== 2) throw new Error(`rectangles ${counts.join(" and ")}, expected 1 and 2`);
      return "1 and 2 rectangles, each in its own tab";
    } finally {
      for (const p of tabs) await p.close();
    }
  });

  await test("a password typed in Protect isn't kept over a change of language", async () => {
    const p = await ctx.newPage();
    try {
      await open(p, "/en/protect-pdf");
      await pick(p, ["report.pdf"]);
      await p.getByLabel(t["opt.password"], { exact: true }).fill("canary-7731");
      await p.getByLabel(t["opt.confirmPassword"], { exact: true }).fill("canary-7731");
      await p.getByRole("button", { name: t["nav.language"] }).click();
      await p.locator('a[hreflang="hi"]').click();
      await p.waitForURL(/\/hi\//);
      await p.getByText("report.pdf").first().waitFor();
      const kept = await p.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.open("nopload-inbox");
        req.onsuccess = () => {
          const all = req.result.transaction("files").objectStore("files").getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result.map((r) => r?.options ?? null)));
        };
      }));
      if (kept.includes("canary-7731")) throw new Error("the password was kept");
      const field = await p.locator('input[type="password"]').first().inputValue();
      if (field) throw new Error("the password came back filled in");
      return "file kept, password not";
    } finally {
      await p.close();
    }
  });
  await ctx.close();
});
