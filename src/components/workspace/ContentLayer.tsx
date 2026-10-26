"use client";

import { useRef } from "react";
import { RotateCw } from "lucide-react";
import type { ContentObject, EditorItem, FracRect, Paragraph } from "@/lib/pdf/edit";
import type { ScanLine } from "@/lib/pdf/scanedit";
import { useI18n } from "../I18n";

// Edit PDF's Edit content tool on the page: every paragraph and object the
// page draws, to click; the ones being changed, with handles to move, resize
// and turn them; and a paragraph being typed in, wrapped at its width. What
// the changes look like comes from the edited file itself (Editor's preview),
// so this layer draws only outlines, handles and the text being typed.

// `scan`: a scanned page's lines, once read with OCR.
export type PageContent = { page: number; objects: ContentObject[]; paragraphs: Paragraph[]; scan?: ScanLine[] };
export type ContentTarget = { para: Paragraph } | { obj: ContentObject } | { scan: ScanLine };

// A page that's a picture of text: a picture over half of it, and no text that shows.
export const isScan = (c: PageContent) =>
  c.objects.some((o) => o.kind === "image" && o.box.w * o.box.h > 0.5) && !c.paragraphs.some((p) => !p.invisible);

export const keyOf = (x: ContentTarget) => ("para" in x ? `p${x.para.parts[0].index}:${x.para.parts[0].sig}` : "obj" in x ? `o${x.obj.index}:${x.obj.sig}` : x.scan.key);
export const boxOf = (x: ContentTarget) => ("para" in x ? x.para.box : "obj" in x ? x.obj.box : x.scan.box);

const uid = () => crypto.randomUUID();

// A CSS stand-in for a PDF font, for text being typed.
export const cssFamily = (font = "") =>
  /mono|courier|cousine|consol/i.test(font) ? "'Courier New', Cousine, monospace"
  : /times|serif|tinos|georgia|roman|garamond|cambria|caladea|mincho|song|batang/i.test(font) && !/sans/i.test(font) ? "'Times New Roman', Tinos, serif"
  : "Helvetica, Arial, Arimo, sans-serif";

// The editor item that changes a paragraph or an object, starting as it is.
export function itemFor(page: number, t: ContentTarget): EditorItem {
  if ("scan" in t) {
    const l = t.scan;
    return {
      id: uid(), page, kind: "scanEdit", ...l.box, text: l.text, fontSize: l.size, color: l.ink, fill: l.paper, family: l.family,
      source: { index: -1, sig: l.key, was: l.text, ...l.box, size: l.size, color: l.ink, fill: l.paper, font: l.family },
    };
  }
  if ("para" in t) {
    const p = t.para;
    return {
      id: uid(), page, kind: "paraEdit", ...p.box, text: p.text, fontSize: p.size, color: p.color, bold: p.bold, align: p.align,
      source: { index: p.parts[0].index, sig: p.parts[0].sig, parts: p.parts, was: p.text, ...p.box, size: p.size, color: p.color, align: p.align, angle: p.angle, font: p.font, lines: p.lines },
    };
  }
  const o = t.obj;
  return {
    id: uid(), page, kind: "objEdit", ...o.box, fill: o.fill, color: o.stroke ?? undefined, stroke: o.strokeWidth,
    source: { index: o.index, sig: o.sig, kind: o.kind, was: "", ...o.box, fill: o.fill, color: o.stroke ?? undefined, stroke: o.strokeWidth, angle: o.angle, pixels: o.pixels },
  };
}

// Whether an item changes this target.
export const isFor = (i: EditorItem, t: ContentTarget) =>
  "scan" in t ? i.kind === "scanEdit" && i.source?.sig === t.scan.key
  : "para" in t ? i.kind === "paraEdit" && i.source?.index === t.para.parts[0].index && i.source.sig === t.para.parts[0].sig
  : i.kind === "objEdit" && i.source?.index === t.obj.index && i.source.sig === t.obj.sig;

