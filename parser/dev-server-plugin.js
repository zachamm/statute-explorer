// A Vite plugin (dev-server only — this never runs in a production build)
// that lets the app's Import and Docs tabs work without a real backend:
//   POST /api/import       { url }                 — fetch + parse server-side
//   POST /api/import-file  { filename, content }    — parse an uploaded file directly
//   GET  /api/docs/readme | /api/docs/schema        — serves the project's own docs
//
// Reuses the exact same pure parse functions the CLI scripts use, so a
// statute imported through the UI is byte-identical to one imported with
// `node parse.js` / `node parse-ontario.js`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFederalXml } from "./lib/parse-federal.js";
import { parseOntarioJson } from "./lib/parse-ontario-doc.js";
import { writeStatute } from "./lib/write-statute.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, ".."); // statute-explorer/

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Figures out which adapter a pasted URL needs and what identifier to feed
 * it, from the URL shape alone — no fetching yet. */
function detectFromUrl(url) {
  const federalMatch = url.match(/laws-lois\.justice\.gc\.ca\/eng\/(?:acts|XML)\/([^/]+?)(?:\.xml)?(?:\/|$)/i);
  if (federalMatch) return { jurisdiction: "federal", identifier: federalMatch[1] };
  const ontarioMatch = url.match(/ontario\.ca\/laws\/statute\/([^/#?]+)/i);
  if (ontarioMatch) return { jurisdiction: "ontario", identifier: ontarioMatch[1] };
  return null;
}

/** Figures out which adapter an uploaded file's own content needs — no
 * filename convention required, since both formats self-identify. */
function detectFromContent(content) {
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

function cacheSource(slug, ext, content) {
  const dir = path.join(__dirname, "source");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${slug}.${ext}`), content);
}

async function importFederal(xmlText) {
  const { statuteDocument, parts, sections, definitions } = parseFederalXml(xmlText);
  const slug = slugify(statuteDocument.id);
  cacheSource(slug, "xml", xmlText);
  writeStatute({ __dirname, slug, statuteDocument, parts, sections, definitions });
  return { slug, statuteDocument, parts };
}

async function importOntario(jsonText) {
  const { statuteDocument, parts, sections, definitions } = parseOntarioJson(jsonText);
  const slug = `on-${slugify(statuteDocument.id)}`;
  cacheSource(slug, "json", jsonText);
  writeStatute({ __dirname, slug, statuteDocument, parts, sections, definitions });
  return { slug, statuteDocument, parts };
}

function summarize({ slug, statuteDocument, parts }) {
  return {
    ok: true,
    slug,
    id: statuteDocument.id,
    jurisdiction: statuteDocument.jurisdiction,
    title: statuteDocument.title,
    citation: statuteDocument.citation,
    partCount: parts.length,
    sectionCount: Object.keys(statuteDocument.sections).length,
  };
}

const DOCS = {
  guide: path.join(REPO_ROOT, "docs/GUIDE.md"),
  readme: path.join(REPO_ROOT, "README.md"),
  schema: path.join(REPO_ROOT, "docs/SCHEMA.md"),
};

export function statuteDevApiPlugin() {
  return {
    name: "statute-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (req.method === "GET" && req.url?.startsWith("/api/docs/")) {
            const name = req.url.replace("/api/docs/", "").split("?")[0];
            const filePath = DOCS[name];
            if (!filePath) return sendJson(res, 404, { ok: false, error: `Unknown doc "${name}"` });
            const content = readFileSync(filePath, "utf-8");
            return sendJson(res, 200, { ok: true, content });
          }

          if (req.method === "POST" && req.url === "/api/import") {
            const body = JSON.parse(await readBody(req));
            const url = (body.url || "").trim();
            const detected = detectFromUrl(url);
            if (!detected) {
              return sendJson(res, 400, {
                ok: false,
                error:
                  "That URL doesn't look like a laws-lois.justice.gc.ca or ontario.ca/laws statute page. See the Docs tab for the URL formats that work.",
              });
            }
            if (detected.jurisdiction === "federal") {
              const xmlUrl = `https://laws-lois.justice.gc.ca/eng/XML/${detected.identifier}.xml`;
              const xmlText = await fetchText(xmlUrl);
              if (!xmlText.includes("<Statute")) {
                return sendJson(res, 400, {
                  ok: false,
                  error: `${xmlUrl} didn't return a Statute XML document — check the chapter code in the URL.`,
                });
              }
              const result = await importFederal(xmlText);
              return sendJson(res, 200, summarize(result));
            } else {
              const apiUrl = `https://www.ontario.ca/laws/api/v2/legislation/en/doc-search/statute/${detected.identifier}`;
              const jsonText = await fetchText(apiUrl);
              const result = await importOntario(jsonText);
              return sendJson(res, 200, summarize(result));
            }
          }

          if (req.method === "POST" && req.url === "/api/import-file") {
            const body = JSON.parse(await readBody(req));
            const content = body.content ?? "";
            const kind = detectFromContent(content);
            if (!kind) {
              return sendJson(res, 400, {
                ok: false,
                error:
                  "Couldn't recognize that file as federal Justice Laws XML or an Ontario e-Laws JSON export. See the Docs tab for what's expected.",
              });
            }
            const result = kind === "federal" ? await importFederal(content) : await importOntario(content);
            return sendJson(res, 200, summarize(result));
          }
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: err.message });
        }
        next();
      });
    },
  };
}
