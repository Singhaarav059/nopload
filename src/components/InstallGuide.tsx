"use client";

import { useSyncExternalStore } from "react";
import { Download, Share, PlusSquare, MoreVertical, MonitorDown } from "lucide-react";
import { useI18n } from "./I18n";
import { BRAND } from "@/lib/brand";
import { deviceOs, subscribeDevice, type Os } from "@/lib/device";

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
