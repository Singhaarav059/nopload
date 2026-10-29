// Read aloud as a narrator reads (src/components/workspace/ListenView.tsx):
// the document's passages turned into what is said, and how. A heading comes
// after a soft chime and a pause, a little slower; a list is introduced
// ("3 points:") and its bullets aren't read out; a table is described and
// read row by row, each value with its column's name, as a person would;
// links are read as their site's name; page furniture never gets here
// (src/lib/ai/speak.ts leaves it out). Pure, so tests can run it in Node.

export type Passage = {
  page: number;
  kind: "heading" | "paragraph" | "list" | "table";
  // 1 to 3, for a heading: 1 the biggest.
  level?: number;
  // As shown. A table's is its rows, " · " between cells, one row a line.
  text: string;
  // A table's cells, the first row its header.
  rows?: string[][];
};

// What is said, one sentence or two at a time.
//  - passage: the passage it belongs to (highlighted while it's said);
//  - at: where `text` starts in the passage's shown text, when it's that text
//    as shown, so the voice's word boundaries can mark the word being read;
//  - style: a heading is read slower; a cue is the narrator's own words;
//  - before/after: silence around it, in ms; chime: a soft sound before it.
export type Segment = {
  passage: number;
  text: string;
  at?: number;
  style: "heading" | "body" | "cue";
  before: number;
  after: number;
  chime?: boolean;
};

// The narrator's own words, in the document's language (the listen.cue.*
// strings, filled by format()).
export type Cues = {
  intro: (pages: number, sections: number) => string;
  list: (n: number) => string;
  table: (rows: number, cols: number) => string;
  more: (n: number) => string;
};

// Utterances are kept to a sentence or two: Chrome stops a long one after
// about 15 seconds, and a short one lets pause and skip respond at once.
// Each piece keeps its offset in the passage, for word highlighting.
export function pieces(text: string, max = 220): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  const sentences = text.match(/[^.!?。！？।]+[.!?。！？।]*\s*/g) ?? [text];
  let at = 0, cur = "", curAt = 0;
  const flush = () => {
    if (cur.trim()) out.push({ text: cur, at: curAt });
    cur = "";
  };
  for (const s of sentences) {
    if (cur && cur.length + s.length > max) flush();
    if (!cur) curAt = at;
    if (s.length > max) {
      // A run-on sentence is cut at word boundaries.
      for (const w of s.match(/\S+\s*/g) ?? [s]) {
        if (cur && cur.length + w.length > max) flush();
        if (!cur) curAt = at;
        cur += w;
        at += w.length;
      }
      continue;
    }
    cur += s;
    at += s.length;
  }
  flush();
  return out;
}

const BULLET = /^(?:[•◦▪●○■□➢►▸‣⁃\-–—*·]|[a-z][.)])\s+/i;
const NUMBERED = /^\(?\d{1,3}[.)]\s+/;

