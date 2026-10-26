"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useI18n } from "./I18n";
import { BRAND } from "@/lib/brand";
import { VENDOR_VERSION } from "@/lib/vendor";
import { hasOpenWork } from "@/lib/session";

// How often, at most, coming back to the app asks whether a new version is out.
const CHECK_MS = 5 * 60 * 1000;

// Registers the offline cache in production builds only, so dev reloads stay
// fresh. The vendor version in the URL makes a new install a new worker, with
// its own cache, whenever the vendored files change. When the worker says
// this tab's build is gone (public/sw.js, a deploy while it was open), a bar
// offers to reload rather than letting the next tool fail.
//
// An installed app can stay open for days, running the code it opened with.
// Coming back to it asks for a new worker (each deploy has one, public/sw.js);
// when one takes over, a page with nothing open reloads into the new version
// at once, and one with work open offers the reload instead.
export function ServiceWorker() {
  const { t } = useI18n();
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/sw.js?v=${VENDOR_VERSION}`).catch(() => {});
    const sw = navigator.serviceWorker;
    const onMessage = (e: MessageEvent) => e.data?.type === "nopload:stale" && setStale(true);
    sw.addEventListener("message", onMessage);
    // A first visit's worker taking over is no update.
    const updating = !!sw.controller;
    const onTakeOver = () => {
      if (!updating) return;
      if (hasOpenWork()) setStale(true);
      else location.reload();
    };
    sw.addEventListener("controllerchange", onTakeOver);
    let checked = Date.now();
    const onBack = () => {
      if (document.visibilityState !== "visible" || Date.now() - checked < CHECK_MS) return;
      checked = Date.now();
      void sw.getRegistration().then((r) => r?.update()).catch(() => {});
    };
    document.addEventListener("visibilitychange", onBack);
    addEventListener("focus", onBack);
    return () => {
      sw.removeEventListener("message", onMessage);
      sw.removeEventListener("controllerchange", onTakeOver);
      document.removeEventListener("visibilitychange", onBack);
      removeEventListener("focus", onBack);
    };
  }, []);
  if (!stale) return null;
  return (
    <div role="alert" data-stale className="fixed inset-x-0 bottom-0 z-[70] flex flex-wrap items-center justify-center gap-3 border-t border-line bg-surface px-4 py-3 text-[15px] shadow-card">
      {t("ws.staleBuild", { brand: BRAND.name })}
      <button className="btn btn-primary btn-sm" onClick={() => location.reload()}><RefreshCw size={15} /> {t("ws.reloadPage")}</button>
    </div>
  );
}
