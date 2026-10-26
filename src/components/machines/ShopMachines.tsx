"use client";

// Machines for the tools that trim, mark, clean and arrange a page
// (Machines.tsx machineFor says which tool gets which). Built from kit.tsx,
// each drawn from the job's progress p (0 to 1).

import { ACCENTS, Ball, Body, Engraved, Knob, Lcd, LcdText, Led, Sheet, Svg, easeIn, easeInOut, easeOut, fill, seg, urlOf, useDrive, usePictures, useSvgId } from "./kit";
import type { Props } from "./PageMachines";

const PI = Math.PI;

// A point a share s of the way round a rectangle, clockwise from its top left.
function around(x: number, y: number, w: number, h: number, s: number) {
  let d = s * 2 * (w + h);
  if (d <= w) return { x: x + d, y };
  d -= w;
  if (d <= h) return { x: x + w, y: y + d };
  d -= h;
  if (d <= w) return { x: x + w - d, y: y + h };
  return { x, y: y + h - (d - w) };
}

// Crop: the crop marks close in on the page, the rotary cutter runs round
// them, and the margins fall away.
export function Cropper({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const P = { x: 80, y: 66, w: 140, h: 184 };
  const I = { x: 100, y: 90, w: 100, h: 136 };
  const b = easeInOut(seg(p, 0.05, 0.38));
  const cut = seg(p, 0.42, 0.84);
  const fall = easeIn(seg(p, 0.84, 0.97));
  const at = around(I.x, I.y, I.w, I.h, cut);
  const corner = (cx: number, cy: number, sx: number, sy: number, k: number) => {
    const x = cx + sx * 20 * (1 - b);
    const y = cy + sy * 20 * (1 - b);
    return <path key={k} d={`M${x + sx * 16} ${y} H${x} V${y + sy * 16}`} fill="none" style={{ stroke: "var(--accent-m)" }} strokeWidth="4" strokeLinecap="round" />;
  };
  return (
    <Svg id={id} accent={ACCENTS.lime}>
      <defs>
        <clipPath id={`${id}-in`}><rect x={I.x} y={I.y} width={I.w} height={I.h} /></clipPath>
        <pattern id={`${id}-grid`} width="14" height="14" patternUnits="userSpaceOnUse">
          <path d="M14 0H0V14" fill="none" stroke="#fff" strokeOpacity="0.08" />
        </pattern>
      </defs>
      <Body x={8} y={20} w={284} h={274} r={20} />
      <rect x="22" y="34" width="256" height="246" rx="8" style={fill("--m-mat")} />
      <rect x="22" y="34" width="256" height="246" rx="8" fill={`url(#${id}-grid)`} />
      <g opacity={1 - fall} transform={`translate(0 ${fall * 24})`}>
        <Sheet x={P.x} y={P.y} w={P.w} h={P.h} pic={pic} />
      </g>
      <g clipPath={`url(#${id}-in)`}>
        <Sheet x={P.x} y={P.y} w={P.w} h={P.h} pic={pic} />
      </g>
      {cut > 0 && <rect x={I.x} y={I.y} width={I.w} height={I.h} fill="none" stroke="#000" strokeOpacity="0.35" strokeDasharray="1" pathLength={1} strokeDashoffset={1 - cut} />}
      {corner(I.x, I.y, -1, -1, 0)}
      {corner(I.x + I.w, I.y, 1, -1, 1)}
      {corner(I.x + I.w, I.y + I.h, 1, 1, 2)}
      {corner(I.x, I.y + I.h, -1, 1, 3)}
      {cut > 0 && cut < 1 && (
        <g transform={`translate(${at.x} ${at.y})`}>
          <line x1="0" y1="0" x2="30" y2="-36" stroke={url("steelv")} strokeWidth="6" strokeLinecap="round" />
          <Ball cx={32} cy={-40} r={9} />
          <circle r="12" fill={url("steel")} stroke="#7d848b" strokeWidth="0.6" />
          <circle r="3" fill="#5f656c" />
        </g>
      )}
    </Svg>
  );
}

// Resize: the page goes through the rollers at the top, the crank turns, and
// it comes out below at its new size.
export function Rollers({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const feed = easeInOut(seg(p, 0.06, 0.55));
  const out = easeOut(seg(p, 0.45, 0.95));
  const crank = p * 900;
  return (
    <Svg id={id} accent={ACCENTS.amber}>
      <defs>
        <clipPath id={`${id}-in`}><rect x="0" y="0" width="300" height="114" /></clipPath>
        <clipPath id={`${id}-out`}><rect x="0" y="176" width="300" height={out * 124} /></clipPath>
      </defs>
      <g clipPath={`url(#${id}-in)`}>
        <Sheet x={80} y={-80 + feed * 200} w={140} h={182} pic={pic} />
      </g>
      <Body x={38} y={108} w={224} h={70} r={18} />
      <rect x="68" y="120" width="164" height="38" rx="8" style={fill("--m-cavity")} />
      <rect x="72" y="123" width="156" height="15" rx="7.5" fill={url("steelv")} />
      <rect x="72" y="140" width="156" height="15" rx="7.5" fill={url("steelv")} />
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x={76 + ((i * 26 + crank / 4) % 150)} y="124" width="2" height="30" fill="#fff" opacity="0.35" />
      ))}
      <Engraved x={150} y={172} anchor="middle">⤡</Engraved>
      <rect x="58" y="176" width="34" height="14" rx="4" fill={url("side")} />
      <rect x="208" y="176" width="34" height="14" rx="4" fill={url("side")} />
      <g clipPath={`url(#${id}-out)`}>
        <Sheet x={104} y={176} w={92} h={120} pic={pic} />
      </g>
      <g transform={`rotate(${crank} 270 143)`}>
        <rect x="267" y="113" width="6" height="32" rx="3" fill={url("steelv")} />
        <Ball cx={270} cy={112} r={9} />
      </g>
      <circle cx="270" cy="143" r="9" fill={url("steel")} stroke="#7d848b" strokeWidth="0.6" />
    </Svg>
  );
}

