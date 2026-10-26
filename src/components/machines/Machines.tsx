"use client";

// A machine for each kind of tool, shown while it works, each doing to the
// user's own page what the tool does: Merge's press staples the pages into
// one, Split's guillotine cuts the page in two, a safe locks and unlocks,
// a flatbed plotter signs, a scanner reads (and blacks out, compares or
// highlights), a turntable turns, a printer converts, a typewriter edits and
// a hand stamp marks or numbers. Compress has its vacuum sealer. Each has
// its own shape and accent colour (kit.tsx ACCENTS). Each is drawn
// from the job's progress (kit.tsx useDrive), finished and still for
// reduced motion.

import type { ReactNode } from "react";
import type { ToolId } from "@/lib/tools";
import { VacuumSealer } from "./VacuumSealer";
import { Camera, Cabinet, Claw, Embosser, Flipper, Funnel, Intercom, LabelMaker, Patcher, Polaroid, Radio, Shredder, Shuffler } from "./PageMachines";
import { Bookmarker, Clipper, Conveyor, Cropper, DyeBath, Folder, InkRoller, Iron, LightTable, Loupe, Rollers, Squeegee, Tiler, Washer } from "./ShopMachines";
import { ACCENTS, Ball, Body, Button, Engraved, Knob, Lcd, LcdText, Led, Meter, Sheet, Svg, easeIn, easeInOut, easeOut, fill, seg, urlOf, useDrive, usePictures, useSvgId } from "./kit";

type Props = { files?: File[]; value: number };

