// /api/ai: the cloud AI behind Chat, Summarize and Translate PDF, as a
// Cloudflare Pages Function (Vercel forwards /api/ai here, see
// scripts/vercel-output.mjs). The page only ever sends the text a task
// needs, never the file.
//
// Built to keep answering at no cost when many people use it at once:
//  - A pool of free tiers: each provider's keys (comma-separated in
//    *_API_KEYS) times its models (each a separate rate limit on Groq and
//    Cerebras), tried in order (AI_ORDER), the keys taking turns being first
//    (round robin). By default: Groq (Llama 3.3 70B, then Llama 3.1 8B),
//    Cerebras (the same two), then Claude (Anthropic, paid per use) and
//    Cloudflare Workers AI (a free daily allowance).
//  - A key and model that answers 429 rests for a minute (or as long as its
//    Retry-After asks) and the request moves on to the next one at once.
//  - When every one is busy at the same moment, the request waits 1.5 to
//    2.5 seconds and tries them all again before giving up; then it answers
//    503 { fallbackToLocal: true } and the page answers on the device, if it
//    has a model there.
//  - The last 500 replies are kept in memory for six hours, by a hash of the
//    request, and the same request is answered from them without a model.
//  - Fair use: at most 10 chat questions a minute and 60 a day per visitor,
//    on top of the character budgets below.
//
// The prompts live here, one per task, so the endpoint can't be used as a
// general-purpose chatbot, and every input is capped in size.
//
//   GET  /api/ai → { groq, cerebras, anthropic, gemini, openrouter, cloudflare }: which are set up.
//   POST /api/ai { task: "chat", sources, question, history? }      → text, streamed
//   POST /api/ai { task: "summarize", text, points, language }      → text, streamed
//   POST /api/ai { task: "translate", texts, language }             → { texts }
// Any of them may add provider: "cloudflare" to use only Workers AI (the
// visitor chose it; their text then goes nowhere else).
// The X-AI-Provider response header names who answered; X-AI-Cache: hit
// says it was a kept reply.
//
// Settings (Cloudflare dashboard → the Pages project → Settings):
//   GROQ_API_KEYS       secret: Groq keys, comma-separated (free at
//                       console.groq.com, one per account); GROQ_API_KEY for
//                       just one. Groq doesn't train on what it's sent.
//   CEREBRAS_API_KEYS   secret: Cerebras keys (cloud.cerebras.ai), likewise;
//                       Cerebras keeps none of what it's sent.
//   ANTHROPIC_API_KEY   secret; Claude, paid per use.
//   AI                  Workers AI binding (free daily allowance).
//                       (Its replies aren't streamed: see cloudflare() below.)
//   GEMINI_API_KEYS, OPENROUTER_API_KEYS
//                       secrets for Google Gemini's and OpenRouter's free
//                       tiers. Their free tiers may use what they're sent to
//                       improve their models, which the privacy policy
//                       promises we don't allow: they're used only when
//                       AI_FREE_TIERS_MAY_TRAIN is "1", and the privacy
//                       policy (src/lib/legal.ts) must then say so.
//   GROQ_MODELS, CEREBRAS_MODELS, GEMINI_MODELS, OPENROUTER_MODELS
//                       optional: each pool's models, best first, comma-separated.
//   AI_ORDER            optional: which providers to try, in order,
//                       comma-separated (default: groq,cerebras,anthropic,gemini,openrouter,cloudflare).
//   ALLOWED_ORIGINS     other sites whose pages may call this, comma-separated
//                       (default: https://nopload.vercel.app).
//   AI_QUOTA            D1 database binding; with it the limits below are
//                       exact: each request reserves its characters in one
//                       SQL statement before any model runs.
//   AI_LIMITS           KV namespace binding, used only without AI_QUOTA;
//                       the limits then hold roughly across instances.
//   AI_DAILY_CHARS      optional cap on the characters all visitors send in
//                       a day (UTC); 2,000,000 is about 600,000 tokens.
//   AI_QUOTA also keeps the chat fair-use counts exact (table ai_chat).
//   ANTHROPIC_MODEL, FALLBACK_MODEL, *_BASE_URL, AI_RETRY_JITTER_MS ("1500-2500")
//                       optional overrides; AI_CACHE "off" keeps no replies.

import Anthropic from "@anthropic-ai/sdk";

type WorkersAi = { run(model: string, input: object): Promise<unknown> };
// The part of a Workers KV namespace binding the limiter uses.
type Kv = { get(key: string, type: "json"): Promise<unknown>; put(key: string, value: string, o?: { expirationTtl?: number }): Promise<void> };
// The part of a D1 database binding the limiter uses.
type D1Statement = { bind(...values: unknown[]): D1Statement; first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<unknown> };
type D1 = { prepare(sql: string): D1Statement };
export type Env = {
  AI_QUOTA?: D1;
  AI_LIMITS?: Kv;
  AI_DAILY_CHARS?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_BASE_URL?: string;
  FALLBACK_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  AI?: WorkersAi;
  AI_ORDER?: string;
  AI_FREE_TIERS_MAY_TRAIN?: string;
  AI_RETRY_JITTER_MS?: string;
  AI_CACHE?: string;
  GROQ_API_KEY?: string;
  GROQ_API_KEYS?: string;
  GROQ_MODEL?: string;
  GROQ_MODELS?: string;
  GROQ_BASE_URL?: string;
  CEREBRAS_API_KEY?: string;
  CEREBRAS_API_KEYS?: string;
  CEREBRAS_MODELS?: string;
  CEREBRAS_BASE_URL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_API_KEYS?: string;
  GEMINI_MODEL?: string;
  GEMINI_MODELS?: string;
  GEMINI_BASE_URL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_API_KEYS?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_MODELS?: string;
  OPENROUTER_BASE_URL?: string;
};
type Context = { request: Request; env: Env };

