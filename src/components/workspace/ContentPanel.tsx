"use client";

import { useRef } from "react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, BringToFront, FlipHorizontal2, FlipVertical2, ImageUp, Loader2,
  RotateCcw, RotateCcwSquare, RotateCwSquare, SendToBack, Trash2, Undo2,
} from "lucide-react";
import type { Align, EditorItem } from "@/lib/pdf/edit";
import { colorKey } from "@/lib/colors";
import { useI18n } from "../I18n";
import { isFor, targetLabel, targetsOf, type ContentTarget, type PageContent } from "./ContentLayer";

const COLORS = ["#111827", "#d33f6a", "#2f6fed", "#12a37f", "#e2662b", "#7b4fe0", "#ffffff"];
const ALIGNS: { a: Align; icon: React.ReactNode; key: string }[] = [
  { a: "left", icon: <AlignLeft size={16} />, key: "ed.alignLeft" },
  { a: "center", icon: <AlignCenter size={16} />, key: "ed.alignCenter" },
  { a: "right", icon: <AlignRight size={16} />, key: "ed.alignRight" },
  { a: "justify", icon: <AlignJustify size={16} />, key: "ed.alignJustify" },
];

// Turns an angle into -180..180.
const wrapAngle = (d: number) => ((((d % 360) + 540) % 360) - 180);

