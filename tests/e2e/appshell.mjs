// The installed app's frame on each kind of device (src/components/AppShell.tsx,
// src/app/app.css). Playwright can't install a web app, so ?app=1 shows the
// installed look in a tab. Phones get a floating tab bar (and Open a file on
// the home page), bigger screens their own navigation; the website's footer and
// introduction are gone, nothing scrolls sideways, and everything takes you
// where it says. Without ?app=1 the site is unchanged.
//
//   npm run build:static
//   node scripts/serve-static.mjs out 3202 &
//   node tests/e2e/appshell.mjs chromium
import { base, dict, fixture, open, suite } from "./kit.mjs";

const t = dict("en");
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  androidTab: "Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
};
const DEVICES = [
  { id: "iphone", os: "ios", form: "phone", nav: "tabs", ctx: { userAgent: UA.iphone, viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } },
  { id: "android", os: "android", form: "phone", nav: "tabs", ctx: { userAgent: UA.android, viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
  { id: "ipad", os: "ipados", form: "tablet", nav: "sidebar", ctx: { userAgent: UA.ipad, viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true } },
  { id: "android tablet", os: "android", form: "tablet", nav: "rail", ctx: { userAgent: UA.androidTab, viewport: { width: 1280, height: 800 }, isMobile: true, hasTouch: true } },
  { id: "mac", os: "mac", form: "desktop", nav: "sidebar", ctx: { userAgent: UA.mac, viewport: { width: 1440, height: 900 } } },
  { id: "windows", os: "windows", form: "desktop", nav: "fluent", ctx: { userAgent: UA.windows, viewport: { width: 1366, height: 768 } } },
];

await suite(async ({ name, browser, test }) => {
  // Firefox has no isMobile; the phone and tablet layouts come from touch and screen size there too.
  const mobileOk = name !== "firefox";
  // Pages are opened without waiting for "load": that also waits for every image
  // and font, which in WebKit on CI has taken longer than the 15 s allowed. open()
  // still waits for the page to be ready to use.
  for (const d of DEVICES) {
    await test(`${d.id}: its own navigation, no website parts, nothing wider than the screen`, async () => {
      const ctx = await browser.newContext({ locale: "en-US", ...d.ctx, ...(mobileOk ? {} : { isMobile: undefined }) });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      try {
        await open(page, "/en?app=1", { waitUntil: "domcontentloaded" });
        const html = await page.evaluate(() => ({ ...document.documentElement.dataset }));
        if (html.os !== d.os) throw new Error(`os ${html.os}`);
        if (mobileOk && (html.form !== d.form || html.nav !== d.nav)) throw new Error(`form ${html.form}, nav ${html.nav}`);
        if (!html.app) throw new Error("not in app mode");
        const phone = html.nav === "tabs";
        const nav = page.getByRole("navigation", { name: t["app.nav"] });
        if (phone) {
          // The floating tab bar, the Open button, and every tool on the home page.
          await nav.waitFor();
          await page.waitForFunction(() => document.querySelector('[aria-label="App navigation"]')?.dataset.tabbar === "pill");
          await page.locator("[data-fab]").waitFor();
          if (!(await page.locator("[data-tool='compress']").isVisible())) throw new Error("no tools on the home page");
          const lit = await nav.locator("[aria-current=page]").getAttribute("data-tab");
          if (lit !== "home") throw new Error(`lit tab: ${lit}`);
        } else {
          await nav.waitFor();
          const kind = await nav.evaluate((n) => n.dataset.side);
          if (mobileOk && kind !== d.nav) throw new Error(`navigation is ${kind}`);
        }
        if (await page.locator("[data-site-footer]").isVisible()) throw new Error("footer shown");
        if (await page.locator("#home-why").isVisible()) throw new Error("website introduction shown");
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (wide > 1) throw new Error(`${wide}px of sideways scroll`);
        // The page's content isn't hidden under the navigation.
        const under = await page.evaluate(() => {
          const n = document.querySelector('[aria-label="App navigation"]').getBoundingClientRect();
          const m = document.querySelector("main h1").getBoundingClientRect();
          return n.width > n.height ? m.bottom > n.top && m.top < n.bottom : m.left < n.right && document.dir !== "rtl";
        });
        if (under) throw new Error("the title is under the navigation");
        return `${html.os} ${html.form} ${html.nav}`;
      } finally {
        await ctx.close();
      }
    });
  }

  await test("phone: Open asks what to do with the file, and the header goes where it says", async () => {
    const ctx = await browser.newContext({ locale: "en-US", ...DEVICES[0].ctx, ...(mobileOk ? {} : { isMobile: undefined }) });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    try {
      await open(page, "/en?app=1", { waitUntil: "domcontentloaded" });
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator("[data-fab]").click()]);
      await chooser.setFiles(fixture("report.pdf"));
      const sheet = page.getByRole("dialog", { name: t["app.pickTool"] });
      await sheet.waitFor();
      await sheet.getByRole("link", { name: t["tool.compress.name"], exact: true }).click();
      await page.waitForURL(/\/en\/compress-pdf/);
      // The file came along: the tool has it, not an empty drop area.
      await page.getByText("report.pdf").first().waitFor();
      if (!(await page.evaluate(() => document.documentElement.dataset.app))) throw new Error("left app mode");
      await page.getByRole("navigation", { name: t["app.nav"] }).locator("[data-tab='settings']").click();
      const settings = page.getByRole("dialog", { name: t["app.settings"] });
      await settings.getByText(t["theme.label"], { exact: true }).waitFor();
      await settings.getByRole("button", { name: t["nav.close"] }).last().click();
      await settings.waitFor({ state: "detached" });
      await page.getByRole("navigation", { name: t["app.nav"] }).locator("[data-tab='flows']").click();
      await page.waitForURL(/\/en\/workflows/);
      await page.locator("header [data-back]").click();
      await page.waitForURL(/\/en\/compress-pdf/);
      await page.getByRole("navigation", { name: t["app.nav"] }).locator("[data-tab='reader']").click();
      await page.waitForURL(/\/en\/pdf-viewer/);
      return "open → compress with the file, settings, workflows, back, reader";
    } finally {
      await ctx.close();
    }
  });

  await test("phone: the welcome shows once, and Get started opens the app", async () => {
    const ctx = await browser.newContext({ locale: "en-US", ...DEVICES[1].ctx, ...(mobileOk ? {} : { isMobile: undefined }) });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    try {
      await open(page, "/en?app=1", { waitUntil: "domcontentloaded", welcome: true });
      const welcome = page.getByRole("dialog", { name: `${t["welcome.line1"]} ${t["welcome.line2"]}` });
      await welcome.waitFor();
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (wide > 1) throw new Error(`${wide}px of sideways scroll`);
      await welcome.getByRole("button", { name: t["welcome.start"] }).click();
      await welcome.waitFor({ state: "detached" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("[data-fab]").waitFor();
      if (await welcome.count()) throw new Error("welcomed again");
      // The website never shows it.
      await page.evaluate(() => localStorage.removeItem("nopload:welcomed"));
      await open(page, "/en?app=0", { waitUntil: "domcontentloaded", welcome: true });
      await page.waitForTimeout(500);
      if (await welcome.count()) throw new Error("welcome on the website");
      return "once, then the app";
    } finally {
      await ctx.close();
    }
  });

  await test("desktop: the sidebar lists every tool and opens it", async () => {
    const ctx = await browser.newContext({ locale: "en-US", ...DEVICES[4].ctx });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    try {
      await open(page, "/en?app=1", { waitUntil: "domcontentloaded" });
      const side = page.getByRole("navigation", { name: t["app.nav"] });
      await side.getByRole("link", { name: t["tool.merge.name"], exact: true }).click();
      await page.waitForURL(/\/en\/merge-pdf/);
      const current = await side.locator("[aria-current=page]").textContent();
      if (!current?.includes(t["tool.merge.name"])) throw new Error(`marked: ${current}`);
      // The workspace is beside the sidebar, not under it.
      const overlap = await page.evaluate(() => {
        const s = document.querySelector('[aria-label="App navigation"]').getBoundingClientRect();
        const m = document.querySelector("main").getBoundingClientRect();
        return m.left < s.right - 1;
      });
      if (overlap) throw new Error("main is under the sidebar");
      return "merge opened and marked";
    } finally {
      await ctx.close();
    }
  });

  await test("⌘K / Ctrl+K: say what you want, Enter opens the tool", async () => {
    const ctx = await browser.newContext({ locale: "en-US", ...DEVICES[4].ctx });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    try {
      await open(page, "/en", { waitUntil: "domcontentloaded" });
      const bar = page.getByRole("dialog", { name: t["cmd.label"] });
      // The shortcut is listened for once the page has started; a key pressed
      // before that does nothing, so press until the bar opens.
      for (let i = 0; i < 20 && !(await bar.isVisible()); i++) {
        await page.keyboard.press("Control+k");
        await bar.waitFor({ timeout: 500 }).catch(() => {});
      }
      await bar.waitFor();
      await bar.getByRole("combobox").fill("make it smaller");
      const first = bar.getByRole("option").first();
      if (!(await first.textContent()).includes(t["tool.compress.name"])) throw new Error(`first: ${await first.textContent()}`);
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/en\/compress-pdf/);
      // Opened again, the tool just used is first under Recent.
      await page.getByRole("button", { name: t["cmd.label"] }).first().click();
      await bar.getByText(t["cmd.recent"]).waitFor();
      await bar.getByRole("combobox").fill("join files");
      if (!(await bar.getByRole("option").first().textContent()).includes(t["tool.merge.name"])) throw new Error("join files isn't Merge");
      await page.keyboard.press("Escape");
      await bar.waitFor({ state: "detached" });
      return "compress, then merge";
    } finally {
      await ctx.close();
    }
  });

  await test("website: no app frame without ?app=1", async () => {
    const ctx = await browser.newContext({ locale: "en-US", ...DEVICES[0].ctx, ...(mobileOk ? {} : { isMobile: undefined }) });
    const page = await ctx.newPage();
    try {
      await open(page, "/en?app=0", { waitUntil: "domcontentloaded" });
      if (await page.evaluate(() => document.documentElement.dataset.app)) throw new Error("app mode on the website");
      if (await page.getByRole("navigation", { name: t["app.nav"] }).count()) throw new Error("app navigation shown");
      await page.locator("[data-site-footer]").waitFor({ state: "attached" });
      return "website as before";
    } finally {
      await ctx.close();
    }
  });

  await test("phone: the app's first frame, before its code runs, is already the app", async () => {
    const ctx = await browser.newContext({ locale: "en-US", ...DEVICES[0].ctx, ...(mobileOk ? {} : { isMobile: undefined }) });
    const page = await ctx.newPage();
    try {
      // The page as built, with none of its scripts: what shows while they load.
      await page.route(/\/_next\/static\/chunks\/.*\.js$/, (r) => r.abort());
      await page.goto(`${base}/en?app=1`, { waitUntil: "load" });
      const bar = page.getByRole("navigation", { name: t["app.nav"] });
      if (!(await bar.isVisible())) throw new Error("no tab bar until the app starts");
      if ((await page.locator("[data-tool]").count()) < 40) throw new Error("no tools until the app starts");
      // Nothing fading or lifting in but the mascot: the title and the tools
      // are there, still (loops, like blinking, are no entrance).
      const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity && a.effect?.target?.closest?.("main") && !a.effect.target.closest(".mascot")).length);
      if (moving) throw new Error(`${moving} entrance animations running`);
      return "tab bar and tools there, nothing else animating in";
    } finally {
      await ctx.close();
    }
  });
});
