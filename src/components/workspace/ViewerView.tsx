"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  X, Search, ZoomIn, ZoomOut, BookOpenText, LayoutList, ListTree, ChevronUp, ChevronDown, Sparkles, Loader2,
  SlidersHorizontal, Maximize2, Minimize2, Share2, Printer, Download, Highlighter, Copy, Trash2,
} from "lucide-react";
import { useI18n } from "../I18n";
import { ToolIcon } from "../ToolIcon";
import { docFor, thumbUrl } from "@/lib/pdf/thumbs";
import { handOffTo } from "@/lib/handoff";
import { toolById, type ToolId } from "@/lib/tools";
import type { Passage } from "@/lib/ai/speak";
import { remember, rememberPage } from "@/lib/library";
import type { Box, Highlight } from "@/lib/pdf/highlights";

export const prepareViewer = () => Promise.all([import("@/lib/pdf/thumbs"), import("pdfjs-dist"), import("@/lib/ai/speak")]);

// The PDF viewer: the pages, full screen, and nothing else until it's asked
// for. The controls fade while you read and come back on a tap, a scroll up
// or the mouse. Reading mode reflows the text to the screen; night mode
// darkens the pages themselves; the place you stopped is kept (on this
// device) for next time; and one tap hands the file to another tool.

const MORE: ToolId[] = ["edit", "sign", "compress", "pdfToWord", "listen", "summarize", "split", "protect"];
const GAP = 14;
const placeKey = (f: File) => `nopload:viewer:${f.name}:${f.size}`;
type Panel = null | "pages" | "contents" | "marks" | "search" | "more" | "display";
const HL_COLORS = ["yellow", "green", "blue", "pink"] as const;
const hlKey = (f: File) => `nopload:viewer:hl:${f.name}:${f.size}`;
const isSide = (p: Panel) => p === "pages" || p === "contents" || p === "marks";
type Theme = "paper" | "sepia" | "night";
const THEMES: Theme[] = ["paper", "sepia", "night"];
// Two pages side by side once the window is wide enough for both.
const SPREAD_MIN = 900;
type Outline = { title: string; page: number | null; items: Outline[] };