const ANTHROPIC_MODEL = "claude-haiku-5-5";
const FALLBACK_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const DEFAULT_ORIGINS = ["https://nopload.vercel.app"];

// Input caps, in characters.
const MAX = { sources: 24_000, question: 2_000, history: 4, turn: 2_000, text: 60_000, texts: 12_000, items: 200 };

// Per visitor (the address Cloudflare saw, which the sender can't choose):
// characters and requests in the last hour, and requests in the last
// minute, so neither big requests nor floods of small ones run up the bill.
// A 100-page translation is about 35 requests and 300,000 characters.
// AI_DAILY_CHARS, when set, also caps the characters all visitors together
// send in a day (UTC).
// With the AI_QUOTA binding (a D1 database) the counts are exact: one SQL
// statement adds a request only if it still fits, so concurrent requests
// can't all pass (see allowD1). D1 is then the only judge: if it fails, the
// request is refused (503) rather than counted somewhere weaker.
// Without it, the AI_LIMITS binding (a KV namespace) shares the counts
// between Worker instances, and without that, or when KV fails, each
// instance counts on its own, in memory, and a restart forgets. KV reads,
// adds and writes back (last write wins, eventually consistent), so
// requests in the same second can each slip through and be recorded once:
// a budget, not a ceiling. Either way characters aren't dollars: the hard
// cap on spending is the Anthropic account's own limit.
const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 86_400_000;
const LIMIT = { chars: 600_000, hour: 200, minute: 40 };
type Use = { at: number; chars: number; requests: number; minuteAt: number; minute: number };
type Day = { day: number; chars: number };

// The visitor's counts with this request added, or null when it's over a limit.
function charge(prev: Use | null, chars: number, now: number): Use | null {
  const use: Use = prev && now - prev.at < HOUR ? { ...prev } : { at: now, chars: 0, requests: 0, minuteAt: now, minute: 0 };
  if (now - use.minuteAt >= MINUTE) [use.minuteAt, use.minute] = [now, 0];
  if (use.chars + chars > LIMIT.chars || use.requests >= LIMIT.hour || use.minute >= LIMIT.minute) return null;
  return { ...use, chars: use.chars + chars, requests: use.requests + 1, minute: use.minute + 1 };
}

// The site's counts for today with this request added, or null when over AI_DAILY_CHARS.
function chargeDay(prev: Day | null, chars: number, now: number, cap: number): Day | null {
  const day = Math.floor(now / DAY);
  const used = prev?.day === day ? prev.chars : 0;
  return cap && used + chars > cap ? null : { day, chars: used + chars };
}

const spent = new Map<string, Use>();
let today: Day | null = null;
function allowHere(ip: string, chars: number, cap: number, now: number) {
  if (spent.size > 10_000) for (const [k, v] of spent) if (now - v.at > HOUR) spent.delete(k);
  const use = charge(spent.get(ip) ?? null, chars, now);
  const day = chargeDay(today, chars, now, cap);
  if (!use || !day) return false;
  spent.set(ip, use);
  today = day;
  return true;
}

async function allowShared(kv: Kv, ip: string, chars: number, cap: number, now: number) {
  const dayKey = `day:${Math.floor(now / DAY)}`;
  const [prev, prevDay] = await Promise.all([kv.get(`ip:${ip}`, "json") as Promise<Use | null>, cap ? (kv.get(dayKey, "json") as Promise<Day | null>) : null]);
  const use = charge(prev, chars, now);
  const day = chargeDay(prevDay, chars, now, cap);
  if (!use || !day) return false;
  // Kept a little past the hour (KV's shortest expiry is a minute); the day for two.
  await Promise.all([kv.put(`ip:${ip}`, JSON.stringify(use), { expirationTtl: HOUR / 1000 + 60 }), cap ? kv.put(dayKey, JSON.stringify(day), { expirationTtl: (2 * DAY) / 1000 }) : null]);
  return true;
}

// D1: the tables, made on first use by each instance (no migration to run).
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS ai_day (day INTEGER PRIMARY KEY, chars INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS ai_visitor (ip TEXT PRIMARY KEY, at INTEGER NOT NULL, chars INTEGER NOT NULL, requests INTEGER NOT NULL, minute_at INTEGER NOT NULL, minute INTEGER NOT NULL)",
];
const schemas = new WeakMap<D1, Promise<unknown>>();
function ensureSchema(db: D1) {
  let made = schemas.get(db);
  if (!made) {
    made = Promise.all(SCHEMA.map((sql) => db.prepare(sql).run())).catch((e) => {
      schemas.delete(db);
      throw e;
    });
    schemas.set(db, made);
  }
  return made;
}

