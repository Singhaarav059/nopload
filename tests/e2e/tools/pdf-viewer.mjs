// PDF viewer: the report opens full screen with each of its pages drawn and
// its text laid over them (tests/e2e/viewer.mjs covers the controls).
import { must } from "./lib.mjs";

const spec = {
  slug: "pdf-viewer",
  files: ["report.pdf"],
  variants: {
    defaults: {
      run: async ({ page }) => {
        await page.waitForFunction(() => document.querySelector('.vw [data-page="1"] canvas')?.width > 0, null, { timeout: 30000 });
        return page.evaluate(() => ({
          kind: "view",
          pages: document.querySelectorAll(".vw [data-page]").length,
          text: document.querySelector('.vw [data-page="1"] .textLayer')?.textContent ?? "",
        }));
      },
      check: (r) => {
        must(r.pages === 3, `${r.pages} pages`);
        must(/Quarterly/.test(r.text), `text layer: ${r.text.slice(0, 60)}`);
        return `${r.pages} pages, text layer`;
      },
    },
  },
};
export default spec;
