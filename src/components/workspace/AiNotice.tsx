"use client";

import { useEffect, useState } from "react";
import { Cloud } from "lucide-react";
import { useI18n } from "../I18n";

// What an AI tool sends to the server AI (src/lib/ai/cloud.ts), which every
// AI tool uses, with a link to the providers named in the privacy policy.
// Where this copy of the site has no server AI (static hosts without the
// endpoint, the extension, offline), it says the AI tools can't run here.
// `task` picks the wording ("chat", "summarize", "translate").
export function AiNotice({ task }: { task: string }) {
  const { t, href } = useI18n();
  const [here, setHere] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    import("@/lib/ai/cloud").then((c) => c.cloudAvailable()).then((ok) => live && setHere(ok));
    return () => {
      live = false;
    };
  }, []);

  if (here === null) return null;
  return (
    <section aria-labelledby="ai-notice" className="mt-6 border-t border-line pt-5" data-ai-notice={here ? "server" : "unavailable"}>
      <p id="ai-notice" className="flex items-center gap-1.5 text-[14px] font-medium"><Cloud size={15} /> {t("ai.server")}</p>
      {here ? (
        <div className="mt-2 text-[13px] leading-relaxed text-ink-2">
          <p>{t(`ai.server.sends.${task}`)}</p>
          <p className="mt-1.5">{t("ai.server.who")}</p>
          <a className="mt-1.5 inline-block underline underline-offset-2 hover:text-ink" href={`${href("/privacy")}#ai`}>{t("ai.server.more")}</a>
        </div>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t("ai.unavailable")}</p>
      )}
    </section>
  );
}