// Each reservation is one statement, so it's atomic: the row is added to
// only when the WHERE holds, and RETURNING gives nothing when it doesn't.
// (In DO UPDATE, a bare column is the stored value.) A first row is only
// written when it fits: allowD1 refuses requests bigger than a whole limit.
const RESERVE_DAY = `INSERT INTO ai_day (day, chars) VALUES (?1, ?2)
  ON CONFLICT (day) DO UPDATE SET chars = chars + ?2 WHERE chars + ?2 <= ?3
  RETURNING chars`;
// The same rules as charge(): ?2 now, ?3 chars, ?4 HOUR, ?5 MINUTE, ?6 to ?8 LIMIT.
const RESERVE_VISITOR = `INSERT INTO ai_visitor (ip, at, chars, requests, minute_at, minute) VALUES (?1, ?2, ?3, 1, ?2, 1)
  ON CONFLICT (ip) DO UPDATE SET
    at        = CASE WHEN ?2 - at >= ?4 THEN ?2 ELSE at END,
    chars     = CASE WHEN ?2 - at >= ?4 THEN ?3 ELSE chars + ?3 END,
    requests  = CASE WHEN ?2 - at >= ?4 THEN 1 ELSE requests + 1 END,
    minute_at = CASE WHEN ?2 - at >= ?4 OR ?2 - minute_at >= ?5 THEN ?2 ELSE minute_at END,
    minute    = CASE WHEN ?2 - at >= ?4 OR ?2 - minute_at >= ?5 THEN 1 ELSE minute + 1 END
  WHERE ?2 - at >= ?4 OR (chars + ?3 <= ?6 AND requests < ?7 AND (?2 - minute_at >= ?5 OR minute < ?8))
  RETURNING chars`;
const REFUND_DAY = "UPDATE ai_day SET chars = max(0, chars - ?2) WHERE day = ?1";
const REFUND_VISITOR = "UPDATE ai_visitor SET chars = max(0, chars - ?2) WHERE ip = ?1";

// Reserves the request's characters (day first, then visitor), or reserves
// nothing and returns false. A failing query throws: the caller refuses.
async function allowD1(db: D1, ip: string, chars: number, cap: number, now: number) {
  if (chars > LIMIT.chars || (cap && chars > cap)) return false;
  await ensureSchema(db);
  // Now and then, rows from earlier days and hours go.
  if (Math.random() < 0.01) {
    await db.prepare("DELETE FROM ai_day WHERE day < ?1").bind(Math.floor(now / DAY) - 1).run();
    await db.prepare("DELETE FROM ai_visitor WHERE at < ?1").bind(now - HOUR).run();
  }
  const day = Math.floor(now / DAY);
  if (cap && !(await db.prepare(RESERVE_DAY).bind(day, chars, cap).first())) return false;
  const use = await db.prepare(RESERVE_VISITOR).bind(ip, now, chars, HOUR, MINUTE, LIMIT.chars, LIMIT.hour, LIMIT.minute).first();
  if (!use && cap) await db.prepare(REFUND_DAY).bind(day, chars).run();
  return !!use;
}

// Gives back the characters of a request no model answered (D1 only; best effort).
async function refund(env: Env, ip: string, chars: number) {
  if (!env.AI_QUOTA) return;
  const day = Math.floor(Date.now() / DAY);
  try {
    await Promise.all([env.AI_QUOTA.prepare(REFUND_VISITOR).bind(ip, chars).run(), env.AI_DAILY_CHARS ? env.AI_QUOTA.prepare(REFUND_DAY).bind(day, chars).run() : null]);
  } catch (e) {
    console.warn("AI_QUOTA refund failed:", e instanceof Error ? e.message : e);
  }
}

// "ok", "over" a limit, or "down": AI_QUOTA is bound but failed. That
// fails closed: falling back to KV or memory would let a burst through
// exactly when the exact count can't be had.
async function allow(env: Env, ip: string, chars: number): Promise<"ok" | "over" | "down"> {
  const now = Date.now();
  const cap = Math.max(0, Number(env.AI_DAILY_CHARS) || 0);
  if (env.AI_QUOTA) {
    try {
      return (await allowD1(env.AI_QUOTA, ip, chars, cap, now)) ? "ok" : "over";
    } catch (e) {
      console.warn("AI_QUOTA failed, refusing:", e instanceof Error ? e.message : e);
      return "down";
    }
  }
  return (await allowBestEffort(env, ip, chars, cap, now)) ? "ok" : "over";
}

// Without AI_QUOTA: KV when bound, memory when not or when KV fails. Not a hard limit.
async function allowBestEffort(env: Env, ip: string, chars: number, cap: number, now: number) {
  if (env.AI_LIMITS) {
    try {
      return await allowShared(env.AI_LIMITS, ip, chars, cap, now);
    } catch (e) {
      console.warn("AI_LIMITS failed, counting in memory:", e instanceof Error ? e.message : e);
    }
  }
  return allowHere(ip, chars, cap, now);
}

