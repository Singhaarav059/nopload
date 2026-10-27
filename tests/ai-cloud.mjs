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
  const sent = JSON.parse(body);
  freeSeen.push({ url: req.url, auth: req.headers.authorization, body: sent });
  // Rate-limited: a key and model in `limited` ("Bearer key|model"), or the next `busy` requests.
  if (free.limited?.has(`${req.headers.authorization}|${sent.model}`) || (free.busy > 0 && free.busy--)) {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
    res.end(JSON.stringify({ error: { message: "Rate limit reached" } }));
    return;
  }
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
// The wait before trying everything again, short for the tests.
const quick = { AI_RETRY_JITTER_MS: "5-10" };
const groq = { GROQ_API_KEY: "gsk_test", GROQ_BASE_URL: `${freeBase}/groq`, ...quick };

let ip = 0;
// Each chat question is a new one (the endpoint answers a repeat from its
// cache), unless the test asks for the same one again with `same`.
let asked = 0;
const fresh = (body) => (body.task === "chat" && !body.same ? { ...body, question: `${body.question} (${++asked})` } : body);
// The reply cache is off unless a test turns it on.
const post = (body, env, headers = {}) =>
  onRequestPost({
    env: { AI_CACHE: "off", ...env },
    request: new Request("https://nopload.pages.dev/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://nopload.pages.dev", "cf-connecting-ip": `10.0.0.${++ip}`, ...headers },
      body: JSON.stringify(fresh(body)),
    }),
  });
const chat = { task: "chat", sources: "[1] (page 2) The lease ends in May.", question: "When does the lease end?" };
// A small request the general limits count (chat questions have their own, stricter limit).
const small = { task: "summarize", text: "The lease ends in May.", points: 1, language: "en" };
const claude = { ANTHROPIC_API_KEY: "test", ANTHROPIC_BASE_URL: base, ...quick };

await test("GET says which providers are set up", async () => {
  const none = { groq: false, cerebras: false, anthropic: false, gemini: false, openrouter: false, cloudflare: false };
  eq(await (await onRequestGet({ env: { ...claude, AI: workersAi("") } })).json(), { ...none, anthropic: true, cloudflare: true }, "Claude and Workers AI");
  eq(await (await onRequestGet({ env: {} })).json(), none, "none");
  eq(await (await onRequestGet({ env: { ...groq, GEMINI_API_KEY: "g", OPENROUTER_API_KEY: "o" } })).json(), { ...none, groq: true, gemini: true }, "Gemini on with its keys; OpenRouter, which may train and isn't named, stays off");
  eq(await (await onRequestGet({ env: { OPENROUTER_API_KEY: "o", AI_FREE_TIERS_MAY_TRAIN: "1" } })).json(), { ...none, openrouter: true }, "unless allowed");
});

await test("Groq's free tier answers first, streamed, with the chat prompt", async () => {
  free = { reply: "The lease ends in May (p. 2).", status: 200 };
  const before = seen.length;
  const res = await post(chat, { ...groq, ...claude, AI: workersAi("unused") });
  eq(res.headers.get("x-ai-provider"), "groq", "provider");
  eq(await res.text(), "The lease ends in May (p. 2).", "text");
  eq(seen.length, before, "Claude wasn't called");
  const sent = freeSeen.at(-1);
  eq([sent.url, sent.auth, sent.body.model, sent.body.stream], ["/groq/chat/completions", "Bearer gsk_test", "openai/gpt-oss-120b", true], "request");
  eq(sent.body.reasoning_effort, "low", "gpt-oss thinks briefly");
  eq(sent.body.messages[0], { role: "system", content: CHAT_SYSTEM }, "system prompt");
  if (!sent.body.messages.at(-1).content.includes("The lease ends in May")) throw new Error("excerpts missing");
});

await test("Claude answers when Groq is over its free limit", async () => {
  free = { reply: "", status: 429 };
  mode = { reply: "It ends in May (p. 2).", status: 200 };
  const res = await post(chat, { ...groq, ...claude });
  eq([res.headers.get("x-ai-provider"), await res.text()], ["anthropic", "It ends in May (p. 2)."], "reply");
});

