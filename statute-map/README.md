# Statute Map

Read and map Canadian legislation. Search every federal Act and regulation and
the main Ontario Acts, read one with its definitions and cross-references
linked, and see on a graph how its sections, and other statutes, cite each other.

There's no account, no backend and no AI. Nothing leaves your browser except
the requests for the law itself.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. On a Mac you can instead double-click
`Start Statute Map.command`, which starts the server and opens the page. The app
only runs while that window stays open.

```bash
npm test           # the test suite
npm run build      # typecheck and production build, into dist/
npm run preview    # serve that build locally
npm run data       # rebuild the search index from Justice Laws and e-Laws
```

## Where the law comes from

**The app doesn't host any statute text.** All it ships is
`public/data/catalog.json`, a search index of titles and codes. Opening a
statute downloads it from the government source at that moment:

| Source | How the browser reaches it |
|---|---|
| Federal Acts and regulations, the Charter | Directly from laws-lois.justice.gc.ca, which allows it |
| Ontario statutes | Through a small relay in the local server, because ontario.ca doesn't allow direct browser requests. The relay stores nothing. |

The first download is kept in that browser's IndexedDB, so reopening is instant
and works offline. About once a day the app compares each saved copy's "last
amended" date with the source and offers an update if it's behind
(`library/updates.ts`). "Remove" in the Library deletes that copy.

The index is complete for federal law (it's Justice Laws' own list). e-Laws
publishes no list, so the Ontario entries are the ones named in
`parser/ontario-index.json`. Any other Ontario statute opens by pasting its link
into the Library's search box; add its alias to that file and run `npm run data`
to make it searchable.

### Hosting it

`dist/` is a static site. Everything works on a static host except opening
Ontario statutes, which needs the relay. To support that, serve
`GET /api/ontario/:alias` the way `parser/dev-server-plugin.js` does.

## How it's put together

One React app with four views, all under `src/`:

- **`views/`** holds the views and the shared search box. `App.jsx` owns the
  header, routing and the theme. Read and Map stay mounted once opened, so
  switching between them keeps your place.
- **`library/`** is the single place statutes are loaded from. `catalog.ts`
  (index and search ranking, pure and tested), `library.ts` (download, parse,
  save), `parse.worker.js` (parsing off the main thread), `updates.ts` (update
  checks) and `legalLinks.ts` (citations and CanLII links).
- **`reader/`** is the reading view's components and helpers.
- **`map/mapController.ts`** is the map view, in plain DOM and d3 because the
  graph is a large imperative SVG. `views/MapView.jsx` renders its markup and
  mounts it once.
- **`graph/`** is the graph model and d3 rendering.
- **`statute/`** is the map's pipeline: section parsers (`parseStatuteXml`,
  `parseStatuteHtml`, `documentToStatute`), reference classification and
  cross-statute resolution.
- **`db/`** is the IndexedDB layer for projects and the raw-source cache.
- **`styles/`** holds the design tokens (top of `app.css`, light and dark) that
  every view uses.

`parser/lib/` turns government sources into the structured document the reader
renders, described in [docs/SCHEMA.md](docs/SCHEMA.md). It runs in the browser.

### Two parsers

The reader and the map parse the same XML separately, on purpose. The reader
needs a rich tree with linked terms; the map needs flat text to classify
references from. Downloads go through one raw-source cache, so opening a statute
in one view spares the other a download. Ontario statutes have no XML, so the map
flattens the reader's document instead (`documentToStatute.ts`).

## Known limits

- Reference detection is pattern-matching on legal drafting language ("section
  14", "subsection 3(2)"). It doesn't understand the text, so an unusual phrasing
  can be missed or get the generic `OTHER` type. Anything it can't resolve shows
  up as a ghost node rather than being dropped.
- Schedules aren't parsed, only numbered sections.
- Some orders have no numbered sections at all. They can't be mapped, and the
  reader links to the official text instead.
- The cross-statute map only recognizes an Act named exactly as in the index, so
  an old or provincial Act named in passing stays an unresolved ghost.

Comments tagged like `C-03` or `H-07` refer to findings from an earlier audit,
and explain why that code is the way it is.
