// Chat's retrieval: how documents are tidied and cut into page-sized chunks
// that keep statement rows whole, how the chunks for a question are found
// (keywords and exact names; many more for "the biggest" or "the total"),
// what the server AI is sent, and how an answer's citations become page
// numbers. Then chat end to end on a real 20-page PDF, and Translate PDF,
// with a stand-in server AI.
//
//   node tests/ai.mjs
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load, openPdf, check, eq, root, vendorDir } from "./lib/load.mjs";

const { chunkPages } = await load("../ai/chunk");
const { search, fuse, tokens } = await load("../ai/retrieve");
const { exactTerms, missingTerms, isAggregate } = await load("../ai/retrieve");
const { cleanText, unitsOf } = await load("../ai/chunk");
const { numberSources, citations, attribute } = await load("../ai/cite");
const { readPages, buildIndex, askCloud } = await load("../ai/chat");
const { translatePdf } = await load("../ai/translate");
const results = { failed: 0 };
const test = check(results);

// No request may leave the page but the ones to the server AI (/api/ai),
// which `ai` answers when set: what it was sent goes in `aiSent`. The Noto
// fonts translations are drawn in come from /vendor, read from disk here.
let requests = 0;
let ai = null;
const aiSent = [];
globalThis.fetch = async (url, init) => {
  const m = String(url).match(/^\/vendor\/[^/]+\/(fonts\/.+)$/);
  if (m) return new Response(readFileSync(join(vendorDir, m[1])));
  if (url === "/api/ai" && ai && init?.method === "POST") {
    const body = JSON.parse(init.body);
    aiSent.push(body);
    const reply = ai(body);
    return typeof reply === "string" ? new Response(reply, { headers: { "X-AI-Provider": "groq" } }) : Response.json(reply, { status: reply.status ?? 200, headers: { "X-AI-Provider": "groq" } });
  }
  requests++;
  throw new Error("network");
};

const words = (n, w = "filler") => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ") + ".";

await test("chunks: one page each, numbered from 1, empty pages skipped", () => {
  const chunks = chunkPages([
    { page: 1, text: "The cover page. It has two sentences." },
    { page: 2, text: "   " },
    { page: 3, text: "Payment is due in 30 days. The invoice total is $1,234.50." },
  ]);
  eq(chunks.length, 2, "chunks");
  eq(chunks.map((c) => c.page).join(","), "1,3", "pages");
  eq(chunks[1].text.includes("$1,234.50"), true, "text kept");
  eq(chunks.every((c, i) => c.id === i), true, "ids in order");
});

await test("chunks: a long page is cut at sentences, within the word budget, overlapping by one sentence", () => {
  const sentences = Array.from({ length: 12 }, (_, i) => `Sentence ${i} ${words(18, `w${i}x`)}`);
  const chunks = chunkPages([{ page: 7, text: sentences.join(" ") }], { maxWords: 60 });
  eq(chunks.length > 2, true, `several chunks (${chunks.length})`);
  for (const c of chunks) {
    eq(c.page, 7, "page");
    eq(c.text.split(/\s+/).length <= 60, true, `within budget: ${c.text.split(/\s+/).length}`);
  }
  // Each chunk starts with the last sentence of the one before.
  const lastOf = (t) => t.match(/Sentence \d+ /g).at(-1);
  eq(chunks[1].text.startsWith(lastOf(chunks[0].text)), true, "overlap");
  // Every sentence is in some chunk.
  for (let i = 0; i < 12; i++) eq(chunks.some((c) => c.text.includes(`Sentence ${i} `)), true, `sentence ${i}`);
});

await test("chunks: a sentence longer than the budget is cut at words", () => {
  const chunks = chunkPages([{ page: 2, text: words(250) }], { maxWords: 100 });
  eq(chunks.length, 3, "three chunks");
  eq(chunks.every((c) => c.text.split(/\s+/).length <= 100), true, "within budget");
});

await test("tokens: lower case, stop words out, plurals folded, CJK as bigrams", () => {
  eq(tokens("What is the Invoice total?").join(" "), "invoice total", "English");
  eq(tokens("Invoices and totals").join(" "), "invoice total", "plurals");
  eq(tokens("請求書の合計").join(" "), "請求 求書 書の の合 合計", "CJK bigrams");
});

const invoice = [
  { page: 1, text: "Quarterly report. Revenue grew 12 percent this quarter, driven by renewals." },
  { page: 2, text: "The team hired four engineers. Office costs stayed flat." },
  { page: 3, text: "Invoice INV-2041 from Acme Ltd. The invoice total is $1,234.50, due on 30 November." },
  { page: 4, text: "Totals for travel were lower than planned. The board met twice." },
];

