/**
 * The catalogue of legislation the app can open: an index of titles and codes
 * (public/data/catalog.json), plus whatever this browser has saved. The index
 * holds no statute text. Pure functions only, so ranking is testable without a
 * browser; library.ts does the loading.
 */

export type Jurisdiction = "federal" | "ontario";
export type InstrumentKind = "act" | "regulation";

export interface CatalogEntry {
  /** The id used by Justice Laws and by the map, e.g. "C-46", "SOR-2002-227", "90h08". */
  code: string;
  /** The filename-safe id used by the reader and in URLs, e.g. "c-46", "on-90h08". */
  slug: string;
  title: string;
  jurisdiction: Jurisdiction;
  kind: InstrumentKind;
  citation: string | null;
  /** Date the source says its text is current to. */
  currentTo: string | null;
  sectionCount: number | null;
  /** For an Act, the codes of the regulations made under it. */
  regulations: string[];
  /** For a regulation, the codes of the Acts it's made under. */
  enablingActs: string[];
  /** This browser has a copy from an earlier download or upload, so it opens
   *  instantly and works offline. */
  saved: boolean;
}

export interface CatalogRow {
  c: string;
  t: string;
  k: "a" | "r";
  d: string;
  j?: "on";
  n?: string;
  g?: string[];
}

export interface SavedRow {
  slug: string;
  id: string;
  jurisdiction: string;
  title: string;
  citation?: string;
  consolidatedDate?: string | null;
  sectionCount?: number;
}

export function slugForCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function buildEntries(rows: CatalogRow[], saved: SavedRow[]): CatalogEntry[] {
  const bySlug = new Map<string, CatalogEntry>();

  for (const row of rows) {
    const slug = row.j === "on" ? `on-${slugForCode(row.c)}` : slugForCode(row.c);
    bySlug.set(slug, {
      code: row.c,
      slug,
      title: row.t,
      jurisdiction: row.j === "on" ? "ontario" : "federal",
      kind: row.k === "r" ? "regulation" : "act",
      citation: row.n ?? null,
      currentTo: row.d || null,
      sectionCount: null,
      regulations: row.g ?? [],
      enablingActs: [],
      saved: false,
    });
  }

  const byCode = new Map([...bySlug.values()].map((entry) => [entry.code, entry]));
  for (const row of rows) {
    for (const code of row.g ?? []) byCode.get(code)?.enablingActs.push(row.c);
  }

  for (const row of saved) {
    const existing = bySlug.get(row.slug);
    bySlug.set(row.slug, {
      code: row.id,
      slug: row.slug,
      title: row.title,
      jurisdiction: row.jurisdiction === "ontario" ? "ontario" : "federal",
      kind: existing?.kind ?? "act",
      citation: row.citation ?? existing?.citation ?? null,
      currentTo: row.consolidatedDate ?? existing?.currentTo ?? null,
      sectionCount: row.sectionCount ?? null,
      regulations: existing?.regulations ?? [],
      enablingActs: existing?.enablingActs ?? [],
      saved: true,
    });
  }

  return [...bySlug.values()];
}

const MINOR_WORDS = new Set(["a", "an", "and", "the", "of", "to", "for", "in", "on", "respecting", "concerning"]);

/** "Controlled Drugs and Substances Act" -> "cdsa". Lawyers refer to most Acts
 *  this way, and it costs nothing to compute instead of keeping a table. */
export function acronym(title: string): string {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !MINOR_WORDS.has(word) && !/^\d/.test(word))
    .map((word) => word[0])
    .join("");
}

// Common short names an initialism can't produce.
const ALIASES: Record<string, string> = {
  charter: "charter",
  pipeda: "p-8-6",
  ita: "i-3-3",
  ccc: "c-46",
  cc: "c-46",
};

/** What the library suggests before anyone has searched for anything. */
export const STARTING_POINTS = ["C-46", "CHARTER", "C-5", "I-21", "C-38.8", "Y-1.5", "D-3.4", "C-44", "90h19", "06r17", "00e41", "90s01"];

function scoreEntry(entry: CatalogEntry, query: string, tokens: string[]): number {
  const title = entry.title.toLowerCase();
  const code = entry.code.toLowerCase();
  const words = title.split(/[^a-z0-9]+/);
  let score = 0;

  if (code === query) score = 1000;
  else if (ALIASES[query] === entry.slug) score = 950;
  else if (title === query) score = 900;
  else if (title.startsWith(query)) score = 700;
  else if (acronym(entry.title) === query) score = 650;
  else if (code.startsWith(query)) score = 600;
  else if (title.includes(query)) score = 500;
  else if (tokens.every((token) => words.some((word) => word.startsWith(token)))) score = 400;
  else if (tokens.every((token) => title.includes(token))) score = 300;
  else return 0;

  // Between equally good matches, the things people actually mean come first.
  if (entry.saved) score += 30;
  if (entry.kind === "act") score += 20;
  return score - Math.min(title.length, 150) / 15;
}

export function searchCatalog(entries: CatalogEntry[], rawQuery: string, limit = 40): CatalogEntry[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const tokens = query.split(/\s+/);
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, query, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .slice(0, limit)
    .map(({ entry }) => entry);
}

/** A statute named by a link or a project, by whichever id it happens to use. */
export function findEntry(entries: CatalogEntry[], ref: string | null | undefined): CatalogEntry | null {
  if (!ref) return null;
  const lower = ref.toLowerCase();
  const slug = slugForCode(ref);
  return (
    entries.find((e) => e.slug === lower || e.code.toLowerCase() === lower) ??
    entries.find((e) => e.slug === slug) ??
    null
  );
}

export function describeEntry(entry: CatalogEntry): string {
  const where = entry.jurisdiction === "ontario" ? "Ontario" : "Federal";
  const what = entry.kind === "regulation" ? "regulation" : "Act";
  return `${where} ${what}`;
}
