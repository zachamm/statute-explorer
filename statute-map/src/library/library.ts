/**
 * The one place a statute gets loaded from, for both the reader and the map.
 * The app ships no statute text: it's downloaded from its government source
 * the first time it's asked for, parsed here in the browser, and kept in this
 * browser's IndexedDB so it's instant (and offline) from then on.
 */
import { deleteCachedStatuteSource, getCachedStatuteSource, getOrFetchStatuteSource, setCachedStatuteSource } from "../db/statuteCache";
import { findStatuteByCode, registerCatalogActs, xmlUrlForCode, type StatuteSourceType } from "../statute/lookup";
import { detectFromUrl } from "../../parser/lib/import-logic.js";
import { buildEntries, findEntry, slugForCode, type CatalogEntry, type CatalogRow, type SavedRow } from "./catalog";
import { clearUpdateCheck, parseAmendedDate } from "./updates";
import { deleteLocalStatute, getLocalStatute, listLocalManifestEntries, saveLocalStatute } from "./localStatutes";

type Progress = (message: string) => void;

/** Fired when a saved copy is dropped, so a map showing it can reload. */
export const STATUTE_REMOVED_EVENT = "statute-map:statute-removed";

async function fetchJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${what} (${res.status}).`);
  return res.json() as Promise<T>;
}

let catalog: Promise<CatalogEntry[]> | null = null;

export function getCatalog(): Promise<CatalogEntry[]> {
  catalog ??= (async () => {
    const [rows, saved] = await Promise.all([
      fetchJson<CatalogRow[]>("/data/catalog.json", "the statute catalogue"),
      listLocalManifestEntries().catch(() => [] as SavedRow[]),
    ]);
    const entries = buildEntries(rows, saved);
    registerCatalogActs(entries.filter((e) => e.kind === "act" && e.jurisdiction === "federal"));
    return entries;
  })();
  return catalog;
}

async function refreshCatalog(): Promise<CatalogEntry[]> {
  catalog = null;
  return getCatalog();
}

function parseInWorker(content: string, code?: string, sourceUrl?: string): Promise<{ slug: string; statuteDocument: any }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./parse.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.ok) resolve(data);
      else reject(new Error(data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "The statute couldn't be parsed."));
    };
    worker.postMessage({ content, code, sourceUrl });
  });
}

async function downloadOntario(alias: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api/ontario/${encodeURIComponent(alias)}`);
  } catch {
    throw new Error("Couldn't reach the Ontario e-Laws service. Check your connection and try again.");
  }
  const type = res.headers.get("content-type") ?? "";
  if (res.status === 404 && !type.includes("json")) {
    throw new Error("Opening Ontario statutes needs the app's local server (npm run dev), because e-Laws doesn't allow direct browser requests. Federal statutes work anywhere.");
  }
  if (!res.ok) throw new Error(`Ontario e-Laws has no statute "${alias}" (${res.status}). Check the link.`);
  return res.text();
}

/** Federal XML and the Charter's HTML go through the raw-source cache the map
 *  also reads from, so opening one in either view spares the other a download. */
async function downloadFederal(entry: CatalogEntry): Promise<{ content: string; sourceUrl: string }> {
  const known = findStatuteByCode(entry.code);
  const sourceType = entry.code === "CHARTER" ? "html" : "xml";
  const url = known?.url ?? xmlUrlForCode(entry.code);
  const { content, sourceUrl } = await getOrFetchStatuteSource(entry.code, sourceType, url);
  return { content, sourceUrl };
}

/** Loads a statute for reading, downloading it first if it isn't here yet. */
export async function loadDocument(entry: CatalogEntry, onProgress: Progress = () => {}): Promise<any> {
  const saved = await getLocalStatute(entry.slug).catch(() => null);
  if (saved) return saved;

  const source = entry.jurisdiction === "ontario" ? "Ontario e-Laws" : "Justice Laws";
  onProgress(`Downloading ${entry.title} from ${source}…`);
  const { content, sourceUrl } =
    entry.jurisdiction === "ontario"
      ? { content: await downloadOntario(entry.code), sourceUrl: undefined }
      : await downloadFederal(entry);

  onProgress(`Reading ${entry.title}…`);
  const { statuteDocument } = await parseInWorker(content, entry.code, sourceUrl);
  await saveLocalStatute(entry.slug, statuteDocument);
  await refreshCatalog();
  return statuteDocument;
}

