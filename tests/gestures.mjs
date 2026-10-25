// Shapes drawn by hand (src/lib/gestures.ts): a scribble over a word crosses
// it out; handwriting, a wavy underline and a signature don't. A loop around
// something encloses it; a hook or a squiggle doesn't.
//
//   node tests/gestures.mjs
import { scratchOut, loop } from "../src/lib/gestures.ts";

let failed = 0;
const test = (label, fn) => {
  try {
    console.log(`ok    ${label}${(() => { const r = fn(); return r ? `: ${r}` : ""; })()}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${label}: ${e.message}`);
  }
};
const ok = (c, what) => {
  if (!c) throw new Error(what);
};

// Back and forth over a word 60 points wide, a little up and down as a hand does.
const scribble = (passes, x = 100, y = 200, w = 60, h = 12) => {
  const pts = [];
  for (let k = 0; k <= passes; k++) {
    const from = k % 2 ? x + w : x, to = k % 2 ? x : x + w;
    for (let s = 0; s < 8; s++) pts.push([from + ((to - from) * s) / 8, y + (k * h) / passes + Math.sin(s) * 1.5]);
  }
  return pts;
};

test("a scribble over a word crosses it out", () => {
  const box = scratchOut(scribble(6));
  ok(box, "not seen");
  ok(box.x <= 100 && box.x + box.w >= 159 && box.h < 20, JSON.stringify(box));
  return `${Math.round(box.w)}×${Math.round(box.h)} pt`;
});

test("standing up: a vertical scribble too", () => {
  const box = scratchOut(scribble(6).map(([a, b]) => [b, a]));
  ok(box && box.h > box.w, JSON.stringify(box));
});

test("two quick passes are a line, not a scribble", () => {
  ok(!scratchOut(scribble(2)), "seen");
});

test("handwriting, a wavy underline and a signature aren't scribbles", () => {
  const wave = Array.from({ length: 60 }, (_, i) => [100 + i * 3, 200 + Math.sin(i / 2) * 6]);
  ok(!scratchOut(wave), "wave");
  const loops = Array.from({ length: 80 }, (_, i) => [100 + i * 2 + Math.cos(i / 3) * 8, 200 + Math.sin(i / 3) * 8]);
  ok(!scratchOut(loops), "cursive loops");
  const sig = [[100, 210], [120, 190], [130, 215], [150, 185], [165, 212], [190, 195], [220, 200], [260, 198], [300, 205], [330, 190]];
  ok(!scratchOut(sig), "signature");
});

test("a dot or a tiny jiggle is nothing", () => {
  ok(!scratchOut([[1, 1], [2, 1], [1, 1], [2, 1], [1, 1], [2, 1], [1, 1], [2, 1], [1, 1]]), "jiggle");
});

test("a loop around something encloses it", () => {
  const ring = Array.from({ length: 40 }, (_, i) => [200 + Math.cos((i / 39) * Math.PI * 2) * 50, 300 + Math.sin((i / 39) * Math.PI * 2) * 30]);
  const box = loop(ring);
  ok(box && Math.abs(box.w - 100) < 2 && Math.abs(box.h - 60) < 2, JSON.stringify(box));
});

test("a hook or an open curve isn't a loop", () => {
  const hook = Array.from({ length: 30 }, (_, i) => [200 + Math.cos((i / 29) * Math.PI) * 50, 300 + Math.sin((i / 29) * Math.PI) * 30]);
  ok(!loop(hook), "hook");
  ok(!loop(scribble(6)), "scribble");
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
