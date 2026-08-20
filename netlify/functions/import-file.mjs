// Netlify Function (v2) backing "Add a statute" → upload a file, in
// production. See import.js for the shared design notes — same idea, just
// parsing content the client already has instead of fetching a URL.
import { importFromFileContent } from "../../parser/lib/import-logic.js";

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }
  try {
    const { content } = await req.json();
    const result = await importFromFileContent(content ?? "");
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 400 });
  }
};

export const config = {
  path: "/api/import-file",
};