await test("Gemini Flash-Lite after Groq and Claude; OpenRouter only when allowed to train, in AI_ORDER", async () => {
  free = { reply: "From the free tier (p. 2).", status: 200 };
  const keys = { GEMINI_API_KEY: "g", GEMINI_BASE_URL: `${freeBase}/gemini`, OPENROUTER_API_KEY: "o", OPENROUTER_BASE_URL: `${freeBase}/openrouter` };
  const gem = await post(chat, keys);
  eq([gem.headers.get("x-ai-provider"), freeSeen.at(-1).body.model], ["gemini", "gemini-3.5-flash-lite"], "Gemini answers with Flash-Lite");
  await gem.text();
  free = { reply: "", status: 429 };
  mode = { reply: "Claude first (p. 2).", status: 200 };
  const order = await post(chat, { ...groq, ...claude, GEMINI_API_KEY: "g", GEMINI_BASE_URL: `${freeBase}/gemini` });
  eq([order.headers.get("x-ai-provider"), await order.text()], ["anthropic", "Claude first (p. 2)."], "Groq busy: Claude before Gemini");
  free = { reply: "From the free tier (p. 2).", status: 200 };
  const res = await post(chat, { ...keys, AI_FREE_TIERS_MAY_TRAIN: "1", AI_ORDER: "openrouter,gemini" });
  eq([res.headers.get("x-ai-provider"), await res.text()], ["openrouter", "From the free tier (p. 2)."], "reply");
  eq([freeSeen.at(-1).url, freeSeen.at(-1).body.model], ["/openrouter/chat/completions", "meta-llama/llama-3.3-70b-instruct:free"], "OpenRouter's free Llama");
});

// A pool of Groq keys, each with all three models, and the tries it made.
const pool = (keys = "kA,kB", extra = {}) => ({ GROQ_API_KEYS: keys, GROQ_BASE_URL: `${freeBase}/groq`, ...quick, ...extra });
const tried = (from) => freeSeen.slice(from).map((x) => `${x.auth.slice(7)}|${x.body.model}`);

await test("pool: a rate-limited key moves on to the next key at once, and rests a minute", async () => {
  free = { reply: "From the pool (p. 2).", status: 200, limited: new Set(["Bearer kA1|openai/gpt-oss-120b"]) };
  const keys = "kA1,kB1";
  let from = freeSeen.length;
  for (let i = 0; i < 2; i++) {
    const res = await post(chat, pool(keys));
    eq([res.status, res.headers.get("x-ai-provider"), await res.text()], [200, "groq", "From the pool (p. 2)."], `answer ${i + 1}`);
  }
  // Whichever key went first, the limited one was asked at most once: then it rested.
  eq(tried(from).filter((x) => x === "kA1|openai/gpt-oss-120b").length, 1, `tries: ${tried(from)}`);
  eq(tried(from).filter((x) => x.endsWith("openai/gpt-oss-120b")).length >= 2, true, "the 120B model answered, from the other key");
  from = freeSeen.length;
  await post(chat, pool(keys));
  eq(tried(from).includes("kA1|openai/gpt-oss-120b"), false, "still resting");
});

await test("pool: the keys take turns going first (round robin)", async () => {
  free = { reply: "ok (p. 2).", status: 200 };
  const from = freeSeen.length;
  for (let i = 0; i < 4; i++) await (await post(chat, pool("kR1,kR2"))).text();
  const firsts = tried(from).map((x) => x.split("|")[0]);
  eq(new Set(firsts).size, 2, `both keys used first: ${firsts}`);
});

await test("pool: when every key's 120B is limited, the next model answers (its own bucket)", async () => {
  free = { reply: "From Qwen (p. 2).", status: 200, limited: new Set(["Bearer kC1|openai/gpt-oss-120b", "Bearer kC2|openai/gpt-oss-120b"]) };
  const from = freeSeen.length;
  const res = await post(chat, pool("kC1,kC2"));
  eq(await res.text(), "From Qwen (p. 2).", "answered");
  eq(tried(from).at(-1).split("|")[1], "qwen/qwen3.8-27b", `last try: ${tried(from)}`);
});

await test("pool: Cerebras takes over when every Groq key and model is limited", async () => {
  free = { reply: "From Cerebras (p. 2).", status: 200, limited: new Set(["Bearer kD1|openai/gpt-oss-120b", "Bearer kD1|qwen/qwen3.8-27b", "Bearer kD1|openai/gpt-oss-20b"]) };
  const env = pool("kD1", { CEREBRAS_API_KEYS: "cE1", CEREBRAS_BASE_URL: `${freeBase}/cerebras` });
  const res = await post(chat, env);
  eq([res.headers.get("x-ai-provider"), await res.text()], ["cerebras", "From Cerebras (p. 2)."], "reply");
  eq([freeSeen.at(-1).url, freeSeen.at(-1).body.model], ["/cerebras/chat/completions", "llama-3.3-70b"], "Cerebras's 70B first");
});

