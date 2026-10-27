// Chat with a PDF. The document is read page by page (its text layer, after
// auto-OCR of pages that are pictures of text), tidied and cut into chunks
// that keep each row whole (./chunk.ts), and indexed (./retrieve.ts). A
// question finds its chunks (many more, across the whole document, when it
// asks for the biggest, a total or a list); then the server AI (./cloud.ts)
// writes the answer from them, citing pages (./cite.ts). Only the question,
// the passages found for it and the earlier turns are sent, never the file.
// The passages themselves are never the answer.

import { closePdf, openPdf, type Progress } from "../pdf/common";
import { documentLayout, type PageLayout } from "../pdf/layout";
import { blocks, bodySizeOf, type Line } from "../pdf/text";
import { chunkPages, cleanText, type Chunk, type PageText } from "./chunk";
import { attribute, citations, numberSources, type Answer } from "./cite";
import { cloudText, type Provider } from "./cloud";
import { blocksOf } from "./format";
import { isAggregate, isOverview, missingTerms, search, type Hit } from "./retrieve";

export type { Answer, Part } from "./cite";
export type { PageText } from "./chunk";

const linesOf = (l: PageLayout) =>
  l.sections.flatMap((s) => s.columns.flatMap((c) => c.items.flatMap((it) => (it.kind === "lines" ? [it.lines] : []))));

// Each page's text in reading order: paragraphs, headings and list items on
// lines of their own, table rows with their cells joined by " | ". Header
// and footer lines (text repeated on most pages) are kept: a document can be
// mostly repeated lines, and repeated words count for little in the index.
export async function readPages(file: File, progress?: Progress): Promise<PageText[]> {
  const doc = await openPdf(await file.arrayBuffer());
  try {
    const layouts = await documentLayout(doc, (i) => progress?.(i, doc.numPages));
    const body = bodySizeOf(layouts.map((l) => ({ lines: linesOf(l).flat() })));
    return layouts.map((layout, i) => {
      const out: string[] = layout.header.map((l) => l.text.trim());
      for (const s of layout.sections)
        for (const c of s.columns)
          for (const it of c.items) {
            if (it.kind === "lines") for (const b of blocks(it.lines as Line[], body)) out.push(b.text.trim());
            else if (it.kind === "table") {
              const rows = new Map<number, string[]>();
              for (const cell of [...it.table.cells].sort((a, b) => a.row - b.row || a.col - b.col))
                rows.set(cell.row, [...(rows.get(cell.row) ?? []), cell.text.trim()]);
              for (const r of rows.values()) out.push(r.filter(Boolean).join(" | "));
            }
          }
      out.push(...layout.footer.map((l) => l.text.trim()));
      return { page: i + 1, text: cleanText(out.filter(Boolean).join("\n")) };
    });
  } finally {
    await closePdf(doc);
  }
}

// The document as chat reads it. Scanned pages first get the OCR text layer
// the PDF conversions use (../pdf/ocr.ts autoOcr: only pages that are
// pictures of text, and Tesseract isn't loaded when there are none), unless
// `ocr` is "off". `note` is the OCR note the conversions show: "ocrUsed",
// "ocrNone" or "ocrDoubtful", or "ocrSkipped" when OCR couldn't start (offline
// before its engine was ever fetched), in which case the pages keep the text
// they have.
export async function readDocument(file: File, o: { ocr?: string; ocrLang?: string } = {}, progress?: Progress): Promise<{ pages: PageText[]; note?: string }> {
  let note: string | undefined;
  let read = file;
  if (o.ocr !== "off") {
    try {
      const { autoOcr } = await import("../pdf/ocr");
      const scan = await autoOcr(file, { ocrLang: o.ocrLang || "eng" }, (d, t) => progress?.(d / Math.max(1, t) / 2, 1));
      if (scan.pages) [read, note] = [scan.file, scan.note];
    } catch {
      note = "ocrSkipped";
    }
  }
  const pages = await readPages(read, (d, t) => progress?.(0.5 + d / Math.max(1, t) / 2, 1));
  progress?.(1, 1);
  return { pages, note };
}

export type DocIndex = { pages: PageText[]; chunks: Chunk[] };

export function buildIndex(pages: PageText[]): DocIndex {
  return { pages, chunks: chunkPages(pages) };
}

// Has an amount or a number worth comparing in it.
const NUMBERED = /\d/;

