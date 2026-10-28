"use client";

import { IntentLink } from "./IntentLink";
import { useEffect, useRef, useState, ViewTransition } from "react";
import { ArrowUpRight, Cloud, Search, Server, X } from "lucide-react";
import { ToolIcon } from "./ToolIcon";
import { CategoryBadge } from "./Studio";
import { Mascot } from "./Logo";
import { useI18n } from "./I18n";
import { CATEGORIES, RANK, TOOLS, byRank, descKey, type CategoryId, type Tool, type ToolId } from "@/lib/tools";

// The eight shown first, large.
const TOP = new Set<ToolId>(RANK.slice(0, 8));

// The tools: the most used first, as large cards, then every family in its
// own colour as a compact panel, its tools by how much they're used. A search
// or a family chip shows the matching tools as cards instead. The search
// field and the chips stay at the top while the list scrolls.
export function ToolGrid() {
  const { t, href } = useI18n();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<CategoryId | "all">("all");
  const input = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLElement>(null);

  // "/" jumps to the search field, as on many sites, unless already typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A chip filters the list and brings its start into view.
  const choose = (id: CategoryId | "all") => {
    setCat(id);
    const y = (top.current?.getBoundingClientRect().top ?? 0) + scrollY - 64;
    if (scrollY > y) scrollTo({ top: y, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  // Recomputed per render; the React Compiler memoizes it.
  const sections = (() => {
    const needle = q.trim().toLowerCase();
    return CATEGORIES.map((c) => ({
      id: c.id,
      tools: byRank(TOOLS).filter((tool) => {
        if (tool.category !== c.id) return false;
        if (!needle) return true;
        return `${t(`tool.${tool.id}.name`)} ${t(descKey(tool))} ${tool.slug} ${tool.accept.join(" ")}`
          .toLowerCase()
          .includes(needle);
      }),
    })).filter((s) => s.tools.length && (cat === "all" || s.id === cat));
  })();

  return (
    <section ref={top} id="tools" aria-labelledby="tools-title" className="scroll-mt-20">
      <div data-web-only className="max-w-[640px]">
        <h2 id="tools-title" className="reveal display text-[2rem] sm:text-[2.75rem]">{t("home.toolsTitle")}</h2>
        <p className="reveal mt-4 text-pretty text-[16px] leading-relaxed text-muted">{t("home.toolsBody")}</p>
      </div>
      <div data-sticky-bar className="sticky top-16 z-20 -mx-4 mt-8 border-b border-line/60 bg-[color-mix(in_oklab,var(--bg)_86%,transparent)] px-4 py-3 backdrop-blur-[14px] sm:-mx-6 sm:px-6">
        {/* The mascot peeks over the search box. */}
        <Mascot peek size={58} className="search-peek" />
        <label className="relative z-[1] block">
          <span className="sr-only">{t("home.searchPlaceholder")}</span>
          <Search size={18} strokeWidth={1.75} className="pointer-events-none absolute start-5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            ref={input}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("home.searchPlaceholder")}
            className="field search-field h-14 rounded-full ps-12 pe-12 text-[16px] [&::-webkit-search-cancel-button]:hidden"
          />
          {!q && (
            <kbd aria-hidden className="pointer-events-none absolute end-4 top-1/2 hidden h-7 min-w-7 -translate-y-1/2 place-items-center rounded-lg border border-line bg-surface-2 px-1.5 font-mono text-[12px] text-muted sm:grid pointer-coarse:hidden">/</kbd>
          )}
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label={t("nav.close")}
              className="icon-btn absolute end-2.5 top-1/2 h-9 w-9 -translate-y-1/2"
            >
              <X size={16} />
            </button>
          )}
        </label>
        {/* Scrolls sideways on narrow screens; the edges fade out. */}
        <div role="group" aria-label={t("nav.allTools")} className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [mask-image:linear-gradient(90deg,transparent,#000_16px,#000_calc(100%-16px),transparent)] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 sm:[mask-image:none]">
          {(["all", ...CATEGORIES.map((c) => c.id)] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={cat === id}
              data-cat={id === "all" ? undefined : id}
              onClick={() => choose(id)}
              className="pill-tab"
            >
              {id !== "all" && <span aria-hidden className="h-2 w-2 rounded-full bg-(--tint-ink)" />}
              {id === "all" ? t("home.filterAll") : t(`cat.${id}`)}
            </button>
          ))}
        </div>
      </div>

      {!q.trim() && cat === "all" ? (
        <Browse />
      ) : sections.length === 0 ? (
        <div className="rise flex flex-col items-center py-24 text-center">
          <p className="text-[1.4rem] font-medium tracking-[-0.02em] text-muted">{t("home.noResults")}</p>
        </div>
      ) : (
        sections.map((s) => (
          <section
            key={s.id}
            data-cat={s.id}
            aria-labelledby={`cat-${s.id}`}
            className="tool-family pt-12"
          >
            <header className="reveal mb-5 flex items-center gap-4">
              <CategoryBadge id={s.id} size={52} />
              <div className="min-w-0 flex-1">
                <h3 id={`cat-${s.id}`} className="display text-[1.5rem] sm:text-[1.75rem]">{t(`cat.${s.id}`)}</h3>
                <p className="mt-1 text-pretty text-[14.5px] text-muted">{t(`cat.${s.id}.blurb`)}</p>
              </div>
              <span className="pill hidden tabular sm:inline-flex">{s.tools.length}</span>
            </header>
            <ul className="tool-cards grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-3">
              {s.tools.map((tool) => (
                <li key={tool.id} className="reveal">
                  <IntentLink
                    href={href(`/${tool.slug}`)}
                    data-tool={tool.id}
                    className="tool-card spot group flex h-full flex-col items-start gap-3 rounded-[22px] border border-line bg-surface p-3.5 transition-[border-color,box-shadow,translate,opacity,scale] duration-500 ease-(--ease-out) hover:-translate-y-1 hover:border-(--tint-ink)/30 hover:shadow-lift sm:flex-row sm:gap-3.5 sm:p-4"
                  >
                    {/* Grows into the tool page's icon when opened ([slug]/page.tsx). */}
                    <ViewTransition name={`tool-${tool.id}`} share="morph" default="none">
                      <span className="block shrink-0"><ToolIcon tool={tool} size={44} /></span>
                    </ViewTransition>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[15px] font-semibold leading-tight tracking-[-0.01em]">{t(`tool.${tool.id}.name`)}</span>
                        {tool.isNew && <span data-cat="convertTo" className="pill h-5 px-2 text-[11px]">{t("home.new")}</span>}
                        {tool.runtime === "server" && (
                          <Server size={12} className="text-muted" aria-label={t("home.serverBadge")} />
                        )}
                        {tool.ai && <Cloud size={12} className="text-muted" aria-label={t("home.aiBadge")} />}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-pretty text-[13px] leading-snug text-muted sm:line-clamp-none sm:text-[14px]">{t(descKey(tool))}</span>
                    </span>
                  </IntentLink>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}

// Browsing, with no search: the most used tools large, then each family.
function Browse() {
  const { t } = useI18n();
  return (
    <>
      <section aria-labelledby="tools-top" className="pt-8">
        <h3 id="tools-top" className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-(--brand)" /> {t("home.popular")}
        </h3>
        <ul className="tool-cards grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          {RANK.slice(0, 8).map((id) => {
            const tool = TOOLS.find((x) => x.id === id)!;
            return (
              <li key={id} data-cat={tool.category}>
                <TopCard tool={tool} />
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="tools-all" className="pt-10">
        <h3 id="tools-all" className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ink-2" /> {t("nav.allTools")}
        </h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {CATEGORIES.map((c) => {
            const list = byRank(TOOLS.filter((x) => x.category === c.id));
            return (
              <section key={c.id} data-cat={c.id} aria-labelledby={`cat-${c.id}`} className="family-panel">
                <header className="flex items-center gap-3 px-1 pb-2">
                  <CategoryBadge id={c.id} size={38} />
                  <div className="min-w-0 flex-1">
                    <h4 id={`cat-${c.id}`} className="text-[16px] font-semibold tracking-[-0.015em]">{t(`cat.${c.id}`)}</h4>
                    <p className="truncate text-[12.5px] text-muted">{t(`cat.${c.id}.blurb`)}</p>
                  </div>
                  <span className="pill h-6 px-2 tabular text-[12px]">{list.length}</span>
                </header>
                <ul className="tool-cards">
                  {list.map((tool) => (
                    <li key={tool.id}>
                      <ToolRow tool={tool} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </section>
    </>
  );
}

function Badges({ tool }: { tool: Tool }) {
  const { t } = useI18n();
  return (
    <>
      {tool.isNew && <span data-cat="convertTo" className="pill h-5 px-2 text-[11px]">{t("home.new")}</span>}
      {tool.runtime === "server" && <Server size={12} className="shrink-0 text-muted" aria-label={t("home.serverBadge")} />}
      {tool.ai && <Cloud size={12} className="shrink-0 text-muted" aria-label={t("home.aiBadge")} />}
    </>
  );
}

// A most-used tool: a large card in its family's colour.
function TopCard({ tool }: { tool: Tool }) {
  const { t, href } = useI18n();
  return (
    <IntentLink href={href(`/${tool.slug}`)} data-tool={tool.id} className="tool-card top-card group">
      <ViewTransition name={`tool-${tool.id}`} share="morph" default="none">
        <span className="top-card-icon shrink-0"><ToolIcon tool={tool} size={44} /></span>
      </ViewTransition>
      <span className="mt-auto block min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[16px] font-semibold leading-tight tracking-[-0.015em]">{t(`tool.${tool.id}.name`)}</span>
          <Badges tool={tool} />
        </span>
        <span className="mt-1 line-clamp-2 block text-pretty text-[13px] leading-snug text-ink-2">{t(descKey(tool))}</span>
      </span>
      <ArrowUpRight aria-hidden size={18} className="top-card-go rtl:-scale-x-100" />
    </IntentLink>
  );
}

// A tool in its family's panel: one compact row. The most-used ones are
// already a card above, so the card is the one that carries their name for
// the morph and for tests (data-tool).
function ToolRow({ tool }: { tool: Tool }) {
  const { t, href } = useI18n();
  const top = TOP.has(tool.id);
  const icon = <span className="block shrink-0"><ToolIcon tool={tool} size={34} /></span>;
  return (
    <IntentLink href={href(`/${tool.slug}`)} data-tool={top ? undefined : tool.id} className="tool-card tool-row">
      {top ? icon : <ViewTransition name={`tool-${tool.id}`} share="morph" default="none">{icon}</ViewTransition>}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[14.5px] font-medium tracking-[-0.01em]">{t(`tool.${tool.id}.name`)}</span>
          <Badges tool={tool} />
        </span>
        <span className="block truncate text-[12.5px] text-muted">{t(descKey(tool))}</span>
      </span>
    </IntentLink>
  );
}
