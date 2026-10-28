"use client";

import { Cloud, FileCheck2, ServerCog, ShieldCheck, WifiOff, Wallet } from "lucide-react";
import { useI18n } from "../I18n";
import type { Tool } from "@/lib/tools";

// Beside the drop area on wide screens: what this tool takes, where it
// runs, and its three steps, so the space next to it says something.
export function ToolFacts({ tool }: { tool: Tool }) {
  const { t } = useI18n();
  const where = tool.ai ? { Icon: Cloud, text: t("home.aiBadge") } : tool.runtime === "browser" ? { Icon: ShieldCheck, text: t("home.privateBadge") } : { Icon: ServerCog, text: t("home.serverBadge") };
  const types = tool.accept.filter((e) => e !== "jpeg").map((e) => e.toUpperCase());
  return (
    <aside aria-label={t("ws.steps")} className="tool-facts hidden lg:flex">
      <p className="tool-facts-row">
        <span className="tool-facts-icon"><where.Icon size={16} /></span>
        <span className="font-medium text-ink">{where.text}</span>
      </p>
      <div className="tool-facts-row items-start">
        <span className="tool-facts-icon"><FileCheck2 size={16} /></span>
        <span className="flex flex-wrap gap-1">
          {types.slice(0, 8).map((x) => <span key={x} className="tool-facts-chip">{x}</span>)}
          {types.length > 8 && <span className="tool-facts-chip">+{types.length - 8}</span>}
        </span>
      </div>
      <ol className="mt-1 space-y-2.5 border-t border-line pt-4">
        {(["guide.step1", "guide.step2", "guide.step3"] as const).map((k, i) => (
          <li key={k} className="flex items-center gap-3 text-[14px] text-ink-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-(--tint) text-[13px] font-semibold text-(--tint-ink)">{i + 1}</span>
            {t(k)}
          </li>
        ))}
      </ol>
      <ul className="mt-auto space-y-2 border-t border-line pt-4 text-[13px] text-muted">
        <li className="flex gap-2"><Wallet size={15} className="mt-0.5 shrink-0 text-(--tint-ink)" /> {t("home.promise1")}</li>
        <li className="flex gap-2"><WifiOff size={15} className="mt-0.5 shrink-0 text-(--tint-ink)" /> {t("home.promise2")}</li>
      </ul>
    </aside>
  );
}
