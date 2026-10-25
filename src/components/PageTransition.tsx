"use client";

import { ViewTransition } from "react";
import { usePathname } from "next/navigation";
import { useDevice } from "./AppShell";

// In the installed app, a page arrives the way an app's screen does: a short
// slide on phones, a lift and fade on bigger screens (app.css). The website
// keeps plain page loads. Keyed by path, so each page enters and leaves.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { app } = useDevice();
  return (
    <ViewTransition key={pathname} enter={app ? "app-in" : "none"} exit={app ? "app-out" : "none"} default="none">
      {children}
    </ViewTransition>
  );
}
