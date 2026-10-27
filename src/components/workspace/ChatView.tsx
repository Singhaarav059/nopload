"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronLeft, ChevronRight, Loader2, RotateCcw, Square } from "lucide-react";
import { useI18n } from "../I18n";
import { PdfThumb } from "../PdfThumb";
import { AiNotice } from "./AiNotice";
import { Options } from "./Options";
import type { Answer, DocIndex, Message } from "@/lib/ai/chat";
import type { OptionDef } from "@/lib/tools";

// A question and how it went: its answer, or that the server AI didn't
// answer (cloudDown), this visitor reached its fair-use limit (limited), or
// it failed.
type Turn = { q: string; a?: Answer; cloudDown?: boolean; limited?: "minute" | "day"; failed?: boolean };

// Loads the chat code ahead of use (src/lib/offline.ts).
export const prepareChat = () => import("@/lib/ai/chat");

// Questions about one PDF, answered from its own text by the server AI, each
// answer citing its pages; a citation shows that page beside the chat
// (src/lib/ai/chat.ts). Where this copy of the site has no server AI, the
// chat says so and takes no questions.
export function ChatView({ file, options, defs, onOption, onError }: {
  file: File;
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
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const stop = useRef<AbortController | null>(null);
  // Whether this copy of the site has the server AI.
  const [here, setHere] = useState<boolean | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const failed = useRef(onError);
  useEffect(() => {
    failed.current = onError;
  });
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
        return { ix: c.buildIndex(pages), note };
      })
      .then(({ ix, note }) => live && setBuilt({ lang: ocrLang, ix, note }), (e) => live && failed.current(e));
    return () => {
      live = false;
    };
  }, [file, ocrLang]);

  useEffect(() => {
    let live = true;
    import("@/lib/ai/cloud").then((c) => c.cloudAvailable()).then((ok) => live && setHere(ok));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [turns]);

  // Asks `question`, as a new turn or again in place of turn `at`.
  const ask = async (question: string, at = turns.length) => {
    if (!question || !index || busy) return;
    const update = (u: Partial<Turn>) => setTurns((list) => list.map((x, i) => (i === at ? { q: question, ...u } : x)));
    setTurns((list) => (at < list.length ? list.map((x, i) => (i === at ? { q: question } : x)) : [...list, { q: question }]));
    const ctl = new AbortController();
    stop.current = ctl;
    setBusy(true);
    try {
      const [c, { CloudLimited, CloudUnavailable }] = await Promise.all([import("@/lib/ai/chat"), import("@/lib/ai/cloud")]);
      const history: Message[] = turns.slice(0, at).flatMap((x) => (x.a ? [{ role: "user" as const, content: x.q }, { role: "assistant" as const, content: x.a.parts.map((p) => p.text).join(" ") }] : []));
      try {
        const a = await c.askCloud(index, question, { history, signal: ctl.signal, onPartial: (p) => update({ a: p }) });
        update({ a });
        if (a.pages[0]) setPage(a.pages[0]);
      } catch (err) {
        if (!(err instanceof CloudUnavailable)) throw err;
        console.warn("The server AI didn't answer.", err);
        update(err instanceof CloudLimited ? { limited: err.limit } : { cloudDown: true });
      }
    } catch (err) {
      // Stopped by the visitor: the request's AbortError.
      if (!ctl.signal.aborted) {
        console.warn("Answering failed.", err);
        update({ failed: true });
      }
    } finally {
      setBusy(false);
      stop.current = null;
    }
  };

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
          {index && !turns.length && here !== false && <p className="text-[15px] text-muted">{t("chat.empty", { n: pages })}</p>}
          {here === false && <p className="rounded-xl border border-line bg-surface p-4 text-[15px]" data-ai-unavailable>{t("ai.unavailable")}</p>}
          {note && <p className="text-[13px] text-muted" data-ocr-note={note}>{t(`res.${note}`)}</p>}
          {turns.map((x, i) => (
            <div key={i} className="space-y-2">
              <p className="ms-auto w-fit max-w-[85%] rounded-xl bg-[color-mix(in_oklab,var(--brand)_10%,var(--surface))] px-3.5 py-2 text-[15px]">{x.q}</p>
              <div className="max-w-[92%] text-[15px] leading-relaxed" data-answer={(x.a || x.cloudDown || x.limited || x.failed) && !(busy && i === turns.length - 1) ? "done" : "pending"}>
                {x.limited ? (
                  <div className="space-y-2" data-limited={x.limited}>
                    <p className="text-ink-2">{t(x.limited === "minute" ? "chat.limitMinute" : "chat.limitDay")}</p>
                    {x.limited === "minute" && (
                      <button className="btn btn-quiet btn-sm" onClick={() => void ask(x.q, i)} disabled={busy}><RotateCcw size={14} /> {t("chat.retry")}</button>
                    )}
                  </div>
                ) : x.cloudDown ? (
                  <div className="flex flex-wrap items-center gap-2" data-cloud-down>
                    <p className="text-ink-2">{t("chat.cloudDown")}</p>
                    <button className="btn btn-quiet btn-sm" onClick={() => void ask(x.q, i)} disabled={busy}><RotateCcw size={14} /> {t("chat.retry")}</button>
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
                {x.a && x.a.parts.length > 0 && !(busy && i === turns.length - 1) ? <p className="mt-1 text-[12px] text-muted" data-answered-by="cloud">{t("chat.by.server")}</p> : null}
              </div>
            </div>
          ))}
        </div>
        <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); const question = q.trim(); if (question && index && !busy) { setQ(""); void ask(question); } }}>
          <label className="sr-only" htmlFor="chat-q">{t("chat.ask")}</label>
          <input id="chat-q" className="field h-11 flex-1 text-[15px]" placeholder={t("chat.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} disabled={!index || here === false} autoComplete="off" />
          {busy ? (
            <button type="button" className="btn btn-quiet" onClick={() => stop.current?.abort()} aria-label={t("chat.stop")}>
              <Square size={16} />
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!index || here === false || !q.trim()} aria-label={t("chat.send")}><ArrowUp size={18} /></button>
          )}
        </form>
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
          <AiNotice task="chat" />
        </div>
      </aside>
    </div>
  );
}
