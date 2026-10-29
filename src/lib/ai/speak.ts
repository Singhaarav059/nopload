"use client";

// Read aloud (P2-16): a PDF's text in reading order, told by a narrator
// (./narrate.ts) in one of two voices:
//  - the device's own (speech synthesis): nothing is sent anywhere;
//  - the studio voice: a natural AI voice made on the server (task "speak",
//    functions/api/ai.ts), the sentence being read sent to make its audio.
//    When it's busy or used up, the device's voice takes over.
// And in two modes: Read, every word; Explain, the server AI walks through
// each section in its own words (task "narrate").

import { closePdf, openPdf, bytesOf } from "../pdf/common";
import { PdfError } from "../pdf/errors";
import { blocks, bodySizeOf, type Line } from "../pdf/text";
import { documentLayout, type PageLayout } from "../pdf/layout";
import { grid } from "../pdf/tables";
import { guessLanguage } from "./extractive";
import { chapters, explanationScript, introScript, passageScript, sectionText, type Cues, type Passage, type Segment } from "./narrate";

export type { Passage, Segment } from "./narrate";

const linesOf = (l: PageLayout) =>
  l.sections.flatMap((s) => s.columns.flatMap((c) => c.items.flatMap((it) => (it.kind === "lines" ? [it.lines as Line[]] : []))));

// The passages of a document, in reading order across columns, page by
// page; the header and footer lines repeated on most pages (a title, page
// numbers) left out, tables kept as rows. A scan is read through OCR first.
async function passagesOf(file: File, onPage?: (done: number, total: number) => void): Promise<Passage[]> {
  const pdf = await openPdf(await bytesOf(file));
  try {
    const layouts = await documentLayout(pdf, (i) => onPage?.(i, pdf.numPages));
    const body = bodySizeOf(layouts.map((l) => ({ lines: linesOf(l).flat() })));
    const out: Passage[] = [];
    layouts.forEach((layout, i) => {
      for (const s of layout.sections)
        for (const c of s.columns)
          for (const it of c.items) {
            if (it.kind === "lines") {
              for (const b of blocks(it.lines as Line[], body)) {
                const text = b.text.replace(/\s+/g, " ").trim();
                // A lone page number left in the flow isn't read.
                if (text && !/^(?:page\s*)?\d{1,4}(?:\s*(?:\/|of)\s*\d{1,4})?$/i.test(text)) out.push({ page: i + 1, kind: b.kind, level: b.level, text });
              }
            } else if (it.kind === "table") {
              const rows = grid(it.table).map((r) => r.map((cell) => (cell?.text ?? "").replace(/\s+/g, " ").trim())).filter((r) => r.some(Boolean));
              if (rows.length) out.push({ page: i + 1, kind: "table", text: rows.map((r) => r.filter(Boolean).join(" · ")).join("\n"), rows });
            }
          }
    });
    return out;
  } finally {
    await closePdf(pdf);
  }
}

export async function readingOrder(file: File, onPage?: (done: number, total: number) => void): Promise<{ lang: string; pages: number; passages: Passage[] }> {
  let passages = await passagesOf(file, onPage);
  let read = file;
  if (!passages.length) {
    // A scanned PDF: its pictures of text read with OCR, then the text.
    try {
      const { autoOcr } = await import("../pdf/ocr");
      const scan = await autoOcr(file, { ocrLang: "eng" });
      if (scan.pages) {
        read = scan.file;
        passages = await passagesOf(read, onPage);
      }
    } catch {
      /* no OCR here: no text, as before */
    }
  }
  if (!passages.length) throw new PdfError("no_text", file.name);
  const pdf = await openPdf(await bytesOf(read));
  const pages = pdf.numPages;
  await closePdf(pdf);
  return { lang: guessLanguage(passages.map((p) => p.text).join(" ")) ?? "en", pages, passages };
}

// ── Voices

export class StudioDown extends Error {}

const wait = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

