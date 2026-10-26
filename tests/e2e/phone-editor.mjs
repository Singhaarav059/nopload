// Edit PDF on a phone, with fingers (Chromium, whose touch input the
// DevTools protocol can drive):
//  - a finger dragged across the page scrolls it: nothing on it is picked or moves
//  - a tap picks a piece of the page's text; a finger on it, once picked, moves it
//  - a finger on something not yet picked only picks it: it stays where it was
//  - two fingers stretch the page while they move (no new drawing each
//    frame) and it is drawn once at the new size when they lift; the page
//    never goes blank in between
//  - a double tap zooms in, another back to the page's width
//
//   npm run build:static
//   node scripts/serve-static.mjs out 3202 &
//   node tests/e2e/phone-editor.mjs
import { dict, open, pick, suite } from "./kit.mjs";

const t = dict("en");

await suite(async ({ name, browser, test }) => {
  if (name !== "chromium") return;
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const swipe = async (from, to, steps = 8) => {
    await touch("touchStart", [from]);
    for (let i = 1; i <= steps; i++) await touch("touchMove", [[from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]]);
    await touch("touchEnd", []);
  };
  const tapAt = async (p) => {
    await touch("touchStart", [p]);
    await touch("touchEnd", []);
  };
  const stage = () => page.locator("[data-stage]");
  // A spot on the page with nothing on it to pick.
  const bare = () => page.evaluate(() => {
    const st = document.querySelector("[data-stage]");
    // Where the page shows: inside the box it scrolls in, well clear of the edges.
    const p = st.getBoundingClientRect(), w = st.parentElement.getBoundingClientRect();
    const q = { left: Math.max(p.left, w.left), right: Math.min(p.right, w.right), top: Math.max(p.top, w.top), bottom: Math.min(p.bottom, w.bottom) };
    for (let y = Math.max(q.top, 140) + 12; y < Math.min(q.bottom, innerHeight - 160); y += 6) {
      for (let x = q.left + 12; x < q.right - 12; x += 6) {
        const e = document.elementFromPoint(x, y);
        if (e === st || (e?.parentElement === st && /^(IMG|CANVAS)$/.test(e.tagName))) return [x, y];
      }
    }
    throw new Error("no bare spot on the page");
  });
  const box = (sel) => page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });

  await open(page, "/en/edit-pdf");
  await pick(page, ["report.pdf"]);
  await stage().waitFor();
  await page.getByRole("button", { name: t["ed.editContent"], exact: false }).first().click();
  await page.locator("[data-stage] [data-content]").first().waitFor();

  await test("a finger across the page scrolls it and picks nothing", async () => {
    const [x, y, w, h] = await box("[data-stage]");
    const before = await page.evaluate(() => scrollY);
    await swipe([x + w / 2, y + h * 0.7], [x + w / 2, y + h * 0.2]);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => scrollY);
    const picked = await page.locator("[data-stage] [data-content-item]").count();
    if (picked) throw new Error(`${picked} picked while scrolling`);
    if (after <= before) throw new Error(`no scroll: ${before} → ${after}`);
    return `scrolled ${Math.round(after - before)} px, nothing picked`;
  });

  await test("a tap picks; only what's picked moves, and only past a few pixels", async () => {
    await page.evaluate(() => scrollTo(0, 0));
    const target = page.locator('[data-stage] [data-content="text"]').first();
    await target.scrollIntoViewIfNeeded();
    const [x, y, w, h] = await box('[data-stage] [data-content="text"]');
    await tapAt([x + w / 2, y + h / 2]);
    const item = page.locator("[data-stage] [data-content-item][data-selected]");
    await item.waitFor();
    const [ix, iy, iw, ih] = await box("[data-stage] [data-content-item][data-selected]");
    // From its middle, clear of the handles at its ends.
    const mx = ix + iw / 2, my = iy + ih / 2;
    // Not so soon that the browser takes it for a double tap (which edits the text).
    await page.waitForTimeout(600);
    // A wobble of a few pixels is still a tap: it stays.
    await swipe([mx, my], [mx + 3, my + 2], 2);
    await page.waitForTimeout(600);
    const [jx, jy] = await box("[data-stage] [data-content-item][data-selected]");
    if (Math.hypot(jx - ix, jy - iy) > 0.5) throw new Error(`moved ${Math.round(jx - ix)},${Math.round(jy - iy)} on a wobble`);
    // A real drag moves it.
    await swipe([mx, my], [mx + 60, my + 40]);
    const [kx, ky] = await box("[data-stage] [data-content-item][data-selected]");
    if (kx - ix < 40 || ky - iy < 25) throw new Error(`dragged by ${Math.round(kx - ix)},${Math.round(ky - iy)}`);
    return `picked by a tap, stayed on a wobble, dragged ${Math.round(kx - ix)},${Math.round(ky - iy)}`;
  });

  await test("a finger on something not picked only picks it", async () => {
    const others = page.locator('[data-stage] [data-content-item]:not([data-selected])');
    if (!(await others.count())) {
      // Pick a second piece of text first, by a tap.
      const [x, y, w, h] = await box('[data-stage] [data-content="text"]');
      await tapAt([x + w / 2, y + h / 2]);
    }
    // Clear the selection with a tap on a bare spot of the page.
    const [sx, sy] = await box("[data-stage]");
    await tapAt(await bare());
    await page.waitForFunction(() => !document.querySelector("[data-stage] [data-content-item][data-selected]"));
    const it = page.locator("[data-stage] [data-content-item]").first();
    const [ix, iy, iw, ih] = await it.evaluate((el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    await swipe([ix + iw / 2, iy + ih / 2], [ix + iw / 2 + 50, iy + ih / 2 + 35]);
    const [jx, jy] = await it.evaluate((el) => { const r = el.getBoundingClientRect(); return [r.left, r.top]; });
    const sel = await it.getAttribute("data-selected");
    // The page may scroll under the finger; the item keeps its place on the page.
    const [px, py] = await box("[data-stage]");
    const rel = [ix - sx, iy - sy], rel2 = [jx - px, jy - py];
    if (Math.hypot(rel2[0] - rel[0], rel2[1] - rel[1]) > 1) throw new Error(`moved on the page by ${Math.round(rel2[0] - rel[0])},${Math.round(rel2[1] - rel[1])}`);
    if (sel === null) throw new Error("not picked");
    return "picked, not moved";
  });

  await test("two fingers stretch the page, then it's drawn once at the new size", async () => {
    // The page's top a little under the toolbar, its middle on screen.
    await page.evaluate(() => scrollBy(0, document.querySelector("[data-stage]").getBoundingClientRect().top - 150));
    const [x, y, w] = await box("[data-stage]");
    const cx = x + w / 2, cy = y + 200;
    const width0 = w;
    await page.evaluate(() => {
      window.__blank = false;
      window.__transformed = false;
      const st = document.querySelector("[data-stage]");
      const check = () => {
        if (st.style.transform.includes("scale")) window.__transformed = true;
        const img = st.querySelector("img");
        if (!img || !img.getAttribute("src")) window.__blank = true;
        window.__raf = requestAnimationFrame(check);
      };
      check();
    });
    await touch("touchStart", [[cx - 40, cy], [cx + 40, cy]]);
    for (let i = 1; i <= 10; i++) await touch("touchMove", [[cx - 40 - i * 8, cy], [cx + 40 + i * 8, cy]]);
    const during = await stage().evaluate((el) => el.getBoundingClientRect().width === el.offsetWidth ? "laid out" : "stretched");
    await touch("touchEnd", []);
    await page.waitForFunction((w0) => document.querySelector("[data-stage]").offsetWidth > w0 * 1.5, width0);
    await page.waitForTimeout(300);
    const [blank, transformed] = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return [window.__blank, window.__transformed]; });
    const stuck = await stage().evaluate((el) => el.style.transform);
    if (!transformed || during !== "stretched") throw new Error("the page was laid out again while the fingers moved");
    if (blank) throw new Error("the page went blank");
    if (stuck) throw new Error(`transform left on: ${stuck}`);
    const width1 = await stage().evaluate((el) => el.offsetWidth);
    return `${Math.round(width0)} → ${width1} px, stretched while pinching, never blank`;
  });

  await test("a double tap zooms back out, and in again", async () => {
    const w0 = await stage().evaluate((el) => el.offsetWidth);
    const p = await bare();
    await tapAt(p);
    await page.waitForTimeout(60);
    await tapAt(p);
    await page.waitForFunction((w) => document.querySelector("[data-stage]").offsetWidth < w * 0.8, w0);
    const w1 = await stage().evaluate((el) => el.offsetWidth);
    const q = await bare();
    await tapAt(q);
    await page.waitForTimeout(60);
    await tapAt(q);
    await page.waitForFunction((w) => document.querySelector("[data-stage]").offsetWidth > w * 2, w1);
    const w2 = await stage().evaluate((el) => el.offsetWidth);
    return `${w0} → ${w1} → ${w2} px`;
  });
  await ctx.close();
});
