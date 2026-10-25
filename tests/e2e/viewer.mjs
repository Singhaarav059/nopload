// The PDF viewer (src/components/workspace/ViewerView.tsx) in real browsers:
// the file opens full screen with its pages drawn and its text selectable;
// search finds the words; zoom, night mode and reading mode do what they say;
// the place you stopped comes back when the file is opened again; a tap on
// a phone shows and hides the controls; and Do more hands the file to
// another tool.
//
//   node tests/e2e/viewer.mjs [chromium] [firefox] [webkit]   (see kit.mjs)
import { dict, open, pick, suite } from "./kit.mjs";

const t = dict("en");
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]);

await suite(async ({ browser, test }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const viewer = () => page.getByRole("dialog", { name: "report.pdf" });
  const bar = (name) => viewer().getByRole("button", { name, exact: true });
  // The controls fade while reading; the mouse brings them back.
  const wake = async () => {
    await page.mouse.move(600, 300);
    await page.mouse.move(660, 360, { steps: 3 });
  };

  await test("opens full screen, every page drawn and its text there to select", async () => {
    await open(page, "/en/pdf-viewer");
    await pick(page, ["report.pdf"]);
    await viewer().waitFor();
    await viewer().getByText(fill(t["viewer.page"], { n: 1, total: 3 })).waitFor();
    if ((await viewer().locator("[data-page]").count()) !== 3) throw new Error("not 3 pages");
    await page.waitForFunction(() => document.querySelector('[data-page="1"] canvas')?.width > 0);
    await viewer().locator('[data-page="1"] .textLayer').getByText("Quarterly report").first().waitFor({ state: "attached" });
    // Full screen: the viewer covers the window.
    const box = await viewer().boundingBox();
    if (box.width < 1270 || box.height < 890) throw new Error(`viewer is ${box.width}×${box.height}`);
    return "3 pages, text layer";
  });

  await test("search finds a word and marks it", async () => {
    await wake();
    await bar(t["viewer.search"]).click();
    await viewer().getByRole("searchbox").fill("renewals");
    await viewer().getByText(new RegExp(`^${fill(t["viewer.matches"], { n: 1, total: "\\d+" })}$`)).waitFor();
    await viewer().locator(".vw-hit").first().waitFor({ state: "attached" });
    await viewer().getByRole("searchbox").fill("zzzz-nothing");
    await viewer().getByText(t["viewer.noMatches"]).waitFor();
    await page.keyboard.press("Escape");
    return "found, then none";
  });

  await test("zoom; night and sepia pages; two pages side by side", async () => {
    let step = "zoom in";
    try {
      await wake();
      const before = (await viewer().locator('[data-page="1"]').boundingBox()).width;
      await bar(t["viewer.zoomIn"]).click();
      step = "125%";
      await viewer().getByRole("button", { name: t["viewer.fit"] }).getByText("125%").waitFor();
      await page.waitForTimeout(400);
      const after = (await viewer().locator('[data-page="1"]').boundingBox()).width;
      if (after < before * 1.2) throw new Error(`width ${before} → ${after}`);
      step = "fit";
      await wake();
      await viewer().getByRole("button", { name: t["viewer.fit"] }).click();
      step = "night";
      await wake();
      await bar(t["viewer.display"]).click();
      const display = viewer().getByRole("group", { name: t["viewer.display"] });
      await display.getByRole("radio", { name: t["viewer.theme.night"] }).click();
      const filter = await viewer().locator('[data-page="1"] .vw-art').evaluate((e) => getComputedStyle(e).filter);
      if (!filter.includes("invert")) throw new Error(`filter: ${filter}`);
      step = "sepia";
      await display.getByRole("radio", { name: t["viewer.theme.sepia"] }).click();
      if ((await viewer().getAttribute("data-theme")) !== "sepia") throw new Error("not sepia");
      step = "two pages";
      await display.getByRole("radio", { name: t["viewer.layout.spread"] }).click();
      await page.waitForTimeout(300);
      const [a, b] = await Promise.all([1, 2].map((n) => viewer().locator(`[data-page="${n}"]`).boundingBox()));
      if (Math.abs(a.y - b.y) > 1 || b.x <= a.x + a.width) throw new Error(`pages 1 and 2 at ${a.x},${a.y} and ${b.x},${b.y}`);
      step = "back";
      await display.getByRole("radio", { name: t["viewer.layout.scroll"] }).click();
      await display.getByRole("radio", { name: t["viewer.theme.paper"] }).click();
      await page.keyboard.press("Escape");
      return `${Math.round(before)} → ${Math.round(after)} px`;
    } catch (e) {
      const state = await page.evaluate(() => {
        const x = document.querySelector('[aria-label="Do more with this file"]');
        const r = x?.getBoundingClientRect();
        return r ? [document.querySelectorAll(".vw").length, document.querySelector(".vw")?.hasAttribute("data-chrome"), document.elementFromPoint(r.x + 5, r.y + 5)?.outerHTML.slice(0, 90)] : "no button";
      }).catch((x) => String(x));
      throw new Error(`${step}: ${e.message.split("\n")[0]} ${JSON.stringify(state)}`);
    }
  });

  await test("select text, highlight it, and save a copy with the highlight in it", async () => {
    let step = "select";
    try {
    // After the last test's zoom and layout changes, the page is drawn again at its size; select once that's done.
    await page.waitForTimeout(800);
    // Select a line of page 1's text the way a drag would.
    await page.evaluate(() => {
      document.querySelector('[data-page="1"]').scrollIntoView();
      const span = [...document.querySelectorAll('[data-page="1"] .textLayer span')].find((s) => s.textContent.includes("Revenue grew"));
      const r = document.createRange();
      r.selectNodeContents(span);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    const bar = viewer().getByRole("toolbar", { name: t["viewer.highlight"] });
    await bar.waitFor();
    step = "colour";
    await bar.getByRole("button", { name: `${t["viewer.highlight"]}: ${t["viewer.color.yellow"]}` }).click();
    step = "mark";
    await viewer().locator('[data-page="1"] .vw-hl').first().waitFor();
    step = "list";
    // Listed, and saved into a copy as a real annotation.
    await wake();
    await viewer().getByRole("button", { name: t["viewer.pages"] }).click();
    await viewer().getByRole("tab", { name: t["viewer.highlights"] }).click();
    await viewer().getByText(/Revenue grew/).first().waitFor();
    step = "save";
    const [dl] = await Promise.all([page.waitForEvent("download"), viewer().getByRole("button", { name: t["viewer.saveHighlights"] }).click()]);
    const path = await dl.path();
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { readFileSync } = await import("node:fs");
    const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
    const annots = await (await pdf.getPage(1)).getAnnotations();
    if (!annots.some((a) => a.subtype === "Highlight" && /Revenue grew/.test(a.contentsObj?.str ?? ""))) throw new Error(`annotations: ${annots.map((a) => a.subtype)}`);
    if (!/highlighted\.pdf$/.test(dl.suggestedFilename())) throw new Error(dl.suggestedFilename());
    await page.keyboard.press("Escape");
    return dl.suggestedFilename();
    } catch (e) {
      throw new Error(`${step}: ${e.message.split("\n")[0]}`);
    }
  });

  await test("reading mode lays the text out again", async () => {
    await wake();
    await bar(t["viewer.reading"]).click();
    await viewer().locator("article").getByText(/Revenue grew 12 percent/).first().waitFor();
    await wake();
    await bar(t["viewer.reading"]).click();
    await viewer().locator("[data-page]").first().waitFor();
    return "text reflowed";
  });

  await test("opened again, it goes back to the page where you stopped", async () => {
    await viewer().locator(".vw-scroll").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.waitForTimeout(800);
    await wake();
    await bar(t["viewer.close"]).click();
    await viewer().waitFor({ state: "detached" });
    await pick(page, ["report.pdf"]);
    await viewer().getByText(fill(t["viewer.resumed"], { n: 3 })).waitFor();
    await viewer().getByText(fill(t["viewer.page"], { n: 3, total: 3 })).waitFor();
    return "page 3";
  });

  await test("Recent: the file is there to open again, at its page", async () => {
    let step = "close";
    try {
    await wake();
    await bar(t["viewer.close"]).click();
    await viewer().waitFor({ state: "detached" });
    const recent = page.getByRole("region", { name: t["recent.title"] });
    const card = recent.locator(".recent-card", { hasText: "report.pdf" });
    await card.getByText(fill(t["recent.where"], { n: 3, total: 3 }), { exact: false }).waitFor();
    step = "open";
    await card.click();
    await viewer().waitFor();
    // Download hands over the file as it is.
    await wake();
    step = "more";
    await bar(t["viewer.more"]).click();
    step = "download";
    const [dl] = await Promise.all([page.waitForEvent("download"), viewer().getByRole("menuitem", { name: t["viewer.download"] }).click()]);
    if (dl.suggestedFilename() !== "report.pdf") throw new Error(`downloaded ${dl.suggestedFilename()}`);
    await page.keyboard.press("Escape");
    return "listed at page 3, opened, downloaded";
    } catch (e) {
      const state = await page.evaluate(() => {
        const x = document.querySelector('[aria-label="Do more with this file"]');
        const r = x?.getBoundingClientRect();
        return r ? [document.querySelectorAll(".vw").length, document.querySelector(".vw")?.hasAttribute("data-chrome"), document.elementFromPoint(r.x + 5, r.y + 5)?.outerHTML.slice(0, 90)] : "no button";
      }).catch((x) => String(x));
      throw new Error(`${step}: ${e.message.split("\n")[0]} ${JSON.stringify(state)}`);
    }
  });

  await test("Do more: Compress opens with the file", async () => {
    await wake();
    await bar(t["viewer.more"]).click();
    await viewer().getByRole("menuitem", { name: t["tool.compress.name"] }).click();
    await page.waitForURL(/\/en\/compress-pdf/);
    await page.getByText("report.pdf").first().waitFor();
    // The viewer gone, the page scrolls again.
    await page.waitForFunction(() => !("viewer" in document.documentElement.dataset), null, { timeout: 5000 }).catch(() => { throw new Error("page still locked"); });
    return "compress holds report.pdf";
  });
  await ctx.close();

  await test("phone: a tap shows and hides the controls", async () => {
    const phone = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 }, hasTouch: true });
    const p = await phone.newPage();
    p.setDefaultTimeout(20000);
    try {
      await open(p, "/en/pdf-viewer");
      await pick(p, ["report.pdf"]);
      const v = p.getByRole("dialog", { name: "report.pdf" });
      await v.waitFor();
      await p.waitForFunction(() => !document.querySelector(".vw")?.hasAttribute("data-chrome"), null, { timeout: 8000 });
      await p.mouse.click(195, 500);
      await p.waitForFunction(() => document.querySelector(".vw")?.hasAttribute("data-chrome"));
      // Apart enough not to be a double tap (which zooms).
      await p.waitForTimeout(450);
      await p.mouse.click(195, 500);
      await p.waitForFunction(() => !document.querySelector(".vw")?.hasAttribute("data-chrome"));
      const wide = await p.evaluate(() => document.querySelector(".vw-scroll").scrollWidth - innerWidth);
      if (wide > 1) throw new Error(`${wide}px sideways at fit width`);
      // A double tap zooms in, another zooms back out.
      await p.mouse.dblclick(195, 400);
      await v.getByRole("button", { name: t["viewer.fit"] }).getByText("200%").waitFor({ state: "attached" });
      await p.mouse.dblclick(195, 400);
      await v.getByRole("button", { name: t["viewer.fit"] }).getByText("100%").waitFor({ state: "attached" });
      return "hidden, shown, hidden; double tap 200% and back";
    } finally {
      await phone.close();
    }
  });
});
