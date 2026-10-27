"use client";

// Summarize PDF: the server AI (./cloud.ts) writes the key points from the
// document's text, in the language asked for. Only the text is sent, never
// the file. When the server AI doesn't answer, the tool says so.

import { baseName, closePdf, openPdf, pdfjs, type Output, type Progress } from "../pdf/common";
import { PdfError } from "../pdf/errors";
import { documentLayout } from "../pdf/layout";
import { blocks, bodySizeOf, type Line } from "../pdf/text";
import { guessLanguage, summarize, type Doc, type Length, type Unit } from "./extractive";
import { cloudText } from "./cloud";

// Site locales → language tags.
const TAGS: Record<string, string> = { "zh-cn": "zh", "zh-tw": "zh-Hant" };
export const languageTag = (locale: string) => TAGS[locale] ?? locale;

const LENGTHS: Length[] = ["short", "medium", "long"];

// Paragraphs and list items under their headings, in reading order, and
// the tables as grids of cell text; figures, headers and footers are left out.
type Read = Doc & { tables: string[][][] };
async function readDoc(file: File, progress?: Progress): Promise<Read> {
  const doc = await openPdf(await file.arrayBuffer());
  try {
    const layouts = await documentLayout(doc, (i) => progress?.(i * 0.9, doc.numPages));
    const all = (l: (typeof layouts)[number]) =>
      l.sections.flatMap((s) => s.columns.flatMap((c) => c.items.flatMap((it) => (it.kind === "lines" ? [it.lines] : []))));
    const body = bodySizeOf(layouts.map((l) => ({ lines: all(l).flat() })));
    const units: Unit[] = [];
    const headings: string[] = [];
    const tables: string[][][] = [];
    for (const l of layouts)
      for (const sec of l.sections)
        for (const c of sec.columns)
          for (const it of c.items) {
            if (it.kind !== "table") continue;
            const grid = Array.from({ length: it.table.rows }, () => Array<string>(it.table.cols).fill(""));
            for (const cell of it.table.cells) grid[cell.row][cell.col] = cell.text.replace(/\s+/g, " ").trim();
            tables.push(grid);
          }
    let heading: string | undefined;
    for (const layout of layouts)
      for (const lines of all(layout))
        for (const b of blocks(lines as Line[], body)) {
          if (b.kind === "heading") {
            heading = b.text.trim();
            headings.push(heading);
          } else units.push({ text: b.text.replace(/^([•◦▪●○■\-–*]|\d{1,3}[.)])\s+/, ""), heading });
        }
    return { units, headings, tables };
  } finally {
    await closePdf(doc);
  }
}

// The figures in the document's tables, which its sentences would miss, for
// the AI to read: each table once (a report may repeat a table page after
// page), its header row and a line per row, "label: value · value".
const TABLE_ROWS: Record<Length, number> = { short: 4, medium: 8, long: 16 };
function tableText(tables: string[][][], length: Length): string {
  const seen = new Set<string>();
  const text: string[] = [];
  let rows = 0;
  for (const grid of tables) {
    const filled = grid.filter((r) => r.some((c) => c));
    if (filled.length < 2 || filled[0].length < 2) continue;
    const key = JSON.stringify(filled);
    if (seen.has(key)) continue;
    seen.add(key);
    const [head, ...body] = filled;
    const room = TABLE_ROWS[length] - rows;
    if (room <= 0) break;
    const lines = body.slice(0, room).map((r) => `${r[0] || head[0]}: ${r.slice(1).filter((c) => c).join(" · ")}`);
    rows += lines.length;
    text.push(head.join(" · "), ...lines);
  }
  return text.join("\n");
}

// How many key points the AI writes for each length.
const POINTS: Record<Length, number> = { short: 3, medium: 5, long: 8 };

// How much of the document the cloud AI reads (functions/api/ai.ts takes up
// to 60,000 characters): all of it when it fits, else its key sentences and
// as much of its opening as fits beside them.
const CLOUD_CHARS = 58_000;
function cloudInput(doc: Doc, text: string, lang: string | undefined) {
  if (text.length <= CLOUD_CHARS) return text;
  const key = summarize(doc, "long", lang).replace(/^- /gm, "").trim();
  return `${text.slice(0, Math.max(0, CLOUD_CHARS - key.length - 40))}\n\n[…]\n\nKey sentences from the rest:\n${key}`.slice(0, CLOUD_CHARS);
}

// The cloud AI's summary (./cloud.ts), written in the wanted language. Only
// the document's text is sent, never the file.
async function cloudSummary(doc: Doc, text: string, length: Length, lang: string | undefined, out: string | undefined, name: string) {
  let reply: { text: string; provider: string };
  try {
    reply = await cloudText({ task: "summarize", text: cloudInput(doc, text, lang), points: POINTS[length], language: out ?? lang ?? "en" });
  } catch (e) {
    console.warn("The server AI didn't answer.", e);
    throw new PdfError("cloud_failed", name);
  }
  const points = reply.text.split("\n").map((l) => l.trim()).filter((l) => /^([-*•]|\d+[.)])\s+\S/.test(l)).map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, "- "));
  if (!points.length) throw new PdfError("cloud_failed", name);
  return { md: points.join("\n"), provider: reply.provider };
}

const same = (a: string | undefined, b: string) => !!a && a.split("-")[0].toLowerCase() === b.split("-")[0].toLowerCase() && !(b === "zh-Hant" && a === "zh");

export async function summarizePdf(file: File, o: { summaryLength: string; summaryLang: string }, progress?: Progress): Promise<Output[]> {
  const length = (LENGTHS.includes(o.summaryLength as Length) ? o.summaryLength : "medium") as Length;
  const doc = await readDoc(file, progress);
  const figures = tableText(doc.tables, length);
  const prose = doc.units.map((u) => u.text).join("\n");
  // What the AI reads: the sentences, and the tables' figures.
  const text = figures ? `${prose}\n\n${figures}` : prose;
  if (!text.trim()) throw new PdfError("no_text", file.name);
  const lang = guessLanguage(text);
  const target = o.summaryLang && o.summaryLang !== "same" ? languageTag(o.summaryLang) : undefined;
  const wanted = target && !same(lang, target) ? target : undefined;
  const cloud = await cloudSummary(doc, text, length, lang, wanted, file.name);
  progress?.(1, 1);
  // Too long to send whole (cloudInput): the note says the summary rests on part of it.
  return [{ name: `${baseName(file.name)}-summary.md`, blob: new Blob([cloud.md.trim() + "\n"], { type: "text/markdown" }), note: `summary:cloud:${cloud.provider}${text.length > CLOUD_CHARS ? ":truncated" : ""}` }];
}

// Loads what a run loads (src/lib/offline.ts).
export const prepare = () => pdfjs();
