// Statutes downloaded or uploaded in this browser, as parsed StatuteDocuments.
// The app itself ships no statute text; this is the
// private copy that makes reopening instant. Nothing is ever sent anywhere.
const DB_NAME = "statute-explorer";
const DB_VERSION = 1;
const STORE = "statutes";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "slug" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveLocalStatute(slug: string, statuteDocument: unknown): Promise<void> {
  await withStore("readwrite", (store) => store.put({ slug, statuteDocument, savedAt: Date.now() }));
}

export async function deleteLocalStatute(slug: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(slug));
}

export async function getLocalStatute(slug: string): Promise<any | null> {
  const row = await withStore<{ statuteDocument: unknown } | undefined>("readonly", (store) => store.get(slug));
  return row?.statuteDocument ?? null;
}

/** Manifest-shaped summaries of everything saved here. */
export async function listLocalManifestEntries(): Promise<any[]> {
  const rows = await withStore<Array<{ slug: string; statuteDocument: any }>>("readonly", (store) => store.getAll());
  return rows.map(({ slug, statuteDocument: d }) => ({
    slug,
    id: d.id,
    jurisdiction: d.jurisdiction,
    title: d.title,
    citation: d.citation,
    consolidatedDate: d.consolidatedDate,
    partCount: d.tree.length,
    sectionCount: Object.keys(d.sections).length,
  }));
}
