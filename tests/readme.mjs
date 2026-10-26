// The README's numbers come from the code: tools from src/lib/tools.ts,
// interface languages from src/lib/i18n/locales.ts, OCR languages from
// OCR_LANGS. Run after adding a tool or a language.
//
//   node tests/readme.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const readme = read("README.md");
const tools = read("src/lib/tools.ts");
const ocr = tools.slice(tools.indexOf("export const OCR_LANGS"));

const counts = {
  tools: [...tools.matchAll(/\bslug: "[a-z0-9-]+"/g)].length,
  "interface languages": [...read("src/lib/i18n/locales.ts").matchAll(/\bcode: "/g)].length,
  "OCR languages": ocr.slice(0, ocr.indexOf("];")).match(/"[a-z_]+"/g).length,
};
// Every place the README states each number.
const claims = {
  tools: [/\*\*(\d+) tools\*\*/g],
  "interface languages": [/\*\*(\d+) interface languages\*\*/g],
  "OCR languages": [/OCR \(makes scans searchable, (\d+) languages\)/g, /\*\*OCR\*\* reads (\d+) languages/g],
};

let failed = 0;
for (const [what, patterns] of Object.entries(claims)) {
  const said = patterns.flatMap((p) => [...readme.matchAll(p)].map((m) => Number(m[1])));
  const wrong = said.filter((n) => n !== counts[what]);
  if (!said.length || wrong.length) {
    failed++;
    console.log(`FAIL ${what}: the code has ${counts[what]}, the README says ${said.join(", ") || "nothing"}`);
  } else console.log(`ok   ${what}: ${counts[what]}`);
}
const repo = JSON.parse(read("package.json")).repository?.url ?? "";
if (!/github\.com\/Singhaarav059\/nopload\.git$/.test(repo)) {
  failed++;
  console.log(`FAIL package.json repository: ${repo}`);
} else console.log("ok   package.json repository names nopload");
if (failed) process.exit(1);
console.log("\nall passed");