// Text as a person would say it: a link by its site's name, no reference
// marks ([12]), no dot leaders (a contents line "Results ....... 4" is
// "Results, 4"), no runs of symbols. Null when nothing needed changing.
export function spoken(text: string): string | null {
  const out = text
    .replace(/\b(?:https?:\/\/|www\.)([^\s/]+)[^\s]*/gi, (_, host: string) => host.replace(/^www\./i, ""))
    .replace(/\s*\[\d+(?:[,–-]\s*\d+)*\]/g, "")
    .replace(/\s*(?:\.\s?){4,}\s*/g, ", ")
    .replace(/[_=~#*|<>]{2,}/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out === text.trim() ? null : out;
}

// The sections: each heading starts one, its passages running to the next
// heading. Index of the heading passage and its title; passages before the
// first heading belong to an untitled section 0.
export function chapters(passages: Passage[]): { start: number; title: string; level: number }[] {
  const out: { start: number; title: string; level: number }[] = [];
  passages.forEach((p, i) => {
    if (p.kind === "heading") out.push({ start: i, title: p.text, level: p.level ?? 2 });
  });
  if (!out.length || out[0].start > 0) out.unshift({ start: 0, title: "", level: 1 });
  return out;
}

// The section a passage is in (index into chapters()).
export const chapterOf = (list: { start: number }[], passage: number) => {
  let k = 0;
  for (let i = 0; i < list.length; i++) if (list[i].start <= passage) k = i;
  return k;
};

// Rows read aloud at most; the rest are counted.
const MAX_ROWS = 10;

// What one passage sounds like.
export function passageScript(passages: Passage[], i: number, cues: Cues): Segment[] {
  const p = passages[i];
  const prev = passages[i - 1];
  const next = passages[i + 1];
  const out: Segment[] = [];
  const say = (text: string, at: number | undefined, style: Segment["style"], before = 0, after = 0, chime = false) => {
    if (text.trim()) out.push({ passage: i, text, at, style, before, after, chime });
  };
  // A passage as pieces; `skip` characters at its start aren't said (a bullet).
  const read = (style: Segment["style"], skip: number, before: number, after: number, chime = false) => {
    const shown = p.text.slice(skip);
    const changed = spoken(shown);
    const parts = pieces(changed ?? shown);
    parts.forEach((part, k) =>
      say(part.text, changed === null ? skip + part.at : undefined, style, k === 0 ? before : 0, k === parts.length - 1 ? after : 120, k === 0 && chime),
    );
  };

  if (p.kind === "heading") {
    // The document's first words need no run-up.
    read("heading", 0, i === 0 ? 150 : 650, 550, i > 0);
  } else if (p.kind === "list") {
    if (prev?.kind !== "list") {
      let n = 1;
      while (passages[i + n]?.kind === "list") n++;
      if (n > 1) say(cues.list(n), undefined, "cue", 250, 200);
    }
    const bullet = p.text.match(BULLET)?.[0].length ?? 0;
    read("body", NUMBERED.test(p.text) ? 0 : bullet, 0, next?.kind === "list" ? 380 : 600);
  } else if (p.kind === "table" && p.rows?.length) {
    const [head, ...body] = p.rows;
    const cols = Math.max(...p.rows.map((r) => r.length));
    say(cues.table(body.length || p.rows.length, cols), undefined, "cue", 400, 250);
    const named = body.length > 0 && head.some((h) => h.trim());
    const rows = named ? body : p.rows;
    for (const r of rows.slice(0, MAX_ROWS)) {
      const cells = r.map((c, k) => {
        const v = c.trim();
        if (!v) return "";
        // The first cell names the row; the others are said with their column.
        return named && k > 0 && head[k]?.trim() && head[k].trim() !== v ? `${head[k].trim()}, ${v}` : v;
      }).filter(Boolean);
      if (!cells.length) continue;
      const line = cells.length > 1 ? `${cells[0]}: ${cells.slice(1).join("; ")}.` : `${cells[0]}.`;
      say(spoken(line) ?? line, undefined, "body", 0, 320);
    }
    if (rows.length > MAX_ROWS) say(cues.more(rows.length - MAX_ROWS), undefined, "cue", 0, 300);
    if (out.length) out[out.length - 1].after = 650;
  } else {
    read("body", 0, 0, next?.kind === "heading" ? 300 : 480);
  }
  return out;
}

// The opening: how long the document is, before its first words.
export function introScript(pages: number, passages: Passage[], cues: Cues): Segment[] {
  const sections = passages.filter((p) => p.kind === "heading").length;
  return [{ passage: 0, text: cues.intro(pages, sections), style: "cue", before: 0, after: 500 }];
}

// An explanation in the AI's words (task "narrate", functions/api/ai.ts) as
// segments, all for the section's heading passage.
export function explanationScript(text: string, passage: number, first: boolean): Segment[] {
  const clean = text.replace(/[*_#`>]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
  const parts = pieces(clean, 260);
  return parts.map((part, k) => ({
    passage,
    text: part.text,
    style: "body",
    before: k === 0 ? (first ? 150 : 700) : 0,
    after: k === parts.length - 1 ? 600 : 160,
    chime: k === 0 && !first,
  }));
}

// A section's text, for the AI to explain: its heading and passages, tables
// as rows, cut at `max` characters.
export function sectionText(passages: Passage[], from: number, to: number, max = 7000): string {
  let out = "";
  for (let i = from; i < to && out.length < max; i++) {
    const p = passages[i];
    out += (p.kind === "heading" ? `## ${p.text}` : p.kind === "list" ? `- ${p.text.replace(BULLET, "")}` : p.text) + "\n";
  }
  return out.slice(0, max);
}