const RIBBONS = ["var(--accent-m)", "#14a874", "#e5483a"];

// Bookmarks: the dispenser drops a ribbon into the book at each chapter,
// and snips it, so the ends stand out of the top.
export function Bookmarker({ files, value }: Props) {
  const id = useSvgId();
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const X = 80;
  const Y = 100;
  return (
    <Svg id={id} accent={ACCENTS.indigo}>
      {RIBBONS.map((color, i) => {
        const drop = easeOut(seg(p, 0.08 + i * 0.26, 0.22 + i * 0.26));
        const snipped = p > 0.26 + i * 0.26;
        if (drop <= 0) return null;
        const x = 116 + i * 34;
        const tip = 52 + drop * 100;
        const top = snipped ? 78 - i * 4 : 52;
        return <path key={i} d={`M${x} ${top} V${tip} H${x + 12} V${top} L${x + 6} ${top + (snipped ? 6 : 0)} Z`} style={{ fill: color }} />;
      })}
      {[4, 3, 2, 1].map((k) => <rect key={k} x={X + k * 2} y={Y - k * 2} width="140" height="180" rx="2" fill="#f2f3f5" stroke="#000" strokeOpacity="0.08" />)}
      <Sheet x={X} y={Y} w={140} h={180} pic={pic} />
      <Body x={6} y={278} w={288} h={16} r={7} />
      <Body x={60} y={12} w={180} h={42} r={14} />
      {[0, 1, 2].map((i) => <rect key={i} x={113 + i * 34} y="46" width="18" height="5" rx="2.5" style={fill("--m-slot")} />)}
      <Lcd x={70} y={18} w={34} h={30}>
        <LcdText x={81} y={38} size={12}>{`${RIBBONS.filter((_, i) => p > 0.22 + i * 0.26).length}`}</LcdText>
      </Lcd>
    </Svg>
  );
}