export function targetLabel(t: ContentTarget, tr: (k: string) => string) {
  if ("scan" in t) return t.scan.text.length > 60 ? `${t.scan.text.slice(0, 60)}…` : t.scan.text;
  if ("para" in t) return t.para.text.length > 60 ? `${t.para.text.slice(0, 60)}…` : t.para.text;
  const o = t.obj;
  const name = tr(o.kind === "image" ? "ed.objImage" : o.kind === "path" ? "ed.objShape" : o.kind === "shading" ? "ed.objGradient" : o.kind === "text" ? "ed.objText" : "ed.objGraphic");
  return o.pixels ? `${name} ${o.pixels[0]}×${o.pixels[1]}` : name;
}

// Everything on the page that can be picked, the biggest first so smaller
// things on top of it stay clickable; text over everything.
// A drawing with tens of thousands of tiny shapes (a map, a CAD plan) offers
// its largest MAX_OBJECTS: the page stays responsive, and the rest are too
// small to pick one by one anyway.
const MAX_OBJECTS = 600, MAX_PARAGRAPHS = 1500;
export function targetsOf(c: PageContent): ContentTarget[] {
  const objects = c.objects.filter((o) => o.kind !== "text").sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h).slice(0, MAX_OBJECTS);
  // On a scan that's been read, its lines (the picture itself stays pickable under them).
  return [...objects.map((obj) => ({ obj })), ...c.paragraphs.slice(0, MAX_PARAGRAPHS).map((para) => ({ para })), ...(c.scan ?? []).map((scan) => ({ scan }))];
}

const pct = (v: number) => `${v * 100}%`;
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

