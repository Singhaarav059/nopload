"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, FileText, X } from "lucide-react";
import { useI18n } from "./I18n";
import { forget, forgetAll, openRecent, recentFiles, remembering, setRemembering, subscribeLibrary, type Recent } from "@/lib/library";
import { handOffTo } from "@/lib/handoff";
import { toolById } from "@/lib/tools";

// The PDFs read lately (src/lib/library.ts), one tap from opening again,
// offline too: the app's library. `onOpen` opens one where it's shown (the
// viewer's own page); elsewhere it goes to the viewer. Nothing when empty.
export function RecentFiles({ onOpen, className = "" }: { onOpen?: (file: File) => void; className?: string }) {
  const { t, href, locale } = useI18n();
  const router = useRouter();
  // The list, and the time it was read (for "2 hours ago").
  const [list, setList] = useState<Recent[] | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let live = true;
    const load = () => void recentFiles().then((l) => {
      if (!live) return;
      setList(l);
      setNow(Date.now());
    });
    load();
    const off = subscribeLibrary(load);
    return () => {
      live = false;
      off();
    };
  }, []);

  // Opened files not kept ("Remember opened files" off): the reader's page
  // says so, with the switch to turn it back on.
  if (!list?.length) return onOpen && list && !remembering() ? (
    <section aria-label={t("recent.title")} className={`recent ${className}`}>
      <p className="mb-2 text-[13.5px] text-muted">{t("recent.off")}</p>
      <RememberSwitch />
    </section>
  ) : null;

  const open = async (r: Recent) => {
    const file = await openRecent(r.id);
    if (!file) return void forget(r.id);
    if (onOpen) return onOpen(file);
    void handOffTo("view", [file]);
    router.push(href(`/${toolById("view").slug}`));
  };
  const when = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const ago = (ms: number) => {
    const m = Math.round((ms - now) / 60000);
    if (Math.abs(m) < 60) return when.format(m, "minute");
    const h = Math.round(m / 60);
    if (Math.abs(h) < 24) return when.format(h, "hour");
    return when.format(Math.round(h / 24), "day");
  };

  return (
    <section aria-labelledby="recent-title" className={`recent ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="recent-title" className="eyebrow">{t("recent.title")}</h2>
        <button type="button" className="text-[13px] text-muted hover:text-ink" onClick={() => void forgetAll()}>{t("recent.clear")}</button>
      </div>
      <ul className="recent-list">
        {list.map((r, i) => (
          <li key={r.id} style={{ "--i": i } as React.CSSProperties}>
            <button type="button" className="recent-card" onClick={() => void open(r)}>
              <span className="recent-icon" aria-hidden><FileText size={20} strokeWidth={1.6} /></span>
              <span className="min-w-0 flex-1 text-start">
                <span className="block truncate text-[14.5px] font-medium">{r.name}</span>
                <span className="block text-[12.5px] text-muted">
                  {t("recent.where", { n: r.page + 1, total: r.pages || "?" })} · {ago(r.opened)}
                </span>
                <span aria-hidden className="recent-bar"><span style={{ width: `${r.pages ? ((r.page + 1) / r.pages) * 100 : 0}%` }} /></span>
              </span>
              <BookOpenText size={17} aria-hidden className="shrink-0 text-muted" />
            </button>
            <button type="button" className="recent-x" aria-label={t("recent.remove", { name: r.name })} onClick={() => void forget(r.id)}><X size={14} /></button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12.5px] text-muted">{t("recent.private")}</p>
      <RememberSwitch className="mt-3" />
    </section>
  );
}

// "Remember opened files": whether the PDFs read are kept on this device for
// Recent. Turned off, those kept so far are removed (src/lib/library.ts).
export function RememberSwitch({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const on = useSyncExternalStore(subscribeLibrary, remembering, () => true);
  return (
    <label className={`flex cursor-pointer items-start gap-3 ${className}`}>
      <input type="checkbox" role="switch" className="mt-0.5 h-5 w-5 shrink-0 accent-(--brand)" checked={on} onChange={(e) => void setRemembering(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{t("recent.remember")}</span>
        <span className="block text-pretty text-[12.5px] text-muted">{t("recent.rememberHint")}</span>
      </span>
    </label>
  );
}
