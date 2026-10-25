// Add page numbers: page n gains a "n" by default, or "n … 3" (in the page language) with "n of total";
// two files Bates-numbered as one set continue from one to the next, with an exhibit index.
import { readFileSync } from "node:fs";
import { must, pageTexts } from "./lib.mjs";

const count = (text, re) => (text.match(re) ?? []).length;
const spec = {
  slug: "add-page-numbers",
  files: ["report.pdf"],
  variants: {
    defaults: {
      check: async (r, h) => {
        must(r.type === "pdf" && r.pages === 3, `${r.type} ${r.pages}p`);
        const before = await pageTexts(readFileSync(h.fx("report.pdf")));
        r.pageText.forEach((t, i) => {
          const n = new RegExp(`(?<![\\d,.])${i + 1}(?![\\d,.%])`, "g");
          must(count(t, n) > count(before[i], n), `page ${i + 1} has no "${i + 1}" added`);
        });
      },
    },
    "n of total": {
      set: (h) => h.select("numberFormat", "nOfTotal"),
      check: (r) => {
        must(r.type === "pdf" && r.pages === 3, `${r.type} ${r.pages}p`);
        // Right-to-left languages store it in visual order: "3 من 1".
        const of = (n) => new RegExp(`(?<![\\d,.])(${n}\\D{1,8}3|3\\D{1,8}${n})(?![\\d,.%])`);
        r.pageText.forEach((t, i) => must(of(i + 1).test(t), `page ${i + 1}: no "${i + 1} of 3"`));
      },
    },
    // Two files Bates-numbered as one set, with an exhibit index: the second
    // file's numbers start where the first's end.
    "bates set with index": {
      files: ["report.pdf", "report-v2.pdf"],
      set: async (h) => {
        await h.select("numberFormat", "bates");
        await h.fill("batesPrefix", "DOC");
        await h.toggle("exhibitIndex");
      },
      check: (r) => {
        must(r.type === "zip" && r.entries.length === 3, `${r.type} ${r.entries?.length}`);
        const entry = (re) => r.entries.find((e) => re.test(e.name));
        const a = entry(/^report-numbered/), b = entry(/^report-v2-numbered/), index = entry(/^exhibit-index/);
        must(a && b && index, `entries: ${r.entries.map((e) => e.name).join(", ")}`);
        const label = (n) => `DOC${String(n).padStart(6, "0")}`;
        for (let n = 1; n <= a.pages + b.pages; n++) must((n <= a.pages ? a : b).text.includes(label(n)), `no ${label(n)}`);
        must(index.text.includes(`${label(1)} – ${label(a.pages)}`) && index.text.includes(`${label(a.pages + 1)} – ${label(a.pages + b.pages)}`), "index ranges");
      },
    },
  },
};
export default spec;
