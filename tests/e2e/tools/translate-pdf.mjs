// Translate PDF: the server AI (stood in for by ../ai-standin.mjs, which puts
// "ES " in front of each block) translates the report, and it comes back as
// a PDF with the translated text in it.
import { must } from "./lib.mjs";

const spec = {
  slug: "translate-pdf",
  files: ["report.pdf"],
  variants: {
    "server AI": {
      check: (r) => {
        must(r.kind === "single" && /\bES\b/.test(r.text ?? ""), `${r.kind}: ${(r.text ?? r.type ?? "").slice(0, 120)}`);
        return "translated by server AI";
      },
    },
  },
};
export default spec;
