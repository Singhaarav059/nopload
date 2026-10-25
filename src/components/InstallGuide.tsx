"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share, PlusSquare, MoreVertical, MonitorDown, X, Zap, WifiOff, FileInput, Feather, Smartphone } from "lucide-react";
import { useI18n } from "./I18n";
import { BRAND } from "@/lib/brand";
import { deviceOs, inAndroidApp, subscribeDevice, type Os } from "@/lib/device";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// The browser's install offer, kept from the moment it fires: it comes once,
// usually before anyone opens this.
let offer: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    offer = e as InstallEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    listeners.forEach((f) => f());
  });
}
const noop = () => () => {};
// Opened as the app (not the ?app=1 preview): already installed.
const isInstalled = () =>
  matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches || (navigator as { standalone?: boolean }).standalone === true;
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

// The install offer and whether this is already the installed app, as React state.
export function useInstall() {
  const ready = useSyncExternalStore(subscribe, () => offer, () => null);
  const os = useSyncExternalStore(subscribeDevice, deviceOs, () => null);
  const installed = useSyncExternalStore(noop, isInstalled, () => true);
  const prompt = async () => {
    if (!offer) return false;
    await offer.prompt();
    const { outcome } = await offer.userChoice.catch(() => ({ outcome: "dismissed" }));
    offer = null;
    listeners.forEach((f) => f());
    return outcome === "accepted";
  };
  return { ready, os, installed, prompt };
}

// Anything can open the install sheet: the header's button, the banner, a nudge.
const OPEN = "nopload:install";
export const openInstall = () => window.dispatchEvent(new Event(OPEN));

// The header's "Install app": the browser's own prompt where there is one,
// else the sheet with this device's steps. Hidden in the installed app.
export function InstallButton() {
  const { t } = useI18n();
  const { ready, installed, prompt } = useInstall();
  if (installed) return null;
  return (
    <button type="button" data-install-button className="install-pill" onClick={() => void (ready ? prompt() : openInstall())}>
      <Download size={15} strokeWidth={2} aria-hidden /> <span>{t("install.cta")}</span>
    </button>
  );
}

// The home page's invitation: what the app gives, and one button. Gone in
// the app, and for two weeks once dismissed.
const DISMISS = "nopload:install-dismissed";
export function InstallBanner() {
  const { t } = useI18n();
  const { ready, installed, prompt } = useInstall();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    let at = 0;
    try {
      at = Number(localStorage.getItem(DISMISS) ?? 0);
    } catch {
      // Storage blocked: shown.
    }
    const id = requestAnimationFrame(() => setHidden(Date.now() - at < 14 * 864e5));
    return () => cancelAnimationFrame(id);
  }, []);
  if (installed || hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS, String(Date.now()));
    } catch {
      // Storage blocked: it comes back next visit.
    }
  };
  return (
    <section data-web-only aria-labelledby="install-banner" className="install-banner">
      <div aria-hidden className="install-art install-art-sm"><span className="install-phone"><span /><span /><span /><span /></span></div>
      <div className="min-w-0 grow basis-[15rem]">
        <h2 id="install-banner" className="text-[1.15rem] font-semibold tracking-[-0.01em]">{t("install.bannerTitle", { brand: BRAND.name })}</h2>
        <p className="mt-1 text-pretty text-[14px] text-ink-2">{t("install.bannerBody")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void (ready ? prompt() : openInstall())}><Download size={15} /> {t("install.cta")}</button>
        <button type="button" className="icon-btn" aria-label={t("install.later")} onClick={dismiss}><X size={16} /></button>
      </div>
    </section>
  );
}

