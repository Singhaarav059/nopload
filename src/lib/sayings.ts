// What people type when they want a tool, matched to the tools: their names
// and descriptions in the page's language, and everyday English phrasings
// ("make it smaller", "join files", "pdf to word"). Used by the command bar
// (src/components/CommandBar.tsx). (src/lib/intents.ts is something else:
// the search-intent pages.)

import { TOOLS, descKey, type Tool, type ToolId } from "./tools";

// Everyday words for each tool, beyond its name. Lower case.
const SAYINGS: Partial<Record<ToolId, string[]>> = {
  merge: ["join", "combine", "put together", "one file", "append", "attach pdfs"],
  split: ["separate", "break apart", "cut", "divide", "each page"],
  extract: ["take out pages", "keep pages", "pull out", "save pages"],
  remove: ["delete pages", "drop pages", "get rid of pages"],
  organize: ["reorder", "rearrange", "move pages", "sort pages", "order"],
  compress: ["smaller", "shrink", "reduce size", "make it small", "email", "too big", "file size", "kb", "mb"],
  ocr: ["searchable", "scan to text", "recognize text", "copy text from scan", "read text"],
  edit: ["change text", "write on", "erase", "type on", "fix typo", "add text", "draw", "annotate", "white out"],
  sign: ["signature", "e-sign", "esign", "autograph", "initial"],
  protect: ["password", "lock", "encrypt", "secure"],
  unlock: ["remove password", "open locked", "decrypt"],
  redact: ["black out", "hide", "censor", "remove personal", "privacy"],
  rotate: ["turn", "sideways", "upside down", "landscape", "portrait"],
  pageNumbers: ["number pages", "bates", "page count", "footer number"],
  watermark: ["stamp", "draft", "confidential", "logo on every page"],
  pdfToWord: ["to word", "docx", "editable document", "to doc"],
  pdfToExcel: ["to excel", "xlsx", "spreadsheet", "table", "csv", "bank statement"],
  pdfToPpt: ["to powerpoint", "pptx", "slides"],
  pdfToJpg: ["to image", "to jpg", "to png", "picture", "screenshot"],
  jpgToPdf: ["photos to pdf", "images to pdf", "picture to pdf", "png to pdf", "jpg to pdf"],
  wordToPdf: ["doc to pdf", "docx to pdf", "word to pdf"],
  excelToPdf: ["xlsx to pdf", "spreadsheet to pdf"],
  pptToPdf: ["slides to pdf", "presentation to pdf"],
  compare: ["difference", "diff", "what changed", "versions"],
  summarize: ["summary", "tl;dr", "tldr", "key points", "short version"],
  chat: ["ask", "question", "chat with pdf", "talk to"],
  translate: ["language", "in hindi", "in spanish", "translation"],
  forms: ["fill", "form", "fields", "fillable"],
  crop: ["trim", "margins", "cut edges"],
  repair: ["broken", "corrupt", "won't open", "damaged", "fix pdf"],
  scan: ["camera", "photo of document", "scanner"],
  listen: ["read aloud", "audio", "speak", "text to speech"],
  accessible: ["screen reader", "tags", "accessibility", "a11y"],
  grayscale: ["black and white", "grey", "gray", "no colour", "no color"],
  cleanScans: ["straighten", "deskew", "clean scan", "crooked"],
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// Tools for a query, best first. `t` gives the page's strings.
export function rankTools(query: string, t: (key: string) => string, limit = 8): Tool[] {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(" ").filter((w) => w.length > 1 || q.length === 1);
  const scored = TOOLS.map((tool) => {
    const name = norm(t(`tool.${tool.id}.name`));
    const desc = norm(t(descKey(tool)));
    const say = (SAYINGS[tool.id] ?? []).join(" | ");
    let score = 0;
    if (name === q) score += 100;
    else if (name.startsWith(q)) score += 60;
    else if (name.includes(q)) score += 40;
    if (say.includes(q)) score += 45;
    for (const w of words) {
      if (name.split(" ").some((n) => n.startsWith(w))) score += 12;
      if (say.split(/[ |]+/).some((n) => n.startsWith(w))) score += 8;
      if (desc.includes(w)) score += 3;
      if (tool.accept.includes(w)) score += 4;
    }
    return { tool, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.tool);
}
