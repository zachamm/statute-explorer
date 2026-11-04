/**
 * A small local lookup table mapping common federal Act names (and a
 * couple of constitutional documents) to where their text can be
 * fetched from, so a statute can be loaded by search instead of by
 * pasting a URL. This is intentionally tiny for now — step 4
 * (cross-statute reference detection) leans on a table like this
 * heavily, and it can grow as needed.
 *
 * Most entries are `sourceType: "xml"` — Justice Laws' per-Act XML
 * endpoint. A few real documents (the Constitution Acts, including the
 * Charter) predate that numbering system entirely and only exist as
 * HTML on Justice Laws — those are `sourceType: "html"` and carry an
 * explicit `url` rather than one derived from `xmlUrlForCode`.
 */

/** "document" is an already-parsed StatuteDocument stored as JSON: how
 *  anything with no XML source reaches the map (Ontario statutes). */
export type StatuteSourceType = "xml" | "html" | "document";

export interface StatuteLookupEntry {
  name: string;
  code: string;
  aliases: string[];
  sourceType: StatuteSourceType;
  /** Where to fetch this statute's source from. Self-contained on every
   *  entry (even "xml" ones, where it's just xmlUrlForCode(code)) so
   *  callers never need to branch on sourceType just to find a URL. */
  url: string;
}

const XML_BASE = "https://laws-lois.justice.gc.ca/eng/XML";

export function xmlUrlForCode(code: string): string {
  return `${XML_BASE}/${code}.xml`;
}

export const STATUTE_LOOKUP: StatuteLookupEntry[] = [
  { name: "Criminal Code", code: "C-46", aliases: ["criminal code", "cc"], sourceType: "xml", url: xmlUrlForCode("C-46") },
  {
    name: "Interpretation Act",
    code: "I-21",
    aliases: ["interpretation act"],
    sourceType: "xml",
    url: xmlUrlForCode("I-21"),
  },
  {
    name: "Canada Evidence Act",
    code: "C-5",
    aliases: ["canada evidence act", "evidence act"],
    sourceType: "xml",
    url: xmlUrlForCode("C-5"),
  },
  {
    name: "Controlled Drugs and Substances Act",
    code: "C-38.8",
    aliases: ["controlled drugs and substances act", "cdsa"],
    sourceType: "xml",
    url: xmlUrlForCode("C-38.8"),
  },
  {
    name: "Youth Criminal Justice Act",
    code: "Y-1.5",
    aliases: ["youth criminal justice act", "ycja"],
    sourceType: "xml",
    url: xmlUrlForCode("Y-1.5"),
  },
  {
    name: "Firearms Act",
    code: "F-11.6",
    aliases: ["firearms act"],
    sourceType: "xml",
    url: xmlUrlForCode("F-11.6"),
  },
  {
    name: "Canadian Charter of Rights and Freedoms",
    code: "CHARTER",
    aliases: ["charter", "canadian charter of rights and freedoms", "charter of rights", "charter of rights and freedoms"],
    sourceType: "html",
    url: "https://laws-lois.justice.gc.ca/eng/Const/page-12.html",
  },
];

// Every other federal Act, registered from the catalogue index at startup
// (see registerCatalogActs). Kept apart from the curated table above because
// it only ever matches a name exactly: with ~1,000 titles, the substring
// matching the curated table allows would resolve a stray phrase to some
// unrelated Act and draw a wrong edge in the graph.
let catalogActs: StatuteLookupEntry[] = [];

export function registerCatalogActs(acts: Array<{ code: string; title: string }>): void {
  catalogActs = acts.map(({ code, title }) => ({
    name: title,
    code,
    aliases: [],
    sourceType: "xml",
    url: xmlUrlForCode(code),
  }));
}

/** Pulls the statute code out of a Justice Laws XML URL, e.g.
 *  "https://laws-lois.justice.gc.ca/eng/XML/C-46.xml" -> "C-46". Returns
 *  null for anything that doesn't match that URL shape. */
export function extractStatuteCodeFromUrl(url: string): string | null {
  const m = /\/XML\/([^/]+)\.xml(?:[?#].*)?$/i.exec(url.trim());
  return m ? m[1] : null;
}

export function findStatuteByName(query: string): StatuteLookupEntry | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    STATUTE_LOOKUP.find((entry) => entry.aliases.includes(q) || entry.name.toLowerCase() === q) ??
    catalogActs.find((entry) => entry.name.toLowerCase() === q) ??
    STATUTE_LOOKUP.find((entry) => entry.name.toLowerCase().includes(q)) ??
    null
  );
}

export function findStatuteByCode(code: string): StatuteLookupEntry | null {
  return STATUTE_LOOKUP.find((entry) => entry.code === code) ?? catalogActs.find((entry) => entry.code === code) ?? null;
}