// The chunks to answer from, in document order. A question looking across
// the whole document ("the biggest payment", "the total", "list all") gets
// at least `wide` of the best chunks, then, while `budget` characters allow,
// the rest of the chunks with numbers in them, so a maximum or a sum is
// taken over all of them and not just the few that sound most like the question.
function find(index: DocIndex, question: string, o: { k: number; wide: number; budget: number }): Hit[] {
  if (isOverview(question)) return overview(index, o.budget);
  const wide = isAggregate(question);
  const hits = search(index.chunks, question, { k: wide ? Math.max(o.k, o.wide) : o.k });
  if (wide) {
    let used = hits.reduce((n, h) => n + h.chunk.text.length, 0);
    const taken = new Set(hits.map((h) => h.chunk.id));
    for (const chunk of index.chunks) {
      if (taken.has(chunk.id) || !NUMBERED.test(chunk.text) || used + chunk.text.length > o.budget) continue;
      hits.push({ chunk, score: 0 });
      taken.add(chunk.id);
      used += chunk.text.length;
    }
  }
  // Nothing matches: the opening and a little of every page, so the AI can
  // say what isn't there rather than getting no excerpts at all.
  if (!hits.length) return overview(index, 6000);
  return hits.sort((a, b) => a.chunk.id - b.chunk.id);
}

// "What is this about?", "Summarise it": the opening of the document (its
// title, introduction, contents), then the first chunk of every page, then
// the rest in turn across the pages, while `budget` characters allow.
function overview(index: DocIndex, budget: number): Hit[] {
  const byPage = new Map<number, Chunk[]>();
  for (const c of index.chunks) byPage.set(c.page, [...(byPage.get(c.page) ?? []), c]);
  const order: Chunk[] = [...(byPage.get(index.chunks[0]?.page) ?? []).slice(0, 4)];
  for (let round = 0; order.length < index.chunks.length; round++) {
    let any = false;
    for (const list of byPage.values())
      if (list[round]) {
        any = true;
        order.push(list[round]);
      }
    if (!any) break;
  }
  const hits: Hit[] = [];
  const taken = new Set<number>();
  let used = 0;
  for (const chunk of order) {
    if (taken.has(chunk.id) || used + chunk.text.length > budget) continue;
    hits.push({ chunk, score: 0 });
    taken.add(chunk.id);
    used += chunk.text.length;
  }
  return hits.sort((a, b) => a.chunk.id - b.chunk.id);
}

// The excerpts for the prompt, with a note naming any of the question's
// distinctive words that appear nowhere in the document, so the model says
// it couldn't find them rather than answering from whatever came closest.
function excerpts(index: DocIndex, question: string, hits: Hit[]) {
  const { sources, context } = numberSources(hits);
  const missing = missingTerms(index.chunks, question);
  const note = missing.length ? `Note: ${missing.map((m) => `"${m}"`).join(", ")} ${missing.length > 1 ? "appear" : "appears"} nowhere in the document.\n\n` : "";
  return { sources, context: note + context };
}

export type Message = { role: "user" | "assistant"; content: string };

function cited(text: string, sources: ReturnType<typeof numberSources>["sources"], final = true): Answer {
  const answer = { ...citations(text, sources), blocks: blocksOf(text, sources), text };
  // No markers: cite the sources the answer's words come from, at its end.
  if (final && !answer.pages.length && answer.parts.length) {
    const pages = attribute(text, sources);
    if (pages.length) {
      answer.blocks.push({ kind: "p", parts: [{ text: "", pages }] });
      return { ...answer, parts: [{ text: answer.parts.map((p) => p.text).join(" "), pages }], pages };
    }
  }
  return answer;
}

// The answer, written by the server AI (functions/api/ai.ts says which model)
// from the best chunks, with its citations as pages. Earlier turns
// (questions and answers, without their sources) come along so follow-up
// questions make sense. Throws CloudUnavailable when it can't answer.
export async function askCloud(
  index: DocIndex,
  question: string,
  o: { history?: Message[]; onPartial?: (a: Answer) => void; signal?: AbortSignal },
): Promise<Answer & { provider: Provider }> {
  // 10 chunks, or for a question across the document 15 and then every
  // chunk with numbers that fits (the endpoint takes 24,000 characters).
  const hits = find(index, question, { k: 10, wide: 15, budget: 21_000 });
  const { sources, context } = excerpts(index, question, hits);
  const { text, provider } = await cloudText(
    { task: "chat", sources: context, question, history: (o.history ?? []).slice(-4) },
    { signal: o.signal, onText: o.onPartial && ((t) => o.onPartial!(cited(t, sources, false))) },
  );
  return { ...cited(text, sources), provider };
}
