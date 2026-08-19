// CLI entry point for federal statutes. The actual parsing lives in
// lib/parse-federal.js (a pure function) so the dev-server import API can
// call it directly too — see ../docs/SCHEMA.md for the output shape and
// ../README.md for the two ways to import a statute.
//
// Usage: node parse.js [chapterCode]
//   e.g. node parse.js E-4.5   (default — Emergencies Act)
//        node parse.js H-6     (Canadian Human Rights Act)
//        node parse.js C-46    (Criminal Code)
//
// Every Act published on laws-lois.justice.gc.ca uses the same XML schema
// (Justice's "LIMS" format), so this same parser works across acts without
// any per-statute code — the chapter code is the only input. If the XML
// isn't already cached under source/, it's fetched from Justice Laws and
// cached for next time.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseFederalXml } from "./lib/parse-federal.js";
import { writeStatute } from "./lib/write-statute.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CHAPTER = "E-4.5";
const chapterCode = process.argv[2] ?? DEFAULT_CHAPTER;
const cliSlug = chapterCode
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");

const SOURCE_PATH = path.join(__dirname, `source/${cliSlug}.xml`);

async function ensureSourceXml() {
  if (existsSync(SOURCE_PATH)) return readFileSync(SOURCE_PATH, "utf-8");
  const url = `https://laws-lois.justice.gc.ca/eng/XML/${chapterCode}.xml`;
  console.log(`Fetching ${url} ...`);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; statute-anatomy-explorer/1.0)",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${url} (${res.status} ${res.statusText}). Check the ` +
        `chapter code against https://laws-lois.justice.gc.ca/ — e.g. "E-4.5", "H-6", "C-46".`,
    );
  }
  const xml = await res.text();
  if (!xml.includes("<Statute")) {
    throw new Error(
      `${url} didn't return a Statute XML document — check the chapter code.`,
    );
  }
  mkdirSync(path.dirname(SOURCE_PATH), { recursive: true });
  writeFileSync(SOURCE_PATH, xml);
  console.log(`Cached source to ${path.relative(__dirname, SOURCE_PATH)}`);
  return xml;
}

const xml = await ensureSourceXml();
const { statuteDocument, parts, sections, definitions } = parseFederalXml(xml);

// Slug is derived from the Act's own self-reported chapter code (not
// necessarily byte-identical to what the user typed, e.g. casing), so a
// file-upload-driven parse (no user-typed chapter code at all) still lands
// on the same slug a CLI parse would.
const slug = statuteDocument.id
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");

writeStatute({ __dirname, slug, statuteDocument, parts, sections, definitions });
