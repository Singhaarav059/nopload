// Finds the chunks that answer a question: Okapi BM25 over the words
// (Robertson & Zaragoza, 2009), the chunks that contain the question's
// distinctive words letter for letter, fused by reciprocal rank fusion
// (Cormack, Clarke & Büttcher, 2009). Keywords catch names, numbers and
// codes; the exact match catches a name inside a longer string ("hazelnut"
// in "HAZELNUTCAFE@okaxis").

import type { Chunk } from "./chunk";

// Common words, and the words a question is phrased with, in the languages
// told apart by their words.
const STOP = new Set(
  (
    "the of and to in is that it for on with as was are be by this from or at an not have has will which their they its were can been also but " +
    "what who whom whose when where why how does do did much many me my you your please tell about there any here should would could " +
    "el la de que los las y en del un una por con para es se no al lo como más sus su qué cuál cuánto dónde cuándo " +
    "le les des du et est un une pour dans sur pas au aux par avec qui ce sont quel quelle combien où quand " +
    "der die das und ist nicht mit dem den des dass ein eine zu von für auf im sich auch wird werden was wer wie wo wann " +
    "il lo gli di che e della per sono nel alla dei cosa quanto dove quando " +
    "o os a as do da dos das em um uma não no na é qual quanto onde " +
    "het een en van op te voor zijn er aan ook wordt wat hoe waar wanneer"
  ).split(" "),
);
const CJK = /[぀-ヿ一-鿿가-힯]/;

// Words as the index sees them: lower case, no common words, plurals
// folded; Chinese, Japanese and Korean (no spaces) as character pairs.
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (CJK.test(raw)) {
      const chars = [...raw];
      if (chars.length === 1) out.push(raw);
      for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
      continue;
    }
    if (STOP.has(raw) || (raw.length < 2 && !/\d/.test(raw))) continue;
    out.push(raw.length > 4 && /[^s]s$/.test(raw) ? raw.slice(0, -1) : raw);
  }
  return out;
}

export type Hit = { chunk: Chunk; score: number };

const K1 = 1.2;
const B = 0.75;

function bm25(chunks: Chunk[], query: string[]): Hit[] {
  const docs = chunks.map((c) => tokens(c.text));
  const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const q = [...new Set(query)];
  return chunks
    .map((chunk, i) => {
      const tf = new Map<string, number>();
      for (const t of docs[i]) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        const n = df.get(t)!;
        const idf = Math.log(1 + (chunks.length - n + 0.5) / (n + 0.5));
        score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * docs[i].length) / avg));
      }
      return { chunk, score };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Reciprocal rank fusion: an item's score is the sum of 1 / (60 + rank)
