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

export const idOf = (f: { name: string; size: number }) => `${f.name}:${f.size}`;

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
export async function remember(file: File, pages: number) {
  // Asks the browser not to clear the library when space runs low (granted
  // to installed apps; elsewhere a no-op).
  void navigator.storage?.persist?.().catch(() => {});
  const id = idOf(file);
  const old = await withStore<Row>("readonly", (s) => s.get(id));
  const data = await file.arrayBuffer().catch(() => null);
  if (!data) return;
  await withStore("readwrite", (s) => s.put({ id, name: file.name, size: file.size, type: file.type, opened: Date.now(), page: old?.page ?? 0, pages, data } satisfies Row));
  const rows = await all();
  let bytes = 0;
  const drop = rows.filter((r, i) => (bytes += r.size) > MAX_BYTES || i >= MAX_FILES).map((r) => r.id);
  if (drop.length) await withStore("readwrite", (s) => void drop.forEach((d) => s.delete(d)));
  changed();
}

export async function rememberPage(file: { name: string; size: number }, page: number) {
  const row = await withStore<Row>("readonly", (s) => s.get(idOf(file)));
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
