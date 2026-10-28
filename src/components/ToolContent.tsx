// The long-form part of a tool page, under the workspace: how to use the
// tool, what it does, why the files stay private and common questions, plus
// the same content as structured data. Server-rendered and below the fold,
// so it adds words for readers and search engines without moving anything
// people see first.
import { ShieldCheck, Server } from "lucide-react";
import { format, type Dict, type DictKey } from "@/lib/i18n/dictionary";
import type { Locale } from "@/lib/i18n/locales";
import { BRAND } from "@/lib/brand";
import { LIMITS, type Tool } from "@/lib/tools";
import { toolJsonLd, type ToolContent as Content } from "@/lib/seo";

const VARS = { brand: BRAND.name, files: LIMITS.files, mb: LIMITS.mb };

// One of a tool's own texts (tool.{id}.{part}), with its placeholders filled.
export function toolText(t: Dict, tool: Tool, part: string) {
  return format(t[`tool.${tool.id}.${part}` as DictKey] ?? "", VARS);
}

// Texts that exist for this tool, in order: step1…, q1…
function numbered(t: Dict, tool: Tool, part: string) {
  const out: string[] = [];
  for (let n = 1; t[`tool.${tool.id}.${part}${n}` as DictKey] !== undefined; n++) out.push(toolText(t, tool, `${part}${n}`));
  return out;
}

// The written content describes the tool as the free static site runs it:
// in the browser. A tool that the server build runs on its server gets the
// general steps and the server's privacy note, and no questions, since those
// answers are about the in-browser version.
function contentOf(t: Dict, tool: Tool) {
  const name = toolText(t, tool, "name");
  const onServer = tool.runtime === "server";
  const questions = numbered(t, tool, "q");
  const answers = numbered(t, tool, "a");
  const content: Content = {
    name,
    description: toolText(t, tool, "meta"),
    howTo: format(t["tp.howTo"], { name }),
    steps: onServer ? [t["guide.step1"], t["guide.step2"], t["guide.step3"]] : numbered(t, tool, "step"),
    faq: onServer ? [] : questions.map((q, i) => ({ q, a: answers[i] ?? "" })),
  };
  return { ...content, intro: toolText(t, tool, "intro"), privacy: onServer ? t["tp.privateServer"] : toolText(t, tool, "private"), onServer };
}

export function ToolContent({ tool, t, lang }: { tool: Tool; t: Dict; lang: Locale }) {
  const c = contentOf(t, tool);
  const Badge = c.onServer ? Server : ShieldCheck;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toolJsonLd({ lang, slug: tool.slug, home: t["nav.allTools"], content: c }) }} />

      {/* How to use: three cards in the tool's colour, in one panel. */}
      <section className="how-box">
        <h2 className="display text-[1.4rem] sm:text-[1.7rem]">{c.howTo}</h2>
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {c.steps.map((s, i) => (
            <li key={i} className="tp-step">
              <span className="tp-step-num">{i + 1}</span>
              <span className="text-pretty text-[15px] leading-relaxed text-ink-2">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* What it does, beside why the files stay private. */}
      <div className="mt-5 grid gap-5 md:grid-cols-[3fr_2fr]">
        <section className="tp-about">
          <h2 className="display text-[1.3rem] sm:text-[1.5rem]">{format(t["tp.about"], { name: c.name })}</h2>
          <p className="mt-3 max-w-[64ch] text-pretty text-[15.5px] leading-relaxed text-ink-2">{c.intro}</p>
        </section>
        <section className="reveal fold card relative p-6 shadow-card">
          <span aria-hidden className="tape -top-3 start-6 -rotate-3" />
          <span className={`grid h-11 w-11 place-items-center rounded-2xl ${c.onServer ? "bg-surface-2 text-muted" : "bg-[color-mix(in_oklab,var(--success)_16%,transparent)] text-success"}`}>
            <Badge size={20} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className="mt-4 text-[16.5px] font-semibold tracking-[-0.01em]">{t["tp.private"]}</h2>
          <p className="mt-2 text-pretty text-[15px] leading-relaxed text-ink-2">{c.privacy}</p>
        </section>
      </div>

      {/* Questions: two columns of cards, open (search engines read only what shows), each folds away. */}
      {c.faq.length > 0 && (
        <section className="mt-14">
          <h2 className="display text-[1.4rem] sm:text-[1.7rem]">{format(t["tp.faq"], { name: c.name })}</h2>
          <div className="mt-5 grid items-start gap-3 md:grid-cols-2">
            {c.faq.map(({ q, a }) => (
              <details key={q} className="tp-faq group" open>
                <summary>
                  <span className="text-[15.5px] font-semibold tracking-[-0.01em]">{q}</span>
                  <span aria-hidden className="tp-faq-plus">+</span>
                </summary>
                <p className="mt-3 text-pretty text-[15px] leading-relaxed text-ink-2">{a}</p>
              </details>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
