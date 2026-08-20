// A Vite plugin (dev-server only) that gives the app's "Add a statute" tab
// something to call locally: POST /api/import and POST /api/import-file.
// In production these same paths are served by a Netlify Function
// (netlify/functions/import.js) — both wrap the identical shared logic in
// parser/lib/import-logic.js, so a statute imported in dev behaves exactly
// like one imported on the deployed site. See that file's header for why
// neither one writes to disk.
import { importFromUrl, importFromFileContent } from "./lib/import-logic.js";

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

export function statuteDevApiPlugin() {
  return {
    name: "statute-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (req.method === "POST" && req.url === "/api/import") {
            const { url } = JSON.parse(await readBody(req));
            const result = await importFromUrl((url || "").trim());
            return sendJson(res, 200, { ok: true, ...result });
          }

          if (req.method === "POST" && req.url === "/api/import-file") {
            const { content } = JSON.parse(await readBody(req));
            const result = await importFromFileContent(content ?? "");
            return sendJson(res, 200, { ok: true, ...result });
          }
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: err.message });
        }
        next();
      });
    },
  };
}
