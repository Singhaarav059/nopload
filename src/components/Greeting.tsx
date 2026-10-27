"use client";

import { useSyncExternalStore } from "react";
import { useI18n } from "./I18n";

// "Good evening · Tuesday 27 October", above the app's home title, from the
// device's clock. Not in the page as built (the hour isn't known there).
const never = () => () => {};
export function Greeting() {
  const { t, locale } = useI18n();
  const now = useSyncExternalStore(never, () => Math.floor(Date.now() / 600_000), () => 0);
  if (!now) return <span className="block h-5" />;
  const d = new Date(now * 600_000);
  const h = d.getHours();
  const hello = t(h < 5 ? "app.evening" : h < 12 ? "app.morning" : h < 17 ? "app.afternoon" : "app.evening");
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(d);
  return (
    <span data-greeting className="blur-in block text-[13.5px] font-medium tracking-normal text-muted">
      {hello} · {day}
    </span>
  );
}
