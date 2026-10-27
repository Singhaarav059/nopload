// Page citations. The model sees the retrieved chunks as excerpts, each
// starting with its page ("p. 5"), and is asked to cite pages as (p. 5).
// Its answer's markers are mapped back to pages here; a marker naming a
// source or page that wasn't given is dropped, so a citation always points
// at text the answer was built from. An answer with no markers gets the
// sources it borrows its words from.

import { splitSentences } from "./extractive";
import { tokens, type Hit } from "./retrieve";

export type Source = { n: number; page: number; text: string };
// A stretch of answer text and the pages it cites.
export type Part = { text: string; pages?: number[] };
// blocks: the answer laid out (./format.ts); text: as the model wrote it.
export type Answer = { parts: Part[]; pages: number[]; blocks?: import("./format").Block[]; text?: string };

// The excerpts for the prompt: the chunks' pages in document order, each
// once, with its units in page order; where chunks of a page overlap, the
// shared units are sent once, so a row is never counted twice in a total.
export function numberSources(hits: Hit[]): { sources: Source[]; context: string } {
  const pages = new Map<number, Map<number, string>>();
  for (const { chunk } of hits) {
    const units = pages.get(chunk.page) ?? new Map<number, string>();
    chunk.units.forEach((u, i) => units.set(chunk.from + i, u));
    pages.set(chunk.page, units);
  }
  const sources = [...pages.keys()]
    .sort((a, b) => a - b)
    .map((page, i) => ({ n: i + 1, page, text: [...pages.get(page)!].sort((a, b) => a[0] - b[0]).map(([, u]) => u).join("\n") }));
  return { sources, context: sources.map((s) => `(p. ${s.page})\n${s.text}`).join("\n\n") };
}

// One or more markers in a row: [1], [1, 2], [p. 3], [page 3], (page 3),
// (p. 3), (p. 2, p. 7), (pp. 2–3), or a bare "p. 3" at the end of a sentence.
const MARKER =
  /\[\s*\d+(?:\s*[,;]\s*\d+)*\s*\]|[[(]\s*(?:pp?\.?|pages?|pg\.?)\s*\d+(?:\s*(?:[,;&–-]|and)\s*(?:pp?\.?\s*|pages?\s*)?\d+)*\s*[\])]|\bpp?\.\s?\d+(?:\s*(?:[,–-]|and)\s*(?:p\.\s?)?\d+)*(?=\s*[.;,]?\s*(?:$|\n|[A-Z]))/gim;
const GROUP = new RegExp(`(?:\\s*(?:${MARKER.source}))+`, "gim");

const unique = (xs: number[]) => [...new Set(xs)];

export function citations(answer: string, sources: Source[]): Answer {
  const byN = new Map(sources.map((s) => [s.n, s.page]));
  const known = new Set(sources.map((s) => s.page));
  const parts: Part[] = [];
  let last = 0;
  const add = (text: string, pages: number[]) => {
    if (text || (!parts.length && pages.length)) parts.push({ text, pages });
    else if (parts.length) parts[parts.length - 1].pages = unique([...(parts[parts.length - 1].pages ?? []), ...pages]);
  };
  for (const g of answer.matchAll(GROUP)) {
    const pages: number[] = [];
    for (const [m] of g[0].matchAll(MARKER)) {
      const nums = (m.match(/\d+/g) ?? []).map(Number);
      if (/p/i.test(m)) pages.push(...nums.filter((p) => known.has(p)));
      else for (const n of nums) if (byN.has(n)) pages.push(byN.get(n)!);
    }
    // "…, as stated in [1]", "(see [1])": the chip says it already.
    const before = answer.slice(last, g.index).replace(/[,;]?\s*(?:\(\s*(?:see|source|sources)|(?:as\s+)?(?:cited|stated|mentioned|shown|given|found)\s+(?:in|on))\s*$/i, "");
    add(before.trim(), unique(pages));
    last = g.index! + g[0].length;
  }
  add(answer.slice(last).replace(/^\)/, "").trim(), []);
  return { parts, pages: unique(parts.flatMap((p) => p.pages ?? [])) };
}

// The pages of the sources most of an answer's words come from, sentence by sentence.
export function attribute(answer: string, sources: Source[]): number[] {
  const pages: number[] = [];
  const bags = sources.map((s) => new Set(tokens(s.text)));
  for (const sentence of splitSentences(answer)) {
    const words = [...new Set(tokens(sentence))];
    if (words.length < 2) continue;
    let best = -1, share = 0;
    bags.forEach((bag, i) => {
      const s = words.filter((w) => bag.has(w)).length / words.length;
      if (s > share) [best, share] = [i, s];
    });
    if (best >= 0 && share >= 0.6) pages.push(sources[best].page);
  }
  return unique(pages);
}