// The largest request a page sends is a summary: 60,000 characters, up to
// three bytes each, escaped in JSON. Anything bigger is refused unread.
const MAX_BODY = 400_000;
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      void reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

type Message = { role: "user" | "assistant"; content: string };
// json: the reply is a JSON object with the keys "1" to `count`.
// chat: a Chat with PDF question, which the fair-use limit counts.
type Job = { system: string; messages: Message[]; maxTokens: number; json?: boolean; count?: number; chat?: boolean };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const languageName = (tag: string) => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? "English";
  } catch {
    return "English";
  }
};

// Chat's instructions. The excerpts each start with their page ("p. 5"), and
// the page may add a note that words of the question appear nowhere in the
// document (src/lib/ai/chat.ts).
export const CHAT_SYSTEM = [
  "You answer questions about one document, using only the excerpts from it that follow. Each excerpt starts with its page number, like \"p. 5\".",
  "Rules:",
  "- Answer concisely, in plain natural sentences. No headings, tables or lists of raw lines; never paste the document's lines back. Quote a name, ID, merchant, UPI ID or amount only when it is part of the answer.",
  "- End each sentence that states a fact with the page it comes from, like (p. 5), or (p. 2, p. 7) for several.",
  "- For the biggest, largest, highest, smallest, lowest, a total, a count or a list, go through every excerpt and every amount in it before answering. Give the amount, who or what it was for, and its date when shown.",
  "- In bank, card or UPI statements, keep money going out (debits, payments, withdrawals, transfers sent) apart from money coming in (credits, deposits, refunds, transfers received), and say which you mean. \"Payment\" means money going out unless the question says otherwise.",
  "- If the excerpts don't answer the question, or a name or word it asks about isn't in them, say \"I couldn't find any mention of X in the document.\" with X being what was asked about. Never guess or use outside knowledge.",
  "- Answer in the language of the question.",
].join("\n");

// The request as a job for a model, or an error message.
export function jobOf(body: Record<string, unknown>): Job | string {
  if (body.task === "chat") {
    const sources = str(body.sources, MAX.sources);
    const question = str(body.question, MAX.question);
    if (!sources.trim() || !question.trim()) return "sources and question are required";
    const history = (Array.isArray(body.history) ? body.history : [])
      .slice(-MAX.history)
      .flatMap((m) => (m && (m.role === "user" || m.role === "assistant") ? [{ role: m.role, content: str(m.content, MAX.turn) } as Message] : []))
      .filter((m) => m.content.trim());
    // The API wants turns to alternate, starting with the user.
    while (history.length && history[0].role !== "user") history.shift();
    return {
      system: CHAT_SYSTEM,
      messages: [...history, { role: "user", content: `Excerpts from the document:\n${sources}\n\nQuestion: ${question}` }],
      maxTokens: 900,
      chat: true,
    };
  }
  if (body.task === "summarize") {
    const text = str(body.text, MAX.text);
    if (!text.trim()) return "text is required";
    const points = Math.min(12, Math.max(1, Number(body.points) || 5));
    const language = languageName(str(body.language, 20) || "en");
    return {
      system:
        `You summarise documents. Write exactly ${points} key points as a Markdown list, one line each starting with "- ". ` +
        `Use only facts from the document. Write in ${language}. Reply with the list only.`,
      messages: [{ role: "user", content: text }],
      maxTokens: 120 * points + 200,
    };
  }
  if (body.task === "translate") {
    const list: unknown[] = Array.isArray(body.texts) ? body.texts : [];
    if (!list.every((t) => typeof t === "string") || !list.some((t) => (t as string).trim())) return "texts: strings, not all empty";
    const texts = list as string[];
    const total = texts.reduce((n, t) => n + t.length, 0);
    if (texts.length > MAX.items || total > MAX.texts) return `texts: 1 to ${MAX.items} strings, ${MAX.texts} characters in all`;
    const language = languageName(str(body.language, 20) || "en");
    return {
      system:
        `You are a professional translator into ${language}. The user sends a JSON object of numbered text blocks from one document. ` +
        `Reply with a JSON object with exactly the same keys, "1" to "${texts.length}", each holding that block translated into ${language}. ` +
        "Never merge or split blocks. Keep numbers, codes, names and line breaks; put nothing else in the reply.",
      // Numbered, so a model keeps each block on its own (a plain list let blocks run together).
      messages: [{ role: "user", content: JSON.stringify(Object.fromEntries(texts.map((t, i) => [String(i + 1), t]))) }],
      maxTokens: Math.min(16_000, 400 + Math.ceil(total * 1.5)),
      json: true,
      count: texts.length,
    };
  }
  return "unknown task";
}

const charsOf = (job: Job) => job.system.length + job.messages.reduce((n, m) => n + m.content.length, 0);

// Text in pieces as a model writes it.
type Pieces = AsyncIterable<string>;

