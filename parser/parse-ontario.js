// CLI entry point for Ontario statutes. The actual parsing lives in
// lib/parse-ontario-doc.js (a pure function) so the dev-server import API
// can call it directly too — see ../docs/SCHEMA.md for the output shape
// and ../README.md for the two ways to import a statute, and for why
// Ontario's source needs a heuristic HTML-by-CSS-class walk rather than a
// schema-driven one the way the federal parser gets to do.
//
// Usage: node parse-ontario.js <alias>
//   e.g. node parse-ontario.js 90h08   (Highway Traffic Act, R.S.O. 1990, c. H.8)
//
// The alias is the path segment from the statute's ontario.ca/laws/statute/
// URL.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseOntarioJson } from "./lib/parse-ontario-doc.js";
import { writeStatute } from "./lib/write-statute.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const alias = process.argv[2];
if (!alias) {
  console.error("Usage: node parse-ontario.js <alias>");
  console.error(
    "  <alias> is the path segment from https://www.ontario.ca/laws/statute/<alias>",
  );
  process.exit(1);
}
const cliSlug = `on-${alias.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;

const SOURCE_PATH = path.join(__dirname, `source/${cliSlug}.json`);

async function ensureSourceJson() {
  if (existsSync(SOURCE_PATH)) return readFileSync(SOURCE_PATH, "utf-8");
  const url = `https://www.ontario.ca/laws/api/v2/legislation/en/doc-search/statute/${alias}`;
  console.log(`Fetching ${url} ...`);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; statute-anatomy-explorer/1.0)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${url} (${res.status} ${res.statusText}). Check the ` +
        `alias against the statute's URL on https://www.ontario.ca/laws/ — ` +
        `e.g. "90h08" for ontario.ca/laws/statute/90h08.`,
    );
  }
  const body = await res.text();
  try {
    JSON.parse(body);
  } catch {
    throw new Error(`${url} didn't return JSON — check the alias.`);
  }
  mkdirSync(path.dirname(SOURCE_PATH), { recursive: true });
  writeFileSync(SOURCE_PATH, body);
  console.log(`Cached source to ${path.relative(__dirname, SOURCE_PATH)}`);
  return body;
}

const rawJsonText = await ensureSourceJson();
const { statuteDocument, parts, sections, definitions } = parseOntarioJson(rawJsonText);

// Slug is derived from the document's own self-reported alias, so a
// file-upload-driven parse (no user-typed alias at all) still lands on the
// same slug a CLI parse would.
const slug = `on-${statuteDocument.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;

writeStatute({ __dirname, slug, statuteDocument, parts, sections, definitions });
