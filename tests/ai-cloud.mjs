// The cloud AI endpoint (functions/api/ai.ts): the providers set up, tried in
// order (Groq's free tier, Claude, the training free tiers only when allowed,
// Workers AI), a fixed prompt per task, capped inputs, and the origin check,
// and the usage limits. Anthropic and the OpenAI-style free tiers are local
// stand-in servers; Workers AI, KV and D1 are fake bindings (D1 over node:sqlite).
//
//   node tests/ai-cloud.mjs
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { onRequestGet, onRequestPost, jobOf, parseTexts, CHAT_SYSTEM } from "../functions/api/ai.ts";

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
};

// A stand-in for api.anthropic.com: streams `reply`, or fails with `status`.
let mode = { reply: "Hello [1].", status: 200 };
const seen = [];
const server = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  seen.push(JSON.parse(body));
  if (mode.status !== 200) {
    res.writeHead(mode.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  for (const piece of mode.reply.match(/.{1,4}/gs)) send("content_block_delta", { index: 0, delta: { type: "text_delta", text: piece } });
  send("content_block_stop", { index: 0 });
  send("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } });
  send("message_stop", {});
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// Workers AI: the whole reply at once, decoded as it does it: JSON as an
// object, a number as a number.
const workersAi = (reply) => ({
  calls: 0,
  async run(model, input) {
    this.calls++;
    this.input = input;
    let response = reply;
    try {
      response = JSON.parse(reply);
    } catch {
      /* plain text */
    }
    return { response };
  },
});

// A stand-in for the OpenAI-style free tiers (Groq, Gemini, OpenRouter):
// server-sent events of chat completion deltas, or `status`.
let free = { reply: "From Groq (p. 2).", status: 200 };
const freeSeen = [];
const freeServer = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  freeSeen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
  if (free.status !== 200) {
    res.writeHead(free.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Rate limit reached" } }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const piece of free.reply.match(/.{1,3}/gs)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
  res.end("data: [DONE]\n\n");
});
await new Promise((r) => freeServer.listen(0, "127.0.0.1", r));
const freeBase = `http://127.0.0.1:${freeServer.address().port}`;
const groq = { GROQ_API_KEY: "gsk_test", GROQ_BASE_URL: `${freeBase}/groq` };

let ip = 0;
const post = (body, env, headers = {}) =>
  onRequestPost({
    env,
    request: new Request("https://nopload.pages.dev/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://nopload.pages.dev", "cf-connecting-ip": `10.0.0.${++ip}`, ...headers },
      body: JSON.stringify(body),
    }),
  });
const chat = { task: "chat", sources: "[1] (page 2) The lease ends in May.", question: "When does the lease end?" };
const claude = { ANTHROPIC_API_KEY: "test", ANTHROPIC_BASE_URL: base };

await test("GET says which providers are set up", async () => {
  const none = { groq: false, anthropic: false, gemini: false, openrouter: false, cloudflare: false };
  eq(await (await onRequestGet({ env: { ...claude, AI: workersAi("") } })).json(), { ...none, anthropic: true, cloudflare: true }, "Claude and Workers AI");
  eq(await (await onRequestGet({ env: {} })).json(), none, "none");
  eq(await (await onRequestGet({ env: { ...groq, GEMINI_API_KEY: "g", OPENROUTER_API_KEY: "o" } })).json(), { ...none, groq: true }, "free tiers that may train stay off");
  eq(await (await onRequestGet({ env: { GEMINI_API_KEY: "g", AI_FREE_TIERS_MAY_TRAIN: "1" } })).json(), { ...none, gemini: true }, "unless allowed");
});

await test("Groq's free tier answers first, streamed, with the chat prompt", async () => {
  free = { reply: "The lease ends in May (p. 2).", status: 200 };
  const before = seen.length;
  const res = await post(chat, { ...groq, ...claude, AI: workersAi("unused") });
  eq(res.headers.get("x-ai-provider"), "groq", "provider");
  eq(await res.text(), "The lease ends in May (p. 2).", "text");
  eq(seen.length, before, "Claude wasn't called");
  const sent = freeSeen.at(-1);
  eq([sent.url, sent.auth, sent.body.model, sent.body.stream], ["/groq/chat/completions", "Bearer gsk_test", "llama-3.3-70b-versatile", true], "request");
  eq(sent.body.messages[0], { role: "system", content: CHAT_SYSTEM }, "system prompt");
  if (!sent.body.messages.at(-1).content.includes("The lease ends in May")) throw new Error("excerpts missing");
});

await test("Claude answers when Groq is over its free limit", async () => {
  free = { reply: "", status: 429 };
  mode = { reply: "It ends in May (p. 2).", status: 200 };
  const res = await post(chat, { ...groq, ...claude });
  eq([res.headers.get("x-ai-provider"), await res.text()], ["anthropic", "It ends in May (p. 2)."], "reply");
});

await test("Gemini and OpenRouter free tiers only when allowed to train, in AI_ORDER", async () => {
  free = { reply: "From the free tier (p. 2).", status: 200 };
  const keys = { GEMINI_API_KEY: "g", GEMINI_BASE_URL: `${freeBase}/gemini`, OPENROUTER_API_KEY: "o", OPENROUTER_BASE_URL: `${freeBase}/openrouter` };
  eq((await post(chat, keys)).status, 503, "not allowed: none set up");
  const res = await post(chat, { ...keys, AI_FREE_TIERS_MAY_TRAIN: "1", AI_ORDER: "openrouter,gemini" });
  eq([res.headers.get("x-ai-provider"), await res.text()], ["openrouter", "From the free tier (p. 2)."], "reply");
  eq([freeSeen.at(-1).url, freeSeen.at(-1).body.model], ["/openrouter/chat/completions", "meta-llama/llama-3.3-70b-instruct:free"], "OpenRouter's free Llama");
});

await test("the chat prompt asks for page citations, plain answers, money in and out, and says what's missing", async () => {
  for (const rule of ["(p. 5)", "never paste the document's lines", "every amount", "money going out", "money coming in", "I couldn't find any mention of X in the document."])
    if (!CHAT_SYSTEM.includes(rule)) throw new Error(`missing: ${rule}`);
});

await test("chat streams Claude's answer", async () => {
  mode = { reply: "It ends in May [1].", status: 200 };
  const res = await post(chat, { ...claude, AI: workersAi("unused") });
  eq(res.headers.get("x-ai-provider"), "anthropic", "provider");
  eq(await res.text(), "It ends in May [1].", "text");
  const sent = seen.at(-1);
  eq(sent.model, "claude-haiku-5-5", "model");
  eq(sent.output_config.effort, "low", "effort");
  if (sent.system !== CHAT_SYSTEM) throw new Error("the chat prompt wasn't used");
  if (!sent.messages.at(-1).content.includes("The lease ends in May")) throw new Error("sources missing");
});

await test("Workers AI answers when Claude fails, without its thinking", async () => {
  mode = { reply: "", status: 400 };
  const ai = workersAi("<think>Let me see.</think>\n\nIt ends in May [1].");
  const res = await post(chat, { ...claude, AI: ai });
  eq(res.headers.get("x-ai-provider"), "cloudflare", "provider");
  eq(await res.text(), "It ends in May [1].", "text");
  eq(ai.calls, 1, "calls");
});

await test("Workers AI answers when there's no Anthropic key", async () => {
  const res = await post(chat, { AI: workersAi("May [1].") });
  eq([res.headers.get("x-ai-provider"), await res.text()], ["cloudflare", "May [1]."], "reply");
});

await test("provider: cloudflare uses only Workers AI, even when Claude is set up", async () => {
  const before = seen.length;
  const ai = workersAi("It ends on 31 May 2027, at $1,234.50 [1].");
  const res = await post({ ...chat, provider: "cloudflare" }, { ...claude, AI: ai });
  eq([res.headers.get("x-ai-provider"), await res.text()], ["cloudflare", "It ends on 31 May 2027, at $1,234.50 [1]."], "reply, numbers included");
  eq(seen.length, before, "Claude wasn't called");
  if (!ai.input.messages[0].content.startsWith(CHAT_SYSTEM)) throw new Error("the chat prompt wasn't used");
  // No Workers AI: no answer, rather than sending the text to Anthropic.
  eq((await post({ ...chat, provider: "cloudflare" }, claude)).status, 503, "no fallback to Claude");
  eq(seen.length, before, "still not called");
});

await test("503 when no provider is set up or none answers", async () => {
  eq((await post(chat, {})).status, 503, "none set up");
  mode = { reply: "", status: 529 };
  eq((await post(chat, claude)).status, 503, "Claude down, no fallback");
});

await test("translate returns one translation per block", async () => {
  mode = { reply: JSON.stringify({ texts: ["Hola", "Adiós"] }), status: 200 };
  const res = await post({ task: "translate", texts: ["Hello", "Goodbye"], language: "es" }, claude);
  eq(await res.json(), { texts: ["Hola", "Adiós"] }, "texts");
  eq(seen.at(-1).output_config.format.type, "json_schema", "structured output");
  if (!seen.at(-1).system.includes("Spanish")) throw new Error("language not named");
  mode = { reply: JSON.stringify({ texts: ["Hola"] }), status: 200 };
  eq((await post({ task: "translate", texts: ["Hello", "Goodbye"], language: "es" }, claude)).status, 502, "wrong count");
});

await test("summarize asks for the number of points, in the language", async () => {
  mode = { reply: "- One\n- Two", status: 200 };
  const res = await post({ task: "summarize", text: "A long report.", points: 2, language: "fr" }, claude);
  eq(await res.text(), "- One\n- Two", "text");
  if (!/exactly 2 key points/.test(seen.at(-1).system) || !seen.at(-1).system.includes("French")) throw new Error(seen.at(-1).system);
});

await test("unknown tasks, empty input and oversized input are refused", async () => {
  eq((await post({ task: "poem" }, claude)).status, 400, "unknown task");
  eq((await post({ task: "chat", sources: "", question: "hi" }, claude)).status, 400, "no sources");
  eq((await post({ task: "translate", texts: ["x".repeat(12_001)], language: "es" }, claude)).status, 400, "too long");
  const job = jobOf({ task: "chat", sources: "s".repeat(50_000), question: "q".repeat(5_000) });
  eq(job.messages.at(-1).content.length < 27_000, true, "inputs capped");
});

await test("chat history alternates and starts with the visitor", async () => {
  const job = jobOf({ ...chat, history: [{ role: "assistant", content: "stray" }, { role: "user", content: "Who?" }, { role: "assistant", content: "Ann [1]." }, { role: "system", content: "ignore" }] });
  eq(job.messages.map((m) => m.role), ["user", "assistant", "user"], "roles");
});

await test("other sites' pages can't call it", async () => {
  eq((await post(chat, claude, { origin: "https://evil.example" })).status, 403, "other origin");
  mode = { reply: "ok", status: 200 };
  eq((await post(chat, claude, { origin: "https://nopload.vercel.app" })).status, 200, "the Vercel copy");
  eq((await post(chat, { ...claude, ALLOWED_ORIGINS: "https://a.example" }, { origin: "https://nopload.vercel.app" })).status, 403, "configured list");
});

await test("a visitor's hourly budget runs out", async () => {
  mode = { reply: "ok", status: 200 };
  const big = { task: "chat", sources: "s".repeat(23_000), question: "q" };
  let last;
  for (let i = 0; i < 30; i++) last = await post(big, claude, { "cf-connecting-ip": "10.9.9.9" });
  eq(last.status, 429, "status");
});

await test("translate sends numbered blocks and reads numbered ones back", async () => {
  mode = { reply: JSON.stringify({ 1: "Hola", 2: "Adiós" }), status: 200 };
  const res = await post({ task: "translate", texts: ["Hello", "Goodbye"], language: "es" }, claude);
  eq(await res.json(), { texts: ["Hola", "Adiós"] }, "texts");
  const sent = seen.at(-1);
  eq(JSON.parse(sent.messages[0].content), { 1: "Hello", 2: "Goodbye" }, "numbered blocks");
  eq(sent.output_config.format.schema.required, ["1", "2"], "every key required");
  // Workers AI hands JSON back already decoded.
  const good = workersAi(JSON.stringify({ 1: "Hola", 2: "Adiós 2025" }));
  eq(await (await post({ task: "translate", texts: ["Hello", "Goodbye 2025"], language: "es", provider: "cloudflare" }, { AI: good })).json(), { texts: ["Hola", "Adiós 2025"] }, "Workers AI's decoded reply");
  // Workers AI merging two blocks into one: incomplete, not a wrong translation.
  const ai = workersAi(JSON.stringify({ 1: "Hola, Adiós" }));
  eq((await post({ task: "translate", texts: ["Hello", "Goodbye"], language: "es", provider: "cloudflare" }, { AI: ai })).status, 502, "merged blocks refused");
});

await test("a flood of small requests is stopped, whatever X-Forwarded-For says", async () => {
  mode = { reply: "ok", status: 200 };
  const statuses = [];
  for (let i = 0; i < 45; i++) statuses.push((await post(chat, claude, { "cf-connecting-ip": "10.7.7.7", "x-forwarded-for": `1.2.3.${i}`, origin: "https://nopload.vercel.app" })).status);
  eq(statuses.slice(0, 40).every((x) => x === 200), true, "the first 40 a minute");
  eq(statuses.slice(40), [429, 429, 429, 429, 429], "then 429");
});

// A Workers KV namespace in memory; `broken` makes every call fail.
const kvStore = () => {
  const data = new Map();
  return {
    data,
    broken: false,
    async get(key, type) {
      if (this.broken) throw new Error("KV is down");
      const v = data.get(key);
      return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value, o) {
      if (this.broken) throw new Error("KV is down");
      if (o?.expirationTtl < 60) throw new Error("expirationTtl under 60");
      data.set(key, value);
    },
  };
};
// A second copy of the module is a second Worker instance: its own memory.
const other = await import("../functions/api/ai.ts?instance=2");
const postTo = (instance, body, env, headers) =>
  instance.onRequestPost({
    env,
    request: new Request("https://nopload.pages.dev/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://nopload.pages.dev", ...headers },
      body: JSON.stringify(body),
    }),
  });

