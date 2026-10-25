// Tables as data, for PDF to Excel's "Tables" mode: the tables found on each
// page (tables.ts), joined where one runs on to the next page, and checked:
// rows that say they're a total must add up, and a statement's running
// balance must follow from its money in and out. Nothing here touches a
// file; pdfToExcel writes what it returns.

// One table: rows of cell texts, the first the header when it reads like one.
export type DataTable = { pages: number[]; rows: string[][] };

// A check on one cell: what the row says, what the rows above add up to.
export type Check = { table: number; row: number; col: number; kind: "total" | "balance"; stated: number; computed: number; ok: boolean };

const TOTAL = /^(grand\s*)?(sub[-\s]?)?totals?\b|\b(sum|summe|gesamt|zwischensumme|totale?|totaal|somme|suma|итого|всего|toplam|jumlah|合計|合计|总计|小計|小计|कुल|योग|المجموع|الإجمالي|tổng|รวม|합계|razem|celkem|yhteensä|i alt|totalt|σύνολο)\b/iu;
const BALANCE = /\b(balance|saldo|solde|bilanz|остаток|bakiye|शेष|余额|残高|잔액)\b/iu;
const DEBIT = /\b(debits?|withdrawals?|dr|paid out|money out|débit|soll|abbuchung|списание|ऋण|निकासी|支出|出金|출금)\b/iu;
const CREDIT = /\b(credits?|deposits?|cr|paid in|money in|crédit|haben|gutschrift|зачисление|जमा|收入|入金|입금)\b/iu;

