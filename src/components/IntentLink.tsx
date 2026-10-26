"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

// A link for long lists (the tools sheet, the home page's tools). A plain
// <Link> preloads its page as soon as it is on screen, so a list of a
// hundred starts dozens of loads at once, which a phone feels as stutter.
// This one preloads on intent instead: a finger down or the mouse over it,
// a moment before the tap or click lands.
export function IntentLink({ href, onPointerDown, onMouseEnter, ...rest }: Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      prefetch={false}
      onPointerDown={(e) => {
        router.prefetch(href);
        onPointerDown?.(e);
      }}
      onMouseEnter={(e) => {
        router.prefetch(href);
        onMouseEnter?.(e);
      }}
      {...rest}
    />
  );
}