export function ViewerView({ file, onClose, onError }: { file: File; onClose: () => void; onError: (e: unknown) => void }) {
  const { t, href } = useI18n();
  const router = useRouter();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [ratios, setRatios] = useState<number[]>([]);
  // The space the pages have (the scroller's size).
  const [view, setView] = useState({ w: 900, h: 800 });
  const [zoom, setZoom] = useState(1);
  const [theme, setTheme] = useState<Theme>("paper");
  const night = theme === "night";
  const [layout, setLayout] = useState<"scroll" | "spread">("scroll");
  const [fitMode, setFitMode] = useState<"width" | "page">("width");
  const [full, setFull] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [reading, setReading] = useState<null | "loading" | "none" | Passage[]>(null);
  const [readSize, setReadSize] = useState(19);
  const [panel, setPanel] = useState<Panel>(null);
  const [chrome, setChrome] = useState(true);
  const [current, setCurrent] = useState(0);
  const [resumed, setResumed] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ page: number }[] | null>(null);
  const [hit, setHit] = useState(0);
  const [outline, setOutline] = useState<Outline[] | null>(null);
  // Highlights: kept with the file on this device, saved into a copy on request.
  const [marks, setMarks] = useState<Highlight[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(hlKey(file)) ?? "[]");
    } catch {
      return [];
    }
  });
  const saveMarks = (next: Highlight[]) => {
    setMarks(next);
    try {
      localStorage.setItem(hlKey(file), JSON.stringify(next));
    } catch {
      // Storage blocked or full: kept until the viewer closes.
    }
  };
  // The text selected on the pages (or a highlight tapped), and where to offer what to do with it.
  const [picked, setPicked] = useState<null | { at: { x: number; y: number }; text: string; boxes: { page: number; box: Box }[] } | { at: { x: number; y: number }; mark: string }>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const texts = useRef<Map<number, string>>(new Map());
  const failed = useRef(onError);
  useEffect(() => {
    failed.current = onError;
  });

  // The margin beside the pages: narrow on phones.
  const pad = view.w < 640 ? 6 : 12;
  const spread = layout === "spread" && view.w >= SPREAD_MIN;
  const fit = useMemo(() => {
    let w = spread ? Math.min((view.w - 48 - GAP) / 2, 720) : Math.min(view.w - (view.w < 640 ? 12 : 48), 880);
    // Fit the page: the whole of the tallest page on screen at once.
    if (fitMode === "page" && ratios.length) w = Math.min(w, (view.h - 84) / Math.max(...ratios));
    return Math.max(160, w);
  }, [view, spread, fitMode, ratios]);
  const width = Math.round(fit * zoom);
  // Where each page sits: one column, or rows of two.
  const pos = useMemo(() => {
    const out: { top: number; left: number }[] = [];
    let y = GAP;
    for (let i = 0; i < ratios.length; i++) {
      if (spread) {
        const pair = i % 2 === 0;
        out.push({ top: y, left: pair ? pad : pad + width + GAP });
        if (!pair || i === ratios.length - 1) y += width * Math.max(ratios[i], pair ? 0 : ratios[i - 1]) + GAP;
      } else {
        out.push({ top: y, left: pad });
        y += width * ratios[i] + GAP;
      }
    }
    return { at: out, height: y, width: (spread ? width * 2 + GAP : width) + pad * 2 };
  }, [ratios, width, spread, pad]);
  const tops = useMemo(() => pos.at.map((p) => p.top), [pos]);

  // Open the file, measure its pages, and go back to where it was left.
  useEffect(() => {
    let live = true;
    (async () => {
      const d = await docFor(file);
      const rs: number[] = [];
      for (let i = 1; i <= d.numPages; i++) {
        const v = (await d.getPage(i)).getViewport({ scale: 1 });
        rs.push(v.height / v.width);
      }
      if (!live) return;
      setDoc(d);
      void remember(file, d.numPages);
      setRatios(rs);
    })().catch((e) => live && failed.current(e));
    return () => {
      live = false;
    };
  }, [file]);

  // The page fits the screen's width, up to a comfortable reading width.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !ratios.length || !scroller.current) return;
    restored.current = true;
    let at = 0;
    try {
      at = Number(localStorage.getItem(placeKey(file)) ?? 0) || 0;
    } catch {
      // Storage blocked: start at the first page.
    }
    if (at > 0 && at < ratios.length) {
      scroller.current.scrollTop = tops[at] - GAP;
      setCurrent(at);
      setResumed(at);
      setTimeout(() => setResumed(null), 3500);
    }
  }, [ratios, tops, file]);

  // Full screen while it's open: the page behind doesn't scroll.
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.viewer = "";
    return () => {
      delete html.dataset.viewer;
    };
  }, []);

  // The controls fade after a moment of reading, unless a panel is open.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The mouse resting on the bar or the dock keeps them.
  const hover = useRef(false);
  const holdProps = { onMouseEnter: () => { hover.current = true; }, onMouseLeave: () => { hover.current = false; } };
  const wake = () => {
    setChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => !hover.current && setChrome(false), 2800);
  };
  useEffect(() => {
    hideTimer.current = setTimeout(() => setChrome(false), 2800);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);
  const shown = chrome || !!panel || !doc;
  const mouse = useRef<{ x: number; y: number } | null>(null);

  const lastY = useRef(0);
  const input = useRef(-1e9);
  const touched = () => {
    input.current = performance.now();
  };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const y = el.scrollTop;
    // Scrolling down reads on; scrolling up looks for something. Only the
    // reader's own scrolling counts, not a jump to a page or a resize.
    const own = performance.now() - input.current < 600;
    if (own && y > lastY.current + 6 && !panel) setChrome(false);
    else if (own && y < lastY.current - 24) wake();
    lastY.current = y;
    if (reading) return;
    const mid = y + el.clientHeight * 0.4;
    let p = 0;
    while (p + 1 < tops.length && tops[p + 1] <= mid) p++;
    if (p !== current) setCurrent(p);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(placeKey(file), String(p));
      } catch {
        // Storage blocked: the place isn't kept.
      }
      void rememberPage(file, p);
    }, 400);
  };

  const goTo = (p: number, smooth = true) => {
    const el = scroller.current;
    if (!el || p < 0 || p >= tops.length) return;
    if (reading) setReading(null);
    el.scrollTo({ top: tops[p] - GAP, behavior: smooth ? "smooth" : "auto" });
    setCurrent(p);
  };

  // Zooming keeps the same spot of the document under the eye.
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const zoomTo = (z: number, cx?: number, cy?: number) => {
    const el = scroller.current;
    const next = Math.max(0.5, Math.min(5, z));
    if (!el || next === zoomRef.current) return;
    zoomRef.current = next;
    const r = el.getBoundingClientRect();
    const ox = (cx ?? r.left + r.width / 2) - r.left, oy = (cy ?? r.top + r.height / 2) - r.top;
    const fx = (el.scrollLeft + ox) / Math.max(1, el.scrollWidth), fy = (el.scrollTop + oy) / Math.max(1, el.scrollHeight);
    setZoom(next);
    requestAnimationFrame(() => {
      el.scrollLeft = fx * el.scrollWidth - ox;
      el.scrollTop = fy * el.scrollHeight - oy;
    });
  };

  // Pinch with two fingers, or with the trackpad (ctrl + wheel).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let start: { d: number; z: number } | null = null;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = { d: dist(e), z: zoomRef.current };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomTo(start.z * (dist(e) / start.d), cx, cy);
    };
    const onEnd = () => {
      start = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY / 300), e.clientX, e.clientY);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("wheel", onWheel);
    };
     
  }, []);

  // A tap on the page (not a drag, not a text selection) shows or hides the controls.
  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY };
  };
  // On a touch screen: a sideways swipe turns the page (when the page fits
  // the width), a double tap zooms in there and back, a single tap shows or
  // hides the controls (after a moment, in case a second tap follows).
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const prev = lastTap.current;
    const now = performance.now();
    // A double tap (or double click) zooms, rather than selecting a word.
    if (!reading && prev && now - prev.t < 300 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30 && Math.hypot(dx, dy) < 8) {
      lastTap.current = null;
      if (tapTimer.current) clearTimeout(tapTimer.current);
      getSelection()?.removeAllRanges();
      zoomTo(zoomRef.current > 1.05 ? 1 : 2, e.clientX, e.clientY);
      return;
    }
    if (String(getSelection() ?? "")) return;
    if (e.pointerType === "touch" && !reading && zoomRef.current <= 1 && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) {
      goTo(current + (dx < 0 ? 1 : -1) * (spread ? 2 : 1) * (document.dir === "rtl" ? -1 : 1));
      return;
    }
    if (Math.hypot(dx, dy) > 8) return;
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      if (picked) setPicked(null);
      else if (panel) setPanel(null);
      else if (shown) setChrome(false);
      else wake();
    }, e.pointerType === "touch" ? 260 : 0);
  };

  // A selection on the pages: its lines as boxes on each page, for a highlight.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      const sel = getSelection();
      const pages = scroller.current?.querySelector(".vw-pages");
      if (!sel || sel.isCollapsed || !sel.rangeCount || !pages || !pages.contains(sel.anchorNode)) {
        setPicked((p) => (p && "text" in p ? null : p));
        return;
      }
      const range = sel.getRangeAt(0);
      const lines = new Map<string, { page: number; l: number; t: number; r: number; b: number }>();
      for (const rc of range.getClientRects()) {
        if (rc.width < 1 || rc.height < 1) continue;
        const el = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2)?.closest<HTMLElement>("[data-page]")
          ?? [...pages.querySelectorAll<HTMLElement>("[data-page]")].find((p) => { const b = p.getBoundingClientRect(); return rc.top >= b.top - 2 && rc.bottom <= b.bottom + 2; });
        if (!el) continue;
        const page = Number(el.dataset.page) - 1;
        // One box per line: rectangles at the same height join up.
        const key = `${page}:${Math.round((rc.top + rc.bottom) / 2 / 4)}`;
        const cur = lines.get(key);
        lines.set(key, cur ? { page, l: Math.min(cur.l, rc.left), t: Math.min(cur.t, rc.top), r: Math.max(cur.r, rc.right), b: Math.max(cur.b, rc.bottom) } : { page, l: rc.left, t: rc.top, r: rc.right, b: rc.bottom });
      }
      const boxes: { page: number; box: Box }[] = [];
      for (const ln of lines.values()) {
        const pb = pages.querySelector<HTMLElement>(`[data-page="${ln.page + 1}"]`)!.getBoundingClientRect();
        boxes.push({ page: ln.page, box: { x: (ln.l - pb.left) / pb.width, y: (ln.t - pb.top) / pb.height, w: (ln.r - ln.l) / pb.width, h: (ln.b - ln.t) / pb.height } });
      }
      if (!boxes.length) return;
      const last = range.getBoundingClientRect();
      setPicked({ at: { x: last.left + last.width / 2, y: last.bottom }, text: sel.toString().trim(), boxes });
    };
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, 280);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const addMark = (color: string) => {
    if (!picked || !("text" in picked)) return;
    const byPage = new Map<number, Box[]>();
    for (const { page, box } of picked.boxes) byPage.set(page, [...(byPage.get(page) ?? []), box]);
    const added = [...byPage].map(([page, boxes]) => ({ id: crypto.randomUUID(), page, boxes, color, text: picked.text }));
    saveMarks([...marks, ...added]);
    getSelection()?.removeAllRanges();
    setPicked(null);
  };
  const copyPicked = async () => {
    if (picked && "text" in picked) await navigator.clipboard?.writeText(picked.text).catch(() => {});
    getSelection()?.removeAllRanges();
    setPicked(null);
  };
  const saveWithMarks = async () => {
    const { withHighlights } = await import("@/lib/pdf/highlights");
    const out = await withHighlights(await file.arrayBuffer(), marks);
    save(new Blob([out as BlobPart], { type: "application/pdf" }), file.name.replace(/\.pdf$/i, "") + "-highlighted.pdf");
  };

  const toggleReading = () => {
    if (reading) {
      setReading(null);
      requestAnimationFrame(() => goTo(current, false));
      return;
    }
    setReading("loading");
    import("@/lib/ai/speak")
      .then((s) => s.readingOrder(file))
      .then((d) => setReading(d.passages), () => setReading("none"));
  };

  // Search: the text of every page, read once, then counted for each query.
  const runSearch = async (q: string) => {
    setQuery(q);
    const s = q.trim().toLowerCase();
    if (!s || !doc) {
      setHits(null);
      return;
    }
    for (let i = 0; i < doc.numPages; i++) {
      if (!texts.current.has(i)) {
        const c = await (await doc.getPage(i + 1)).getTextContent();
        texts.current.set(i, c.items.map((it) => ("str" in it ? it.str : "")).join(" ").toLowerCase());
      }
    }
    const found: { page: number }[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const text = texts.current.get(i) ?? "";
      for (let k = text.indexOf(s); k >= 0; k = text.indexOf(s, k + s.length)) found.push({ page: i });
    }
    setHits(found);
    setHit(0);
    if (found.length) showHit(found[0].page);
  };
  const showHit = (p: number) => {
    goTo(p);
    setTimeout(() => scroller.current?.querySelector(`[data-page="${p + 1}"] .vw-hit`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 450);
  };
  const step = (by: number) => {
    if (!hits?.length) return;
    const n = (hit + by + hits.length) % hits.length;
    setHit(n);
    showHit(hits[n].page);
  };

  // Contents, from the file's own outline.
  useEffect(() => {
    if (panel !== "contents" || outline || !doc) return;
    const resolve = async (items: { title: string; dest: unknown; items: unknown[] }[]): Promise<Outline[]> =>
      Promise.all(items.map(async (o) => {
        let page: number | null = null;
        try {
          const dest = typeof o.dest === "string" ? await doc.getDestination(o.dest) : (o.dest as unknown[] | null);
          const ref = dest?.[0];
          if (ref && typeof ref === "object") page = await doc.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
          else if (typeof ref === "number") page = ref;
        } catch {
          // A broken link in the outline: shown, not clickable.
        }
        return { title: o.title, page, items: await resolve(o.items as typeof items) };
      }));
    void doc.getOutline().then((o) => resolve((o ?? []) as never)).then(setOutline, () => setOutline([]));
  }, [panel, outline, doc]);

  const more = async (id: ToolId) => {
    await handOffTo(id, [file]);
    router.push(href(`/${toolById(id).slug}`));
  };

  // Keys: + and − zoom, ⌘F / Ctrl+F searches, Esc closes a panel, then the viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.matches?.("input, textarea");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setPanel("search");
      } else if (e.key === "Escape") {
        if (panel) setPanel(null);
        else onClose();
      } else if (!typing && !reading && (e.key === "ArrowRight" || e.key === "ArrowLeft") && zoomRef.current <= 1) {
        // Page by page, two at a time side by side.
        e.preventDefault();
        goTo(current + (e.key === "ArrowRight" ? 1 : -1) * (spread ? 2 : 1));
      } else if (!typing && (e.key === "+" || e.key === "=")) zoomTo(zoomRef.current * 1.2);
      else if (!typing && e.key === "-") zoomTo(zoomRef.current / 1.2);
      else if (!typing && e.key === "0") zoomTo(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
     
    // goTo reads the same state listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, onClose, current, spread, reading, tops]);

  // Full screen (where the browser allows it): the viewer alone on the display.
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", on);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      // Refused (an iframe, an old browser): nothing changes.
    }
  };

  // Share, print or save the file as it is, from the viewer.
  const canShare = useMemo(() => {
    try {
      return !!navigator.canShare?.({ files: [file] });
    } catch {
      return false;
    }
  }, [file]);
  const shareFile = async () => {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch {
      // Cancelled, or not allowed here.
    }
  };
  const printFile = () => {
    const url = URL.createObjectURL(file);
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0";
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        // The browser can't print from a frame (some phones): the PDF opens, to print from there.
        window.open(url, "_blank", "noopener");
      }
      setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60_000);
    };
    document.body.append(frame);
  };
  const downloadFile = () => save(file, file.name);

  const total = ratios.length;
  const iconBtn = "vw-btn";

  return createPortal(
    <div ref={root} role="dialog" aria-modal aria-label={file.name} className="vw" data-theme={theme} data-night={night || undefined} data-chrome={shown || undefined}
      onMouseMove={(e) => {
        // Real moves only: some browsers send one when the page scrolls under a still mouse.
        const m = mouse.current;
        mouse.current = { x: e.clientX, y: e.clientY };
        if (m && (Math.abs(m.x - e.clientX) > 2 || Math.abs(m.y - e.clientY) > 2)) wake();
      }}>
      <header className="vw-bar" {...holdProps}>
        <button type="button" className={iconBtn} aria-label={t("viewer.close")} onClick={onClose}><X size={20} /></button>
        <p className="min-w-0 flex-1 truncate text-[15px] font-medium">{file.name}</p>
        <button type="button" className={iconBtn} aria-label={t("viewer.search")} aria-pressed={panel === "search"} onClick={() => setPanel(panel === "search" ? null : "search")}><Search size={19} /></button>
        <button type="button" className={iconBtn} aria-label={t("viewer.reading")} aria-pressed={!!reading} onClick={toggleReading}><BookOpenText size={19} /></button>
        <button type="button" className={iconBtn} aria-label={t("viewer.display")} aria-pressed={panel === "display"} onClick={() => setPanel(panel === "display" ? null : "display")}><SlidersHorizontal size={18} /></button>
        <button type="button" className={`${iconBtn} vw-more`} aria-label={t("viewer.more")} aria-pressed={panel === "more"} onClick={() => setPanel(panel === "more" ? null : "more")}><Sparkles size={18} /> <span className="max-sm:hidden">{t("viewer.moreShort")}</span></button>
      </header>

      {panel === "search" && (
        <div className="vw-search" role="search">
          <Search size={17} className="shrink-0 opacity-60" />
          <input autoFocus type="search" aria-label={t("viewer.search")} placeholder={t("viewer.searchPlaceholder")} value={query}
            onChange={(e) => void runSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }} />
          <span className="shrink-0 text-[13px] tabular-nums opacity-70" aria-live="polite">
            {hits ? (hits.length ? t("viewer.matches", { n: hit + 1, total: hits.length }) : t("viewer.noMatches")) : ""}
          </span>
          <button type="button" className={iconBtn} aria-label={t("viewer.prevMatch")} disabled={!hits?.length} onClick={() => step(-1)}><ChevronUp size={18} /></button>
          <button type="button" className={iconBtn} aria-label={t("viewer.nextMatch")} disabled={!hits?.length} onClick={() => step(1)}><ChevronDown size={18} /></button>
        </div>
      )}

      {isSide(panel) && (
        <aside className="vw-side" aria-label={t(panel === "pages" ? "viewer.pages" : panel === "marks" ? "viewer.highlights" : "viewer.contents")}>
          <div className="vw-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={panel === "pages"} onClick={() => setPanel("pages")}><LayoutList size={15} /> {t("viewer.pages")}</button>
            <button type="button" role="tab" aria-selected={panel === "contents"} onClick={() => setPanel("contents")}><ListTree size={15} /> {t("viewer.contents")}</button>
            <button type="button" role="tab" aria-selected={panel === "marks"} aria-label={t("viewer.highlights")} onClick={() => setPanel("marks")}><Highlighter size={15} />{marks.length ? <span className="tabular-nums">{marks.length}</span> : null}</button>
          </div>
          {panel === "pages" && doc && (
            <form className="vw-jump" onSubmit={(e) => {
              e.preventDefault();
              const n = Number(new FormData(e.currentTarget).get("page"));
              if (n >= 1 && n <= total) { goTo(n - 1); if (window.innerWidth < 760) setPanel(null); }
            }}>
              <label>{t("viewer.goTo")} <input name="page" type="number" inputMode="numeric" min={1} max={total} placeholder={String(current + 1)} /></label>
              <span className="opacity-60">/ {total}</span>
            </form>
          )}
          {panel === "pages" && doc && (
            <ol className="vw-thumbs">
              {ratios.map((r, i) => (
                <li key={i}>
                  <button type="button" aria-label={t("viewer.page", { n: i + 1, total })} aria-current={i === current ? "page" : undefined}
                    onClick={() => { goTo(i); if (window.innerWidth < 760) setPanel(null); }}>
                    <Thumb file={file} index={i} ratio={r} />
                    <span>{i + 1}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {panel === "marks" && (
            marks.length ? (
              <ul className="vw-toc">
                {marks.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="vw-mark-row" onClick={() => { goTo(m.page); if (window.innerWidth < 760) setPanel(null); }}>
                      <span aria-hidden className="vw-dot" data-color={m.color} />
                      <span className="min-w-0 flex-1 line-clamp-2">{m.text || "…"}</span>
                      <span className="tabular-nums opacity-60">{m.page + 1}</span>
                    </button>
                  </li>
                ))}
                <li className="p-2">
                  <button type="button" className="vw-row w-full" onClick={() => void saveWithMarks()}><Download size={16} /> {t("viewer.saveHighlights")}</button>
                </li>
              </ul>
            ) : <p className="p-4 text-[14px] opacity-70">{t("viewer.noHighlights")}</p>
          )}
          {panel === "contents" && (
            outline === null ? <p className="p-4 opacity-70"><Loader2 size={16} className="animate-spin" /></p>
              : outline.length ? <ContentsList items={outline} onPick={(p) => { goTo(p); if (window.innerWidth < 760) setPanel(null); }} />
                : <p className="p-4 text-[14px] opacity-70">{t("viewer.noContents")}</p>
          )}
        </aside>
      )}

      {panel === "display" && (
        <div className="vw-sheet vw-display" role="group" aria-label={t("viewer.display")}>
          <Choice label={t("viewer.theme")} value={theme} onChange={(v) => setTheme(v as Theme)}
            options={THEMES.map((k) => [k, t(`viewer.theme.${k}`)])} />
          <Choice label={t("viewer.layout")} value={spread ? "spread" : "scroll"} onChange={(v) => { setLayout(v as "scroll" | "spread"); setZoom(1); }}
            options={[["scroll", t("viewer.layout.scroll")], ["spread", t("viewer.layout.spread"), view.w < SPREAD_MIN]]} />
          <Choice label={t("viewer.fitTo")} value={fitMode} onChange={(v) => { setFitMode(v as "width" | "page"); setZoom(1); requestAnimationFrame(() => goTo(current, false)); }}
            options={[["width", t("viewer.fit.width")], ["page", t("viewer.fit.page")]]} />
          {typeof document !== "undefined" && document.fullscreenEnabled && (
            <button type="button" className="vw-row" aria-pressed={full} onClick={() => void toggleFull()}>
              {full ? <Minimize2 size={17} /> : <Maximize2 size={17} />} {t(full ? "viewer.exitFullscreen" : "viewer.fullscreen")}
            </button>
          )}
        </div>
      )}

      {panel === "more" && (
        <div className="vw-sheet" role="menu" aria-label={t("viewer.more")}>
          <div className="vw-actions">
            {canShare && <button type="button" role="menuitem" onClick={() => void shareFile()}><Share2 size={18} /> {t("viewer.share")}</button>}
            <button type="button" role="menuitem" onClick={printFile}><Printer size={18} /> {t("viewer.print")}</button>
            <button type="button" role="menuitem" onClick={downloadFile}><Download size={18} /> {t("viewer.download")}</button>
            {!!marks.length && <button type="button" role="menuitem" onClick={() => void saveWithMarks()}><Highlighter size={18} /> {t("viewer.saveHighlights")}</button>}
          </div>
          <p className="vw-sheet-title">{t("viewer.more")}</p>
          <ul>
            {MORE.map((id, i) => (
              <li key={id} style={{ "--i": i } as React.CSSProperties}>
                <button type="button" role="menuitem" onClick={() => void more(id)}>
                  <ToolIcon tool={toolById(id)} size={30} />
                  <span>{t(`tool.${id}.name`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div ref={scroller} className="vw-scroll" data-zoomed={zoom > 1 || undefined} tabIndex={-1} onScroll={onScroll} onWheel={touched} onTouchMove={touched} onKeyDown={touched} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        {!doc && <p className="vw-loading"><Loader2 size={22} className="animate-spin" /> {t("viewer.loading")}</p>}
        {reading ? (
          <article className="vw-read" style={{ fontSize: readSize }}>
            {reading === "loading" ? <p className="opacity-70"><Loader2 size={18} className="inline animate-spin" /></p>
              : reading === "none" ? <p>{t("viewer.readingNone")}</p>
                : reading.map((p, i) => p.kind === "heading" ? <h2 key={i}>{p.text}</h2> : <p key={i} data-list={p.kind === "list" || undefined}>{p.kind === "list" ? p.text.replace(/^[-–•*·▪◦]\s*/, "") : p.text}</p>)}
          </article>
        ) : doc && (
          <div className="vw-pages" style={{ width: pos.width, height: pos.height }}>
            {ratios.map((r, i) => (
              <PageView key={i} doc={doc} index={i} width={width} ratio={r} top={pos.at[i].top} left={pos.at[i].left} query={query.trim().toLowerCase()}
                marks={marks.filter((m) => m.page === i)} onMark={(id, at) => setPicked({ mark: id, at })} />
            ))}
          </div>
        )}
      </div>

      {doc && (
        <footer className="vw-dock" {...holdProps}>
          <button type="button" className="vw-count" aria-label={t("viewer.pages")} aria-pressed={isSide(panel)}
            onClick={() => setPanel(isSide(panel) ? null : "pages")}>
            {reading ? t("viewer.reading") : t("viewer.page", { n: current + 1, total })}
          </button>
          <span className="vw-sep" />
          <button type="button" className={iconBtn} aria-label={t("viewer.zoomOut")} onClick={() => (reading ? setReadSize((s) => Math.max(14, s - 2)) : zoomTo(zoom / 1.25))}><ZoomOut size={18} /></button>
          <button type="button" className="vw-zoom tabular-nums" aria-label={t("viewer.fit")} onClick={() => (reading ? setReadSize(19) : zoomTo(1))}>
            {reading ? `${readSize}px` : `${Math.round(zoom * 100)}%`}
          </button>
          <button type="button" className={iconBtn} aria-label={t("viewer.zoomIn")} onClick={() => (reading ? setReadSize((s) => Math.min(32, s + 2)) : zoomTo(zoom * 1.25))}><ZoomIn size={18} /></button>
        </footer>
      )}

      {picked && (
        <div className="vw-pick" role="toolbar" aria-label={t("viewer.highlight")}
          style={{ left: Math.min(Math.max(picked.at.x, 120), window.innerWidth - 120), top: Math.max(70, Math.min(picked.at.y + 10, window.innerHeight - 70)) }}
          onPointerDown={(e) => e.preventDefault()}>
          {"text" in picked ? (
            <>
              {HL_COLORS.map((c) => (
                <button key={c} type="button" className="vw-swatch" data-color={c} aria-label={`${t("viewer.highlight")}: ${t(`viewer.color.${c}`)}`} onClick={() => addMark(c)} />
              ))}
              <span className="vw-sep" />
              <button type="button" className="vw-btn" aria-label={t("viewer.copy")} onClick={() => void copyPicked()}><Copy size={16} /></button>
            </>
          ) : (
            <button type="button" className="vw-btn" onClick={() => { saveMarks(marks.filter((m) => m.id !== picked.mark)); setPicked(null); }}>
              <Trash2 size={16} /> {t("viewer.removeHighlight")}
            </button>
          )}
        </div>
      )}

      {resumed !== null && <p className="vw-toast" role="status">{t("viewer.resumed", { n: resumed + 1 })}</p>}
    </div>,
    document.body,
  );
}

// One page: drawn when it comes near the screen, sharp at the size it's
// shown, with its text laid over it so it can be selected, copied and found.
function PageView({ doc, index, width, ratio, top, left, query, marks, onMark }: {
  doc: PDFDocumentProxy; index: number; width: number; ratio: number; top: number; left: number; query: string;
  marks: Highlight[]; onMark: (id: string, at: { x: number; y: number }) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root: el.closest(".vw-scroll"), rootMargin: "1600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) {
      art.current?.replaceChildren();
      words.current?.replaceChildren();
      return;
    }
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    let layer: { cancel(): void } | null = null;
    // While zooming, the page is stretched until the zoom settles, then drawn again.
    const timer = setTimeout(async () => {
      try {
        const page = await doc.getPage(index + 1);
        const scale = width / page.getViewport({ scale: 1 }).width;
        const out = Math.min(Math.min(2, window.devicePixelRatio || 1), 4096 / width);
        const vp = page.getViewport({ scale: scale * out });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        task = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp });
        await task.promise;
        if (cancelled) return;
        art.current?.replaceChildren(canvas);
        const holder = words.current;
        if (!holder) return;
        const { TextLayer } = await import("pdfjs-dist");
        holder.replaceChildren();
        holder.style.setProperty("--total-scale-factor", String(scale));
        holder.style.setProperty("--scale-factor", String(scale));
        const tl = new TextLayer({ textContentSource: await page.getTextContent(), container: holder, viewport: page.getViewport({ scale }) });
        layer = tl;
        await tl.render();
        if (!cancelled) mark(holder, query);
      } catch {
        // Cancelled by a newer size, or the page can't be drawn: it stays blank.
      }
    }, art.current?.childElementCount ? 180 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
      layer?.cancel();
    };
    // query is applied by the effect below; drawing again for it isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, width, doc, index]);

  useEffect(() => {
    if (words.current) mark(words.current, query);
  }, [query]);

  return (
    <div ref={box} data-page={index + 1} className="vw-page" style={{ top, left, width, height: width * ratio }}>
      <div ref={art} className="vw-art" />
      {marks.flatMap((m) => m.boxes.map((b, k) => (
        <button key={`${m.id}:${k}`} type="button" tabIndex={k ? -1 : 0} aria-label={m.text} className="vw-hl" data-color={m.color}
          style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
          onPointerUp={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onMark(m.id, { x: r.left + r.width / 2, y: r.bottom }); }} />
      )))}
      <div ref={words} className="textLayer" />
    </div>
  );
}

// Marks the bits of text on a page that hold what's searched for.
function mark(holder: HTMLElement, query: string) {
  for (const span of holder.querySelectorAll<HTMLElement>("span")) {
    span.classList.toggle("vw-hit", !!query && (span.textContent ?? "").toLowerCase().includes(query));
  }
}

function Thumb({ file, index, ratio }: { file: File; index: number; ratio: number }) {
  const el = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const ctrl = new AbortController();
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      thumbUrl(file, index, 120, ctrl.signal).then((r) => setUrl(r.url), () => {});
    }, { rootMargin: "400px 0px" });
    io.observe(node);
    return () => {
      io.disconnect();
      ctrl.abort();
    };
  }, [file, index]);
  return (
    <span ref={el} className="vw-thumb" style={{ aspectRatio: `1 / ${ratio}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" />}
    </span>
  );
}

function ContentsList({ items, onPick }: { items: Outline[]; onPick: (page: number) => void }) {
  return (
    <ul className="vw-toc">
      {items.map((o, i) => (
        <li key={i}>
          <button type="button" disabled={o.page === null} onClick={() => o.page !== null && onPick(o.page)}>
            <span className="min-w-0 flex-1 truncate">{o.title}</span>
            {o.page !== null && <span className="tabular-nums opacity-60">{o.page + 1}</span>}
          </button>
          {!!o.items.length && <ContentsList items={o.items} onPick={onPick} />}
        </li>
      ))}
    </ul>
  );
}

// A row of choices that reads as one control (a segmented button).
function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string, boolean?][]; onChange: (v: string) => void }) {
  return (
    <div className="vw-choice" role="radiogroup" aria-label={label}>
      <span>{label}</span>
      <div>
        {options.map(([k, text, off]) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} disabled={off} onClick={() => onChange(k)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

// Saves a file the way a download link does (Firefox needs the link in the page).
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
