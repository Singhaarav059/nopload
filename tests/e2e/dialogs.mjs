// Keyboard and screen-reader basics at phone width: the menu is a real modal
// (focus moves in, Tab stays inside, Escape closes it, focus comes back to the
// Menu button), the Install button has a name when its text is hidden, and
// the home page's file card shows a button to tap.
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
  await ctx.close();
});
