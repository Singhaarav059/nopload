// Cuts a document into chunks a question can be matched against. A chunk
// never crosses a page, so every chunk, and every answer built from it, has
// exactly one page to cite.
//
// A chunk is made of units, each kept whole: a line that stands on its own
// (a table row, a statement entry with its date, payee and amount) is one
// unit, and lines of running text are joined into paragraphs and cut at
// sentences. Chunks overlap by one unit, so a fact split across a cut is
// still whole in one of them; `from` says where a chunk's units start on its
// page, so the overlap can be left out when chunks are put side by side.

import { splitSentences } from "./extractive";

export type PageText = { page: number; text: string };
export type Chunk = { id: number; page: number; text: string; units: string[]; from: number };

const count = (s: string) => s.split(/\s+/).filter(Boolean).length;

// Text as a PDF's text layer gives it, tidied: every kind of space and tab
// one space, invisible characters gone, a word hyphenated across a line
// break joined again, at most one blank line in a row, lines trimmed.
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/[\t   -   　]+/g, " ")
    .replace(/([\p{Ll}])-\n(?=\p{Ll})/gu, "$1")
    .split("\n")
    .map((l) => l.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// An amount (1,234.50 · 1.234,50 · ₹500 · $12 · 500.00 Dr), a date
// (12/10/2026 · 2026-10-12 · 12 Oct), or a table row's cells.
const AMOUNT = /(?:[₹$€£¥]|rs\.?|inr|usd|eur)\s?\d|\d[\d,.]*[.,]\d{2}\b|\b\d+(?:[.,]\d+)?\s?(?:cr|dr)\b/i;
const DATE = /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b|\b\d{1,2}[ -](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const isRow = (line: string) => line.includes(" | ") || AMOUNT.test(line) || DATE.test(line);

// A page's units, in order: rows whole, running text by the sentence.
export function unitsOf(text: string, lang?: string): string[] {
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(...splitSentences(para.join(" "), lang));
    para = [];
  };
  for (const line of cleanText(text).split("\n")) {
    if (!line) flush();
    else if (isRow(line)) {
      flush();
      out.push(line);
    } else para.push(line);
  }
  flush();
  return out;
}

export function chunkPages(pages: PageText[], o: { maxWords?: number; lang?: string } = {}): Chunk[] {
  const max = o.maxWords ?? 120;
  const chunks: Chunk[] = [];
  for (const { page, text } of pages) {
    // A unit longer than a chunk is cut at words.
    const units = unitsOf(text, o.lang).flatMap((s) => {
      const w = s.split(/\s+/).filter(Boolean);
      if (w.length <= max) return [s];
      const out: string[] = [];
      for (let i = 0; i < w.length; i += max) out.push(w.slice(i, i + max).join(" "));
      return out;
    });
    let start = 0;
    while (start < units.length) {
      let end = start;
      let words = 0;
      while (end < units.length && (end === start || words + count(units[end]) <= max)) words += count(units[end++]);
      const part = units.slice(start, end);
      chunks.push({ id: chunks.length, page, text: part.join(" "), units: part, from: start });
      if (end >= units.length) break;
      // Start the next chunk with the last unit, if it leaves room for more.
      start = end - 1 > start && count(units[end - 1]) + count(units[end]) <= max ? end - 1 : end;
    }
  }
  return chunks;
}