await test("pool: a burst that finds everyone busy waits a moment and tries again", async () => {
  free = { reply: "After the wait (p. 2).", status: 200, busy: 1 };
  const res = await post(chat, pool("kE1", { GROQ_MODELS: "openai/gpt-oss-120b" }));
  eq([res.status, await res.text()], [200, "After the wait (p. 2)."], "answered on the second round");
});

await test("pool: all of it used up: 503 with fallbackToLocal, after one more round", async () => {
  free = { reply: "", status: 200, limited: new Set(["Bearer kF1|openai/gpt-oss-120b", "Bearer kF1|qwen/qwen3.8-27b", "Bearer kF1|openai/gpt-oss-20b"]) };
  const from = freeSeen.length;
  const res = await post(chat, pool("kF1"));
  eq([res.status, (await res.json()).fallbackToLocal], [503, true], "fall back to the device");
  eq(tried(from).length, 6, `three models, tried twice: ${tried(from)}`);
});

await test("GET ?check asks every key and model once, names keys by number, never shows them", async () => {
  free = { reply: "ok", status: 200, limited: new Set(["Bearer kZ2|openai/gpt-oss-20b"]) };
  const env = pool("kZ1,kZ2", { OPENROUTER_API_KEYS: "oZ", OPENROUTER_BASE_URL: `${freeBase}/openrouter`, AI_ORDER: "groq,cloudflare", AI: workersAi("ok") });
  const res = await onRequestGet({ request: new Request("https://x/api/ai?check"), env });
  const text = await res.text();
  if (text.includes("kZ1") || text.includes("kZ2")) throw new Error(`a key was shown: ${text}`);
  const report = JSON.parse(text);
  eq([report.order, report.of, report.working], [["groq", "cloudflare"], 8, 7], "6 Groq slots, Workers AI and the off OpenRouter key, one limited");
  eq(report.results.filter((r) => r.provider === "openrouter" && r.ok).length, 1, "OpenRouter key tested though off for visitors");
  const bad = report.results.filter((r) => !r.ok);
  eq([bad.length, bad[0].key, bad[0].model], [1, 2, "openai/gpt-oss-20b"], "the limited one, by number");
  eq(report.ignored.length, 1, "OpenRouter keys noted as off");
});

await test("pool: one GROQ_API_KEY still works, and keys never reach the logs", async () => {
  free = { reply: "Single key (p. 2).", status: 200 };
  const logged = [];
  const warn = console.warn;
  console.warn = (...a) => logged.push(a.join(" "));
  try {
    free.limited = new Set(["Bearer gsk_secret_one|openai/gpt-oss-120b"]);
    const res = await post(chat, { GROQ_API_KEY: "gsk_secret_one", GROQ_BASE_URL: `${freeBase}/groq`, ...quick });
    eq(await res.text(), "Single key (p. 2).", "answered by the next model");
  } finally {
    console.warn = warn;
  }
  eq(logged.some((l) => l.includes("gsk_secret_one")), false, `logged: ${logged}`);
});

await test("cache: the same request again is answered from memory, with no model asked", async () => {
  free = { reply: "Kept (p. 2).", status: 200 };
  const env = { ...pool("kG1"), AI_CACHE: "on" };
  const ask = { ...chat, question: "What does the lease say about pets?", same: true };
  const first = await post(ask, env);
  eq([first.headers.get("x-ai-cache"), await first.text()], [null, "Kept (p. 2)."], "asked");
  const from = freeSeen.length;
  const again = await post(ask, env);
  eq([again.headers.get("x-ai-cache"), again.headers.get("x-ai-provider"), await again.text()], ["hit", "groq", "Kept (p. 2)."], "kept");
  eq(freeSeen.length, from, "no model asked");
  // A different question is a different request.
  await (await post({ ...ask, question: "And about smoking?" }, env)).text();
  eq(freeSeen.length, from + 1, "asked again");
});

await test("cache: it keeps the last 500, the oldest going first", async () => {
  free = { reply: "n (p. 2).", status: 200 };
  const env = { ...pool("kH1"), AI_CACHE: "on" };
  const q = (i) => ({ ...chat, question: `Question number ${i}?`, same: true });
  for (let i = 0; i <= 500; i++) await (await post(q(i), env)).text();
  eq((await post(q(500), env)).headers.get("x-ai-cache"), "hit", "the newest kept");
  eq((await post(q(0), env)).headers.get("x-ai-cache"), null, "the oldest gone");
});