export interface MapSource {
  code: string;
  label: string;
  sourceType: StatuteSourceType;
  url: string;
}

/** Works out where the map should get a statute's source from. */
export async function prepareMapSource(entry: CatalogEntry, onProgress: Progress = () => {}): Promise<MapSource> {
  const base = { code: entry.code, label: entry.title };
  if (entry.jurisdiction === "federal") {
    const cached = await getCachedStatuteSource(entry.code);
    if (cached) return { ...base, sourceType: cached.sourceType, url: cached.sourceUrl };
    const known = findStatuteByCode(entry.code);
    return { ...base, sourceType: known?.sourceType ?? "xml", url: known?.url ?? xmlUrlForCode(entry.code) };
  }

  // No XML exists for these, so the parsed document is what gets cached.
  if (!(await getCachedStatuteSource(entry.code))) {
    const doc = await loadDocument(entry, onProgress);
    await setCachedStatuteSource({
      code: entry.code,
      sourceType: "document",
      content: JSON.stringify(doc),
      sourceUrl: doc.sourceUrl,
      fetchedAt: new Date().toISOString(),
    });
  }
  return { ...base, sourceType: "document", url: "" };
}

/** Handles a pasted government link. Returns the catalogue entry to open. */
export async function resolveLink(url: string): Promise<CatalogEntry> {
  const detected = detectFromUrl(url);
  if (!detected) {
    throw new Error("That isn't a statute link from laws-lois.justice.gc.ca or ontario.ca/laws.");
  }
  const entries = await getCatalog();
  const slug = detected.jurisdiction === "ontario" ? `on-${slugForCode(detected.identifier)}` : slugForCode(detected.identifier);
  const known = findEntry(entries, slug);
  if (known) return known;
  return {
    code: detected.identifier,
    slug,
    title: detected.jurisdiction === "ontario" ? `Ontario statute ${detected.identifier}` : detected.identifier,
    jurisdiction: detected.jurisdiction,
    kind: "act",
    citation: null,
    currentTo: null,
    sectionCount: null,
    regulations: [],
    enablingActs: [],
    saved: false,
  };
}

/** Reads an uploaded XML or Ontario JSON file into the library. */
export async function addUploadedFile(file: File): Promise<CatalogEntry> {
  const content = await file.text();
  const { slug, statuteDocument } = await parseInWorker(content);
  await saveLocalStatute(slug, statuteDocument);
  if (statuteDocument.jurisdiction === "federal") {
    await setCachedStatuteSource({
      code: statuteDocument.id,
      sourceType: "xml",
      content,
      sourceUrl: xmlUrlForCode(statuteDocument.id),
      fetchedAt: new Date().toISOString(),
    });
  }
  const entry = findEntry(await refreshCatalog(), slug);
  if (!entry) throw new Error("The file was read but couldn't be added to the library.");
  return entry;
}

/** Whichever date a statute's stored source says it was last amended, for
 *  statutes the map has but the reader may never have opened. */
export async function localAmendedDate(code: string): Promise<string | null> {
  const cached = await getCachedStatuteSource(code);
  if (!cached) return null;
  return cached.sourceType === "document"
    ? (/"consolidatedDate":"([\d-]+)"/.exec(cached.content)?.[1] ?? null)
    : parseAmendedDate(cached.content);
}

/** Forgets a downloaded statute, so the next open fetches the current text. */
export async function removeSaved(entry: CatalogEntry): Promise<CatalogEntry[]> {
  await deleteLocalStatute(entry.slug);
  await deleteCachedStatuteSource(entry.code);
  clearUpdateCheck(entry.code);
  const entries = await refreshCatalog();
  window.dispatchEvent(new CustomEvent(STATUTE_REMOVED_EVENT, { detail: { code: entry.code } }));
  return entries;
}
