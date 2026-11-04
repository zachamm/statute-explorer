// ontario.ca's legislation API doesn't send CORS headers, so a browser can't
// call it directly (Justice Laws does, so federal statutes need none of this).
// This relays just that one endpoint through the local dev/preview server.
// On a purely static host the route doesn't exist, and the library says that
// Ontario statutes need the local server.
const ROUTE = /^\/api\/ontario\/([a-z0-9]+)$/i;

function relay(server) {
  server.middlewares.use(async (req, res, next) => {
    const match = req.method === "GET" && req.url.match(ROUTE);
    if (!match) return next();
    try {
      const upstream = await fetch(
        `https://www.ontario.ca/laws/api/v2/legislation/en/doc-search/statute/${match[1]}`,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; statute-map/1.0)", Accept: "application/json" } },
      );
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", "application/json");
      res.end(await upstream.text());
    } catch (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ message: err.message }));
    }
  });
}

export function statuteDevApiPlugin() {
  return {
    name: "statute-ontario-relay",
    configureServer: relay,
    configurePreviewServer: relay,
  };
}
