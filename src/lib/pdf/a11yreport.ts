"use client";

// The accessibility check (a11ycheck.ts) as a page to keep, print or send
// on: one HTML file with every check, its result, why it matters and how to
// fix it. It opens anywhere without loading anything: inline styles, no
// scripts, no outside resources. Every word comes from the dictionary
// (a11y.* in src/lib/i18n/dict/en.ts), and everything from the file (its
// name, title, language) is escaped.

import en from "../i18n/dict/en";
import { format } from "../i18n/format";
import { LOCALES } from "../i18n/locales";
import { baseName, type Output } from "./common";
import { A11Y_CHECKS, fixedBy, tally, type A11yReport, type A11yResult, type A11yStatus } from "./a11ycheck";
import type { Say } from "./compare-export";

// English, for callers without the page's language (tests, workflows saved before it was passed).
export const englishSay: Say = (key, vars) => format((en as Record<string, string>)[key] ?? key, vars, "en");

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Failures first, then warnings, passes, and what didn't apply.
const RANK: Record<A11yStatus, number> = { fail: 0, warn: 1, pass: 2, na: 3 };
const MARK: Record<A11yStatus, string> = { fail: "✗", warn: "!", pass: "✓", na: "–" };

export type A11yHtmlOptions = { file: string; before?: A11yReport | null; t?: Say; locale?: string; when?: Date };

export function a11yHtml(r: A11yReport, o: A11yHtmlOptions): string {
  const t = o.t ?? englishSay;
  const e = (key: string, vars?: Record<string, string | number>) => escape(t(key, vars));
  const { passed, warnings, failed } = tally(r);
  const date = (o.when ?? new Date()).toISOString().slice(0, 10);
  const order = (x: A11yResult) => RANK[x.status] * 100 + A11Y_CHECKS.indexOf(x.id);
  const fixed = o.before ? fixedBy(o.before, r) : [];
  // The tools a fix points to, by their names in this language.
  const tools = Object.fromEntries((["accessible", "ocr", "metadata", "bookmarks", "pdfToPdfa"] as const).map((id) => [id === "pdfToPdfa" ? "pdfa" : id, t(`tool.${id}.name`)]));
  const locale = o.locale ?? "en";
  const rtl = LOCALES.some((l) => l.code === locale && "rtl" in l && l.rtl);

  const section = (x: A11yResult) => {
    const pages = x.pages.length
      ? `<p class="pages">${e("a11y.pages", { list: x.pages.join(", ") })}${x.pagesTotal > x.pages.length ? ` ${e("a11y.morePages", { n: x.pagesTotal - x.pages.length })}` : ""}</p>`
      : "";
    const fix = x.status === "fail" || x.status === "warn" ? `<h4>${e("a11y.howToFix")}</h4><p>${e(`a11y.fix.${x.id}`, tools)}</p>` : "";
    return `<section class="check ${x.status}" data-check="${x.id}" data-status="${x.status}">
<h3><span class="badge">${MARK[x.status]} ${e(`a11y.status.${x.status}`)}</span> ${e(`a11y.check.${x.id}`)}</h3>
<p class="msg">${e(`a11y.msg.${x.key}`, { n: x.count, value: x.value ?? "" })}</p>
${pages}<h4>${e("a11y.whyItMatters")}</h4><p>${e(`a11y.why.${x.id}`)}</p>
${fix}</section>`;
  };

  const title = t("a11y.reportTitle");
  return `<!doctype html>
<html lang="${escape(locale)}"${rtl ? ` dir="rtl"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(`${title}: ${o.file}`)}</title>
<style>
body{font:15px/1.6 system-ui,sans-serif;color:#1f1f1c;background:#fff;max-width:860px;margin:0 auto;padding:32px 20px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 10px}h3{font-size:16px;margin:0 0 6px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
h4{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#55554f;margin:12px 0 2px}p{margin:0}
.meta{color:#55554f;margin:0 0 20px}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0 0 20px}dt{color:#55554f}dd{margin:0;overflow-wrap:anywhere}
.summary{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 12px;padding:0;list-style:none}.summary li{border:1px solid #d6d6d0;border-radius:8px;padding:6px 12px;font-weight:600}
.note{color:#55554f;margin:0 0 10px}
.check{border:1px solid #d6d6d0;border-inline-start-width:6px;border-radius:10px;padding:14px 18px;margin:0 0 12px;break-inside:avoid}
.badge{font-size:13px;font-weight:700;border-radius:6px;padding:1px 8px;white-space:nowrap}
.fail{border-inline-start-color:#b42318}.fail .badge{background:#fde7e4;color:#8a1c12}
.warn{border-inline-start-color:#b54708}.warn .badge{background:#fdf0dc;color:#7a3306}
.pass{border-inline-start-color:#067647}.pass .badge{background:#dcf5e7;color:#05532f}
.na{border-inline-start-color:#8a8a84}.na .badge{background:#eeeeea;color:#3d3d39}
.pages{color:#55554f;font-size:14px;margin-top:4px}
@media print{body{padding:0;max-width:none}.check{border-color:#999}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<h1>${escape(title)}</h1>
<p class="meta">${e("a11y.meta", { date })}</p>
<dl><dt>${e("a11y.file")}</dt><dd>${escape(o.file)}</dd>
<dt>${e("a11y.docTitle")}</dt><dd>${r.title ? escape(r.title) : e("a11y.none")}</dd>
<dt>${e("a11y.language")}</dt><dd>${r.lang ? escape(r.lang) : e("a11y.none")}</dd>
<dt>${e("a11y.pageCount")}</dt><dd>${r.pages}</dd></dl>
<h2>${e("a11y.summaryTitle")}</h2>
<ul class="summary"><li>${e("a11y.passed", { n: passed })}</li><li>${e("a11y.warnings", { n: warnings })}</li><li>${e("a11y.failed", { n: failed })}</li></ul>
${fixed.length ? `<p class="note" data-fixed>${e("a11y.fixed", { list: fixed.map((id) => t(`a11y.check.${id}`)).join(", ") })}</p>` : ""}
${r.inspected < r.pages ? `<p class="note">${e("a11y.sampled", { n: r.inspected, total: r.pages })}</p>` : ""}
<p class="note">${e("a11y.disclaimer")}</p>
<h2>${e("a11y.checksTitle")}</h2>
${[...r.results].sort((a, b) => order(a) - order(b)).map(section).join("\n")}
</body></html>
`;
}

// The report as a result to download beside the PDF. Its note,
// a11y:<passed>:<warnings>:<failed>, is shown on the results screen (res.a11y).
export function a11yOutput(r: A11yReport, o: A11yHtmlOptions): Output {
  const { passed, warnings, failed } = tally(r);
  return {
    name: `${baseName(o.file)}-accessibility.html`,
    blob: new Blob([a11yHtml(r, o)], { type: "text/html" }),
    note: `a11y:${passed}:${warnings}:${failed}`,
  };
}
