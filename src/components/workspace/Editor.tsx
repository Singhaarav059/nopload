"use client";

import { colorKey } from "@/lib/colors";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MousePointer2, Type, ImagePlus, Square, Circle, Minus, Pencil, Highlighter, Eraser, Undo2, Redo2, Trash2,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Signature as SignatureIcon, CalendarDays, Search, ScanEye, Crop as CropIcon,
  TextCursorInput, SquareCheck, Copy, Bold, Stamp, UserRound, Crosshair, CircleDot, SquareChevronDown, List, PenLine,
  LetterText, BringToFront, SendToBack, Loader2, ArrowUpRight, ShieldCheck, Underline as UnderlineIcon, Strikethrough, StickyNote, Link2, Check, X, Brush,
} from "lucide-react";
import { useI18n } from "../I18n";
import { SignaturePad, type SignatureImage } from "./SignaturePad";
import { DetectPanel, FIELD_LABELS, FieldInput, FieldPreview, FieldSettings, SuggestionBox, fieldShape, fieldSize, newField } from "./FormFields";
import type { Suggestion } from "@/lib/pdf/formsdetect";
import { CertificateSign, prepareCertificate, type CertChoice } from "./CertificateSign";
import { thumbUrl, pageSizes, docFor } from "@/lib/pdf/thumbs";
import type { EditorItem, FieldInfo, FracRect } from "@/lib/pdf/edit";
import { ContentLayer, itemFor, isFor, type ContentTarget, type PageContent } from "./ContentLayer";
import { ContentPanel } from "./ContentPanel";
import { contentChanged } from "@/lib/pdf/contentchange";
import { linkTarget } from "@/lib/pdf/links";
import { scratchOut, loop } from "@/lib/gestures";
import { haptic } from "@/lib/device";
import { AutofillPanel } from "./AutofillPanel";
import type { PresetName } from "@/lib/pdf/security";
import type { PageText } from "@/lib/pdf/text";
import { moveLayer } from "@/lib/pdf/layers";
import { parseRanges, type Output, type Progress } from "@/lib/pdf/common";
import { forFile } from "@/lib/pdf/errors";
import { isFieldKind, type FieldKind } from "@/lib/pdf/formsmeta";
import type { ToolId } from "@/lib/tools";

type EdTool = "select" | "editText" | "text" | "image" | "rect" | "ellipse" | "line" | "path" | "highlight" | "whiteout" | "redact" | "crop" | FieldKind | "place"
  | "erase" | "arrow" | "underline" | "strike" | "note" | "link" | "stamp" | "check" | "cross";
// Placed with a click at a fixed size (points): a note's icon, a mark, a stamp.
const POINT_SIZES: Partial<Record<EdTool, [number, number]>> = { note: [22, 22], check: [14, 14], cross: [14, 14], stamp: [150, 44] };
// Stamps: their words (in the page's language) and colours.
const STAMPS = [["approved", "#12a37f"], ["paid", "#12a37f"], ["received", "#2f6fed"], ["draft", "#2f6fed"], ["final", "#7b4fe0"], ["copy", "#e2662b"], ["confidential", "#d33f6a"], ["void", "#d33f6a"]] as const;
type Size = { w: number; h: number };
// Marks from a search keep the text matched, the search they came from (and
// its pattern, to run it again on the result) and how many boxes that text
// got in it, so the run can tell which texts are fully marked.
type Mark = { id: string; page: number; rect: FracRect; term?: string; search?: string; pattern?: RegExp; preset?: PresetName; of?: number };

const COLORS = ["#111827", "#d33f6a", "#2f6fed", "#12a37f", "#e2662b", "#7b4fe0", "#ffffff"];
const uid = () => crypto.randomUUID();
const PRESET_NAMES = ["emails", "phones", "numbers", "cards", "ibans", "aadhaar", "pan", "ssn", "dates"] as const satisfies readonly PresetName[];
// How an item on the page is announced.
const ITEM_LABELS: Record<EditorItem["kind"], string> = {
  text: "ed.text", image: "ed.image", rect: "ed.rect", ellipse: "ed.ellipse", line: "ed.line", path: "ed.draw",
  highlight: "ed.highlight", whiteout: "ed.whiteout", erase: "ed.erase", arrow: "ed.arrow", underline: "ed.underline", strike: "ed.strike",
  note: "ed.note", link: "ed.link", stamp: "ed.stampText", check: "ed.check", cross: "ed.cross", textEdit: "ed.editText", paraEdit: "ed.editText", objEdit: "ed.object", scanEdit: "ed.editText", ...FIELD_LABELS,
};
// Changes to the page's own content (Edit content), drawn by the preview rather than as items on top.
const isContent = (i: EditorItem) => i.kind === "textEdit" || i.kind === "paraEdit" || i.kind === "objEdit" || i.kind === "scanEdit";
// Pages a signature can be copied to.
const PLACEMENTS = ["all", "allButLast", "last", "custom"] as const;
type Placement = (typeof PLACEMENTS)[number];
const DATE_FORMATS = ["locale", "long", "iso", "dmy", "mdy"] as const;
type DateFormat = (typeof DATE_FORMATS)[number];

export function formatDate(d: Date, format: DateFormat, locale: string) {
  const two = (n: number) => String(n).padStart(2, "0");
  const [y, m, day] = [d.getFullYear(), two(d.getMonth() + 1), two(d.getDate())];
  if (format === "iso") return `${y}-${m}-${day}`;
  if (format === "dmy") return `${day}/${m}/${y}`;
  if (format === "mdy") return `${m}/${day}/${y}`;
  // Without the invisible direction marks some locales add (Arabic: "18\u200f/10\u200f/2026"),
  // which have no glyph: a numeric date stays real text in reading order, not a picture.
  return d.toLocaleDateString(locale, format === "long" ? { day: "numeric", month: "long", year: "numeric" } : undefined).replace(/[\u200e\u200f\u061c\u2066-\u2069]/g, "");
}

// The zero-based pages a placement covers, in order; empty when none match.
export function placementPages(placement: Placement, custom: string, total: number) {
  const all = Array.from({ length: total }, (_, i) => i);
  if (placement === "all") return all;
  if (placement === "allButLast") return all.slice(0, -1);
  if (placement === "last") return all.slice(-1);
  return [...new Set(parseRanges(custom, total).flat())].sort((a, b) => a - b);
}

// Puts `item` on exactly `pages`: it stays where it is if its page is one of
// them, otherwise it moves to the first; the other pages get copies.
export function placeOnPages<T extends { id: string; page: number }>(list: T[], item: T, pages: number[], newId: () => string): T[] {
  if (!pages.length) return list;
  const home = pages.includes(item.page) ? item.page : pages[0];
  return [
    ...list.map((i) => (i.id === item.id ? { ...i, page: home } : i)),
    ...pages.filter((p) => p !== home).map((p) => ({ ...item, id: newId(), page: p })),
  ];
}

function useHistory<T>(initial: T) {
  const [stack, setStack] = useState<{ past: T[]; now: T; future: T[] }>({ past: [], now: initial, future: [] });
  const set = useCallback((next: T | ((v: T) => T), record = true) => {
    setStack((s) => {
      const value = typeof next === "function" ? (next as (v: T) => T)(s.now) : next;
      return record ? { past: [...s.past.slice(-80), s.now], now: value, future: [] } : { ...s, now: value };
    });
  }, []);
  const undo = useCallback(() => setStack((s) => (s.past.length ? { past: s.past.slice(0, -1), now: s.past[s.past.length - 1], future: [s.now, ...s.future] } : s)), []);
  const redo = useCallback(() => setStack((s) => (s.future.length ? { past: [...s.past, s.now], now: s.future[0], future: s.future.slice(1) } : s)), []);
  return { value: stack.now, set, undo, redo, canUndo: stack.past.length > 0, canRedo: stack.future.length > 0 };
}

// Loads what saving loads, ahead of use (src/lib/offline.ts).
export const prepareEditor = (toolId: ToolId) =>
  Promise.all([import("@/lib/pdf/edit"), toolId === "redact" ? import("@/lib/pdf/security").then((s) => s.prepare()) : null, toolId === "sign" ? prepareCertificate() : null]);

