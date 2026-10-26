"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpenText } from "lucide-react";
import { useI18n } from "./I18n";
import { IntentLink } from "./IntentLink";
import { ToolIcon } from "./ToolIcon";
import { DotNumber } from "./DotNumber";
import { forget, openRecent, recentFiles, subscribeLibrary, type Recent } from "@/lib/library";
import { handOffTo } from "@/lib/handoff";
import { TOOLS, toolById, type ToolId } from "@/lib/tools";

const QUICK: ToolId[] = ["merge", "compress", "edit", "sign", "pdfToWord", "split"];

// The home page as a desk of cards: the document being read, to go on with
// it; the tools most used, a tap away; and two figures that say what this
// is: how many tools run on the device, and what it costs (nothing).
export function HomeBoard() {
  const { t, href } = useI18n();
  const router = useRouter();
  const [last, setLast] = useState<Recent | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => void recentFiles().then((l) => live && setLast(l[0] ?? null));
    load();
    const off = subscribeLibrary(load);
    return () => {
      live = false;
      off();
    };
  }, []);

  const read = async () => {
    if (!last) return router.push(href(`/${toolById("view").slug}`));
    const file = await openRecent(last.id);
    if (!file) return void forget(last.id);
    void handOffTo("view", [file]);
    router.push(href(`/${toolById("view").slug}`));
  };
  const pct = last?.pages ? Math.round(((last.page + 1) / last.pages) * 100) : 0;
  const local = TOOLS.filter((x) => x.runtime === "browser").length;

  return (
    <section aria-label={t("home.popular")} className="board">
      <button type="button" className="board-card board-read aurora" onClick={() => void read()}>
        <span className="board-eyebrow"><BookOpenText size={15} aria-hidden /> {last ? t("recent.title") : t("app.reader")}</span>
        {last ? (
          <>
            <DotNumber value={`${pct}%`} height={64} className="mt-auto" />
            <span className="mt-4 block truncate text-[17px] font-semibold tracking-[-0.01em]">{last.name}</span>
            <span className="block text-[13.5px] opacity-80">{t("recent.where", { n: last.page + 1, total: last.pages || "?" })}</span>
            <span aria-hidden className="board-bar"><span style={{ width: `${pct}%` }} /></span>
          </>
        ) : (
          <>
            <span className="board-title mt-auto">{t("tool.view.name")}</span>
            <span className="mt-2 block max-w-[34ch] text-pretty text-[14.5px] opacity-85">{t("tool.view.desc")}</span>
            <span className="board-go mt-5"><ArrowRight size={18} className="rtl:rotate-180" aria-hidden /></span>
          </>
        )}
      </button>

      <div className="board-card board-figure">
        <DotNumber value={`${local}/${TOOLS.length}`} height={40} />
        <span className="mt-auto pt-4 text-[14px] font-medium text-ink-2">{t("home.privateBadge")}</span>
      </div>

      <div className="board-card board-figure">
        <DotNumber value="0" height={40} />
        <span className="mt-auto pt-4 text-pretty text-[14px] font-medium text-ink-2">{t("home.promise1")}</span>
      </div>

      <nav aria-label={t("home.popular")} className="board-card board-quick">
        <span className="board-eyebrow text-muted">{t("home.popular")}</span>
        <ul>
          {QUICK.map((id) => {
            const tool = toolById(id);
            return (
              <li key={id}>
                <IntentLink href={href(`/${tool.slug}`)} className="board-tool">
                  <ToolIcon tool={tool} size={44} />
                  <span className="line-clamp-2 text-center text-[12.5px] font-medium leading-tight">{t(`tool.${id}.name`)}</span>
                </IntentLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </section>
  );
}
