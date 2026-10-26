"use client";

// The on-device AI, from the page's side. (The cloud AI, the default where
// this site has it, is ./cloud.ts.) Engines on the device, best first:
//  1. the browser's built-in AI (Chrome's Translator and Summarizer), when
//     its model is already on the device;
//  2. a language model from this site, run with WebGPU (CPU otherwise):
//     "small" (SmolLM2-360M, English) or "large" (Qwen3-0.6B, many languages);
//  3. "light": a 23 MB embedding model that finds the sentences that answer,
//     on any device.
// Models are only downloaded when the visitor asks (./store.ts), and run in
// a worker (./worker.ts).

import { AI_MODELS } from "../vendor";
import { CLOUD } from "./cloud";
import { MODEL_IDS, sizeOf, type ModelId } from "./store";
import type { Embed, Generate } from "./chat";

export { MODEL_IDS, sizeOf, type ModelId };

// Models this build of the site serves (NOPLOAD_AI_MODELS, scripts/vendor.mjs).
export const servedModels = () => MODEL_IDS.filter((m) => AI_MODELS.includes(m));

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onEvent?: (e: never) => void; settle: () => void; alive: () => void };
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

export class Aborted extends Error {}
// The worker failed (its script didn't load, it crashed, or a call went
// quiet for too long): every call waiting on it is rejected with this, the
// worker is dropped, and the next call starts a fresh one.
export class EngineFailed extends Error {}

// How long a call may go without an answer or a sign of progress before the
// worker is taken to be stuck. A download or an answer reports progress as
// it goes, so only real silence counts.
// Loading a model or embedding a long document can take minutes on a slow
// device without saying anything; a status check never should.
const QUIET: Record<string, number> = { status: 20_000, remove: 30_000, load: 300_000, prepare: 300_000, embed: 300_000 };
const QUIET_DEFAULT = 180_000;

function fail(err: Error) {
  const w = worker;
  worker = null;
  w?.terminate();
  const waiting = [...pending.values()];
  pending.clear();
  for (const p of waiting) {
    p.settle();
    p.reject(err);
  }
}

function start(): Worker {
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.addEventListener("message", (e: MessageEvent<{ id: number; result?: unknown; error?: string; aborted?: boolean; event?: never }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    p.alive();
    if (e.data.event !== undefined) return p.onEvent?.(e.data.event);
    pending.delete(e.data.id);
    p.settle();
    if (e.data.error !== undefined) p.reject(e.data.aborted ? new Aborted(e.data.error) : new Error(e.data.error));
    else p.resolve(e.data.result);
  });
  w.addEventListener("error", (e) => {
    e.preventDefault();
    if (worker === w) fail(new EngineFailed(e.message || "The AI engine stopped."));
  });
  w.addEventListener("messageerror", () => {
    if (worker === w) fail(new EngineFailed("The AI engine sent something unreadable."));
  });
  return w;
}

function call<T>(type: string, payload: object = {}, onEvent?: (e: never) => void, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Aborted("Stopped."));
  worker ??= start();
  const w = worker;
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const alive = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (pending.has(id) && worker === w) fail(new EngineFailed(`The AI engine didn't answer (${type}).`));
      }, QUIET[type] ?? QUIET_DEFAULT);
    };
    const onAbort = () => worker === w && w.postMessage({ id: ++seq, type: "abort", target: id });
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onEvent, settle, alive });
    signal?.addEventListener("abort", onAbort, { once: true });
    alive();
    w.postMessage({ id, type, ...payload });
  });
}

export type Status = { stored: Record<ModelId, boolean>; webgpu: boolean; f16: boolean; software: boolean };
export const status = () => call<Status>("status");

export const download = (id: ModelId, progress: (done: number, total: number) => void, signal?: AbortSignal) =>
  call<true>("download", { model: id }, ((e: { done: number; total: number }) => progress(e.done, e.total)) as (e: never) => void, signal);

export const removeModel = (id: ModelId) => call<true>("remove", { model: id });

// Loads the runtime the models run on, so it works offline too (7.8 MB, from /vendor).
export const prepareRuntime = () => call<true>("prepare");

// Loads a language model ahead of the first question; says where it runs.
export const loadModel = (id: ModelId) => call<"webgpu" | "wasm">("load", { model: id });

export const embed: Embed = (texts) => call<number[][]>("embed", { texts });

export const generator = (id: ModelId): Generate => (messages, o) =>
  call<string>("generate", { model: id, messages, maxNewTokens: o.maxNewTokens }, ((e: { text: string }) => o.onText?.(e.text)) as (e: never) => void, o.signal);

// The browser's built-in Translator, when it can translate this pair without downloading anything.
type BuiltinTranslator = { translate(text: string): Promise<string>; destroy?(): void };
type TranslatorApi = { availability(o: object): Promise<string>; create(o: object): Promise<BuiltinTranslator> };
export async function builtinTranslator(from: string, to: string): Promise<BuiltinTranslator | null> {
  const api = (globalThis as unknown as { Translator?: TranslatorApi }).Translator;
  if (!api) return null;
  try {
    const o = { sourceLanguage: from, targetLanguage: to };
    return (await api.availability(o)) === "available" ? await api.create(o) : null;
  } catch {
    return null;
  }
}

// Which model a feature uses: the visitor's choice ("cloud" or a model on
// the device) when it's there, else the cloud AI when this site has it,
// else the largest model on the device.
const PICK = "nopload-ai-model";
// "device": on-device AI, with no model picked.
export type Choice = ModelId | typeof CLOUD | "device";
export function chosenModel(): Choice | null {
  try {
    const v = localStorage.getItem(PICK);
    return v === CLOUD || v === "device" ? v : v && (MODEL_IDS as string[]).includes(v) ? (v as ModelId) : null;
  } catch {
    return null;
  }
}
export function chooseModel(id: Choice) {
  try {
    localStorage.setItem(PICK, id);
  } catch {
    /* private mode: the choice lasts this visit */
  }
}

// Phones and tablets: they get server AI and are never offered model
// downloads, which are too large for them. iPads report a Mac user agent,
// but have touch.
export function isPhone(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return !!nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

// Whether this device can run the language models well: a real graphics
// chip with WebGPU and 16-bit floats, on a computer rather than a phone or
// tablet, with enough memory and cores where the browser says (Chrome
// reports memory up to 8 GB), and no model that failed to run here before.
// Such devices use on-device AI only; the others are offered server AI.
const FAILED = "nopload-ai-device-failed";
export function deviceCanRunModels(s: Status): boolean {
  try {
    // Tests pick either answer.
    const forced = localStorage.getItem("nopload-ai-device");
    if (forced === "capable" || forced === "weak") return forced === "capable";
    if (localStorage.getItem(FAILED)) return false;
  } catch {
    /* no storage: judge by the device */
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (isPhone() || !s.webgpu || !s.f16 || s.software) return false;
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 8) return false;
  return !(nav.hardwareConcurrency && nav.hardwareConcurrency < 4);
}

// A model failed to load or run on a device that seemed able: from now on
// it's offered server AI. The AI panel listens for the event.
export function markDeviceFailed() {
  try {
    localStorage.setItem(FAILED, "1");
  } catch {
    /* the panel still updates for this visit */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("nopload:ai-device-failed"));
}
