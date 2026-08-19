// Pure helpers over a statute document (see docs/SCHEMA.md). Every function
// takes the statute explicitly rather than importing a bundled singleton,
// since the app can load any of several parsed statutes at runtime.

export async function fetchManifest() {
  const res = await fetch("/data/manifest.json");
  if (!res.ok) throw new Error(`Failed to load statute manifest (${res.status})`);
  return res.json();
}

export async function fetchStatute(slug) {
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
