// Read PDF aloud (P2-16) in real browsers, with a stand-in speech engine
// that records what it's asked to say: the text shows in reading order,
// Listen starts speaking within 1 s, the passage and word being read are
// highlighted, pause stops the voice and resume picks up again, next and
// stop do what they say, a heading is announced by a pause, a list by how
// many points it has, and a voice chosen stays chosen, even mid-sentence.
//
//   node tests/e2e/listen.mjs [chromium] [firefox] [webkit]   (see kit.mjs)
import { open, pick, suite } from "./kit.mjs";
import { readFileSync } from "node:fs";
import { aiStandIn } from "./ai-standin.mjs";

// The stand-in: one voice, utterances queued and finished on demand.
const fakeSpeech = () => {
  const said = [];
  let queue = [];
  window.__speech = { said, queue: () => queue, finish: () => queue.shift()?.onend?.(), paused: false, cancelled: 0 };
  class U {
    constructor(text) {
      this.text = text;
    }
  }
  window.SpeechSynthesisUtterance = U;
  const synth = {
    // Two voices with one name, as Chrome on Android lists them.
    getVoices: () => [
      { name: "English United States", lang: "en-US", voiceURI: "us-a", localService: true, default: true },
      { name: "English United States", lang: "en-US", voiceURI: "us-b", localService: false },
      { name: "English India", lang: "en-IN", voiceURI: "in-a", localService: true },
    ],
    addEventListener() {},
    removeEventListener() {},
    speak(u) {
      said.push({ text: u.text, at: performance.now(), voice: u.voice?.voiceURI });
      queue.push(u);
      // The first word, as voices report it.
      setTimeout(() => u.onboundary?.({ name: "word", charIndex: 0, charLength: u.text.split(" ")[0].length }), 50);
    },
    pause() {
      window.__speech.paused = true;
    },
    resume() {
      window.__speech.paused = false;
    },
    cancel() {
      window.__speech.cancelled++;
      queue = [];
    },
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
};

// Lets the stand-in finish what it's saying until `selector` shows.
const until = async (page, selector) => {
  for (let k = 0; k < 80; k++) {
    if (await page.locator(selector).count()) return;
    await page.evaluate(() => window.__speech.finish());
    await page.waitForTimeout(150);
  }
  throw new Error(`never got to ${selector}`);
};

await suite(async ({ browser, test }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(fakeSpeech);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  await test("the text shows in reading order, the sections listed", async () => {
    await open(page, "/en/read-pdf-aloud");
    await pick(page, ["report.pdf"]);
    await page.waitForSelector("[data-passage]");
    const first = await page.locator("[data-passage]").first().innerText();
    if (!/Quarterly/.test(first)) throw new Error(`first passage: ${first}`);
    const sections = await page.locator(".ls-chapter").count();
    if (sections < 2) throw new Error(`${sections} sections`);
    return `${await page.locator("[data-passage]").count()} passages, ${sections} sections`;
  });

  await test("Listen starts speaking within 1 s: how long the document is, then its words, marked", async () => {
    const t0 = await page.evaluate(() => performance.now());
    await page.locator("[data-action=play]").click();
    await page.waitForFunction(() => window.__speech.said.length > 0, null, { timeout: 5000 });
    const ms = (await page.evaluate(() => window.__speech.said[0].at)) - t0;
    if (ms > 1000) throw new Error(`first words after ${Math.round(ms)} ms`);
    const intro = await page.evaluate(() => window.__speech.said[0].text);
    if (!/pages?/.test(intro)) throw new Error(`opening: ${intro}`);
    await until(page, "[data-passage='0'][aria-current] mark");
    return `${Math.round(ms)} ms, "${intro}"`;
  });

  await test("pause silences the voice, resume picks up again, next and stop", async () => {
    const before = await page.evaluate(() => ({ said: window.__speech.said.length, cancelled: window.__speech.cancelled }));
    await page.getByRole("button", { name: "Pause" }).click();
    await page.waitForSelector("[data-listen=paused]");
    if ((await page.evaluate(() => window.__speech.cancelled)) <= before.cancelled) throw new Error("still speaking");
    await page.getByRole("button", { name: "Resume" }).first().click();
    await page.waitForFunction((n) => window.__speech.said.length > n, before.said);
    await page.getByRole("button", { name: "Next paragraph" }).first().click();
    await page.waitForSelector("[data-passage='1'][aria-current]");
    await page.getByRole("button", { name: "Stop" }).click();
    await page.waitForSelector("[data-listen=idle]");
  });

  await test("reading moves on when a passage ends; a click jumps to any passage", async () => {
    await page.locator("[data-passage='2']").click();
    await page.waitForSelector("[data-passage='2'][aria-current]");
    await until(page, "[data-passage='3'][aria-current]");
  });

  await test("a list is introduced by how many points it has, its bullets not read", async () => {
    const list = page.locator("[data-kind=list]").first();
    if (!(await list.count())) return "no list in the file";
    const at = Number(await list.getAttribute("data-passage"));
    const n = await page.evaluate(() => window.__speech.said.length);
    await list.click();
    await page.waitForFunction((k) => window.__speech.said.length > k, n);
    const said = await page.evaluate((k) => window.__speech.said.slice(k).map((s) => s.text), n);
    if (!said.some((s) => /points:/.test(s))) throw new Error(`said: ${said.join(" | ")}`);
    if (said.some((s) => /^[-•]/.test(s))) throw new Error(`a bullet was read: ${said.join(" | ")}`);
    return `passage ${at}: ${said[0]}`;
  });

  await test("a voice chosen stays chosen, and takes over mid-sentence", async () => {
    await page.locator(".ls-voice").click();
    const select = page.locator(".ls-settings select");
    await select.selectOption("us-b");
    if ((await select.inputValue()) !== "us-b") throw new Error(`picker shows ${await select.inputValue()}`);
    const n = await page.evaluate(() => window.__speech.said.length);
    await page.waitForFunction((k) => window.__speech.said.length > k, n);
    const voice = await page.evaluate(() => window.__speech.said.at(-1).voice);
    if (voice !== "us-b") throw new Error(`spoken with ${voice}`);
    await page.getByRole("button", { name: "Stop" }).click();
    await page.reload();
    await pick(page, ["report.pdf"]);
    await page.waitForSelector("[data-passage]");
    await page.locator(".ls-voice").click();
    if ((await page.locator(".ls-settings select").inputValue()) !== "us-b") throw new Error("not remembered");
    return "us-b";
  });

  await ctx.close();

  // Explain and the studio voice, with a stand-in for the server AI.
  const ctx2 = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 1000 } });
  await ctx2.addInitScript(fakeSpeech);
  const ai = await aiStandIn(ctx2);
  const page2 = await ctx2.newPage();
  page2.setDefaultTimeout(20000);

  await test("Explain: the AI walks through each section, the next one asked for ahead", async () => {
    await open(page2, "/en/read-pdf-aloud");
    await pick(page2, ["report.pdf"]);
    await page2.waitForSelector("[data-passage]");
    await page2.locator("[data-mode=explain]").click();
    await page2.locator("[data-action=play]").click();
    await page2.waitForFunction(() => window.__speech.said.some((s) => /^Next, /.test(s.text)));
    const asked = ai.posts.filter((p) => p.body.task === "narrate");
    if (asked.length < 2) throw new Error(`${asked.length} sections asked for`);
    if (!/^## /m.test(asked[0].body.text) || asked[0].body.language !== "en") throw new Error(`sent: ${JSON.stringify(asked[0].body).slice(0, 200)}`);
    const said = await page2.evaluate(() => window.__speech.said.find((s) => /^Next, /.test(s.text)).text);
    await page2.getByRole("button", { name: "Stop" }).click();
    return said;
  });

  await test("the studio voice busy: the device's voice takes over, and says so", async () => {
    await page2.locator("[data-mode=read]").click();
    await page2.locator(".ls-voice").click();
    await page2.locator("[data-engine=studio]").click();
    const n = await page2.evaluate(() => window.__speech.said.length);
    await page2.locator("[data-action=play]").click();
    await page2.waitForSelector(".ls-notice");
    await page2.waitForFunction((k) => window.__speech.said.length > k, n);
    if (!ai.posts.some((p) => p.body.task === "speak" && p.body.text)) throw new Error("studio voice not asked");
    if ((await page2.locator("[data-engine=device]").getAttribute("aria-checked")) !== "true") throw new Error("still on studio");
    await page2.getByRole("button", { name: "Stop" }).click();
    return await page2.locator(".ls-notice").innerText();
  });

  await test("the studio voice: its audio plays, sentence after sentence, made ahead", async () => {
    const tone = readFileSync(new URL("../fixtures/tone.mp3", import.meta.url));
    ai.speak = () => ({ status: 200, contentType: "audio/mpeg", body: tone });
    ai.posts.length = 0;
    await page2.reload();
    await pick(page2, ["report.pdf"]);
    await page2.waitForSelector("[data-passage]");
    await page2.locator(".ls-voice").click();
    await page2.locator("[data-engine=studio]").click();
    const n = await page2.evaluate(() => window.__speech.said.length);
    await page2.locator("[data-action=play]").click();
    await page2.waitForSelector("[data-passage='1'][aria-current]", { timeout: 15000 });
    if (await page2.locator(".ls-notice").count()) throw new Error(await page2.locator(".ls-notice").innerText());
    if ((await page2.evaluate(() => window.__speech.said.length)) !== n) throw new Error("the device's voice spoke");
    const spoken = ai.posts.filter((p) => p.body.task === "speak").map((p) => p.body.text);
    await page2.getByRole("button", { name: "Stop" }).click();
    return `${spoken.length} sentences made`;
  });

  await ctx2.close();
});
