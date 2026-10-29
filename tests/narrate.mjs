// Read aloud as a narrator (src/lib/ai/narrate.ts) and the device's voices as
// a person would pick them (src/lib/ai/voices.ts): headings after a chime and
// a pause, lists introduced and their bullets not read, tables read row by
// row with their columns' names, links by their site; voices kept apart by
// voiceURI, grouped by accent, the natural ones first.
//
//   node tests/narrate.mjs
import { chapters, chapterOf, explanationScript, introScript, passageScript, pieces, sectionText, spoken } from "../src/lib/ai/narrate.ts";
import { pickVoice, preferredRegion, quality, shortName, voiceGroups, voiceId } from "../src/lib/ai/voices.ts";

let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}  ${e.message}`);
  }
};
const eq = (got, want, what = "") => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what} got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
};
const ok = (v, what) => {
  if (!v) throw new Error(what);
};

const cues = {
  intro: (p, s) => `${p} pages, ${s} sections.`,
  list: (n) => `${n} points:`,
  table: (r, c) => `A table: ${r} rows, ${c} columns.`,
  more: (n) => `And ${n} more rows.`,
};
const doc = [
  { page: 1, kind: "heading", level: 1, text: "Quarterly report" },
  { page: 1, kind: "paragraph", text: "Revenue grew 12 percent. See https://www.example.com/report for details [3]." },
  { page: 1, kind: "heading", level: 2, text: "Highlights" },
  { page: 1, kind: "list", text: "• Costs fell in two regions" },
  { page: 1, kind: "list", text: "• Hiring is planned for Q3" },
  { page: 2, kind: "list", text: "1. Open two offices" },
  { page: 2, kind: "table", text: "", rows: [["Region", "Q1", "Q2"], ["North", "1,200", "1,350"], ["South", "980", ""]] },
  { page: 2, kind: "paragraph", text: "Contents ........ 4" },
];

test("the first heading needs no run-up; later ones a chime and a pause, read as headings", () => {
  const first = passageScript(doc, 0, cues);
  eq(first[0].chime, false, "first chime");
  ok(first[0].before < 300, "first pause short");
  const h = passageScript(doc, 2, cues)[0];
  eq([h.chime, h.style, h.text], [true, "heading", "Highlights"]);
  ok(h.before >= 500 && h.after >= 400, "pauses around a heading");
});

test("a link is said by its site, reference marks aren't said, and those words aren't marked", () => {
  const s = passageScript(doc, 1, cues);
  const said = s.map((x) => x.text).join("");
  ok(said.includes("example.com") && !said.includes("https") && !said.includes("[3]"), said);
  ok(s.every((x) => x.at === undefined), "changed text has no word marks");
});

test("a list is introduced once, its bullets not said, a numbered item keeps its number", () => {
  const a = passageScript(doc, 3, cues);
  eq(a.map((x) => x.text), ["3 points:", "Costs fell in two regions"]);
  eq(a[1].at, 2, "offset past the bullet");
  eq(passageScript(doc, 4, cues).map((x) => x.text), ["Hiring is planned for Q3"]);
  eq(passageScript(doc, 5, cues)[0].text, "1. Open two offices");
});

test("a table is described, then each row read with its columns' names", () => {
  const t = passageScript(doc, 6, cues).map((x) => x.text);
  eq(t, ["A table: 2 rows, 3 columns.", "North: Q1, 1,200; Q2, 1,350.", "South: Q1, 980."]);
});

test("a long table reads ten rows and counts the rest", () => {
  const rows = [["Name", "Value"], ...Array.from({ length: 14 }, (_, i) => [`Row ${i + 1}`, String(i)])];
  const t = passageScript([{ page: 1, kind: "table", text: "", rows }], 0, cues).map((x) => x.text);
  eq(t.length, 12);
  eq(t.at(-1), "And 4 more rows.");
});

test("dot leaders become a pause", () => {
  eq(spoken("Contents ........ 4"), "Contents, 4");
  eq(spoken("Plain sentence."), null);
});

test("long passages are cut into sentences that keep their offsets", () => {
  const text = "One sentence here. Another one follows! " + "word ".repeat(80);
  const p = pieces(text, 100);
  ok(p.length > 2, "cut");
  for (const x of p) eq(text.slice(x.at, x.at + x.text.length), x.text, "offset");
});

test("sections: each heading starts one; text before the first is an opening", () => {
  const c = chapters(doc);
  eq(c.map((x) => x.start), [0, 2]);
  eq(chapterOf(c, 5), 1);
  const c2 = chapters([{ page: 1, kind: "paragraph", text: "x" }, ...doc]);
  eq(c2[0], { start: 0, title: "", level: 1 });
});

test("the opening says how long the document is", () => {
  eq(introScript(2, doc, cues)[0].text, "2 pages, 2 sections.");
});

test("an explanation loses its Markdown and is said in sentences", () => {
  const s = explanationScript("**Next**, the results. - Revenue rose.\n- Costs fell.", 4, false);
  ok(s.every((x) => x.passage === 4 && !/[*]/.test(x.text)), JSON.stringify(s));
  eq(s[0].chime, true);
  ok(sectionText(doc, 2, 6).startsWith("## Highlights\n- Costs fell"), sectionText(doc, 2, 6));
});

// Voices as Chrome on Android lists them: several with one name.
const voices = [
  { name: "English United States", lang: "en-US", voiceURI: "en-us-x-sfg-local", localService: true, default: true },
  { name: "English United States", lang: "en-US", voiceURI: "en-us-x-iom-network", localService: false },
  { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US", voiceURI: "aria" },
  { name: "Google UK English Female", lang: "en-GB", voiceURI: "gb" },
  { name: "Rishi", lang: "en-IN", voiceURI: "rishi" },
  { name: "Rishi (Enhanced)", lang: "en_IN", voiceURI: "rishi-e" },
  { name: "eSpeak English", lang: "en", voiceURI: "espeak" },
  { name: "Google Deutsch", lang: "de-DE", voiceURI: "de" },
  { name: "Albert", lang: "en-US", voiceURI: "albert" },
];

test("voices with the same name stay apart (the voice chosen is the one kept)", () => {
  const g = voiceGroups(voices, "en", ["en-US"]);
  const picked = pickVoice(g, "en-us-x-iom-network");
  eq(voiceId(picked), "en-us-x-iom-network");
});

test("the visitor's accent comes first: in India, the Indian English voices", () => {
  const g = voiceGroups(voices, "en", ["en-IN", "hi-IN"]);
  eq(g[0].region, "IN");
  eq(voiceId(g[0].voices[0]), "rishi-e", "enhanced first");
});

test("without a hint, a language's home accent; natural voices first, novelty ones last", () => {
  eq(preferredRegion("en"), "US");
  eq(preferredRegion("hi"), "IN");
  eq(preferredRegion("pt", ["pt-PT"]), "PT");
  const us = voiceGroups(voices, "en")[0];
  eq(us.region, "US");
  eq(voiceId(us.voices[0]), "aria");
  eq(voiceId(us.voices.at(-1)), "albert");
  ok(quality(voices[6]) < 0, "eSpeak is robotic");
  ok(!voiceGroups(voices, "en").flatMap((x) => x.voices).some((v) => v.lang.startsWith("de")), "only the language's voices");
});

test("a saved voice that's gone falls back to the best one", () => {
  eq(voiceId(pickVoice(voiceGroups(voices, "en"), "gone")), "aria");
});

test("voice names without their maker", () => {
  eq(shortName(voices[2]), "Aria");
  eq(shortName(voices[3]), "UK English Female");
  eq(shortName(voices[5]), "Rishi");
});

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
