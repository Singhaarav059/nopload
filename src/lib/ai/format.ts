// An answer's layout. The server AI writes a little Markdown (a lead
// sentence, "- " lists, "1. " steps, a small "| a | b |" table, **bold**,
// an occasional "### " heading); here it becomes blocks, each block's text
// with its page citations (./cite.ts), for the chat to show as such.

import { citations, type Part, type Source } from "./cite";

export type Block =
  | { kind: "p"; parts: Part[] }
  | { kind: "h"; parts: Part[] }
  | { kind: "ul" | "ol"; items: Part[][] }
  | { kind: "table"; head: Part[][]; rows: Part[][][] };

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const HEADING = /^\s*#{1,6}\s+/;
const ROW = /^\s*\|.*\|\s*$/;
const RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function blocksOf(text: string, sources: Source[]): Block[] {
  const cite = (s: string) => citations(s, sources).parts;
  const out: Block[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", parts: cite(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
    } else if (HEADING.test(line)) {
      flush();
      out.push({ kind: "h", parts: cite(line.replace(HEADING, "").replace(/\*\*/g, "")) });
    } else if (BULLET.test(line) || NUMBER.test(line)) {
      flush();
      const kind = BULLET.test(line) ? "ul" : "ol";
      const last = out[out.length - 1];
      const item = cite(line.replace(kind === "ul" ? BULLET : NUMBER, ""));
      if (last?.kind === kind) last.items.push(item);
      else out.push({ kind, items: [item] });
    } else if (ROW.test(line) && (RULE.test(lines[i + 1] ?? "") || out[out.length - 1]?.kind === "table")) {
      flush();
      const last = out[out.length - 1];
      if (last?.kind === "table" && !RULE.test(lines[i + 1] ?? "")) last.rows.push(cells(line).map(cite));
      else {
        out.push({ kind: "table", head: cells(line).map(cite), rows: [] });
        i++;
      }
    } else if (RULE.test(line) && out[out.length - 1]?.kind === "table") {
      // A stray rule inside a table.
    } else {
      // A line continuing a list item belongs to it.
      const last = out[out.length - 1];
      if (!para.length && (last?.kind === "ul" || last?.kind === "ol") && /^\s{2,}/.test(line)) last.items[last.items.length - 1].push(...cite(line));
      else para.push(line.trim());
    }
  }
  flush();
  return out;
}

// A stretch of text with its **bold** marked, for showing.
export function emphasis(text: string): { text: string; bold?: boolean }[] {
  return text.split(/\*\*(.+?)\*\*/g).flatMap((s, i) => (s ? [{ text: s.replace(/\*\*/g, ""), bold: i % 2 === 1 || undefined }] : []));
}
