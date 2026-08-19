// Shared output step for every jurisdiction's parser adapter: writes the
// parsed StatuteDocument (see ../../docs/SCHEMA.md) to disk and upserts the
// registry the app reads to populate its statute picker.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function writeStatute({ __dirname, slug, statuteDocument, parts, sections, definitions }) {
  const OUTPUT_PATH = path.join(__dirname, `output/${slug}.json`);
  const PUBLIC_DATA_DIR = path.join(__dirname, "../app/public/data");
  const APP_DATA_PATH = path.join(PUBLIC_DATA_DIR, `${slug}.json`);
  const MANIFEST_PATH = path.join(PUBLIC_DATA_DIR, "manifest.json");

  const sectionCount = Object.keys(sections).length;
  const defCount = Object.keys(definitions).length;
  const xrefCount = Object.values(sections).reduce(
    (n, s) => n + s.outgoingRefs.length,
    0,
  );

  const json = JSON.stringify(statuteDocument, null, 2);
  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, json);
  mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
  writeFileSync(APP_DATA_PATH, json);

  let manifest = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"))
    : [];
  manifest = manifest.filter((entry) => entry.slug !== slug);
  manifest.push({
    slug,
    id: statuteDocument.id,
    jurisdiction: statuteDocument.jurisdiction,
    title: statuteDocument.title,
    citation: statuteDocument.citation,
    partCount: parts.length,
    sectionCount,
  });
  manifest.sort((a, b) => a.title.localeCompare(b.title));
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(
    `Parsed ${statuteDocument.title}: ${parts.length} parts, ${sectionCount} sections, ${defCount} defined terms, ${xrefCount} internal cross-references.`,
  );
  console.log(
    `Wrote ${path.relative(__dirname, APP_DATA_PATH)} and updated manifest.`,
  );
}