await test("with AI_LIMITS, two instances share one visitor's budget", async () => {
  mode = { reply: "ok", status: 200 };
  const flood = async (env, addr) => {
    const statuses = [];
    for (let i = 0; i < 30; i++) statuses.push((await postTo({ onRequestPost }, chat, env, { "cf-connecting-ip": addr })).status);
    for (let i = 0; i < 30; i++) statuses.push((await postTo(other, chat, env, { "cf-connecting-ip": addr })).status);
    return statuses.filter((s) => s === 200).length;
  };
  // In memory, each instance counts on its own: 60 get through, not 40.
  eq(await flood(claude, "10.6.6.1"), 60, "without the binding");
  const kv = kvStore();
  eq(await flood({ ...claude, AI_LIMITS: kv }, "10.6.6.2"), 40, "with it");
  eq(JSON.parse(kv.data.get("ip:10.6.6.2")).requests, 40, "the shared count");
});

await test("when AI_LIMITS fails, the in-memory limit still holds", async () => {
  mode = { reply: "ok", status: 200 };
  const kv = kvStore();
  kv.broken = true;
  const statuses = [];
  for (let i = 0; i < 42; i++) statuses.push((await post(chat, { ...claude, AI_LIMITS: kv }, { "cf-connecting-ip": "10.6.6.3" })).status);
  eq(statuses.filter((s) => s === 200).length, 40, "40 then 429");
});

