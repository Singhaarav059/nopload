// The cloud AI (functions/api/ai.ts), from the page's side: a large model
// (Llama 3.3 70B on Groq's free tier, Claude by Anthropic, or Cloudflare
// Workers AI, the first of them that answers). Only the text a task needs is
// sent (a question and the passages that answer it, a document's text to
// summarise, blocks to translate), never the file. Any failure is a
// CloudUnavailable, which the tools tell the visitor about.

import { AI_CLOUD } from "../mode";

export const CLOUD = "cloud";
// Who answered, as the endpoint's X-AI-Provider header names it.
export type Provider = "groq" | "anthropic" | "gemini" | "openrouter" | "cloudflare";
const PROVIDERS: Provider[] = ["groq", "anthropic", "gemini", "openrouter", "cloudflare"];

export class CloudUnavailable extends Error {}

const ENDPOINT = "/api/ai";

// Whether this copy of the site has the endpoint with a provider set up
// (static hosts without it, offline, the extension: no).
let available: Promise<boolean> | null = null;
export function cloudAvailable(): Promise<boolean> {
  if (!AI_CLOUD) return Promise.resolve(false);
  available ??= fetch(ENDPOINT, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((s: Partial<Record<Provider, boolean>> | null) => PROVIDERS.some((p) => s?.[p]))
    .catch(() => false);
  return available;
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
  if (!r.ok) throw new CloudUnavailable(`${r.status} ${await r.text().catch(() => "")}`.trim());
  return r;
}

// A streamed reply; `onText` gets the text so far.
export async function cloudText(body: object, o: { onText?: (text: string) => void; signal?: AbortSignal } = {}): Promise<{ text: string; provider: Provider }> {
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

export async function cloudJson<T>(body: object, signal?: AbortSignal): Promise<{ data: T; provider: Provider }> {
  const r = await send(body, signal);
  return { data: (await r.json()) as T, provider: providerOf(r) };
}
