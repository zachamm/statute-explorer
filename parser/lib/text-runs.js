// Shared across every jurisdiction's parser adapter: turns plain text into
// the typed Run[] the app renders (see ../../docs/SCHEMA.md). Cross-reference
// and defined-term detection are regex-based over standard legal drafting
// conventions ("section 14", "subsection 3 (2)") that hold across Canadian
// jurisdictions, not tied to any one source's markup.

export function slugify(term) {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mergeAdjacentTextRuns(runs) {
  const out = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    if (run.type === "text" && prev?.type === "text") {
      prev.value += run.value;
    } else {
      out.push({ ...run });
    }
  }
  return out.filter((r) => !(r.type === "text" && r.value === ""));
}

export function collectPreviewRuns(blocks) {
  const out = [];
  for (const b of blocks) {
    if (out.length) out.push({ type: "text", value: " " });
    if (b.runs) out.push(...b.runs);
    if (b.children) out.push(...collectPreviewRuns(b.children));
  }
  return out;
}

// Section numbers aren't always plain integers — amended Acts insert new
// sections as "36.1", "4.0.1", etc., chaining multiple decimal segments.
// Both the base number and the inserted one commonly exist as distinct
// sections in the same Act, so truncating "36.1" to "36" silently mislinks
// to the wrong section.
const SECTION_NUM = String.raw`\d+(?:\.\d+)*[A-Za-z]?`;

/**
 * Builds a tokenizer bound to one statute's known defined terms and valid
 * section ids. Both are needed up front (a two-pass parse) so a plain-text
 * mention can be resolved — or correctly left as plain text when it isn't a
 * real cross-reference or term use.
 */
export function createRunTokenizer({ definitions, validSectionIds }) {
  const sortedTerms = Object.values(definitions).sort(
    (a, b) => b.term.length - a.term.length,
  );
  const termByLower = new Map(
    sortedTerms.map((d) => [d.term.toLowerCase(), d]),
  );
  const TERM_RE = sortedTerms.length
    ? new RegExp(
        `\\b(${sortedTerms.map((d) => escapeRegExp(d.term)).join("|")})\\b`,
        "gi",
      )
    : null;
  const XREF_RE = new RegExp(
    String.raw`\b(subsections?|sections?)\s+(${SECTION_NUM})(?:\s*\((${SECTION_NUM})\))?(?:\s+(?:to|and)\s+(${SECTION_NUM})(?:\s*\((${SECTION_NUM})\))?)?`,
    "gi",
  );

  /** Splits plain text into text/xref-internal runs. */
  function tokenizeXrefs(raw, ctx, nextIsActName) {
    const runs = [];
    let lastIndex = 0;
    XREF_RE.lastIndex = 0;
    let m;
    while ((m = XREF_RE.exec(raw))) {
      const [full, , num1, sub1, num2, sub2] = m;
      const matchEnd = m.index + full.length;
      const rest = raw.slice(matchEnd);
      // "subsection 2(1) of the Immigration and Refugee Protection Act" is
      // a citation into a DIFFERENT statute, not a local cross-reference —
      // must not become an internal jump link even though the shape
      // matches. `nextIsActName` is true when the text run is immediately
      // followed by an inline Act-name reference (federal: <XRefExternal>;
      // Ontario: an italicized Act name), which is what "of the" is
      // introducing here.
      const trailingOfThe = /^\s+of\s+the\s*$/i.test(rest) && nextIsActName;
      const trailingOfThatAct = /^\s+of\s+that\s+act\b/i.test(rest);
      const suppressed = trailingOfThe || trailingOfThatAct;

      const targets = [];
      if (!suppressed) {
        if (validSectionIds.has(`s${num1}`)) {
          targets.push({
            sectionId: `s${num1}`,
            subsectionLabel: sub1 ? `(${sub1})` : undefined,
          });
        }
        if (num2 && validSectionIds.has(`s${num2}`)) {
          targets.push({
            sectionId: `s${num2}`,
            subsectionLabel: sub2 ? `(${sub2})` : undefined,
          });
        }
      }

      if (targets.length) {
        if (m.index > lastIndex) {
          runs.push({ type: "text", value: raw.slice(lastIndex, m.index) });
        }
        for (const t of targets) ctx.outgoingRefs.add(t.sectionId);
        runs.push({ type: "xref-internal", value: full, targets });
        lastIndex = matchEnd;
      }
      // else: leave it for the plain-text pass (no split needed here)
    }
    if (lastIndex < raw.length) {
      runs.push({ type: "text", value: raw.slice(lastIndex) });
    }
    return runs;
  }

  /** Splits a plain-text run further into text/defterm runs. */
  function tokenizeTerms(raw) {
    if (!TERM_RE) return [{ type: "text", value: raw }];
    const runs = [];
    let lastIndex = 0;
    TERM_RE.lastIndex = 0;
    let m;
    while ((m = TERM_RE.exec(raw))) {
      const def = termByLower.get(m[0].toLowerCase());
      if (m.index > lastIndex) {
        runs.push({ type: "text", value: raw.slice(lastIndex, m.index) });
      }
      runs.push({
        type: "defterm",
        value: m[0],
        termId: def.id,
        isAnchor: false,
      });
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < raw.length) {
      runs.push({ type: "text", value: raw.slice(lastIndex) });
    }
    return runs;
  }

  function tokenizeText(raw, ctx, nextIsActName) {
    const xrefSplit = tokenizeXrefs(raw, ctx, nextIsActName);
    const out = [];
    for (const run of xrefSplit) {
      if (run.type === "text") {
        out.push(...tokenizeTerms(run.value));
      } else {
        out.push(run);
      }
    }
    return out;
  }

  return { tokenizeText };
}
