"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Home, LayoutGrid, Workflow, Settings2, Search, X, ChevronDown, BookOpenText } from "lucide-react";
import { useI18n } from "./I18n";
import { ThemeSwitch } from "./ThemeMenu";
import { ToolIcon } from "./ToolIcon";
import { IntentLink } from "./IntentLink";
import { AndroidApp, InstallGuide } from "./InstallGuide";
import { CATEGORIES, TOOLS } from "@/lib/tools";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { switchLanguage } from "@/lib/i18n/slugs";
import { goToLanguage } from "@/lib/session";
import { useDialog } from "@/lib/useDialog";
import { haptic, subscribeDevice, type Form, type Nav, type Os } from "@/lib/device";

// The installed app's frame (data-app on <html>, src/lib/device.ts). Each
// system gets the navigation its own apps have:
//   iPhone        a frosted tab bar, icons over small labels
//   Android phone a navigation bar, a pill behind the chosen icon
//   iPad, Mac     a sidebar of the tools by family
//   Android tablet, ChromeOS  a navigation rail
//   Windows       a navigation pane, the chosen item marked at its edge
// In a browser tab it shows nothing: the site's own header and footer stay.

type Device = { os: Os | null; form: Form | null; nav: Nav | null; app: boolean };
const SERVER: Device = { os: null, form: null, nav: null, app: false };
let last: Device = SERVER;
const read = (): Device => {
  const d = document.documentElement.dataset;
  const next = { os: (d.os as Os) ?? null, form: (d.form as Form) ?? null, nav: (d.nav as Nav) ?? null, app: !!d.app };
  if (next.os !== last.os || next.form !== last.form || next.nav !== last.nav || next.app !== last.app) last = next;
  return last;
};

export function useDevice() {
  return useSyncExternalStore(subscribeDevice, read, () => SERVER);
}

type Sheet = null | "tools" | "settings";

export function AppShell() {
  const { os, form, nav, app } = useDevice();
  const [sheet, setSheet] = useState<Sheet>(null);
  // The sheets are built once, while the app is idle, and then only shown
  // and hidden: a tap opens one at once instead of first building a hundred
  // tool tiles.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    if (!app) return;
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(() => setWarm(true), { timeout: 4000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(() => setWarm(true), 1500);
    return () => clearTimeout(id);
  }, [app]);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setSheet(null);
  }
useRipple(os === "android");
  if (!app) return null;
  return (
    <>
      {nav === "tabs" ? <TabBar os={os} open={setSheet} sheet={sheet} /> : <Side nav={nav} open={setSheet} />}
      {(["tools", "settings"] as const).map((kind) =>
        warm || sheet === kind ? <BottomSheet key={kind} os={os} phone={form === "phone"} kind={kind} open={sheet === kind} close={() => setSheet(null)} /> : null,
      )}
    </>
  );
}

function useTabs() {
  const { t, href } = useI18n();
  const pathname = usePathname();
  const home = href("/");
  const at = (p: string) => pathname === p || pathname === `${p}/`;
  return [
    { id: "home", label: t("nav.home"), icon: Home, href: home, current: at(home) },
    // The reader: recent files and the viewer, as a reader app's library.
    { id: "reader", label: t("app.reader"), icon: BookOpenText, href: href("/pdf-viewer"), current: at(href("/pdf-viewer")) },
    { id: "tools", label: t("app.tools"), icon: LayoutGrid, sheet: "tools" as const, current: TOOLS.some((x) => x.id !== "view" && at(href(`/${x.slug}`))) },
    { id: "flows", label: t("nav.workflows"), icon: Workflow, href: href("/workflows"), current: at(href("/workflows")) },
    { id: "settings", label: t("app.settings"), icon: Settings2, sheet: "settings" as const, current: false },
  ];
}

function TabBar({ os, open, sheet }: { os: Os | null; open: (s: Sheet) => void; sheet: Sheet }) {
  const { t } = useI18n();
  const tabs = useTabs();
  const material = os === "android";
  return (
    <nav aria-label={t("app.nav")} data-tabbar={material ? "material" : "ios"} className="app-tabbar">
      {tabs.map((tab) => {
        // A sheet tab is lit while its sheet is open, or while on one of its pages (Tools on a tool page).
        const on = sheet ? sheet === tab.sheet : !!tab.current;
        const body = (
          <>
            <span className="app-tab-icon"><tab.icon size={material ? 22 : 24} strokeWidth={on ? 2.1 : 1.75} /></span>
            <span className="app-tab-label">{tab.label}</span>
          </>
        );
        return tab.href ? (
          <Link key={tab.id} href={tab.href} data-tab={tab.id} aria-current={on ? "page" : undefined} className="app-tab" onClick={() => { haptic(); open(null); }}>
            {body}
          </Link>
        ) : (
          <button key={tab.id} type="button" data-tab={tab.id} aria-expanded={on} aria-current={on ? "page" : undefined} className="app-tab" onClick={() => { haptic(); open(on ? null : tab.sheet!); }}>
            {body}
          </button>
        );
      })}
    </nav>
  );
}