// The signature on Verify's page, s from 0 to 1.
const sigAt = (s: number) => ({
  x: 98 + 104 * s + 8 * Math.sin(s * PI * 10),
  y: 200 - 14 * Math.sin(s * PI * 5) * Math.sin(PI * s) + 6 * Math.cos(s * PI * 10),
});
const SIG = Array.from({ length: 161 }, (_, i) => sigAt(i / 160))
  .map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`)
  .join("");

// Verify: the loupe goes along the signature, magnifying it, and the seal
// says it holds.
export function Loupe({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const k = easeInOut(seg(p, 0.08, 0.7));
  const away = easeInOut(seg(p, 0.72, 0.86));
  const on = sigAt(k);
  const c = { x: on.x + (236 - on.x) * away, y: on.y + (84 - on.y) * away };
  const seal = easeOut(seg(p, 0.84, 0.96));
  const page = (
    <g>
      <Sheet x={70} y={36} w={160} h={210} pic={pic} />
      <path d={SIG} fill="none" stroke="#1d2d7a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
  return (
    <Svg id={id} accent={ACCENTS.green}>
      <defs>
        <clipPath id={`${id}-lens`}><circle cx={c.x} cy={c.y} r="36" /></clipPath>
      </defs>
      <Body x={14} y={244} w={272} h={50} r={12} />
      <Led cx={266} cy={270} on={seal > 0.5 ? "green" : null} />
      {page}
      {seal > 0 && (
        <g transform={`translate(204 170) scale(${seal})`}>
          <circle r="20" fill="#14a874" filter={url("soft")} />
          <path d="M-9 0 L-3 7 L10 -7" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      <g clipPath={`url(#${id}-lens)`}>
        <rect x="0" y="0" width="300" height="300" fill="#fff" />
        <g transform={`translate(${c.x} ${c.y}) scale(1.9) translate(${-c.x} ${-c.y})`}>{page}</g>
        <circle cx={c.x - 12} cy={c.y - 14} r="12" fill="#fff" opacity="0.35" />
      </g>
      <line x1={c.x + 27} y1={c.y + 27} x2={c.x + 62} y2={c.y + 62} stroke={url("accentv")} strokeWidth="12" strokeLinecap="round" />
      <circle cx={c.x} cy={c.y} r="37" fill="none" stroke={url("steelv")} strokeWidth="7" />
    </Svg>
  );
}

const ROWS = [1, 0.85, 0.95, 0.6, 1, 0.8, 0.9, 0.55, 1];
const BLACK = new Set([1, 3, 4, 6]);

