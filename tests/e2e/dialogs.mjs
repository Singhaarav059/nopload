// Keyboard and screen-reader basics at phone width: the menu is a real modal
// (focus moves in, Tab stays inside, Escape closes it, focus comes back to the
// Menu button), the Install button has a name when its text is hidden, and
// the home page's file card shows a button to tap. The logo goes home, at the
// top (and on the home page, back to the top); the Android app's download is
// offered on Android only.
//
//   node tests/e2e/dialogs.mjs [chromium] [firefox] [webkit]   (see kit.mjs)
import { dict, open, suite } from "./kit.mjs";

const t = dict("en");

await suite(async ({ browser, test }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  await open(page, "/en");
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));

  await test("the menu is a modal: focus in, Tab kept inside, Escape closes, focus back", async () => {
    const menu = page.getByRole("button", { name: t["nav.menu"] });
    await menu.click();
    const dialog = page.getByRole("dialog", { name: t["nav.menu"] });
    await dialog.waitFor();
    if (!(await inDialog())) throw new Error("focus didn't move into the menu");
    await page.keyboard.press("Shift+Tab");
    if (!(await inDialog())) throw new Error("Shift+Tab left the menu");
    for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
    if (!(await inDialog())) throw new Error("Tab left the menu");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    const back = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    if (back !== "Menu" && back !== (await menu.getAttribute("aria-label"))) throw new Error(`focus went to ${back}`);
    return "modal";
  });

  await test("the Install button has a name at phone width", async () => {
    const pill = page.locator("[data-install-button]");
    if (!(await pill.count())) return "not offered here";
    const name = await pill.getAttribute("aria-label");
    if (!name) throw new Error("no accessible name");
    await page.getByRole("button", { name }).first().waitFor();
    return name;
  });

  await test("the home page's file card shows a button to tap", async () => {
    const button = page.locator(".dropzone .btn", { hasText: t["ws.selectOne"] }).first();
    if (!(await button.isVisible())) throw new Error("no visible Select a file");
    return "visible";
  });
  await test("the logo: home at the top from a tool; on the home page, back to the top", async () => {
    await open(page, "/en/merge-pdf");
    await page.evaluate(() => scrollTo(0, 600));
    await page.getByRole("link", { name: t["nav.home"] }).first().click();
    await page.waitForURL(/\/en\/?$/);
    await page.waitForFunction(() => scrollY < 5);
    await page.evaluate(() => scrollTo(0, 900));
    await page.waitForFunction(() => scrollY > 500);
    await page.getByRole("link", { name: t["nav.home"] }).first().click();
    await page.waitForFunction(() => scrollY < 5, null, { timeout: 5000 });
    // At the top already: the page loads afresh.
    const loaded = page.waitForEvent("load");
    await page.getByRole("link", { name: t["nav.home"] }).first().click();
    await loaded;
    return "home at the top; back to the top; reloaded";
  });

  // The Install sheet on each system: the Android app's download only on Android.
  const UA = {
    android: "Mozilla/5.0 (Linux; Android 15; RMX3771) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0",
  };
  for (const [os, userAgent] of Object.entries(UA)) {
    await test(`${os}: the Android app's download ${os === "android" ? "is offered" : "isn't offered"}`, async () => {
      const c = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 }, userAgent });
      const p = await c.newPage();
      try {
        await open(p, "/en");
        const pill = p.locator("[data-install-button]").first();
        if (!(await pill.waitFor({ timeout: 5000 }).then(() => pill.isVisible(), () => false))) return "no Install button here";
        await pill.click();
        await p.getByRole("dialog").first().waitFor();
        const apk = await p.locator('[role="dialog"] a[href$=".apk"]').count();
        if ((os === "android") !== apk > 0) throw new Error(`${apk} APK links`);
        return apk ? "APK offered" : "web app steps only";
      } finally {
        await c.close();
      }
    });
  }
  await ctx.close();
});
