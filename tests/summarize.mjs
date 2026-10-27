// Summarize PDF: the document's text (prose and table figures), read on the
// device, goes to the server AI, stood in for here; the summary is its key
// points, in the language asked for. Long documents send their opening and
// their key sentences (TextRank over the document's own sentences). When the
// server AI doesn't answer, it's an error, not a summary made some other way.
//
//   node tests/summarize.mjs
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load, openPdf, check, eq, root } from "./lib/load.mjs";

const ex = await load("../ai/extractive");
const { summarizePdf } = await load("../ai/summarize");
const results = { failed: 0 };
const test = check(results);

// pdf.js in Node runs its worker in the main thread once a document has been opened directly.
const report = new Uint8Array(readFileSync(join(root, "tests/fixtures/report.pdf")));
await openPdf(report.slice());
const file = (bytes, name = "report.pdf") => new File([bytes], name, { type: "application/pdf" });
const run = async (bytes, o, name) => {
  const [out] = await summarizePdf(file(bytes, name), { summaryLength: "medium", summaryLang: "same", ...o });
  return { ...out, text: await out.blob.text() };
};

// The stand-in server AI: `reply` answers each request, and `sent` is what it got.
// Any other request fails the test.
let reply = (body) => Array.from({ length: body.points }, (_, i) => `${i + 1}. Point ${i + 1} in ${body.language}`).join("\n");
const sent = [];
let requests = 0;
globalThis.fetch = async (url, init) => {
  if (url === "/api/ai" && init?.method === "POST") {
    const body = JSON.parse(init.body);
    sent.push(body);
    const r = reply(body);
    return typeof r === "string" ? new Response(r, { headers: { "X-AI-Provider": "groq" } }) : Response.json(r, { status: r.status });
  }
  requests++;
  throw new Error("network");
};

await test("sentences: split, abbreviations and e-mail addresses kept whole", () => {
  const s = ex.splitSentences("Revenue grew 12 percent. Contact jane.doe@example.com for details. Is it good? Yes!", "en");
  eq(s.length, 4, "sentence count");
  eq(s[1], "Contact jane.doe@example.com for details.", "e-mail kept in its sentence");
});

await test("language guess: English, Spanish, German, Japanese, Russian, Bengali, Tamil, Telugu, Urdu, Persian, Arabic", () => {
  eq(ex.guessLanguage("The report shows that the revenue of the company is growing and it will grow"), "en", "en");
  eq(ex.guessLanguage("El informe muestra que los ingresos de la empresa crecen y que seguirán creciendo en el año"), "es", "es");
  eq(ex.guessLanguage("Der Bericht zeigt, dass der Umsatz des Unternehmens wächst und nicht mit dem Jahr sinkt"), "de", "de");
  eq(ex.guessLanguage("この報告書は、会社の収益が伸びていることを示しています。"), "ja", "ja");
  eq(ex.guessLanguage("Отчёт показывает, что выручка компании растёт."), "ru", "ru");
  eq(ex.guessLanguage("প্রতিবেদনটি দেখায় যে কোম্পানির আয় বাড়ছে।"), "bn", "bn");
  eq(ex.guessLanguage("நிறுவனத்தின் வருமானம் வளர்ந்து வருவதாக அறிக்கை காட்டுகிறது."), "ta", "ta");
  eq(ex.guessLanguage("కంపెనీ ఆదాయం పెరుగుతోందని నివేదిక చూపిస్తుంది."), "te", "te");
  eq(ex.guessLanguage("رپورٹ سے پتہ چلتا ہے کہ کمپنی کی آمدنی بڑھ رہی ہے۔"), "ur", "ur");
  eq(ex.guessLanguage("گزارش نشان می‌دهد که درآمد شرکت در حال افزایش است."), "fa", "fa");
  eq(ex.guessLanguage("يظهر التقرير أن إيرادات الشركة تنمو."), "ar", "ar");
});

await test("markdown to plain text", () => {
  eq(ex.markdownToText("### Outlook\n\n- One point.\n- **Two** points."), "Outlook\n\n• One point.\n• Two points.", "plain");
});

