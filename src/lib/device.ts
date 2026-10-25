// The device the site is on, so it can look and behave like an app made for
// it: which system (data-os), what shape (data-form) and whether it was
// opened as an installed app (data-app), all on <html> for globals.css and
// src/components/AppShell.tsx to read.
//
//   data-os    ios | ipados | android | mac | windows | linux | chromeos
//   data-form  phone | tablet | desktop
//   data-app   standalone | wco (installed, in its own window; wco when the
//              title bar is ours: window-controls-overlay)
//   data-nav   tabs | rail | sidebar | fluent: the navigation the app shows
//              (a tab bar on phones and narrow windows)
//   data-twa   present inside the Android app

export type Os = "ios" | "ipados" | "android" | "mac" | "windows" | "linux" | "chromeos";
export type Form = "phone" | "tablet" | "desktop";
export type Nav = "tabs" | "rail" | "sidebar" | "fluent";

// ?app=1 (kept for the session) shows the installed app's look in a tab: for
// trying it, and for the tests, which can't install anything.
export const APP_PREVIEW_KEY = "nopload:app";
// Opened in the Android app (android/, a Trusted Web Activity): its launches
// carry ?source=android or an android-app:// referrer; kept for the session.
export const TWA_KEY = "nopload:twa";

// An iPad asks for the Mac site, so it's told apart by touch (Safari on a Mac
// has neither touch points nor touch events). Android says "Mobile" on phones
// and not on tablets, which is surer than the pointer. A tablet held upright
// (under 1000 px) gets the narrow rail, so the page keeps the width.
// Runs in <head> before the first paint, so the right layout is there from
// the start. Plain ES5, wrapped in try: storage can be blocked.
export const DEVICE_SCRIPT = `try{(function(){var d=document.documentElement,n=navigator,u=n.userAgent,t=n.maxTouchPoints||0,o=/android/i.test(u)?"android":/iphone|ipod/i.test(u)?"ios":/ipad/i.test(u)||(/macintosh/i.test(u)&&(t>0||"ontouchend" in document))?"ipados":/cros/i.test(u)?"chromeos":/windows/i.test(u)?"windows":/macintosh|mac os/i.test(u)?"mac":"linux";d.dataset.os=o;var m=function(q){return window.matchMedia&&matchMedia(q).matches};function form(){var s=Math.min(screen.width,screen.height),c=m("(pointer: coarse)")&&!m("(pointer: fine)");var f=(o==="ios"||(o==="android"&&/mobile/i.test(u))||(c&&s<600))?"phone":(o==="ipados"||o==="android"||(c&&o==="chromeos"))?"tablet":"desktop";d.dataset.form=f;d.dataset.nav=(f==="phone"||innerWidth<760)?"tabs":(o==="android"||o==="chromeos"||(f==="tablet"&&innerWidth<1000))?"rail":o==="windows"?"fluent":"sidebar"}form();addEventListener("resize",form);var p=/[?&]app=1\\b/.test(location.search);if(p)sessionStorage.setItem("${APP_PREVIEW_KEY}","1");if(/[?&]app=0\\b/.test(location.search))sessionStorage.removeItem("${APP_PREVIEW_KEY}");var tw=/[?&]source=android\\b/.test(location.search)||document.referrer.indexOf("android-app://dev.pages.nopload")===0;if(tw)sessionStorage.setItem("${TWA_KEY}","1");if(sessionStorage.getItem("${TWA_KEY}")==="1")d.dataset.twa="";function app(){var w=m("(display-mode: window-controls-overlay)"),s=w||m("(display-mode: standalone)")||m("(display-mode: fullscreen)")||n.standalone===true||sessionStorage.getItem("${APP_PREVIEW_KEY}")==="1";if(s)d.dataset.app=w?"wco":"standalone";else delete d.dataset.app}app();if(window.matchMedia){["(display-mode: window-controls-overlay)","(display-mode: standalone)"].forEach(function(q){var l=matchMedia(q);l.addEventListener&&l.addEventListener("change",app)})}})()}catch(e){}`;

const html = () => (typeof document === "undefined" ? null : document.documentElement);

export const deviceOs = (): Os | null => (html()?.dataset.os as Os) ?? null;
export const deviceForm = (): Form | null => (html()?.dataset.form as Form) ?? null;
export const isApp = () => !!html()?.dataset.app;
export const inAndroidApp = () => html()?.dataset.twa !== undefined;

// The key that goes with shortcuts on this system: ⌘ on Apple's, Ctrl elsewhere.
export const modKey = () => (/^(mac|ios|ipados)$/.test(deviceOs() ?? "") ? "⌘" : "Ctrl");

// A short tap of feedback where the system has it (Android; iPhones ignore it).
export function haptic(kind: "tap" | "done" | "warn" = "tap") {
  try {
    navigator.vibrate?.(kind === "tap" ? 8 : kind === "done" ? [10, 40, 18] : [30, 60, 30]);
  } catch {
    // Not allowed here: no feedback, nothing else changes.
  }
}

// data-* on <html> as React state: the attributes change on resize (form) and
// when the window becomes an app (app).
export function subscribeDevice(onChange: () => void) {
  const el = html();
  if (!el) return () => {};
  const mo = new MutationObserver(onChange);
  mo.observe(el, { attributes: true, attributeFilter: ["data-os", "data-form", "data-app", "data-nav"] });
  return () => mo.disconnect();
}
