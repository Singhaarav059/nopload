"use client";

// The parts the tool machines share (src/components/machines/Machines.tsx):
// the job's progress as a smooth drive, the pictures of the user's pages,
// and what they are built from: a body in the theme's colours (a
// warm grey in light, graphite in dark; globals.css --m-*), brushed metal,
// steel, a display, a knurled knob in the site's orange. Drawn in SVG, in a
// 300 by 300 box.

import { createContext, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { thumbUrl } from "@/lib/pdf/thumbs";
import { reducedMotion } from "@/lib/paper";

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
// How far p is through [a, b], from 0 to 1.
export const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const easeIn = (x: number) => x * x * x;
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export type Frame = { p: number; t: number; still: boolean };

// The fastest a machine's show may run: all of it in this many seconds. A
// quick job's result waits for it (Workspace.tsx SHOW_MS).
export const SHOW_S = 1.9;

// Set, the machines show value as it is, without easing or a pace of their
// own: for pictures of them at chosen moments.
export const ExactProgress = createContext(false);

// The shown progress: eases toward the job's, never faster than SHOW_S for
// the whole show, with a slow pace of its own so a job that reports little
// still moves (the first quarter in a second or so, then on toward 0.8).
// One frame, finished, for reduced motion.
export function useDrive(value: number): Frame {
  const exact = useContext(ExactProgress);
  const [frame, setFrame] = useState<Frame>({ p: 0, t: 0, still: false });
  const target = useRef(value);
  useEffect(() => {
    target.current = value;
  }, [value]);
  useEffect(() => {
    const still = reducedMotion();
    let raf = 0;
    let shown = 0;
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (still) return setFrame({ p: 1, t: 0, still: true });
      raf = requestAnimationFrame(tick);
      if (now - last < 30) return; // about 30 frames a second is plenty, and leaves the processor to the job
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      const t = (now - start) / 1000;
      const goal = Math.max(target.current, Math.min(0.25, t / 1.2), Math.min(0.8, 0.25 + (t - 1.5) / 10));
      shown += Math.min((goal - shown) * 0.12, dt / SHOW_S);
      setFrame({ p: shown, t, still: false });
    };
    if (!exact) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [exact]);
  return exact ? { p: value, t: value * 6, still: false } : frame;
}

// Pictures of the first page of up to n files: a PDF's rendered, an image as it is.
export function usePictures(files: File[] | undefined, n = 1) {
  const [pics, setPics] = useState<(string | null)[]>([]);
  useEffect(() => {
    const some = (files ?? []).slice(0, n);
    let live = true;
    const own: string[] = [];
    Promise.all(
      some.map((f) => {
        if (f.type.startsWith("image/")) {
          const url = URL.createObjectURL(f);
          own.push(url);
          return url;
        }
        return f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? thumbUrl(f, 0, 160).then((r) => r.url, () => null) : null;
      }),
    ).then((urls) => live && setPics(urls));
    return () => {
      live = false;
      own.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files, n]);
  return pics;
}

// The machines' one accent, the site's own orange: knobs, handles and lamps.
// Three shades, light to deep. Other colours only where they mean something:
// green for done, red for stop or ink, a file format's own colour.
type Accent = readonly [string, string, string];
const BRAND: Accent = ["#ffc9a6", "#ff6a13", "#c2410c"];

// A machine's id for its gradients and filters, unique on the page.
export const useSvgId = () => "mc" + useId().replace(/[^a-zA-Z0-9]/g, "");

// Ids for one machine's gradients and filters, unique on the page.
const Ids = createContext("m");
export const urlOf = (id: string) => (name: string) => `url(#${id}-${name})`;
export const useUrl = () => urlOf(useContext(Ids));

// The theme's colours, for SVG attributes that can't take var() directly.
export const fill = (token: string): CSSProperties => ({ fill: `var(${token})` });
export const stroke = (token: string): CSSProperties => ({ stroke: `var(${token})` });
const stop = (token: string): CSSProperties => ({ stopColor: `var(${token})` });

export function Svg({ id, children }: { id: string; children: ReactNode }) {
  const accent = BRAND;
  const k = (name: string) => `${id}-${name}`;
  return (
    <Ids.Provider value={id}>
      <svg aria-hidden className="machine" viewBox="0 0 300 300" width="300" height="300">
        <defs>
          <linearGradient id={k("body")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={stop("--m-body-1")} />
            <stop offset="0.6" style={stop("--m-body-2")} />
            <stop offset="1" style={stop("--m-body-3")} />
          </linearGradient>
          <linearGradient id={k("side")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={stop("--m-side-1")} />
            <stop offset="1" style={stop("--m-side-2")} />
          </linearGradient>
          <linearGradient id={k("metal")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e4e7ea" />
            <stop offset="1" stopColor="#b3b8be" />
          </linearGradient>
          <pattern id={k("brush")} width="3" height="10" patternUnits="userSpaceOnUse">
            <rect width="1" height="10" fill="#fff" opacity="0.22" />
          </pattern>
          <linearGradient id={k("steel")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#9aa1a8" />
            <stop offset="0.35" stopColor="#f4f6f8" />
            <stop offset="0.7" stopColor="#c4c9ce" />
            <stop offset="1" stopColor="#8d949b" />
          </linearGradient>
          <linearGradient id={k("steelv")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f4f6f8" />
            <stop offset="0.5" stopColor="#c4c9ce" />
            <stop offset="1" stopColor="#8d949b" />
          </linearGradient>
          <radialGradient id={k("lcd")} cx="0.3" cy="0.2" r="1">
            <stop offset="0" stopColor="#373b3f" />
            <stop offset="0.7" stopColor="#17191b" />
          </radialGradient>
          <radialGradient id={k("accent")} cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor={accent[0]} />
            <stop offset="0.75" stopColor={accent[1]} />
          </radialGradient>
          <linearGradient id={k("accentv")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={accent[0]} />
            <stop offset="0.5" stopColor={accent[1]} />
            <stop offset="1" stopColor={accent[2]} />
          </linearGradient>
          <linearGradient id={k("rubber")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3b3d40" />
            <stop offset="1" stopColor="#151618" />
          </linearGradient>
          <filter id={k("shadow")} x="-20%" y="-20%" width="140%" height="150%">
            <feDropShadow dx="0" dy="8" stdDeviation="8" style={{ floodColor: "var(--m-shadow)", floodOpacity: "var(--m-shadow-o)" }} />
          </filter>
          <filter id={k("soft")} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#000" floodOpacity="0.18" />
          </filter>
          <filter id={k("glow")} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g style={{ "--accent-m": accent[1], "--accent-m-hi": accent[0] } as CSSProperties}>{children}</g>
      </svg>
    </Ids.Provider>
  );
}

// A body panel: a rounded block in the theme's colours, with its top edge caught by the light.
export function Body({ x, y, w, h, r = 18, shadow = true, side = false }: { x: number; y: number; w: number; h: number; r?: number; shadow?: boolean; side?: boolean }) {
  const url = useUrl();
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={url(side ? "side" : "body")} filter={shadow ? url("shadow") : undefined} />
      <rect x={x + 1} y={y + 0.5} width={w - 2} height={h - 1} rx={r - 0.5} fill="none" style={stroke("--m-edge")} />
      <rect x={x + 0.25} y={y + 0.25} width={w - 0.5} height={h - 0.5} rx={r} fill="none" style={stroke("--m-line")} strokeWidth="0.5" />
    </g>
  );
}

// The dark display, in a brushed-metal bezel.
export function Lcd({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children: ReactNode }) {
  const url = useUrl();
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" fill={url("metal")} />
      <rect x={x} y={y} width={w} height={h} rx="10" fill={url("brush")} />
      <rect x={x + 7} y={y + 7} width={w - 14} height={h - 14} rx="5" fill={url("lcd")} />
      <g className="machine-lcd" filter={url("glow")}>{children}</g>
    </g>
  );
}

// The knurled knob in the machine's accent, turned to angle degrees.
export function Knob({ cx, cy, r = 22, angle = 0 }: { cx: number; cy: number; r?: number; angle?: number }) {
  const url = useUrl();
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <circle r={r} style={{ fill: "var(--accent-m)" }} filter={url("soft")} />
      <g transform={`rotate(${angle})`}>
        {Array.from({ length: 30 }, (_, i) => (
          <rect key={i} x={-1.6} y={-r} width="3.2" height={r * 0.32} rx="1" style={{ fill: "var(--accent-m-hi)" }} opacity="0.75" transform={`rotate(${i * 12})`} />
        ))}
        <circle r={r * 0.72} fill={url("accent")} />
        <rect x={-1.5} y={-r * 0.62} width="3" height={r * 0.36} rx="1.5" fill="#fff" opacity="0.92" />
      </g>
    </g>
  );
}

// A small round-ended push button in the accent.
export function Button({ x, y, w = 26, h = 13 }: { x: number; y: number; w?: number; h?: number }) {
  const url = useUrl();
  return (
    <g>
      <rect x={x} y={y + 2} width={w} height={h} rx={h / 2} fill="#000" opacity="0.18" />
      <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={url("accentv")} />
      <rect x={x + 4} y={y + 2} width={w - 8} height="3" rx="1.5" fill="#fff" opacity="0.4" />
    </g>
  );
}

// A ball handle in the accent, for levers and stamps.
export function Ball({ cx, cy, r = 11 }: { cx: number; cy: number; r?: number }) {
  const url = useUrl();
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={url("accent")} filter={url("soft")} />
      <circle cx={cx - r * 0.3} cy={cy - r * 0.35} r={r * 0.28} fill="#fff" opacity="0.45" />
    </g>
  );
}

// A small status light: off, green or red.
export function Led({ cx, cy, on }: { cx: number; cy: number; on?: "green" | "red" | null }) {
  const url = useUrl();
  const color = on === "green" ? "#4ade80" : on === "red" ? "#ff5a4e" : "#6b6f75";
  return <circle cx={cx} cy={cy} r="4" fill={color} filter={on ? url("glow") : undefined} stroke="#000" strokeOpacity="0.2" />;
}

// A display's segmented bar, lit to value (0 to 1).
export function Meter({ x, y, w, value }: { x: number; y: number; w: number; value: number }) {
  const n = 20;
  const each = w / n;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={x + i * each} y={y} width={each - 2} height="5" rx="1" opacity={i < Math.round(value * n) ? 1 : 0.18} />
      ))}
    </g>
  );
}

// Text on a display.
export function LcdText({ x, y, children, size = 17 }: { x: number; y: number; children: ReactNode; size?: number }) {
  return (
    <text x={x} y={y} fontSize={size}>
      {children}
    </text>
  );
}

// A sheet: the user's page when there is a picture of it, ruled lines when
// not, nothing at all when blank.
export function Sheet({ x, y, w, h, pic, opacity = 1, blank }: { x: number; y: number; w: number; h: number; pic?: string | null; opacity?: number; blank?: boolean }) {
  const url = useUrl();
  return (
    <g opacity={opacity}>
      <rect x={x} y={y} width={w} height={h} rx="2" fill="#fff" filter={url("soft")} />
      {blank ? null : pic ? (
        <image href={pic} x={x + 4} y={y + 4} width={w - 8} height={h - 8} preserveAspectRatio="xMidYMid meet" />
      ) : (
        Array.from({ length: Math.floor((h - 26) / 14) }, (_, i) => (
          <rect key={i} x={x + 12} y={y + 16 + i * 14} width={(w - 24) * (i % 4 === 3 ? 0.55 : i === 0 ? 0.7 : 1)} height="5" rx="2.5" fill={i === 0 ? "#b9bfc6" : "#d7dbdf"} />
        ))
      )}
      <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx="2" fill="none" stroke="#000" strokeOpacity="0.08" />
    </g>
  );
}
