// Netlify Function (v2, Web-standard Request/Response) backing "Add a
// statute" → paste a URL, in production. Reachable at /api/import via the
// `config.path` export below — the same path the Vite dev-server plugin
// uses locally (parser/dev-server-plugin.js), so the client code never
// needs to know which one is live. Both wrap the identical shared logic in
// parser/lib/import-logic.js.
//
// No filesystem writes here — a serverless function's disk isn't
// persistent across invocations. The parsed statute goes back to the
// browser, which saves it to IndexedDB (app/src/lib/localStatutes.js).
import { importFromUrl } from "../../parser/lib/import-logic.js";

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }
  try {
    const { url } = await req.json();
    const result = await importFromUrl((url || "").trim());
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 400 });
  }
};

export const config = {
  path: "/api/import",
};