await test("search: 'what is the invoice total' finds page 3 first", () => {
  const hits = search(chunkPages(invoice), "what is the invoice total", { k: 3 });
  eq(hits[0].chunk.page, 3, "top page");
  eq(hits.length <= 3, true, "at most k");
  eq(hits.every((h, i) => i === 0 || h.score <= hits[i - 1].score), true, "best first");
});

await test("search: reciprocal rank fusion", () => {
  const fused = fuse([[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]], (x) => x.id);
  eq(fused.map((x) => x.item.id).join(","), "2,1,3", "fused order");
});

await test("sources: each page once, in document order, starting with its page", () => {
  const hits = search(chunkPages(invoice), "invoice total", { k: 2 });
  const { sources, context } = numberSources(hits);
  eq(sources.map((x) => x.page).join(","), [...hits.map((h) => h.chunk.page)].sort((a, b) => a - b).join(","), "pages in order");
  eq(context.startsWith(`(p. ${sources[0].page})\n`), true, `context: ${context.split("\n")[0]}`);
  eq(context.includes("(p. 3)\nInvoice INV-2041"), true, "page 3's excerpt");
});

await test("sources: where chunks of a page overlap, each row is sent once", () => {
  const rows = Array.from({ length: 30 }, (_, i) => `0${(i % 9) + 1}/10/2026 UPI/DR/${4000 + i}/Merchant ${i} ₹${(i + 1) * 10}.00`);
  const chunks = chunkPages([{ page: 4, text: rows.join("\n") }], { maxWords: 20 });
  eq(chunks.length > 3, true, `several chunks (${chunks.length})`);
  const { context } = numberSources(chunks.map((chunk) => ({ chunk, score: 1 })));
  for (const r of rows) eq(context.split(r).length - 1, 1, `once: ${r}`);
});

await test("citations: [n], [n, m], [n][m], (page n) and [p. n] become pages; unknown ones are dropped", () => {
  const sources = [{ n: 1, page: 3, text: "a" }, { n: 2, page: 9, text: "b" }];
  const r = citations("The total is $1,234.50 [1]. It is due soon [1, 2][2]. See (page 9) and [p. 3]. Not [7].", sources);
  eq(r.pages.join(","), "3,9", "pages, in order, once each");
  eq(r.parts.map((p) => p.text).join("|"), "The total is $1,234.50|. It is due soon|. See|and|. Not|.", "text without markers");
  eq(JSON.stringify(r.parts.map((p) => p.pages ?? [])), JSON.stringify([[3], [3, 9], [9], [3], [], []]), "pages per part");
  // Lead-ins to a marker go: the page chip says it.
  eq(citations("The total is $1,234.50, cited in [1].", sources).parts.map((p) => p.text).join("|"), "The total is $1,234.50|.", "cited in");
  eq(citations("It is due soon (see [2]).", sources).parts.map((p) => p.text).join("|"), "It is due soon|.", "see");
  // A page the answer names that no source has is not a citation.
  eq(citations("On page 40 [p. 40].", sources).pages.length, 0, "unknown page");
});

await test("attribution: an answer without citations gets the sources it borrows from", () => {
  const sources = [{ n: 1, page: 3, text: "The invoice total is $1,234.50, due on 30 November." }, { n: 2, page: 2, text: "The team hired four engineers." }];
  eq(attribute("The invoice total is $1,234.50.", sources).join(","), "3", "page 3");
  eq(attribute("I don't know.", sources).length, 0, "nothing borrowed");
});

await test("citations: (p. 5), (p. 2, p. 7) and a bare p. 5 at a sentence's end become pages", () => {
  const sources = [{ n: 1, page: 2, text: "a" }, { n: 2, page: 5, text: "b" }, { n: 3, page: 7, text: "c" }];
  const r = citations("You paid ₹500 to Hazelnut Cafe (p. 5). Two refunds came in (p. 2, p. 7). The rent went out on 1 October p. 2.", sources);
  eq(JSON.stringify(r.parts.map((p) => p.pages ?? [])), JSON.stringify([[5], [2, 7], [2], []]), "pages per sentence");
  eq(r.parts.map((p) => p.text).join("|"), "You paid ₹500 to Hazelnut Cafe|. Two refunds came in|. The rent went out on 1 October|.", "text without markers");
});

await test("clean text: spaces and invisible characters tidied, hyphenated words joined, rows on their own lines", () => {
  eq(cleanText("Paid\u00a0to   Hazel\u200bnut\tCafe\r\nrecon-\nciled\n\n\n\nnext"), "Paid to Hazelnut Cafe\nreconciled\n\nnext", "tidied");
  const page = "Statement for October\nThis account is in good\nstanding and was opened in 2019.\n01/10/2026 UPI/DR/4471/HAZELNUTCAFE@okaxis ₹450.00\n02/10/2026 NEFT/CR/Salary Acme Ltd 85,000.00 Cr\nDate | Narration | Amount";
  eq(JSON.stringify(unitsOf(page)), JSON.stringify([
    "Statement for October This account is in good standing and was opened in 2019.",
    "01/10/2026 UPI/DR/4471/HAZELNUTCAFE@okaxis ₹450.00",
    "02/10/2026 NEFT/CR/Salary Acme Ltd 85,000.00 Cr",
    "Date | Narration | Amount",
  ]), "rows whole, prose joined");
});