// `others`: more files for a batch (crop, redact), which get the same crop box
// or the same searches as `file`, the one on the canvas.
export function Editor({
  toolId, file, others = [], options, actionLabel, onRun, onError,
}: {
  toolId: ToolId; file: File; others?: File[]; options: Record<string, unknown>; actionLabel: string;
  onRun: (job: (p: Progress) => Promise<Output[]>) => void;
  // The file can't be opened (not a PDF, damaged, password-protected).
  onError: (e: unknown) => void;
}) {
  const { t, locale } = useI18n();
  const [sizes, setSizes] = useState<Size[]>([]);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const [fit, setFit] = useState(640);
  const [rendered, setRendered] = useState<{ key: string; url: string } | null>(null);
  const items = useHistory<EditorItem[]>([]);
  const marks = useHistory<Mark[]>([]);
  const [crops, setCrops] = useState<Map<number, FracRect>>(new Map());
  // Edit PDF starts on Edit content: anything on the page, ready to click.
  const [tool, setTool] = useState<EdTool>(toolId === "redact" ? "redact" : toolId === "crop" ? "crop" : toolId === "sign" ? "place" : toolId === "edit" ? "editText" : "select");
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [style, setStyle] = useState({ color: "#111827", fill: null as string | null, stroke: 2, fontSize: 16, bold: false });
  // The Eraser's width, in points.
  const [eraserSize, setEraserSize] = useState(14);
  // The Eraser stroke under way, drawn as a track until it's lifted.
  const [erasing, setErasing] = useState<string | null>(null);
  // A loop drawn with the pen around part of the page: what to do with it is asked next to it.
  const [lasso, setLasso] = useState<{ page: number; box: FracRect } | null>(null);
  // Where something was just crossed out: a puff of dust there for a moment.
  const [poofs, setPoofs] = useState<{ id: string; page: number; box: FracRect }[]>([]);
  const poof = (pg: number, box: FracRect) => {
    const id = uid();
    setPoofs((l) => [...l, { id, page: pg, box }]);
    setTimeout(() => setPoofs((l) => l.filter((x) => x.id !== id)), 700);
  };
  // The stamp the Stamp tool places next.
  const [stampPick, setStampPick] = useState<{ text: string; color: string }>({ text: "", color: STAMPS[0][1] });
  const [pad, setPad] = useState<null | "signature" | "initials" | "stamp">(null);
  const [signer, setSigner] = useState(() => {
    try {
      return localStorage.getItem("sign-name") ?? "";
    } catch {
      return "";
    }
  });
  const [dateFormat, setDateFormat] = useState<DateFormat>("locale");
  const [placement, setPlacement] = useState<Placement>("all");
  const [customPages, setCustomPages] = useState("");
  // An item to focus once it renders (placed with the keyboard).
  const focusItem = useRef<string | null>(null);
  const [stamp, setStamp] = useState<{ image?: SignatureImage; text?: string } | null>(null);
  const [pendingImage, setPendingImage] = useState<SignatureImage | null>(null);
  const [cert, setCert] = useState<CertChoice | null>(null);
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [values, setValues] = useState<Record<string, string | boolean | string[]>>({});
  // Fields just filled from the autofill profile, highlighted until edited (P3-07).
  const [autofilled, setAutofilled] = useState<Set<string>>(new Set());
  const edited = (name: string) => autofilled.has(name) && setAutofilled((s) => { const n = new Set(s); n.delete(name); return n; });
  // Fields found on a flat form, waiting to be accepted or rejected.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [detected, setDetected] = useState<null | "busy" | number>(null);
  // Everything the page draws, for the Edit content tool.
  const [content, setContent] = useState<PageContent | null>(null);
  // Reading a scanned page's lines with OCR (Edit content), and in which languages.
  const [scanRead, setScanRead] = useState<{ page: number; state: "busy" | "done" | "none" | "turned" | "failed" } | null>(null);
  const [scanLang, setScanLang] = useState("eng");
  // The page drawn from the file with the content changes made (Edit content),
  // for the changes it was made with; or why they can't be made.
  const [preview, setPreview] = useState<{ key: string; page: number; width: number; url: string; blob: Blob } | null>(null);
  const [previewState, setPreviewState] = useState<{ key: string; busy: boolean; error: string | null; note: string | null }>({ key: "[]", busy: false, error: null, note: null });
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<number | null>(null);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  // Redact: the file's text for searching, scans read with OCR first (security.ts
  // searchable()), for the OCR languages it was read with.
  const [readable, setReadable] = useState<{ lang: string; file: File; pages: PageText[]; scanned: number[] } | "busy" | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const drag = useRef<null | { kind: "new" | "move" | "resize" | "crop-move" | "crop-resize"; id?: string; x0: number; y0: number; orig?: FracRect; handle?: string }>(null);
  // The Eraser wipes as it goes: each bit of its path is painted at once in
  // the colour of the paper around it (wipe), until the preview, with the
  // page's own content really deleted, takes over. A stroke that starts on
  // something drawn or added only takes those away and leaves the page be.
  const pageImg = useRef<HTMLImageElement>(null);
  const wipe = useRef<HTMLCanvasElement>(null);
  const paper = useRef<CanvasRenderingContext2D | null>(null);
  const wiped = useRef(new Map<string, { c: string; w: number; a: [number, number]; b: [number, number] }[]>());
  const eraseMode = useRef<"items" | "page">("page");
  // The preview the page image has finished loading (its key), so the wipe
  // gives way only once the real result is on screen.
  const shownKey = useRef("");

  // The latest handler, without reloading the file when it changes.
  const failed = useRef(onError);
  useEffect(() => {
    failed.current = onError;
  });

  useEffect(() => {
    pageSizes(file).then(setSizes).catch((e) => {
      setSizes([]);
      failed.current(e);
    });
    if (toolId === "forms") {
      import("@/lib/pdf/edit").then(({ readFields }) => readFields(file)).then((f) => {
        setFields(f);
        setValues(Object.fromEntries(f.map((x) => [x.name, x.value])));
      }).catch(() => setFields([]));
    }
  }, [file, toolId]);

  // Fit the page to the available width.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFit(Math.max(260, Math.min(900, el.clientWidth - 32))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const size = sizes[page];
  const width = Math.round(fit * zoom);
  const height = size ? Math.round((width * size.h) / size.w) : Math.round(width * 1.414);
  const ptToPx = size ? width / size.w : 1;

  const imgKey = `${page}:${width}`;
  const original = rendered?.key === imgKey ? rendered.url : null;
  useEffect(() => {
    let live = true;
    thumbUrl(file, page, width).then((r) => live && setRendered({ key: `${page}:${width}`, url: r.url })).catch(() => {});
    return () => {
      live = false;
    };
  }, [file, page, width]);

  useEffect(() => {
    if (tool !== "editText" || content?.page === page) return;
    let live = true;
    import("@/lib/pdf/edit").then(({ listContent }) => listContent(file, page))
      .catch(() => ({ objects: [], paragraphs: [] }))
      .then((c) => live && setContent({ page, ...c }));
    return () => {
      live = false;
    };
  }, [tool, page, file, content?.page]);

  // The preview: the file saved with the content changes, this page drawn
  // from it, once changes stop for a moment. A paragraph being typed in is
  // left out (the text box shows it), so typing doesn't redraw the page.
  // The Eraser leaves nothing on top to show, so its result is part of the preview too.
  // A stroke still under way isn't saved yet: the wipe shows it.
  const changes = useMemo(() => items.value.filter((i) => (isContent(i) && i.source) || (i.kind === "erase" && i.id !== erasing)), [items.value, erasing]);
  const previewKey = useMemo(() => JSON.stringify(changes.map((i) => (
    { ...i, image: i.image ? `${i.image.length}:${i.image.slice(-64)}` : undefined, ...(i.id === editing ? { removed: true } : {}) }
  ))), [changes, editing]);
  const editedFile = useRef<{ key: string; blob: Promise<{ blob: Blob; note?: string }> } | null>(null);
  useEffect(() => {
    if (!changes.length) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        if (editedFile.current?.key !== previewKey) {
          const list = changes.map((i) => (i.id === editing ? { ...i, removed: true } : i));
          editedFile.current = {
            key: previewKey,
            blob: import("@/lib/pdf/edit").then(({ editPdf, contentChanged }) =>
              list.some((i) => i.kind === "erase" || contentChanged(i)) ? editPdf(file, list, "preview").then(([o]) => ({ blob: o.blob, note: o.note })) : { blob: file as Blob }),
          };
        }
        const { blob, note } = await editedFile.current.blob;
        const { url } = await thumbUrl(blob, page, width);
        if (!live) return;
        setPreview((old) => {
          if (old && old.blob !== blob && old.blob !== file) {
            void import("@/lib/pdf/thumbs").then((m) => m.forgetDoc(old.blob));
          }
          return { key: previewKey, page, width, url, blob };
        });
        const swap = note?.startsWith("textFallback:") ? note.slice(13).split("; ")[0].split(" → ") : null;
        setPreviewState({ key: previewKey, busy: false, error: null, note: swap ? t("ed.fontFallback", { font: swap[0], fallback: swap[1] }) : null });
      } catch (e) {
        if (!live) return;
        editedFile.current = null;
        const code = (e as { code?: string })?.code;
        setPreviewState({ key: previewKey, busy: false, error: t(code === "text_edit_failed" ? "ed.scriptUnsupported" : "ed.previewFailed"), note: null });
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, page, width, file]);

  const pageItems = items.value.filter((i) => i.page === page && !isContent(i));
  const pageContent = content?.page === page ? content : null;
  const contentItems = changes.filter((i) => i.page === page && isContent(i) && i.kind !== "textEdit");
  const pageMarks = marks.value.filter((m) => m.page === page);
  const selected = items.value.find((i) => i.id === sel) ?? null;
  // The page as it will be saved: the latest preview of this page while there are changes.
  const img = changes.length && preview && preview.page === page && preview.width === width ? preview.url : original;
  const cropRect = crops.get(options.cropScope === "current" ? page : -1) ?? null;

  const frac = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const patch = (id: string, p: Partial<EditorItem>, record = true) => items.set((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)), record);

  const placeImage = (img: SignatureImage, x: number, y: number, kind: "image" = "image") => {
    const w = img.ratio > 1 ? 0.14 : 0.26;
    const h = (w * img.ratio * (size?.w ?? 1)) / (size?.h ?? 1.414);
    const it: EditorItem = { id: uid(), page, kind, x: Math.max(0, x - w / 2), y: Math.max(0, y - h / 2), w, h, image: img.url };
    items.set((l) => [...l, it]);
    setSel(it.id);
    return it.id;
  };

  // Drops what's waiting to be placed (a signature, stamp, date, name or
  // image) with its centre at x, y. Returns the new item's id.
  const placePending = (x: number, y: number) => {
    let id: string | null = null;
    if (tool === "place" && stamp) {
      if (stamp.image) id = placeImage(stamp.image, x, y);
      else if (stamp.text) {
        const fs = style.fontSize;
        // About the text's size on the page, as fractions of it.
        const h = size ? (fs * 1.25) / size.h : 0.03;
        const w = size ? Math.min(0.9, (stamp.text.length * fs * 0.55) / size.w) : 0.2;
        const it: EditorItem = { id: uid(), page, kind: "text", x: Math.max(0, x - w / 2), y: Math.max(0, y - h / 2), w, h, text: stamp.text, fontSize: fs, color: style.color };
        items.set((l) => [...l, it]);
        setSel(it.id);
        id = it.id;
      }
      setStamp(null);
      setTool("select");
    } else if (tool === "image" && pendingImage) {
      id = placeImage(pendingImage, x, y);
      setPendingImage(null);
      setTool("select");
    }
    return id;
  };
  const pending = (tool === "place" && stamp) || (tool === "image" && pendingImage);

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Stops the browser moving focus to the page on mousedown, which would
    // immediately blur a text box created by this same press.
    e.preventDefault();
    const p = frac(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pending) {
      placePending(p.x, p.y);
      return;
    }
    if (tool === "text") {
      const it: EditorItem = { id: uid(), page, kind: "text", x: p.x, y: p.y, w: 0.25, h: 0.04, text: "", fontSize: style.fontSize, color: style.color, bold: style.bold };
      items.set((l) => [...l, it]);
      setSel(it.id);
      setEditing(it.id);
      setTool("select");
      return;
    }
    if (tool === "select" || tool === "place" || tool === "editText") {
      setSel(null);
      setEditing(null);
      return;
    }
    const fixed = POINT_SIZES[tool];
    if (fixed) {
      const [pw, ph] = fixed;
      const w = pw / (size?.w ?? 612), h = ph / (size?.h ?? 792);
      const stamp = tool === "stamp" ? { text: stampPick.text || t(`ed.stamp.${STAMPS[0][0]}`), color: stampPick.color } : null;
      const it: EditorItem = {
        id: uid(), page, kind: tool as EditorItem["kind"], x: Math.max(0, Math.min(1 - w, p.x - w / 2)), y: Math.max(0, Math.min(1 - h, p.y - h / 2)), w, h,
        color: stamp?.color ?? (tool === "note" ? "#facc15" : tool === "check" ? "#12a37f" : tool === "cross" ? "#d33f6a" : style.color),
        text: stamp?.text ?? (tool === "note" ? "" : undefined),
      };
      items.set((l) => [...l, it]);
      setSel(it.id);
      // A note's text is typed next, in the panel; marks keep the tool for the next one.
      if (tool === "note" || tool === "stamp") setTool("select");
      if (tool === "note") focusItem.current = "note-text";
      return;
    }
    if (tool === "crop") {
      drag.current = { kind: "new", x0: p.x, y0: p.y };
      setCrops((m) => new Map(m).set(options.cropScope === "current" ? page : -1, { x: p.x, y: p.y, w: 0, h: 0 }));
      return;
    }
    if (tool === "redact") {
      const id = uid();
      marks.set((l) => [...l, { id, page, rect: { x: p.x, y: p.y, w: 0, h: 0 } }]);
      drag.current = { kind: "new", id, x0: p.x, y0: p.y };
      return;
    }
    const kind = tool as EditorItem["kind"];
    const it: EditorItem = {
      id: uid(), page, kind, x: p.x, y: p.y, w: 0, h: 0,
      color: tool === "highlight" ? "#facc15" : tool === "link" ? "#2f6fed" : style.color, fill: tool === "rect" || tool === "ellipse" ? style.fill : null, stroke: style.stroke,
      points: tool === "path" || tool === "line" || tool === "arrow" || tool === "erase" ? [[p.x, p.y], [p.x, p.y]] : undefined,
      ...(tool === "erase" ? { stroke: eraserSize } : {}),
      ...(isFieldKind(kind) ? newField(kind, items.value.filter((i) => i.kind === kind).length, t) : {}),
    };
    items.set((l) => [...l, it]);
    // A stroke being drawn isn't selected: no frame grows around it as the pen moves.
    setSel(["path", "line", "arrow", "erase"].includes(kind) ? null : it.id);
    if (kind === "erase") {
      setErasing(it.id);
      const hit = touchedBy(page, [[p.x, p.y]], eraserSize / 2);
      eraseMode.current = hit.length ? "items" : "page";
      if (hit.length) items.set((l) => l.filter((o) => !hit.includes(o.id)), false);
      // The page as shown, to read the paper's colour from.
      const im = pageImg.current;
      paper.current = null;
      if (im?.complete && im.naturalWidth) {
        const cv = document.createElement("canvas");
        cv.width = Math.round(width);
        cv.height = Math.round(height);
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        try {
          ctx?.drawImage(im, 0, 0, cv.width, cv.height);
          paper.current = ctx;
        } catch {
          // Not readable: the wipe is white.
        }
      }
      wiped.current.set(it.id, []);
      if (eraseMode.current === "page") wipeTo(it.id, [p.x, p.y], [p.x, p.y]);
    }
    drag.current = { kind: "new", id: it.id, x0: p.x, y0: p.y };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = frac(e);
    const box = { x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) };
    if (tool === "crop" && d.kind === "new") {
      setCrops((m) => new Map(m).set(options.cropScope === "current" ? page : -1, box));
      return;
    }
    if (d.kind === "crop-move" || d.kind === "crop-resize") {
      const o = d.orig!;
      const dx = p.x - d.x0, dy = p.y - d.y0;
      const key = options.cropScope === "current" ? page : -1;
      const next = d.kind === "crop-move"
        ? { ...o, x: Math.min(1 - o.w, Math.max(0, o.x + dx)), y: Math.min(1 - o.h, Math.max(0, o.y + dy)) }
        : resizeRect(o, d.handle!, dx, dy);
      setCrops((m) => new Map(m).set(key, next));
      return;
    }
    if (tool === "redact" && d.kind === "new") {
      marks.set((l) => l.map((m) => (m.id === d.id ? { ...m, rect: box } : m)), false);
      return;
    }
    if (d.kind === "new" && d.id) {
      const it = items.value.find((i) => i.id === d.id);
      if (!it) return;
      if (it.kind === "erase") {
        const last = it.points?.[it.points.length - 1] ?? [p.x, p.y];
        const r = eraserSize / 2;
        const hit = touchedBy(page, along([last, [p.x, p.y]], r), r, it.id);
        items.set((l) => l.filter((o) => !hit.includes(o.id)).map((o) => (o.id === it.id ? { ...o, points: [...(o.points ?? []), [p.x, p.y]] } : o)), false);
        if (hit.includes(sel ?? "")) setSel(null);
        if (eraseMode.current === "page") wipeTo(it.id, last, [p.x, p.y]);
      } else if (it.kind === "path") patch(d.id, { points: [...(it.points ?? []), [p.x, p.y]] }, false);
      else if (it.kind === "line" || it.kind === "arrow") patch(d.id, { points: [[d.x0, d.y0], [p.x, p.y]], ...box }, false);
      else patch(d.id, box, false);
      return;
    }
    if ((d.kind === "move" || d.kind === "resize") && d.id && d.orig) {
      const dx = p.x - d.x0, dy = p.y - d.y0;
      const it = items.value.find((i) => i.id === d.id);
      if (!it) return;
      if (d.kind === "move") {
        const nx = Math.min(1 - d.orig.w, Math.max(0, d.orig.x + dx));
        const ny = Math.min(1 - d.orig.h, Math.max(0, d.orig.y + dy));
        const shift = { x: nx - it.x, y: ny - it.y };
        patch(d.id, { x: nx, y: ny, points: it.points?.map(([a, b]) => [a + shift.x, b + shift.y] as [number, number]) }, false);
      } else {
        const r = resizeRect(d.orig, "se", dx, dy);
        // Images and signatures keep their aspect ratio.
        if (it.kind === "image") r.h = d.orig.h * (r.w / d.orig.w);
        patch(d.id, r, false);
      }
    }
  };

  // The Eraser, once lifted: what was drawn or added here that the stroke
  // touched goes; if it touched none of that, the stroke erases the page
  // itself, along its path (saving empties it: edit.ts erase areas), shown
  // by the preview. Either way it's one step to undo.
  // The points a brush of radius r (in points) covers along raw, filled in
  // between the ones the pointer reported, so a quick swipe can't jump over a thin line.
  const along = (raw: [number, number][], r: number) => {
    const pw = size?.w ?? 612, ph = size?.h ?? 792;
    const pts: [number, number][] = raw.slice(0, 1);
    for (let k = 1; k < raw.length; k++) {
      const [ax, ay] = raw[k - 1], [bx, by] = raw[k];
      const steps = Math.max(1, Math.ceil(Math.hypot((bx - ax) * pw, (by - ay) * ph) / Math.max(1, r * 0.5)));
      for (let j = 1; j <= steps; j++) pts.push([ax + ((bx - ax) * j) / steps, ay + ((by - ay) * j) / steps]);
    }
    return pts;
  };

  // What was drawn or added on page pg that a brush of radius r at pts touches.
  const touchedBy = (pg: number, pts: [number, number][], r: number, skip?: string) => {
    const pw = size?.w ?? 612, ph = size?.h ?? 792;
    const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot((ax - bx) * pw, (ay - by) * ph);
    const segDist = (px: number, py: number, [ax, ay]: [number, number], [bx, by]: [number, number]) => {
      const vx = (bx - ax) * pw, vy = (by - ay) * ph, wx = (px - ax) * pw, wy = (py - ay) * ph;
      const len = vx * vx + vy * vy;
      const k = len ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len)) : 0;
      return Math.hypot(wx - k * vx, wy - k * vy);
    };
    const touches = (o: EditorItem) => {
      if (o.page !== pg || o.id === skip || isContent(o) || o.kind === "erase") return false;
      if ((o.kind === "path" || o.kind === "line" || o.kind === "arrow") && o.points?.length) {
        const reach = r + (o.stroke ?? 2) / 2;
        return pts.some(([px, py]) => o.points!.some((q, k) => (k ? segDist(px, py, o.points![k - 1], q) : dist(px, py, q[0], q[1])) <= reach));
      }
      const mx = r / pw, my = r / ph;
      return pts.some(([px, py]) => px >= o.x - mx && px <= o.x + o.w + mx && py >= o.y - my && py <= o.y + o.h + my);
    };
    return items.value.filter(touches).map((o) => o.id);
  };

  // The colour of the paper around (x, y) on the page as shown, r pixels out:
  // the lighter middle of a ring of samples, so the text the ring crosses doesn't count.
  const paperAround = (x: number, y: number, r: number) => {
    const ctx = paper.current;
    if (!ctx) return "#ffffff";
    const seen: [number, number, number][] = [];
    for (let k = 0; k < 12; k++) {
      const sx = Math.round(x + Math.cos((k * Math.PI) / 6) * r), sy = Math.round(y + Math.sin((k * Math.PI) / 6) * r);
      if (sx < 0 || sy < 0 || sx >= ctx.canvas.width || sy >= ctx.canvas.height) continue;
      const d = ctx.getImageData(sx, sy, 1, 1).data;
      seen.push([d[0], d[1], d[2]]);
    }
    if (!seen.length) return "#ffffff";
    seen.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
    const [cr, cg, cb] = seen[Math.floor(seen.length * 0.7)];
    return `rgb(${cr} ${cg} ${cb})`;
  };

  // Paints the wipe: every stroke not yet in the preview, the one under way included.
  const paintWipe = () => {
    const cv = wipe.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(height * dpr)) {
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(height * dpr);
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const shown = shownKey.current;
    for (const it of items.value) {
      const segs = wiped.current.get(it.id);
      if (!segs || it.page !== page || (it.id !== erasing && shown.includes(`"${it.id}"`))) continue;
      for (const s of segs) {
        ctx.strokeStyle = s.c;
        ctx.lineWidth = s.w * ptToPx;
        ctx.beginPath();
        ctx.moveTo(s.a[0] * width, s.a[1] * height);
        ctx.lineTo(s.b[0] * width, s.b[1] * height);
        ctx.stroke();
      }
    }
  };

  // Undo, redo, another page or a new size: the wipe drawn again for what's there now.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => paintWipe(), [items.value, page, width, height]);

  // One more bit of the stroke under way, from a to b, wiped at once.
  const wipeTo = (id: string, a: [number, number], b: [number, number]) => {
    const segs = wiped.current.get(id);
    const ctx = wipe.current?.getContext("2d");
    if (!segs) return;
    const r = (eraserSize / 2) * ptToPx;
    const s = { c: paperAround(b[0] * width, b[1] * height, r * 1.5 + 2), w: eraserSize, a, b };
    segs.push(s);
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.strokeStyle = s.c;
    ctx.lineWidth = s.w * ptToPx;
    ctx.beginPath();
    ctx.moveTo(a[0] * width, a[1] * height);
    ctx.lineTo(b[0] * width, b[1] * height);
    ctx.stroke();
  };

  const finishErase = (it: EditorItem) => {
    setErasing(null);
    // Distances in points, so the brush is round on the page.
    const r = (it.stroke ?? eraserSize) / 2;
    const pts = along(it.points ?? [], r);
    const hit = touchedBy(it.page, pts, r, it.id);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    items.set((l) => {
      const rest = l.filter((o) => !hit.includes(o.id));
      if (hit.length) return rest.filter((o) => o.id !== it.id);
      return rest.map((o) => (o.id === it.id ? { ...o, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } : o));
    }, false);
    if (hit.includes(sel ?? "")) setSel(null);
  };

  // What a loop's choice does to the area it went round, as one step to undo.
  const applyLasso = (what: "highlight" | "whiteout" | "erase") => {
    if (!lasso) return;
    const { page: pg, box } = lasso;
    setLasso(null);
    if (what === "erase") {
      const pw = size?.w ?? 612, ph = size?.h ?? 792;
      const wide = box.w * pw >= box.h * ph;
      const mid = wide ? box.y + box.h / 2 : box.x + box.w / 2;
      const points: [number, number][] = wide ? [[box.x, mid], [box.x + box.w, mid]] : [[mid, box.y], [mid, box.y + box.h]];
      const it: EditorItem = { id: uid(), page: pg, kind: "erase", ...box, color: "#000000", fill: null, stroke: wide ? box.h * ph : box.w * pw, points };
      items.set((l) => [...l, it]);
      poof(pg, box);
      finishErase(it);
      return;
    }
    const it: EditorItem = { id: uid(), page: pg, kind: what, ...box, color: what === "highlight" ? "#facc15" : "#ffffff", fill: null, stroke: style.stroke };
    items.set((l) => [...l, it]);
    setSel(it.id);
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (tool === "redact" && d.id) {
      marks.set((l) => l.filter((m) => m.rect.w > 0.004 && m.rect.h > 0.004), false);
      return;
    }
    if (d.kind === "new" && d.id) {
      const it = items.value.find((i) => i.id === d.id);
      if (!it) return;
      if (it.kind === "erase") {
        // Started on something drawn: that's gone already, and the page is left as it was.
        if (eraseMode.current === "items") {
          setErasing(null);
          wiped.current.delete(it.id);
          items.set((l) => l.filter((o) => o.id !== it.id), false);
          return;
        }
        finishErase(it);
        return;
      }
      // Scribbled over something with the pen: crossed out, as on paper. The
      // scribble becomes an eraser stroke along its band, as wide as the band.
      if (it.kind === "path" && it.points) {
        const pw = size?.w ?? 612, ph = size?.h ?? 792;
        const box = scratchOut(it.points.map(([a, b]) => [a * pw, b * ph]));
        if (box) {
          const wide = box.w >= box.h;
          const band = (wide ? box.h : box.w) + 6;
          const mid = wide ? (box.y + box.h / 2) / ph : (box.x + box.w / 2) / pw;
          const ends: [number, number][] = wide ? [[box.x / pw, mid], [(box.x + box.w) / pw, mid]] : [[mid, box.y / ph], [mid, (box.y + box.h) / ph]];
          const erase: EditorItem = { ...it, kind: "erase", color: "#000000", fill: null, stroke: Math.max(band, eraserSize), points: ends };
          items.set((l) => l.map((o) => (o.id === it.id ? erase : o)), false);
          poof(it.page, { x: box.x / pw, y: box.y / ph, w: box.w / pw, h: box.h / ph });
          haptic("done");
          finishErase(erase);
          return;
        }
        // A loop around something: it's picked, and the choices show beside it.
        const ring = toolId === "edit" ? loop(it.points.map(([a, b]) => [a * pw, b * ph])) : null;
        if (ring) {
          items.set((l) => l.filter((o) => o.id !== it.id), false);
          setLasso({ page: it.page, box: { x: ring.x / pw, y: ring.y / ph, w: ring.w / pw, h: ring.h / ph } });
          haptic();
          return;
        }
      }
      // A click without a drag drops a default-sized shape.
      // A click without a drag: areas (erase, white-out, marks, links) aren't made at all, so a stray click changes nothing.
      if (["whiteout", "highlight", "underline", "strike", "link", "line", "arrow"].includes(it.kind) && it.w < 0.01 && it.h < 0.006) {
        items.set((l) => l.filter((x) => x.id !== it.id), false);
        setSel(null);
        return;
      }
      if (it.kind !== "path" && it.kind !== "line" && it.kind !== "arrow" && (it.w < 0.01 || it.h < 0.006)) {
        const def = isFieldKind(it.kind) ? fieldSize(it, (size?.w ?? 1) / (size?.h ?? 1.414))
          : it.kind === "link" || it.kind === "underline" || it.kind === "strike" ? { w: 0.25, h: 0.025 } : { w: 0.18, h: 0.08 };
        patch(it.id, def, false);
      }
      if (it.kind === "link") focusItem.current = "link-url";
      if ((it.kind === "path" || it.kind === "line" || it.kind === "arrow") && it.points) {
        const xs = it.points.map((q) => q[0]), ys = it.points.map((q) => q[1]);
        patch(it.id, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, false);
      }
    }
  };

  const startItemDrag = (e: React.PointerEvent, it: EditorItem, kind: "move" | "resize") => {
    if (tool !== "select" && tool !== "place" && tool !== "editText") return;
    e.stopPropagation();
    if (editing === it.id && kind === "move") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSel(it.id);
    // Snapshot once per gesture so a whole drag undoes in one step.
    items.set((l) => [...l]);
    const p = frac(e);
    drag.current = { kind, id: it.id, x0: p.x, y0: p.y, orig: { x: it.x, y: it.y, w: it.w, h: it.h } };
  };

  // Pinch to zoom: two fingers on a touch screen, or a trackpad pinch (which
  // browsers send as a wheel with Ctrl). Two fingers stop any stroke the
  // first one started.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let pinch: { d: number; z: number } | null = null;
    const gap = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const clamp = (z: number) => Math.min(3, Math.max(0.5, +z.toFixed(2)));
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const d = drag.current;
      drag.current = null;
      if (d?.kind === "new" && d.id) items.set((l) => l.filter((o) => o.id !== d.id), false);
      setErasing(null);
      pinch = { d: gap(e), z: zoomRef.current };
    };
    const move = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      setZoom(clamp(pinch.z * (gap(e) / pinch.d)));
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clamp(z * Math.exp(-e.deltaY / 200)));
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      el.removeEventListener("wheel", wheel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard: delete, undo/redo, nudge.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) { items.redo(); marks.redo(); } else { items.undo(); marks.undo(); }
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        e.preventDefault();
        // The page's own text is deleted from the file, not just from the list.
        const it = items.value.find((i) => i.id === sel);
        if (it?.kind === "textEdit") patch(sel, { text: "" });
        else if (it && isContent(it)) patch(sel, { removed: true });
        else {
          items.set((l) => l.filter((i) => i.id !== sel));
          setSel(null);
        }
      } else if (sel && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 0.01 : 0.002;
        const it = items.value.find((i) => i.id === sel);
        if (!it) return;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        patch(sel, { x: it.x + dx, y: it.y + dy, points: it.points?.map(([a, b]) => [a + dx, b + dy] as [number, number]) });
      } else if (e.key === "Escape") {
        setSel(null);
        setEditing(null);
        setStamp(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Redaction search across all pages.
  // `preset` names one of the quick marks; otherwise `typed` is the search box text.
  const ocrLang = String(options.ocrLang ?? "eng");
  // `presets`: one or more quick marks (all of them for "Everything personal"), in one step to undo.
  const markMatches = async (typed: string, presets: (typeof PRESET_NAMES)[number][] = []) => {
    if (readable === "busy") return;
    const { searchable, searchMatches, searchPattern, PRESETS } = await import("@/lib/pdf/security");
    let text = readable;
    if (!text || text.lang !== ocrLang) {
      setReadable("busy");
      try {
        text = { lang: ocrLang, ...(await searchable(file, ocrLang)) };
      } finally {
        setReadable((r) => (r === "busy" ? null : r));
      }
      setReadable(text);
    }
    const added: Mark[] = [];
    let n = 0;
    for (const preset of presets.length ? presets : [undefined]) {
      const pattern = preset ? PRESETS[preset] : searchPattern(typed, { matchCase, wholeWord });
      const hits = searchMatches(text.pages, { pattern, preset });
      const search = uid();
      const of = new Map<string, number>();
      for (const h of hits) of.set(h.text, (of.get(h.text) ?? 0) + 1);
      added.push(...hits.map((h) => ({ id: uid(), page: h.page, rect: h.rect, term: h.text, search, pattern, preset, of: of.get(h.text) })));
      // A match that wraps to the next line has a box on each line but counts once.
      n += new Set(hits.map((h) => h.hit)).size;
    }
    marks.set((l) => [...l, ...added]);
    setFound(n);
  };

  // ── Forms: suggest fields for the blanks of a flat form.
  const detectFields = async () => {
    setDetected("busy");
    try {
      const [{ detectDocument }, doc] = await Promise.all([import("@/lib/pdf/formsdetect"), docFor(file)]);
      // Skip blanks that already have a field added here.
      const taken = (s: Suggestion) => items.value.some((i) => i.page === s.page && isFieldKind(i.kind) &&
        s.x + s.w / 2 > i.x && s.x + s.w / 2 < i.x + i.w && s.y + s.h / 2 > i.y && s.y + s.h / 2 < i.y + i.h);
      const found = (await detectDocument(doc)).filter((s) => !taken(s));
      setSuggestions(found);
      setDetected(found.length);
      if (found.length && !found.some((s) => s.page === page)) setPage(found[0].page);
    } catch {
      setDetected(0);
    }
  };
  const acceptSuggestions = async (list: Suggestion[]) => {
    const { toItems } = await import("@/lib/pdf/formsdetect");
    items.set((l) => [...l, ...toItems(list).map((i) => ({ ...i, id: uid() }))]);
    setSuggestions((s) => s.filter((x) => !list.includes(x)));
  };

  // ── Crop: trim to the inked area of the current page.
  const autoCrop = async () => {
    const doc = await docFor(file);
    const pg = await doc.getPage(page + 1);
    const v = pg.getViewport({ scale: 600 / pg.getViewport({ scale: 1 }).width });
    const c = document.createElement("canvas");
    c.width = Math.ceil(v.width);
    c.height = Math.ceil(v.height);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvas: c, canvasContext: ctx, viewport: v, intent: "print" }).promise;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] + d[i + 1] + d[i + 2] < 720) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    if (x1 <= x0) return;
    const m = 0.015;
    const r = { x: Math.max(0, x0 / c.width - m), y: Math.max(0, y0 / c.height - m), w: 0, h: 0 };
    r.w = Math.min(1 - r.x, (x1 - x0) / c.width + m * 2);
    r.h = Math.min(1 - r.y, (y1 - y0) / c.height + m * 2);
    setCrops((mp) => new Map(mp).set(options.cropScope === "current" ? page : -1, r));
  };

  const readScan = async () => {
    const at = page;
    setScanRead({ page: at, state: "busy" });
    try {
      const { scanLines } = await import("@/lib/pdf/scanedit");
      const { lines, turned } = await scanLines(file, at, scanLang);
      setContent((c) => (c && c.page === at ? { ...c, scan: lines } : c));
      setScanRead({ page: at, state: turned ? "turned" : lines.length ? "done" : "none" });
    } catch {
      setScanRead({ page: at, state: "failed" });
    }
  };

  // Find and replace: every page's paragraphs (scans aside), each changed one
  // becoming a change to it, all in one step to undo. A paragraph already
  // changed is searched as it is now.
  const replaceAll = async (find: string, replace: string, o: { matchCase: boolean; wholeWord: boolean }) => {
    const [{ listContent }, { searchPattern }] = await Promise.all([import("@/lib/pdf/edit"), import("@/lib/pdf/security")]);
    const re = searchPattern(find, o);
    const now = items.value;
    const add: EditorItem[] = [];
    const texts = new Map<string, string>();
    let n = 0;
    const pages = new Set<number>();
    for (let p = 0; p < sizes.length; p++) {
      const c = pageContent?.page === p ? pageContent : await listContent(file, p).catch(() => null);
      for (const para of c?.paragraphs ?? []) {
        if (para.invisible) continue;
        const have = now.find((i) => i.page === p && isFor(i, { para }));
        if (have?.removed) continue;
        const was = have?.text ?? para.text;
        let hits = 0;
        const next = was.replace(re, () => (hits++, replace));
        if (!hits) continue;
        n += hits;
        pages.add(p);
        if (have) texts.set(have.id, next);
        else add.push({ ...itemFor(p, { para }), text: next });
      }
    }
    if (n) items.set((l) => [...l.map((i) => (texts.has(i.id) ? { ...i, text: texts.get(i.id) } : i)), ...add]);
    return { n, pages: pages.size };
  };

  // ── Edit content: picking a paragraph or object starts a change to it
  // (one that changes nothing until something is changed).
  const pickContent = (x: ContentTarget, edit: boolean) => {
    const have = items.value.find((i) => i.page === page && isFor(i, x));
    const id = have?.id ?? itemFor(page, x).id;
    if (!have) {
      const it = { ...itemFor(page, x), id };
      items.set((l) => [...l, it], false);
    }
    setSel(id);
    setEditing(edit && "para" in x ? id : null);
  };

  const run = () => {
    onRun(async (progress) => {
      const edit = await import("@/lib/pdf/edit");
      if (toolId === "redact") {
        const { redact, redactSearches } = await import("@/lib/pdf/security");
        // A searched text whose every hit is still marked must be gone from the whole file; redact() checks.
        const kept = new Map<string, { text: string; pattern?: RegExp; of: number; n: number }>();
        for (const m of marks.value) {
          if (!m.term || !m.search) continue;
          const k = `${m.search}\n${m.term}`;
          const e = kept.get(k) ?? { text: m.term, pattern: m.pattern, of: m.of ?? 0, n: 0 };
          e.n++;
          kept.set(k, e);
        }
        const terms = [...kept.values()].filter((e) => e.n >= e.of).map(({ text, pattern }) => ({ text, pattern }));
        const redactDpi = String(options.redactDpi ?? "200");
        const total = 1 + others.length;
        // Searched scans are redacted from their OCR'd copy, as images, and read again.
        const text = readable && readable !== "busy" && readable.lang === ocrLang ? readable : null;
        const out = await redact(text?.file ?? file, marks.value.map((m) => ({ page: m.page, rect: m.rect })), { redactDpi, terms, scanned: text?.scanned, ocrLang },
          (d, n) => progress(d / Math.max(1, n), total));
        // The other files get the searches only: boxes drawn by hand fit this file's pages.
        const searches = [...new Map(marks.value.filter((m) => m.pattern && m.search).map((m) => [m.search, { pattern: m.pattern!, preset: m.preset }])).values()];
        for (const [i, f] of others.entries()) {
          out.push(...(await forFile(f, () => redactSearches(f, searches, { redactDpi, ocrLang }, (d, n) => progress(1 + i + d / Math.max(1, n), total)))));
        }
        return out;
      }
      if (toolId === "crop") {
        const all = crops.get(-1);
        const box = options.cropScope !== "current" && all ? all : new Map([...crops].filter(([k]) => k >= 0));
        // The same box on every file of a batch, as fractions of each page.
        const out: Output[] = [];
        for (const [i, f] of [file, ...others].entries()) {
          out.push(...(await forFile(f, () => edit.crop(f, box))));
          progress(i + 1, 1 + others.length);
        }
        return out;
      }
      if (toolId === "forms") return edit.fillForm(file, values, items.value, Boolean(options.flatten));
      if (toolId === "sign" && cert) {
        // Drawn items first, then the certificate signature over the result.
        const [, sign] = await prepareCertificate();
        const drawn = items.value.length ? (await edit.editPdf(file, items.value, "signed"))[0].blob : file;
        return [await sign.signFile(drawn, file.name, cert.signer, cert)];
      }
      return edit.editPdf(file, items.value, toolId === "sign" ? "signed" : "edited");
    });
  };

  const canRun =
    toolId === "redact" ? marks.value.length > 0 :
    toolId === "crop" ? [...crops.values()].some((r) => r.w > 0.02 && r.h > 0.02) :
    toolId === "forms" || (toolId === "sign" && cert) ? true :
    items.value.some((i) => !isContent(i) || contentChanged(i)) && !(previewState.key === previewKey && previewState.error);

  // `group` starts a new group in the toolbar.
  const tools: { id: EdTool; icon: React.ReactNode; label: string; group?: boolean }[] = useMemo(() => {
    const base = [{ id: "select" as EdTool, icon: <MousePointer2 size={18} />, label: t("ed.select") }];
    if (toolId === "edit") return [...base,
      { id: "editText", icon: <LetterText size={18} />, label: t("ed.editContent") },
      { id: "text", icon: <Type size={18} />, label: t("ed.text"), group: true },
      { id: "image", icon: <ImagePlus size={18} />, label: t("ed.image") },
      { id: "stamp", icon: <Stamp size={18} />, label: t("ed.stampText") },
      { id: "note", icon: <StickyNote size={18} />, label: t("ed.note") },
      { id: "link", icon: <Link2 size={18} />, label: t("ed.link") },
      { id: "rect", icon: <Square size={18} />, label: t("ed.rect"), group: true },
      { id: "ellipse", icon: <Circle size={18} />, label: t("ed.ellipse") },
      { id: "line", icon: <Minus size={18} />, label: t("ed.line") },
      { id: "arrow", icon: <ArrowUpRight size={18} />, label: t("ed.arrow") },
      { id: "path", icon: <Pencil size={18} />, label: t("ed.draw") },
      { id: "highlight", icon: <Highlighter size={18} />, label: t("ed.highlight"), group: true },
      { id: "underline", icon: <UnderlineIcon size={18} />, label: t("ed.underline") },
      { id: "strike", icon: <Strikethrough size={18} />, label: t("ed.strike") },
      { id: "check", icon: <Check size={18} />, label: t("ed.check") },
      { id: "cross", icon: <X size={18} />, label: t("ed.cross") },
      { id: "erase", icon: <Eraser size={18} />, label: t("ed.erase"), group: true },
      { id: "whiteout", icon: <Brush size={18} />, label: t("ed.whiteout") },
    ];
    // Signing a paper form: text, ticks and crosses in its boxes, a line through what doesn't apply.
    const marks = [
      { id: "check" as EdTool, icon: <Check size={18} />, label: t("ed.check") },
      { id: "cross" as EdTool, icon: <X size={18} />, label: t("ed.cross") },
      { id: "line" as EdTool, icon: <Minus size={18} />, label: t("ed.line") },
    ];
    if (toolId === "sign") return [...base, { id: "text", icon: <Type size={18} />, label: t("ed.text"), group: true }, ...marks];
    if (toolId === "forms") return [...base,
      { id: "textField", icon: <TextCursorInput size={18} />, label: t("ed.addTextField") },
      { id: "checkbox", icon: <SquareCheck size={18} />, label: t("ed.addCheckbox") },
      { id: "radio", icon: <CircleDot size={18} />, label: t("ed.addRadio") },
      { id: "dropdown", icon: <SquareChevronDown size={18} />, label: t("ed.addDropdown") },
      { id: "optionList", icon: <List size={18} />, label: t("ed.addList") },
      { id: "dateField", icon: <CalendarDays size={18} />, label: t("ed.addDate") },
      { id: "signatureField", icon: <PenLine size={18} />, label: t("ed.addSignatureField") },
      // Or fill it in by hand, as on paper.
      { id: "text", icon: <Type size={18} />, label: t("ed.text"), group: true },
      ...marks,
    ];
    if (toolId === "redact") return [{ id: "redact", icon: <ScanEye size={18} />, label: t("ed.redactArea") }];
    return [{ id: "crop", icon: <CropIcon size={18} />, label: t("tool.crop.name") }];
  }, [toolId, t]);

  // Each tool's own pointer: a pencil draws, the Eraser is a circle its size, text gets a caret.
  const svgCursor = (svg: string, x: number, y: number, fallback: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
  const pen = (paths: string) => svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='white' stroke='black' stroke-width='1.6' stroke-linejoin='round'>${paths}</svg>`, 2, 22, "crosshair");
  const eraserPx = Math.max(6, Math.min(120, Math.round(eraserSize * ptToPx)));
  const cursor =
    tool === "select" || tool === "editText" ? "default"
    : tool === "text" ? "text"
    : tool === "path" ? pen("<path d='M3 21l1.5-5L16 4.5a2.1 2.1 0 013 3L7.5 19z'/><path d='M14 6.5l3 3' fill='none'/>")
    : tool === "highlight" ? pen("<path d='M3 21l3-1 1-3 9-9 3 3-9 9-3 1z' fill='#facc15'/><path d='M13 6l5 5' fill='none'/>")
    : tool === "erase" ? svgCursor(`<svg xmlns='http://www.w3.org/2000/svg' width='${eraserPx + 2}' height='${eraserPx + 2}'><circle cx='${eraserPx / 2 + 1}' cy='${eraserPx / 2 + 1}' r='${eraserPx / 2}' fill='rgba(255,255,255,0.35)' stroke='black' stroke-width='1'/></svg>`, eraserPx / 2 + 1, eraserPx / 2 + 1, "cell")
    : tool === "note" || tool === "stamp" || tool === "check" || tool === "cross" ? "copy"
    : "crosshair";

  const placeLabel = t("ed.placeCentre");
  const runButton = <button className="btn btn-primary btn-lg w-full" disabled={!canRun} onClick={run}>{actionLabel}</button>;

  return (
    <div>
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        {/* Toolbar */}
        <div className="sticky top-[72px] z-20 mb-3 flex flex-wrap items-center gap-1 rounded-xl border border-line bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] p-1.5 shadow-card backdrop-blur-md">
          {/* Each tool named under its icon, in one row that scrolls sideways when it doesn't fit. */}
          <ToolRow label={t("ed.tools")}>
            {tools.map((x) => (
              <span key={x.id} className="flex items-stretch">
                {x.group && <span aria-hidden className="mx-1 my-1.5 w-px shrink-0 bg-line" />}
                <button className="flex w-[60px] shrink-0 flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[11px] leading-[1.15] text-ink-2 hover:bg-surface-2 aria-pressed:bg-accent aria-pressed:text-white"
                  aria-pressed={tool === x.id} title={x.label}
                  onClick={(e) => {
                    setTool(x.id);
                    e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
                    if (x.id === "image") imageInput.current?.click();
                  }}>
                  {x.icon}
                  <span className="line-clamp-2 w-full break-words text-center">{x.label}</span>
                </button>
              </span>
            ))}
          </ToolRow>
          <input ref={imageInput} type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const url = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(f); });
            const bmp = await createImageBitmap(f);
            setPendingImage({ url, ratio: bmp.height / bmp.width });
            setTool("image");
          }} />
          <button className="icon-btn" aria-label={t("ed.undo")} title={t("ed.undo")} disabled={!items.canUndo && !marks.canUndo} onClick={() => { items.undo(); marks.undo(); }}><Undo2 size={18} /></button>
          <button className="icon-btn" aria-label={t("ed.redo")} title={t("ed.redo")} disabled={!items.canRedo && !marks.canRedo} onClick={() => { items.redo(); marks.redo(); }}><Redo2 size={18} /></button>
          {/* Zoom: on a phone, pinching does it, and the tools need the room. */}
          <span className="ms-auto hidden items-center gap-1 sm:flex">
            <button className="icon-btn" aria-label={t("ed.zoomOut")} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}><ZoomOut size={18} /></button>
            <span className="tabular w-11 text-center text-[13px] text-muted">{Math.round(zoom * 100)}%</span>
            <button className="icon-btn" aria-label={t("ed.zoomIn")} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}><ZoomIn size={18} /></button>
          </span>
        </div>

        {/* Page */}
        <div ref={wrap} className="overflow-auto rounded-xl bg-surface-2 p-4">
          <div
            ref={stage}
            className="relative mx-auto touch-none select-none bg-white data-[drawing]:[&_[data-item]]:pointer-events-none shadow-[0_0_0_1px_var(--line),0_8px_24px_rgb(0_0_0/0.08)]"
            style={{ width, height, cursor }}
            // With a tool that draws or places, what's already on the page lets the pointer through: the tool's own pointer stays, and it draws over them.
            data-drawing={!["select", "editText", "place"].includes(tool) || undefined}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img && <img ref={pageImg} src={img} alt="" draggable={false} data-preview={img !== original || undefined} className="absolute inset-0 h-full w-full"
              onLoad={() => { shownKey.current = img !== original && preview ? preview.key : ""; paintWipe(); }} />}
            <canvas ref={wipe} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />

            {/* Existing form fields */}
            {toolId === "forms" && fields.filter((f) => f.page === page && f.rect).map((f) => (
              <label key={f.name} data-autofilled={autofilled.has(f.name) || undefined}
                className={`absolute rounded-sm outline outline-[var(--accent)] ${autofilled.has(f.name) ? "bg-[color-mix(in_oklab,var(--success)_28%,transparent)] outline-2 outline-[var(--success)]" : "bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] outline-1"}`}
                style={{ left: `${f.rect!.x * 100}%`, top: `${f.rect!.y * 100}%`, width: `${f.rect!.w * 100}%`, height: `${f.rect!.h * 100}%` }}
                onPointerDown={(e) => e.stopPropagation()}>
                {f.type === "checkbox" ? (
                  <input type="checkbox" className="h-full w-full accent-[var(--accent)]" checked={Boolean(values[f.name])} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))} />
                ) : f.type === "text" ? (
                  <input className="h-full w-full bg-transparent px-1 text-black outline-none" style={{ fontSize: Math.max(9, f.rect!.h * height * 0.62) }}
                    value={String(values[f.name] ?? "")} onChange={(e) => { edited(f.name); setValues((v) => ({ ...v, [f.name]: e.target.value })); }} aria-label={f.name} />
                ) : null}
              </label>
            ))}

            {/* Suggested fields */}
            {suggestions.filter((s) => s.page === page).map((s) => (
              <SuggestionBox key={s.id} s={s} onAccept={() => void acceptSuggestions([s])} onReject={() => setSuggestions((l) => l.filter((x) => x !== s))} />
            ))}

            {/* Just crossed out: dust where it was */}
            {poofs.filter((x) => x.page === page).map((x) => (
              <span key={x.id} aria-hidden data-poof className="poof pointer-events-none absolute"
                style={{ left: `${x.box.x * 100}%`, top: `${x.box.y * 100}%`, width: `${x.box.w * 100}%`, height: `${x.box.h * 100}%` }}>
                {Array.from({ length: 10 }, (_, k) => <i key={k} style={{ "--k": k } as React.CSSProperties} />)}
              </span>
            ))}

            {/* A loop's area, and what to do with it */}
            {lasso && lasso.page === page && tool === "path" && (
              <div data-lasso className="lasso pointer-events-none absolute"
                style={{ left: `${lasso.box.x * 100}%`, top: `${lasso.box.y * 100}%`, width: `${lasso.box.w * 100}%`, height: `${lasso.box.h * 100}%` }}>
                <div role="toolbar" aria-label={t("ed.loopActions")} className="lasso-bar pointer-events-auto" onPointerDown={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => applyLasso("highlight")}><Highlighter size={15} /> {t("ed.highlight")}</button>
                  <button type="button" onClick={() => applyLasso("erase")}><Eraser size={15} /> {t("ed.lassoErase")}</button>
                  <button type="button" onClick={() => applyLasso("whiteout")}><Square size={15} /> {t("ed.whiteout")}</button>
                  <button type="button" aria-label={t("nav.close")} onClick={() => setLasso(null)}><X size={15} /></button>
                </div>
              </div>
            )}

            {/* Redaction marks */}
            {pageMarks.map((m) => (
              <div key={m.id} className="group absolute bg-black/80 outline outline-2 outline-[var(--danger)]"
                style={{ left: `${m.rect.x * 100}%`, top: `${m.rect.y * 100}%`, width: `${m.rect.w * 100}%`, height: `${m.rect.h * 100}%` }}>
                <button className="absolute -right-2.5 -top-2.5 hidden h-5 w-5 place-items-center rounded-full bg-danger text-white group-hover:grid"
                  aria-label={t("ws.remove")} onPointerDown={(e) => e.stopPropagation()} onClick={() => marks.set((l) => l.filter((x) => x.id !== m.id))}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))}

            {/* Crop */}
            {toolId === "crop" && cropRect && cropRect.w > 0 && (
              <CropOverlay rect={cropRect} onStart={(e, handle) => {
                e.stopPropagation();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                const p = frac(e);
                drag.current = { kind: handle ? "crop-resize" : "crop-move", x0: p.x, y0: p.y, orig: cropRect, handle };
              }} />
            )}

            {/* The page's own content, to click and change */}
            {tool === "editText" && pageContent && (
              <ContentLayer content={pageContent} items={contentItems} sel={sel} editing={editing} stage={stage} ptToPx={ptToPx} pageHeight={height}
                onPick={pickContent} onSelect={setSel} onEdit={setEditing}
                update={(id, p, record) => patch(id, p, record)} snapshot={() => items.set((l) => [...l])} />
            )}

            {/* Items */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              {pageItems.filter((i) => i.kind === "path" || i.kind === "line").map((i) => (
                <polyline key={i.id} points={(i.points ?? []).map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} fill="none" stroke={i.color}
                  strokeWidth={(i.stroke ?? 2) * ptToPx} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </svg>
            {/* Arrows, in pixels so their heads keep their shape. */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`}>
              {pageItems.filter((i) => i.kind === "arrow" && (i.points?.length ?? 0) > 1).map((i) => {
                const [[ax, ay], [bx, by]] = [i.points![0], i.points![i.points!.length - 1]].map(([x, y]) => [x * width, y * height]);
                const sw = (i.stroke ?? 2) * ptToPx, len = Math.hypot(bx - ax, by - ay) || 1;
                const head = Math.min(len * 0.6, Math.max(8 * ptToPx, sw * 4)), ang = Math.atan2(by - ay, bx - ax);
                const wing = (k: number) => `${bx + Math.cos(ang + Math.PI + k * 0.45) * head},${by + Math.sin(ang + Math.PI + k * 0.45) * head}`;
                return (
                  <g key={i.id} fill={i.color} stroke={i.color}>
                    <line x1={ax} y1={ay} x2={bx - Math.cos(ang) * head * 0.8} y2={by - Math.sin(ang) * head * 0.8} strokeWidth={sw} strokeLinecap="round" />
                    <polygon points={`${bx},${by} ${wing(1)} ${wing(-1)}`} stroke="none" />
                  </g>
                );
              })}
            </svg>
            {pageItems.map((i) => {
              const boxStyle: React.CSSProperties = { left: `${i.x * 100}%`, top: `${i.y * 100}%`, width: `${i.w * 100}%`, height: `${i.h * 100}%` };
              const isSel = sel === i.id;
              const frame = isSel ? "outline outline-2 outline-offset-2 outline-[var(--accent)]" : "";
              // Items take focus, so the arrow keys and Delete work on them without a mouse.
              const common = {
                onPointerDown: (e: React.PointerEvent) => startItemDrag(e, i, "move"), onPointerMove: onMove, onPointerUp: onUp,
                onFocus: () => setSel(i.id),
                ref: (el: HTMLDivElement | null) => {
                  if (el && focusItem.current === i.id) {
                    focusItem.current = null;
                    el.focus();
                  }
                },
                "data-item": i.kind, "data-selected": isSel || undefined,
                ...(editing === i.id ? {} : { tabIndex: 0, role: "button", "aria-label": i.kind === "text" ? i.text || t("ed.text") : t(ITEM_LABELS[i.kind]) }),
              };
              let inner: React.ReactNode = null;
              if (i.kind === "text") {
                const fs = (i.fontSize ?? 16) * ptToPx;
                return (
                  <div key={i.id} {...common} onDoubleClick={() => setEditing(i.id)}
                    className={`absolute whitespace-pre ${frame} ${editing === i.id ? "" : "cursor-move"}`}
                    style={{ left: `${i.x * 100}%`, top: `${i.y * 100}%`, fontSize: fs, lineHeight: 1.25, color: i.color, fontWeight: i.bold ? 700 : 400, fontFamily: "Helvetica, Arial, sans-serif", minWidth: 8, minHeight: fs * 1.25 }}>
                    {editing === i.id ? (
                      <textarea ref={(el) => { if (el && document.activeElement !== el) el.focus(); }} value={i.text ?? ""} rows={Math.max(1, (i.text ?? "").split("\n").length)}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={(e) => patch(i.id, { text: e.target.value }, false)}
                        onBlur={() => { setEditing(null); if (!(i.text ?? "").trim()) items.set((l) => l.filter((x) => x.id !== i.id), false); }}
                        placeholder={t("ed.typeHere")}
                        className="resize-none overflow-hidden bg-[color-mix(in_oklab,var(--accent)_6%,transparent)] outline-none"
                        style={{ font: "inherit", color: "inherit", width: `${Math.max(6, ...((i.text || t("ed.typeHere")).split("\n").map((l) => l.length + 1)))}ch` }} />
                    ) : (i.text || " ")}
                  </div>
                );
              }
              // The Eraser leaves nothing on the page to pick: the wipe shows it, then the preview.
              if (i.kind === "erase") return null;
              if (i.kind === "path" || i.kind === "line" || i.kind === "arrow") {
                // A drawing selected shows a light dashed outline, not a box (it isn't one), and no resize handle.
                return <div key={i.id} {...common} className={`absolute cursor-move rounded-sm ${isSel ? "outline-dashed outline-1 outline-offset-4 outline-[color-mix(in_oklab,var(--accent)_70%,transparent)]" : ""}`} style={{ ...boxStyle, minWidth: 6, minHeight: 6 }} />;
              }
              if (i.kind === "image") {
                // eslint-disable-next-line @next/next/no-img-element
                inner = <img src={i.image} alt="" draggable={false} className="h-full w-full" />;
              }
              if (i.kind === "underline" || i.kind === "strike") {
                inner = <span className="absolute inset-x-0" style={{ top: `${i.kind === "underline" ? 94 : 58}%`, height: Math.max(1, Math.min(3, i.h * (size?.h ?? 792) * 0.07) * ptToPx), background: i.color, transform: "translateY(-50%)" }} />;
              }
              if (i.kind === "check" || i.kind === "cross") {
                inner = (
                  <svg viewBox="0 0 1 1" className="h-full w-full overflow-visible" fill="none" stroke={i.color} strokeWidth={0.13} strokeLinecap="round">
                    {i.kind === "check" ? <polyline points="0.12,0.55 0.4,0.82 0.88,0.18" strokeLinejoin="round" /> : <path d="M0.18 0.18L0.82 0.82M0.82 0.18L0.18 0.82" />}
                  </svg>
                );
              }
              if (i.kind === "stamp") {
                const sh = i.h * height;
                inner = <span className="grid h-full w-full place-items-center overflow-hidden whitespace-nowrap font-bold uppercase" style={{ color: i.color, fontSize: Math.min(sh * 0.55, (i.w * width * 0.88) / Math.max(1, (i.text ?? "").length * 0.62)), fontFamily: "Helvetica, Arial, sans-serif" }}>{i.text}</span>;
              }
              if (i.kind === "note") inner = <StickyNote className="h-full w-full p-[12%] text-ink" strokeWidth={2.2} />;
              if (i.kind === "link") inner = <Link2 size={14} className="absolute -top-2 -left-2 rounded-full bg-[#2f6fed] p-0.5 text-white" />;
              const shape: React.CSSProperties =
                i.kind === "rect" ? { border: `${(i.stroke ?? 2) * ptToPx}px solid ${i.color}`, background: i.fill ?? "transparent" } :
                i.kind === "ellipse" ? { border: `${(i.stroke ?? 2) * ptToPx}px solid ${i.color}`, background: i.fill ?? "transparent", borderRadius: "50%" } :
                i.kind === "highlight" ? { background: i.color, opacity: 0.38, mixBlendMode: "multiply" } :
                i.kind === "whiteout" ? { background: "#fff", boxShadow: isSel ? undefined : "0 0 0 1px rgb(0 0 0 / 0.06)" } :
                i.kind === "stamp" ? { border: `${Math.max(1.5, i.h * (size?.h ?? 792) * 0.07) * ptToPx}px solid ${i.color}`, borderRadius: 4, opacity: 0.9 } :
                i.kind === "note" ? { background: i.color, borderRadius: 4, boxShadow: "0 1px 3px rgb(0 0 0 / 0.3)" } :
                i.kind === "link" ? { outline: "1.5px dashed #2f6fed", background: "rgb(47 111 237 / 0.1)" } :
                isFieldKind(i.kind) ? fieldShape(i.kind) : {};
              return (
                <div key={i.id} {...common} className={`absolute cursor-move ${frame}`} style={{ ...boxStyle, ...shape }}>
                  {inner}
                  {isFieldKind(i.kind) && <FieldPreview item={i} px={ptToPx} />}
                  {isSel && (
                    <span onPointerDown={(e) => startItemDrag(e, i, "resize")}
                      className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-accent shadow" />
                  )}
                </div>
              );
            })}
            {pending ? (
              <div className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-max rounded-lg bg-ink px-3 py-1.5 text-[13px] text-bg shadow-card">{t("ed.clickToPlace")}</div>
            ) : null}
          </div>
        </div>

        {/* Page navigation */}
        {sizes.length > 1 && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <button className="icon-btn" aria-label={t("ed.prevPage")} disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={18} /></button>
            <span className="tabular text-[14px] text-muted">{page + 1} / {sizes.length}</span>
            <button className="icon-btn" aria-label={t("ed.nextPage")} disabled={page >= sizes.length - 1} onClick={() => setPage((p) => p + 1)}><ChevronRight size={18} /></button>
          </div>
        )}
      </div>

      {/* Side panel */}
      <aside className="card h-max space-y-5 p-5 lg:sticky lg:top-20">
        {toolId === "sign" && (
          <div className="grid gap-2">
            <button className="btn btn-quiet justify-start" onClick={() => setPad("signature")}><SignatureIcon size={18} /> {t("ed.signature")}</button>
            <button className="btn btn-quiet justify-start" onClick={() => setPad("initials")}><Type size={18} /> {t("ed.initials")}</button>
            <button className="btn btn-quiet justify-start" onClick={() => setPad("stamp")}><Stamp size={18} /> {t("ed.stamp")}</button>
            <div className="flex gap-2">
              <input className="field h-11 min-w-0 flex-1" value={signer} aria-label={t("ed.yourName")} placeholder={t("ed.yourName")}
                onChange={(e) => {
                  setSigner(e.target.value);
                  try {
                    localStorage.setItem("sign-name", e.target.value);
                  } catch {
                    /* storage blocked: still usable this time */
                  }
                }} />
              <button className="btn btn-quiet shrink-0" disabled={!signer.trim()} onClick={() => { setStamp({ text: signer.trim() }); setTool("place"); }}>
                <UserRound size={18} /> {t("ed.name")}
              </button>
            </div>
            <div className="flex gap-2">
              <select className="field h-11 min-w-0 flex-1" value={dateFormat} aria-label={t("ed.dateFormat")} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                {DATE_FORMATS.map((f) => <option key={f} value={f}>{formatDate(new Date(), f, locale)}</option>)}
              </select>
              <button className="btn btn-quiet shrink-0" onClick={() => { setStamp({ text: formatDate(new Date(), dateFormat, locale) }); setTool("place"); }}>
                <CalendarDays size={18} /> {t("ed.date")}
              </button>
            </div>
          </div>
        )}

        {toolId === "sign" && <CertificateSign value={cert} onChange={setCert} />}

        {pending && (
          <div className="space-y-2">
            {/* Placing without a pointer: drop it in the middle, then move it with the arrow keys. */}
            <button className="btn btn-quiet w-full" autoFocus onClick={() => {
              focusItem.current = placePending(0.5, 0.5);
            }}><Crosshair size={18} /> {placeLabel}</button>
            <p className="text-[13px] text-muted">{t("ed.nudgeHint")}</p>
          </div>
        )}

        {toolId === "redact" && (
          <div className="space-y-3">
            <form className="flex gap-2" onSubmit={(e) => {
              e.preventDefault();
              if (!query.trim()) return;
              void markMatches(query);
            }}>
              <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("ed.redactSearchPlaceholder")} aria-label={t("ed.redactSearch")} />
              <button className="icon-btn h-10 w-10 shrink-0 border border-line" aria-label={t("ed.redactSearch")}><Search size={17} /></button>
            </form>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                <input type="checkbox" className="accent-[var(--accent)]" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
                {t("ed.redactMatchCase")}
              </label>
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                <input type="checkbox" className="accent-[var(--accent)]" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
                {t("ed.redactWholeWords")}
              </label>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">{t("ed.redactPresets")}</p>
              {/* Everything a document can give away about a person (long numbers aside: the ID presets cover those), at once. */}
              <button className="btn btn-quiet btn-sm mb-2 w-full justify-center font-medium" data-redact-all
                onClick={() => markMatches("", PRESET_NAMES.filter((k) => k !== "numbers"))}>
                <ShieldCheck size={15} /> {t("ed.redactAll")}
              </button>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_NAMES.map((k) => (
                  <button key={k} className="btn btn-quiet btn-sm" onClick={() => markMatches("", [k])}>
                    {t(`ed.redact${k[0].toUpperCase()}${k.slice(1)}`)}
                  </button>
                ))}
              </div>
            </div>
            {readable === "busy" && <p role="status" className="text-[14px] text-muted"><Loader2 size={14} className="me-1.5 inline animate-spin" />{t("ed.redactReading")}</p>}
            {readable && readable !== "busy" && readable.scanned.length > 0 && <p className="text-[14px] text-ink-2">{t("ed.redactScanned", { n: readable.scanned.length })}</p>}
            {found !== null && <p className="text-[14px] text-muted">{t("ed.redactFound", { n: found })}</p>}
            {others.length > 0 && <p className="text-[14px] text-ink-2">{t("ed.redactBatch", { n: others.length })}</p>}
            <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">{t("ed.redactNote")}</p>
          </div>
        )}

        {toolId === "crop" && (
          <div className="space-y-3">
            <p className="text-[14px] text-muted">{t("ed.cropHint")}</p>
            {others.length > 0 && <p className="text-[14px] text-ink-2">{t("ed.cropBatch", { n: others.length + 1 })}</p>}
            <div className="flex gap-2">
              <button className="btn btn-quiet btn-sm" onClick={autoCrop}><CropIcon size={16} /> {t("ed.cropAuto")}</button>
              <button className="btn btn-quiet btn-sm" onClick={() => setCrops(new Map())}>{t("ed.cropReset")}</button>
            </div>
          </div>
        )}

        {toolId === "forms" && (
          <DetectPanel state={detected} left={suggestions.length} onDetect={() => void detectFields()}
            onAcceptAll={() => void acceptSuggestions(suggestions)} onRejectAll={() => setSuggestions([])} />
        )}

        {toolId === "forms" && fields.length > 0 && (
          <AutofillPanel fields={fields} onFill={(filled) => {
            setValues((v) => ({ ...v, ...filled }));
            setAutofilled(new Set(Object.keys(filled)));
          }} />
        )}

        {toolId === "forms" && (
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-2">{t("ed.formFields")}</p>
            {fields.length === 0 ? <p className="text-[14px] text-muted">{t("ed.noFields")}</p> : (
              <div className="max-h-[340px] space-y-3 overflow-auto pr-1">
                {fields.map((f) => (
                  <label key={f.name} className={`block ${autofilled.has(f.name) ? "rounded-md bg-[color-mix(in_oklab,var(--success)_12%,transparent)] p-1" : ""}`} data-autofilled={autofilled.has(f.name) || undefined}>
                    <span className="mb-1 block truncate text-[13px] text-muted" title={f.tooltip ?? f.name}>{f.name}{f.required ? " *" : ""}</span>
                    <FieldInput field={f} value={values[f.name]} onChange={(v) => { edited(f.name); setValues((old) => ({ ...old, [f.name]: v })); }} />
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Style for new and selected items */}
        {selected && isFieldKind(selected.kind) && <FieldSettings item={selected} onChange={(p) => patch(selected.id, p)} />}

        {(tool === "editText" || (selected && isContent(selected))) && (
          <ContentPanel content={pageContent ?? (tool === "editText" ? "busy" : null)}
            item={selected && isContent(selected) ? selected : null} items={contentItems}
            status={previewState.key === previewKey ? previewState : { busy: changes.length > 0, error: null, note: null }}
            pageAspect={size ? size.h / size.w : 1.414}
            scan={scanRead?.page === page ? scanRead.state : "idle"} ocrLang={scanLang} onOcrLang={setScanLang} onReadScan={() => void readScan()} onReplaceAll={replaceAll}
            onPick={(x, edit) => { setTool("editText"); pickContent(x, edit); }}
            update={(p, record = true) => selected && patch(selected.id, p, record)}
            restore={() => {
              if (!selected?.source) return;
              const s = selected.source;
              patch(selected.id, {
                x: s.x, y: s.y, w: s.w ?? selected.w, h: s.h ?? selected.h, text: s.was, fontSize: s.size ?? selected.fontSize, color: s.color, fill: s.fill,
                stroke: s.stroke, align: s.align, family: selected.kind === "scanEdit" ? (s.font as EditorItem["family"]) : undefined, rotate: undefined, flipX: undefined, flipY: undefined, removed: undefined, order: undefined, image: undefined,
              });
            }} />
        )}

        {toolId === "edit" && (tool === "erase" || tool === "whiteout" || selected?.kind === "erase" || selected?.kind === "whiteout") && (
          <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">
            {t(tool === "erase" || selected?.kind === "erase" ? "ed.eraseHint" : "ed.whiteoutHint")}
          </p>
        )}
        {toolId === "edit" && tool === "path" && (
          <p data-scribble-hint className="rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">{t("ed.scribbleHint")} {t("ed.loopHint")}</p>
        )}
        {toolId === "edit" && tool === "erase" && (
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            {t("ed.eraserSize")}
            <input type="range" min={4} max={60} step={1} className="flex-1 accent-[var(--accent)]" value={eraserSize} onChange={(e) => setEraserSize(Number(e.target.value))} />
            <span className="tabular w-10 text-end">{eraserSize} pt</span>
          </label>
        )}

        {/* Stamps: pick the words, for the next one or the one selected. */}
        {toolId === "edit" && (tool === "stamp" || selected?.kind === "stamp") && (
          <div className="space-y-2" data-stamp-picker>
            <p className="text-[13px] font-medium text-ink-2">{t("ed.stampPick")}</p>
            <div className="flex flex-wrap gap-1.5">
              {STAMPS.map(([k, color]) => {
                const text = t(`ed.stamp.${k}`);
                const on = (selected?.kind === "stamp" ? selected.text : stampPick.text || t(`ed.stamp.${STAMPS[0][0]}`)) === text;
                return (
                  <button key={k} aria-pressed={on} onClick={() => { setStampPick({ text, color }); if (selected?.kind === "stamp") patch(selected.id, { text, color }); }}
                    className="rounded border-2 px-2 py-0.5 text-[12px] font-bold uppercase aria-pressed:ring-2 aria-pressed:ring-[var(--ink)] aria-pressed:ring-offset-1" style={{ borderColor: color, color }}>
                    {text}
                  </button>
                );
              })}
            </div>
            <input className="field h-10 w-full" placeholder={t("ed.stampCustom")} aria-label={t("ed.stampCustom")}
              value={selected?.kind === "stamp" ? selected.text ?? "" : stampPick.text}
              onChange={(e) => { setStampPick((p) => ({ ...p, text: e.target.value })); if (selected?.kind === "stamp") patch(selected.id, { text: e.target.value }, false); }} />
            {tool === "stamp" && <p className="text-[13px] text-muted">{t("ed.clickToPlace")}</p>}
          </div>
        )}

        {selected?.kind === "note" && (
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink-2">{t("ed.noteText")}</span>
            <textarea className="field min-h-[96px] w-full resize-y py-2 text-[14px]" value={selected.text ?? ""} placeholder={t("ed.typeHere")}
              ref={(el) => { if (el && focusItem.current === "note-text") { focusItem.current = null; el.focus(); } }}
              onChange={(e) => patch(selected.id, { text: e.target.value }, false)} />
            <span className="mt-1 block text-[13px] text-muted">{t("ed.noteHint")}</span>
          </label>
        )}

        {selected?.kind === "link" && (() => {
          const target = selected.url ? linkTarget(selected.url, sizes.length) : null;
          return (
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink-2">{t("ed.linkTo")}</span>
              <input className="field h-10 w-full" value={selected.url ?? ""} placeholder={t("ed.linkPlaceholder")} inputMode="url"
                ref={(el) => { if (el && focusItem.current === "link-url") { focusItem.current = null; el.focus(); } }}
                onChange={(e) => patch(selected.id, { url: e.target.value }, false)} />
              <span className={`mt-1 block text-[13px] ${selected.url && !target ? "text-danger" : "text-muted"}`}>
                {!selected.url ? t("ed.linkHint") : !target ? t("ed.linkBad") : "page" in target ? t("ed.linkPage", { n: target.page + 1 }) : t("ed.linkUrl", { url: target.uri })}
              </span>
            </label>
          );
        })()}

        {(toolId === "edit" || toolId === "sign" || toolId === "forms") && selected?.kind !== "image" && !(selected && (isContent(selected) || isFieldKind(selected.kind) || ["note", "link", "stamp", "erase", "whiteout"].includes(selected.kind))) && !["editText", "stamp", "note", "link", "erase", "whiteout"].includes(tool) && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button key={c} aria-label={t(colorKey(c))} aria-pressed={(selected?.color ?? style.color) === c}
                  onClick={() => { setStyle((s) => ({ ...s, color: c })); if (selected) patch(selected.id, { color: c }); }}
                  className="h-7 w-7 rounded-full border border-line ring-offset-2 ring-offset-[var(--surface)] aria-pressed:ring-2 aria-pressed:ring-[var(--ink)]" style={{ background: c }} />
              ))}
            </div>
            {(selected ? selected.kind === "text" : tool === "text" || toolId !== "edit") && (
              <div className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-2 text-[13px] text-ink-2">
                  {t("ed.fontSize")}
                  <input type="number" min={6} max={96} className="field h-9 w-20" value={selected?.fontSize ?? style.fontSize}
                    onChange={(e) => { const v = Math.max(6, Math.min(96, Number(e.target.value) || 12)); setStyle((s) => ({ ...s, fontSize: v })); if (selected) patch(selected.id, { fontSize: v }); }} />
                </label>
                <button className="icon-btn border border-line" aria-pressed={selected?.bold ?? style.bold} aria-label={t("ed.bold")}
                  onClick={() => { const b = !(selected?.bold ?? style.bold); setStyle((s) => ({ ...s, bold: b })); if (selected) patch(selected.id, { bold: b }); }}>
                  <Bold size={16} />
                </button>
              </div>
            )}
            {(selected ? ["rect", "ellipse", "line", "path", "arrow"].includes(selected.kind) : ["rect", "ellipse", "line", "path", "arrow", "select"].includes(tool)) && toolId === "edit" && (
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                {t("ed.stroke")}
                <input type="range" min={0.5} max={12} step={0.5} className="flex-1 accent-[var(--accent)]" value={selected?.stroke ?? style.stroke}
                  onChange={(e) => { const v = Number(e.target.value); setStyle((s) => ({ ...s, stroke: v })); if (selected) patch(selected.id, { stroke: v }, false); }} />
              </label>
            )}
            {(selected ? ["rect", "ellipse"].includes(selected.kind) : ["rect", "ellipse", "select"].includes(tool)) && toolId === "edit" && (
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                <input type="checkbox" className="accent-[var(--accent)]" checked={Boolean(selected?.fill ?? style.fill)}
                  onChange={(e) => { const f = e.target.checked ? (selected?.color ?? style.color) : null; setStyle((s) => ({ ...s, fill: f })); if (selected) patch(selected.id, { fill: f }); }} />
                {t("ed.fill")}
              </label>
            )}
          </div>
        )}

        {selected && !isContent(selected) && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <button className="btn btn-quiet btn-sm" disabled={moveLayer(items.value, selected.id, 1) === items.value}
              onClick={() => items.set((l) => moveLayer(l, selected.id, 1))}>
              <BringToFront size={15} /> {t("ed.bringForward")}
            </button>
            <button className="btn btn-quiet btn-sm" disabled={moveLayer(items.value, selected.id, -1) === items.value}
              onClick={() => items.set((l) => moveLayer(l, selected.id, -1))}>
              <SendToBack size={15} /> {t("ed.sendBackward")}
            </button>
            {toolId === "sign" && sizes.length > 1 && (
              <div className="grid w-full gap-2">
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <span aria-hidden>{t("ed.placeOn")}</span>
                  <select className="field h-9 min-w-0 flex-1" value={placement} aria-label={t("ed.placeOn")} onChange={(e) => setPlacement(e.target.value as Placement)}>
                    {PLACEMENTS.map((k) => <option key={k} value={k}>{t(`ed.pages${k[0].toUpperCase()}${k.slice(1)}`)}</option>)}
                  </select>
                </label>
                {placement === "custom" && (
                  <input className="field h-9" value={customPages} onChange={(e) => setCustomPages(e.target.value)}
                    aria-label={t("ed.customPages")} placeholder={t("ed.customPagesHint")} />
                )}
                <button className="btn btn-quiet btn-sm justify-self-start"
                  disabled={!placementPages(placement, customPages, sizes.length).length}
                  onClick={() => {
                    const pages = placementPages(placement, customPages, sizes.length);
                    items.set((l) => placeOnPages(l, selected, pages, uid));
                    if (!pages.includes(selected.page)) setPage(pages[0]);
                  }}>
                  <Copy size={15} /> {t("ed.applyPlacement")}
                </button>
              </div>
            )}
            <button className="btn btn-quiet btn-sm text-danger" onClick={() => { items.set((l) => l.filter((i) => i.id !== selected.id)); setSel(null); }}>
              <Trash2 size={15} /> {t("ed.deleteItem")}
            </button>
          </div>
        )}

        <div className="hidden lg:block">{runButton}</div>
      </aside>

      {pad && (
        <SignaturePad kind={pad} onClose={() => setPad(null)} onDone={(s) => { setPad(null); setStamp({ image: s }); setTool("place"); }} />
      )}
    </div>
      {/* Below lg the panel sits under the page, so the action stays in reach at the bottom of the screen. */}
      <div data-sticky-action className="sticky bottom-0 z-30 mt-4 rounded-t-xl border border-b-0 border-line bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] p-3 shadow-card backdrop-blur-md lg:hidden">
        {runButton}
      </div>
    </div>
  );
}

