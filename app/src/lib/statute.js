// Pure helpers over a statute document (see docs/SCHEMA.md). Every function
// takes the statute explicitly rather than importing a bundled singleton,
// since the app can load any of several parsed statutes at runtime.
import { getLocalStatute, listLocalManifestEntries } from "./localStatutes";

/** The bundled manifest (statutes baked into the deploy by the CLI parser)
 * merged with anything imported through the UI and saved in this browser's
 * IndexedDB (see localStatutes.js) — bundled entries win on slug collision. */
export async function fetchManifest() {
  const res = await fetch("/data/manifest.json");
  if (!res.ok) throw new Error(`Failed to load statute manifest (${res.status})`);
  const bundled = await res.json();
  const local = await listLocalManifestEntries().catch(() => []);
  const bundledSlugs = new Set(bundled.map((m) => m.slug));
  return [...bundled, ...local.filter((m) => !bundledSlugs.has(m.slug))];
}

export async function fetchStatute(slug) {
  const local = await getLocalStatute(slug).catch(() => null);
  if (local) return local;
  const res = await fetch(`/data/${slug}.json`);
  if (!res.ok) throw new Error(`Failed to load statute "${slug}" (${res.status})`);
  return res.json();
}

export function getPartForSection(statute, section) {
  return statute.tree.find((p) => p.id === section.partId);
}

export function getDivisionForSection(statute, section) {
  const part = getPartForSection(statute, section);
  return part?.divisions.find((d) => d.id === section.divisionId);
}

export function runsToPlainText(runs) {
  return runs
    .map((r) => r.value)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function getNeighborSections(statute, sectionId) {
  const idx = statute.crossRefIndex[sectionId] ?? {
    outgoing: [],
    incoming: [],
  };
  return {
    outgoing: [...new Set(idx.outgoing)],
    incoming: [...new Set(idx.incoming)],
  };
}

const orderedIdsCache = new WeakMap();
export function orderedSectionIds(statute) {
  if (orderedIdsCache.has(statute)) return orderedIdsCache.get(statute);
  const ids = [];
  for (const part of statute.tree) {
    for (const div of part.divisions) {
      ids.push(...div.sectionIds);
    }
  }
  orderedIdsCache.set(statute, ids);
  return ids;
}
