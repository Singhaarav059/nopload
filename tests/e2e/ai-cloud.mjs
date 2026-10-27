// Server AI in real browsers, with /api/ai (functions/api/ai.ts) stood in
// for by the test. Every AI tool uses it, on every device: the panel says
// what is sent, only text is sent (never the file), the answer cites its
// pages and says AI wrote it, and a citation shows its page. A failing
// server says so and offers to try again, never showing the PDF's passages
// instead. Where there's no server AI, the tools say so and send nothing.
//
//   node tests/e2e/ai-cloud.mjs [chromium] [firefox] [webkit]   (see kit.mjs)
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { base, dict, open, pick, suite } from "./kit.mjs";

const t = dict("en");
const dir = mkdtempSync(join(tmpdir(), "e2e-ai-cloud-"));

// Twenty pages of project notes, with the invoice on page 14.
const twenty = join(dir, "twenty.pdf");
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 20; i++) {
    const page = doc.addPage([595, 842]);
    const lines = i === 14
      ? ["Invoice INV-2041", "Bill to: Northwind Traders", "The invoice total is $1,234.50, due on 30 November."]
      : [`Section ${i}`, `This section describes project milestone ${i} and the risks the team saw.`];
    lines.forEach((l, j) => page.drawText(l, { x: 60, y: 760 - j * 22, size: 12, font }));
  }
  writeFileSync(twenty, await doc.save());
}

async function ask(page, question) {
  const n = await page.locator("[data-answer]").count();
  await page.getByLabel(t["chat.ask"]).fill(question);
  await page.getByRole("button", { name: t["chat.send"], exact: true }).click();
  const answer = page.locator("[data-answer]").nth(n);
  await page.waitForFunction((i) => document.querySelectorAll("[data-answer]")[i]?.getAttribute("data-answer") === "done", n, { timeout: 60000 });
  const pages = await answer.locator("[data-citation]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-citation"))));
  return { text: (await answer.innerText()).trim(), pages };
}

