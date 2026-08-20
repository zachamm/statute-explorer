// Shared by the dev-server plugin (parser/dev-server-plugin.js) and the
// Netlify Function (netlify/functions/import.js) — both need the exact
// same "given a URL or a file's raw content, figure out which adapter it
// needs and parse it" logic, so a statute imported in dev behaves
// identically to one imported on the deployed site. Unlike parse.js /
// parse-ontario.js (the CLI), nothing here touches the filesystem: a
// serverless function has no persistent disk to write to, so import
// results are handed back to the caller to deal with (the browser saves
// them to IndexedDB — see app/src/lib/localStatutes.js).
import { parseFederalXml } from "./parse-federal.js";
import { parseOntarioJson } from "./parse-ontario-doc.js";

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Figures out which adapter a pasted URL needs and what identifier to feed
 * it, from the URL shape alone — no fetching yet. */
export function detectFromUrl(url) {
  const federalMatch = url.match(
    /laws-lois\.justice\.gc\.ca\/eng\/(?:acts|XML)\/([^/]+?)(?:\.xml)?(?:\/|$)/i,
  );
  if (federalMatch) return { jurisdiction: "federal", identifier: federalMatch[1] };
  const ontarioMatch = url.match(/ontario\.ca\/laws\/statute\/([^/#?]+)/i);
  if (ontarioMatch) return { jurisdiction: "ontario", identifier: ontarioMatch[1] };
  return null;
}

/** Figures out which adapter an uploaded file's own content needs — no
 * filename convention required, since both formats self-identify. */
export function detectFromContent(content) {
  const trimmed = content.trim();
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<Statute")) {
    return "federal";
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.content && parsed.alias) return "ontario";
  } catch {
    // not JSON either
  }
  return null;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; statute-anatomy-explorer/1.0)",
      Accept: "application/json, text/xml, */*",
    },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function parseFederal(xmlText) {
  const { statuteDocument } = parseFederalXml(xmlText);
  return { slug: slugify(statuteDocument.id), statuteDocument };
}

function parseOntario(jsonText) {
  const { statuteDocument } = parseOntarioJson(jsonText);
  return { slug: `on-${slugify(statuteDocument.id)}`, statuteDocument };
}

/** @returns {Promise<{slug: string, statuteDocument: object}>} */
export async function importFromUrl(url) {
  const detected = detectFromUrl(url);
  if (!detected) {
    throw new Error(
      "That URL doesn't look like a laws-lois.justice.gc.ca or ontario.ca/laws statute page. See the Docs tab for the URL formats that work.",
    );
  }
  if (detected.jurisdiction === "federal") {
    const xmlUrl = `https://laws-lois.justice.gc.ca/eng/XML/${detected.identifier}.xml`;
    const xmlText = await fetchText(xmlUrl);
    if (!xmlText.includes("<Statute")) {
      throw new Error(
        `${xmlUrl} didn't return a Statute XML document — check the chapter code in the URL.`,
      );
    }
    return parseFederal(xmlText);
  }
  const apiUrl = `https://www.ontario.ca/laws/api/v2/legislation/en/doc-search/statute/${detected.identifier}`;
  const jsonText = await fetchText(apiUrl);
  return parseOntario(jsonText);
}

/** @returns {Promise<{slug: string, statuteDocument: object}>} */
export async function importFromFileContent(content) {
  const kind = detectFromContent(content);
  if (!kind) {
    throw new Error(
      "Couldn't recognize that file as federal Justice Laws XML or an Ontario e-Laws JSON export. See the Docs tab for what's expected.",
    );
  }
  return kind === "federal" ? parseFederal(content) : parseOntario(content);
}