// A voice that says a segment and resolves when it's said (or stopped).
export interface Engine {
  readonly kind: "device" | "studio";
  say(seg: Segment, rate: number, onWord: (start: number, end: number) => void): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  ahead?(texts: string[]): void;
}

// Headings are read a little slower, as a person slows for a title.
const pace = (seg: Segment, rate: number) => rate * (seg.style === "heading" ? 0.9 : 1);

// The device's speech synthesis, made dependable:
//  - pause is a cancel, and resume says the rest from the last word heard:
//    Chrome on Android ignores pause(), and Chrome desktop can stall after it;
//  - a new utterance waits a moment after a cancel, which Chrome would
//    otherwise drop (switching voice mid-sentence did nothing);
//  - when a voice never reports the end of an utterance (it happens in
//    Chrome), a watchdog sees the engine has gone quiet and moves on.
export class DeviceEngine implements Engine {
  readonly kind = "device";
  private token = 0;
  private cancelledAt = 0;
  private cur: { seg: Segment; rate: number; onWord: (s: number, e: number) => void; done: () => void; from: number; heard: number } | null = null;
  private paused = false;
  constructor(private synth: SpeechSynthesis, private voice: SpeechSynthesisVoice | undefined, private lang: string) {}

  say(seg: Segment, rate: number, onWord: (s: number, e: number) => void) {
    return new Promise<void>((done) => {
      this.cur = { seg, rate, onWord, done, from: 0, heard: 0 };
      if (!this.paused) void this.speak(0);
    });
  }

  private async speak(from: number) {
    const cur = this.cur;
    if (!cur) return;
    const token = ++this.token;
    const since = performance.now() - this.cancelledAt;
    if (since < 120) await wait(120 - since);
    if (token !== this.token) return;
    const text = cur.seg.text.slice(from);
    if (!text.trim()) return this.finish(token);
    cur.from = from;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.voice?.lang ?? this.lang;
    if (this.voice) u.voice = this.voice;
    u.rate = pace(cur.seg, cur.rate);
    u.onboundary = (e) => {
      if (token !== this.token || e.name === "sentence") return;
      const start = from + e.charIndex;
      const len = e.charLength || (text.slice(e.charIndex).match(/^\S+/)?.[0].length ?? 0);
      cur.heard = start;
      if (cur.seg.at !== undefined) cur.onWord(cur.seg.at + start, cur.seg.at + start + len);
    };
    u.onend = () => this.finish(token);
    u.onerror = (e) => {
      // A cancel (pause, stop, a new voice) isn't the end of the segment.
      if (e.error !== "interrupted" && e.error !== "canceled") this.finish(token);
    };
    this.synth.speak(u);
    this.watch(token);
  }

  private watch(token: number) {
    if (typeof this.synth.speaking !== "boolean") return;
    const started = performance.now();
    const tick = () => {
      if (token !== this.token) return;
      if (!this.paused && performance.now() - started > 1500 && !this.synth.speaking && !this.synth.pending) return this.finish(token);
      setTimeout(tick, 700);
    };
    setTimeout(tick, 700);
  }

  private finish(token: number) {
    if (token !== this.token || !this.cur) return;
    const { done } = this.cur;
    this.cur = null;
    this.token++;
    done();
  }

  private cancel() {
    this.token++;
    this.cancelledAt = performance.now();
    this.synth.cancel();
  }

  pause() {
    this.paused = true;
    this.cancel();
  }
  resume() {
    this.paused = false;
    if (this.cur) void this.speak(this.cur.heard);
  }
  stop() {
    this.paused = false;
    const cur = this.cur;
    this.cur = null;
    this.cancel();
    cur?.done();
  }
}

// The studio voice: audio made on the server, a sentence or two at a time,
// the next few made while one plays. The words are marked as the audio
// plays, by how far through it is.
export class StudioEngine implements Engine {
  readonly kind = "studio";
  private audio: HTMLAudioElement;
  private made = new Map<string, Promise<Blob>>();
  private cur: { done: () => void; url: string } | null = null;
  constructor(private lang: string) {
    this.audio = new Audio();
    this.audio.preload = "auto";
  }

