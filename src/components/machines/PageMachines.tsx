"use client";

// Machines for the tools that move, cut, capture, file and read pages
// (Machines.tsx machineFor says which tool gets which). Built from kit.tsx,
// each drawn from the job's progress p (0 to 1).

import { Ball, Body, Button, Knob, Lcd, LcdText, Led, Sheet, Svg, easeIn, easeInOut, easeOut, fill, seg, urlOf, useDrive, usePictures, useSvgId } from "./kit";

export type Props = { files?: File[]; value: number };

const PI = Math.PI;

// Mix: two trays riffle their pages, one from each side in turn, into one stack.
export function Shuffler({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const pics = usePictures(files, 2);
  const W = 84;
  const H = 108;
  const src = [
    { x: 22, y: 34 },
    { x: 194, y: 34 },
  ];
  const out = { x: 108, y: 166 };
  const pages = Array.from({ length: 6 }, (_, k) => ({ k, side: k % 2, a: easeInOut(seg(p, 0.06 + k * 0.14, 0.2 + k * 0.14)) }));
  const page = (k: number, side: number, x: number, y: number, r: number) => (
    <g key={k} transform={`rotate(${r} ${x + W / 2} ${y + H / 2})`}>
      <Sheet x={x} y={y} w={W} h={H} pic={pics[side] ?? pics[0]} />
      <rect x={x + W - 24} y={y + 6} width="18" height="5" rx="2.5" fill={side ? "#ffb38a" : url("accentv")} />
    </g>
  );
  return (
    <Svg id={id}>
      <Body x={10} y={142} w={108} h={16} r={7} />
      <Body x={182} y={142} w={108} h={16} r={7} />
      <Body x={86} y={274} w={128} h={20} r={8} />
      {pages.filter((q) => q.a >= 1).map((q) => page(q.k, q.side, out.x + (q.k % 2 ? 2 : -2), out.y - q.k * 1.5, q.k % 2 ? 1.5 : -1.5))}
      {[0, 1].map((side) =>
        pages
          .filter((q) => q.side === side && q.a <= 0)
          .reverse()
          .map((q, n) => page(q.k, side, src[side].x + n * 1.5, src[side].y - n * 1.5, 0)),
      )}
      {pages
        .filter((q) => q.a > 0 && q.a < 1)
        .map((q) => {
          const s = src[q.side];
          const x = s.x + (out.x - s.x) * q.a;
          const y = s.y + (out.y - s.y) * q.a - Math.sin(q.a * PI) * 24;
          return page(q.k, q.side, x, y, (q.side ? 1 : -1) * 12 * Math.sin(q.a * PI));
        })}
    </Svg>
  );
}

// Extract and Organize: a gantry claw picks the third page out of the row and
// sets it on the shelf, or moves it to the front while the others step aside.
export function Claw({ files, value, reorder }: Props & { reorder?: boolean }) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const slot = [24, 112, 200];
  const PW = 76;
  const PH = 100;
  const PY = 146;
  const pick = reorder ? 2 : 1;
  const pickX = slot[pick] + PW / 2;
  const destX = reorder ? slot[0] + PW / 2 : 238;
  const destY = reorder ? PY : 16;
  const carry = reorder ? 40 : 16;
  const home = { x: 150, y: 40 };
  const m1 = easeInOut(seg(p, 0.04, 0.2));
  const d1 = easeInOut(seg(p, 0.2, 0.32));
  const g = seg(p, 0.32, 0.38);
  const l1 = easeInOut(seg(p, 0.38, 0.54));
  const m2 = easeInOut(seg(p, 0.54, 0.72));
  const d2 = easeInOut(seg(p, 0.72, 0.82));
  const r = seg(p, 0.82, 0.87);
  const up = easeInOut(seg(p, 0.87, 1));
  let hx = home.x + (pickX - home.x) * m1;
  let hy = home.y + (PY - home.y) * d1;
  if (p >= 0.38) hy = PY + (carry - PY) * l1;
  if (p >= 0.54) hx = pickX + (destX - pickX) * m2;
  if (p >= 0.72) hy = carry + (destY - carry) * d2;
  if (p >= 0.87) {
    hy = destY + (home.y - destY) * up;
    hx = destX + (home.x - destX) * up;
  }
  const held = g >= 1 && r < 1;
  const grip = held ? 1 : g < 1 ? g : 1 - r;
  const shift = reorder ? easeInOut(seg(p, 0.56, 0.74)) : 0;
  const page = (n: number, x: number, y: number) => (
    <g key={n}>
      <Sheet x={x} y={y} w={PW} h={PH} pic={pic} />
      <circle cx={x + PW - 12} cy={y + PH - 12} r="8" fill={n === pick ? url("accentv") : "#e4e2ea"} />
      <text x={x + PW - 12} y={y + PH - 8.5} textAnchor="middle" className="machine-num" fontSize="10" fontWeight="700" fill={n === pick ? "#fff" : "#6b6f75"}>{n + 1}</text>
    </g>
  );
  return (
    <Svg id={id}>
      <Body x={8} y={250} w={284} h={44} r={12} />
      {!reorder && <Body x={196} y={118} w={96} h={10} r={4} />}
      {[0, 1, 2].filter((n) => n !== pick).map((n) => page(n, slot[n] + (reorder ? 88 * shift : 0), PY))}
      {!held && r < 1 && page(pick, slot[pick], PY)}
      {r >= 1 && page(pick, destX - PW / 2, destY)}
      {held && page(pick, hx - PW / 2, hy)}
      <line x1={hx} y1="12" x2={hx} y2={hy - 22} stroke="#6b6f75" strokeWidth="1.5" />
      <g transform={`translate(${hx} ${hy})`}>
        <rect x="-18" y="-30" width="36" height="20" rx="6" fill={url("accentv")} filter={url("soft")} />
        <path d="M-8 -10 L-13 7" stroke={url("steelv")} strokeWidth="4.5" strokeLinecap="round" transform={`rotate(${-22 * (1 - grip)} -8 -10)`} />
        <path d="M8 -10 L13 7" stroke={url("steelv")} strokeWidth="4.5" strokeLinecap="round" transform={`rotate(${22 * (1 - grip)} 8 -10)`} />
      </g>
      <rect x="6" y="4" width="288" height="10" rx="5" fill={url("steelv")} filter={url("soft")} />
      <rect x={hx - 20} y="0" width="40" height="18" rx="6" fill={url("body")} filter={url("soft")} />
    </Svg>
  );
}