// Edit PDF's Edit content tool in the side panel: what the selected paragraph
// or object can have changed, and a list of everything on the page (for
// things hidden under others, or too small to click).
export function ContentPanel({
  content, item, items, status, pageAspect, onPick, update, restore,
}: {
  content: PageContent | "busy" | null;
  item: EditorItem | null; // the selected paraEdit or objEdit
  items: EditorItem[]; // this page's
  // The preview of the changes: being made, failed (with why), or a note on fonts.
  status: { busy: boolean; error: string | null; note: string | null };
  pageAspect: number; // the page's height ÷ width
  onPick: (t: ContentTarget, edit: boolean) => void;
  update: (p: Partial<EditorItem>, record?: boolean) => void;
  restore: () => void;
}) {
  const { t } = useI18n();
  const picture = useRef<HTMLInputElement>(null);

  const list = content && content !== "busy" ? targetsOf(content) : [];
  const swatches = (value: string | null | undefined, set: (c: string) => void, label: string) => (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {COLORS.map((c) => (
        <button key={c} aria-label={`${label}: ${t(colorKey(c))}`} aria-pressed={value?.toLowerCase() === c}
          onClick={() => set(c)}
          className="h-7 w-7 rounded-full border border-line ring-offset-2 ring-offset-[var(--surface)] aria-pressed:ring-2 aria-pressed:ring-[var(--ink)]" style={{ background: c }} />
      ))}
      <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : "#000000"}
        onChange={(e) => set(e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent p-0" />
    </div>
  );

  const src = item?.source;
  const text = item?.kind === "paraEdit";

  return (
    <div className="space-y-4" aria-live="polite">
      {!item && (
        <p className="text-[14px] text-muted">
          {content === "busy" ? <><Loader2 size={14} className="me-1.5 inline animate-spin" />{t("ed.reading")}</>
            : list.length === 0 ? t("ed.noContent") : t("ed.editContentHint")}
        </p>
      )}

      {item && src && item.removed && (
        <div className="space-y-3">
          <p className="text-[14px] text-ink-2">{t("ed.deleted")}</p>
          <button className="btn btn-quiet btn-sm" onClick={restore}><RotateCcw size={15} /> {t("ed.restoreText")}</button>
        </div>
      )}

      {item && src && !item.removed && text && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink-2">{t("ed.paragraphText")}</span>
            <textarea className="field min-h-[96px] w-full resize-y py-2 text-[14px] leading-snug" value={item.text ?? ""}
              onChange={(e) => update({ text: e.target.value }, false)} onBlur={() => update({}, true)} />
          </label>
          {src.font && <p className="text-[13px] text-muted">{t("ed.fontKept", { font: src.font })}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              {t("ed.fontSize")}
              <input type="number" min={4} max={200} step={0.5} className="field h-9 w-20"
                value={Math.round((item.fontSize ?? src.size ?? 12) * 10) / 10}
                onChange={(e) => { const v = Number(e.target.value); if (v >= 4 && v <= 200) update({ fontSize: v }); }} />
            </label>
            <div className="flex gap-1" role="group" aria-label={t("ed.align")}>
              {ALIGNS.map((x) => (
                <button key={x.a} className="icon-btn border border-line" aria-label={t(x.key)} title={t(x.key)} aria-pressed={(item.align ?? src.align) === x.a}
                  onClick={() => update({ align: x.a })}>{x.icon}</button>
              ))}
            </div>
          </div>
          {swatches(item.color, (c) => update({ color: c }), t("ed.color"))}
          <p className="text-[13px] text-muted">{t("ed.paragraphHint")}</p>
        </div>
      )}

      {item && src && !item.removed && !text && (
        <div className="space-y-3">
          <p className="text-[14px] font-medium text-ink">
            {targetLabel({ obj: { index: src.index, sig: src.sig ?? "", kind: src.kind ?? "path", box: item, angle: 0, fill: null, stroke: null, strokeWidth: 0, pixels: src.pixels } }, t)}
          </p>
          {src.kind === "image" && (
            <>
              <button className="btn btn-quiet btn-sm" onClick={() => picture.current?.click()}><ImageUp size={15} /> {t("ed.replaceImage")}</button>
              <input ref={picture} type="file" accept="image/*" hidden aria-label={t("ed.replaceImage")} onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const url = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(f); });
                // The new picture fills the old one's box, keeping its own proportions inside it.
                const bmp = await createImageBitmap(f).catch(() => null);
                if (!bmp) return;
                const ratio = bmp.height / bmp.width;
                bmp.close();
                let { x, y, w, h } = item;
                const boxRatio = (h * pageAspect) / w; // the box's height ÷ width on the page
                if (ratio > boxRatio) { const nw = (h * pageAspect) / ratio; x += (w - nw) / 2; w = nw; }
                else { const nh = (w * ratio) / pageAspect; y += (h - nh) / 2; h = nh; }
                update({ image: url, x, y, w, h });
              }} />
            </>
          )}
          {src.kind === "path" && (
            <>
              <div>
                <p className="mb-1.5 text-[13px] text-ink-2">{t("ed.fill")}</p>
                {swatches(item.fill, (c) => update({ fill: c }), t("ed.fill"))}
              </div>
              <div>
                <p className="mb-1.5 text-[13px] text-ink-2">{t("ed.outline")}</p>
                {swatches(item.color, (c) => update({ color: c }), t("ed.outline"))}
              </div>
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                {t("ed.stroke")}
                <input type="range" min={0} max={12} step={0.25} className="flex-1 accent-[var(--accent)]" value={item.stroke ?? src.stroke ?? 1}
                  onChange={(e) => update({ stroke: Number(e.target.value) }, false)} onPointerUp={() => update({}, true)} />
                <span className="tabular w-8 text-end">{item.stroke ?? src.stroke ?? 1}</span>
              </label>
            </>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <button className="icon-btn border border-line" aria-label={t("ed.rotateLeft")} title={t("ed.rotateLeft")} onClick={() => update({ rotate: wrapAngle((item.rotate ?? 0) + 90) })}><RotateCcwSquare size={16} /></button>
            <button className="icon-btn border border-line" aria-label={t("ed.rotateRight")} title={t("ed.rotateRight")} onClick={() => update({ rotate: wrapAngle((item.rotate ?? 0) - 90) })}><RotateCwSquare size={16} /></button>
            <button className="icon-btn border border-line" aria-label={t("ed.flipH")} title={t("ed.flipH")} aria-pressed={Boolean(item.flipX)} onClick={() => update({ flipX: !item.flipX })}><FlipHorizontal2 size={16} /></button>
            <button className="icon-btn border border-line" aria-label={t("ed.flipV")} title={t("ed.flipV")} aria-pressed={Boolean(item.flipY)} onClick={() => update({ flipY: !item.flipY })}><FlipVertical2 size={16} /></button>
            <label className="ms-1 flex items-center gap-1.5 text-[13px] text-ink-2">
              {t("ed.angle")}
              <input type="number" min={-180} max={180} step={1} className="field h-9 w-20" value={Math.round(item.rotate ?? 0)}
                onChange={(e) => update({ rotate: wrapAngle(Number(e.target.value) || 0) })} />
            </label>
          </div>
          {src.kind === "image" && <p className="text-[13px] text-muted">{t("ed.ratioHint")}</p>}
        </div>
      )}

      {item && src && !item.removed && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <button className="btn btn-quiet btn-sm" aria-pressed={item.order === "front"} onClick={() => update({ order: item.order === "front" ? undefined : "front" })}>
            <BringToFront size={15} /> {t("ed.bringToFront")}
          </button>
          <button className="btn btn-quiet btn-sm" aria-pressed={item.order === "back"} onClick={() => update({ order: item.order === "back" ? undefined : "back" })}>
            <SendToBack size={15} /> {t("ed.sendToBack")}
          </button>
          <button className="btn btn-quiet btn-sm text-danger" onClick={() => update({ removed: true })}>
            <Trash2 size={15} /> {t("ed.deleteItem")}
          </button>
          <button className="btn btn-quiet btn-sm" onClick={restore}>
            <Undo2 size={15} /> {t("ed.restoreText")}
          </button>
        </div>
      )}

      {status.busy && <p role="status" className="text-[13px] text-muted"><Loader2 size={13} className="me-1.5 inline animate-spin" />{t("ed.previewing")}</p>}
      {status.error && <p role="alert" className="rounded-xl bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] p-3 text-[13px] text-danger">{status.error}</p>}
      {status.note && <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">{status.note}</p>}
      {item?.kind === "paraEdit" && content && content !== "busy" && (() => {
        const p = content.paragraphs.find((q) => isFor(item, { para: q }));
        return (
          <>
            {p?.mixed && <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">{t("ed.mixedStyle")}</p>}
            {p?.invisible && <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">{t("ed.invisibleText")}</p>}
          </>
        );
      })()}

      {list.length > 0 && (
        <details className="border-t border-line pt-4" open={list.length <= 12}>
          <summary className="cursor-pointer text-[13px] font-medium text-ink-2">{t("ed.onThisPage", { n: list.length })}</summary>
          <ul className="mt-2 max-h-[260px] space-y-0.5 overflow-auto pe-1" data-objects-list>
            {[...list].reverse().map((x) => {
              const have = items.find((i) => isFor(i, x));
              const key = "para" in x ? `p${x.para.parts[0].index}:${x.para.parts[0].sig}` : `o${x.obj.index}:${x.obj.sig}`;
              return (
                <li key={key}>
                  <button className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[13px] hover:bg-surface-2 ${have && have.id === item?.id ? "bg-surface-2 font-medium" : ""}`}
                    onClick={() => onPick(x, false)}>
                    <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-muted">{"para" in x ? t("ed.objText") : t(x.obj.kind === "image" ? "ed.objImage" : x.obj.kind === "path" ? "ed.objShape" : x.obj.kind === "shading" ? "ed.objGradient" : "ed.objGraphic")}</span>
                    <span className={`min-w-0 flex-1 truncate ${have?.removed ? "text-muted line-through" : ""}`}>{"para" in x ? (have && !have.removed ? have.text || targetLabel(x, t) : targetLabel(x, t)) : x.obj.pixels ? `${x.obj.pixels[0]}×${x.obj.pixels[1]}` : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
