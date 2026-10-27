// Chat with PDF: a question about the report is answered by the server AI
// (stood in for by ../ai-standin.mjs), and the answer cites the page it
// came from, with a button that shows that page.
import { must } from "./lib.mjs";

const spec = {
  slug: "chat-with-pdf",
  files: ["report.pdf"],
  variants: {
    "server AI": {
      run: async ({ page }) => {
        await page.waitForFunction(() => document.querySelector("#chat-q") && !document.querySelector("#chat-q").disabled, null, { timeout: 30000 });
        await page.locator("#chat-q").fill("How much did revenue grow?");
        await page.locator("#chat-q").press("Enter");
        await page.locator("main [data-answered-by]").first().waitFor({ timeout: 60000 });
        return page.evaluate(() => ({
          kind: "chat",
          answer: document.querySelector("main [data-answer=done]")?.textContent ?? "",
          cites: [...document.querySelectorAll("main [data-citation]")].map((b) => b.getAttribute("data-citation")),
        }));
      },
      check: (r) => {
        must(r.cites.length > 0, `no citation: ${r.answer.slice(0, 120)}`);
        return `cites page ${r.cites[0]}`;
      },
    },
  },
};
export default spec;