  private make(text: string): Promise<Blob> {
    let p = this.made.get(text);
    if (!p) {
      p = fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "speak", text, language: this.lang }) })
        .then(async (r) => {
          if (!r.ok || !(r.headers.get("Content-Type") ?? "").startsWith("audio/")) throw new StudioDown(`${r.status}`);
          return r.blob();
        })
        .catch((e) => {
          this.made.delete(text);
          throw e instanceof StudioDown ? e : new StudioDown(String(e));
        });
      this.made.set(text, p);
      // Kept for the segments around this one only.
      if (this.made.size > 24) this.made.delete(this.made.keys().next().value!);
    }
    return p;
  }

  ahead(texts: string[]) {
    for (const t of texts.slice(0, 3)) void this.make(t).catch(() => {});
  }

  async say(seg: Segment, rate: number, onWord: (s: number, e: number) => void) {
    const blob = await this.make(seg.text);
    const url = URL.createObjectURL(blob);
    const a = this.audio;
    await new Promise<void>((done, fail) => {
      this.cur = { done, url };
      a.src = url;
      a.playbackRate = pace(seg, rate);
      a.preservesPitch = true;
      a.ontimeupdate = () => {
        if (seg.at === undefined || !a.duration) return;
        const at = Math.floor((a.currentTime / a.duration) * seg.text.length);
        const start = seg.text.lastIndexOf(" ", at) + 1;
        const end = seg.text.indexOf(" ", at);
        onWord(seg.at + start, seg.at + (end < 0 ? seg.text.length : end));
      };
      a.onended = () => done();
      a.onerror = () => fail(new StudioDown("audio"));
      a.play().catch((e) => fail(e?.name === "NotAllowedError" ? e : new StudioDown(String(e))));
    }).finally(() => {
      URL.revokeObjectURL(url);
      this.cur = null;
    });
  }

  pause() {
    this.audio.pause();
  }
  resume() {
    void this.audio.play().catch(() => {});
  }
  stop() {
    this.audio.pause();
    const cur = this.cur;
    this.cur = null;
    cur?.done();
  }
}

// A soft two-note chime before a section, quiet under the voice.
let ctx: AudioContext | null = null;
export function chime() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    const t = ctx.currentTime;
    for (const [f, d] of [[659.25, 0], [987.77, 0.11]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(0.07, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.45);
      o.connect(g).connect(ctx.destination);
      o.start(t + d);
      o.stop(t + d + 0.5);
    }
  } catch {
    /* no Web Audio: no chime */
  }
}

// ── The narrator

export type Mode = "read" | "explain";

export type NarratorEvents = {
  // The passage being said and, when known, the word in it.
  onPosition: (passage: number, word?: [number, number]) => void;
  // A segment's text as it starts (shown as the caption in Explain).
  onSay?: (seg: Segment) => void;
  onEnd: () => void;
  // "studioDown": the device's voice took over; "explainDown": a section was read as written.
  onNotice: (kind: "studioDown" | "explainDown") => void;
  onWaiting?: (waiting: boolean) => void;
};

// The parts to play in turn. Read: one per passage (so skip goes by
// paragraph); Explain: one per section, its explanation fetched from the
// server AI ahead of time.
export type Plan = { units: number; unitOf: (passage: number) => number; firstPassage: (unit: number) => number; segments: (unit: number, opening: boolean) => Promise<Segment[]> };

export function readPlan(passages: Passage[], pages: number, cues: Cues): Plan {
  return {
    units: passages.length,
    unitOf: (p) => p,
    firstPassage: (u) => u,
    segments: async (u, opening) => [...(opening && u === 0 ? introScript(pages, passages, cues) : []), ...passageScript(passages, u, cues)],
  };
}

