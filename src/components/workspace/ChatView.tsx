"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronLeft, ChevronRight, Copy, FileText, RotateCcw, Square } from "lucide-react";
import { useI18n } from "../I18n";
import { PdfThumb } from "../PdfThumb";
import { AiNotice } from "./AiNotice";
import { Options } from "./Options";
import { Blocks, Inline } from "./AnswerBlocks";
import { LoadingOrb, Typing } from "../LoadingOrb";
import { Mascot } from "../Logo";
import { humanSize } from "@/lib/pdf/common";
import type { Answer, DocIndex, Message } from "@/lib/ai/chat";
import type { OptionDef } from "@/lib/tools";

// A question and how it went: its answer, or that the server AI didn't
// answer (cloudDown), this visitor reached its fair-use limit (limited), or
// it failed.
type Turn = { q: string; a?: Answer; cloudDown?: boolean; limited?: "minute" | "day"; failed?: boolean };

// Questions to start with (two rows of three).
const SUGGEST = ["chat.q.about", "chat.q.points", "chat.q.figures", "chat.q.dates", "chat.q.actions", "chat.q.simple"] as const;

// Loads the chat code ahead of use (src/lib/offline.ts).
export const prepareChat = () => import("@/lib/ai/chat");

// Questions about one PDF, answered from its own text by the server AI, each
// answer citing its pages; a citation shows that page beside the chat
// (src/lib/ai/chat.ts). Where this copy of the site has no server AI, the
// chat says so and takes no questions.
export function ChatView({ file, options, defs, onOption, onError, onClose }: {
  file: File;
  options: Record<string, unknown>;
  defs: OptionDef[];
  onOption: (key: string, value: unknown) => void;
  onError: (e: unknown) => void;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  // The index of the file as read with these OCR options; others read it again.
  const [built, setBuilt] = useState<{ lang: string; ix: DocIndex; note?: string } | null>(null);
  const [reading, setReading] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState<number | null>(null);
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

  const box = useRef<HTMLElement>(null);
  // With the file in, the chat takes the screen: its top under the header.
  const layout = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = layout.current;
    if (!el) return;
    const y = el.getBoundingClientRect().top + scrollY - 76;
    if (Math.abs(scrollY - y) > 40) scrollTo({ top: y, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);
  // A new question goes to the top of the chat, its answer filling in below
  // it; the chat itself is kept in view, its box at the bottom.
  useEffect(() => {
    const el = log.current?.querySelector<HTMLElement>(`[data-turn="${turns.length - 1}"]`);
    if (el && log.current) log.current.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
    const r = box.current?.getBoundingClientRect();
    const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tabbar-h")) || 0;
    if (turns.length && r && (r.bottom > innerHeight - bar || r.top < 0)) box.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length]);

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
      const history: Message[] = turns.slice(0, at).flatMap((x) => (x.a ? [{ role: "user" as const, content: x.q }, { role: "assistant" as const, content: x.a.text ?? x.a.parts.map((p) => p.text).join(" ") }] : []));
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
  const copy = (x: Turn, i: number) => {
    if (!x.a) return;
    void navigator.clipboard?.writeText(x.a.text ?? x.a.parts.map((p) => p.text).join(" ")).then(() => {
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1600);
    });
  };
  return (
    <div ref={layout} className="chat-layout">
      {/* One surface: the file at its top, the conversation, the question box.
          As tall as the screen, never taller: questions and answers scroll
          inside it, the question box stays at its bottom. */}
      <section ref={box} aria-label={t("chat.title")} data-chat
        style={{ scrollMarginBottom: "calc(var(--tabbar-h, 0px) + 16px)" }}
        className="chat-card h-[calc(100dvh-var(--tabbar-h,0px)-104px)] max-h-[900px] min-h-[460px] lg:sticky lg:top-20">
        <header className="chat-file">
          <span className="chat-file-icon"><FileText size={16} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{file.name}</span>
            <span className="block text-[12px] text-muted tabular">{pages ? `${t("ws.pages", { n: pages })} · ` : ""}{humanSize(file.size)}</span>
          </span>
          {onClose && <button type="button" className="chat-ghost" onClick={onClose}><RotateCcw size={14} /> {t("res.startOver")}</button>}
        </header>
        <div ref={log} className="relative min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6" aria-live="polite" data-chat-log>
          {!index && (
            <div className="grid min-h-full place-items-center py-10">
              <LoadingOrb small value={reading} label={t("chat.reading", { pct: Math.round(reading * 100) })} />
            </div>
          )}
          {index && !turns.length && here !== false && (
            <div className="flex min-h-full flex-col">
              <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6 text-center">
                <span className="chat-hello"><Mascot size={44} /></span>
                <p className="blur-in max-w-[30ch] text-pretty text-[17px] leading-snug tracking-[-0.01em] text-ink">{t("chat.empty", { n: pages })}</p>
              </div>
              {/* Questions to start with, drifting past in two rows; each row is
                  there twice so it loops, the copy hidden from screen readers. */}
              <div role="group" aria-label={t("chat.try")} className="drift pb-1">
                {[SUGGEST.slice(0, 3), SUGGEST.slice(3)].map((row, r) => (
                  <div key={r} className="drift-row">
                    {[...row, ...row].map((k, j) => (
                      <button key={j} type="button" data-suggestion={j < row.length || undefined} aria-hidden={j >= row.length || undefined} tabIndex={j >= row.length ? -1 : undefined}
                        className="chip" disabled={busy || here === null} onClick={() => void ask(t(k))}>{t(k)}</button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {here === false && <p className="rounded-xl border border-line bg-surface p-4 text-[15px]" data-ai-unavailable>{t("ai.unavailable")}</p>}
          {note && <p className="text-[13px] text-muted" data-ocr-note={note}>{t(`res.${note}`)}</p>}
          {turns.map((x, i) => {
            const writing = busy && i === turns.length - 1;
            return (
              <div key={i} className={`space-y-4 ${i === turns.length - 1 ? "min-h-[calc(100%-1rem)]" : ""}`} data-turn={i}>
                <p className="chat-q blur-in">{x.q}</p>
                <div className="flex gap-3">
                  <span aria-hidden className={`chat-avatar ${writing ? "is-writing" : ""}`}><Mascot size={18} /></span>
                  <div className="min-w-0 flex-1 pt-0.5 text-[15.5px] leading-[1.65] text-ink [overflow-wrap:anywhere]" data-answer={(x.a || x.cloudDown || x.limited || x.failed) && !writing ? "done" : "pending"}>
                    {x.limited ? (
                      <div className="space-y-2" data-limited={x.limited}>
                        <p className="text-ink-2">{t(x.limited === "minute" ? "chat.limitMinute" : "chat.limitDay")}</p>
                        {x.limited === "minute" && (
                          <button className="chat-ghost" onClick={() => void ask(x.q, i)} disabled={busy}><RotateCcw size={14} /> {t("chat.retry")}</button>
                        )}
                      </div>
                    ) : x.cloudDown ? (
                      <div className="flex flex-wrap items-center gap-2" data-cloud-down>
                        <p className="text-ink-2">{t("chat.cloudDown")}</p>
                        <button className="chat-ghost" onClick={() => void ask(x.q, i)} disabled={busy}><RotateCcw size={14} /> {t("chat.retry")}</button>
                      </div>
                    ) : x.failed ? (
                      <p className="text-danger">{t("chat.failed")}</p>
                    ) : x.a && x.a.parts.length ? (
                      x.a.blocks?.length ? <Blocks blocks={x.a.blocks} onPage={setPage} /> : <p><Inline parts={x.a.parts} onPage={setPage} /></p>
                    ) : x.a ? (
                      <p className="text-muted">{t("chat.notFound")}</p>
                    ) : (
                      <Typing />
                    )}
                    {x.a && x.a.parts.length > 0 && !writing ? (
                      <div className="chat-meta blur-in">
                        <button type="button" className="chat-ghost" onClick={() => copy(x, i)}>
                          {copied === i ? <Check size={14} /> : <Copy size={14} />} {t(copied === i ? "res.copied" : "res.copy")}
                        </button>
                        <p className="text-[12px] leading-snug text-muted" data-answered-by="cloud">{t("chat.by.server")}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {/* The question box: a soft well, lit in orange while typing; the send
            button turns orange once there's something to send. */}
        <form className="chat-box" onSubmit={(e) => { e.preventDefault(); const question = q.trim(); if (question && index && !busy) { setQ(""); void ask(question); } }}>
          <label className="sr-only" htmlFor="chat-q">{t("chat.ask")}</label>
          <input id="chat-q" className="h-11 min-w-0 flex-1 bg-transparent text-[15.5px] placeholder:text-muted" placeholder={t("chat.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} disabled={!index || here === false} autoComplete="off" />
          {busy ? (
            <button type="button" className="chat-send is-stop" onClick={() => stop.current?.abort()} aria-label={t("chat.stop")}>
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button className="chat-send" disabled={!index || here === false || !q.trim()} aria-label={t("chat.send")}><ArrowUp size={18} strokeWidth={2.4} /></button>
          )}
        </form>
      </section>
      <aside className="chat-side">
        <div className="chat-page" data-chat-page={page}>
          <PdfThumb key={page} file={file} page={page - 1} width={300} className="chat-page-img blur-in" alt={t("chat.pageOf", { n: page, total: pages })} />
          <div className="chat-pager">
            <button className="chat-round" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t("chat.prevPage")}><ChevronLeft size={16} className="rtl:rotate-180" /></button>
            <span className="tabular">{pages ? t("chat.pageOf", { n: page, total: pages }) : ""}</span>
            <button className="chat-round" disabled={!pages || page >= pages} onClick={() => setPage((p) => p + 1)} aria-label={t("chat.nextPage")}><ChevronRight size={16} className="rtl:rotate-180" /></button>
          </div>
        </div>
        <div className="chat-panel">
          {/* How the PDF is read: folded, it's rarely changed. */}
          <details className="chat-options">
            <summary>{t("ws.options")}</summary>
            <div className="pt-3"><Options defs={defs} values={options} onChange={onOption} /></div>
          </details>
          <AiNotice task="chat" />
        </div>
      </aside>
    </div>
  );
}