// Remove and Remove blank pages: the page goes into the shredder and comes
// out below in strips.
export function Shredder({ files, value, blank }: Props & { blank?: boolean }) {
  const id = useSvgId();
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const feed = seg(p, 0.08, 0.86);
  const top = -24 + feed * 142;
  const fed = Math.max(0, Math.min(156, top + 156 - 118));
  const X = 90;
  return (
    <Svg id={id}>
      <defs>
        <clipPath id={`${id}-in`}><rect x="0" y="0" width="300" height="118" /></clipPath>
        <clipPath id={`${id}-bin`}><rect x="62" y="190" width="176" height="92" rx="6" /></clipPath>
        {Array.from({ length: 10 }, (_, i) => (
          <clipPath key={i} id={`${id}-s${i}`}><rect x={X + i * 12} y="0" width="10" height="300" /></clipPath>
        ))}
      </defs>
      <g clipPath={`url(#${id}-in)`}>
        <Sheet x={X} y={top} w={120} h={156} pic={pic} blank={blank} />
        {blank && <text x={X + 60} y={top + 82} textAnchor="middle" fontSize="22" fill="#d7dbdf" className="machine-num">∅</text>}
      </g>
      <Body x={46} y={176} w={208} h={118} r={12} side shadow={false} />
      <rect x="62" y="190" width="176" height="92" rx="6" style={fill("--m-cavity")} />
      <g clipPath={`url(#${id}-bin)`}>
        {Array.from({ length: 10 }, (_, i) => (
          <g key={i} clipPath={`url(#${id}-s${i})`}>
            <g transform={`translate(${Math.sin(i * 1.7) * 3 * (fed / 156)} ${190 + fed - 156 + Math.sin(i * 2.3) * 6 * (fed / 156)})`}>
              <Sheet x={X} y={0} w={120} h={156} pic={pic} blank={blank} />
            </g>
          </g>
        ))}
      </g>
      <Body x={36} y={104} w={228} h={78} r={16} />
      <rect x="76" y="112" width="148" height="7" rx="3.5" style={fill("--m-slot")} />
      <Led cx={236} cy={160} on={feed > 0 && feed < 1 ? "red" : null} />
    </Svg>
  );
}

