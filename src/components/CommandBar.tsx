"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Search, Moon, Sun, Monitor, CornerDownLeft, Clock, Sparkles } from "lucide-react";
import { useI18n } from "./I18n";
import { ToolIcon } from "./ToolIcon";
import { useTheme } from "./ThemeMenu";
import { TOOLS, type Tool } from "@/lib/tools";
import { rankTools } from "@/lib/sayings";
import { haptic, modKey } from "@/lib/device";

// The command bar: ⌘K or Ctrl+K anywhere (or the search button in the header
// or the app's navigation), then say what you want ("make it smaller", "join
// files", "dark") and Enter. Remembers the tools opened last.

const RECENT_KEY = "nopload:recent";
const POPULAR = ["view", "merge", "compress", "edit", "sign", "pdfToWord", "split"];
const OPEN_EVENT = "nopload:command";

// Anything can open it: dispatchEvent(new Event("nopload:command")).
export const openCommandBar = () => window.dispatchEvent(new Event(OPEN_EVENT));

const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
};

type Row = { id: string; label: string; hint?: string; tool?: Tool; icon?: React.ReactNode; run: () => void };

export function CommandBar() {
  const { t, href } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [, setTheme] = useTheme();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const key = useSyncExternalStore(() => () => {}, modKey, () => "Ctrl");

  // A tool page opened: it goes to the front of the recent list.
  useEffect(() => {
    const tool = TOOLS.find((x) => pathname.endsWith(`/${x.slug}`) || pathname.endsWith(`/${x.slug}/`));
    if (!tool) return;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([tool.id, ...readRecent().filter((id) => id !== tool.id)].slice(0, 6)));
    } catch {
      // Storage blocked: no recent list, nothing else changes.
    }
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const close = () => {
    setOpen(false);
    setQ("");
    setAt(0);
  };

  const rows = useMemo((): { title: string; rows: Row[] }[] => {
    if (!open) return [];
    const go = (tool: Tool) => () => {
      haptic();
      close();
      router.push(href(`/${tool.slug}`));
    };
    const toolRow = (tool: Tool): Row => ({ id: tool.id, label: t(`tool.${tool.id}.name`), tool, run: go(tool) });
    const actions: Row[] = [
      { id: "dark", label: t("theme.dark"), icon: <Moon size={17} />, run: () => { setTheme("dark"); close(); } },
      { id: "light", label: t("theme.light"), icon: <Sun size={17} />, run: () => { setTheme("light"); close(); } },
      { id: "system", label: t("theme.system"), icon: <Monitor size={17} />, run: () => { setTheme("system"); close(); } },
    ];
    const s = q.trim().toLowerCase();
    if (!s) {
      const recent = readRecent().map((id) => TOOLS.find((x) => x.id === id)).filter((x): x is Tool => !!x);
      const popular = POPULAR.map((id) => TOOLS.find((x) => x.id === id)!).filter((x) => !recent.includes(x));
      return [
        ...(recent.length ? [{ title: t("cmd.recent"), rows: recent.map(toolRow) }] : []),
        { title: t("cmd.suggested"), rows: popular.map(toolRow) },
      ];
    }
    const found = rankTools(s, t).map(toolRow);
    const acts = actions.filter((a) => a.label.toLowerCase().includes(s) || t("theme.label").toLowerCase().includes(s));
    return [
      ...(found.length ? [{ title: t("app.tools"), rows: found }] : []),
      ...(acts.length ? [{ title: t("theme.label"), rows: acts }] : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, t, href]);

  const flat = rows.flatMap((g) => g.rows);
  const current = Math.min(at, Math.max(0, flat.length - 1));

  useEffect(() => {
    if (!open) return;
    document.documentElement.dataset.sheet = "";
    requestAnimationFrame(() => input.current?.focus());
    return () => {
      delete document.documentElement.dataset.sheet;
    };
  }, [open]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt((current + 1) % Math.max(1, flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt((current - 1 + flat.length) % Math.max(1, flat.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[current]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  let index = -1;
  return (
    <div className="cmd-wrap" onKeyDown={onKey}>
      <button type="button" aria-label={t("nav.close")} tabIndex={-1} className="cmd-scrim" onClick={close} />
      <div role="dialog" aria-modal aria-label={t("cmd.label")} className="cmd">
        <label className="cmd-field">
          <Search size={19} strokeWidth={1.8} className="shrink-0 text-muted" />
          <input
            ref={input}
            role="combobox"
            aria-expanded
            aria-controls="cmd-list"
            aria-activedescendant={flat[current] ? `cmd-${flat[current].id}` : undefined}
            aria-label={t("cmd.label")}
            placeholder={t("cmd.placeholder")}
            value={q}
            onChange={(e) => { setQ(e.target.value); setAt(0); }}
            className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-muted"
          />
          <kbd className="cmd-kbd">Esc</kbd>
        </label>
        <ul ref={list} id="cmd-list" role="listbox" className="cmd-list">
          {rows.map((g) => (
            <li key={g.title} role="presentation">
              <p className="cmd-group">
                {g.title === t("cmd.recent") ? <Clock size={12} /> : g.title === t("cmd.suggested") ? <Sparkles size={12} /> : null}
                {g.title}
              </p>
              <ul role="presentation">
                {g.rows.map((r) => {
                  index++;
                  const i = index;
                  return (
                    <li
                      key={r.id}
                      id={`cmd-${r.id}`}
                      role="option"
                      aria-selected={i === current}
                      data-index={i}
                      className="cmd-row"
                      style={{ "--i": i } as React.CSSProperties}
                      onPointerMove={() => i !== current && setAt(i)}
                      onClick={r.run}
                    >
                      {r.tool ? <ToolIcon tool={r.tool} size={30} /> : <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-surface-2 text-ink-2">{r.icon}</span>}
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      {i === current && <CornerDownLeft size={15} className="text-muted" />}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {!flat.length && <li className="px-4 py-8 text-center text-[14px] text-muted">{t("cmd.none")}</li>}
        </ul>
        <p className="cmd-foot">{t("cmd.hint", { key })}</p>
      </div>
    </div>
  );
}