await test("key sentences: on-topic ones, filler left out, in document order", () => {
  const units = [
    ["Solar power adoption", "Solar power adoption in cities grew quickly over the last decade as panel prices fell."],
    ["Solar power adoption", "Cheaper solar panels made rooftop solar power affordable for many households in cities."],
    ["Solar power adoption", "The weather was pleasant on the day the survey started."],
    ["Storage and the grid", "Battery storage lets households keep solar power for the evening, when demand peaks."],
    ["Storage and the grid", "Lunch was served in the main hall."],
    ["Outlook", "Analysts expect solar power and battery storage to supply a third of city electricity by 2035."],
  ].map(([heading, text]) => ({ heading, text }));
  const md = ex.summarize({ units, headings: ["Solar power adoption", "Storage and the grid", "Outlook"] }, "long", "en");
  eq(/weather|Lunch/.test(md), false, "filler left out");
  const at = units.map((u) => md.indexOf(u.text)).filter((i) => i >= 0);
  eq(at.length >= 2 && at.every((i, k) => k === 0 || i > at[k - 1]), true, `document order: ${md}`);
});

await test("report.pdf: the text and table figures go to the server AI, never the file", async () => {
  const before = sent.length;
  const out = await run(report, { summaryLength: "medium" });
  const body = sent[before];
  eq(`${body.task} ${body.points} ${body.language}`, "summarize 5 en", "task, points, language");
  eq(body.text.includes("Revenue grew 12 percent"), true, "the prose");
  eq(body.text.includes("North: 1,200 · 1,350 · 12%"), true, "the table's figures");
  eq(body.text.includes("%PDF"), false, "not the file");
  eq(out.name, "report-summary.md", "name");
  eq(out.blob.type.startsWith("text/markdown"), true, "type");
  eq(out.note, "summary:cloud:groq", "note");
  eq(out.text, "- Point 1 in en\n- Point 2 in en\n- Point 3 in en\n- Point 4 in en\n- Point 5 in en\n", "points as a Markdown list");
  eq(requests, 0, "other requests");
});

await test("short, medium and long ask for 3, 5 and 8 points", async () => {
  for (const [summaryLength, n] of [["short", 3], ["medium", 5], ["long", 8]]) {
    await run(report, { summaryLength });
    eq(sent.at(-1).points, n, summaryLength);
  }
});

await test("another language: asked for by its tag; the document's own needs none", async () => {
  await run(report, { summaryLang: "fr" });
  eq(sent.at(-1).language, "fr", "fr");
  await run(report, { summaryLang: "zh-tw" });
  eq(sent.at(-1).language, "zh-Hant", "zh-tw");
  await run(report, { summaryLang: "zh-cn" });
  eq(sent.at(-1).language, "zh", "zh-cn");
  await run(report, { summaryLang: "en" });
  eq(sent.at(-1).language, "en", "same as the document");
});

await test("a long document: its opening and key sentences, flagged as truncated", async () => {
  const doc = await PDFDocument.create();
  const { StandardFonts } = await import("pdf-lib");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 40; p++) {
    const page = doc.addPage([595, 842]);
    for (let l = 0; l < 40; l++) page.drawText(`Page ${p + 1} line ${l + 1} talks about the budget for the harbour project in detail.`, { x: 40, y: 800 - l * 19, size: 10, font });
  }
  const out = await run(await doc.save(), {}, "long.pdf");
  const body = sent.at(-1);
  eq(body.text.length <= 58000, true, `${body.text.length} characters sent`);
  eq(body.text.includes("Key sentences from the rest:"), true, "key sentences");
  eq(out.note, "summary:cloud:groq:truncated", "note");
});

await test("the server AI doesn't answer, or answers with no points: cloud_failed", async () => {
  for (const r of [() => ({ status: 503, error: "no AI provider answered" }), () => "I can't help with that."]) {
    reply = r;
    let code = "";
    try {
      await run(report, { summaryLang: "de" });
    } catch (e) {
      code = e.code;
    }
    eq(code, "cloud_failed", "error code");
  }
});

await test("a PDF with no text is a no_text error, and nothing is sent", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const before = sent.length;
  let code = "";
  try {
    await run(await doc.save(), {}, "blank.pdf");
  } catch (e) {
    code = e.code;
  }
  eq(code, "no_text", "code");
  eq(sent.length, before, "nothing sent");
});

console.log(results.failed ? `\n${results.failed} failed` : "\nall passed");
process.exit(results.failed ? 1 : 0);
