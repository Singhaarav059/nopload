import type { EditorItem } from "./edit";

const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

// Whether a change to the page's own content changes anything (an object
// selected in the editor and left as it was doesn't).
export function contentChanged(i: EditorItem) {
  const s = i.source;
  if (!s) return false;
  if (i.removed) return true;
  const moved = !near(i.x, s.x) || !near(i.y, s.y) || !near(i.w, s.w ?? i.w) || !near(i.h, s.h ?? i.h);
  if (i.kind === "objEdit") {
    return moved || Boolean(i.image || i.order || i.rotate || i.flipX || i.flipY) ||
      (i.fill ?? null) !== (s.fill ?? null) || (i.color ?? null) !== (s.color ?? null) || (i.stroke ?? s.stroke) !== s.stroke;
  }
  return moved || (i.text ?? "") !== s.was || (i.color !== undefined && i.color !== s.color) ||
    (i.fontSize !== undefined && s.size !== undefined && !near(i.fontSize, s.size)) || (i.align !== undefined && i.align !== s.align);
}
