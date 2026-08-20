// Statutes imported through the UI ("Add a statute") are stored here, in
// the browser's own IndexedDB — not written back to the server. A static
// deploy (Netlify, or any static host) has no writable, persistent
// filesystem for a serverless function to save into, so "importing" a
// statute has to mean "add it to *this browser*", not "add it to the
// site for everyone". The bundled statutes in app/public/data/ (baked in
// by the CLI parser) are the shared/permanent set; this is the personal,
// per-browser layer on top.
const DB_NAME = "statute-explorer";
const DB_VERSION = 1;
const STORE = "statutes";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "slug" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const result = fn(store);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveLocalStatute(slug, statuteDocument) {
  await withStore("readwrite", (store) => {
    store.put({ slug, statuteDocument, savedAt: Date.now() });
  });
}

export async function deleteLocalStatute(slug) {
  await withStore("readwrite", (store) => {
    store.delete(slug);
  });
}

export async function getLocalStatute(slug) {
  const rows = await withStore("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(slug);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
  return rows?.statuteDocument ?? null;
}

/** Manifest-shaped summaries of everything saved locally, for merging into
 * the bundled manifest the picker renders from. */
export async function listLocalManifestEntries() {
  const rows = await withStore("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
  return rows.map(({ slug, statuteDocument: d }) => ({
    slug,
    id: d.id,
    jurisdiction: d.jurisdiction,
    title: d.title,
    citation: d.citation,
    partCount: d.tree.length,
    sectionCount: Object.keys(d.sections).length,
    isLocal: true,
  }));
}