// Scan: the document camera over the stand takes each page, with a flash.
export function Camera({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const pics = usePictures(files, 3);
  const shots = [0.3, 0.55, 0.8];
  const taken = shots.filter((s) => p >= s).length;
  const flash = Math.max(0, ...shots.map((s) => 1 - Math.abs(p - s) / 0.035));
  return (
    <Svg id={id}>
      <Body x={16} y={112} w={268} h={182} r={20} />
      <Sheet x={78} y={124} w={122} h={152} pic={pics[Math.min(taken, Math.max(0, pics.length - 1))] ?? pics[0]} />
      <path d="M138 60 L162 60 L206 126 L74 126 Z" fill="#fff" opacity={0.1 + flash * 0.5} />
      {shots.map((s, i) => <circle key={i} cx={40 + i * 13} cy={284} r="3.5" fill={p >= s ? url("accentv") : "#9aa0a8"} opacity={p >= s ? 1 : 0.4} />)}
      <rect x="250" y="22" width="10" height="122" rx="4" fill={url("steel")} />
      <rect x="150" y="22" width="110" height="9" rx="4.5" fill={url("steelv")} />
      <rect x="118" y="16" width="64" height="40" rx="11" fill={url("body")} filter={url("soft")} />
      <rect x="126" y="22" width="20" height="5" rx="2.5" fill={url("accentv")} />
      <circle cx="150" cy="56" r="13" fill={url("rubber")} />
      <circle cx="150" cy="56" r="8" fill={url("lcd")} />
      <circle cx="147" cy="53" r="2.5" fill="#fff" opacity="0.6" />
      {flash > 0 && <circle cx="150" cy="56" r={14 + flash * 10} fill="#fff" opacity={flash * 0.9} filter={url("glow")} />}
    </Svg>
  );
}

// PDF to JPG: the instant camera takes the page, and the photo comes out and develops.
export function Polaroid({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const flash = Math.max(0, 1 - Math.abs(p - 0.16) / 0.05);
  const out = easeOut(seg(p, 0.2, 0.6));
  const develop = easeInOut(seg(p, 0.55, 0.95));
  return (
    <Svg id={id}>
      <g transform="translate(0 -26)">
      <defs>
        <clipPath id={`${id}-out`}><rect x="0" y="188" width="300" height={out * 112} /></clipPath>
      </defs>
      <g clipPath={`url(#${id}-out)`}>
        <rect x="95" y="188" width="110" height="128" rx="3" fill="#fbfbfa" filter={url("soft")} />
        <rect x="103" y="196" width="94" height="90" fill="#fff" />
        {pic ? <image href={pic} x="103" y="196" width="94" height="90" preserveAspectRatio="xMidYMid slice" /> : <rect x="113" y="206" width="74" height="70" fill="#d7dbdf" />}
        <rect x="103" y="196" width="94" height="90" fill="#1b1d20" opacity={1 - develop} />
        <text x="150" y="304" textAnchor="middle" className="machine-num" fontSize="10" fontWeight="700" fill="#8a9099">JPG</text>
      </g>
      <Body x={46} y={38} w={208} h={152} r={28} />
      <rect x="46" y="120" width="208" height="9" fill={url("accentv")} />
      <rect x="64" y="54" width="42" height="22" rx="5" fill="#e6eaef" stroke="#000" strokeOpacity="0.1" />
      {flash > 0 && <rect x="64" y="54" width="42" height="22" rx="5" fill="#fff" filter={url("glow")} opacity={flash} />}
      <rect x="198" y="54" width="34" height="20" rx="5" fill={url("lcd")} />
      <circle cx="150" cy="112" r="46" fill={url("rubber")} filter={url("soft")} />
      <circle cx="150" cy="112" r="34" fill={url("lcd")} />
      <circle cx="150" cy="112" r="20" fill="#0d0e10" />
      <circle cx="140" cy="101" r="7" fill="#fff" opacity="0.18" />
      <Button x={204} y={28} w={30} h={12} />
      <rect x="78" y="180" width="144" height="7" rx="3.5" style={fill("--m-slot")} />
      </g>
    </Svg>
  );
}

// Repair's page, and its torn top corner: a jagged line from the top edge
// to the right edge.
const PAGE = { x: 76, y: 28, w: 148, h: 206 };
const JAG = [
  [70, 0], [80, 16], [90, 10], [97, 28], [110, 24], [115, 44], [128, 42], [148, 70],
].map(([dx, dy]) => [PAGE.x + dx, PAGE.y + dy]);
const TEAR_AT = { x: JAG[0][0], y: JAG[0][1] };
const TEAR = `M${PAGE.x} ${PAGE.y} H${JAG[0][0]} ${JAG.map(([x, y]) => `L${x} ${y}`).join(" ")} V${PAGE.y + PAGE.h} H${PAGE.x} Z`;
const PIECE = `M${JAG[0][0]} ${JAG[0][1]} H${PAGE.x + PAGE.w} V${JAG.at(-1)![1]} ${[...JAG].reverse().map(([x, y]) => `L${x} ${y}`).join(" ")} Z`;

// Repair: the torn corner slides back into place and a strip of tape holds it.
export function Patcher({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const m = easeInOut(seg(p, 0.12, 0.48));
  const tape = easeInOut(seg(p, 0.55, 0.86));
  const done = p > 0.9;
  // The tape runs along the tear, from its top end down to the page's edge.
  const a = { x: TEAR_AT.x - 8, y: TEAR_AT.y - 8 };
  const b = { x: PAGE.x + PAGE.w + 8, y: PAGE.y + 78 };
  const end = { x: a.x + (b.x - a.x) * tape, y: a.y + (b.y - a.y) * tape };
  const sheet = <Sheet x={PAGE.x} y={PAGE.y} w={PAGE.w} h={PAGE.h} pic={pic} />;
  return (
    <Svg id={id}>
      <defs>
        <clipPath id={`${id}-page`}><path d={TEAR} /></clipPath>
        <clipPath id={`${id}-piece`}><path d={PIECE} /></clipPath>
      </defs>
      <Body x={14} y={242} w={272} h={52} r={12} />
      <g clipPath={`url(#${id}-page)`}>{sheet}</g>
      <g transform={`translate(${24 * (1 - m)} ${-14 * (1 - m)}) rotate(${14 * (1 - m)} 200 80)`}>
        <g clipPath={`url(#${id}-piece)`}>{sheet}</g>
      </g>
      {tape > 0 && <line x1={a.x} y1={a.y} x2={end.x} y2={end.y} stroke="#ffc9a6" strokeOpacity="0.5" strokeWidth="20" strokeLinecap="square" />}
      {tape > 0 && tape < 1 && (
        <g transform={`translate(${end.x} ${end.y})`}>
          <circle r="17" fill={url("body")} filter={url("soft")} />
          <circle r="11" fill="#ffc9a6" />
          <circle r="4.5" fill={url("steel")} />
        </g>
      )}
      <Led cx={266} cy={268} on={done ? "green" : null} />
    </Svg>
  );
}

// PDF/A: the archive cabinet's top drawer opens, the page goes in, the
// drawer shuts and takes its label.
export function Cabinet({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const open = easeInOut(seg(p, 0.05, 0.28)) * (1 - easeInOut(seg(p, 0.66, 0.84)));
  const drop = easeIn(seg(p, 0.3, 0.62));
  const front = 40 + 40 * open;
  const filed = p > 0.86;
  const drawer = (y: number, label: boolean) => (
    <g>
      <rect x="80" y={y} width="140" height="76" rx="8" fill={url("body")} filter={url("soft")} />
      <rect x="81" y={y + 0.5} width="138" height="75" rx="7.5" fill="none" style={{ stroke: "var(--m-edge)" }} />
      <rect x="128" y={y + 14} width="44" height="16" rx="3" fill={url("metal")} />
      <rect x="131" y={y + 17} width="38" height="10" rx="2" fill="#fff" />
      {label && filed && <text x="150" y={y + 25} textAnchor="middle" fontSize="8" fontWeight="700" className="machine-num" fill="#b7322b">PDF/A</text>}
      <rect x="130" y={y + 44} width="40" height="9" rx="4.5" fill={url("steelv")} />
    </g>
  );
  return (
    <Svg id={id}>
      <defs>
        <clipPath id={`${id}-in`}><rect x="0" y="0" width="300" height={front} /></clipPath>
      </defs>
      <Body x={70} y={26} w={160} h={268} r={14} />
      <rect x="84" y="36" width="132" height={Math.max(4, front - 36)} rx="4" style={fill("--m-cavity")} />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={92 + i * 24} y={front - 12} width="18" height="10" rx="2" fill={["#ff6a13", "#ffb38a", "#ff7a59", "#8a9099", "#c4c1bc"][i]} opacity={open > 0.1 ? 0.8 : 0} />)}
      <g clipPath={`url(#${id}-in)`}>
        <Sheet x={90} y={-160 + drop * 200} w={120} h={156} pic={pic} />
      </g>
      <g transform={`translate(150 ${front + 38}) scale(${1 + 0.06 * open}) translate(-150 ${-front - 38})`}>{drawer(front, true)}</g>
      {drawer(124, false)}
      {drawer(208, false)}
      <Led cx={214} cy={33} on={filed ? "green" : null} />
    </Svg>
  );
}

// Accessible PDF: the embosser's head works along each line and leaves braille.
export function Embosser({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const q = seg(p, 0.05, 0.94) * 6;
  const row = Math.min(5, Math.floor(q));
  const frac = q >= 6 ? 1 : q - row;
  const hx = 92 + frac * 116;
  const hy = 112 + row * 28;
  const busy = p > 0.05 && p < 0.94;
  return (
    <Svg id={id}>
      <Body x={6} y={76} w={288} h={218} r={20} />
      <Sheet x={76} y={88} w={148} h={186} pic={pic} opacity={0.98} />
      {pic && <rect x="76" y="88" width="148" height="186" fill="#fff" opacity="0.6" />}
      {Array.from({ length: 6 }, (_, r) =>
        Array.from({ length: 8 }, (_, c) => {
          const x = 92 + c * 15;
          if (r > row || (r === row && x > hx - 4 && q < 6)) return null;
          return [0, 1, 2, 3, 4, 5].map((d) =>
            ((r * 7 + c * 3 + d * 5) % 3) !== 0 ? (
              <g key={`${r}-${c}-${d}`}>
                <circle cx={x + (d % 2) * 5} cy={hy - (row - r) * 28 - 8 + Math.floor(d / 2) * 5} r="1.9" fill="#fff" stroke="#9aa0a8" strokeWidth="0.7" />
              </g>
            ) : null,
          );
        }),
      )}
      <rect x="8" y={hy - 34} width="284" height="10" rx="5" fill={url("steelv")} filter={url("soft")} />
      <g transform={`translate(${hx} ${hy - 30})`}>
        <rect x="-15" y="-10" width="30" height="24" rx="6" fill={url("accentv")} filter={url("soft")} />
        <rect x="-2" y="14" width="4" height={busy && Math.floor(t * 14) % 2 ? 10 : 6} fill="#3b3d40" />
      </g>
    </Svg>
  );
}

// Summarize: the page drops into the funnel, its lines swirl, and a short
// card comes out of the spout.
export function Funnel({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const drop = easeIn(seg(p, 0.06, 0.34));
  const swirl = seg(p, 0.25, 0.4) * (1 - seg(p, 0.6, 0.7));
  const card = easeOut(seg(p, 0.6, 0.86));
  return (
    <Svg id={id}>
      <defs>
        <clipPath id={`${id}-top`}><rect x="0" y="0" width="300" height="134" /></clipPath>
        <clipPath id={`${id}-cone`}><path d="M60 136 H240 L168 204 H132 Z" /></clipPath>
      </defs>
      <Body x={60} y={272} w={180} h={22} r={9} />
      <g clipPath={`url(#${id}-top)`}>
        <Sheet x={102} y={8 + drop * 140} w={96} h={124} pic={pic} />
      </g>
      <path d="M56 134 H244 L170 206 V226 H130 V206 Z" fill={url("metal")} filter={url("soft")} />
      <path d="M56 134 H244 L170 206 V226 H130 V206 Z" fill={url("brush")} />
      <g clipPath={`url(#${id}-cone)`} opacity={swirl}>
        <rect x="60" y="136" width="180" height="70" style={fill("--m-cavity")} opacity="0.85" />
        {Array.from({ length: 6 }, (_, i) => (
          <rect key={i} x={-18} y="-2.5" width="36" height="5" rx="2.5" fill="#d7dbdf" transform={`translate(150 ${152 + i * 8}) rotate(${(t * 220 + i * 51) % 360}) translate(${16 + i * 4} 0)`} />
        ))}
      </g>
      <ellipse cx="150" cy="134" rx="94" ry="7" fill="#8d949b" />
      <ellipse cx="150" cy="133" rx="90" ry="5" style={fill("--m-cavity")} />
      {card > 0 && (
        <g transform={`translate(150 ${222 + card * 26}) scale(${0.25 + card * 0.75}) translate(-60 -26)`}>
          <rect width="120" height="52" rx="6" fill="#fff" filter={url("soft")} />
          <rect x="10" y="10" width="4" height="32" rx="2" fill={url("accentv")} />
          <rect x="22" y="12" width="74" height="6" rx="3" fill="#b9bfc6" />
          <rect x="22" y="24" width="86" height="5" rx="2.5" fill="#d7dbdf" />
          <rect x="22" y="35" width="58" height="5" rx="2.5" fill="#d7dbdf" />
        </g>
      )}
    </Svg>
  );
}

// Chat: the page and the speaker take turns: a question goes up from the
// page, an answer comes back from the speaker.
export function Intercom({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const bubbles = [0.08, 0.3, 0.52, 0.74];
  return (
    <Svg id={id}>
      <defs>
        <clipPath id={`${id}-grille`}><circle cx="222" cy="200" r="42" /></clipPath>
        <pattern id={`${id}-holes`} width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="1.8" fill="#000" opacity="0.4" />
        </pattern>
      </defs>
      <Sheet x={20} y={120} w={110} h={142} pic={pic} />
      <Body x={10} y={260} w={130} h={34} r={10} />
      <Body x={156} y={130} w={132} h={164} r={24} />
      <circle cx="222" cy="200" r="46" fill={url("side")} />
      <rect x="176" y="154" width="92" height="92" fill={`url(#${id}-holes)`} clipPath={`url(#${id}-grille)`} />
      <Button x={196} y={262} w={52} h={14} />
      <Led cx={272} cy={146} on={p < 0.97 && Math.floor(t * 3) % 2 === 0 ? "green" : null} />
      {bubbles.map((b, i) => {
        const shown = seg(p, b, b + 0.05) * (1 - seg(p, b + 0.32, b + 0.38));
        if (shown <= 0) return null;
        const mine = i % 2 === 0;
        const rise = (p - b) * 70;
        const x = mine ? 24 : 150;
        const y = 70 - rise;
        return (
          <g key={i} opacity={shown} transform={`translate(${x} ${y})`}>
            <rect width="126" height="46" rx="14" fill={mine ? "#fff" : url("accentv")} stroke="#000" strokeOpacity={mine ? 0.1 : 0} filter={url("soft")} />
            <path d={mine ? "M22 46 L30 58 L38 46 Z" : "M88 46 L96 58 L104 46 Z"} fill={mine ? "#fff" : "var(--accent-m)"} />
            <rect x="14" y="13" width={mine ? 70 : 92} height="6" rx="3" fill={mine ? "#b9bfc6" : "#fff"} opacity={mine ? 1 : 0.85} />
            <rect x="14" y="27" width={mine ? 48 : 76} height="6" rx="3" fill={mine ? "#d7dbdf" : "#fff"} opacity={mine ? 1 : 0.6} />
          </g>
        );
      })}
    </Svg>
  );
}

// The other script's words: lengths of the marks along a line.
const GLYPHS = [12, 18, 9, 15, 20, 11, 14, 8, 16];

// Translate: the page turns over on its axle, and the back of it reads in
// another script.
export function Flipper({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const th = PI * easeInOut(seg(p, 0.18, 0.78));
  const c = Math.cos(th);
  const sy = Math.max(0.02, Math.abs(c));
  return (
    <Svg id={id}>
      <rect x="34" y="60" width="10" height="214" rx="4" fill={url("steel")} />
      <rect x="256" y="60" width="10" height="214" rx="4" fill={url("steel")} />
      <Body x={14} y={268} w={272} h={26} r={10} />
      <rect x="40" y="166" width="220" height="8" rx="4" fill={url("steelv")} />
      <g transform={`translate(0 170) scale(1 ${sy}) translate(0 -170)`}>
        {c >= 0 ? (
          <Sheet x={90} y={92} w={120} h={156} pic={pic} />
        ) : (
          <g>
            <rect x="90" y="92" width="120" height="156" rx="2" fill="#fff" filter={url("soft")} />
            {Array.from({ length: 9 }, (_, i) => {
              let x = 102;
              return (
                <g key={i}>
                  {GLYPHS.slice(i % 4, (i % 4) + 6 - (i % 3)).map((w, j) => {
                    const at = x;
                    x += w + 5;
                    return <rect key={j} x={at} y={110 + i * 15} width={w} height="6" rx="3" fill={i === 0 ? url("accentv") : "#aab0b8"} opacity={i === 0 ? 0.9 : 0.8} />;
                  })}
                </g>
              );
            })}
          </g>
        )}
      </g>
      <circle cx="39" cy="170" r="8" fill={url("steel")} stroke="#7d848b" strokeWidth="0.6" />
      <circle cx="261" cy="170" r="8" fill={url("steel")} stroke="#7d848b" strokeWidth="0.6" />
      <g transform={`rotate(${(th * 360) / PI} 261 170)`}>
        <rect x="259" y="146" width="5" height="24" rx="2.5" fill={url("steelv")} />
        <Ball cx={261.5} cy={146} r={8} />
      </g>
    </Svg>
  );
}

// Listen: the radio reads the page aloud: a bar moves down its lines, the
// dial's needle runs and sound spreads from the grille.
export function Radio({ files, value }: Props) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p, t } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const q = seg(p, 0.05, 0.95);
  const row = Math.min(7, Math.floor(q * 8));
  const playing = p > 0.05 && p < 0.97;
  return (
    <Svg id={id}>
      <defs>
        <clipPath id={`${id}-grille`}><circle cx="100" cy="198" r="52" /></clipPath>
        <pattern id={`${id}-holes`} width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="4.5" cy="4.5" r="2" fill="#000" opacity="0.38" />
        </pattern>
      </defs>
      <Sheet x={100} y={8} w={100} h={130} pic={pic} />
      <rect x="108" y={22 + row * 13} width="84" height="9" rx="2" fill="#6d5cf0" opacity="0.3" />
      {playing &&
        [0, 1, 2].map((k) => {
          const r = 62 + ((t * 34 + k * 16) % 48);
          return <circle key={k} cx="100" cy="198" r={r} fill="none" style={{ stroke: "var(--accent-m)" }} strokeWidth="2.5" opacity={1 - (r - 62) / 48} />;
        })}
      <Body x={26} y={110} w={248} h={176} r={34} />
      <circle cx="100" cy="198" r="56" fill={url("side")} />
      <rect x="44" y="142" width="112" height="112" fill={`url(#${id}-holes)`} clipPath={`url(#${id}-grille)`} />
      <rect x="174" y="146" width="86" height="46" rx="8" fill={url("lcd")} />
      {Array.from({ length: 9 }, (_, i) => <rect key={i} x={182 + i * 9} y={i % 2 ? 158 : 154} width="1.5" height={i % 2 ? 8 : 12} fill="#ffc496" opacity="0.6" />)}
      <rect x={182 + q * 70} y="150" width="2.5" height="36" rx="1" fill="#ff5a4e" />
      <Knob cx={196} cy={236} r={17} angle={q * 300} />
      <Knob cx={242} cy={236} r={17} angle={-40 + q * 80} />
    </Svg>
  );
}

// Header and footer, and Metadata: the label maker prints a strip and it
// goes onto the page: along the top and the foot, or as a tag on the corner.
export function LabelMaker({ files, value, tag }: Props & { tag?: boolean }) {
  const id = useSvgId();
  const url = urlOf(id);
  const { p } = useDrive(value);
  const [pic] = usePictures(files, 1);
  const X = 132;
  const Y = 18;
  const W = 140;
  const H = 182;
  const jobs = tag
    ? [{ start: 0.1, to: { x: X + W - 58, y: Y - 2, w: 66, r: 32 } }]
    : [
        { start: 0.08, to: { x: X + 9, y: Y + 9, w: W - 18, r: 0 } },
        { start: 0.5, to: { x: X + 9, y: Y + H - 23, w: W - 18, r: 0 } },
      ];
  const from = { x: 172, y: 208 };
  const strip = (w: number, key: number, x: number, y: number, r: number) => (
    <g key={key} transform={`translate(${x} ${y}) rotate(${r})`}>
      <rect width={w} height="14" rx="2" fill={url("accentv")} filter={url("soft")} />
      {Array.from({ length: Math.floor((w - 10) / 9) }, (_, i) => <rect key={i} x={6 + i * 9} y="5" width="6" height="4" rx="1" fill="#fff" opacity="0.85" />)}
    </g>
  );
  return (
    <Svg id={id}>
      <Sheet x={X} y={Y} w={W} h={H} pic={pic} />
      {jobs.map((j, n) => {
        const print = seg(p, j.start, j.start + 0.24);
        const fly = easeInOut(seg(p, j.start + 0.26, j.start + 0.4));
        if (print <= 0) return null;
        if (fly <= 0) return strip(Math.max(10, Math.min(110, j.to.w) * print), n, from.x, from.y, 0);
        return strip(j.to.w, n, from.x + (j.to.x - from.x) * fly, from.y + (j.to.y - from.y) * fly - Math.sin(fly * PI) * 30, j.to.r * fly);
      })}
      <Body x={14} y={186} w={160} h={106} r={26} />
      <Lcd x={28} y={198} w={132} h={36}>
        <LcdText x={42} y={221} size={12}>{tag ? "# i" : "▔  ▁"}</LcdText>
      </Lcd>
      {Array.from({ length: 14 }, (_, i) => <rect key={i} x={30 + (i % 7) * 18} y={244 + Math.floor(i / 7) * 19} width="14" height="13" rx="3.5" fill={url("side")} stroke="#000" strokeOpacity="0.1" />)}
      <rect x="168" y="206" width="8" height="18" rx="2" style={fill("--m-slot")} />
    </Svg>
  );
}
