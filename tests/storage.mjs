// What the app keeps in the browser (src/lib/library.ts, src/lib/session.ts),
// in a real Chromium, against races and edge cases:
//  - turning "Remember opened files" off while a file is being saved: the
//    save is called off, nothing is left behind
//  - two big files that differ only inside get different ids (the whole
//    file is fingerprinted, not samples of it)
//  - a language-change record past its time is deleted, not just ignored,
//    and one tab's record is left alone by another
//
//   CHROME_PATH=… node tests/storage.mjs
import pw from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "storage-"));
execFileSync(join(root, "node_modules/.bin/tsc"), [
  "--outDir", out, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler",
  "--skipLibCheck", "--noCheck", "--rootDir", "src/lib", "src/lib/library.ts", "src/lib/session.ts",
], { cwd: root, stdio: "inherit" });

const chrome = process.env.CHROME_PATH ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
if (!chrome) {
  console.log("skip  storage: no Chrome found (set CHROME_PATH)");
  process.exit(0);
}
const browser = await pw.chromium.launch({ executablePath: chrome });
const ctx = await browser.newContext();
const serve = async (page) => {
  await page.route("https://test.local/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><script>window.process = { env: {} };</script><script type="module">import * as l from "/library.js"; import * as s from "/session.js"; window.lib = l; window.session = s;</script>` });
    // tsc leaves relative imports without ".js". (process.env, which Next fills in at build time, is stubbed above.)
    const file = join(out, /\.js$/.test(path) ? path : `${path}.js`);
    return existsSync(file) ? route.fulfill({ contentType: "text/javascript", body: readFileSync(file) }) : route.fulfill({ status: 404 });
  });
  await page.goto("https://test.local/");
  await page.waitForFunction(() => window.lib && window.session);
};
const page = await ctx.newPage();
await serve(page);

const results = { failed: 0 };
const test = async (label, fn) => {
  try {
    await fn();
    console.log(`ok    ${label}`);
  } catch (e) {
    results.failed++;
    console.log(`FAIL  ${label}: ${e.message}`);
  }
};
const eq = (got, want, what) => {
  if (got !== want) throw new Error(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

await test("with remembering on, a file opened is kept", async () => {
  const rows = await page.evaluate(async () => {
    await window.lib.setRemembering(true);
    await window.lib.forgetAll();
    const id = await window.lib.remember(new File(["%PDF-1.7 kept"], "kept.pdf", { type: "application/pdf" }), 1);
    return { id, n: (await window.lib.recentFiles()).length };
  });
  eq(typeof rows.id, "string", "save result");
  eq(rows.n, 1, "files kept");
});

await test("remembering turned off while a file is being saved: nothing is kept", async () => {
  const kept = await page.evaluate(async () => {
    await window.lib.setRemembering(true);
    await window.lib.forgetAll();
    // The save pauses while reading the file, as a big one does.
    let go;
    const gate = new Promise((r) => (go = r));
    const file = new File(["%PDF-1.7 private"], "qa-private.pdf", { type: "application/pdf" });
    const read = file.arrayBuffer.bind(file);
    file.arrayBuffer = () => gate.then(read);
    const saving = window.lib.remember(file, 1);
    await window.lib.setRemembering(false);
    go();
    const id = await saving;
    return { id, rows: (await window.lib.recentFiles()).length, on: window.lib.remembering() };
  });
  eq(kept.on, false, "remembering");
  eq(kept.id, null, "save result");
  eq(kept.rows, 0, "files kept");
});

await test("a save just as remembering is turned off in another tab: nothing is kept", async () => {
  const other = await ctx.newPage();
  await serve(other);
  const kept = await page.evaluate(async () => {
    await window.lib.setRemembering(true);
    let go;
    window.__gate = new Promise((r) => (go = r));
    window.__go = go;
    const file = new File(["%PDF-1.7 other"], "qa-other.pdf", { type: "application/pdf" });
    const read = file.arrayBuffer.bind(file);
    file.arrayBuffer = () => window.__gate.then(read);
    window.__saving = window.lib.remember(file, 1);
  }).then(() => other.evaluate(() => window.lib.setRemembering(false)))
    .then(() => page.evaluate(async () => {
      window.__go();
      const id = await window.__saving;
      return { id, rows: (await window.lib.recentFiles()).length };
    }));
  await other.close();
  eq(kept.id, null, "save result");
  eq(kept.rows, 0, "files kept");
});

await test("big files that differ only inside are different documents", async () => {
  const ids = await page.evaluate(async () => {
    const size = 33 * 1024 * 1024;
    const a = new Uint8Array(size), b = new Uint8Array(size);
    b[5 * 1024 * 1024] = 1;
    const same = new File([a], "renamed.pdf");
    return [await window.lib.docId(new File([a], "a.pdf")), await window.lib.docId(new File([b], "b.pdf")), await window.lib.docId(same)];
  });
  eq(ids[0] !== ids[1], true, `ids ${ids[0]} / ${ids[1]}`);
  eq(ids[0], ids[2], "the same bytes renamed");
});

await test("a language-change record past its time is deleted; another tab's is left", async () => {
  const keys = await page.evaluate(async () => {
    const db = await new Promise((ok) => { const r = indexedDB.open("nopload-inbox", 1); r.onupgradeneeded = () => r.result.createObjectStore("files"); r.onsuccess = () => ok(r.result); });
    const run = (mode, fn) => new Promise((ok) => { const t = db.transaction("files", mode); const q = fn(t.objectStore("files")); t.oncomplete = () => ok(q?.result); });
    const rec = (at) => ({ tool: "edit", files: [], options: {}, paths: ["/"], tab: "x", at });
    await run("readwrite", (s) => s.put(rec(Date.now() - 31 * 60 * 1000), "session:old-tab"));
    await run("readwrite", (s) => s.put(rec(Date.now()), "session:other-tab"));
    await run("readwrite", (s) => s.put(rec(Date.now()), "session"));
    await window.session.resumeSession("edit");
    await window.session.forgetSession();
    const keys = await run("readonly", (s) => s.getAllKeys());
    db.close();
    return keys.filter((k) => String(k).startsWith("session")).sort();
  });
  eq(keys.join(","), "session:other-tab", "records left");
});

await browser.close();
if (results.failed) process.exit(1);
console.log("\nall passed");
