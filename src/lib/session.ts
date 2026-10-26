"use client";

import { INBOX, fromStored, toStored, type Stored } from "./handoff";
import type { ToolId } from "./tools";

// Work in progress on a tool page: its files, its options and an editor's
// changes. A change of language loads a new page, which would lose all of
// it; so the session is kept first (in IndexedDB, on this device) and taken
// up again by the same tool on the page in the new language, or on the page
// left behind if the visitor goes Back. Only in the same tab, only on those
// two pages, and only for a while: a tool opened afresh starts empty.

export type EditorSnapshot = { items: unknown[]; marks: unknown[]; page: number };
type Live = { tool: ToolId; files: File[]; options: Record<string, unknown> };
type Kept = { tool: ToolId; files: Stored[]; options: Record<string, unknown>; editor?: EditorSnapshot; paths: string[]; tab: string; at: number };

const KEY = "session";
const KEEP_MS = 30 * 60 * 1000;

let live: (() => Live | null) | null = null;
let editor: (() => EditorSnapshot | null) | null = null;
let leaving = false;

// The tool page says what it holds; the editor what it has changed.
export const setSessionSource = (fn: (() => Live | null) | null) => void (live = fn);
export const setEditorSource = (fn: (() => EditorSnapshot | null) | null) => void (editor = fn);

// Unsaved changes in the editor: closing the tab or leaving asks first.
export function hasUnsavedEdits() {
  const e = editor?.();
  return !!e && (e.items.length > 0 || e.marks.length > 0);
}
// Anything open on this page that a reload would lose.
export const hasOpenWork = () => !!live?.()?.files.length || hasUnsavedEdits();
if (typeof window !== "undefined") {
  addEventListener("beforeunload", (e) => {
    if (leaving || !hasUnsavedEdits()) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

function tab() {
  try {
    let id = sessionStorage.getItem("nopload:tab");
    if (!id) sessionStorage.setItem("nopload:tab", (id = crypto.randomUUID()));
    return id;
  } catch {
    return "";
  }
}

function store<T>(run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(undefined);
    const open = indexedDB.open(INBOX.db, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(INBOX.store);
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(INBOX.store, "readwrite");
        const req = run(tx.objectStore(INBOX.store));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
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

// Goes to the page in another language, keeping the work on this one.
export async function goToLanguage(href: string) {
  const now = live?.();
  if (now?.files.length) {
    const target = new URL(href, location.href).pathname;
    const kept: Kept = {
      tool: now.tool,
      files: await Promise.all(now.files.map(toStored)),
      options: now.options,
      editor: editor?.() ?? undefined,
      paths: [location.pathname, target],
      tab: tab(),
      at: Date.now(),
    };
    await store((s) => s.put(kept, KEY));
  }
  leaving = true;
  location.href = href;
}

// The work kept for this tool on this page, if there is any.
export async function resumeSession(tool: ToolId) {
  const kept = await store<Kept | undefined>((s) => s.get(KEY));
  if (!kept || kept.tool !== tool || kept.tab !== tab() || Date.now() - kept.at > KEEP_MS || !kept.paths.includes(location.pathname)) return null;
  return { files: kept.files.map(fromStored), options: kept.options, editor: kept.editor };
}

// The work was finished or set aside: nothing to bring back.
export const forgetSession = () => store((s) => s.delete(KEY));