// Redact: the ink roller rolls down the page and leaves black over the
// chosen lines.
export function InkRoller({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const ry = 26 + easeInOut(seg(p, 0.08, 0.9)) * 232;
  const X = 80;
  const Y = 40;
  return (
    <Svg id={id} accent={ACCENTS.rose}>
      <Body x={14} y={252} w={272} h={42} r={12} />
      <Engraved x={150} y={278} anchor="middle">███ ██</Engraved>
      <Sheet x={X} y={Y} w={140} h={200} pic={pic} />
      {ROWS.map((w, i) => {
        const y = Y + 18 + i * 19;
        if (!BLACK.has(i) || y > ry - 4) return null;
        return <rect key={i} x={X + 10} y={y - 4} width={(140 - 20) * Math.max(0.7, w)} height="11" rx="1.5" fill="#111" />;
      })}
      {p < 0.97 && (
        <g transform={`translate(0 ${ry})`}>
          <path d="M66 0 V-26 L150 -46 L234 -26 V0" fill="none" stroke={url("steelv")} strokeWidth="4" strokeLinejoin="round" />
          <rect x="144" y="-78" width="12" height="34" rx="4" fill={url("steelv")} />
          <rect x="138" y="-104" width="24" height="34" rx="10" fill={url("accentv")} filter={url("soft")} />
          <rect x="70" y="-11" width="160" height="22" rx="11" fill={url("rubber")} filter={url("soft")} />
          {Array.from({ length: 5 }, (_, i) => <rect key={i} x="74" y={-9 + ((i * 5 + t * 40) % 20)} width="152" height="1.5" fill="#fff" opacity="0.12" />)}
        </g>
      )}
    </Svg>
  );
}

// Sanitize: the page goes round in the washer and what it was hiding (the
// marked bits) comes off in the wash.
export function Washer({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const spin = 760 * easeInOut(seg(p, 0.08, 0.88));
  const busy = p > 0.08 && p < 0.88;
  const C = { x: 150, y: 182 };
  const marks = [
    { x: 118, y: 140 },
    { x: 178, y: 160 },
    { x: 128, y: 206 },
    { x: 170, y: 224 },
  ];
  return (
    <Svg id={id} accent={ACCENTS.sky}>
      <defs>
        <clipPath id={`${id}-glass`}><circle cx={C.x} cy={C.y} r="70" /></clipPath>
      </defs>
      <Body x={30} y={12} w={240} h={282} r={26} />
      <Lcd x={44} y={24} w={124} h={38}>
        <LcdText x={56} y={48} size={13}>{busy ? "≈ ≈ ≈" : p >= 0.88 ? "✓" : "—"}</LcdText>
      </Lcd>
      <Knob cx={234} cy={43} r={16} angle={p * 300} />
      <Led cx={196} cy={43} on={busy ? "green" : null} />
      <circle cx={C.x} cy={C.y} r="94" fill={url("side")} filter={url("soft")} />
      <circle cx={C.x} cy={C.y} r="82" fill="none" stroke={url("steelv")} strokeWidth="10" />
      <circle cx={C.x} cy={C.y} r="70" style={fill("--m-cavity")} />
      <g clipPath={`url(#${id}-glass)`}>
        <rect x="70" y={C.y + 26 - Math.sin(t * 3) * 3} width="160" height="70" fill="#5ab8f0" opacity="0.28" />
        <g transform={`rotate(${spin} ${C.x} ${C.y})`}>
          <Sheet x={106} y={124} w={88} h={116} pic={pic} />
          {marks.map((m, i) => {
            const gone = seg(p, 0.28 + i * 0.12, 0.4 + i * 0.12);
            return (
              <g key={i} opacity={1 - gone} transform={`translate(${(m.x - C.x) * gone * 0.8} ${(m.y - C.y) * gone * 0.8})`}>
                <circle cx={m.x} cy={m.y} r="7" fill="#e5483a" />
                <rect x={m.x - 1} y={m.y - 4} width="2" height="5" fill="#fff" />
                <rect x={m.x - 1} y={m.y + 2.5} width="2" height="2" fill="#fff" />
              </g>
            );
          })}
        </g>
        {busy &&
          Array.from({ length: 10 }, (_, i) => (
            <circle key={i} cx={96 + ((i * 37) % 110)} cy={250 - ((t * 46 + i * 23) % 140)} r={3 + (i % 3) * 2} fill="#fff" opacity="0.4" />
          ))}
        <path d={`M${C.x - 56} ${C.y - 30} A62 62 0 0 1 ${C.x + 10} ${C.y - 64}`} fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="6" strokeLinecap="round" />
      </g>
      <rect x="238" y="170" width="12" height="30" rx="5" fill={url("steelv")} />
    </Svg>
  );
}

// Compare: the two versions slide together on the light table, and where
// they differ glows.
export function LightTable({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const pics = usePictures(files, 2);
  const a = easeInOut(seg(p, 0.06, 0.45));
  const glow = seg(p, 0.48, 0.6) * (0.75 + 0.25 * Math.sin(t * 5));
  const X = 80;
  const Y = 62;
  return (
    <Svg id={id} accent={ACCENTS.cyan}>
      <defs>
        <radialGradient id={`${id}-light`} cx="0.5" cy="0.45" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dcecf8" />
        </radialGradient>
        <clipPath id={`${id}-table`}><rect x="22" y="42" width="256" height="230" rx="10" /></clipPath>
      </defs>
      <Body x={6} y={28} w={288} h={266} r={22} />
      <rect x="22" y="42" width="256" height="230" rx="10" fill={`url(#${id}-light)`} />
      <Engraved x={150} y={287} anchor="middle">A ⇄ B</Engraved>
      <g clipPath={`url(#${id}-table)`}>
        <g transform={`translate(${-170 * (1 - a)} 0)`}>
          <Sheet x={X} y={Y} w={140} h={190} pic={pics[0]} />
        </g>
        <g transform={`translate(${170 * (1 - a)} 0)`} opacity="0.55">
          <Sheet x={X + 3} y={Y + 2} w={140} h={190} pic={pics[1] ?? pics[0]} />
        </g>
        {glow > 0 &&
          [
            [2, "#ff5a4e"],
            [5, "#ff5a4e"],
            [7, "#2fbf71"],
          ].map(([i, color]) => (
            <rect key={i as number} x={X + 10} y={Y + 14 + (i as number) * 17} width="120" height="10" rx="2" fill={color as string} opacity={glow * 0.45} filter={url("glow")} />
          ))}
      </g>
    </Svg>
  );
}

// Flatten: the iron goes over the page, and the layers on it (notes, fields)
// press down into the page.
export function Iron({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const pass1 = easeInOut(seg(p, 0.08, 0.46));
  const pass2 = easeInOut(seg(p, 0.5, 0.88));
  const ix = p < 0.48 ? 40 + pass1 * 220 : 260 - pass2 * 220;
  const iy = p < 0.48 ? 108 : 202;
  const items = [
    { x: 92, y: 88, w: 58, h: 30, row: 0, color: "#2b9be8" },
    { x: 162, y: 112, w: 46, h: 18, row: 0, color: "#7c5ce6" },
    { x: 96, y: 186, w: 80, h: 16, row: 1, color: "#14a874" },
    { x: 150, y: 212, w: 52, h: 26, row: 1, color: "#e5483a" },
  ];
  const flat = (it: (typeof items)[number]) => (it.row === 0 ? (p >= 0.48 ? 1 : ix > it.x + it.w / 2 ? 1 : 0) : p >= 0.88 ? 1 : p >= 0.48 && ix < it.x + it.w / 2 ? 1 : 0);
  const steaming = p > 0.08 && p < 0.88;
  return (
    <Svg id={id} accent={ACCENTS.rose}>
      <defs>
        <pattern id={`${id}-quilt`} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0H16M0 0V16" stroke="#000" strokeOpacity="0.06" />
        </pattern>
      </defs>
      <Body x={8} y={18} w={284} h={276} r={22} />
      <rect x="22" y="32" width="256" height="248" rx="12" style={fill("--m-pad")} />
      <rect x="22" y="32" width="256" height="248" rx="12" fill={`url(#${id}-quilt)`} />
      <Sheet x={70} y={46} w={160} h={224} pic={pic} />
      {items.map((it, i) => {
        const f = flat(it);
        return (
          <g key={i}>
            <rect x={it.x} y={it.y - 4 * (1 - f)} width={it.w} height={it.h} rx="3" fill={f ? "#9aa0a8" : it.color} opacity={f ? 0.55 : 0.9} filter={f ? undefined : url("soft")} />
          </g>
        );
      })}
      {steaming &&
        [0, 1, 2].map((k) => {
          const a = (t * 1.4 + k / 3) % 1;
          return <circle key={k} cx={ix - 40 - a * 30} cy={iy - 10 - a * 30} r={6 + a * 10} fill="#fff" opacity={(1 - a) * 0.5} />;
        })}
      <g transform={`translate(${ix} ${iy}) scale(${p < 0.48 ? 1 : -1} 1)`}>
        <path d="M-40 -26 H8 Q36 -26 46 0 Q36 26 8 26 H-40 Q-48 26 -48 18 V-18 Q-48 -26 -40 -26 Z" fill={url("steelv")} filter={url("shadow")} />
        <path d="M-36 -20 H4 Q28 -20 36 0 Q28 20 4 20 H-36 Z" fill={url("body")} />
        <rect x="-30" y="-6" width="44" height="12" rx="6" fill={url("accentv")} />
      </g>
    </Svg>
  );
}

const EXT_COLOR: Record<string, string> = { XLSX: "#1f8f4e", CSV: "#1f8f4e", DOCX: "#2f6fd6", PPTX: "#e0662b", PNG: "#8b5cf6", JPG: "#8b5cf6", JPEG: "#8b5cf6", ZIP: "#4b4f55", PDF: "#e5483a" };

// Attachments: a file slides in beside the page and a paperclip comes down
// and holds them together.
export function Clipper({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const other = files?.find((f, i) => i > 0 || !/\.pdf$/i.test(f.name));
  const ext = (other?.name.split(".").pop() ?? "FILE").toUpperCase().slice(0, 4);
  const slide = easeOut(seg(p, 0.08, 0.42));
  const clip = easeInOut(seg(p, 0.48, 0.78));
  return (
    <Svg id={id} accent={ACCENTS.indigo}>
      <Body x={14} y={252} w={272} h={42} r={12} />
      <Sheet x={50} y={52} w={150} h={196} pic={pic} />
      <g transform={`translate(${170 * (1 - slide)} 0) rotate(${-6 + 6 * (1 - slide)} 190 140)`}>
        <path d="M150 92 H200 L220 112 V196 H150 Z" fill="#fff" filter={url("soft")} />
        <path d="M200 92 V112 H220" fill="#e9ecef" stroke="#000" strokeOpacity="0.1" />
        <rect x="158" y="160" width="40" height="16" rx="3" fill={EXT_COLOR[ext] ?? "#4b4f55"} />
        <text x="178" y="172" textAnchor="middle" className="machine-badge">{ext}</text>
        <rect x="160" y="124" width="46" height="4" rx="2" fill="#d7dbdf" />
        <rect x="160" y="134" width="36" height="4" rx="2" fill="#d7dbdf" />
      </g>
      <g transform={`translate(162 ${-90 + clip * 168})`} opacity={seg(p, 0.46, 0.5)}>
        <path d="M0 10 V62 A10 10 0 0 0 20 62 V6 A7 7 0 0 0 6 6 V54" fill="none" stroke="#5f656c" strokeWidth="5" strokeLinecap="round" opacity="0.3" transform="translate(1.5 2)" />
        <path d="M0 10 V62 A10 10 0 0 0 20 62 V6 A7 7 0 0 0 6 6 V54" fill="none" stroke={url("steelv")} strokeWidth="4" strokeLinecap="round" />
      </g>
    </Svg>
  );
}

// Fast web view: the pages ride the belt through the gate, which lights as
// each goes through, and come out in order.
export function Conveyor({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const xs = [0, 1, 2, 3].map((i) => -80 + easeInOut(seg(p, 0.04 + i * 0.1, 0.62 + i * 0.1)) * (320 - i * 64));
  const lit = xs.some((x) => Math.abs(x + 30 - 150) < 26);
  return (
    <Svg id={id} accent={ACCENTS.amber}>
      <rect x="30" y="226" width="16" height="68" rx="5" fill={url("side")} />
      <rect x="254" y="226" width="16" height="68" rx="5" fill={url("side")} />
      <rect x="8" y="200" width="284" height="28" rx="14" fill={url("rubber")} filter={url("shadow")} />
      {Array.from({ length: 12 }, (_, i) => <rect key={i} x={14 + ((i * 24 + t * 60) % 270)} y="203" width="10" height="3" rx="1.5" fill="#fff" opacity="0.18" />)}
      {[22, 150, 278].map((x) => <circle key={x} cx={x} cy="214" r="10" fill={url("steel")} stroke="#5f656c" strokeWidth="0.8" />)}
      {xs.map((x, i) => (
        <g key={i}>
          <Sheet x={x} y={122} w={60} h={78} pic={pic} />
          <text x={x + 30} y={194} textAnchor="middle" className="machine-num" fontSize="10" fill="#8a9099">{i + 1}</text>
        </g>
      ))}
      <path d="M112 200 V92 Q112 70 134 70 H166 Q188 70 188 92 V200 H172 V100 Q172 88 160 88 H140 Q128 88 128 100 V200 Z" fill={url("body")} filter={url("soft")} />
      <circle cx="150" cy="79" r="5" fill={lit ? url("accentv") : "#6b6f75"} filter={lit ? url("glow") : undefined} />
      <Lcd x={104} y={22} w={92} h={40}>
        <LcdText x={118} y={47} size={14}>{"» » »"}</LcdText>
      </Lcd>
    </Svg>
  );
}

// Pages per sheet: four pages fly in and shrink into the quarters of one sheet.
export function Tiler({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const pics = usePictures(files, 1);
  const S = { x: 70, y: 66, w: 160, h: 204 };
  const from = [
    { x: -100, y: -60 },
    { x: 280, y: -60 },
    { x: -100, y: 300 },
    { x: 280, y: 300 },
  ];
  return (
    <Svg id={id} accent={ACCENTS.violet}>
      <Body x={10} y={272} w={280} h={22} r={9} />
      <Engraved x={280} y={288} anchor="end">4 → 1</Engraved>
      <rect x={S.x} y={S.y} width={S.w} height={S.h} rx="2" fill="#fff" filter={url("soft")} />
      {from.map((f, i) => {
        const a = easeInOut(seg(p, 0.06 + i * 0.16, 0.3 + i * 0.16));
        if (a <= 0) return null;
        const tx = S.x + 6 + (i % 2) * 76;
        const ty = S.y + 6 + Math.floor(i / 2) * 98;
        const w = 120 + (72 - 120) * a;
        const h = 156 + (94 - 156) * a;
        return (
          <g key={i} transform={`rotate(${(1 - a) * (i % 2 ? 10 : -10)} ${tx + w / 2} ${ty + h / 2})`}>
            <Sheet x={f.x + (tx - f.x) * a} y={f.y + (ty - f.y) * a} w={w} h={h} pic={pics[0]} />
          </g>
        );
      })}
    </Svg>
  );
}

// Booklet: the spread folds in half, the bone folder runs down the crease,
// and two staples go through the spine.
export function Folder({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const th = PI * easeInOut(seg(p, 0.1, 0.6));
  const c = Math.cos(th);
  const crease = easeInOut(seg(p, 0.64, 0.82));
  const stapled = p > 0.86;
  const slide = easeInOut(seg(p, 0.9, 1)) * 60;
  const Y = 78;
  return (
    <Svg id={id} accent={ACCENTS.teal}>
      <Body x={10} y={250} w={280} h={44} r={12} />
      <g transform={`translate(${slide} 0)`}>
        <Sheet x={30} y={Y} w={120} h={160} pic={pic} />
        <g transform={`translate(150 0) scale(${c} 1) skewY(${Math.sin(th) * -6}) translate(-150 0)`}>
          {c >= 0 ? <Sheet x={150} y={Y} w={120} h={160} pic={pic} /> : <Sheet x={150} y={Y} w={120} h={160} blank />}
        </g>
        {c < 0.98 && <rect x="148" y={Y} width="4" height="160" fill="#000" opacity={0.1 * (1 - c)} />}
        {stapled && [118, 196].map((y) => <rect key={y} x="146" y={y} width="3" height="16" rx="1" fill={url("steelv")} stroke="#6b7177" strokeWidth="0.5" />)}
      </g>
      {crease > 0 && crease < 1 && <rect x="143" y={Y - 14 + crease * 150} width="14" height="40" rx="7" fill={url("accentv")} filter={url("soft")} />}
    </Svg>
  );
}

// Grayscale: the hoist lowers the page into the grey bath, and it comes up
// with its colour gone.
export function DyeBath({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const down = easeInOut(seg(p, 0.06, 0.36));
  const up = easeInOut(seg(p, 0.56, 0.86));
  const y = 34 + 128 * down * (1 - up);
  const sat = 1 - easeInOut(seg(p, 0.24, 0.5));
  const dripping = p > 0.7 && p < 0.98;
  const wave = (k: number) => `M56 ${162 + k} ${Array.from({ length: 9 }, (_, i) => `Q${66 + i * 22} ${162 + k + (i % 2 ? 4 : -4) * Math.sin(t * 2 + i)} ${78 + i * 22} ${162 + k}`).join(" ")} V282 H56 Z`;
  return (
    <Svg id={id} accent={ACCENTS.sky}>
      <defs>
        <filter id={`${id}-sat`}>
          <feColorMatrix type="saturate" values={sat.toFixed(3)} />
        </filter>
      </defs>
      <rect x="14" y="12" width="272" height="10" rx="5" fill={url("steelv")} filter={url("soft")} />
      <rect x="138" y="8" width="24" height="18" rx="5" fill={url("accentv")} />
      <line x1="150" y1="26" x2="150" y2={y - 6} stroke="#5f656c" strokeWidth="1.5" />
      <rect x="142" y={y - 8} width="16" height="10" rx="3" fill={url("accentv")} />
      <Body x={40} y={140} w={220} h={154} r={18} />
      <g filter={`url(#${id}-sat)`}>
        <Sheet x={90} y={y} w={120} h={156} pic={pic} />
        {!pic && (
          <g>
            <rect x="102" y={y + 70} width="44" height="30" rx="3" fill="#e5483a" />
            <rect x="152" y={y + 70} width="44" height="30" rx="3" fill="#2b9be8" />
            <rect x="102" y={y + 106} width="94" height="14" rx="3" fill="#14a874" />
          </g>
        )}
      </g>
      <path d={wave(0)} fill="#6d737a" opacity="0.62" />
      <rect x="56" y="150" width="188" height="132" rx="10" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="2" />
      {dripping && [0, 1, 2].map((k) => <circle key={k} cx={110 + k * 40} cy={y + 160 + ((t * 80 + k * 20) % 40)} r="2.5" fill="#6d737a" opacity="0.7" />)}
    </Svg>
  );
}

// Clean up scans: the squeegee wipes down the grey, crooked scan, and behind
// it the page is white and straight.
export function Squeegee({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const sy = 36 + easeInOut(seg(p, 0.08, 0.88)) * 244;
  const X = 86;
  const Y = 50;
  return (
    <Svg id={id} accent={ACCENTS.cyan}>
      <defs>
        <clipPath id={`${id}-clean`}><rect x="0" y="0" width="300" height={sy} /></clipPath>
        <clipPath id={`${id}-dirty`}><rect x="0" y={sy} width="300" height={300 - sy} /></clipPath>
      </defs>
      <Body x={8} y={20} w={284} h={274} r={20} />
      <rect x="24" y="34" width="252" height="246" rx="8" style={fill("--m-cavity")} />
      <g clipPath={`url(#${id}-dirty)`} transform={`rotate(3.5 150 160)`}>
        <Sheet x={X} y={Y} w={128} h={220} pic={pic} />
        <rect x={X} y={Y} width="128" height="220" fill="#8a8378" opacity="0.38" />
        <rect x={X + 3} y={Y + 3} width="122" height="214" fill="none" stroke="#2c2a26" strokeOpacity="0.4" strokeWidth="6" />
        {Array.from({ length: 18 }, (_, i) => <circle key={i} cx={X + 8 + ((i * 47) % 112)} cy={Y + 10 + ((i * 71) % 200)} r={0.8 + (i % 3) * 0.6} fill="#2c2a26" opacity="0.5" />)}
      </g>
      <g clipPath={`url(#${id}-clean)`}>
        <Sheet x={X} y={Y} w={128} h={220} pic={pic} />
      </g>
      {p < 0.97 && (
        <g transform={`translate(0 ${sy})`}>
          <rect x="140" y="-46" width="20" height="30" rx="8" fill={url("accentv")} filter={url("soft")} />
          <rect x="146" y="-20" width="8" height="10" fill={url("steelv")} />
          <rect x="52" y="-12" width="196" height="10" rx="4" fill={url("accentv")} filter={url("soft")} />
          <rect x="54" y="-3" width="192" height="5" rx="2" fill={url("rubber")} />
        </g>
      )}
      <Led cx={276} cy={287} on={p >= 0.88 ? "green" : null} />
    </Svg>
  );
}
