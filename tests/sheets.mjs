// PDF to Excel's tables and checks (src/lib/pdf/sheets.ts): numbers read the
// way statements print them, totals and running balances checked, tables
// joined across pages; and a two-page bank statement converted end to end,
// one wrong balance in it found and marked.
//
//   node tests/sheets.mjs
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { load, check, eq, openPdf } from "./lib/load.mjs";

const { cellNumber, checkTable, joinTables } = await load("sheets");
const { pdfToExcel } = await load("convert");
const ExcelJS = (await import("exceljs")).default;
// pdf.js sets its worker up in Node on the first document it opens.
await openPdf(await (await PDFDocument.create()).save().then((b) => b.slice()));
const results = { failed: 0 };
const test = check(results);
const ok = (c, what) => {
  if (!c) throw new Error(what);
};

await test("numbers as statements print them", async () => {
  const cases = { "1,234.56": 1234.56, "1.234,56": 1234.56, "(12.00)": -12, "-7": -7, "12.00 Dr": -12, "12.00 CR": 12, "5%": 0.05, "₹ 1,20,000.50": 120000.5, "$3,000": 3000, "1'250.00": 1250, "100-": -100, "abc": null, "": null, "12/03/2024": null };
  for (const [k, v] of Object.entries(cases)) eq(cellNumber(k), v, k);
  return `${Object.keys(cases).length} cases`;
});

await test("a total that adds up and one that doesn't", async () => {
  const rows = [["Item", "Qty", "Amount"], ["Pens", "2", "10.00"], ["Paper", "1", "5.50"], ["Total", "3", "15.50"]];
  eq(checkTable(rows, 0).filter((c) => !c.ok).length, 0, "all add up");
  const bad = checkTable([...rows.slice(0, 3), ["Total", "3", "16.50"]], 0);
  const wrong = bad.find((c) => !c.ok);
  ok(wrong && wrong.col === 2 && wrong.computed === 15.5, JSON.stringify(bad));
  return `${bad.length} checks`;
});

await test("subtotals, and a grand total of them", async () => {
  const rows = [["Region", "Sales"], ["North", "100"], ["South", "50"], ["Subtotal", "150"], ["East", "20"], ["West", "30"], ["Subtotal", "50"], ["Grand total", "200"]];
  const cs = checkTable(rows, 0);
  eq(cs.length, 3, "three totals");
  ok(cs.every((c) => c.ok), JSON.stringify(cs));
  return "ok";
});

await test("a running balance, oldest first and newest first", async () => {
  const head = ["Date", "Description", "Debit", "Credit", "Balance"];
  const down = [head, ["01/03", "Opening", "", "", "1,000.00"], ["02/03", "Rent", "400.00", "", "600.00"], ["03/03", "Salary", "", "2,000.00", "2,600.00"], ["04/03", "Shop", "50.00", "", "2,500.00"]];
  const cs = checkTable(down, 0).filter((c) => c.kind === "balance");
  eq(cs.length, 3, "balances checked");
  eq(cs.filter((c) => !c.ok).length, 1, "the wrong one");
  eq(cs.find((c) => !c.ok).computed, 2550, "what it should be");
  const up = [head, ...down.slice(1).reverse()];
  const cu = checkTable(up, 0).filter((c) => c.kind === "balance");
  eq(cu.filter((c) => !c.ok).length, 1, "newest first: the same wrong one");
  return "ok";
});

await test("a table split over pages is one table, its header once", async () => {
  const head = ["Date", "Amount"];
  const t = joinTables([
    { page: 0, rows: [["Statement"]], first: true, last: false },
    { page: 0, rows: [head, ["1", "2"]], first: false, last: true },
    { page: 1, rows: [head, ["3", "4"]], first: true, last: true },
    { page: 2, rows: [["x", "y", "z"]], first: true, last: true },
  ]);
  eq(t.length, 3, "tables");
  eq(JSON.stringify(t[1].rows), JSON.stringify([head, ["1", "2"], ["3", "4"]]), "joined rows");
  eq(t[1].pages.join(), "0,1", "pages");
  return "ok";
});

