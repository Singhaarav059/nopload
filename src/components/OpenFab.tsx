"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { useI18n } from "./I18n";
import { ToolIcon } from "./ToolIcon";
import { handOffTo, toolsFor } from "@/lib/handoff";
import { useDialog } from "@/lib/useDialog";
import { haptic } from "@/lib/device";
import type { Tool } from "@/lib/tools";

// The jobs people come for most, first.
const FIRST = ["view", "compress", "merge", "split", "edit", "sign", "pdfToWord", "jpgToPdf", "protect", "chat", "summarize", "rotate", "organize", "pdfToJpg", "ocr"];
const rank = (t: Tool) => {
  const i = FIRST.indexOf(t.id);
  return i < 0 ? FIRST.length : i;
};

// Phones: the orange button at the bottom of the home page. It opens files,
// then asks what to do with them: the tools that take them, in a sheet.
// Choosing one hands the files over (src/lib/handoff.ts).
export function OpenFab() {
  const { t, href } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[] | null>(null);
  const close = () => setFiles(null);
  const sheet = useDialog<HTMLDivElement>(!!files, close);
  // While it's open, the page under it stays put and the button hides.
  useEffect(() => {
    if (!files) return;
    document.documentElement.dataset.sheet = "";
    return () => {
      delete document.documentElement.dataset.sheet;
    };
  }, [files]);
  const tools = files ? [...toolsFor(files)].sort((a, b) => rank(a) - rank(b)) : [];

  const open = (tool: Tool) => {
    if (!files) return;
    haptic();
    void handOffTo(tool.id, files);
    router.push(href(`/${tool.slug}`));
  };

  return (
    <>
      <div aria-hidden className="fab-room" />
      <button type="button" data-fab className="fab" aria-label={t("app.open")} onClick={() => { haptic(); input.current?.click(); }}>
        <Plus size={26} strokeWidth={2.4} />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept=".pdf,image/*,.heic,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.odt,.ods,.odp,.rtf,.txt,.html,.epub"
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          if (list.length) setFiles(list);
        }}
      />
      {files && (
        <div className="app-sheet-wrap" data-phone>
          <button type="button" aria-label={t("nav.close")} className="app-sheet-scrim" onClick={close} tabIndex={-1} />
          <div ref={sheet} role="dialog" aria-modal aria-label={t("app.pickTool")} data-fab-sheet className="app-sheet">
            <span aria-hidden className="app-sheet-handle" />
            <div className="flex items-start gap-3 px-5 pb-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[1.15rem] font-semibold tracking-[-0.02em]">{t("app.pickTool")}</h2>
                <p className="mt-0.5 truncate text-[13.5px] text-muted">{files.length > 1 ? `${files[0].name} +${files.length - 1}` : files[0].name}</p>
              </div>
              <button type="button" className="icon-btn" aria-label={t("nav.close")} onClick={close}><X size={20} /></button>
            </div>
            <div className="app-sheet-body px-4 pb-6">
              {tools.length ? (
                <ul className="pick-grid">
                  {tools.map((tool) => (
                    <li key={tool.id}>
                      <a href={href(`/${tool.slug}`)} className="pick-card" onClick={(e) => { e.preventDefault(); open(tool); }}>
                        <ToolIcon tool={tool} size={40} />
                        <span className="line-clamp-2 text-[14px] font-medium leading-tight">{t(`tool.${tool.id}.name`)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-1 text-pretty text-[15px] text-ink-2">{t("open.noTool")}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
