"use client";

// Compress, as a vacuum sealer: the document's first page slides out of the
// slot in a clear bag, then the air is drawn out. The bag pulls in at the
// sides, wrinkles over the page and the page crinkles with it, while the
// display counts the bag's air down and the knob turns. Driven by the job's
// progress (0 to 1), with a slow pace of its own so a job that reports
// little still shows the bag coming out; drawn once, still, for reduced motion.

import { useEffect, useId, useRef, useState } from "react";
import { thumbUrl } from "@/lib/pdf/thumbs";
import { reducedMotion } from "@/lib/paper";
import { SHOW_S } from "./kit";

const W = 200; // the bag, in px; the page sits inside it
const H = 230;
const OUT = 0.22; // the share of the show spent coming out of the slot

// The bag's outline at suction s (0 loose, 1 drawn tight): its sides pull in
// unevenly and its foot crumples, as film does.
function bagPath(s: number, t: number) {
  const side = (y: number, k: number) => s * (9 + 7 * Math.sin(y * 0.05 + k + t * 0.8) + 4 * Math.sin(y * 0.14 + k * 2 - t * 0.5));
  const pts = [`M ${side(0, 0).toFixed(1)} 0`];
  for (let i = 1; i <= 16; i++) {
    const y = (i / 16) * H;
    pts.push(`L ${side(y, 0).toFixed(1)} ${y.toFixed(1)}`);
  }
  for (let i = 1; i <= 12; i++) {
    const x = (i / 12) * W;
    const y = H - s * (5 + 4 * Math.sin(x * 0.09 + t) + 3 * Math.sin(x * 0.27 + 1.3));
    pts.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  for (let i = 16; i >= 0; i--) {
    const y = (i / 16) * H;
    pts.push(`L ${(W - side(y, 2.1)).toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" ") + " Z";
}

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);

// The picture in the bag: the first page of a PDF, or an image as it is.
function usePicture(file?: File) {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    const own = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    (own ? Promise.resolve({ url: own }) : thumbUrl(file, 0, 160)).then((r) => live && setImg(r.url), () => {});
    return () => {
      live = false;
      if (own) URL.revokeObjectURL(own);
    };
  }, [file]);
  return img;
}

export function VacuumSealer({ file, value }: { file?: File; value: number }) {
  const id = useId().replace(/:/g, "");
  const img = usePicture(file);
  const bag = useRef<SVGPathElement>(null);
  const clip = useRef<SVGPathElement>(null);
  const crinkle = useRef<SVGFEDisplacementMapElement>(null);
  const page = useRef<SVGGElement>(null);
  const folds = useRef<SVGFEDiffuseLightingElement>(null);
  const creases = useRef<SVGRectElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const air = useRef<HTMLSpanElement>(null);
  const target = useRef(value);
  useEffect(() => {
    target.current = value;
  }, [value]);

  // One loop draws every part from the shown progress, which eases toward the job's.
  useEffect(() => {
    const still = reducedMotion();
    let raf = 0;
    let shown = 0;
    let last = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      const t = (now - start) / 1000;
      // Its own pace: out of the slot in a second, then slowly drawing air until the job catches up.
      const goal = still ? 1 : Math.max(target.current, Math.min(OUT, t / 1.1), Math.min(0.75, OUT + (t - 1.4) / 9));
      shown = still ? goal : shown + Math.min((goal - shown) * 0.07, dt / SHOW_S);
      const out = 1 - (1 - Math.min(1, shown / OUT)) ** 3;
      const s = Math.max(0, Math.min(1, (shown - OUT) / (1 - OUT)));
      const d = bagPath(s, still ? 0 : t);
      bag.current?.setAttribute("d", d);
      clip.current?.setAttribute("d", d);
      crinkle.current?.setAttribute("scale", (s * 18).toFixed(2));
      folds.current?.setAttribute("surfaceScale", (s * 5).toFixed(2));
      creases.current?.setAttribute("opacity", (s * 0.75).toFixed(3));
      const sx = 1 - s * 0.14;
      const sy = 1 - s * 0.08;
      page.current?.setAttribute("transform", `translate(${(W / 2) * (1 - sx)} ${-H * (1 - out)}) scale(${sx} ${sy})`);
      if (knob.current) knob.current.style.rotate = `${shown * 270}deg`;
      // A small shake while the pump runs.
      if (body.current) body.current.style.translate = s > 0 && s < 1 && !still ? `${(Math.sin(t * 70) * 0.35).toFixed(2)}px 0` : "";
      if (air.current) air.current.style.setProperty("--air", (1 - s).toFixed(3));
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div aria-hidden className="sealer">
      <div ref={body} className="sealer-body">
        <span className="sealer-plate">
          <span className="sealer-lcd">
            <span className="sealer-lcd-size">{file ? size(file.size) : "VAC"}</span>
            <span ref={air} className="sealer-lcd-air" />
          </span>
          <span className="sealer-screws" />
        </span>
        <span className="sealer-controls">
          <span ref={knob} className="sealer-knob"><i /></span>
          <span className="sealer-button" />
        </span>
        <span className="sealer-slot" />
      </div>
      <svg className="sealer-bag" viewBox={`-4 0 ${W + 8} ${H + 4}`} width={W + 8} height={H + 4}>
        <defs>
          <filter id={`crinkle-${id}`} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.03 0.06" numOctaves="2" seed="7" />
            <feDisplacementMap ref={crinkle} in="SourceGraphic" scale="0" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          {/* Creases: the film's folds, lit from the top left, deepening with the suction. */}
          <filter id={`folds-${id}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.035 0.08" numOctaves="3" seed="3" />
            <feDiffuseLighting ref={folds} lightingColor="#fff" surfaceScale="0" diffuseConstant="1.1">
              <feDistantLight azimuth="225" elevation="48" />
            </feDiffuseLighting>
          </filter>
          <clipPath id={`bag-${id}`}><path ref={clip} /></clipPath>
          <linearGradient id={`film-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.92" />
            <stop offset="1" stopColor="#e9ecef" stopOpacity="0.88" />
          </linearGradient>
          <pattern id={`sheen-${id}`} width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
            <rect width="12" height="34" fill="#ffffff" opacity="0.6" />
            <rect x="16" width="3" height="34" fill="#ffffff" opacity="0.35" />
          </pattern>
          <linearGradient id={`seal-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0.16" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g ref={page}>
          <g filter={`url(#crinkle-${id})`}>
            <g clipPath={`url(#bag-${id})`}>
              <rect x="-4" y="0" width={W + 8} height={H + 4} fill={`url(#film-${id})`} />
              <rect x="0" y="0" width={W} height="12" fill={`url(#seal-${id})`} />
              {img ? (
                <image href={img} x="20" y="22" width={W - 40} height={H - 50} preserveAspectRatio="xMidYMid meet" />
              ) : (
                <g>
                  <rect x="20" y="22" width={W - 40} height={H - 50} rx="2" fill="#f7f7f5" stroke="#d9dcdf" />
                  {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x="34" y={46 + i * 18} width={i % 3 === 2 ? 70 : 132} height="6" rx="3" fill="#d3d7db" />)}
                </g>
              )}
              <rect ref={creases} x="-4" y="0" width={W + 8} height={H + 4} filter={`url(#folds-${id})`} opacity="0" style={{ mixBlendMode: "multiply" }} />
              <rect x="-4" y="0" width={W + 8} height={H + 4} fill={`url(#sheen-${id})`} />
            </g>
          </g>
          <path ref={bag} fill="none" stroke="#000" strokeOpacity="0.1" />
        </g>
      </svg>
    </div>
  );
}