await test("AI_DAILY_CHARS caps all visitors together", async () => {
  mode = { reply: "ok", status: 200 };
  const kv = kvStore();
  const env = { ...claude, AI_LIMITS: kv, AI_DAILY_CHARS: "100000" };
  const big = { task: "chat", sources: "s".repeat(23_000), question: "q" };
  const statuses = [];
  // Different visitors, alternating instances: four fit in 100,000 characters.
  for (let i = 0; i < 6; i++) statuses.push((await postTo(i % 2 ? other : { onRequestPost }, big, env, { "cf-connecting-ip": `10.5.5.${i}` })).status);
  eq(statuses, [200, 200, 200, 200, 429, 429], "statuses");
});

// A D1 database: the binding's prepare/bind/first/run/all over SQLite in
// memory, so the limiter's real SQL runs. Each statement waits a tick
// first, so concurrent requests interleave between statements, as on D1;
// `broken` makes every query fail.
const d1 = () => {
  const db = new DatabaseSync(":memory:");
  const mock = {
    db,
    broken: false,
    queries: 0,
    prepare(sql) {
      const statement = (values) => {
        const exec = async (how) => {
          await null;
          if (mock.broken) throw new Error("D1 is down");
          mock.queries++;
          return db.prepare(sql)[how](...values);
        };
        return {
          bind: (...v) => statement(v),
          first: async () => (await exec("get")) ?? null,
          run: async () => ({ success: true, meta: await exec("run") }),
          all: async () => ({ success: true, results: await exec("all") }),
        };
      };
      return statement([]);
    },
  };
  return mock;
};
// A summary request of exactly `n` characters, as the limiter counts them.
const summaryOf = (n) => {
  const size = (j) => j.system.length + j.messages.reduce((a, m) => a + m.content.length, 0);
  const body = { task: "summarize", text: "t", points: 1, language: "en" };
  return { ...body, text: "t".repeat(n - size(jobOf(body)) + 1) };
};

