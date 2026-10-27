"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PenLine } from "lucide-react";
import { useI18n } from "./I18n";
import { haptic } from "@/lib/device";

const KEY = "nopload:welcomed";

// Whether to welcome: in the app, until Get started. Storage blocked: no
// welcome, rather than one at every start.
let dismissed = false;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function due() {
  if (dismissed || !document.documentElement.dataset.app) return false;
  try {
    return localStorage.getItem(KEY) !== "1";
  } catch {
    return false;
  }
}
const done = () => {
  dismissed = true;
  listeners.forEach((fn) => fn());
};

// The app's first screen, once: what it is, in two stickers and a line of
// handwriting, over the mascot rising from the bottom, and Get started.
// Only in the installed app (data-app on <html>), never on the website.
export function Welcome() {
  const { t, locale } = useI18n();
  const show = useSyncExternalStore(subscribe, due, () => false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!show) return;
    document.documentElement.dataset.welcome = "";
    return () => {
      delete document.documentElement.dataset.welcome;
    };
  }, [show]);

  if (!show) return null;
  const start = () => {
    haptic();
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // Shown again next time; nothing lost.
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return done();
    setLeaving(true);
    setTimeout(done, 720);
  };

  return (
    <div role="dialog" aria-modal aria-labelledby="welcome-title" className="welcome" data-leaving={leaving || undefined}>
      <span className="welcome-lang">{locale === "zh-cn" ? "简" : locale === "zh-tw" ? "繁" : locale.toUpperCase()}</span>
      <PenLine aria-hidden className="welcome-pen" size={30} strokeWidth={1.4} />
      <h1 id="welcome-title" className="welcome-title">
        <span className="welcome-tape welcome-tape-1">{t("welcome.line1")}</span>
        <span className="welcome-tape welcome-tape-2">{t("welcome.line2")}</span>
      </h1>
      <p className="welcome-sub">{t("welcome.sub")}</p>
      <div aria-hidden className="welcome-blob">
        <svg viewBox="0 0 400 420" preserveAspectRatio="xMidYMin slice" className="welcome-blob-shape">
          <path d="M0 60 Q 20 30 40 52 T 80 44 T 120 30 T 160 22 T 200 14 T 240 22 T 280 30 T 320 44 T 360 52 T 400 60 V420 H0 Z" fill="var(--brand)" />
        </svg>
        <svg viewBox="0 0 200 120" className="welcome-face">
          <ellipse cx="62" cy="52" rx="34" ry="44" fill="#fff" />
          <ellipse cx="138" cy="52" rx="34" ry="44" fill="#fff" />
          <g className="welcome-pupils">
            <ellipse cx="68" cy="56" rx="15" ry="19" fill="#000" />
            <ellipse cx="144" cy="56" rx="15" ry="19" fill="#000" />
          </g>
          <path d="M120 112 Q 150 118 168 92" fill="none" stroke="#000" strokeWidth="7" strokeLinecap="round" />
        </svg>
      </div>
      <button type="button" className="welcome-start" onClick={start} autoFocus>{t("welcome.start")}</button>
    </div>
  );
}
