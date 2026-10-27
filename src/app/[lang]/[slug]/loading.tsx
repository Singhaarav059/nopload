"use client";

import { ViewTransition } from "react";
import { usePathname } from "next/navigation";
import { ToolIcon } from "@/components/ToolIcon";
import { useI18n } from "@/components/I18n";
import { englishSlug } from "@/lib/i18n/slugs";
import { toolBySlug } from "@/lib/tools";

// While a tool's page loads (a tap from the home or the Tools sheet): the
// tool's icon and name already in place, so the card tapped grows straight
// into them (the morph, ToolGrid.tsx), and the rest of the page's shape in
// grey, shimmering (.skeleton, app.css), instead of a blank screen.
export default function Loading() {
  const { t, locale } = useI18n();
  const slug = decodeURIComponent(usePathname().split("/").filter(Boolean)[1] ?? "");
  const tool = toolBySlug(englishSlug(slug, locale) ?? slug);
  return (
    <div aria-busy="true" className="mx-auto max-w-[760px] px-4 pt-6 sm:px-6 sm:pt-10">
      <div className="mt-4 flex items-center justify-center gap-3 sm:gap-4">
        {tool ? (
          <>
            <ViewTransition name={`tool-${tool.id}`} share="morph" default="none">
              <span className="block rounded-[18px] bg-surface p-1 shadow-lift">
                <ToolIcon tool={tool} size={44} />
              </span>
            </ViewTransition>
            <span className="display text-[2.1rem] sm:text-[3rem]">{t(`tool.${tool.id}.name`)}</span>
          </>
        ) : (
          <>
            <div className="skeleton h-14 w-14 rounded-2xl" />
            <div className="skeleton h-9 w-48" />
          </>
        )}
      </div>
      <div className="skeleton mx-auto mt-6 h-12 w-full max-w-[520px] rounded-full" />
      <div className="skeleton mt-6 h-[52vh] min-h-[280px] w-full rounded-[28px]" />
    </div>
  );
}
