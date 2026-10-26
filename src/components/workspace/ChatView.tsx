"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronLeft, ChevronRight, Cloud, Download, Loader2, RotateCcw, Square } from "lucide-react";
import { useI18n } from "../I18n";
import { PdfThumb } from "../PdfThumb";
import { AiModels, prepareAi } from "./AiModels";
import { Options } from "./Options";
import type { Answer, DocIndex, Message } from "@/lib/ai/chat";
import type { OptionDef } from "@/lib/tools";

// A question and how it went: an answer and who wrote it, or that no AI is
// turned on (needsAi), the cloud AI didn't answer (cloudDown) or this visitor
// reached its fair-use limit (limited), or it failed.
type Turn = { q: string; a?: Answer; by?: "model" | "cloud"; cloudFailed?: boolean; failed?: boolean; needsAi?: boolean; cloudDown?: boolean; limited?: "minute" | "day" };

// Loads the chat code and the AI worker ahead of use (src/lib/offline.ts).
export const prepareChat = () => Promise.all([import("@/lib/ai/chat"), prepareAi()]);

// Questions about one PDF, answered from its own text by a language model,
// each answer citing its pages; a citation shows that page beside the chat
// (src/lib/ai/chat.ts). The light model, when it's on the device, finds the
// passages by meaning too. Without a model to write, nothing is answered:
// the chat offers the cloud AI or a download instead of showing passages.
export function ChatView({ file, models, options, defs, onOption, onError }: {
  file: File;
  models: string[];
  options: Record<string, unknown>;
  defs: OptionDef[];
  onOption: (key: string, value: unknown) => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useI18n();
  // The index of the file as read with these OCR options; others read it again.
  const [built, setBuilt] = useState<{ lang: string; ix: DocIndex; note?: string } | null>(null);
  const [reading, setReading] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<null | "loading" | "answering">(null);
  const [page, setPage] = useState(1);
  const stop = useRef<AbortController | null>(null);
  // What this device can turn on: the cloud AI, and a model to download.
  const [can, setCan] = useState<{ cloud: boolean; device: boolean } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const failed = useRef(onError);
  useEffect(() => {
    failed.current = onError;
  });
  const aiModel = String(options.aiModel ?? "");
  const ocrLang = `${options.ocr ?? "auto"}:${options.ocrLang ?? "eng"}`;
  const index = built?.lang === ocrLang ? built.ix : null;
  const note = built?.lang === ocrLang ? built.note : undefined;

  // Read and index the file once (again if the OCR language changes).
  useEffect(() => {
    let live = true;
    const [ocr, langs] = ocrLang.split(":");
    import("@/lib/ai/chat")
      .then(async (c) => {
        const { pages, note } = await c.readDocument(file, { ocr, ocrLang: langs }, (d, total) => live && setReading(total ? d / total : 0));
        if (!pages.some((p) => p.text.trim())) throw new (await import("@/lib/pdf/errors")).PdfError("no_text", file.name);
        return { ix: await c.buildIndex(pages), note };
      })
      .then(({ ix, note }) => live && setBuilt({ lang: ocrLang, ix, note }), (e) => live && failed.current(e));
    return () => {
      live = false;
    };
  }, [file, ocrLang]);

  useEffect(() => {
    let live = true;
    Promise.all([import("@/lib/ai/cloud"), import("@/lib/ai/engine")]).then(async ([c, e]) => {
      const [cloud, s] = await Promise.all([c.cloudAvailable(), e.status().catch(() => null)]);
      if (live) setCan({ cloud, device: !!s && e.deviceCanRunModels(s) && !e.isPhone() });
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [turns]);

  // A model that writes is in use: the cloud AI, or Small or Large on this device.
  const ready = (model: string) => model === "cloud" || model === "small" || model === "large";

  // Asks `question`, as a new turn or again in place of turn `at`, with
  // `model` when it was just chosen (the option updates a render later).
  const ask = async (question: string, at = turns.length, model = aiModel) => {
    if (!question || !index || busy) return;
    const update = (u: Partial<Turn>) => setTurns((list) => list.map((x, i) => (i === at ? { q: question, ...u } : x)));
    setTurns((list) => (at < list.length ? list.map((x, i) => (i === at ? { q: question } : x)) : [...list, { q: question }]));
    if (!ready(model)) return update({ needsAi: true });
    const ctl = new AbortController();
    stop.current = ctl;
    try {
      const [c, e] = await Promise.all([import("@/lib/ai/chat"), import("@/lib/ai/engine")]);
      // No worker (it failed to start): keywords only.
      const s = await e.status().catch(() => null);
      // Embeddings whenever the light model is on the device and runs;
      // keywords otherwise.
      let ix = index;
      let embed = s?.stored.light ? e.embed : undefined;
      if (embed && !ix.vectors) {
        setBusy("loading");
        try {
          ix = await c.buildIndex(index.pages, embed);
          setBuilt({ lang: ocrLang, ix, note });
        } catch (err) {
          console.warn("The light model didn't run; finding passages by keywords.", err);
          embed = undefined;
        }
      }
      let a: Answer | undefined;
      let by: Turn["by"];
      let cloudFailed = false;
      const history: Message[] = turns.slice(0, at).flatMap((x) => (x.a ? [{ role: "user" as const, content: x.q }, { role: "assistant" as const, content: x.a.parts.map((p) => p.text).join(" ") }] : []));
      // A model on this device that can answer when the cloud doesn't.
      const local = model === "small" || model === "large" ? model : (["large", "small"] as const).find((m) => s?.stored[m]);
      if (model === "cloud") {
        setBusy("answering");
        try {
          a = await c.askCloud(ix, question, { embed, history, signal: ctl.signal, onPartial: (p) => update({ a: p }) });
          by = "cloud";
        } catch (err) {
          const { CloudLimited, CloudUnavailable } = await import("@/lib/ai/cloud");
          if (!(err instanceof CloudUnavailable)) throw err;
          console.warn("The cloud AI didn't answer.", err);
          // A model on the device answers instead, without a word; else the visitor is told why.
          if (!local) return update(err instanceof CloudLimited ? { limited: err.limit } : { cloudDown: true });
          cloudFailed = true;
          update({ a: undefined });
        }
      }
      if (!a && local && s?.stored[local]) {
        try {
          setBusy("loading");
          await e.loadModel(local);
          setBusy("answering");
          a = await c.askModel(ix, question, { generate: e.generator(local), embed, history, signal: ctl.signal, onPartial: (p) => update({ a: p }) });
        } catch (err) {
          // The model didn't run here: offer server AI from now on.
          if (!(err instanceof e.Aborted) && !ctl.signal.aborted) e.markDeviceFailed();
          throw err;
        }
        by = "model";
      }
      if (!a) return update({ needsAi: true });
      update({ a, by, cloudFailed });
      if (a.pages[0]) setPage(a.pages[0]);
    } catch (err) {
      const { Aborted } = await import("@/lib/ai/engine");
      // Stopped by the visitor: the model's Aborted, or the cloud request's AbortError.
      if (!(err instanceof Aborted) && !ctl.signal.aborted) {
        console.warn("Answering failed.", err);
        update({ failed: true });
      }
    } finally {
      setBusy(null);
      stop.current = null;
    }
  };

  // The cloud AI, chosen from the chat: remembered, and the question asked again.
  const chooseCloud = async (again?: { q: string; at: number }) => {
    (await import("@/lib/ai/engine")).chooseModel("cloud");
    onOption("aiModel", "cloud");
    if (again) void ask(again.q, again.at, "cloud");
  };
  // The model list, in the panel beside the chat.
  const showModels = () => {
    const panel = document.querySelector<HTMLElement>("[data-ai-models]");
    panel?.scrollIntoView({ behavior: "smooth", block: "center" });
    panel?.querySelector<HTMLElement>("[data-ai-choice='device'], li button")?.focus({ preventScroll: true });
  };

  // What to do when no AI is turned on: the cloud AI, a download, or neither here.
  const turnOn = (again?: { q: string; at: number }) => (
    <div className="rounded-xl border border-line bg-surface p-4" data-needs-ai>
      <p className="text-[15px] font-medium">{t("chat.needsAi")}</p>
      {can?.cloud && (
        <div className="mt-3">
          <button className="btn btn-primary btn-sm" onClick={() => void chooseCloud(again)} data-use-cloud><Cloud size={15} /> {t("chat.needsAi.cloud")}</button>
          <p className="mt-1.5 text-[13px] text-muted">{t("chat.needsAi.cloudDesc")}</p>
        </div>
      )}
      {can?.device && (
        <div className="mt-3">
          <button className="btn btn-quiet btn-sm" onClick={showModels}><Download size={15} /> {t("chat.needsAi.device")}</button>
          <p className="mt-1.5 text-[13px] text-muted">{t("chat.needsAi.deviceDesc")}</p>
        </div>
      )}
      {can && !can.cloud && !can.device && <p className="mt-1.5 text-[13px] text-muted">{t("chat.needsAi.none")}</p>}
    </div>
  );

  const pages = index?.pages.length ?? 0;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section aria-label={t("chat.title")} className="card flex min-h-[420px] min-w-0 flex-col">
        <div ref={log} className="flex-1 space-y-5 overflow-auto p-5" aria-live="polite" data-chat-log>
          {!index && (
            <div className="flex items-center gap-2 text-[14px] text-muted">
              <Loader2 size={16} className="animate-spin" /> {t("chat.reading", { pct: Math.round(reading * 100) })}
            </div>
          )}
          {index && !turns.length && <p className="text-[15px] text-muted">{t("chat.empty", { n: pages })}</p>}
          {index && !turns.length && can && !ready(aiModel) && turnOn()}
          {note && <p className="text-[13px] text-muted" data-ocr-note={note}>{t(`res.${note}`)}</p>}
          {turns.map((x, i) => (
            <div key={i} className="space-y-2">
              <p className="ms-auto w-fit max-w-[85%] rounded-xl bg-[color-mix(in_oklab,var(--brand)_10%,var(--surface))] px-3.5 py-2 text-[15px]">{x.q}</p>
              <div className="max-w-[92%] text-[15px] leading-relaxed" data-answer={(x.a || x.needsAi || x.cloudDown || x.limited || x.failed) && !(busy && i === turns.length - 1) ? "done" : "pending"}>
                {x.needsAi ? (
                  turnOn({ q: x.q, at: i })
                ) : x.limited ? (
                  <div className="space-y-2" data-limited={x.limited}>
                    <p className="text-ink-2">{t(x.limited === "minute" ? "chat.limitMinute" : "chat.limitDay")}</p>
                    {x.limited === "minute" ? (
                      <button className="btn btn-quiet btn-sm" onClick={() => void ask(x.q, i)} disabled={!!busy}><RotateCcw size={14} /> {t("chat.retry")}</button>
                    ) : can?.device ? (
                      <button className="btn btn-quiet btn-sm" onClick={showModels}><Download size={15} /> {t("chat.needsAi.device")}</button>
                    ) : null}
                  </div>
                ) : x.cloudDown ? (
                  <div className="flex flex-wrap items-center gap-2" data-cloud-down>
                    <p className="text-ink-2">{t("chat.cloudDown")}</p>
                    <button className="btn btn-quiet btn-sm" onClick={() => void ask(x.q, i)} disabled={!!busy}><RotateCcw size={14} /> {t("chat.retry")}</button>
                  </div>
                ) : x.failed ? (
                  <p className="text-danger">{t("chat.failed")}</p>
                ) : x.a && x.a.parts.length ? (
                  <p>
                    {x.a.parts.map((p, k) => (
                      <span key={k}>
                        {k > 0 && !/^[.,;:!?)]/.test(p.text) && " "}
                        {p.text}
                        {p.pages?.map((n) => (
                          <button key={n} data-citation={n} onClick={() => setPage(n)} aria-label={t("chat.showPage", { n })}
                            className="mx-0.5 rounded border border-line px-1 align-baseline text-[12px] font-medium text-ink-2 hover:border-line-strong hover:text-ink">
                            {t("chat.pageShort", { n })}
                          </button>
                        ))}
                      </span>
                    ))}
                  </p>
                ) : x.a ? (
                  <p className="text-muted">{t("chat.notFound")}</p>
                ) : (
                  <Loader2 size={16} className="animate-spin text-muted" />
                )}
                {x.by && x.a?.parts.length ? <p className="mt-1 text-[12px] text-muted" data-answered-by={x.by}>{x.cloudFailed && <>{t("chat.cloudFailed")} </>}{t(x.by === "cloud" ? "chat.by.server" : "chat.by.model")}</p> : null}
              </div>
            </div>
          ))}
        </div>
        <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); const question = q.trim(); if (question && index && !busy) { setQ(""); void ask(question); } }}>
          <label className="sr-only" htmlFor="chat-q">{t("chat.ask")}</label>
          <input id="chat-q" className="field h-11 flex-1 text-[15px]" placeholder={t("chat.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} disabled={!index} autoComplete="off" />
          {busy ? (
            <button type="button" className="btn btn-quiet" onClick={() => stop.current?.abort()} aria-label={t("chat.stop")}>
              {busy === "loading" ? <Loader2 size={18} className="animate-spin" /> : <Square size={16} />}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!index || !q.trim()} aria-label={t("chat.send")}><ArrowUp size={18} /></button>
          )}
        </form>
        {busy === "loading" && <p className="px-4 pb-3 text-[13px] text-muted">{t("chat.loadingModel")}</p>}
      </section>
      <aside className="space-y-4">
        <div className="card p-4" data-chat-page={page}>
          <div className="mb-3 flex items-center justify-between text-[13px] text-ink-2">
            <button className="btn btn-quiet btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t("chat.prevPage")}><ChevronLeft size={16} className="rtl:rotate-180" /></button>
            <span className="tabular">{pages ? t("chat.pageOf", { n: page, total: pages }) : ""}</span>
            <button className="btn btn-quiet btn-sm" disabled={!pages || page >= pages} onClick={() => setPage((p) => p + 1)} aria-label={t("chat.nextPage")}><ChevronRight size={16} className="rtl:rotate-180" /></button>
          </div>
          <PdfThumb key={page} file={file} page={page - 1} width={300} className="mx-auto rounded-sm border border-line" alt={t("chat.pageOf", { n: page, total: pages })} />
        </div>
        <div className="card p-5">
          <Options defs={defs} values={options} onChange={onOption} />
          <AiModels task="chat" models={models} value={aiModel} onChange={(v) => onOption("aiModel", v)} />
        </div>
      </aside>
    </div>
  );
}