// A cell's number: 1,234.56 / 1.234,56 / (12.00) / -12 / 12.00 CR / 5% / ₹ 1,20,000.
export function cellNumber(text: string): number | null {
  let t = text.replace(/[\s  ]/g, "");
  if (!t) return null;
  let neg = false;
  const dr = /(?:dr|cr)\.?$/i.exec(t);
  if (dr) {
    neg = /^dr/i.test(dr[0]);
    t = t.slice(0, dr.index);
  }
  if (!/^[-+−(]?[$€£¥₹]?(\d[\d,.']*)%?\)?-?$/.test(t)) return null;
  if (/^[-−(]/.test(t) || /-$/.test(t)) neg = !neg;
  let core = t.replace(/[^\d.,']/g, "").replace(/'/g, "");
  const lastDot = core.lastIndexOf("."), lastComma = core.lastIndexOf(",");
  // A comma followed by one or two digits at the end is the decimal mark (1.234,56); otherwise commas group thousands.
  if (lastComma > lastDot && /,\d{1,2}$/.test(core)) core = core.replace(/\./g, "").replace(",", ".");
  else core = core.replace(/,/g, "");
  if ((core.match(/\./g) ?? []).length > 1) core = core.replace(/\.(?=.*\.)/g, "");
  const n = Number(core);
  if (!Number.isFinite(n) || core === "") return null;
  const v = t.includes("%") ? n / 100 : n;
  return neg ? -v : v;
}

const blank = (r: string[]) => r.every((c) => !c.trim());
const mostlyText = (r: string[]) => r.filter((c) => c.trim()).every((c) => cellNumber(c) === null);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c.trim().toLowerCase() === (b[i] ?? "").trim().toLowerCase());

// Tables in page order → joined: a table that starts a page continues the
// last one of the page before when it has as many columns, its repeated
// header row dropped.
export function joinTables(perPage: { page: number; rows: string[][]; first: boolean; last: boolean }[]): DataTable[] {
  const out: (DataTable & { lastPage: number; endsPage: boolean })[] = [];
  for (const t of perPage) {
    const rows = t.rows.filter((r) => !blank(r));
    if (!rows.length) continue;
    const prev = out[out.length - 1];
    const width = rows[0].length;
    if (prev && t.first && prev.endsPage && prev.lastPage === t.page - 1 && prev.rows[0].length === width) {
      const body = same(rows[0], prev.rows[0]) ? rows.slice(1) : rows;
      prev.rows.push(...body);
      prev.pages.push(t.page);
      prev.lastPage = t.page;
      prev.endsPage = t.last;
      continue;
    }
    out.push({ pages: [t.page], rows, lastPage: t.page, endsPage: t.last });
  }
  return out.map(({ pages, rows }) => ({ pages, rows }));
}

// Columns that hold numbers: at least half their filled body cells are (a
// statement's credit column may have only one).
function numericCols(rows: string[][]) {
  const width = Math.max(...rows.map((r) => r.length));
  const body = rows.slice(mostlyText(rows[0]) ? 1 : 0);
  return Array.from({ length: width }, (_, c) => {
    const filled = body.map((r) => r[c] ?? "").filter((v) => v.trim());
    return filled.length >= 1 && filled.filter((v) => cellNumber(v) !== null).length * 2 >= filled.length;
  });
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005 + Math.abs(b) * 1e-9;

// Totals: each number in a "total" row against the numbers above it, back to
// the last total (a subtotal), or back to the top (a grand total, which may
// also be the sum of the subtotals).
// Balances: in a table with a balance column and money in and out (or one
// signed amount), each balance against the one before it.
export function checkTable(rows: string[][], table: number): Check[] {
  if (rows.length < 3) return [];
  const header = mostlyText(rows[0]) ? rows[0] : null;
  const nums = numericCols(rows);
  const out: Check[] = [];
  const isTotal = (r: string[]) => r.some((c, k) => !nums[k] && TOTAL.test(c.trim()));
  let since = header ? 1 : 0;
  const subtotals: number[] = [];
  for (let i = since; i < rows.length; i++) {
    if (!isTotal(rows[i])) continue;
    for (let c = 0; c < nums.length; c++) {
      if (!nums[c]) continue;
      const stated = cellNumber(rows[i][c] ?? "");
      if (stated === null) continue;
      const part = rows.slice(since, i).filter((r) => !isTotal(r)).map((r) => cellNumber(r[c] ?? "")).filter((v): v is number => v !== null);
      // Right after a subtotal (a grand total), only the whole column or the subtotals can be what it adds.
      if (!part.length && !subtotals.length) continue;
      const sum = part.reduce((a, b) => a + b, 0);
      const all = rows.slice(header ? 1 : 0, i).filter((r) => !isTotal(r)).map((r) => cellNumber(r[c] ?? "") ?? 0).reduce((a, b) => a + b, 0);
      const subs = subtotals.length ? rows.filter((_, k) => subtotals.includes(k)).map((r) => cellNumber(r[c] ?? "") ?? 0).reduce((a, b) => a + b, 0) : NaN;
      const ok = (part.length > 0 && near(stated, sum)) || near(stated, all) || near(stated, subs);
      out.push({ table, row: i, col: c, kind: "total", stated, computed: ok ? stated : part.length ? sum : all, ok });
    }
    subtotals.push(i);
    since = i + 1;
  }
  if (header) {
    const find = (re: RegExp) => header.findIndex((h, k) => nums[k] && re.test(h));
    const bal = find(BALANCE);
    const debit = find(DEBIT), credit = find(CREDIT);
    const amount = header.findIndex((h, k) => nums[k] && k !== bal && /\b(amount|betrag|montant|importe|сумма|राशि|金额|金額)\b/iu.test(h));
    if (bal >= 0 && ((debit >= 0 && credit >= 0) || amount >= 0)) {
      const move = (r: string[]) => amount >= 0 ? cellNumber(r[amount] ?? "") ?? 0
        : (cellNumber(r[credit] ?? "") ?? 0) - Math.abs(cellNumber(r[debit] ?? "") ?? 0);
      const lines = rows.map((r, i) => ({ r, i, b: cellNumber(r[bal] ?? "") })).filter((x) => x.i > 0 && x.b !== null && !isTotal(x.r));
      // Oldest first, each balance is the one above plus its row's movement;
      // newest first, the one below plus the row above's. Whichever fits more.
      const down = lines.slice(1).map((x, k) => ({ x, expected: lines[k].b! + move(x.r) }));
      const up = lines.slice(0, -1).map((x, k) => ({ x, expected: lines[k + 1].b! + move(x.r) }));
      const fits = (list: typeof down) => list.filter((c) => near(c.x.b!, c.expected)).length;
      for (const { x, expected } of fits(up) > fits(down) ? up : down) {
        out.push({ table, row: x.i, col: bal, kind: "balance", stated: x.b!, computed: expected, ok: near(x.b!, expected) });
      }
    }
  }
  return out;
}
