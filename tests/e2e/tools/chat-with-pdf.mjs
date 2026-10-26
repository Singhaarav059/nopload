// Chat with PDF: without a model and without the cloud AI, a question about the
// report is answered with the request to turn AI on, never with the PDF's own
// passages and never with citations.
import { must } from "./lib.mjs";

const spec = {
  slug: "chat-with-pdf",
  files: ["report.pdf"],
  variants: {
    "no model": {
      run: async ({ page }) => {
        await page.waitForFunction(() => document.querySelector("#chat-q") && !document.querySelector("#chat-q").disabled, null, { timeout: 30000 });
        await page.locator("#chat-q").fill("How much did revenue grow?");
        await page.locator("#chat-q").press("Enter");
        await page.locator("main [data-needs-ai]").last().waitFor({ timeout: 60000 });
        return page.evaluate(() => ({
          kind: "chat",
          asks: document.querySelectorAll("main [data-needs-ai]").length,
          cites: [...document.querySelectorAll("main [data-citation]")].map((b) => b.getAttribute("data-citation")),
        }));
      },
      check: (r) => {
        must(r.asks > 0, "not asked to turn on AI");
        must(r.cites.length === 0, `showed passages, citations: ${r.cites.join(",")}`);
        return "asks to turn on AI";
      },
    },
  },
};
export default spec;
