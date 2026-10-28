// The installed app on a phone stays light, as a native app is: nothing is
// animated by scrolling (each one is worked out again on every frame), the
// settings sheet is built ahead and only shown on a tap, and a list of links
// doesn't preload every page it shows.
//
//   node tests/e2e/smooth.mjs [chromium] [firefox] [webkit]   (see kit.mjs)
import { open, suite } from "./kit.mjs";

await suite(async ({ name, browser, test }) => {
  // A phone (touch, coarse pointer) in the installed app.
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: name !== "firefox", locale: "en-US" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const preloads = [];
  page.on("request", (r) => /[?&]_rsc=/.test(r.url()) && preloads.push(r.url()));
  await open(page, "/en?app=1");

  await test("nothing is animated by scrolling", async () => {
    await page.evaluate(() => scrollBy(0, 1600));
    await page.waitForTimeout(400);
    const linked = await page.evaluate(() =>
      document.getAnimations().filter((a) => a.playState === "running" && a.timeline && a.timeline !== document.timeline).map((a) => `${a.animationName} on ${a.effect?.target?.className}`),
    );
    if (linked.length) throw new Error(`${linked.length} scroll-driven: ${linked.slice(0, 3).join(", ")}`);
    return "none";
  });

  await test("the settings sheet is built ahead, and opens at once", async () => {
    await page.waitForFunction(() => document.querySelectorAll(".app-sheet-wrap[hidden]").length === 2, null, { timeout: 8000 });
    const before = await page.evaluate(() => (document.querySelector(".app-sheet[data-sheet='settings']").dataset.mark = "1"));
    await page.locator(".app-tabbar [data-tab='settings']").click();
    await page.locator(".app-sheet[data-sheet='settings']").waitFor();
    if ((await page.locator(".app-sheet[data-sheet='settings']").getAttribute("data-mark")) !== before) throw new Error("settings rebuilt");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll(".app-sheet-wrap[hidden]").length === 2);
    return "built once";
  });

  await test("a tool opens from the home page's cards", async () => {
    preloads.length = 0;
    await page.locator("[data-tool='merge']").click();
    await page.waitForURL(/\/en\/merge-pdf/);
    if (preloads.length > 2) throw new Error(`${preloads.length} pages preloaded`);
    return "merge-pdf";
  });
  await ctx.close();
});
