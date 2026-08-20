# Statute Anatomy Explorer

Browse a Canadian statute as a navigable, cross-referenced structure instead
of a wall of text: a collapsible section tree, a reading view with defined
terms and cross-references linked inline, hover previews for definitions,
and a force-directed graph of which sections cite (and are cited by) the
one you're reading.

It currently works out of the box for **any federal statute**
(laws-lois.justice.gc.ca) and **any Ontario statute** (ontario.ca/laws). See
[Importing a statute](#importing-a-statute) below for how to add one.

## How it works, end to end

There's no backend and no runtime parsing. A Node script (`parser/`) fetches
a statute from its official government source, parses it once into a single
JSON file, and that JSON is what the React app (`app/`) fetches and renders.
Re-running the parser is how you add a new statute or refresh an existing
one. The app itself never talks to a government API directly.

```
government source (XML or HTML)
        │
        ▼
  parser/parse*.js  ──►  app/public/data/<slug>.json  ──►  app/public/data/manifest.json
        │                        │                                  │
        │                        ▼                                  ▼
        │                 one statute's                    registry of every
        │              full parsed content              statute available to
        │                                                    the picker in the
        └── cached raw source under parser/source/            app's header
```

The output JSON shape (Part → Division → Section → nested Block/Run tree,
cross-reference index, defined-term index) is documented in
[`docs/SCHEMA.md`](docs/SCHEMA.md). It's identical regardless of which
jurisdiction a statute came from. The app (`app/src/`) only ever reads that
shape; it has no jurisdiction-specific code at all. All jurisdiction-specific
knowledge lives in the parser adapters.

## Running it

```bash
cd app
npm install
npm run dev   # http://localhost:5173 (or via preview_start "statute-explorer-dev")
```

The app boots by fetching `/data/manifest.json`. If that's empty (a fresh
checkout with no statutes parsed yet), parse at least one statute first.
See below.

## Importing a statute

There are two ways to add a statute: the CLI (below) bakes it permanently
into the repo's bundled dataset, and the in-app "Add a statute" tab saves it
to your browser's IndexedDB instead. Use the CLI when you want a statute
shipped to everyone who runs the app; use the UI when you just want to look
something up. Both use the exact same parsers underneath, so the result is
identical either way.

### Federal Acts (laws-lois.justice.gc.ca)

```bash
cd parser
node parse.js E-4.5     # Emergencies Act
node parse.js C-46      # Criminal Code
node parse.js H-6       # Canadian Human Rights Act
```