await suite(async ({ browser, test }) => {
  // The service worker would hide /api/ai from the stand-in.
  const ctx = await browser.newContext({ acceptDownloads: true, locale: "en-US", viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  // How the stand-in answers next, and what it was sent.
  let mode = { status: 200, provider: "anthropic" };
  const posts = [];
  await ctx.route("**/api/ai", async (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { anthropic: true, cloudflare: true } });
    const body = req.postDataJSON();
    posts.push({ body, bytes: req.postDataBuffer()?.length ?? 0, origin: (await req.allHeaders()).origin });
    if (mode.status !== 200) return route.fulfill({ status: mode.status, json: mode.limit ? { error: "limit", limit: mode.limit } : { error: "no AI provider answered", fallbackToLocal: true } });
    const headers = { "X-AI-Provider": mode.provider };
    if (body.task === "chat") {
      // The page whose excerpt has the amount: excerpts start with "(p. N)".
      const n = body.sources.split("\n\n").find((x) => x.includes("$1,234.50"))?.match(/^\(p\. (\d+)\)/)?.[1] ?? "1";
      return route.fulfill({ headers, contentType: "text/plain", body: `The invoice total is $1,234.50 (p. ${n}).` });
    }
    if (body.task === "summarize") return route.fulfill({ headers, contentType: "text/plain", body: Array.from({ length: body.points }, (_, i) => `- Cloud point ${i + 1}`).join("\n") });
    if (body.task === "translate") return route.fulfill({ headers, json: { texts: body.texts.map((s) => `ES ${s}`) } });
    return route.fulfill({ status: 400, json: { error: "unknown task" } });
  });

  await test("chat: says it uses the server AI and what it sends; no choice to make", async () => {
    await open(page, "/en/chat-with-pdf");
    await pick(page, [twenty]);
    const panel = page.locator("[data-ai-notice='server']");
    await panel.waitFor({ timeout: 15000 });
    const text = await panel.innerText();
    for (const key of ["ai.server.sends.chat", "ai.server.who"]) if (!text.includes(t[key])) throw new Error(`no ${key}: ${text}`);
    const link = await panel.locator("a").getAttribute("href");
    if (link !== "/en/privacy#ai") throw new Error(`links ${link}`);
    if (await page.locator("main [data-ai-choice], main [data-ai-models]").count()) throw new Error("offers a choice of where AI runs");
    return "notice shown, no choice";
  });

  await test("chat: the server AI answer cites page 14; only text was sent", async () => {
    await page.waitForFunction(() => !document.querySelector("#chat-q")?.disabled, null, { timeout: 30000 });
    const a = await ask(page, "What is the invoice total in this PDF?");
    if (a.pages[0] !== 14 || !a.text.includes("$1,234.50")) throw new Error(`cited ${a.pages}: ${a.text}`);
    if (!a.text.includes(t["chat.by.server"])) throw new Error(`no attribution: ${a.text}`);
    const { body, bytes, origin } = posts.at(-1);
    if (body.task !== "chat" || body.question !== "What is the invoice total in this PDF?") throw new Error(JSON.stringify(body).slice(0, 200));
    if (bytes > 20000 || JSON.stringify(body).includes("%PDF")) throw new Error(`sent ${bytes} bytes`);
    // functions/api/ai.ts refuses a POST without one.
    if (origin !== new URL(base).origin) throw new Error(`Origin: ${origin}`);
    if (!body.sources.includes("(p. 14)\nInvoice INV-2041")) throw new Error(`excerpts: ${body.sources.slice(0, 200)}`);
    return `cites p. ${a.pages.join(", ")}, sent ${bytes} bytes, Origin sent`;
  });

  await test("chat: a citation shows its page", async () => {
    await page.getByRole("button", { name: t["chat.nextPage"] }).click();
    await page.locator("[data-citation='14']").first().click();
    await page.locator("[data-chat-page='14']").waitFor({ timeout: 5000 });
    return "page 14 shown";
  });

  await test("chat: 'the biggest' sends the pages with amounts across the document", async () => {
    await ask(page, "What is the biggest amount in this document?");
    const { body } = posts.at(-1);
    const pages = [...body.sources.matchAll(/^\(p\. (\d+)\)$/gm)].map((m) => Number(m[1]));
    // Every page has a number in it (its section number), and they all fit.
    if (pages.length !== 20) throw new Error(`sent pages ${pages}`);
    return `${pages.length} pages sent`;
  });

  await test("chat: the backup's answers are labelled server AI too", async () => {
    mode = { status: 200, provider: "cloudflare" };
    const a = await ask(page, "When is the invoice due?");
    if (!a.text.includes(t["chat.by.server"])) throw new Error(a.text);
    return "Cloudflare named";
  });

  await test("chat: the same question again is answered from this device, with no request", async () => {
    const before = posts.length;
    const a = await ask(page, "  what is the INVOICE total in this pdf  ");
    if (posts.length !== before) throw new Error("sent a request");
    if (a.pages[0] !== 14 || !a.text.includes("$1,234.50")) throw new Error(a.text);
    return "kept answer, 0 requests";
  });

  await test("chat: when server AI fails, it says so and tries again, never showing passages", async () => {
    mode = { status: 503 };
    const a = await ask(page, "How much is owed on the Northwind invoice in total?");
    if (!a.text.includes(t["chat.cloudDown"]) || a.text.includes("$1,234.50") || a.pages.length) throw new Error(a.text);
    mode = { status: 200, provider: "anthropic" };
    const turn = page.locator("[data-answer]").last();
    await turn.getByRole("button", { name: t["chat.retry"] }).click();
    await turn.locator("[data-citation='14']").waitFor({ timeout: 30000 });
    return "said so, then answered on retry";
  });

  await test("chat: over the fair-use limit, it says so; nothing else is shown", async () => {
    mode = { status: 429, limit: "minute" };
    const a = await ask(page, "Who is the invoice billed to, according to the PDF?");
    if (!a.text.includes(t["chat.limitMinute"]) || a.pages.length) throw new Error(a.text);
    mode = { status: 429, limit: "day" };
    const b = await ask(page, "What is the invoice number on that page of the PDF?");
    if (!b.text.includes(t["chat.limitDay"])) throw new Error(b.text);
    mode = { status: 200, provider: "anthropic" };
    return "minute and day limits named";
  });

  await test("summarize: written by server AI, labelled, text only", async () => {
    await open(page, "/en/summarize-pdf");
    await pick(page, ["report.pdf"]);
    const notice = await page.locator("[data-ai-notice='server']").innerText({ timeout: 15000 });
    if (!notice.includes(t["ai.server.sends.summarize"])) throw new Error(notice);
    await page.getByRole("button", { name: t["tool.summarize.action"], exact: true }).click();
    await page.locator("[data-summary]").waitFor({ timeout: 60000 });
    const summary = await page.locator("[data-summary]").innerText();
    if (!summary.includes("Cloud point 5")) throw new Error(summary);
    for (const key of ["res.summaryServer", "ws.processedServerAi"]) if (!(await page.getByText(t[key]).count())) throw new Error(`no ${key}`);
    const { body } = posts.at(-1);
    if (body.task !== "summarize" || body.points !== 5 || !body.text.includes("Revenue grew")) throw new Error(JSON.stringify(body).slice(0, 200));
    return summary.split("\n")[0];
  });

  await test("translate: blocks go in batches, the PDF is rebuilt here", async () => {
    await open(page, "/en/translate-pdf");
    await pick(page, ["report.pdf"]);
    await page.locator("[data-ai-notice='server']").waitFor({ timeout: 15000 });
    await page.getByRole("radio", { name: new RegExp(`^${t["choice.translateFormat.md"].split(":")[0]}`) }).click();
    const before = posts.length;
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      page.getByRole("button", { name: t["tool.translate.action"], exact: true }).click(),
    ]);
    const md = readFileSync(await dl.path(), "utf8");
    if (!/^ES /m.test(md)) throw new Error(md.slice(0, 200));
    const sent = posts.slice(before);
    if (!sent.length || sent.some((p) => p.body.task !== "translate" || p.body.language !== "es")) throw new Error(JSON.stringify(sent[0]?.body).slice(0, 200));
    if (!(await page.getByText(t["res.translateServer"]).count())) throw new Error("no attribution");
    return `${sent.length} request(s), ${sent.reduce((n, p) => n + p.body.texts.length, 0)} blocks`;
  });

  await test("summarize: when server AI fails, it says so and makes no summary of its own", async () => {
    mode = { status: 503 };
    await open(page, "/en/summarize-pdf");
    await pick(page, ["report.pdf"]);
    // A length not asked for before, so no answer kept on this device stands in.
    await page.getByRole("radio", { name: new RegExp(`^${t["choice.summaryLength.long"].split(":")[0]}`) }).click();
    await page.getByRole("button", { name: t["tool.summarize.action"], exact: true }).click();
    await page.getByText(t["err.cloudFailed"]).first().waitFor({ timeout: 60000 });
    if (await page.locator("[data-summary]").count()) throw new Error("showed a summary");
    mode = { status: 200, provider: "anthropic" };
    return t["err.cloudFailed"];
  });

  await test("a phone: the same server AI, nothing to download", async () => {
    const phone = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }).catch(() => null);
    if (!phone) return "skipped: this browser can't emulate a phone";
    try {
      await phone.route("**/api/ai", (r) => (r.request().method() === "GET" ? r.fulfill({ json: { groq: true } }) : r.fulfill({ contentType: "text/plain", body: "The invoice total is $1,234.50 (p. 14)." })));
      const p = await phone.newPage();
      await open(p, "/en/chat-with-pdf");
      await pick(p, [twenty]);
      await p.locator("[data-ai-notice='server']").waitFor({ timeout: 15000 });
      await p.waitForFunction(() => !document.querySelector("#chat-q")?.disabled, null, { timeout: 30000 });
      const a = await ask(p, "What is the invoice total in this PDF?");
      if (a.pages[0] !== 14) throw new Error(a.text);
      return "answered by server AI";
    } finally {
      await phone.close();
    }
  });

  await test("no server AI here: the tools say so, take no questions and send nothing", async () => {
    const none = await browser.newContext({ serviceWorkers: "block", locale: "en-US" });
    try {
      const sent = [];
      await none.route("**/api/ai", (r) => {
        if (r.request().method() !== "GET") sent.push(r.request().url());
        return r.request().method() === "GET" ? r.fulfill({ json: { groq: false, anthropic: false, cloudflare: false } }) : r.fulfill({ status: 503, json: {} });
      });
      const p = await none.newPage();
      await open(p, "/en/chat-with-pdf");
      await pick(p, [twenty]);
      await p.locator("[data-ai-unavailable]").waitFor({ timeout: 15000 });
      await p.locator("[data-ai-notice='unavailable']").waitFor();
      if (!(await p.locator("#chat-q").isDisabled())) throw new Error("the question box is enabled");
      if (sent.length) throw new Error(`sent ${sent.length}`);
      return t["ai.unavailable"];
    } finally {
      await none.close();
    }
  });

  await test("the AI tools' pages say AI on our server, not 'Runs on your device'", async () => {
    await open(page, "/en/chat-with-pdf");
    const pill = await page.locator("header .pill").filter({ hasText: t["home.aiBadge"] }).count();
    const local = await page.locator("header .pill").filter({ hasText: t["home.privateBadge"] }).count();
    if (!pill || local) throw new Error(`aiBadge ${pill}, privateBadge ${local}`);
    return t["home.aiBadge"];
  });

  await ctx.close();
});