// The sheet: why it's worth it, then one button, or the steps for this browser.
export function InstallSheet() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { ready, os, prompt } = useInstall();
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN, on);
    return () => window.removeEventListener(OPEN, on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  const steps = STEPS[os ?? "linux"];
  const why: [typeof Zap, string][] = [[Zap, "install.why1"], [WifiOff, "install.why2"], [FileInput, "install.why3"], [Feather, "install.why4"]];
  return (
    <div className="install-wrap">
      <button type="button" aria-label={t("nav.close")} tabIndex={-1} className="cmd-scrim" onClick={() => setOpen(false)} />
      <div role="dialog" aria-modal aria-labelledby="install-title" className="install-sheet">
        <button type="button" className="icon-btn absolute end-3 top-3" aria-label={t("nav.close")} onClick={() => setOpen(false)}><X size={18} /></button>
        <div aria-hidden className="install-art"><span className="install-phone"><span /><span /><span /><span /></span></div>
        <h2 id="install-title" className="text-[1.45rem] font-semibold tracking-[-0.02em]">{t("install.sheetTitle", { brand: BRAND.name })}</h2>
        <ul className="mt-4 grid gap-2.5">
          {why.map(([Icon, key], i) => (
            <li key={key} className="install-why" style={{ "--i": i } as React.CSSProperties}><Icon size={17} strokeWidth={1.8} aria-hidden /> {t(key)}</li>
          ))}
        </ul>
        {ready ? (
          <button type="button" className="btn btn-primary mt-6 w-full" onClick={async () => { if (await prompt()) setOpen(false); }}>
            <Download size={17} /> {t("install.button")}
          </button>
        ) : (
          <ol className="mt-5 space-y-2.5 rounded-[18px] bg-surface-2 p-4">
            {steps.map(([Icon, key], i) => (
              <li key={key} className="flex items-center gap-2.5 text-[14px]">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface text-[12px] font-semibold">{i + 1}</span>
                <Icon size={17} strokeWidth={1.75} className="shrink-0 text-muted" />
                {t(key)}
              </li>
            ))}
          </ol>
        )}
        {os === "android" && <AndroidApp />}
        <button type="button" className="mt-3 w-full py-2 text-[14px] text-muted hover:text-ink" onClick={() => setOpen(false)}>{t("install.later")}</button>
      </div>
    </div>
  );
}

// Android lists only real apps under "Open with": the Android app (android/,
// a Trusted Web Activity: this site, full screen) adds Nopload there and to
// the share sheet. Offered on Android, outside that app.
export const ANDROID_APK = "/app/nopload.apk";
export function AndroidApp({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const inside = useSyncExternalStore(subscribeDevice, inAndroidApp, () => true);
  if (inside) return null;
  return (
    <div className={compact ? "" : "mt-4 rounded-[18px] border border-line p-4"} data-android-app>
      {!compact && (
        <>
          <p className="flex items-center gap-2 text-[15px] font-semibold"><Smartphone size={17} strokeWidth={1.8} /> {t("install.androidTitle")}</p>
          <p className="mt-1 text-pretty text-[13.5px] text-ink-2">{t("install.androidBody", { brand: BRAND.name })}</p>
        </>
      )}
      <a href={ANDROID_APK} download="nopload.apk" className={`btn btn-sm ${compact ? "btn-quiet" : "btn-primary mt-3"}`}>
        <Download size={15} /> {t("install.androidButton")}
      </a>
      {!compact && <p className="mt-2 text-[12.5px] text-muted">{t("install.androidNote")}</p>}
    </div>
  );
}

// How to add it on this device: the browser's own button where there is one
// (Chrome, Edge, Android), the steps where there isn't (Safari on iPhone,
// iPad and Mac). Inside the installed app, nothing.
export function InstallGuide() {
  const { t } = useI18n();
  const ready = useSyncExternalStore(subscribe, () => offer, () => null);
  const os = useSyncExternalStore(subscribeDevice, deviceOs, () => null);
  const installed = useSyncExternalStore(noop, isInstalled, () => false);
  if (installed) return null;
  const steps = STEPS[os ?? "linux"];
  return (
    <div data-install className="rounded-[20px] border border-line bg-surface p-4">
      <p className="flex items-center gap-2 text-[15px] font-semibold"><MonitorDown size={17} strokeWidth={1.75} /> {t("install.title", { brand: BRAND.name })}</p>
      <p className="mt-1 text-[13.5px] text-ink-2">{t("install.body")}</p>
      {ready ? (
        <button type="button" className="btn btn-primary btn-sm mt-3" onClick={async () => { await ready.prompt(); offer = null; listeners.forEach((f) => f()); }}>
          <Download size={15} /> {t("install.button")}
        </button>
      ) : (
        <ol className="mt-3 space-y-2">
          {steps.map(([Icon, key], i) => (
            <li key={key} className="flex items-center gap-2.5 text-[13.5px]">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold">{i + 1}</span>
              <Icon size={16} strokeWidth={1.75} className="shrink-0 text-muted" />
              {t(key)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type Step = [typeof Share, string];
const STEPS: Record<Os, Step[]> = {
  ios: [[Share, "install.ios1"], [PlusSquare, "install.ios2"]],
  ipados: [[Share, "install.ios1"], [PlusSquare, "install.ios2"]],
  mac: [[Share, "install.mac1"], [PlusSquare, "install.mac2"]],
  android: [[MoreVertical, "install.android1"], [PlusSquare, "install.android2"]],
  windows: [[MonitorDown, "install.desktop1"]],
  linux: [[MonitorDown, "install.desktop1"]],
  chromeos: [[MonitorDown, "install.desktop1"]],
};