export function explainPlan(passages: Passage[], pages: number, cues: Cues, explain: (text: string, k: number) => Promise<string>, onFail: () => void): Plan {
  const list = chapters(passages);
  const ends = list.map((c, k) => list[k + 1]?.start ?? passages.length);
  const asked = new Map<number, Promise<string>>();
  const ask = (k: number) => {
    let p = asked.get(k);
    if (!p) {
      p = explain(sectionText(passages, list[k].start, ends[k]), k);
      p.catch(() => asked.delete(k));
      asked.set(k, p);
    }
    return p;
  };
  return {
    units: list.length,
    unitOf: (p) => {
      let k = 0;
      list.forEach((c, i) => c.start <= p && (k = i));
      return k;
    },
    firstPassage: (k) => list[k].start,
    segments: async (k) => {
      if (k + 1 < list.length) void ask(k + 1).catch(() => {});
      try {
        return explanationScript(await ask(k), list[k].start, k === 0);
      } catch {
        // The AI couldn't explain it: this section is read as written.
        onFail();
        const out: Segment[] = [];
        for (let i = list[k].start; i < ends[k]; i++) out.push(...passageScript(passages, i, cues));
        return out;
      }
    },
  };
}

export class Narrator {
  private token = 0;
  private paused = false;
  private wake: (() => void) | null = null;
  unit = 0;
  seg = 0;
  constructor(
    private plan: Plan,
    public engine: Engine,
    private o: { rate: number; chime: boolean; fallback: () => Engine },
    private ev: NarratorEvents,
  ) {}

  get isPaused() {
    return this.paused;
  }

  // Waits `ms`, longer while paused; false when stopped meanwhile.
  private async hold(ms: number, token: number) {
    const until = performance.now() + ms;
    while (token === this.token) {
      if (this.paused) await new Promise<void>((ok) => (this.wake = ok));
      else {
        const left = until - performance.now();
        if (left <= 0) return true;
        await wait(Math.min(left, 100));
      }
    }
    return false;
  }

  async play(unit: number, seg = 0) {
    const token = ++this.token;
    this.paused = false;
    this.engine.stop();
    const opening = unit === 0 && seg === 0;
    for (let u = unit; u < this.plan.units; u++) {
      this.unit = u;
      this.ev.onWaiting?.(true);
      const segs = await this.plan.segments(u, opening && u === 0);
      this.ev.onWaiting?.(false);
      if (token !== this.token) return;
      for (let k = u === unit ? seg : 0; k < segs.length; k++) {
        this.seg = k;
        const s = segs[k];
        this.ev.onPosition(s.passage);
        this.ev.onSay?.(s);
        if (s.chime && this.o.chime) chime();
        if (!(await this.hold(s.before + (s.chime && this.o.chime ? 350 : 0), token))) return;
        this.engine.ahead?.(segs.slice(k + 1, k + 4).map((x) => x.text));
        try {
          await this.engine.say(s, this.o.rate, (a, b) => token === this.token && this.ev.onPosition(s.passage, [a, b]));
        } catch (e) {
          if (token !== this.token) return;
          if (e instanceof StudioDown) {
            this.engine = this.o.fallback();
            this.ev.onNotice("studioDown");
            k--;
            continue;
          }
          throw e;
        }
        if (token !== this.token) return;
        if (!(await this.hold(s.after, token))) return;
      }
    }
    if (token === this.token) this.ev.onEnd();
  }

  pause() {
    this.paused = true;
    this.engine.pause();
  }
  resume() {
    this.paused = false;
    this.engine.resume();
    this.wake?.();
    this.wake = null;
  }
  stop() {
    this.token++;
    this.paused = false;
    this.wake?.();
    this.wake = null;
    this.engine.stop();
  }
  // A new speed or voice: the sentence being said starts again with it.
  restart(o: { rate?: number; engine?: Engine } = {}) {
    if (o.rate) this.o.rate = o.rate;
    if (o.engine) {
      this.engine.stop();
      this.engine = o.engine;
    }
    void this.play(this.unit, this.seg);
  }
}
