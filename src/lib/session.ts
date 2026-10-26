"use client";

import { INBOX, fromStored, toStored, type Stored } from "./handoff";
import { withoutSecrets } from "./pdf/password";
import type { ToolId } from "./tools";

// Work in progress on a tool page: its files, its options and an editor's
// changes. A change of language loads a new page, which would lose all of
// it; so the session is kept first (in IndexedDB, on this device) and taken
// up again by the same tool on the page in the new language, or on the page
// left behind if the visitor goes Back. Only in the same tab (each tab keeps
// its own record, so tabs changing language together don't overwrite each
// other), only on those two pages, and only for a while: a tool opened
// afresh starts empty, and a record past its time is deleted. Passwords are
// never kept: they're asked for again.

export type EditorSnapshot = { items: unknown[]; marks: unknown[]; page: number };
type Live = { tool: ToolId; files: File[]; options: Record<string, unknown> };
type Kept = { tool: ToolId; files: Stored[]; options: Record<string, unknown>; editor?: EditorSnapshot; paths: string[]; tab: string; at: number };

// One record per tab: "session:<tab>". ("session" alone was the one shared record before.)
const PREFIX = "session:";
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

// Runs `run` in a transaction; resolves with what its result function gives
// once the transaction has committed, or undefined if it failed.
function store<T>(run: (s: IDBObjectStore) => () => T): Promise<T | undefined> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(undefined);
    const open = indexedDB.open(INBOX.db, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(INBOX.store);
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(INBOX.store, "readwrite");
        const result = run(tx.objectStore(INBOX.store));
        tx.oncomplete = () => {
          db.close();
          resolve(result());
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

// Goes to the page in another language, keeping the work on this one. When
// it can't be kept (storage blocked or full), `stay` is asked whether to go
// anyway; saying no leaves the work where it is.
export async function goToLanguage(href: string, stay?: () => boolean) {
  const now = live?.();
  const id = tab();
  if (now?.files.length) {
    const target = new URL(href, location.href).pathname;
    const kept: Kept = {
      tool: now.tool,
      files: await Promise.all(now.files.map(toStored)),
      options: withoutSecrets(now.options),
      editor: editor?.() ?? undefined,
      paths: [location.pathname, target],
      tab: id,
      at: Date.now(),
    };
    const saved = id ? await store((s) => { const req = s.put(kept, PREFIX + id); return () => req.result; }) : undefined;
    if (saved === undefined && stay && !stay()) return;
  }
  leaving = true;
  location.href = href;
}

// The work kept for this tool on this page, if there is any. Records past
// their time (any tab's) are deleted on the way.
export async function resumeSession(tool: ToolId) {
  const id = tab();
  const kept = await store<Kept | undefined>((s) => {
    const req = s.openCursor();
    let mine: Kept | undefined;
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      const key = String(c.key);
      if (key === "session" || (key.startsWith(PREFIX) && Date.now() - (c.value as Kept).at > KEEP_MS)) c.delete();
      else if (id && key === PREFIX + id) mine = c.value as Kept;
      c.continue();
    };
    return () => mine;
  });
  if (!kept || kept.tool !== tool || !kept.paths.includes(location.pathname)) return null;
  return { files: kept.files.map(fromStored), options: kept.options, editor: kept.editor };
}

// The work was finished or set aside: nothing to bring back (this tab's only).
export const forgetSession = () => {
  const id = tab();
  return id ? store((s) => (s.delete(PREFIX + id), () => true)) : Promise.resolve(undefined);
};