await test("chunks: a statement's rows are never cut, however many there are", () => {
  const rows = Array.from({ length: 80 }, (_, i) => `${String((i % 28) + 1).padStart(2, "0")}/10/2026 UPI/DR/${5000 + i}/PAYEE${i}@okhdfc Groceries and household items ₹${(i * 37) % 900}.50`);
  const chunks = chunkPages([{ page: 1, text: rows.join("\n") }]);
  for (const c of chunks) for (const u of c.units) eq(rows.includes(u), true, `a whole row: ${u}`);
  for (const r of rows) eq(chunks.some((c) => c.units.includes(r)), true, `kept: ${r}`);
});

const statement = [
  { page: 1, text: "Account statement, October 2026\nOpening balance ₹12,000.00" },
  { page: 2, text: "03/10/2026 UPI/DR/4471/HAZELNUTCAFE@okaxis Coffee ₹450.00\n05/10/2026 UPI/DR/4502/rent.landlord@oksbi ₹18,500.00\n06/10/2026 NEFT/CR/Salary Acme Ltd ₹85,000.00" },
  { page: 3, text: "09/10/2026 UPI/DR/4633/bigbasket@ybl Groceries ₹2,310.75\n12/10/2026 IMPS/CR/Refund Flipkart ₹999.00" },
];

await test("exact terms: a name inside a UPI ID is found; question words aren't looked for", () => {
  eq(exactTerms("How much did I pay Hazelnut?").join(","), "hazelnut", "distinctive words only");
  eq(exactTerms("What is the biggest payment in total?").join(","), "", "nothing distinctive");
  const hits = search(chunkPages(statement), "How much did I pay hazelnut", { k: 2 });
  eq(hits[0].chunk.page, 2, "page with HAZELNUTCAFE@okaxis first");
  eq(missingTerms(chunkPages(statement), "Did I pay Starbucks?").join(","), "starbucks", "missing");
  eq(missingTerms(chunkPages(statement), "How much went to Hazelnut?").length, 0, "present");
});

await test("aggregate questions are told apart", () => {
  for (const q of ["What is the biggest payment?", "total spent on groceries", "List all refunds", "how much did I spend", "lowest balance"]) eq(isAggregate(q), true, q);
  for (const q of ["When was the rent paid?", "Who is the landlord?"]) eq(isAggregate(q), false, q);
});

// A stand-in server AI that answers every question with `answer`.
const answering = (answer) => (ai = (body) => (body.task === "chat" ? answer : { status: 400, error: "unexpected" }));

await test("chat: 'the biggest payment' sends every page with amounts, each row once, never the file", async () => {
  const index = buildIndex(statement);
  answering("The biggest payment was ₹18,500.00 to rent.landlord@oksbi on 5 October (p. 2).");
  const a = await askCloud(index, "What is the biggest payment?", {});
  const sent = aiSent.at(-1);
  eq(`${sent.task}: ${sent.question}`, "chat: What is the biggest payment?", "the question");
  for (const p of [1, 2, 3]) eq(sent.sources.includes(`(p. ${p})`), true, `page ${p} sent`);
  eq(sent.sources.split("rent.landlord@oksbi").length - 1, 1, "each row once");
  eq(a.pages.join(","), "2", "cites page 2");
  eq(a.provider, "groq", "who answered");
});

await test("chat: a name that isn't in the document is named as missing", async () => {
  answering("I couldn't find any mention of Starbucks in the document.");
  await askCloud(buildIndex(statement), "How much did I pay Starbucks?", {});
  eq(aiSent.at(-1).sources.includes('Note: "starbucks" appears nowhere in the document.'), true, "note");
});

