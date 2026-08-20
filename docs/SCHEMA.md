# Data model: parsed statute JSON

Produced by `parser/parse.js` (federal) or `parser/parse-ontario.js`
(Ontario) from each jurisdiction's official source. See the top-level
[README](../README.md) for what format each expects and how to run them. No
runtime parsing happens in the browser: all of this is precomputed, and
both adapters emit the exact same shape below, which is the only thing the
app (`app/src/`) actually knows about.

Every statute is written to `app/public/data/<slug>.json` (e.g. `e-4-5.json`,
`on-90h08.json`), and `app/public/data/manifest.json` is a registry of every
statute parsed so far (`{ slug, id, jurisdiction, title, citation,
partCount, sectionCount }[]`) that the app fetches on load to populate the
statute picker, grouped by `jurisdiction`. The app fetches whichever statute
is selected at runtime. Nothing is bundled into the JS build.

## Top level

```ts
StatuteDocument {
  id: string              // "E-4.5" (federal chapter code) | "90h08" (Ontario alias)
  jurisdiction: "federal" | "ontario"
  title: string           // "Emergencies Act"
  citation: string        // "R.S.C., 1985, c. 22 (4th Supp.)"
  sourceUrl: string       // the statute's page on the source government site
  consolidatedDate: string
  tree: PartNode[]        // ordered top-level structure, drives the nav tree
  sections: Record<sectionId, Section>   // flat lookup by id, e.g. "s5"
  definitions: Record<termId, Definition>
  crossRefIndex: Record<sectionId, { outgoing: sectionId[], incoming: sectionId[] }>
}
```

`tree` and `sections` are two views of the same content: `tree` is for
rendering the collapsible outline, `sections` is for O(1) lookup when the
user clicks a link (nav tree click, cross-ref jump, or definition jump).

## Hierarchy (Part → Division → Section)

The source XML has no explicit `<Part>`/`<Division>` wrapper elements:
`Heading level="1"` and `Heading level="2"` are siblings of `Section` in a
flat `Body`, and the hierarchy is implied by heading level until the next
heading of equal-or-higher level. The parser reconstructs real nesting from
that flat stream.

```ts
PartNode {
  id: string             // "part-1" | "preliminary"
  label: string | null   // "PART I", or null for unlabelled lead-in headings
                          // (e.g. "Short Title", "Application and Construction")
  title: string           // "Public Welfare Emergency"
  divisions: DivisionNode[]
}

DivisionNode {
  id: string
  title: string           // "Declaration of a Public Welfare Emergency"
  sectionIds: sectionId[]
}
```

Some parts have no sub-headings at all. In that case a single synthetic
division (`id: "<partId>-main"`, `title: null`) holds all of that part's
sections, so the tree component only ever has to render one shape
(Part → Division → Section), never a special-cased two-level fallback.

## Section

```ts
Section {
  id: string                    // "s5"
  number: string                 // "5" (kept as string: source has "3.1"-style numbers elsewhere in real statutes)
  marginalNote: string | null    // "Definitions": the bolded margin heading
  partId: string
  divisionId: string
  body: Block[]                  // ordered content, top-level Text/Subsection/Definition/Paragraph
  definesTerms: termId[]         // terms whose *anchor* definition lives in this section
  outgoingRefs: sectionId[]      // deduplicated section ids this section's text cross-references
  historicalNote: string | null
}
```

## Block (recursive content node)

One `Section.body` is an ordered array of blocks, each one of:

```ts
{ type: 'text',        runs: Run[] }
{ type: 'subsection',  label: '(1)', marginalNote: string|null, runs: Run[], children: Block[] }
{ type: 'paragraph',   label: '(a)', runs: Run[], children: Block[] }
{ type: 'subparagraph',label: '(i)', runs: Run[] }
{ type: 'definition',  termId: string, runs: Run[], children: Block[] }
{ type: 'continued',   runs: Run[] }   // "ContinuedSectionSubsection" / "ContinuedDefinition" / "ContinuedParagraph": text that resumes after an embedded list
```

`children` holds nested blocks (e.g. a subsection's paragraphs, a
definition's own lettered clauses). This mirrors the source's genuine
nesting instead of flattening everything to a section-level list, so the
reading view can indent correctly and the parser doesn't have to guess
where a paragraph "belongs" from numbering alone.

## Run (inline content within a block's text)

This is the part that makes cross-reference and definition linking work:
text is never stored as a plain string. It's pre-split into typed runs at
parse time, so the app never has to re-run regexes against rendered text.

```ts
{ type: 'text',         value: string }
{ type: 'defterm',      value: string, termId: string, isAnchor: boolean }
{ type: 'xref-external',value: string, act: string, link: string }
{ type: 'xref-internal',value: string, targets: { sectionId, subsectionLabel?, paragraphLabel? }[] }
```

- `isAnchor: true` marks the specific occurrence where a term is first
  defined (inside a `<Definition>` block). The reading view can style that
  occurrence differently (e.g. bold, no hover-preview needed since you're
  already looking at the definition).
- `xref-internal.targets` is an array, not a single id, because citations
  like "sections 52 and 53" or "sections 58 to 61" resolve to more than one
  target. The graph and incoming/outgoing ref lists explode these, but the
  rendered link stays a single clickable span.
- External Act citations (`xref-external`) are rendered as plain
  non-interactive emphasis, not links. This tool only knows the shape of
  the one statute it parsed, and CanLII deep-linking to an arbitrary
  external act/section is out of scope for v1.

## Definition

```ts
Definition {
  id: termId                 // slug, e.g. "public-welfare-emergency"
  term: string                 // display text, e.g. "public welfare emergency"
  sectionId: sectionId          // where the anchor definition lives
  scope: string                 // "this Act" | "this Part" | "this section": taken from the lead-in text ("In this Act,")
  previewRuns: Run[]             // the definition's own text (for the hover-preview popover)
}
```

## Cross-reference index

```ts
crossRefIndex: Record<sectionId, { outgoing: sectionId[], incoming: sectionId[] }>
```

Built once, after all sections are parsed, by inverting each section's
`outgoingRefs`. This is what feeds the per-section node-link graph (a
section's direct neighbours = its own `outgoing` ∪ its `incoming`) without
the graph component needing to scan every section on every render.

## Why this shape

- **Flat `sections` map + separate `tree`**: cross-ref and definition jumps
  are id → section lookups from anywhere in the app; re-walking a nested
  tree to find "section 34" on every click would be O(n) and awkward to
  memoize correctly.
- **Runs instead of strings + client-side regex**: statutory cross-refs
  need to *not* match citations to a different Act's section. For example,
  "subsection 2(1) of the Immigration and Refugee Protection Act" appears
  in this exact statute: an internal-looking match that must NOT become a
  local jump link. That disambiguation needs the surrounding DOM context
  (is an `XRefExternal` element adjacent?), which only exists at XML-parse
  time, not in a flattened string.
- **Recursive `Block.children` instead of a flat per-section list**:
  preserves genuine source nesting (paragraph → subparagraph) so indentation
  and "which paragraphs belong to which subsection" don't have to be
  re-derived from label text (`(a)` vs `(i)`) in the UI layer.