await test("with AI_QUOTA, a burst can't overshoot AI_DAILY_CHARS (5 × 359 against 500)", async () => {
  mode = { reply: "- ok", status: 200 };
  const quota = d1();
  const env = { ...claude, AI_QUOTA: quota, AI_DAILY_CHARS: "500" };
  const before = seen.length;
  const statuses = await Promise.all([0, 1, 2, 3, 4].map((i) => postTo(i % 2 ? other : { onRequestPost }, summaryOf(359), env, { "cf-connecting-ip": `10.4.4.${i}` }).then((r) => r.status)));
  eq(statuses.filter((s) => s === 200).length, 1, `one admitted (${statuses})`);
  eq(statuses.filter((s) => s === 429).length, 4, "the rest refused");
  eq(seen.length - before, 1, "Claude called once");
  eq(quota.db.prepare("SELECT chars FROM ai_day").all().map((r) => r.chars), [359], "recorded usage");
});

await test("with only AI_LIMITS, the same burst gets through: KV is a budget, not a ceiling", async () => {
  mode = { reply: "- ok", status: 200 };
  const kv = kvStore();
  const env = { ...claude, AI_LIMITS: kv, AI_DAILY_CHARS: "500" };
  const statuses = await Promise.all([0, 1, 2, 3, 4].map((i) => post(summaryOf(359), env, { "cf-connecting-ip": `10.4.5.${i}` }).then((r) => r.status)));
  eq(statuses.filter((s) => s === 200).length > 1, true, `more than one admitted (${statuses})`);
});

