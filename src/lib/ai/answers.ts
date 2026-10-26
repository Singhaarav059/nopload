// Answers from the cloud AI, kept on this device (IndexedDB) for a week: the
// same question about the same PDF, or the same summary or translation,
// comes back at once with no request at all. The key is a SHA-256 hash of
// the request with its question tidied (case, spaces, the final "?"), and
// the request carries the passages of the PDF it's about, so the hash stands
// for the PDF and the question together. At most 300 answers; the oldest go.
// Anything that fails here (private browsing, no IndexedDB) just means no
// cache.

const DB = "nopload-answers";
const STORE = "answers";
const WEEK = 7 * 86_400_000;
const MAX = 300;

type Kept = { key: string; value: string; provider: string; at: number };

let opened: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("at", "at");
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  }).catch((e) => {
    opened = null;
    throw e;
  });
  return opened;
}

const done = <T>(req: IDBRequest<T>) => new Promise<T>((ok, fail) => ((req.onsuccess = () => ok(req.result)), (req.onerror = () => fail(req.error))));

// The question as the key sees it: "What is the TOTAL?  " and "what is the total" are one.
export const tidy = (q: string) => q.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s?？!.。]+$/u, "");

// A question of more than five words stands on its own: its answer doesn't
// depend on the turns before it, which are left out of its key, so it's found
// again later in the same chat too. A short one ("and the smallest?") keeps them.
export async function answerKey(body: Record<string, unknown>): Promise<string> {
  const q = typeof body.question === "string" ? tidy(body.question) : null;
  const keyed = q === null ? body : { ...body, question: q, history: q.split(" ").length > 5 ? [] : body.history };
  const bytes = new TextEncoder().encode(JSON.stringify(keyed));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function keptAnswer(key: string): Promise<{ value: string; provider: string } | null> {
  try {
    const kept = await done((await db()).transaction(STORE).objectStore(STORE).get(key) as IDBRequest<Kept | undefined>);
    return kept && Date.now() - kept.at < WEEK ? { value: kept.value, provider: kept.provider } : null;
  } catch {
    return null;
  }
}

export async function keepAnswer(key: string, value: string, provider: string) {
  try {
    const store = (await db()).transaction(STORE, "readwrite").objectStore(STORE);
    await done(store.put({ key, value, provider, at: Date.now() } satisfies Kept));
    // Past the limit, the oldest go.
    const count = await done(store.count());
    if (count <= MAX) return;
    let extra = count - MAX;
    const cursor = store.index("at").openCursor();
    await new Promise<void>((ok, fail) => {
      cursor.onerror = () => fail(cursor.error);
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || extra-- <= 0) return ok();
        c.delete();
        c.continue();
      };
    });
  } catch {
    /* no cache, then */
  }
}