// A bank statement over two pages, ruled, its header repeated on page 2, one balance wrong.
async function statement() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cols = [50, 120, 300, 380, 460, 545];
  const head = ["Date", "Description", "Debit", "Credit", "Balance"];
  const pages = [
    [head, ["01/03/2026", "Opening balance", "", "", "1,000.00"], ["02/03/2026", "Rent", "400.00", "", "600.00"], ["03/03/2026", "Salary", "", "2,000.00", "2,600.00"]],
    [head, ["04/03/2026", "Groceries", "50.00", "", "2,500.00"], ["05/03/2026", "Refund", "", "25.00", "2,525.00"]],
  ];
  for (const rows of pages) {
    const p = doc.addPage([595, 842]);
    p.drawText("Example Bank - Account statement", { x: 50, y: 790, size: 14, font });
    const top = 740, h = 22;
    rows.forEach((r, i) => r.forEach((c, k) => c && p.drawText(c, { x: cols[k] + 4, y: top - i * h - 15, size: 10, font })));
    for (let i = 0; i <= rows.length; i++) p.drawLine({ start: { x: cols[0], y: top - i * h }, end: { x: cols[5], y: top - i * h }, thickness: 0.8, color: rgb(0, 0, 0) });
    for (const x of cols) p.drawLine({ start: { x, y: top }, end: { x, y: top - rows.length * h }, thickness: 0.8, color: rgb(0, 0, 0) });
  }
  return new File([await doc.save()], "statement.pdf", { type: "application/pdf" });
}

await test("a two-page statement: one table, the wrong balance marked and listed", async () => {
  const [out] = await pdfToExcel(await statement(), { sheetPer: "page", excelMode: "tables", excelFormat: "xlsx", totalsCheck: true });
  eq(out.note, "totals:4:1", "note");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await out.blob.arrayBuffer());
  const names = wb.worksheets.map((w) => w.name);
  ok(names.includes("Checks") && names.some((n) => /^Table 1 \(p1-2\)$/.test(n)), names.join());
  const ws = wb.worksheets.find((w) => w.name.startsWith("Table 1"));
  eq(ws.rowCount, 6, "header once and five rows");
  eq(ws.getCell("E5").value, 2500, "the balance as a number");
  eq(ws.getCell("E5").fill?.fgColor?.argb, "FFFAD4D4", "marked red");
  ok(String(ws.getCell("E5").note?.texts?.[0]?.text ?? ws.getCell("E5").note).includes("2550"), "the right figure in its note");
  const csv = await pdfToExcel(await statement(), { sheetPer: "page", excelMode: "tables", excelFormat: "csv", totalsCheck: true });
  eq(csv.length, 2, "a CSV for the table and one for the checks");
  ok((await csv[0].blob.text()).includes("Groceries"), "CSV rows");
  return names.join(", ");
});

await test("layout mode still writes pages, and checks its tables", async () => {
  const [out] = await pdfToExcel(await statement(), { sheetPer: "page", excelMode: "layout", excelFormat: "xlsx", totalsCheck: true });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await out.blob.arrayBuffer());
  ok(wb.worksheets.map((w) => w.name).join() === "Page 1,Page 2,Checks", wb.worksheets.map((w) => w.name).join());
  ok(/^totals:\d+:\d+$/.test(out.note), out.note);
  const off = await pdfToExcel(await statement(), { sheetPer: "page", excelMode: "layout", excelFormat: "xlsx", totalsCheck: false });
  eq(off[0].note, undefined, "no checks when off");
  return out.note;
});

console.log(results.failed ? `\n${results.failed} failed` : "\nall passed");
process.exit(results.failed ? 1 : 0);