await test("with AI_QUOTA, two instances share one visitor's budget exactly", async () => {
  mode = { reply: "ok", status: 200 };
  const quota = d1();
  const env = { ...claude, AI_QUOTA: quota, AI_LIMITS: kvStore() };
  const statuses = await Promise.all(Array.from({ length: 60 }, (_, i) => postTo(i % 2 ? other : { onRequestPost }, chat, env, { "cf-connecting-ip": "10.4.6.1" }).then((r) => r.status)));
  eq(statuses.filter((s) => s === 200).length, 40, "40 a minute, concurrently");
  eq(quota.db.prepare("SELECT requests FROM ai_visitor WHERE ip = '10.4.6.1'").get().requests, 40, "the shared count");
  eq(env.AI_LIMITS.data.size, 0, "KV isn't used when D1 is bound");
});

await test("when AI_QUOTA fails, requests are refused (503) and no model runs", async () => {
  mode = { reply: "ok", status: 200 };
  const quota = d1();
  quota.broken = true;
  const ai = workersAi("unused");
  const before = seen.length;
  const res = await post(chat, { ...claude, AI: ai, AI_QUOTA: quota, AI_LIMITS: kvStore() });
  eq(res.status, 503, "status");
  eq([seen.length - before, ai.calls], [0, 0], "neither provider called");
  // It comes back once D1 does.
  quota.broken = false;
  eq((await post(chat, { ...claude, AI_QUOTA: quota })).status, 200, "recovered");
});

