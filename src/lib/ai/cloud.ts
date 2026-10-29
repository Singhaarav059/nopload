// The server AI (functions/api/ai.ts), from the page's side: every AI tool
// uses it. The endpoint asks the first of its providers that answers (Groq,
// then Claude, then Gemini, then Cloudflare Workers AI). Only the text a task
// needs is sent (a question and the passages that answer it, a document's
// text to summarise, blocks to translate), never the file. Any failure is a
// CloudUnavailable (a CloudLimited when the visitor asked too much, too
// fast), which the tools tell the visitor about.
// Answers are kept on this device for a week (./answers.ts): the same
// request again costs no request.

import { AI_CLOUD } from "../mode";
import { answerKey, keepAnswer, keptAnswer } from "./answers";

// Who answered, as the endpoint's X-AI-Provider header names it.
export type Provider = "groq" | "anthropic" | "gemini" | "openrouter" | "cloudflare";
const PROVIDERS: Provider[] = ["groq", "anthropic", "gemini", "openrouter", "cloudflare"];

export class CloudUnavailable extends Error {}
// The fair-use limit for chat (functions/api/ai.ts): this visitor asked too
// many questions this minute, or today.
export class CloudLimited extends CloudUnavailable {
  limit: "minute" | "day";
  constructor(limit: "minute" | "day") {
    super(`limit: ${limit}`);
    this.limit = limit;
  }
}

const ENDPOINT = "/api/ai";

// Whether this copy of the site has the endpoint with a provider set up
// (static hosts without it, offline, the extension: no).
type Status = Partial<Record<Provider, boolean>> & { speak?: string[] };
let status: Promise<Status | null> | null = null;
const statusOf = () => {
  if (!AI_CLOUD) return Promise.resolve(null);
  status ??= fetch(ENDPOINT, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
    .catch(() => null);
  return status;
};
export function cloudAvailable(): Promise<boolean> {
  return statusOf().then((s) => PROVIDERS.some((p) => s?.[p]));
}
// The document languages the studio voice (Read aloud) speaks here; none when it's off.
export function studioLanguages(): Promise<string[]> {
  return statusOf().then((s) => (Array.isArray(s?.speak) ? s.speak : []));
}

const providerOf = (r: Response): Provider => {
  const name = r.headers.get("X-AI-Provider") as Provider | null;
  return name && PROVIDERS.includes(name) ? name : "anthropic";
};

async function send(body: object, signal?: AbortSignal): Promise<Response> {
  let r: Response;
  try {
    r = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new CloudUnavailable(String(e));
  }
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    let info: { limit?: string } = {};
    try {
      info = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (r.status === 429 && (info.limit === "minute" || info.limit === "day")) throw new CloudLimited(info.limit);
    throw new CloudUnavailable(`${r.status} ${text}`.trim());
  }
  return r;
}

const known = (p: string): Provider => (PROVIDERS.includes(p as Provider) ? (p as Provider) : "anthropic");

// A streamed reply; `onText` gets the text so far.
export async function cloudText(body: Record<string, unknown>, o: { onText?: (text: string) => void; signal?: AbortSignal } = {}): Promise<{ text: string; provider: Provider }> {
  const key = await answerKey(body).catch(() => null);
  const kept = key && (await keptAnswer(key));
  if (kept) {
    o.onText?.(kept.value);
    return { text: kept.value, provider: known(kept.provider) };
  }
  const { text, provider } = await fetchText(body, o);
  if (key) void keepAnswer(key, text, provider);
  return { text, provider };
}

async function fetchText(body: object, o: { onText?: (text: string) => void; signal?: AbortSignal }): Promise<{ text: string; provider: Provider }> {
  const r = await send(body, o.signal);
  const provider = providerOf(r);
  if (!r.body) return { text: await r.text(), provider };
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += value;
    o.onText?.(text);
  }
  if (!text.trim()) throw new CloudUnavailable("empty reply");
  return { text, provider };
}

export async function cloudJson<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<{ data: T; provider: Provider }> {
  const key = await answerKey(body).catch(() => null);
  const kept = key && (await keptAnswer(key));
  if (kept) return { data: JSON.parse(kept.value) as T, provider: known(kept.provider) };
  const r = await send(body, signal);
  const data = (await r.json()) as T;
  const provider = providerOf(r);
  if (key) void keepAnswer(key, JSON.stringify(data), provider);
  return { data, provider };
}