async function* anthropic(env: Env, job: Job, signal: AbortSignal): Pieces {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1 });
  const stream = client.messages.stream(
    {
      model: env.ANTHROPIC_MODEL || ANTHROPIC_MODEL,
      max_tokens: job.maxTokens,
      system: job.system,
      messages: job.messages,
      output_config: {
        effort: "low",
        ...(job.json
          ? { format: { type: "json_schema", schema: keyedSchema(job.count ?? 0) } }
          : {}),
      },
    },
    { signal },
  );
  for await (const event of stream) if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new Error("refused");
}

// Workers AI, asked for its whole reply rather than a stream: the stream
// decodes each token that looks like JSON on its own (the token `","`
// arrives as `,`, `2025` as a number), which can't be undone, and turned
// JSON replies into garbage. The whole reply is {"response": ...}, itself
// decoded when it's JSON or a number, or {"choices": [...]} for
// chat-completion models.
async function* cloudflare(env: Env, job: Job): Pieces {
  const out = (await env.AI!.run(env.FALLBACK_MODEL || FALLBACK_MODEL, {
    messages: [{ role: "system", content: job.system + (job.json ? " Reply with JSON only." : "") + " /no_think" }, ...job.messages],
    max_tokens: job.maxTokens,
  })) as { response?: unknown; choices?: { message?: { content?: unknown } }[] } | null;
  const reply = out?.response ?? out?.choices?.[0]?.message?.content;
  if (reply === undefined || reply === null || reply === "") throw new Error("Workers AI gave no reply");
  yield typeof reply === "string" ? reply : typeof reply === "number" ? String(reply) : JSON.stringify(reply);
}

// Drops a reasoning model's <think>…</think> as the text streams by.
async function* withoutThinking(pieces: Pieces): Pieces {
  let pending = "";
  let thinking = false;
  // Right after a thought (or at the start), leading blank lines are dropped.
  let trim = true;
  for await (const p of pieces) {
    pending += p;
    for (;;) {
      if (trim && !thinking) {
        pending = pending.replace(/^\s+/, "");
        if (!pending) break;
        trim = false;
      }
      if (thinking) {
        const end = pending.indexOf("</think>");
        if (end < 0) break;
        pending = pending.slice(end + 8);
        thinking = false;
        trim = true;
      } else {
        const start = pending.indexOf("<think>");
        if (start >= 0) {
          if (start) yield pending.slice(0, start);
          pending = pending.slice(start + 7);
          thinking = true;
          continue;
        }
        // Hold back what could be the start of a tag.
        const keep = pending.lastIndexOf("<");
        const cut = keep >= 0 && "<think>".startsWith(pending.slice(keep)) ? keep : pending.length;
        if (cut) yield pending.slice(0, cut);
        pending = pending.slice(cut);
        break;
      }
    }
  }
  if (!thinking && pending) yield pending;
}

// The free tiers that speak OpenAI's chat completions API, each a pool:
// every key in its *_API_KEYS (or the one *_API_KEY) with every model in its
// *_MODELS. Groq and Cerebras give each model its own rate limit, so a key's
// second model is a second bucket.
// trains: its free tier may use what it's sent to improve its models.
type Pool = { name: string; url: string; keys: string[]; models: string[]; trains: boolean };
const list = (...values: (string | undefined)[]) => [...new Set(values.flatMap((v) => (v ?? "").split(",")).map((s) => s.trim()).filter(Boolean))];
const pools = (env: Env): Record<string, Pool> => ({
  groq: {
    name: "groq",
    url: `${env.GROQ_BASE_URL || "https://api.groq.com/openai/v1"}/chat/completions`,
    keys: list(env.GROQ_API_KEYS, env.GROQ_API_KEY),
    models: list(env.GROQ_MODELS || env.GROQ_MODEL || "llama-3.3-70b-versatile,llama-3.1-8b-instant"),
    trains: false,
  },
  cerebras: {
    name: "cerebras",
    url: `${env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1"}/chat/completions`,
    keys: list(env.CEREBRAS_API_KEYS, env.CEREBRAS_API_KEY),
    models: list(env.CEREBRAS_MODELS || "llama-3.3-70b,llama3.1-8b"),
    trains: false,
  },
  gemini: {
    name: "gemini",
    url: `${env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai"}/chat/completions`,
    keys: list(env.GEMINI_API_KEYS, env.GEMINI_API_KEY),
    models: list(env.GEMINI_MODELS || env.GEMINI_MODEL || "gemini-2.5-flash,gemini-2.5-flash-lite"),
    trains: true,
  },
  openrouter: {
    name: "openrouter",
    url: `${env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"}/chat/completions`,
    keys: list(env.OPENROUTER_API_KEYS, env.OPENROUTER_API_KEY),
    models: list(env.OPENROUTER_MODELS || env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free"),
    trains: true,
  },
});

// A provider's refusal, with what it says about when to come back.
class ProviderError extends Error {
  status: number;
  retryAfter?: number;
  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
const retryAfterOf = (r: Response) => {
  const v = Number(r.headers.get("retry-after"));
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

// A streamed chat completion: server-sent events of {"choices":[{"delta":{"content"}}]}.
async function* openAi(p: Pool, key: string, model: string, job: Job, signal: AbortSignal): Pieces {
  const r = await fetch(p.url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...(p.name === "openrouter" ? { "HTTP-Referer": "https://nopload.pages.dev", "X-Title": "Nopload" } : {}),
    },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: job.maxTokens,
      temperature: 0.2,
      messages: [{ role: "system", content: job.system + (job.json ? " Reply with JSON only." : "") }, ...job.messages],
      ...(job.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!r.ok || !r.body) throw new ProviderError(`${p.name} ${model} ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`, r.status, retryAfterOf(r));
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      let event: { choices?: { delta?: { content?: string } }[]; error?: { message?: string; code?: number } };
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.error) throw new ProviderError(`${p.name} ${model}: ${event.error.message ?? "error"}`, Number(event.error.code) || 500);
      const piece = event.choices?.[0]?.delta?.content;
      if (piece) yield piece;
    }
  }
}

