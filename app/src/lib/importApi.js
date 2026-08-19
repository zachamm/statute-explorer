// Talks to the dev-server-only API in ../../../parser/dev-server-plugin.js.
// Only available when running `npm run dev` (wired up in vite.config.js) —
// there's no backend in a static production build.

export async function fetchDoc(name) {
  const res = await fetch(`/api/docs/${name}`);
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error(body.error ?? `Failed to load "${name}" doc`);
  return body.content;
}

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

export function importByUrl(url) {
  return postJson("/api/import", { url });
}

export function importByFile(filename, content) {
  return postJson("/api/import-file", { filename, content });
}
