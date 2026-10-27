// Summarize PDF in real browsers: short, medium and long summaries of
// report.pdf, written by the server AI (stood in for by ./ai-standin.mjs)
// from the document's text, are shown on the page, each longer than the
// last, can be saved as Markdown or text, nothing downloads by itself and no
// request leaves the site.
//
//   node tests/e2e/summarize.mjs [chromium] [firefox] [webkit]   (see kit.mjs)
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiStandIn } from "./ai-standin.mjs";
import { base, dict, open, pick, suite } from "./kit.mjs";

const t = dict("en");
const downloads = mkdtempSync(join(tmpdir(), "e2e-summarize-"));
const origin = new URL(base).origin;
const label = (key) => t[key].split(":")[0];

await suite(async ({ name, browser, test }) => {
  // The service worker would hide /api/ai from the stand-in.
  const ctx = await browser.newContext({ acceptDownloads: true, locale: "en-US", viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const ai = await aiStandIn(ctx);
  const page = await ctx.newPage();
  const away = [];
  page.on("request", (r) => {
    const url = r.url();
    if (!url.startsWith(origin) && !/^(data|blob):/.test(url)) away.push(url);
  });
  let downloaded = 0;
  page.on("download", () => downloaded++);

  const summary = async (length) => {
    await open(page, "/en/summarize-pdf");
    await pick(page, ["report.pdf"]);
    await page.getByRole("radio", { name: new RegExp(`^${label(`choice.summaryLength.${length}`)}`) }).click();
    await page.getByRole("button", { name: t["tool.summarize.action"], exact: true }).click();
    const box = page.locator("[data-summary]");
    await box.waitFor({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector("[data-summary]")?.textContent?.trim(), null, { timeout: 10000 });
    return (await box.innerText()).trim();
  };

  const texts = {};
  await test("short < medium < long, none empty", async () => {
    const before = downloaded;
    for (const length of ["short", "medium", "long"]) texts[length] = await summary(length);
    const n = Object.values(texts).map((s) => s.length);
    if (n.some((x) => !x)) throw new Error(`empty: ${JSON.stringify(texts)}`);
    if (!(n[0] < n[1] && n[1] < n[2])) throw new Error(`lengths ${n.join(", ")}`);
    const sent = ai.posts.filter((p) => p.body.task === "summarize").map((p) => p.body);
    if (sent.map((b) => b.points).join(",") !== "3,5,8") throw new Error(`points asked: ${sent.map((b) => b.points)}`);
    if (!sent.every((b) => /Revenue grew 12 percent/.test(b.text))) throw new Error("the document's text wasn't sent");
    if (downloaded !== before) throw new Error("downloaded by itself");
    return `${n.join(" < ")} characters`;
  });

  await test("saves as .md and .txt", async () => {
    const save = async (key) => {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: t[key], exact: true }).click()]);
      const path = join(downloads, `${name}-${dl.suggestedFilename()}`);
      await dl.saveAs(path);
      return [dl.suggestedFilename(), readFileSync(path, "utf8")];
    };
    const [mdName, md] = await save("res.downloadMd");
    const [txtName, txt] = await save("res.downloadTxt");
    if (mdName !== "report-summary.md" || txtName !== "report-summary.txt") throw new Error(`names ${mdName}, ${txtName}`);
    if (!/^- \S/.test(md)) throw new Error(`md: ${md.slice(0, 80)}`);
    if (!/^• \S/.test(txt) || /^- /m.test(txt)) throw new Error(`txt: ${txt.slice(0, 80)}`);
    return "report-summary.md, report-summary.txt";
  });

  await test("no request leaves the site", async () => {
    if (away.length) throw new Error(away.slice(0, 3).join(", "));
    return "all same-origin";
  });
  await ctx.close();
});
