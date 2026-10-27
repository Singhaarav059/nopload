"use client";

import { useI18n } from "../I18n";
import { emphasis, type Block } from "@/lib/ai/format";
import type { Part } from "@/lib/ai/cite";

// What the server AI wrote, laid out (src/lib/ai/format.ts): chat answers
// with their page citations, and summaries.

// Text with its **bold**, then its page citations, each a button showing that page.
export function Inline({ parts, onPage }: { parts: Part[]; onPage?: (n: number) => void }) {
  const { t } = useI18n();
  return parts.map((p, k) => (
    <span key={k}>
      {k > 0 && p.text && !/^[.,;:!?)]/.test(p.text) && " "}
      {emphasis(p.text).map((e, j) => (e.bold ? <strong key={j} className="font-semibold text-ink">{e.text}</strong> : e.text))}
      {p.pages?.map((n) => (
        <button key={n} data-citation={n} onClick={() => onPage?.(n)} aria-label={t("chat.showPage", { n })}
          className="mx-0.5 inline-flex h-5 items-center rounded-md border border-line bg-surface px-1.5 align-[1px] text-[11.5px] font-medium tabular text-ink-2 hover:border-line-strong hover:text-ink">
          {t("chat.pageShort", { n })}
        </button>
      ))}
    </span>
  ));
}

// An answer as the AI laid it out: paragraphs, lists, a table, headings.
export function Blocks({ blocks, onPage }: { blocks: Block[]; onPage?: (n: number) => void }) {
  return (
    <div className="space-y-2.5" data-answer-blocks>
      {blocks.map((b, i) =>
        b.kind === "h" ? (
          <h3 key={i} className="pt-1 text-[15px] font-semibold text-ink"><Inline parts={b.parts} onPage={onPage} /></h3>
        ) : b.kind === "p" ? (
          <p key={i}><Inline parts={b.parts} onPage={onPage} /></p>
        ) : b.kind === "table" ? (
          <div key={i} className="max-w-full overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-[14px]">
              <thead className="bg-surface-2 text-start text-[13px] text-ink-2">
                <tr>{b.head.map((c, j) => <th key={j} className="px-3 py-2 text-start font-semibold"><Inline parts={c} onPage={onPage} /></th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className="border-t border-line">{r.map((c, k) => <td key={k} className="px-3 py-1.5 align-top tabular"><Inline parts={c} onPage={onPage} /></td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : b.kind === "ol" ? (
          <ol key={i} className="list-decimal space-y-1.5 ps-5 marker:text-muted">
            {b.items.map((it, j) => <li key={j} className="ps-0.5"><Inline parts={it} onPage={onPage} /></li>)}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1.5 ps-5 marker:text-muted">
            {b.items.map((it, j) => <li key={j} className="ps-0.5"><Inline parts={it} onPage={onPage} /></li>)}
          </ul>
        ),
      )}
    </div>
  );
}