The argument is the Act's **chapter code**: the same code that appears in
its citation (`c. C-46`) and in its Justice Laws URL
(`laws-lois.justice.gc.ca/eng/acts/C-46/`). If you don't already know it,
search the Act by name on [laws-lois.justice.gc.ca](https://laws-lois.justice.gc.ca/)
and read the code off the URL.

**Format required:** the "LIMS" XML schema Justice Canada publishes for
every consolidated federal Act and regulation, fetched from
`laws-lois.justice.gc.ca/eng/XML/<chapterCode>.xml`. It's a real, clean,
well-formed schema: `Statute > Body > (Heading | Section)`, with
`Section > (Label, MarginalNote?, Subsection* | Text, Paragraph*)`, defined
terms marked with `<DefinedTermEn>`/`<DefinedTermFr>`, and external-Act
citations marked with `<XRefExternal>`. Every federal Act uses this exact
schema, so `parse.js` needed zero Act-specific code: the chapter code is the
only input. It's been verified end-to-end against three structurally
different Acts ranging from 64 to 1,603 sections (see `docs/SCHEMA.md` for
the full element mapping).

If the XML isn't already cached under `parser/source/`, it's downloaded
automatically and cached there for next time.

### Ontario Acts (ontario.ca/laws)

```bash
cd parser
node parse-ontario.js 90h08     # Highway Traffic Act, R.S.O. 1990, c. H.8
```

The argument is the **alias** from the Act's ontario.ca URL. Go to
`ontario.ca/laws/statute/<alias>` for the Act you want and copy the path
segment. There's no simple code-from-title mapping the way there is
federally. You have to find the URL.

**Format required:** unlike the federal source, Ontario's e-Laws doesn't
publish real XML. `parse-ontario.js` fetches a JSON envelope from
`ontario.ca/laws/api/v2/legislation/en/doc-search/statute/<alias>` whose
`content` field is a large blob of **Word-export HTML**. Structure is
carried by CSS class names on `<p>` elements (`class="section"`,
`class="subsection"`, `class="definition"`, `class="partnum"`, and so on)
rather than by distinct tags, and the HTML itself isn't well-formed. Word's
converter leaves unclosed, mis-nested `<span>` tags: a citation note gets
wrapped in three separately-nested `<span class="citation">` tags, one per
word. `parse-ontario.js` uses `cheerio` (an HTML5-tolerant parser) to
recover a sane DOM from that, then walks the flat `<p>` stream classifying
each paragraph by its class name. This was reverse-engineered against a
real downloaded Act. Ontario doesn't document the format anywhere, which
makes it inherently more heuristic than the federal adapter. See **Known
limitations** below.

If the JSON isn't already cached under `parser/source/`, it's downloaded
automatically and cached there (as `on-<alias>.json`) for next time.

### Adding a third jurisdiction

Both adapters share two modules so a new one doesn't start from scratch:

- `parser/lib/text-runs.js`: turns plain text into the linked
  `defterm`/`xref-internal` runs the app renders. Cross-reference and
  defined-term detection ("section 14", "subsection 3 (2)") is regex-based
  over standard legal drafting conventions, not tied to either source's
  markup, so it's reusable as-is for another jurisdiction that drafts in
  the same style (most of Canada does; the convention is nationwide, not
  jurisdiction-specific).
- `parser/lib/write-statute.js`: writes the output JSON and updates
  `manifest.json`. Also reusable as-is.

What a new adapter actually needs to write is the source-specific part:
fetch the statute, walk whatever structure the source uses, and build the
same `{ tree, sections, definitions, crossRefIndex }` shape documented in
`docs/SCHEMA.md`. `parse.js` (schema-driven, XML) and `parse-ontario.js`
(heuristic, HTML-by-CSS-class) answer that same problem two different ways,
and make a reasonable pair of references for how different a real adapter
can end up looking.

## Importing from the UI, and where that data lives

The "Add a statute" tab hits a small backend: a Vite dev-server plugin
locally (`parser/dev-server-plugin.js`), a Netlify Function in production
(`netlify/functions/`). Both wrap the same `parser/lib/import-logic.js` and
neither one writes to disk. A serverless function doesn't have persistent
storage to write to, so the parsed statute goes back to your browser, which
saves it in IndexedDB (`app/src/lib/localStatutes.js`) and merges it into
the picker at runtime. That means statutes you import through the UI are
private to your browser: they don't show up for anyone else, and they
don't touch the git repo. If you want a statute available to everyone who
runs the app, use the CLI and commit the result.

## Running it on Netlify

`netlify.toml` at the repo root has the build command, publish directory,
and function config already wired up. Connect the repo in Netlify and it
should deploy as-is: no environment variables or secrets needed, since
every data source is public and unauthenticated.

To test the full production setup locally, including the functions:

```bash
npx netlify-cli dev
```

This proxies the Vite dev server through Netlify's local emulator and
serves `/api/import` and `/api/import-file` from the actual function code,
not the Vite plugin, which is the closest you can get to the real deploy
without pushing.

## Known limitations

- **Schedules are skipped** in both adapters (federal `<Schedule>` elements,
  Ontario `class="schedule"`/`class="headingx"` content). Out of scope for
  v1, matching the original federal-only design.
- **Ontario's schedule-boundary detection is a heuristic**, not a structural
  guarantee the way federal's `<Schedule>` tag is. It was verified against
  one real schedule (a short list of related Act names) and correctly
  resumes normal parsing afterward, but a much larger or differently-styled
  schedule in some other Ontario Act could leak stray content into the
  tree. If a parsed Ontario Act ever shows an obviously-wrong section in
  the tree, this is the first place to check.
- **Defined-term linking is whole-word substring matching**, case-
  insensitive, across the entire statute. This occasionally over-links a
  proper noun that happens to contain a defined word: "**Ambulance** Act"
  gets "Ambulance" linked to the defined term "ambulance" even though it's
  naming a different Act, not using the term. That's a known, accepted
  imprecision of the design, not a bug to chase. See the "Why this shape"
  section of `docs/SCHEMA.md`.
- **Other provinces/territories are not wired up.** Each publishes in its
  own format (some may have clean XML like the federal source, others may
  be HTML-only like Ontario, some may have neither). Adding one means
  writing a new adapter using the pattern above, not a config change.