// over the lists it is in.
export function fuse<T>(lists: T[][], key: (x: T) => unknown, k = 60): { item: T; score: number }[] {
  const scores = new Map<unknown, { item: T; score: number }>();
  for (const list of lists)
    list.forEach((item, rank) => {
      const id = key(item);
      const e = scores.get(id) ?? { item, score: 0 };
      e.score += 1 / (k + rank + 1);
      scores.set(id, e);
    });
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

// The words a question is asked with rather than about ("what is the
// biggest payment"): they say what to do with the document, not what to
// find in it, so they're never looked for letter for letter.
const GENERIC = new Set(
  (
    "biggest largest highest greatest maximum max most top smallest lowest least minimum min cheapest total sum overall altogether average mean count number list all every each " +
    "payment paid pay amount money spent spend spending received receive credit credited debit debited transaction transfer transferred bill charge fee cost price balance " +
    "account statement document pdf file page date month year week day time first last find show give mention mentioned name many much big small large high low " +
    "did does was were has have had get got made make any some one two this that these those from into out incoming outgoing sent went go gone spend bought buy paying spending"
  ).split(" "),
);

// The question's distinctive words, as written (lower case, three letters or
// more), and its quoted phrases: what the document must contain, letter for
// letter, to be about them.
export function exactTerms(question: string): string[] {
  const quoted = [...question.matchAll(/["“”«»']([^"“”«»']{3,})["“”«»']/g)].map((m) => m[1].trim().toLowerCase());
  const words = (question.toLowerCase().match(/[\p{L}\p{N}@._-]+/gu) ?? [])
    .map((w) => w.replace(/^[._-]+|[._-]+$/g, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w) && !GENERIC.has(w) && !GENERIC.has(w.replace(/s$/, "")) && !CJK.test(w));
  return [...new Set([...quoted, ...words])];
}

// The names the question asks about that appear nowhere in the document:
// its distinctive words that look like names (capitalised after the first
// word, quoted, or with digits or an @ in them), or its one distinctive word.
// Other words ("went", "groceries") may just be phrased differently there.
export function missingTerms(chunks: Chunk[], question: string): string[] {
  const all = chunks.map((c) => c.text.toLowerCase()).join("\n");
  const terms = exactTerms(question);
  const named = new Set(
    [
      ...[...question.matchAll(/["“”«»']([^"“”«»']{3,})["“”«»']/g)].map((m) => m[1]),
      ...(question.match(/(?<=\S\s+)\p{Lu}[\p{L}\p{N}@._-]*|[\p{L}\p{N}._-]*[\d@][\p{L}\p{N}@._-]*/gu) ?? []),
    ].map((w) => w.trim().toLowerCase()),
  );
  return terms.filter((t) => (terms.length === 1 || named.has(t)) && !all.includes(t) && !all.includes(t.replace(/s$/, "")));
}

// "Biggest", "total", "list all": a question answered by looking across the
// whole document rather than at one place in it.
const AGGREGATE =
  /\b(?:biggest|largest|highest|greatest|maximum|max|most|top|smallest|lowest|least|minimum|min|cheapest|total|sum|overall|altogether|average|mean|how much|how many|all|every|each|list|count)\b|\b(?:sab(?:se)?|kul|total)\b/i;
export const isAggregate = (question: string) => AGGREGATE.test(question);

// "What is this about?", "Summarise it", "Main points": a question about the
// document as a whole, answered from its opening and every page.
const OVERVIEW =
  /\b(?:what(?:'s| is| does)? (?:this|the|it)(?: (?:document|doc|pdf|file|report|paper|book))? (?:about|cover|say)\s*\??\s*$|about what|summar(?:y|ise|ize)|overview|main (?:points?|topics?|ideas?|takeaways?)|key (?:points?|takeaways?|findings)|gist|tl;?dr|purpose of (?:this|the))|\b(?:kis bare mein|saransh)\b/i;
export const isOverview = (question: string) => OVERVIEW.test(question);

// The chunks containing the question's distinctive words letter for letter,
// those with more of them first.
function exact(chunks: Chunk[], terms: string[]): Hit[] {
  if (!terms.length) return [];
  return chunks
    .map((chunk) => {
      const text = chunk.text.toLowerCase();
      return { chunk, score: terms.filter((t) => text.includes(t) || text.includes(t.replace(/s$/, ""))).length };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score);
}

// The k chunks that best answer `query`, best first. Chunks that contain the
// question's distinctive words come before any that don't.
export function search(chunks: Chunk[], query: string, o: { k?: number } = {}): Hit[] {
  const k = o.k ?? 5;
  const words = bm25(chunks, tokens(query));
  const found = exact(chunks, exactTerms(query));
  const lists = [found.slice(0, 50), found.slice(0, 50), words.slice(0, 50)];
  const matched = new Map(found.map((h) => [h.chunk.id, h.score]));
  return fuse(lists, (h) => h.chunk.id, 60)
    .map(({ item, score }) => ({ chunk: item.chunk, score }))
    .sort((a, b) => (matched.get(b.chunk.id) ?? 0) - (matched.get(a.chunk.id) ?? 0) || b.score - a.score)
    .slice(0, k);
}