// The toolbar's tools: one row that scrolls sideways (the mouse wheel scrolls
// it too), its edge fading where more tools are out of sight.
function ToolRow({ label, children }: { label: string; children: React.ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const check = () => setMore({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener("scroll", check, { passive: true });
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", check);
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  const fade = `linear-gradient(to right, ${more.left ? "transparent, black 32px" : "black"}, ${more.right ? "black calc(100% - 32px), transparent" : "black"})`;
  return (
    <div ref={row} role="toolbar" aria-label={label} className="-my-0.5 flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto py-0.5 [scrollbar-width:none]"
      style={{ maskImage: fade, WebkitMaskImage: fade }}>
      {children}
    </div>
  );
}

function resizeRect(o: FracRect, handle: string, dx: number, dy: number): FracRect {
  let { x, y, w, h } = o;
  if (handle.includes("e")) w = Math.max(0.02, Math.min(1 - x, w + dx));
  if (handle.includes("s")) h = Math.max(0.02, Math.min(1 - y, h + dy));
  if (handle.includes("w")) { const nx = Math.max(0, Math.min(x + w - 0.02, x + dx)); w += x - nx; x = nx; }
  if (handle.includes("n")) { const ny = Math.max(0, Math.min(y + h - 0.02, y + dy)); h += y - ny; y = ny; }
  return { x, y, w, h };
}

function CropOverlay({ rect, onStart }: { rect: FracRect; onStart: (e: React.PointerEvent, handle?: string) => void }) {
  const pct = (v: number) => `${v * 100}%`;
  return (
    <>
      <div className="pointer-events-none absolute inset-0 bg-black/45" style={{
        clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${pct(rect.x)} ${pct(rect.y)}, ${pct(rect.x)} ${pct(rect.y + rect.h)}, ${pct(rect.x + rect.w)} ${pct(rect.y + rect.h)}, ${pct(rect.x + rect.w)} ${pct(rect.y)}, ${pct(rect.x)} ${pct(rect.y)})`,
      }} />
      <div className="absolute cursor-move outline outline-2 outline-white" style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
        onPointerDown={(e) => onStart(e)}>
        {["nw", "ne", "sw", "se", "n", "s", "e", "w"].map((h) => (
          <span key={h} onPointerDown={(e) => onStart(e, h)}
            className="absolute h-3.5 w-3.5 rounded-full border-2 border-white bg-accent"
            style={{
              left: h.includes("w") ? -7 : h.includes("e") ? "calc(100% - 7px)" : "calc(50% - 7px)",
              top: h.includes("n") ? -7 : h.includes("s") ? "calc(100% - 7px)" : "calc(50% - 7px)",
              cursor: `${h}-resize`,
            }} />
        ))}
      </div>
    </>
  );
}
