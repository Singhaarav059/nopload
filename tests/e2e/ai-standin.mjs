// A stand-in for the server AI (/api/ai, functions/api/ai.ts) in browser
// tests, which run against the static build with no AI behind it. Its
// answers come from what it's sent, so a test can check the page sent the
// right text and showed the answer:
//  - chat: one sentence citing the first excerpt's page, "(p. N)";
//  - summarize: the text's first sentences as Markdown points, as many as asked;
//  - translate: each block with "ES " in front.
// `mode` changes how it answers next: { status: 503 } or { status: 429,
// limit: "minute" | "day" }; `posts` is what it was sent.
export async function aiStandIn(ctx) {
  const state = { mode: { status: 200, provider: "groq" }, posts: [] };
  await ctx.route("**/api/ai", async (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { groq: true, cerebras: false, anthropic: true, gemini: true, openrouter: false, cloudflare: true } });
    const body = req.postDataJSON();
    state.posts.push({ body, bytes: req.postDataBuffer()?.length ?? 0, origin: (await req.allHeaders()).origin });
    const { mode } = state;
    if (mode.status !== 200) return route.fulfill({ status: mode.status, json: mode.limit ? { error: "limit", limit: mode.limit } : { error: "no AI provider answered", fallbackToLocal: true } });
    const headers = { "X-AI-Provider": mode.provider };
    if (body.task === "chat") {
      const n = String(body.sources).match(/\(p\. (\d+)\)/)?.[1] ?? "1";
      return route.fulfill({ headers, contentType: "text/plain", body: mode.reply?.(body) ?? `The document answers that on this page (p. ${n}).` });
    }
    if (body.task === "summarize") {
      const sentences = String(body.text).replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter((s) => /\p{L}{3}/u.test(s));
      return route.fulfill({ headers, contentType: "text/plain", body: sentences.slice(0, body.points).map((s) => `- ${s}`).join("\n") || "- The document." });
    }
    if (body.task === "translate") return route.fulfill({ headers, json: { texts: body.texts.map((s) => `ES ${s}`) } });
    return route.fulfill({ status: 400, json: { error: "unknown task" } });
  });
  return state;
}
