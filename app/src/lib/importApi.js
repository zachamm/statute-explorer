// Talks to the import API — a Vite dev-server plugin in dev
// (../../../parser/dev-server-plugin.js) and a Netlify Function in
// production (../../../netlify/functions/import.js), both hit at the same
// /api/* paths so this file doesn't need to know which one is live.
//
// Either way, the server only *parses* — it has no persistent, writable
// filesystem to save into (a serverless function's isn't one). Saving is
// this browser's job, into IndexedDB (see localStatutes.js).
import { saveLocalStatute } from "./localStatutes";

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body;
}

function summarize(slug, d) {
  return {
    slug,
    id: d.id,
    jurisdiction: d.jurisdiction,
    title: d.title,
    citation: d.citation,
    partCount: d.tree.length,
    sectionCount: Object.keys(d.sections).length,
  };
}

async function importAndSave(request) {
  const { slug, statuteDocument } = await request;
  await saveLocalStatute(slug, statuteDocument);
  return summarize(slug, statuteDocument);
}

export function importByUrl(url) {
  return importAndSave(postJson("/api/import", { url }));
}

export function importByFile(filename, content) {
  return importAndSave(postJson("/api/import-file", { filename, content }));
}