await test("with AI_QUOTA, a request no model answered is given back", async () => {
  const quota = d1();
  const env = { ...claude, AI_QUOTA: quota, AI_DAILY_CHARS: "500" };
  mode = { reply: "", status: 529 };
  eq((await post(summaryOf(359), env)).status, 503, "Claude down");
  eq(quota.db.prepare("SELECT chars FROM ai_day").get().chars, 0, "the day's characters back");
  mode = { reply: "- ok", status: 200 };
  eq((await post(summaryOf(359), env)).status, 200, "so the next one fits");
});

await test("a POST without an Origin is refused", async () => {
  const before = seen.length;
  eq((await post(chat, claude, { origin: "" })).status, 403, "no Origin");
  eq(seen.length, before, "no model ran");
});

await test("oversized, empty and mistyped requests are refused before any model runs", async () => {
  const before = seen.length;
  const big = JSON.stringify({ task: "chat", question: "q", sources: "s".repeat(500_000) });
  eq((await post(JSON.parse(big), claude)).status, 413, "a 500 KB body");
  eq((await post({ task: "translate", texts: ["", "  "], language: "es" }, claude)).status, 400, "only empty blocks");
  eq((await post({ task: "translate", texts: ["Hello", 1], language: "es" }, claude)).status, 400, "a block that isn't text");
  eq(seen.length, before, "Claude wasn't called");
});

await test("replies can't be sniffed or framed as a page", async () => {
  mode = { reply: "<script>alert(1)</script>", status: 200 };
  const res = await post(chat, claude);
  eq(res.headers.get("x-content-type-options"), "nosniff", "nosniff");
  eq(res.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'", "CSP");
  eq(res.headers.get("content-type"), "text/plain; charset=utf-8", "plain text");
  eq((await post({ task: "poem" }, claude)).headers.get("x-content-type-options"), "nosniff", "errors too");
});

await test("parseTexts reads JSON in or out of a code fence", async () => {
  eq(parseTexts('```json\n{"texts": ["a", "b"]}\n```'), ["a", "b"], "fenced");
  eq(parseTexts('{"2": "b", "1": "a"}', 2), ["a", "b"], "numbered, in order");
  eq(parseTexts('{"1": "a"}', 2), null, "a number missing");
  eq(parseTexts('["a"]'), ["a"], "bare array");
  eq(parseTexts("not json"), null, "garbage");
});

server.close();
freeServer.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
