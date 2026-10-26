"use client";

// Recent files: the PDFs opened in the viewer, kept in this browser
// (IndexedDB) so the app opens them again in one tap, offline, the way a
// reader app's library does. Nothing leaves the device; the list can be
// cleared at any time, and the oldest go once it's past its limits.

const DB = "nopload-library";
const STORE = "files";
const MAX_FILES = 12;
const MAX_BYTES = 300 * 1024 * 1024;

export type Recent = { id: string; name: string; size: number; type: string; opened: number; page: number; pages: number };
// The bytes, not a Blob: Safari can't keep Blobs in IndexedDB in a private
// window. Rows kept earlier may still hold a Blob.
type Row = Recent & { data: ArrayBuffer | Blob };

// How rows were keyed before: two different files with the same name and
// size shared one entry (and one reading position). Still read, to move an
// existing row over to its fingerprint.
export const legacyId = (f: { name: string; size: number }) => `${f.name}:${f.size}`;

// A document's id: a fingerprint of all its bytes, so two files that only
// share a name and size, or differ anywhere inside, are kept apart, and the
// same file renamed is the same document.
const ids = new WeakMap<Blob, Promise<string>>();
const fingerprint = (bytes: BufferSource) =>
  crypto.subtle.digest("SHA-256", bytes).then((hash) => `sha256:${[...new Uint8Array(hash).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
export function docId(file: Blob, bytes?: ArrayBuffer): Promise<string> {
  let id = ids.get(file);
  if (!id) {
    id = (bytes ? Promise.resolve(bytes) : file.arrayBuffer()).then(fingerprint);
    ids.set(file, id);
  }
  return id;
}

// The id files over 32 MB had before: their size and three 1 MB slices. A
// row kept under it is moved to the whole-file id when its bytes match.
const SAMPLED = 32 * 1024 * 1024;
const SLICE = 1024 * 1024;
function sampledId(file: Blob): Promise<string | null> {
  if (file.size <= SAMPLED) return Promise.resolve(null);
  const mid = Math.floor(file.size / 2 - SLICE / 2);
  return new Blob([String(file.size), file.slice(0, SLICE), file.slice(mid, mid + SLICE), file.slice(file.size - SLICE)]).arrayBuffer().then(fingerprint);
}

// Whether opened files are kept at all ("Remember opened files", on unless
// turned off), and whether the one-time notice saying they are has been seen.
const REMEMBER = "nopload:library:remember";
const NOTICED = "nopload:library:noticed";
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the default holds.
  }
};
export const remembering = () => read(REMEMBER) !== "0";
// Each time remembering is turned off (here or in another tab) a save still
// under way is called off: it checks, as it writes, that it began in the
// same epoch and that remembering is on.
let epoch = 0;
if (typeof window !== "undefined") {
  addEventListener("storage", (e) => {
    if (e.key !== REMEMBER) return;
    if (e.newValue === "0") epoch++;
    changed();
  });
}
// Turned off, the files kept so far are removed too.
export async function setRemembering(on: boolean) {
  write(REMEMBER, on ? "1" : "0");
  if (!on) epoch++;
  changed();
  if (!on) await forgetAll();
}
export const noticeSeen = () => read(NOTICED) === "1";
export const markNoticeSeen = () => write(NOTICED, "1");

const listeners = new Set<() => void>();
export const subscribeLibrary = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const changed = () => listeners.forEach((fn) => fn());

function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(undefined);
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "id" });
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req ? req.result : undefined);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          resolve(undefined);
        };
      } catch {
        db.close();
        resolve(undefined);
      }
    };
  });
}

const all = async () => ((await withStore<Row[]>("readonly", (s) => s.getAll())) ?? []).sort((a, b) => b.opened - a.opened);

// The list, newest first, without the files themselves.
export async function recentFiles(): Promise<Recent[]> {
  return (await all()).map(({ id, name, size, type, opened, page, pages }) => ({ id, name, size, type, opened, page, pages }));
}

// An older row's Blob is read while the database is still open: Firefox
// can't read a file kept in IndexedDB once its connection has closed.
export function openRecent(id: string): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "id" });
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      req.onerror = () => {
        db.close();
        resolve(null);
      };
      req.onsuccess = async () => {
        const row = req.result as Row | undefined;
        try {
          resolve(row ? new File([row.data instanceof Blob ? await row.data.arrayBuffer() : row.data], row.name, { type: row.type || "application/pdf", lastModified: row.opened }) : null);
        } catch {
          resolve(null);
        } finally {
          db.close();
        }
      };
    };
  });
}

// Keeps a file just opened (or brings it to the top), within the limits.
// Returns its id, or null when opened files aren't kept (or can't be).
export async function remember(file: File, pages: number): Promise<string | null> {
  if (!remembering()) return null;
  const began = epoch;
  // Still wanted: remembering on, and not turned off since this save began.
  const wanted = () => began === epoch && remembering();
  // Asks the browser not to clear the library when space runs low (granted
  // to installed apps; elsewhere a no-op).
  void navigator.storage?.persist?.().catch(() => {});
  const data = await file.arrayBuffer().catch(() => null);
  const id = data && (await docId(file, data).catch(() => null));
  if (!id || !data) return null;
  let old = await withStore<Row>("readonly", (s) => s.get(id));
  // A row kept under an earlier kind of id (name and size; or, over 32 MB,
  // sampled bytes): moved over (with its page) if it holds these same bytes,
  // left alone if it doesn't.
  if (!old) {
    for (const was of [legacyId(file), await sampledId(file).catch(() => null)]) {
      if (!was) continue;
      const prior = await withStore<Row>("readonly", (s) => s.get(was));
      if (prior?.data && (await docId(new Blob([prior.data])).catch(() => null)) === id) {
        old = prior;
        await withStore("readwrite", (s) => s.delete(prior.id));
        break;
      }
    }
  }
  // Checked as the write is made, in the same transaction: nothing lands once remembering is off.
  const kept = await withStore<boolean>("readwrite", (s) => {
    if (!wanted()) return;
    s.put({ id, name: file.name, size: file.size, type: file.type, opened: Date.now(), page: old?.page ?? 0, pages, data } satisfies Row);
  }).then(() => wanted());
  if (!kept) return null;
  const rows = await all();
  let bytes = 0;
  const drop = rows.filter((r, i) => (bytes += r.size) > MAX_BYTES || i >= MAX_FILES).map((r) => r.id);
  if (drop.length) await withStore("readwrite", (s) => void drop.forEach((d) => s.delete(d)));
  changed();
  return id;
}

export async function rememberPage(file: File, page: number) {
  const id = await docId(file).catch(() => null);
  if (!id) return;
  const row = await withStore<Row>("readonly", (s) => s.get(id));
  if (!row || row.page === page) return;
  await withStore("readwrite", (s) => s.put({ ...row, page }));
  changed();
}

export async function forget(id: string) {
  await withStore("readwrite", (s) => s.delete(id));
  changed();
}

export async function forgetAll() {
  await withStore("readwrite", (s) => s.clear());
  changed();
}
