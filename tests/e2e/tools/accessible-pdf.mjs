// Make PDF accessible: the report comes back tagged, with a language and a
// title, beside its accessibility report (an HTML file), both in the zip.
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { PDFDocument, PDFName } from "pdf-lib";
import { must } from "./lib.mjs";

const spec = {
  slug: "accessible-pdf",
  files: ["report.pdf"],
  variants: {
    defaults: {
      check: async (r) => {
        must(r.type === "zip", `${r.type}: expected the PDF and its report`);
        const pdf = r.entries.find((e) => e.ext === "pdf");
        must(pdf && pdf.pages === 3 && /Quarterly/.test(pdf.text), `${pdf?.name} ${pdf?.pages}p`);
        must(r.entries.some((e) => /-accessibility\.html$/.test(e.name)), `no report in ${r.names}`);
        const z = await JSZip.loadAsync(readFileSync(r.path));
        const d = await PDFDocument.load(await z.file(pdf.name).async("uint8array"));
        must(d.catalog.has(PDFName.of("StructTreeRoot")), "no structure tree");
        must(d.catalog.lookup(PDFName.of("Lang"))?.decodeText() === "en", "no language");
        must(!!d.getTitle(), "no title");
        const html = await z.file(r.entries.find((e) => e.ext === "html").name).async("string");
        must(/data-check="tagged" data-status="pass"/.test(html) && !/<script/i.test(html), "report");
      },
    },
  },
};
export default spec;
