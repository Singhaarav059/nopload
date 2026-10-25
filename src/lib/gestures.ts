// Shapes a hand draws to mean something, as on paper: scribbling over a word
// crosses it out. Points are in page points (72 per inch), so a gesture reads
// the same at any zoom.

type Pt = [number, number];

// A scratch-out: a back-and-forth stroke, at least four turns along its
// longer side, that covers its own band many times over. A signature or a
// wavy underline doesn't: they go mostly one way. Returns the box it covers.
export function scratchOut(points: Pt[]): { x: number; y: number; w: number; h: number } | null {
  if (points.length < 8) return null;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0, h = y1 - y0;
  const long = Math.max(w, h);
  if (long < 12) return null;
  const axis = w >= h ? 0 : 1;
  // Turns along the long side, ignoring jitter smaller than a few points.
  const jitter = Math.max(3, long * 0.12);
  let turns = 0, dir = 0, anchor = points[0][axis];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    const d = points[i][axis] - anchor;
    if (Math.abs(d) < jitter) continue;
    const s = Math.sign(d);
    if (dir && s !== dir) turns++;
    dir = s;
    anchor = points[i][axis];
  }
  // Going back and forth covers the long side several times.
  if (turns < 4 || length < long * 3.5) return null;
  // Mostly one way (net drift as big as the stroke) is writing, not scratching.
  const drift = Math.abs(points[points.length - 1][axis] - points[0][axis]);
  if (drift > long * 0.85 && turns < 6) return null;
  return { x: x0, y: y0, w, h };
}

// A loop: a stroke that ends where it began, around an area. Returns the
// box it encloses.
export function loop(points: Pt[]): { x: number; y: number; w: number; h: number } | null {
  if (points.length < 10) return null;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0, h = y1 - y0;
  if (Math.min(w, h) < 14) return null;
  const [sx, sy] = points[0], [ex, ey] = points[points.length - 1];
  if (Math.hypot(ex - sx, ey - sy) > Math.max(w, h) * 0.25) return null;
  // The shoelace area: a real enclosure, not a squiggle that happens to close.
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i], [bx, by] = points[(i + 1) % points.length];
    area += ax * by - bx * ay;
  }
  if (Math.abs(area) / 2 < w * h * 0.4) return null;
  return { x: x0, y: y0, w, h };
}
