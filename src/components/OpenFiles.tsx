"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import { useI18n } from "./I18n";
import { ToolIcon } from "./ToolIcon";
import { handOffTo, markOpenedFromOutside, stashShared, takeShared, toolsFor } from "@/lib/handoff";
import { hasLocale } from "@/lib/i18n/locales";
import { BRAND } from "@/lib/brand";
import { toolById, type Tool } from "@/lib/tools";

// What Chrome hands an installed app opened from a file ("Open with"), per
// the manifest's file_handlers.
type LaunchParams = { files: readonly FileSystemHandle[] };
// The Android app's own web view (android/app/src/main/java/dev/pages/nopload/WebApp.java),
// which has no launchQueue, hands over the files Android opened or shared with
// it once, as base64: { launched, files: [{ name, type, data }] }.
type AppFiles = { launched: boolean; files: { name: string; type: string; data: string }[] };
declare global {
  interface Window {
    launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
    NoploadApp?: { takeFiles(): string };
  }
}

function fromApp(): { files: File[]; launched: boolean } | null {
  try {
    const got = window.NoploadApp ? (JSON.parse(window.NoploadApp.takeFiles()) as AppFiles) : null;
    if (!got?.files?.length) return null;
    const files = got.files.map((f) => {
      const bin = atob(f.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new File([bytes], f.name, { type: f.type === "null" ? "" : f.type });
    });
    return { files, launched: !!got.launched };
  } catch {
    return null;
  }
}

const ACCEPT = ".pdf,image/*,.heic,.docx";
const LAUNCHED = "nopload:launched";

function lastLocale() {
  try {
    return localStorage.getItem("locale");
  } catch {
    return null;
  }
}

// /{lang}/open: files shared to the installed app (the service worker keeps
// them, see public/sw.js) or opened with it, and the tools that take them.
// Picking one hands the files over (src/lib/handoff.ts).
export function OpenFiles() {
  const { t, locale, href } = useI18n();
  const router = useRouter();
  const [files, setFiles] = useState<File[] | null>(null);
  // The language used last, read before this page remembers its own.
  const [saved] = useState(lastLocale);
  // The viewer first: opening a PDF is most often to read it.
  const tools = useMemo(() => toolsFor(files ?? []).sort((a, b) => Number(b.id === "view") - Number(a.id === "view")), [files]);

  useEffect(() => {
    let live = true;
    // launched: opened with the app from the file manager ("Open with"). One
    // PDF opened that way goes straight to the viewer.
    const arrive = async (incoming: File[], launched = false) => {
      if (!live || !incoming.length) return;
      // "Open with" always lands on /en/open: follow the visitor's language.
      if (saved && saved !== locale && hasLocale(saved)) {
        live = false;
        await stashShared(incoming);
        // Still opened with the app after the move: it goes on to the viewer there.
        if (launched) try { sessionStorage.setItem(LAUNCHED, "1"); } catch { /* storage blocked */ }
        try {
          localStorage.setItem("locale", saved);
        } catch {
          /* storage blocked */
        }
        location.replace(`/${saved}/open`);
        return;
      }
      if (launched && incoming.length === 1 && /\.pdf$/i.test(incoming[0].name)) {
        live = false;
        markOpenedFromOutside();
        void handOffTo("view", incoming);
        router.replace(href(`/${toolById("view").slug}`));
        return;
      }
      setFiles(incoming);
    };
    void takeShared().then((shared) => {
      let launched = false;
      try {
        launched = sessionStorage.getItem(LAUNCHED) === "1";
        sessionStorage.removeItem(LAUNCHED);
      } catch {
        // Storage blocked: the tools are offered instead.
      }
      return shared.length ? arrive(shared, launched) : live && setFiles((f) => f ?? []);
    });
    const app = fromApp();
    if (app) void arrive(app.files, app.launched);
    window.launchQueue?.setConsumer((params) => {
      const handles = params.files.filter((h): h is FileSystemFileHandle => h.kind === "file");
      void Promise.all(handles.map((h) => h.getFile())).then((f) => arrive(f, true));
    });
    return () => {
      live = false;
    };
  }, [locale, saved, router, href]);

  const open = async (tool: Tool) => {
    if (!files) return;
    void handOffTo(tool.id, files);
    router.push(href(`/${tool.slug}`));
  };

  const size = new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 });

  return (
    <div className="mx-auto max-w-[860px] px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
      <h1 className="display text-[2.4rem] sm:text-[3.4rem]">{t("open.title")}</h1>
      <p className="mt-4 max-w-[560px] text-pretty text-[17px] leading-relaxed text-ink-2">{t("open.subtitle")}</p>

      <div className="mt-10">
        {files?.length ? (
          <ul aria-label={t("open.files")} className="divide-y divide-line border-y border-line">
            {files.map((f, i) => (
              <li key={`${i}:${f.name}`} className="flex items-center gap-3 py-3">
                <FileText size={18} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{f.name}</span>
                <span className="shrink-0 text-[13px] tabular-nums text-muted">{size.format(f.size / 1024 / 1024)}</span>
              </li>
            ))}
          </ul>
        ) : (
          files && <p className="text-pretty text-[15px] text-ink-2">{t("open.empty", { brand: BRAND.name })}</p>
        )}
        <label className={`btn mt-4 inline-flex cursor-pointer ${files?.length ? "btn-quiet btn-sm" : "btn-primary"}`}>
          <Upload size={15} aria-hidden /> {t("ws.select")}
          <input
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])];
              if (picked.length) setFiles(picked);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {!!files?.length && (
        <section className="mt-12">
          <h2 className="eyebrow mb-3">{t("open.tools")}</h2>
          {tools.length ? (
            <ul aria-label={t("open.tools")} className="grid gap-2 sm:grid-cols-2">
              {tools.map((tool) => (
                <li key={tool.id}>
                  <a
                    href={href(`/${tool.slug}`)}
                    onClick={(e) => {
                      e.preventDefault();
                      void open(tool);
                    }}
                    className="group card flex items-center gap-3 p-3 transition-colors hover:border-line-strong"
                  >
                    <ToolIcon tool={tool} size={32} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{t(`tool.${tool.id}.name`)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-pretty text-[15px] text-ink-2">{t("open.noTool")}</p>
          )}
        </section>
      )}
    </div>
  );
}
