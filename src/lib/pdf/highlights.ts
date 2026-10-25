// The viewer's highlights (src/components/workspace/ViewerView.tsx), saved
// into a copy of the PDF as real highlight annotations: every PDF reader
// shows them, lists them with their text, and can remove them. Each carries
// its own appearance (multiply, so the text shows through) for readers that
// don't draw one.

import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFString, degrees, type PDFPage } from "pdf-lib";

// Rectangles as fractions of the page as shown (0–1 from the top left).
export type Box = { x: number; y: number; w: number; h: number };
export type Highlight = { id: string; page: number; boxes: Box[]; color: string; text: string };

export const COLORS: Record<string, [number, number, number]> = {
  yellow: [1, 0.86, 0.2],
  green: [0.55, 0.9, 0.45],
  blue: [0.5, 0.75, 1],
  pink: [1, 0.6, 0.8],
};

// A point on the page as shown → PDF space, for the page's rotation and crop box.
function toPdf(page: PDFPage, fx: number, fy: number): [number, number] {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const [w, h] = rot === 90 || rot === 270 ? [box.height, box.width] : [box.width, box.height];
  const sx = fx * w, sy = fy * h;
  // Shown (x right, y down) → unrotated page space (x right, y up).
  const [ux, uy] =
    rot === 90 ? [sy, sx]
    : rot === 180 ? [w - sx, sy]
    : rot === 270 ? [h - sy, w - sx]
    : [sx, h - sy];
  return [box.x + ux, box.y + uy];
}

export async function withHighlights(bytes: ArrayBuffer | Uint8Array, list: Highlight[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  const ctx = doc.context;
  const r = (n: number) => +n.toFixed(2);
  for (const hl of list) {
    const page = pages[hl.page];
    if (!page || !hl.boxes.length) continue;
    const color = COLORS[hl.color] ?? COLORS.yellow;
    // QuadPoints: top left, top right, bottom left, bottom right of each box.
    const quads = hl.boxes.map((b) => [
      ...toPdf(page, b.x, b.y), ...toPdf(page, b.x + b.w, b.y),
      ...toPdf(page, b.x, b.y + b.h), ...toPdf(page, b.x + b.w, b.y + b.h),
    ]);
    const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]);
    const ys = quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
    const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(r);
    const paths = quads.map((q) => `${r(q[0])} ${r(q[1])} m ${r(q[2])} ${r(q[3])} l ${r(q[6])} ${r(q[7])} l ${r(q[4])} ${r(q[5])} l h f`).join("\n");
    const appearance = ctx.register(ctx.stream(`/G gs ${color.join(" ")} rg\n${paths}`, {
      Type: "XObject", Subtype: "Form", BBox: rect,
      Resources: { ExtGState: { G: { Type: "ExtGState", BM: "Multiply" } } },
    } as never));
    const ref = ctx.register(ctx.obj({
      Type: "Annot", Subtype: "Highlight", F: 4, Rect: rect, QuadPoints: quads.flat().map(r), C: color,
      Contents: PDFHexString.fromText(hl.text), M: PDFString.fromDate(new Date()), P: page.ref, AP: { N: appearance },
    } as never));
    let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) {
      annots = ctx.obj([]);
      page.node.set(PDFName.of("Annots"), annots);
    }
    annots.push(ref);
  }
  return doc.save();
}

// For tests: a page turned by `angle`, to check the mapping above.
export const _rotate = (page: PDFPage, angle: number) => page.setRotation(degrees(angle));
