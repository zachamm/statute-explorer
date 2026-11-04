/**
 * Thin promise-based wrapper around the two IndexedDB object stores this
 * app needs. Deliberately minimal — no ORM, no third-party IndexedDB
 * library — just enough get/getAll/put/delete to build the Projects
 * layer on top of.
 */

const DB_NAME = "statute-map";
const DB_VERSION = 1;

export const STATUTE_CACHE_STORE = "statuteCache";
export const PROJECTS_STORE = "projects";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATUTE_CACHE_STORE)) {
        db.createObjectStore(STATUTE_CACHE_STORE, { keyPath: "code" });
      }
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });

  return dbPromise;
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

export async function idbPut<T>(store: string, value: T): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Test-only: wipes the database and forgets the cached connection, so
 *  each test starts from a clean slate rather than seeing data left over
 *  by an earlier test in the same file (fake-indexeddb's global instance
 *  otherwise persists for the file's whole run). */
export async function _resetDatabaseForTests(): Promise<void> {
  const existing = dbPromise;
  dbPromise = null;
  (await existing)?.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve(); // best-effort in a test environment
  });
}
