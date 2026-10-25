// Clean up scans: the scan comes back one page, as one picture, searchable
// ("Invoice 4471"); in black and white that picture is one bit a pixel.
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { must } from "./lib.mjs";

async function pictures(path) {
  const doc = await PDFDocument.load(readFileSync(path));
  return doc.context.enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream && String(o.dict.get(PDFName.of("Subtype"))) === "/Image")
    .map(([, o]) => ({ bits: Number(String(o.dict.get(PDFName.of("BitsPerComponent")))), space: String(o.dict.get(PDFName.of("ColorSpace"))) }));
}

const check = (bits) => async (r) => {
  must(r.type === "pdf" && r.pages === 1, `${r.type} ${r.pages}p`);
  must(/invoice\s*4471/i.test(r.text), `text: ${r.text?.slice(0, 80)}`);
  const imgs = await pictures(r.path);
  must(imgs.length === 1 && imgs[0].bits === bits, `pictures: ${JSON.stringify(imgs)}`);
};
const spec = {
  slug: "clean-up-scans",
  files: ["scanned.pdf"],
  timeout: 240000,
  variants: {
    defaults: { check: check(8) },
    "black and white": { set: (h) => h.radio("cleanColor", 2), check: check(1) },
  },
};
export default spec;