await test("chat: earlier turns go along, the last four", async () => {
  answering("It was paid on 5 October (p. 2).");
  const history = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turn ${i}` }));
  await askCloud(buildIndex(statement), "When was the rent paid?", { history });
  eq(aiSent.at(-1).history.map((m) => m.content).join(","), "turn 2,turn 3,turn 4,turn 5", "history");
});

// A 20-page PDF: report filler, with the invoice on page 14.
async function twenty() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 20; i++) {
    const page = doc.addPage([595, 842]);
    const lines = i === 14
      ? ["Invoice INV-2041", "Bill to: Northwind Traders", "Consulting services, October: $1,100.00", "Tax: $134.50", "The invoice total is $1,234.50, due on 30 November."]
      : [`Section ${i}`, `This section describes project milestone ${i} and the risks the team saw.`, "Weekly meetings kept everyone informed about progress."];
    lines.forEach((l, j) => page.drawText(l, { x: 60, y: 760 - j * 22, size: 12, font }));
  }
  return new File([await doc.save()], "twenty.pdf", { type: "application/pdf" });
}

await test("twenty pages: read page by page, then chat finds page 14 for the invoice total and cites it", async () => {
  const file = await twenty();
  // pdf.js in Node runs its worker in the main thread once a document has been opened directly.
  await openPdf(new Uint8Array(await file.arrayBuffer()));
  const pages = await readPages(file);
  eq(pages.length, 20, "pages");
  eq(pages[13].page, 14, "numbered from 1");
  eq(pages[13].text.includes("$1,234.50"), true, "page 14 text");
  // Lines repeated on every page count as headers and footers in the layout; they're still text.
  eq(pages[0].text.includes("project milestone 1 "), true, `page 1 text: ${pages[0].text}`);
  answering("The invoice total is $1,234.50 (p. 14).");
  const answer = await askCloud(buildIndex(pages), "What is the invoice total?", {});
  eq(aiSent.at(-1).sources.includes("(p. 14)\nInvoice INV-2041"), true, "page 14 sent");
  eq(JSON.stringify(aiSent.at(-1)).length < 24000, true, "text only, not the file");
  eq(answer.pages[0], 14, `cites page 14 (got ${answer.pages})`);
  eq(requests, 0, "requests");
});

// A stand-in translator: tags each block, so the output shows what was translated.
const tagged = { engine: "test", done() {}, translate: async (s) => `ES[${s.length}] ${s.split(" ").reverse().join(" ")}` };
const pdfText = async (bytes) => {
  const doc = await openPdf(bytes);
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => it.str).join(" "));
  return pages;
};

await test("translate report.pdf, keep layout: same pages, only translated text, nothing fetched", async () => {
  const bytes = readFileSync(join(root, "tests/fixtures/report.pdf"));
  const before = await pdfText(new Uint8Array(bytes));
  const [out] = await translatePdf(new File([bytes], "report.pdf"), { translateLang: "es", translateFormat: "pdf" }, undefined, tagged);
  eq(out.name, "report-es.pdf", "name");
  eq(out.note, "translate:test", "note");
  const after = await pdfText(new Uint8Array(await out.blob.arrayBuffer()));
  eq(after.length, before.length, "page count");
  const text = after.join(" ");
  eq((text.match(/ES\[/g) ?? []).length > 3, true, `translated blocks (${text.slice(0, 120)})`);
  eq(text.includes("Revenue grew 12 percent"), false, "original text taken out");
  // Numbers aren't translated, but they're still there.
  eq(text.includes("1,200") && text.includes("2,210"), true, "table figures kept");
  eq(requests, 0, "requests");
});

await test("translate to Markdown: the translated blocks, page by page, headings kept", async () => {
  const bytes = readFileSync(join(root, "tests/fixtures/report.pdf"));
  const [out] = await translatePdf(new File([bytes], "report.pdf"), { translateLang: "es", translateFormat: "md" }, undefined, tagged);
  const md = await out.blob.text();
  eq(out.name, "report-es.md", "name");
  eq(/^#{2,4} ES\[/m.test(md), true, `a heading (${md.slice(0, 120)})`);
  eq(md.split("\n\n").filter((b) => b.startsWith("ES[")).length > 2, true, "paragraphs");
});

await test("translate with the server AI: blocks in batches, named who answered", async () => {
  const bytes = readFileSync(join(root, "tests/fixtures/report.pdf"));
  ai = (body) => ({ texts: body.texts.map((t) => `ES ${t}`) });
  const before = aiSent.length;
  const [out] = await translatePdf(new File([bytes], "report.pdf"), { translateLang: "es", translateFormat: "md" });
  const sent = aiSent.slice(before);
  eq(sent.length > 0 && sent.every((b) => b.task === "translate" && b.language === "es"), true, "translate requests");
  eq(out.note, "translate:cloud:groq", "note");
  eq(/^ES /m.test(await out.blob.text()), true, "translated text");
});

await test("translate when the server AI doesn't answer: a clear error, not English output", async () => {
  const bytes = readFileSync(join(root, "tests/fixtures/report.pdf"));
  ai = () => ({ status: 503, error: "no AI provider answered" });
  let code = "";
  try {
    await translatePdf(new File([bytes], "report.pdf"), { translateLang: "fr", translateFormat: "pdf" });
  } catch (e) {
    code = e.code;
  }
  eq(code, "cloud_failed", "error code");
});

console.log(results.failed ? `\n${results.failed} failed` : "\nall passed");
process.exit(results.failed ? 1 : 0);