const ORDER = ["groq", "cerebras", "anthropic", "gemini", "openrouter", "cloudflare"];

// One way to answer: a provider, one of its keys and one of its models.
// `id` names it for the cooldowns (the key by a short hash, never the key
// itself, which would then sit in logs).
type Slot = { provider: string; id: string; run: (job: Job, signal: AbortSignal) => Pieces };

// A key's short name: FNV-1a, 32 bits, in hex.
function fingerprint(key: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Cooling down: slot id → when it may be tried again. Each instance of the
// function keeps its own; a slot another instance found busy is found busy
// here on the next try, which costs one quick refusal.
const cooling = new Map<string, number>();
// Advances with each request, so each pool's keys take turns being first.
let turn = 0;

// The providers this deployment can use, in the order to try them: for a
// pool, its models best first, each across its keys, the keys starting at a
// different one each request (round robin).
export function slots(env: Env, rotate = 0): Slot[] {
  const free = pools(env);
  const mayTrain = env.AI_FREE_TIERS_MAY_TRAIN === "1";
  const order = env.AI_ORDER ? env.AI_ORDER.split(",").map((s) => s.trim()).filter((s) => ORDER.includes(s)) : ORDER;
  return order.flatMap((name): Slot[] => {
    if (name === "anthropic") return env.ANTHROPIC_API_KEY ? [{ provider: name, id: name, run: (job, signal) => anthropic(env, job, signal) }] : [];
    if (name === "cloudflare") return env.AI ? [{ provider: name, id: name, run: (job) => withoutThinking(cloudflare(env, job)) }] : [];
    const p = free[name];
    if (!p || !p.keys.length || (p.trains && !mayTrain)) return [];
    const start = rotate % p.keys.length;
    const ring = [...p.keys.slice(start), ...p.keys.slice(0, start)];
    return p.models.flatMap((model) => ring.map((key) => ({ provider: name, id: `${name}#${fingerprint(key)}#${model}`, run: (job: Job, signal: AbortSignal) => withoutThinking(openAi(p, key, model, job, signal)) })));
  });
}

// The providers set up, once each.
export const providers = (env: Env) => [...new Set(slots(env).map((s) => s.provider))];

// How long a slot rests after a refusal: a rate limit for a minute (or as
// long as it asks, up to ten), a refused key for ten minutes, an outage for
// fifteen seconds. A request it can't take (too long, say) doesn't rest it.
function rest(e: unknown): number {
  const status = e instanceof ProviderError ? e.status : (e as { status?: number })?.status;
  if (status === 429) return Math.min(600, Math.max(60, (e as ProviderError).retryAfter ?? 0)) * 1000;
  if (status === 401 || status === 403) return 600_000;
  if (status && status >= 400 && status < 500) return 0;
  return 15_000;
}

const jitterOf = (env: Env) => {
  const [lo, hi] = (env.AI_RETRY_JITTER_MS || "1500-2500").split("-").map(Number);
  return lo + Math.random() * Math.max(0, (hi || lo) - lo);
};

// Starts the first slot that answers: its provider, its first piece and the
// rest. Slots cooling down are passed over. When none answers (all busy at
// once, as in a burst), it waits 1.5 to 2.5 seconds and tries again, this
// time every slot, the ones that come off cooldown soonest first, since a
// per-minute limit often clears within seconds.
async function start(env: Env, job: Job, signal: AbortSignal, only?: "cloudflare") {
  const all = slots(env, turn++).filter((s) => !only || s.provider === only);
  const attempt = async (list: Slot[]) => {
    for (const slot of list) {
      const it = slot.run(job, signal)[Symbol.asyncIterator]();
      try {
        let first = await it.next();
        while (!first.done && !first.value) first = await it.next();
        if (first.done) throw new Error("empty reply");
        cooling.delete(slot.id);
        return { provider: slot.provider, first: first.value, it };
      } catch (e) {
        if (signal.aborted) throw e;
        const ms = rest(e);
        if (ms) cooling.set(slot.id, Date.now() + ms);
        console.warn(`${slot.id} failed:`, e instanceof Error ? e.message : e);
      }
    }
    return null;
  };
  const now = Date.now();
  const first = await attempt(all.filter((s) => (cooling.get(s.id) ?? 0) <= now));
  if (first || !all.length) return first;
  await new Promise((ok) => setTimeout(ok, jitterOf(env)));
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  return attempt([...all].sort((a, b) => (cooling.get(a.id) ?? 0) - (cooling.get(b.id) ?? 0)));
}

// The last 500 replies, by a hash of what was asked (task, prompt, text): the
// same question about the same passages, or the same summary or
// translation, is answered again without asking a model. In this instance's
// memory only, for up to six hours.
const CACHE_SIZE = 500;
const CACHE_MS = 6 * 3_600_000;
type Cached = { provider: string; text: string; at: number };
const replies = new Map<string, Cached>();
async function cacheKey(job: Job, only?: string) {
  const bytes = new TextEncoder().encode(JSON.stringify([job.system, job.messages, job.maxTokens, job.json ?? false, only ?? ""]));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function cached(key: string): Cached | null {
  const hit = replies.get(key);
  if (!hit || Date.now() - hit.at > CACHE_MS) {
    replies.delete(key);
    return null;
  }
  // Most recently used last, so the oldest goes first.
  replies.delete(key);
  replies.set(key, hit);
  return hit;
}
function remember(key: string, provider: string, text: string) {
  replies.delete(key);
  replies.set(key, { provider, text, at: Date.now() });
  while (replies.size > CACHE_SIZE) replies.delete(replies.keys().next().value!);
}

// Fair use for chat: questions per visitor (the address Cloudflare saw), at
// most 10 a minute and 60 a day (UTC), so one visitor or bot can't use up
// the free tiers for everyone. Exact with AI_QUOTA (one SQL statement each,
// as for the characters); otherwise each instance counts in memory.
const CHAT = { minute: 10, day: 60 };
type ChatUse = { day: number; count: number; minuteAt: number; minute: number };
const chatting = new Map<string, ChatUse>();
const CHAT_SCHEMA = "CREATE TABLE IF NOT EXISTS ai_chat (ip TEXT PRIMARY KEY, day INTEGER NOT NULL, count INTEGER NOT NULL, minute_at INTEGER NOT NULL, minute INTEGER NOT NULL)";
// ?1 ip, ?2 today, ?3 now, ?4 MINUTE, ?5 per minute, ?6 per day.
const RESERVE_CHAT = `INSERT INTO ai_chat (ip, day, count, minute_at, minute) VALUES (?1, ?2, 1, ?3, 1)
  ON CONFLICT (ip) DO UPDATE SET
    count     = CASE WHEN day <> ?2 THEN 1 ELSE count + 1 END,
    minute_at = CASE WHEN day <> ?2 OR ?3 - minute_at >= ?4 THEN ?3 ELSE minute_at END,
    minute    = CASE WHEN day <> ?2 OR ?3 - minute_at >= ?4 THEN 1 ELSE minute + 1 END,
    day       = ?2
  WHERE day <> ?2 OR (count < ?6 AND (?3 - minute_at >= ?4 OR minute < ?5))
  RETURNING count`;
const chatSchemas = new WeakMap<D1, Promise<unknown>>();

// "ok", or which limit the visitor reached.
async function allowChat(env: Env, ip: string): Promise<"ok" | "minute" | "day"> {
  const now = Date.now();
  const day = Math.floor(now / DAY);
  if (env.AI_QUOTA) {
    const db = env.AI_QUOTA;
    let made = chatSchemas.get(db);
    if (!made) chatSchemas.set(db, (made = db.prepare(CHAT_SCHEMA).run().catch((e) => (chatSchemas.delete(db), Promise.reject(e)))));
    await made;
    if (await db.prepare(RESERVE_CHAT).bind(ip, day, now, MINUTE, CHAT.minute, CHAT.day).first()) return "ok";
    const row = await db.prepare("SELECT day, count FROM ai_chat WHERE ip = ?1").bind(ip).first<{ day: number; count: number }>();
    return row && row.day === day && row.count >= CHAT.day ? "day" : "minute";
  }
  if (chatting.size > 10_000) for (const [k, v] of chatting) if (v.day !== day) chatting.delete(k);
  const prev = chatting.get(ip);
  const use: ChatUse = prev && prev.day === day ? { ...prev } : { day, count: 0, minuteAt: now, minute: 0 };
  if (now - use.minuteAt >= MINUTE) [use.minuteAt, use.minute] = [now, 0];
  if (use.count >= CHAT.day) return "day";
  if (use.minute >= CHAT.minute) return "minute";
  chatting.set(ip, { ...use, count: use.count + 1, minute: use.minute + 1 });
  return "ok";
}

// Replies are data, never a page: no sniffing, nothing a browser would run or frame.
const SAFE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...SAFE, "Content-Type": "application/json", ...headers } });