await test("fair use: 10 chat questions a minute per visitor, then 429 with the limit named", async () => {
  free = { reply: "ok (p. 2).", status: 200 };
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await post(chat, pool("kI1"), { "cf-connecting-ip": "10.8.8.8" })).status);
  eq(statuses, [...Array(10).fill(200), 429, 429], "statuses");
  const res = await post(chat, pool("kI1"), { "cf-connecting-ip": "10.8.8.8" });
  eq([(await res.json()).limit, res.headers.get("retry-after")], ["minute", "60"], "the minute limit");
  eq((await post(chat, pool("kI1"), { "cf-connecting-ip": "10.8.8.9" })).status, 200, "another visitor isn't affected");
  eq((await post(small, pool("kI1"), { "cf-connecting-ip": "10.8.8.8" })).status, 200, "summaries aren't chat questions");
});

await test("the chat prompt asks for page citations, readable answers, money in and out, and says what's missing", async () => {
  for (const rule of ["(p. 5)", "never paste the document's lines", "Markdown list", "Markdown table", "what the document is about", "every amount", "money going out", "money coming in", "I couldn't find any mention of X in the document."])
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
  for (let i = 0; i < 45; i++) statuses.push((await post(small, claude, { "cf-connecting-ip": "10.7.7.7", "x-forwarded-for": `1.2.3.${i}`, origin: "https://nopload.vercel.app" })).status);
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
    env: { AI_CACHE: "off", ...env },
    request: new Request("https://nopload.pages.dev/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://nopload.pages.dev", ...headers },
      body: JSON.stringify(fresh(body)),
    }),
  });

await test("with AI_LIMITS, two instances share one visitor's budget", async () => {
  mode = { reply: "ok", status: 200 };
  const flood = async (env, addr) => {
    const statuses = [];
    for (let i = 0; i < 30; i++) statuses.push((await postTo({ onRequestPost }, small, env, { "cf-connecting-ip": addr })).status);
    for (let i = 0; i < 30; i++) statuses.push((await postTo(other, small, env, { "cf-connecting-ip": addr })).status);
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
  for (let i = 0; i < 42; i++) statuses.push((await post(small, { ...claude, AI_LIMITS: kv }, { "cf-connecting-ip": "10.6.6.3" })).status);
  eq(statuses.filter((s) => s === 200).length, 40, "40 then 429");
});

await test("AI_DAILY_CHARS caps all visitors together", async () => {
  mode = { reply: "ok", status: 200 };
  const kv = kvStore();
  const env = { ...claude, AI_LIMITS: kv, AI_DAILY_CHARS: "100000" };
  const big = { task: "chat", sources: "s".repeat(22_000), question: "q" };
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
  const statuses = await Promise.all(Array.from({ length: 60 }, (_, i) => postTo(i % 2 ? other : { onRequestPost }, small, env, { "cf-connecting-ip": "10.4.6.1" }).then((r) => r.status)));
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

await test("fair use with AI_QUOTA: exact across instances, and 60 a day", async () => {
  free = { reply: "ok (p. 2).", status: 200 };
  const quota = d1();
  const env = { ...pool("kJ1"), AI_QUOTA: quota };
  const statuses = await Promise.all(Array.from({ length: 14 }, (_, i) => postTo(i % 2 ? other : { onRequestPost }, chat, env, { "cf-connecting-ip": "10.3.3.3" }).then((r) => r.status)));
  eq(statuses.filter((x) => x === 200).length, 10, `10 a minute, concurrently (${statuses})`);
  // A visitor who has asked 60 today.
  const today = Math.floor(Date.now() / 86_400_000);
  quota.db.prepare("INSERT INTO ai_chat (ip, day, count, minute_at, minute) VALUES ('10.3.3.4', ?, 60, 0, 0)").run(today);
  const res = await post(chat, env, { "cf-connecting-ip": "10.3.3.4" });
  eq([res.status, (await res.json()).limit], [429, "day"], "the day's limit");
  // Yesterday's count doesn't carry over.
  quota.db.prepare("UPDATE ai_chat SET day = ? WHERE ip = '10.3.3.4'").run(today - 1);
  eq((await post(chat, env, { "cf-connecting-ip": "10.3.3.4" })).status, 200, "a new day");
});

server.close();
freeServer.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