// Android's ripple: where the finger lands on a control, for the CSS in app.css.
function useRipple(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const down = (e: PointerEvent) => {
      const el = (e.target as Element).closest?.<HTMLElement>(".btn, .icon-btn, .app-tab, .app-row");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--rx", `${e.clientX - r.left}px`);
      el.style.setProperty("--ry", `${e.clientY - r.top}px`);
      el.removeAttribute("data-ripple");
      void el.offsetWidth;
      el.setAttribute("data-ripple", "");
      setTimeout(() => el.removeAttribute("data-ripple"), 560);
    };
    document.addEventListener("pointerdown", down, { passive: true });
    return () => document.removeEventListener("pointerdown", down);
  }, [on]);
}

function Side({ nav, open }: { nav: Nav | null; open: (s: Sheet) => void }) {
  const { t, href } = useI18n();
  const pathname = usePathname();
  const tabs = useTabs();
  const style = nav ?? "sidebar";
  const [shut, setShut] = useState<Set<string>>(new Set());
  if (nav === "rail") {
    return (
      <nav aria-label={t("app.nav")} data-side="rail" className="app-side">
        {tabs.map((tab) => {
          const body = (
            <>
              <span className="app-tab-icon"><tab.icon size={22} strokeWidth={tab.current ? 2.1 : 1.75} /></span>
              <span className="app-tab-label">{tab.label}</span>
            </>
          );
          return tab.href ? (
            <Link key={tab.id} href={tab.href} data-tab={tab.id} aria-current={tab.current ? "page" : undefined} className="app-tab" onClick={() => haptic()}>{body}</Link>
          ) : (
            <button key={tab.id} type="button" data-tab={tab.id} aria-current={tab.current ? "page" : undefined} className="app-tab" onClick={() => { haptic(); open(tab.sheet!); }}>{body}</button>
          );
        })}
      </nav>
    );
  }
  const toggle = (id: string) => setShut((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <nav aria-label={t("app.nav")} data-side={style} className="app-side">
      <div className="app-side-drag" />
      <ul className="app-side-top">
        {tabs.filter((x) => x.id !== "tools").map((tab) => (
          <li key={tab.id}>
            {tab.href ? (
              <Link href={tab.href} data-tab={tab.id} aria-current={tab.current ? "page" : undefined} className="app-side-item">
                <tab.icon size={17} strokeWidth={1.75} /> {tab.label}
              </Link>
            ) : (
              <button type="button" data-tab={tab.id} className="app-side-item" onClick={() => open(tab.sheet!)}>
                <tab.icon size={17} strokeWidth={1.75} /> {tab.label}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="app-side-list">
        {CATEGORIES.map((c) => {
          const closed = shut.has(c.id);
          return (
            <section key={c.id} data-cat={c.id}>
              <button type="button" className="app-side-head" aria-expanded={!closed} onClick={() => toggle(c.id)}>
                {t(`cat.${c.id}`)}
                <ChevronDown size={13} className="app-side-chev" />
              </button>
              {!closed && (
                <ul>
                  {TOOLS.filter((x) => x.category === c.id).map((tool) => {
                    const to = href(`/${tool.slug}`);
                    const on = pathname === to || pathname === `${to}/`;
                    return (
                      <li key={tool.id}>
                        <Link href={to} aria-current={on ? "page" : undefined} className="app-side-item">
                          <ToolIcon tool={tool} size={22} />
                          <span className="truncate">{t(`tool.${tool.id}.name`)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </nav>
  );
}

// A sheet from the bottom on phones (drag it down to close), a centred panel
// on bigger screens. Closed, it stays built but out of the page (hidden).
function BottomSheet({ os, phone, kind, open, close }: { os: Os | null; phone: boolean; kind: Exclude<Sheet, null>; open: boolean; close: () => void }) {
  const { t } = useI18n();
  // A modal while open: focus inside, Tab kept in, Escape closes, focus back after.
  const ref = useDialog<HTMLDivElement>(open, close);
  const drag = useRef<{ y: number; dy: number; t: number } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const shut = () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return close();
    setLeaving(true);
    setTimeout(() => {
      setLeaving(false);
      close();
    }, 260);
  };
  useEffect(() => {
    if (!open) return;
    // Back where it rests, if it was last dragged down to close.
    if (ref.current) {
      ref.current.style.transition = "";
      ref.current.style.translate = "";
    }
    document.documentElement.dataset.sheet = "";
    return () => {
      delete document.documentElement.dataset.sheet;
    };
  }, [open, ref]);
  const onDown = (e: React.PointerEvent) => {
    if (!phone) return;
    drag.current = { y: e.clientY, dy: 0, t: performance.now() };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !ref.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    ref.current.style.transition = "none";
    ref.current.style.translate = `0 ${d.dy}px`;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !ref.current) return;
    ref.current.style.transition = "";
    const fast = d.dy / Math.max(1, performance.now() - d.t) > 0.6;
    if (d.dy > 120 || (fast && d.dy > 30)) {
      haptic();
      shut();
    } else ref.current.style.translate = "";
  };
  return (
    <div className="app-sheet-wrap" hidden={!open} data-leaving={leaving || undefined} data-phone={phone || undefined} data-os={os ?? undefined}>
      <button type="button" aria-label={t("nav.close")} className="app-sheet-scrim" onClick={shut} tabIndex={-1} />
      <div ref={ref} role="dialog" aria-modal aria-label={kind === "tools" ? t("app.tools") : t("app.settings")} data-sheet={kind} className="app-sheet">
        <div className="app-sheet-grip" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <span aria-hidden className="app-sheet-handle" />
          <div className="flex items-center justify-between px-5 pb-2">
            <h2 className="text-[1.15rem] font-semibold tracking-[-0.02em]">{kind === "tools" ? t("app.tools") : t("app.settings")}</h2>
            <button type="button" className="icon-btn" aria-label={t("nav.close")} onClick={shut}><X size={20} /></button>
          </div>
        </div>
        <div className="app-sheet-body">{kind === "tools" ? <ToolsList /> : <SettingsList />}</div>
      </div>
    </div>
  );
}

function ToolsList() {
  const { t, href } = useI18n();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? TOOLS.filter((x) => `${t(`tool.${x.id}.name`)} ${t(`tool.${x.id}.desc`)}`.toLowerCase().includes(s)) : TOOLS;
  }, [q, t]);
  return (
    <div className="px-4 pb-6">
      <label className="relative mb-4 block">
        <span className="sr-only">{t("home.searchPlaceholder")}</span>
        <Search size={17} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("home.searchPlaceholder")} className="field ps-10" />
      </label>
      {CATEGORIES.map((c) => {
        const list = shown.filter((x) => x.category === c.id);
        if (!list.length) return null;
        return (
          <section key={c.id} data-cat={c.id} className="mb-5">
            <h3 className="mb-2 px-1 text-[13px] font-semibold text-(--tint-ink)">{t(`cat.${c.id}`)}</h3>
            <ul className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-6">
              {list.map((tool) => (
                <li key={tool.id}>
                  <IntentLink href={href(`/${tool.slug}`)} className="app-launch group" onClick={() => haptic()}>
                    <ToolIcon tool={tool} size={52} />
                    <span className="line-clamp-2 text-center text-[11.5px] leading-tight text-ink-2">{t(`tool.${tool.id}.name`)}</span>
                  </IntentLink>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SettingsList() {
  const { t, href, locale } = useI18n();
  const pathname = usePathname();
  const { os } = useDevice();
  return (
    <div className="space-y-6 px-5 pb-8">
      <div>
        <p className="mb-2 text-[13px] font-semibold text-muted">{t("theme.label")}</p>
        <ThemeSwitch />
      </div>
      <div>
        <label className="mb-2 block text-[13px] font-semibold text-muted" htmlFor="app-lang">{t("nav.language")}</label>
        <select id="app-lang" className="field" value={locale} onChange={(e) => void goToLanguage(switchLanguage(pathname, e.target.value as Locale))}>
          {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>
      <InstallGuide />
      {/* The web app on Android can't be under Open with; the Android app can. */}
      {os === "android" && <AndroidApp />}
      <ul className="app-group">
        {([["foot.guide", "/guide"], ["foot.privacy", "/privacy"], ["foot.about", "/about"], ["foot.licenses", "/licenses"]] as const).map(([k, p]) => (
          <li key={p}><Link href={href(p)} className="app-row">{t(k)}</Link></li>
        ))}
      </ul>
    </div>
  );
}