// Browsers send Origin with every POST, same-origin ones included, so a
// request without one isn't from a page. This only keeps other sites' pages
// out: a script can send any Origin, which is what the limits are for.
function originAllowed(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const allowed = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
  return origin === new URL(request.url).origin || allowed.includes(origin);
}

export async function onRequestGet({ env }: Context) {
  const set = new Set(providers(env));
  return json(Object.fromEntries(ORDER.map((name) => [name, set.has(name)])));
}

export async function onRequestPost({ request, env }: Context) {
  if (!originAllowed(request, env)) return json({ error: "origin not allowed" }, 403);
  if (!providers(env).length) return json({ error: "no AI provider is set up" }, 503);
  const raw = await readBody(request);
  if (raw === null) return json({ error: "request too large" }, 413);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return json({ error: "send JSON" }, 400);
  }
  const job = jobOf(body);
  if (typeof job === "string") return json({ error: job }, 400);
  // Only the address Cloudflare saw: headers like X-Forwarded-For are the sender's to write.
  const ip = request.headers.get("CF-Connecting-IP") || "?";
  const only = body.provider === "cloudflare" ? "cloudflare" : undefined;
  const key = env.AI_CACHE === "off" ? null : await cacheKey(job, only);

  if (job.chat) {
    let fair: "ok" | "minute" | "day";
    try {
      fair = await allowChat(env, ip);
    } catch (e) {
      console.warn("AI_QUOTA failed, refusing:", e instanceof Error ? e.message : e);
      return json({ error: "AI usage limits are unavailable" }, 503, { "Retry-After": "60" });
    }
    if (fair === "minute") return json({ error: "too many questions in a minute", limit: "minute" }, 429, { "Retry-After": "60" });
    if (fair === "day") return json({ error: "today's questions are used up", limit: "day" }, 429, { "Retry-After": String(Math.ceil((DAY - (Date.now() % DAY)) / 1000)) });
  }

  // Reserved before any model runs, so a request over the limit never costs anything.
  const chars = charsOf(job);
  const allowed = await allow(env, ip, chars);
  if (allowed === "down") return json({ error: "AI usage limits are unavailable" }, 503, { "Retry-After": "60" });
  if (allowed === "over") return json({ error: "hourly limit reached" }, 429, { "Retry-After": "3600" });

  // Asked before: the same answer, with no model asked. (Counted all the
  // same, so the limits can't be got round by asking the same thing.)
  const hit = key && cached(key);
  if (hit) {
    const headers = { ...SAFE, "X-AI-Provider": hit.provider, "X-AI-Cache": "hit" };
    return job.json ? json({ texts: JSON.parse(hit.text) }, 200, headers) : new Response(hit.text, { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  }

  const signal = request.signal ?? new AbortController().signal;
  const started = await start(env, job, signal, only);
  if (!started) {
    await refund(env, ip, chars);
    // Every provider, key and model is busy or used up: the page answers on
    // the device instead, if it has a model there.
    return json({ error: "no AI provider answered", fallbackToLocal: true }, 503, { "Retry-After": "60" });
  }
  const headers = { ...SAFE, "X-AI-Provider": started.provider };

  if (job.json) {
    let text = started.first;
    for (let r = await started.it.next(); !r.done; r = await started.it.next()) text += r.value;
    const texts = parseTexts(text, job.count);
    // The start of the reply comes back too (it's the visitor's own text), to see how a model got the format wrong.
    if (!texts || texts.length !== job.count) return json({ error: "the translation came back incomplete", got: texts?.length ?? null, reply: text.slice(0, 400) }, 502, headers);
    if (key) remember(key, started.provider, JSON.stringify(texts));
    return json({ texts }, 200, headers);
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      let text = started.first;
      c.enqueue(enc.encode(started.first));
      try {
        for (let r = await started.it.next(); !r.done; r = await started.it.next()) {
          text += r.value;
          c.enqueue(enc.encode(r.value));
        }
        // Only a reply that came to its end is kept.
        if (key) remember(key, started.provider, text);
      } catch (e) {
        console.warn(`${started.provider} stopped:`, e instanceof Error ? e.message : e);
      }
      c.close();
    },
    cancel() {
      void started.it.return?.();
    },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
}

// The keys "1" to n, each a string: Claude's output is held to it.
const keyedSchema = (n: number) => {
  const keys = Array.from({ length: n }, (_, i) => String(i + 1));
  return { type: "object", properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])), required: keys, additionalProperties: false };
};

// The blocks of a reply, in order: {"1": ..., "2": ...} with every key from
// 1 to `count`, or (as some models answer anyway) {"texts": [...]} or a bare
// array; possibly in a code fence. Null when anything is missing.
export function parseTexts(text: string, count?: number): string[] | null {
  const raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const from = raw.search(/[[{]/);
  if (from < 0) return null;
  try {
    const v = JSON.parse(raw.slice(from, Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]")) + 1));
    const keyed = v && !Array.isArray(v) && typeof v === "object" && !Array.isArray(v.texts) && count ? Array.from({ length: count }, (_, i) => v[String(i + 1)]) : null;
    const list = keyed ?? (Array.isArray(v) ? v : v?.texts);
    return Array.isArray(list) && list.every((t) => typeof t === "string") ? list : null;
  } catch {
    return null;
  }
}