export function ContentLayer({
  content, items, sel, editing, stage, ptToPx, pageHeight, onPick, onSelect, onEdit, update, snapshot,
}: {
  content: PageContent;
  items: EditorItem[]; // this page's paraEdit and objEdit items
  sel: string | null;
  editing: string | null;
  stage: React.RefObject<HTMLDivElement | null>;
  ptToPx: number;
  pageHeight: number; // px
  onPick: (t: ContentTarget, edit: boolean) => void;
  onSelect: (id: string) => void;
  onEdit: (id: string | null) => void;
  update: (id: string, p: Partial<EditorItem>, record: boolean) => void;
  snapshot: () => void;
}) {
  const { t } = useI18n();
  const drag = useRef<null | { id: string; mode: "move" | "rotate" | string; x0: number; y0: number; orig: FracRect; angle0: number; rot0: number; ratio: boolean; slop: number; sx: number; sy: number; moved: boolean }>(null);

  // The last press on a target was a finger's.
  const touched = useRef(false);

  const frac = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r };
  };

  const start = (e: React.PointerEvent, it: EditorItem, mode: string) => {
    if (e.button !== 0 || editing === it.id) return;
    e.stopPropagation();
    // A finger on something not yet selected selects it and no more: the
    // page scrolls on under it, and nothing moves by accident.
    if (e.pointerType === "touch" && mode === "move" && sel !== it.id) {
      onSelect(it.id);
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSelect(it.id);
    snapshot();
    const p = frac(e);
    const cx = (it.x + it.w / 2) * p.r.width, cy = (it.y + it.h / 2) * p.r.height;
    drag.current = {
      id: it.id, mode, x0: p.x, y0: p.y, orig: { x: it.x, y: it.y, w: it.w, h: it.h },
      angle0: Math.atan2(p.y * p.r.height - cy, p.x * p.r.width - cx), rot0: it.rotate ?? 0,
      // Pictures keep their proportions from a corner, unless Shift is held.
      ratio: it.source?.kind === "image" && mode.length === 2,
      slop: e.pointerType === "touch" ? 8 : 3, sx: e.clientX, sy: e.clientY, moved: false,
    };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    // A press that barely moves is a tap: nothing moves.
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < d.slop) return;
    d.moved = true;
    const p = frac(e);
    const dx = p.x - d.x0, dy = p.y - d.y0, o = d.orig;
    if (d.mode === "move") {
      update(d.id, { x: Math.min(1 - o.w * 0.2, Math.max(-o.w * 0.8, o.x + dx)), y: Math.min(1 - o.h * 0.2, Math.max(-o.h * 0.8, o.y + dy)) }, false);
    } else if (d.mode === "rotate") {
      const cx = (o.x + o.w / 2) * p.r.width, cy = (o.y + o.h / 2) * p.r.height;
      const a = Math.atan2(p.y * p.r.height - cy, p.x * p.r.width - cx);
      // Screen angles run clockwise; the item's rotation counter-clockwise.
      let deg = d.rot0 - ((a - d.angle0) * 180) / Math.PI;
      deg = ((deg % 360) + 540) % 360 - 180;
      const snap = Math.round(deg / 45) * 45;
      if (!e.shiftKey && Math.abs(deg - snap) < 4) deg = snap;
      update(d.id, { rotate: Math.round(deg * 10) / 10 }, false);
    } else {
      const r = resize(o, d.mode, dx, dy);
      if (d.ratio && !e.shiftKey && o.w > 0 && o.h > 0) {
        // The larger change wins; the other side follows, anchored at the opposite corner.
        const s = Math.max(r.w / o.w, r.h / o.h);
        const w = o.w * s, h = o.h * s;
        r.x = d.mode.includes("w") ? o.x + o.w - w : o.x;
        r.y = d.mode.includes("n") ? o.y + o.h - h : o.y;
        r.w = w;
        r.h = h;
      }
      update(d.id, r, false);
    }
  };

  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    e.stopPropagation();
    drag.current = null;
  };

  const targets = targetsOf(content).filter((x) => !items.some((i) => isFor(i, x)));
  const minBox = { minWidth: 6, minHeight: 6 };

  return (
    <>
      {/* What can be picked */}
      {targets.map((x) => {
        const box = boxOf(x);
        const text = !("obj" in x);
        const label = `${text ? t("ed.objText") : t("ed.object")}: ${targetLabel(x, t)}`;
        return (
          <button key={keyOf(x)} type="button" aria-label={label} title={targetLabel(x, t)}
            data-content={"para" in x ? "text" : "scan" in x ? "scan" : x.obj.kind}
            className={`absolute rounded-[2px] outline-dashed outline-1 hover:bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] hover:outline-2 focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${text ? "cursor-text outline-[color-mix(in_oklab,var(--accent)_55%,transparent)]" : "cursor-pointer outline-[color-mix(in_oklab,var(--accent)_30%,transparent)]"}`}
            style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h), ...minBox }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              touched.current = e.pointerType === "touch";
              if (touched.current) return;
              e.preventDefault();
              onPick(x, false);
            }}
            // A tap (a mouse press picked it already; the keyboard has its own).
            onClick={() => touched.current && onPick(x, false)}
            onDoubleClick={() => text && onPick(x, true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(x, text);
              }
            }} />
        );
      })}

      {/* What's being changed */}
      {items.map((it) => {
        const isSel = sel === it.id;
        const src = it.source!;
        const scan = it.kind === "scanEdit";
        const text = it.kind === "paraEdit" || scan;
        const rotate = it.rotate ?? 0;
        const style: React.CSSProperties = {
          left: pct(it.x), top: pct(it.y), width: pct(it.w), height: pct(it.h), ...minBox,
          transform: rotate ? `rotate(${-rotate}deg)` : undefined,
        };
        if (it.removed) {
          return (
            <div key={it.id} role="button" tabIndex={0} data-content-item={src.kind ?? "text"} data-removed aria-label={`${t("ed.deleted")}: ${t(text ? "ed.objText" : "ed.object")}`}
              className={`absolute border border-dashed border-[var(--danger)] bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] ${isSel ? "outline outline-2 outline-offset-2 outline-[var(--accent)]" : ""}`}
              style={style} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onSelect(it.id); }} onFocus={() => onSelect(it.id)} />
          );
        }
        if (editing === it.id && scan) {
          const fs = (it.fontSize ?? src.size ?? 12) * ptToPx;
          // Opaque, in the paper's colour: the old line stays under it until the page is redrawn.
          return (
            <input key={it.id} data-content-editing aria-label={t("ed.paragraphText")}
              ref={(el) => { if (el && document.activeElement !== el) el.focus(); }}
              value={it.text ?? ""}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => update(it.id, { text: e.target.value }, false)}
              onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter") e.currentTarget.blur(); }}
              onBlur={() => onEdit(null)}
              className="absolute z-10 p-0 outline outline-2 outline-offset-2 outline-[var(--accent)]"
              style={{
                left: pct(it.x), top: pct(it.y), minWidth: pct(it.w), height: pct(it.h), width: `${Math.max(4, (it.text ?? "").length * 0.55)}em`,
                fontSize: fs, lineHeight: 1, color: it.color, background: it.fill ?? "#fff", fontFamily: cssFamily(it.family === "tinos" ? "Times" : it.family === "cousine" ? "Courier" : ""),
              }} />
          );
        }
        if (editing === it.id && text) {
          const fs = (it.fontSize ?? src.size ?? 12) * ptToPx;
          const lines = src.lines ?? 1;
          // The paragraph's own line spacing, when it has more than one line.
          // (The box runs from the first line's tops to the last line's descenders, about one size.)
          const lineHeight = lines > 1 ? Math.max(fs * 1.05, ((src.h ?? it.h) * pageHeight - fs * 0.95) / (lines - 1)) : fs * 1.2;
          return (
            <textarea key={it.id} data-content-editing aria-label={t("ed.paragraphText")}
              ref={(el) => {
                if (!el) return;
                if (document.activeElement !== el) {
                  el.focus();
                  el.setSelectionRange(el.value.length, el.value.length);
                }
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }}
              value={it.text ?? ""}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => update(it.id, { text: e.target.value }, false)}
              onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }}
              onBlur={() => onEdit(null)}
              className="absolute z-10 resize-none overflow-hidden bg-[color-mix(in_oklab,var(--accent)_5%,transparent)] p-0 outline outline-2 outline-offset-2 outline-[var(--accent)]"
              style={{
                left: pct(it.x), top: pct(it.y), width: pct(it.w), minHeight: pct(it.h),
                fontSize: fs, lineHeight: `${Math.min(lineHeight, fs * 2.2)}px`, color: it.color, fontWeight: it.bold ? 700 : 400,
                fontFamily: cssFamily(src.font), textAlign: it.align === "justify" ? "justify" : it.align ?? "left",
              }} />
          );
        }
        // Text resizes across (its width is where it wraps, or a scan line's room); everything else on every side.
        const handles = text ? (["e", "w"] as const) : HANDLES;
        return (
          <div key={it.id} role="button" tabIndex={0} data-content-item={src.kind ?? "text"} data-selected={isSel || undefined}
            aria-label={`${t(text ? "ed.objText" : "ed.object")}: ${text ? it.text : t(src.kind === "image" ? "ed.objImage" : "ed.objShape")}`}
            className={`absolute ${isSel ? "outline outline-2 outline-[var(--accent)]" : "outline-dashed outline-1 outline-[var(--accent)]"} ${text ? "cursor-text" : "cursor-move"}`}
            style={{ ...style, touchAction: isSel ? "none" : undefined }}
            onFocus={() => onSelect(it.id)}
            onPointerDown={(e) => start(e, it, "move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            onDoubleClick={() => text && onEdit(it.id)}
            onKeyDown={(e) => { if (e.key === "Enter" && text) { e.preventDefault(); onEdit(it.id); } }}>
            {isSel && handles.map((h) => (
              <span key={h} aria-hidden onPointerDown={(e) => start(e, it, h)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                data-handle className="absolute h-3.5 w-3.5 rounded-full border-2 border-white bg-accent shadow"
                style={{
                  left: h.includes("w") ? -7 : h.includes("e") ? "calc(100% - 7px)" : "calc(50% - 7px)",
                  top: h.includes("n") ? -7 : h.includes("s") ? "calc(100% - 7px)" : "calc(50% - 7px)",
                  cursor: `${h}-resize`, touchAction: "none",
                }} />
            ))}
            {isSel && !text && (
              <span aria-hidden title={t("ed.rotate")} onPointerDown={(e) => start(e, it, "rotate")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                data-handle className="absolute left-[calc(50%-11px)] top-[-34px] grid h-[22px] w-[22px] cursor-grab place-items-center rounded-full border-2 border-white bg-accent text-white shadow"
                style={{ touchAction: "none" }}>
                <RotateCw size={12} />
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

function resize(o: FracRect, handle: string, dx: number, dy: number): FracRect {
  let { x, y, w, h } = o;
  const min = 0.005;
  if (handle.includes("e")) w = Math.max(min, w + dx);
  if (handle.includes("s")) h = Math.max(min, h + dy);
  if (handle.includes("w")) { const nx = Math.min(x + w - min, x + dx); w += x - nx; x = nx; }
  if (handle.includes("n")) { const ny = Math.min(y + h - min, y + dy); h += y - ny; y = ny; }
  return { x, y, w, h };
}
