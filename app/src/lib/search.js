// Client-side search over a single loaded statute — no backend, no search
// service, just an in-memory index built once per statute and re-scored on
// every keystroke (a few thousand short strings, cheap enough not to need
// a real search library or debouncing).
import { runsToPlainText, getPartForSection } from "./statute";

function flattenBlocksToText(blocks) {
  let out = "";
  for (const b of blocks) {
    if (b.runs) out += runsToPlainText(b.runs) + " ";
    if (b.children) out += flattenBlocksToText(b.children) + " ";
  }
  return out;
}

const indexCache = new WeakMap();

/** One entry per section: original-case text for display, lowercased text
 * for matching, kept separate so a highlighted snippet doesn't come out
 * shouting in lowercase. */
function buildIndex(statute) {
  if (indexCache.has(statute)) return indexCache.get(statute);
  const entries = Object.values(statute.sections).map((section) => {
    const part = getPartForSection(statute, section);
    const text = flattenBlocksToText(section.body);
    const terms = section.definesTerms
      .map((id) => statute.definitions[id]?.term)
      .filter(Boolean);
    return {
      id: section.id,
      number: section.number,
      marginalNote: section.marginalNote ?? "",
      partTitle: part?.title ?? "",
      text,
      textLower: text.toLowerCase(),
      noteLower: (section.marginalNote ?? "").toLowerCase(),
      terms,
      termsLower: terms.map((t) => t.toLowerCase()),
    };
  });
  indexCache.set(statute, entries);
  return entries;
}

function snippetAround(entry, tokens) {
  const idx = tokens
    .map((t) => entry.textLower.indexOf(t))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  if (idx === undefined) return entry.text.slice(0, 140).trim();
  const start = Math.max(0, idx - 50);
  const end = Math.min(entry.text.length, idx + 90);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < entry.text.length ? "…" : "";
  return prefix + entry.text.slice(start, end).trim() + suffix;
}

const MAX_RESULTS = 40;

/** @returns {{ id, number, marginalNote, partTitle, snippet }[]} */
export function searchStatute(statute, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const index = buildIndex(statute);

  const scored = [];
  for (const entry of index) {
    let score = 0;
    let allTokensMatch = true;
    for (const t of tokens) {
      const inNumber = entry.number.toLowerCase() === t;
      const numberPrefix = entry.number.toLowerCase().startsWith(t);
      const inNote = entry.noteLower.includes(t);
      const inTerms = entry.termsLower.some((term) => term.includes(t));
      const inText = entry.textLower.includes(t);
      if (!inNumber && !numberPrefix && !inNote && !inTerms && !inText) {
        allTokensMatch = false;
        break;
      }
      if (inNumber) score += 200;
      else if (numberPrefix) score += 40;
      if (inNote) score += 25;
      if (inTerms) score += 8;
      if (inText) score += 1;
    }
    if (allTokensMatch) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_RESULTS).map(({ entry }) => ({
    id: entry.id,
    number: entry.number,
    marginalNote: entry.marginalNote,
    partTitle: entry.partTitle,
    snippet: snippetAround(entry, tokens),
  }));
}