// Merge: the pages fly in from either side into one stack, and the press's
// lever comes down: its head staples the stack's corner.
function Press({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const pics = usePictures(files, 3);
  const count = Math.max(2, Math.min(3, files?.length ?? 2));
  const from = [
    [-190, -6, -14],
    [150, 40, 12],
    [-20, 170, 6],
  ];
  const down = easeIn(seg(p, 0.6, 0.68)) * (1 - easeOut(seg(p, 0.72, 0.86)));
  const d = down * 16;
  const X = 64;
  const Y = 112;
  return (
    <Svg id={id} accent={ACCENTS.orange}>
      <Body x={14} y={262} w={272} h={32} r={12} />
      <Engraved x={272} y={283} anchor="end">{`${files?.length ?? count} → 1`}</Engraved>
      <Body x={232} y={40} w={38} h={226} r={12} side shadow={false} />
      <g transform={`translate(0 ${down * 1.5})`}>
        {Array.from({ length: count }, (_, i) => {
          const a = easeOut(seg(p, 0.04 + i * 0.13, 0.32 + i * 0.13));
          const [fx, fy, fr] = from[i];
          return (
            <g key={i} opacity={seg(p, 0.02 + i * 0.13, 0.1 + i * 0.13)} transform={`translate(${fx * (1 - a) + (count - 1 - i) * -2} ${fy * (1 - a) + (count - 1 - i) * 2}) rotate(${fr * (1 - a)} ${X + 60} ${Y + 74})`}>
              <Sheet x={X} y={Y} w={120} h={148} pic={pics[i] ?? pics[0]} />
            </g>
          );
        })}
        {p > 0.66 && <rect x={X + 4} y={Y + 12} width="20" height="3.6" rx="1.6" fill={url("steel")} stroke="#6b7177" strokeWidth="0.6" transform={`rotate(-40 ${X + 14} ${Y + 14})`} />}
      </g>
      <rect x="76" y="66" width="8" height={16 + d} fill={url("steel")} />
      <g transform={`translate(0 ${d})`}>
        <rect x="54" y="78" width="52" height="24" rx="7" fill={url("body")} filter={url("soft")} />
        <rect x="58" y="100" width="44" height="6" rx="2" fill={url("steel")} />
      </g>
      <Body x={52} y={34} w={218} h={38} r={16} />
      <g transform={`rotate(${16 - 16 * down} 252 34)`}>
        <rect x="170" y="31" width="82" height="6" rx="3" fill={url("steelv")} />
        <Ball cx={168} cy={34} r={12} />
      </g>
      <circle cx="252" cy="34" r="8" fill={url("steel")} stroke="#7d848b" strokeWidth="0.6" />
    </Svg>
  );
}

// Split: the lever comes down, the blade drops through the middle of the
// page, lifts, and the two halves slide apart into two files.
function Guillotine({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const pos = easeIn(seg(p, 0.22, 0.46)) * (1 - easeOut(seg(p, 0.5, 0.66)));
  const tip = 96 + 166 * pos;
  const cut = Math.min(260, 96 + 166 * easeIn(seg(p, 0.22, 0.46)));
  const apart = easeOut(seg(p, 0.62, 0.92));
  const X = 90;
  const Y = 104;
  return (
    <Svg id={id} accent={ACCENTS.red}>
      <defs>
        <clipPath id={`${id}-L`}><rect x="0" y="0" width="150" height="300" /></clipPath>
        <clipPath id={`${id}-R`}><rect x="150" y="0" width="150" height="300" /></clipPath>
      </defs>
      <rect x="14" y="84" width="12" height="186" rx="4" fill={url("steel")} />
      <rect x="274" y="84" width="12" height="186" rx="4" fill={url("steel")} />
      <Body x={8} y={262} w={284} h={32} r={10} />
      <Engraved x={280} y={283} anchor="end">1 → 2</Engraved>
      <g transform={`translate(${-30 * apart} ${3 * apart}) rotate(${-5 * apart} 150 260)`} clipPath={`url(#${id}-L)`}>
        <Sheet x={X} y={Y} w={120} h={156} pic={pic} />
      </g>
      <g transform={`translate(${30 * apart} ${3 * apart}) rotate(${5 * apart} 150 260)`} clipPath={`url(#${id}-R)`}>
        <Sheet x={X} y={Y} w={120} h={156} pic={pic} />
      </g>
      {p > 0.24 && apart < 0.05 && <line x1="150" y1={Y} x2="150" y2={cut} stroke="#000" strokeOpacity="0.35" strokeWidth="1.2" />}
      <path d={`M143 62 H157 V${tip - 10} L150 ${tip} L143 ${tip - 10} Z`} fill={url("steel")} stroke="#7d848b" strokeWidth="0.6" />
      <Body x={6} y={56} w={288} h={40} r={14} />
      <g transform={`rotate(${38 - 34 * pos} 272 76)`}>
        <rect x="180" y="73" width="92" height="6" rx="3" fill={url("steelv")} />
        <Ball cx={178} cy={76} r={12} />
      </g>
      <circle cx="272" cy="76" r="9" fill={url("steel")} stroke="#7d848b" strokeWidth="0.6" />
    </Svg>
  );
}

// Protect and Unlock: the safe's door swings shut on the page, the dial
// spins and the handle turns; or the other way round.
function Safe({ files, value, open }: Props & { open?: boolean }) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const [pic] = usePictures(files, 1);
  let door: number, dial: number, handle: number, dots: number;
  if (open) {
    const spin = easeInOut(seg(p, 0.06, 0.44));
    dial = spin * 540;
    dots = 4 - Math.floor(spin * 4);
    handle = 90 * (1 - easeOut(seg(p, 0.46, 0.56)));
    door = easeInOut(seg(p, 0.6, 0.92));
  } else {
    door = 1 - easeInOut(seg(p, 0.06, 0.38));
    const spin = easeInOut(seg(p, 0.42, 0.82));
    dial = -spin * 540;
    dots = Math.ceil(spin * 4);
    handle = 90 * easeOut(seg(p, 0.84, 0.94));
  }
  const locked = open ? door < 0.02 : p > 0.94;
  const spinning = open ? p > 0.06 && p < 0.44 : p > 0.42 && p < 0.82;
  const key = spinning ? Math.floor(t * 6) % 9 : -1;
  const sx = 1 - 0.86 * door;
  return (
    <Svg id={id} accent={ACCENTS.blue}>
      <Body x={22} y={12} w={256} h={282} r={22} />
      <Lcd x={38} y={22} w={132} h={46}>
        <LcdText x={52} y={51} size={16}>{"●".repeat(dots) + "○".repeat(4 - dots)}</LcdText>
      </Lcd>
      <Led cx={184} cy={45} on={locked ? "red" : open && door > 0.05 ? "green" : null} />
      {Array.from({ length: 9 }, (_, n) => (
        <rect key={n} x={198 + (n % 3) * 22} y={24 + Math.floor(n / 3) * 15} width="18" height="11" rx="3" fill={n === key ? url("accentv") : url("side")} stroke="#000" strokeOpacity="0.12" />
      ))}
      <rect x="50" y="80" width="200" height="200" rx="12" style={fill("--m-cavity")} />
      <rect x="50" y="80" width="200" height="200" rx="12" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="3" />
      <Sheet x={90} y={102} w={120} h={156} pic={pic} />
      <g transform={`translate(48 180) skewY(${-door * 9}) scale(${sx} 1) translate(-48 -180)`}>
        <rect x="48" y="78" width="204" height="204" rx="12" fill={url("side")} />
        <rect x="52" y="80" width="196" height="196" rx="10" fill={url("body")} />
        <rect x="66" y="94" width="168" height="168" rx="8" fill="none" stroke="#000" strokeOpacity="0.08" strokeWidth="2" />
        <rect x="67" y="95" width="166" height="166" rx="8" fill="none" stroke="#fff" strokeOpacity="0.6" />
        <Knob cx={128} cy={178} r={34} angle={dial} />
        <g transform={`translate(198 178) rotate(${handle})`}>
          {[0, 120, 240].map((a) => (
            <g key={a} transform={`rotate(${a})`}>
              <rect x="-2.5" y="-26" width="5" height="24" rx="2.5" fill={url("steel")} />
              <circle cy="-27" r="4.5" fill={url("red")} />
            </g>
          ))}
          <circle r="9" fill={url("steel")} stroke="#7d848b" strokeWidth="0.6" />
        </g>
        <rect x="46" y="102" width="8" height="24" rx="2" fill={url("steel")} />
        <rect x="46" y="232" width="8" height="24" rx="2" fill={url("steel")} />
        <rect x="48" y="78" width="204" height="204" rx="12" fill="#000" opacity={door * 0.22} />
      </g>
    </Svg>
  );
}

// The signature the plotter's pen draws, s from 0 to 1, in page coordinates.
const sig = (s: number) => ({
  x: 100 + 100 * s + 9 * Math.sin(s * Math.PI * 10),
  y: 246 - 16 * Math.sin(s * Math.PI * 5) * Math.sin(Math.PI * s) + 7 * Math.cos(s * Math.PI * 10),
});

type Pt = { x: number; y: number; ink: boolean };
// Pen moves: from one point to the next, in steps, with ink or without.
function route(strokes: { x: number; y: number }[][]): Pt[] {
  const out: Pt[] = [];
  strokes.forEach((line, s) => {
    line.forEach((q, i) => {
      const prev = i ? line[i - 1] : s ? strokes[s - 1].at(-1)! : null;
      const steps = prev ? Math.max(1, Math.round(Math.hypot(q.x - prev.x, q.y - prev.y) / 3)) : 1;
      for (let k = 1; k <= steps; k++) {
        const f = prev ? k / steps : 1;
        out.push({ x: prev ? prev.x + (q.x - prev.x) * f : q.x, y: prev ? prev.y + (q.y - prev.y) * f : q.y, ink: i > 0 });
      }
    });
  });
  return out;
}
const SIG_PATH = route([Array.from({ length: 161 }, (_, i) => sig(i / 160))]);
// Forms: a tick in each box and a word on its line.
const FORM_PATH = route(
  [0, 1, 2, 3].flatMap((i) => {
    const y = 128 + i * 34;
    return [
      [{ x: 101, y: y + 8 }, { x: 105.5, y: y + 13 }, { x: 113, y: y + 2 }],
      Array.from({ length: 14 }, (_, j) => ({ x: 126 + j * (40 + i * 8) / 13, y: y + 11 - (j % 2 ? 5 : 0) - Math.sin(j) * 1.5 })),
    ];
  }),
);

// Sign and Forms: a flatbed plotter's gantry carries the pen across the
// page and writes the signature, or ticks the boxes and fills the lines.
function Plotter({ files, value, form }: Props & { form?: boolean }) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const pts = form ? FORM_PATH : SIG_PATH;
  const k = easeInOut(seg(p, 0.12, 0.88));
  const rest = { x: 150, y: 150 };
  const a = pts[0];
  const b = pts[pts.length - 1];
  const pre = easeInOut(seg(p, 0, 0.12));
  const post = easeInOut(seg(p, 0.88, 1));
  const n = Math.floor(k * (pts.length - 1));
  const at = p < 0.12 ? { x: rest.x + (a.x - rest.x) * pre, y: rest.y + (a.y - rest.y) * pre } : p > 0.88 ? { x: b.x + (rest.x - b.x) * post, y: b.y + (rest.y - b.y) * post } : pts[n];
  const lift = p < 0.12 || p > 0.88 || !pts[n].ink ? 6 : 0;
  let d = "";
  for (let i = 0; i <= n; i++) {
    const q = pts[i];
    if (q.ink) d += `${i && pts[i - 1].ink ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
  }
  return (
    <Svg id={id} accent={ACCENTS.green}>
      <defs>
        <pattern id={`${id}-grid`} width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M12 0H0V12" fill="none" stroke="#fff" strokeOpacity="0.07" />
        </pattern>
      </defs>
      <Body x={6} y={66} w={288} h={230} r={20} />
      <rect x="26" y="78" width="248" height="206" rx="8" style={fill("--m-mat")} />
      <rect x="26" y="78" width="248" height="206" rx="8" fill={`url(#${id}-grid)`} />
      <rect x="10" y="76" width="9" height="212" rx="4" fill={url("steel")} />
      <rect x="281" y="76" width="9" height="212" rx="4" fill={url("steel")} />
      <Sheet x={83} y={86} w={134} h={192} pic={pic} />
      {form &&
        [0, 1, 2, 3].map((i) => (
          <g key={i}>
            <rect x="99" y={128 + i * 34} width="15" height="15" rx="2" fill="#fff" stroke="#8a9099" strokeWidth="1.2" />
            <line x1="124" y1={142 + i * 34} x2="202" y2={142 + i * 34} stroke="#b9bfc6" strokeWidth="1.2" />
          </g>
        ))}
      {d && <path d={d} fill="none" stroke="#1d2d7a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
      <g transform={`translate(0 ${-lift})`}>
        <rect x="8" y={at.y - 44} width="284" height="11" rx="5" fill={url("steelv")} filter={url("soft")} />
        <rect x="4" y={at.y - 50} width="22" height="23" rx="6" fill={url("accentv")} />
        <rect x="274" y={at.y - 50} width="22" height="23" rx="6" fill={url("accentv")} />
        <rect x={at.x - 16} y={at.y - 50} width="32" height="30" rx="7" fill={url("accentv")} filter={url("soft")} />
        <rect x={at.x - 12} y={at.y - 47} width="24" height="4" rx="2" fill="#fff" opacity="0.35" />
        <rect x={at.x - 3.5} y={at.y - 22} width="7" height="14" fill="#23262a" />
        <path d={`M${at.x - 3.5} ${at.y - 8} L${at.x} ${at.y} L${at.x + 3.5} ${at.y - 8} Z`} fill="#1d2d7a" />
      </g>
      <Led cx={276} cy={290} on={p > 0.12 && p < 0.88 ? "green" : null} />
    </Svg>
  );
}

type ScanMode = "ocr" | "read";
const ROWS = [1, 0.9, 0.95, 0.6, 1, 0.85, 0.7, 1, 0.5];
const MARKS: Record<ScanMode, Record<number, string>> = {
  ocr: Object.fromEntries(ROWS.map((_, i) => [i, "#4f8cff"])),
  read: { 1: "#2b9be8", 3: "#2b9be8", 6: "#2b9be8" },
};

// OCR, Redact, Compare and the reading tools: a scanner's light sweeps
// down the page and behind it the text is found (blue), blacked out,
// marked where it differs, or highlighted.
function Scanner({ files, value, mode, label }: Props & { mode: ScanMode; label: string }) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const sweep = easeInOut(seg(p, 0.05, 0.92));
  const bar = 104 + sweep * 156;
  const X = 88;
  const Y = 110;
  return (
    <Svg id={id} accent={ACCENTS.cyan}>
      <defs>
        <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7ee8ff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#7ee8ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#7ee8ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M22 100 L36 14 H264 L278 100 Z" fill={url("side")} filter={url("shadow")} />
      <path d="M36 94 L47 24 H253 L264 94 Z" style={fill("--m-pad")} />
      <path d="M38 14 H262" style={{ stroke: "var(--accent-m)" }} strokeWidth="4" strokeLinecap="round" />
      <Body x={8} y={92} w={284} h={202} r={18} />
      <rect x="24" y="104" width="252" height="156" rx="6" style={fill("--m-cavity")} />
      <Sheet x={X} y={Y} w={124} h={144} pic={pic} />
      {ROWS.map((w, i) => {
        const y = Y + 14 + i * 14;
        const color = MARKS[mode][i];
        const shown = Math.min(1, (bar - y) / 18);
        if (!color || shown <= 0) return null;
        return <rect key={i} x={X + 10} y={y - 3} width={(124 - 20) * w} height="8" rx="2" fill={color} opacity={shown * (mode === "read" ? 0.45 : 0.32)} />;
      })}
      {p < 0.97 && (
        <g>
          <rect x="24" y={bar - 18} width="252" height="36" fill={`url(#${id}-beam)`} />
          <rect x="18" y={bar - 5} width="264" height="10" rx="4" fill={url("steel")} filter={url("soft")} />
          <rect x="26" y={bar - 1.5} width="248" height="3" rx="1.5" fill="#d9fbff" filter={url("glow")} />
        </g>
      )}
      <Lcd x={22} y={264} w={206} h={28}>
        <LcdText x={34} y={283} size={12}>{label}</LcdText>
        <Meter x={120} y={276} w={96} value={sweep} />
      </Lcd>
      <Knob cx={258} cy={278} r={13} angle={p * 300} />
    </Svg>
  );
}

// Rotate and the page-arranging tools: the page turns a quarter on a turntable.
function Turntable({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const a = easeInOut(seg(p, 0.15, 0.85)) * 90;
  const C = { x: 138, y: 166 };
  return (
    <Svg id={id} accent={ACCENTS.violet}>
      <Body x={4} y={28} w={292} h={266} r={24} />
      <circle cx={C.x} cy={C.y} r="112" fill="#000" opacity="0.12" />
      <circle cx={C.x} cy={C.y} r="108" fill={url("metal")} stroke="#8d949b" strokeWidth="2.5" />
      {Array.from({ length: 11 }, (_, i) => (
        <circle key={i} cx={C.x} cy={C.y} r={100 - i * 8} fill="none" stroke="#fff" strokeOpacity={i % 2 ? 0.14 : 0.28} />
      ))}
      <g transform={`rotate(${a} ${C.x} ${C.y})`}>
        <circle cx={C.x} cy={C.y - 101} r="3" fill="#d7362b" />
        <Sheet x={C.x - 60} y={C.y - 78} w={120} h={156} pic={pic} />
      </g>
      <circle cx={C.x} cy={C.y} r="5" fill={url("steel")} stroke="#7d848b" strokeWidth="0.6" />
      <g transform={`rotate(${-8 + 8 * seg(p, 0, 0.15)} 266 196)`}>
        <path d="M266 196 L262 128 L246 112" fill="none" stroke={url("steelv")} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="236" y="104" width="16" height="10" rx="3" fill={url("accentv")} transform="rotate(-45 244 109)" />
      </g>
      <circle cx="266" cy="196" r="13" fill={url("side")} filter={url("soft")} />
      <circle cx="266" cy="196" r="5" fill={url("steel")} />
      <Knob cx={268} cy={66} r={18} angle={a * 3} />
      <Button x={255} y={98} />
      <Lcd x={226} y={232} w={62} h={48}>
        <LcdText x={238} y={262} size={14}>{`${Math.round(a)}°`}</LcdText>
      </Lcd>
    </Svg>
  );
}

const FORMATS: Partial<Record<ToolId, [string, string]>> = {
  wordToPdf: ["DOCX", "PDF"],
  pptToPdf: ["PPTX", "PDF"],
  excelToPdf: ["XLSX", "PDF"],
  htmlToPdf: ["HTML", "PDF"],
  jpgToPdf: ["JPG", "PDF"],
  pdfToJpg: ["PDF", "JPG"],
  pdfToWord: ["PDF", "DOCX"],
  pdfToPpt: ["PDF", "PPTX"],
  pdfToExcel: ["PDF", "XLSX"],
  pdfToPdfa: ["PDF", "PDF/A"],
  pdfToMarkdown: ["PDF", "MD"],
  accessible: ["PDF", "PDF/UA"],
};
const BADGE: Record<string, string> = { PDF: "#e5483a", "PDF/A": "#b7322b", "PDF/UA": "#b7322b", DOCX: "#2f6fd6", PPTX: "#e0662b", XLSX: "#1f8f4e", JPG: "#8b5cf6", HTML: "#d18a00", MD: "#4b4f55" };

// The converters: the page feeds into the printer's top and comes out of
// its front as the new format.
function Printer({ files, value, tool }: Props & { tool: ToolId }) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const [from, to] = FORMATS[tool] ?? ["PDF", "PDF"];
  const feed = easeInOut(seg(p, 0.06, 0.5));
  const out = easeOut(seg(p, 0.42, 0.96));
  const busy = p > 0.06 && p < 0.96;
  const X = 90;
  return (
    <Svg id={id} accent={ACCENTS.violet}>
      <defs>
        <clipPath id={`${id}-in`}><rect x="0" y="0" width="300" height="114" /></clipPath>
        <clipPath id={`${id}-out`}><rect x="0" y="203" width="300" height={out * 94} /></clipPath>
      </defs>
      <path d="M66 112 L84 22 H216 L234 112 Z" fill={url("metal")} opacity="0.75" />
      <path d="M66 112 L84 22 H216 L234 112 Z" fill={url("brush")} />
      <g clipPath={`url(#${id}-in)`}>
        <Sheet x={X} y={-46 + feed * 170} w={120} h={156} pic={pic} />
        <rect x={X + 66} y={-36 + feed * 170} width="46" height="18" rx="4" fill={BADGE[from]} />
        <text x={X + 89} y={-23 + feed * 170} textAnchor="middle" className="machine-badge">{from}</text>
      </g>
      <Body x={14} y={104} w={272} h={104} r={22} />
      <rect x="70" y="110" width="160" height="6" rx="3" style={fill("--m-slot")} />
      <Lcd x={30} y={124} w={168} h={60}>
        <LcdText x={44} y={152} size={15}>{`${from}→${to}`}</LcdText>
        <Meter x={44} y={161} w={140} value={out} />
      </Lcd>
      <Knob cx={234} cy={144} r={18} angle={p * 400} />
      <Button x={221} y={170} />
      <Led cx={266} cy={176} on={busy && Math.floor(t * 4) % 2 === 0 ? "green" : null} />
      <rect x="54" y="196" width="192" height="6" rx="3" style={fill("--m-slot")} />
      <g clipPath={`url(#${id}-out)`}>
        <Sheet x={X} y={203} w={120} h={156} pic={pic} />
        <rect x={X + 66} y={210} width="46" height="18" rx="4" fill={BADGE[to] ?? "#4b4f55"} />
        <text x={X + 89} y={223} textAnchor="middle" className="machine-badge">{to}</text>
      </g>
    </Svg>
  );
}

const TYPED = [96, 84, 92, 64, 96, 78, 90, 52, 94, 72];
const KEYS = [10, 9, 8];

// Edit, Forms and the other writing tools: a typewriter types new lines onto
// the page, the carriage running across and returning for each.
function Typewriter({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const line = 3 + seg(p, 0.04, 0.96) * 6;
  const i = Math.min(9, Math.floor(line));
  const frac = line - i;
  const back = easeInOut(seg(frac, 0, 0.14));
  const typing = seg(frac, 0.14, 1);
  const start = 150 - 12;
  const x = back < 1 ? start - TYPED[i - 1] * (1 - back) : start - typing * TYPED[i];
  const top = 168 - (18 + (i - 1) * 14 + 14 * back) - 2;
  const key = typing > 0 && typing < 1 ? Math.floor(t * 11) % 27 : -1;
  let k = 0;
  return (
    <Svg id={id} accent={ACCENTS.teal}>
      <g>
        <rect x={x} y={top} width="120" height="210" rx="2" fill="#fff" filter={url("soft")} />
        {pic && <image href={pic} x={x + 4} y={top + 4} width="112" height="146" preserveAspectRatio="xMidYMin meet" opacity="0.4" />}
        {TYPED.map((w, j) => (j < i || (j === i && back >= 1) ? <rect key={j} x={x + 12} y={top + 16 + j * 14} width={j < i ? w : w * typing} height="4.5" rx="1" fill="#2a2a2a" /> : null))}
      </g>
      <rect x="54" y="160" width="192" height="4" rx="2" fill={url("steel")} />
      <circle cx="96" cy="162" r="5" fill="#2a2724" />
      <circle cx="204" cy="162" r="5" fill="#2a2724" />
      <rect x="28" y="168" width="244" height="28" rx="14" fill={url("rubber")} filter={url("soft")} />
      <rect x="34" y="171" width="232" height="4" rx="2" fill="#fff" opacity="0.15" />
      <path d="M24 176 L10 148" stroke={url("steelv")} strokeWidth="5" strokeLinecap="round" transform={`rotate(${back > 0 && back < 1 ? -14 * Math.sin(back * Math.PI) : 0} 24 176)`} />
      <circle cx="22" cy="182" r="14" fill={url("side")} filter={url("soft")} />
      <Ball cx={10} cy={146} r={7} />
      <Knob cx={278} cy={182} r={16} angle={line * 60} />
      {key >= 0 && <rect x="149" y="174" width="2" height="22" fill={url("steel")} opacity={(t * 11) % 1 < 0.5 ? 1 : 0} />}
      <path d="M14 300 L34 198 H266 L286 300 Z" fill={url("body")} filter={url("shadow")} />
      <path d="M34 198.5 H266" style={{ stroke: "var(--m-edge)" }} />
      <Button x={40} y={206} />
      {KEYS.map((count, r) => (
        <g key={r}>
          {Array.from({ length: count }, (_, c) => {
            const n = k++;
            const cx = 150 + (c - (count - 1) / 2) * 22 + r * 4;
            const cy = 226 + r * 22;
            const down = n === key;
            return (
              <g key={c} transform={`translate(${cx} ${cy + (down ? 2 : 0)})`}>
                <circle r="9" fill={url("steel")} />
                <circle r="7.4" fill={down ? "#4a4540" : "#2b2824"} />
                <circle cy="-2" r="4" fill="#fff" opacity="0.08" />
              </g>
            );
          })}
        </g>
      ))}
      <rect x="104" y="280" width="96" height="9" rx="4.5" fill="#2b2824" stroke={url("steel")} />
    </Svg>
  );
}

// Watermark, Page numbers, Header and footer: the hand stamp comes down on
// the page and leaves its mark: a seal in the middle, or a number at the foot.
function Stamp({ files, value, number }: Props & { number?: boolean }) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const pos = easeIn(seg(p, 0.3, 0.44)) * (1 - easeOut(seg(p, 0.52, 0.72)));
  const inked = easeOut(seg(p, 0.43, 0.5));
  const w = number ? 30 : 66;
  const target = number ? 254 : 196; // where the pad's face lands
  const rest = 122;
  const face = rest + (target - rest) * pos;
  return (
    <Svg id={id} accent={ACCENTS.rose}>
      <Body x={14} y={262} w={272} h={32} r={10} />
      <rect x="22" y="234" width="58" height="26" rx="6" fill={url("side")} filter={url("soft")} />
      <rect x="27" y="238" width="48" height="16" rx="3" fill={number ? "#2b2d30" : "#8f241c"} />
      <Sheet x={96} y={104} w={120} h={156} pic={pic} />
      {inked > 0 &&
        (number ? (
          <text x="156" y="254" textAnchor="middle" fontSize="13" fontWeight="600" fill="#222" opacity={inked} className="machine-num">1</text>
        ) : (
          <g transform="rotate(-16 156 186)" fill="none" stroke="#d7362b" opacity={0.78 * inked}>
            <circle cx="156" cy="186" r="30" strokeWidth="3" />
            <circle cx="156" cy="186" r="24" strokeWidth="1.2" />
            <path d="M156 170 L160.7 180.5 L172 181.5 L163.4 189 L166 200 L156 194.2 L146 200 L148.6 189 L140 181.5 L151.3 180.5 Z" fill="#d7362b" stroke="none" />
          </g>
        ))}
      <g transform={`translate(156 ${face})`}>
        <rect x="-7" y="-64" width="14" height="34" rx="4" fill={url("accentv")} />
        <Ball cx={0} cy={-76} r={19} />
        <rect x={-w / 2 - 8} y="-34" width={w + 16} height="26" rx="7" fill={url("body")} filter={url("soft")} />
        <rect x={-w / 2} y="-9" width={w} height="9" rx="2" fill={number ? "#2b2d30" : "#c2352a"} />
      </g>
    </Svg>
  );
}

const KINDS = {
  sealer: ["compress", "examKit"],
  press: ["merge"],
  shuffler: ["mix"],
  guillotine: ["split"],
  claw: ["extract"],
  sorter: ["organize"],
  shredder: ["remove"],
  shredBlank: ["removeBlank"],
  camera: ["scan"],
  patcher: ["repair"],
  lock: ["protect"],
  unlock: ["unlock"],
  plotter: ["sign"],
  form: ["forms"],
  loupe: ["verify"],
  ocr: ["ocr"],
  squeegee: ["cleanScans"],
  ink: ["redact"],
  washer: ["sanitize"],
  lighttable: ["compare"],
  funnel: ["summarize"],
  intercom: ["chat"],
  flipper: ["translate"],
  radio: ["listen"],
  read: ["view"],
  turntable: ["rotate"],
  cropper: ["crop"],
  rollers: ["resize"],
  typewriter: ["edit"],
  label: ["headerFooter"],
  tag: ["metadata"],
  bookmarker: ["bookmarks"],
  stamp: ["watermark"],
  number: ["pageNumbers"],
  iron: ["flatten"],
  clipper: ["attachments"],
  conveyor: ["linearize"],
  tiler: ["nUp"],
  folder: ["booklet"],
  dye: ["grayscale"],
  polaroid: ["pdfToJpg"],
  cabinet: ["pdfToPdfa"],
  embosser: ["accessible"],
} satisfies Record<string, ToolId[]>;
export type MachineKind = keyof typeof KINDS | "printer";

// Which machine a tool gets; the converters and anything new, the printer.
export function machineFor(tool: ToolId): MachineKind {
  for (const [kind, tools] of Object.entries(KINDS) as [MachineKind, ToolId[]][]) if (tools.includes(tool)) return kind;
  return "printer";
}

export function Machine({ tool, files, value }: { tool: ToolId; files?: File[]; value: number }) {
  const kind = machineFor(tool);
  const props = { files, value };
  const scan = (mode: ScanMode, label: string) => <Scanner {...props} mode={mode} label={label} />;
  const show: Record<MachineKind, () => ReactNode> = {
    sealer: () => <VacuumSealer file={files?.[0]} value={value} />,
    press: () => <Press {...props} />,
    shuffler: () => <Shuffler {...props} />,
    guillotine: () => <Guillotine {...props} />,
    claw: () => <Claw {...props} />,
    sorter: () => <Claw {...props} reorder />,
    shredder: () => <Shredder {...props} />,
    shredBlank: () => <Shredder {...props} blank />,
    camera: () => <Camera {...props} />,
    patcher: () => <Patcher {...props} />,
    lock: () => <Safe {...props} />,
    unlock: () => <Safe {...props} open />,
    plotter: () => <Plotter {...props} />,
    form: () => <Plotter {...props} form />,
    loupe: () => <Loupe {...props} />,
    ocr: () => scan("ocr", "OCR ▮▮▮"),
    read: () => scan("read", "Aa ▮▮"),
    squeegee: () => <Squeegee {...props} />,
    ink: () => <InkRoller {...props} />,
    washer: () => <Washer {...props} />,
    lighttable: () => <LightTable {...props} />,
    funnel: () => <Funnel {...props} />,
    intercom: () => <Intercom {...props} />,
    flipper: () => <Flipper {...props} />,
    radio: () => <Radio {...props} />,
    turntable: () => <Turntable {...props} />,
    cropper: () => <Cropper {...props} />,
    rollers: () => <Rollers {...props} />,
    typewriter: () => <Typewriter {...props} />,
    label: () => <LabelMaker {...props} />,
    tag: () => <LabelMaker {...props} tag />,
    bookmarker: () => <Bookmarker {...props} />,
    stamp: () => <Stamp {...props} />,
    number: () => <Stamp {...props} number />,
    iron: () => <Iron {...props} />,
    clipper: () => <Clipper {...props} />,
    conveyor: () => <Conveyor {...props} />,
    tiler: () => <Tiler {...props} />,
    folder: () => <Folder {...props} />,
    dye: () => <DyeBath {...props} />,
    polaroid: () => <Polaroid {...props} />,
    cabinet: () => <Cabinet {...props} />,
    embosser: () => <Embosser {...props} />,
    printer: () => <Printer {...props} tool={tool} />,
  };
  return (
    <div aria-hidden className="machine-stage">
      {show[kind]()}
    </div>
  );
}
