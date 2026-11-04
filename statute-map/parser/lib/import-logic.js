// Used by the in-browser parse worker (src/library/parse.worker.js): given a
// URL or a file's raw content, figure out which adapter it needs and parse it.
// Nothing here touches the network or the filesystem. The Ontario and Charter
// parsers pull in cheerio, so they're only imported when one is needed.
import { parseFederalXml } from "./parse-federal.js";

export function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Figures out which adapter a pasted URL needs and what identifier to feed
 * it, from the URL shape alone. */
export function detectFromUrl(url) {
  const federalMatch = url.match(
    /laws-lois\.justice\.gc\.ca\/(?:eng|fra)\/(?:acts|regulations|XML|lois|reglements)\/([^/?#]+?)(?:\.xml)?(?:[/?#]|$)/i,
  );
  if (federalMatch) return { jurisdiction: "federal", identifier: federalMatch[1] };
  const ontarioMatch = url.match(/ontario\.ca\/laws\/statute\/([^/#?]+)/i);
  if (ontarioMatch) return { jurisdiction: "ontario", identifier: ontarioMatch[1] };
  return null;
}

/** Figures out which adapter an uploaded file's own content needs. No
 * filename convention required, since both formats self-identify. */
export function detectFromContent(content) {
  const trimmed = content.trim();
  if (trimmed.includes('class="wb-txthl"')) return "charter";
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<Statute") || trimmed.startsWith("<Regulation")) {
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

/** @returns {Promise<{slug: string, statuteDocument: object}>} */
export async function parseContent(content, { code, sourceUrl } = {}) {
  const kind = detectFromContent(content);
  if (!kind) {
    throw new Error(
      "That isn't federal Justice Laws XML or an Ontario e-Laws JSON export, so it can't be read.",
    );
  }
  if (kind === "federal") {
    const { statuteDocument } = parseFederalXml(content, { code });
    return { slug: slugify(statuteDocument.id), statuteDocument };
  }
  if (kind === "charter") {
    const { parseCharterHtml } = await import("./parse-charter.js");
    return { slug: "charter", statuteDocument: parseCharterHtml(content, sourceUrl).statuteDocument };
  }
  const { parseOntarioJson } = await import("./parse-ontario-doc.js");
  const { statuteDocument } = parseOntarioJson(content);
  return { slug: `on-${slugify(statuteDocument.id)}`, statuteDocument };
}
