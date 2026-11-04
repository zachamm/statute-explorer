import type { StatuteSection } from "./types";

/**
 * Single-hop reference extraction & classification.
 *
 * Scope (per the build order, step 2): find references from one section's
 * text to *other section numbers within the same statute*, and classify
 * each by the surrounding phrase. Recursive resolution (A -> B -> C) and
 * cycle detection are step 3. Matching a referenced Act's name against
 * the lookup table to resolve *cross-statute* references is step 4 —
 * this module only detects that a reference points at another Act (so it
 * isn't misattributed as a same-statute edge) and hands the raw text off
 * via `externalStatuteRefs` rather than resolving it.
 *
 * All patterns below were checked against real phrasing pulled from the
 * live Criminal Code XML (https://laws-lois.justice.gc.ca/eng/XML/C-46.xml)
 * before being written — see the unit tests for the actual sentences.
 */

export type ReferenceType = "DEFINITIONAL" | "PUNISHMENT" | "PROCEDURAL" | "REPEAL" | "OTHER";

/** A single-hop reference from one section to a section number (same statute). */
export interface SectionReference {
  /** Stable id for this edge: unique per (source section, occurrence). */
  id: string;
  sourceSectionId: string;
  sourceStatuteCode: string;
  /** The section-level target, e.g. "265", "83.01" — subsection paren stripped,
   *  since graph nodes are per-section, not per-subsection. */
  targetSectionNumber: string;
  /** The specific subsection cited, if the mention was e.g. "265(3)", else null. */
  targetSubsection: string | null;
  type: ReferenceType;
  /** The raw matched phrase, e.g. "section 265" or "subsections 280 to 283". */
  matchedText: string;
  /** A short surrounding snippet, for the detail panel. */
  context: string;
}

/** An occurrence that named a section of a *different* Act (e.g. "... within
 *  the meaning of section 2 of the Interpretation Act"). Recorded, not
 *  dropped — step 4 resolves `actNameHint` against the lookup table. */
export interface ExternalStatuteHint {
  sourceSectionId: string;
  /** The full matched phrase including the "of the ... Act" / "of that Act" suffix. */
  matchedText: string;
  /** The Act's name as written, e.g. "Canada Evidence Act". Null when the
   *  text says "of that Act" — an anaphor step 4 will need surrounding
   *  context (or the statute's own cross-reference table) to resolve. */
  actNameHint: string | null;
  /** The section number cited in the *other* Act, e.g. "38" in "section 38
   *  of the Canada Evidence Act" — mirrors SectionReference so step 4 can
   *  build a complete cross-statute edge, not just "some Act was named". */
  targetSectionNumber: string;
  targetSubsection: string | null;
  /** Classified the same way as a same-statute SectionReference, from the
   *  same surrounding phrase — an external DEFINITIONAL reference is still
   *  DEFINITIONAL, it just happens to point at another Act. */
  type: ReferenceType;
}

export interface ClassifyReferencesResult {
  references: SectionReference[];
  externalStatuteRefs: ExternalStatuteHint[];
}

// --- number-list scanning -----------------------------------------------

// A single section/subsection number token, e.g. "265", "83.01", "467.1(1)".
const NUM_TOKEN = String.raw`\d+(?:\.\d+)?(?:\(\d+\))?`;
const NUM_AT_START_RE = new RegExp(`^(${NUM_TOKEN})`);
// A connector joining list items, only consumed when a number actually
// follows (so "467.13, or a serious offence" stops after "467.13" rather
// than swallowing "or a serious offence" as if it were a fifth number).
// Captured (not just matched) so callers can tell "to" — a range, meaning
// every section in between is also being cited (H-04) — apart from ","/
// "and"/"or", which just join a plain list of discrete items.
const CONNECTOR_BEFORE_NUM_RE = /^\s*(,|to|and|or)\s*(?=\d)/i;

interface NumberListItem {
  token: string;
  /** true when this token followed the previous one via "to" rather than
   *  ","/"and"/"or" — i.e. it's the end of an inclusive range, not just
   *  another discrete list item. */
  isRangeEndFromPrevious: boolean;
}

function extractNumberList(text: string, startIndex: number): { items: NumberListItem[]; endIndex: number } {
  const items: NumberListItem[] = [];
  let idx = startIndex;
  let pendingIsRange = false;
  while (true) {
    const numMatch = NUM_AT_START_RE.exec(text.slice(idx));
    if (!numMatch) break;
    items.push({ token: numMatch[1], isRangeEndFromPrevious: pendingIsRange });
    idx += numMatch[0].length;
    const connMatch = CONNECTOR_BEFORE_NUM_RE.exec(text.slice(idx));
    if (!connMatch) break;
    pendingIsRange = connMatch[1].toLowerCase() === "to";
    idx += connMatch[0].length;
  }
  return { items, endIndex: idx };
}

const NUM_TOKEN_RE = /^(\d+(?:\.\d+)?)(?:\((\d+)\))?$/;

function parseNumberToken(token: string): { sectionNumber: string; subsection: string | null } {
  const m = NUM_TOKEN_RE.exec(token);
  if (!m) {
    // Defensive only — every token here was produced by NUM_AT_START_RE above,
    // which uses the same shape, so this should be unreachable.
    throw new Error(`Unexpected reference token shape: "${token}"`);
  }
  return { sectionNumber: m[1], subsection: m[2] ?? null };
}

// --- range expansion (H-04) ------------------------------------------------

// Only used as a last resort (see expandRange) — generous enough for any
// real citation range, small enough that a garbled/typo'd citation (e.g. a
// stray "section 2 to 200000") can't synthesize a huge run of fake targets.
const MAX_SAFE_ARITHMETIC_SPAN = 500;

/**
 * Expands "from ... to ..." into every section that's actually cited,
 * without ever inventing one that isn't real. Two strategies, in order:
 *
 * 1. Resolve against `orderedSectionNumbers` — the statute's real section
 *    numbers in document order — when the caller has it. This is a slice,
 *    not arithmetic, so it's automatically correct for decimal-inserted
 *    sections (e.g. the real Criminal Code has 268, 268.1, 269 — a range
 *    "268 to 269" must include 268.1), repealed-but-still-present sections
 *    (included, since they're real entries), and gaps (impossible to
 *    invent, since every emitted number came from the real list).
 * 2. Falls back to a plain ascending-integer walk ONLY when there's no
 *    order to check against (e.g. a cross-statute range whose target
 *    statute isn't loaded here, or a standalone test section with no
 *    parent statute) AND both endpoints are bare integers — a decimal or
 *    letter-suffixed endpoint with nothing to validate against is exactly
 *    the "unusual numbering" case that must not be guessed at.
 *
 * Anything else (an endpoint not found in a supplied order, a reversed
 * range, a non-integer endpoint with no order to check) returns just the
 * two endpoints — never worse than the pre-fix behavior, never inventive.
 */
function expandRange(
  fromNumber: string,
  toNumber: string,
  orderedSectionNumbers: readonly string[] | null,
): string[] {
  if (fromNumber === toNumber) return [fromNumber];

  if (orderedSectionNumbers) {
    const fromIdx = orderedSectionNumbers.indexOf(fromNumber);
    const toIdx = orderedSectionNumbers.indexOf(toNumber);
    if (fromIdx !== -1 && toIdx !== -1 && fromIdx <= toIdx) {
      return orderedSectionNumbers.slice(fromIdx, toIdx + 1);
    }
    return [fromNumber, toNumber];
  }

  if (/^\d+$/.test(fromNumber) && /^\d+$/.test(toNumber)) {
    const from = Number(fromNumber);
    const to = Number(toNumber);
    if (from < to && to - from <= MAX_SAFE_ARITHMETIC_SPAN) {
      const out: string[] = [];
      for (let n = from; n <= to; n++) out.push(String(n));
      return out;
    }
  }

  return [fromNumber, toNumber];
}

/** Parses a raw number-list into targets, expanding any "to"-joined pair
 *  into every section in between (H-04). Intervening sections synthesized
 *  by a range never carry a subsection — only a literally-written endpoint
 *  (the very first token, or the token right after "to") can. */
function expandNumberListItems(
  items: NumberListItem[],
  orderedSectionNumbers: readonly string[] | null,
): { sectionNumber: string; subsection: string | null }[] {
  const out: { sectionNumber: string; subsection: string | null }[] = [];
  let prevSectionNumber: string | null = null;
  for (const item of items) {
    const parsed = parseNumberToken(item.token);
    if (item.isRangeEndFromPrevious && prevSectionNumber !== null) {
      const expanded = expandRange(prevSectionNumber, parsed.sectionNumber, orderedSectionNumbers);
      for (const sectionNumber of expanded.slice(1, -1)) {
        out.push({ sectionNumber, subsection: null });
      }
    }
    out.push(parsed);
    prevSectionNumber = parsed.sectionNumber;
  }
  return out;
}

// --- external (other-Act) detection --------------------------------------

// Matches the text immediately after a number list when it names another
// statute: "... of the Canada Evidence Act" / "... of the Criminal Code" /
// "... of the Canadian Charter of Rights and Freedoms" / "... of that Act".
// Deliberately does NOT match "of this Act" (that confirms it's the *same*
// statute). Real Justice Laws text cites other statutes by names ending in
// "Act" (by far the most common), "Code" (e.g. "the Criminal Code" — a very
// common cross-reference target from other Acts), or the Charter, whose
// real name ends in "Freedoms" rather than either of those, so it gets its
// own literal alternative rather than an ending-word rule. The
// `[^.;,]{2,60}?` span allows lower-case words inside a name (e.g. "the
// Director of Public Prosecutions Act") without crossing a sentence
// boundary looking for a stray "Act"/"Code" much later in the text.
const EXTERNAL_ACT_RE =
  /^\s+of\s+(?:(?<anaphor>that)\s+(?:Act|Code|Charter)\b|the\s+(?<charter>Canadian Charter of Rights and Freedoms)\b|the\s+(?<name>[A-Z][^.;,]{2,60}?\b(?:Act|Code|Charter))\b)/;

function matchExternalStatute(followingWindow: string): { matchedSuffix: string; actNameHint: string | null } | null {
  const m = EXTERNAL_ACT_RE.exec(followingWindow);
  if (!m?.groups) return null;
  if (m.groups.anaphor) return { matchedSuffix: m[0], actNameHint: null };
  const name = (m.groups.charter ?? m.groups.name) as string;
  return { matchedSuffix: m[0], actNameHint: name.trim() };
}

// --- type classification --------------------------------------------------

// The third alternative covers real variants like "as those terms are
// defined in section 38" / "as that expression is defined in section 752"
// — "as defined in" with a subject inserted before "is/are defined in".
const DEFINITIONAL_RE =
  /(?:as defined in|within the meaning of|has the same meaning as in|as\s+\S+(?:\s+\S+){0,3}\s+(?:is|are)\s+defined\s+in)\s*$/i;
// "guilty of an offence under section X" and "... offence under any of sections X" both
// end in "offence under" (with optional "any of" filler); "punishable/liable under" are
// included for statutes that phrase it that way even though C-46 didn't happen to.
const PUNISHMENT_PRECEDING_RE = /(?:offence|punishable|liable)\s+under(?:\s+any\s+of)?\s*$/i;
// Reversed order per the spec's own phrasing: "under section X ... is guilty of an offence".
const PUNISHMENT_FOLLOWING_RE = /^[^.;]{0,60}?\bis\s+guilty\b/i;
const PROCEDURAL_RE = /(?:in accordance with|subject to|pursuant to)\s*$/i;
const REPEAL_PRECEDING_RE = /repeal\s+of\s*$/i;
const REPEAL_FOLLOWING_RE = /^\s*(?:is|are)\s+repealed\b/i;

function classifyType(precedingWindow: string, followingWindow: string): ReferenceType {
  if (DEFINITIONAL_RE.test(precedingWindow)) return "DEFINITIONAL";
  if (PUNISHMENT_PRECEDING_RE.test(precedingWindow) || PUNISHMENT_FOLLOWING_RE.test(followingWindow)) {
    return "PUNISHMENT";
  }
  if (PROCEDURAL_RE.test(precedingWindow)) return "PROCEDURAL";
  if (REPEAL_PRECEDING_RE.test(precedingWindow) || REPEAL_FOLLOWING_RE.test(followingWindow)) return "REPEAL";
  return "OTHER";
}

// --- main entry point ------------------------------------------------------

const TRIGGER_WORD_RE = /\b(?:sections?|subsections?)\s+/gi;
const PRECEDING_WINDOW_CHARS = 70;
const FOLLOWING_WINDOW_CHARS = 90;
const CONTEXT_RADIUS_CHARS = 60;

function buildContext(text: string, start: number, end: number, radius = CONTEXT_RADIUS_CHARS): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return prefix + text.slice(from, to).replace(/\s+/g, " ").trim() + suffix;
}

export interface ClassifyReferencesOptions {
  /** All section numbers of this section's own statute, in real document
   *  order (e.g. `statute.sections.map(s => s.number)`). When supplied, a
   *  "sections X to Y" range (H-04) is resolved against this real order
   *  instead of guessed at arithmetically — see expandRange. Omit when
   *  there's no whole Statute to draw it from (e.g. a standalone test
   *  section); range expansion then falls back to a conservative
   *  plain-integer walk rather than doing nothing. */
  orderedSectionNumbers?: readonly string[];
}

export function classifyReferences(
  section: StatuteSection,
  options: ClassifyReferencesOptions = {},
): ClassifyReferencesResult {
  const { text, id: sourceSectionId, statuteCode: sourceStatuteCode } = section;
  const orderedSectionNumbers = options.orderedSectionNumbers ?? null;
  const references: SectionReference[] = [];
  const externalStatuteRefs: ExternalStatuteHint[] = [];
  let occurrenceIndex = 0;

  TRIGGER_WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TRIGGER_WORD_RE.exec(text))) {
    const triggerStart = match.index;
    const numbersStart = TRIGGER_WORD_RE.lastIndex;
    const { items, endIndex } = extractNumberList(text, numbersStart);

    // e.g. "subject to subsection (4)" — a bare same-section subsection
    // number with no leading digit. Not a cross-section edge; skip.
    if (items.length === 0) continue;

    const matchedText = text.slice(triggerStart, endIndex);
    const precedingWindow = text.slice(Math.max(0, triggerStart - PRECEDING_WINDOW_CHARS), triggerStart);
    const followingWindow = text.slice(endIndex, endIndex + FOLLOWING_WINDOW_CHARS);
    // Computed before the external-Act branch below: "as defined in section
    // 2 of the Interpretation Act" is still DEFINITIONAL in phrasing even
    // though it points at another statute — the graph (step 5) needs that
    // for edge coloring regardless of which statute the target lands in.
    const type = classifyType(precedingWindow, followingWindow);
    const context = buildContext(text, triggerStart, endIndex);

    const external = matchExternalStatute(followingWindow);
    // A cross-statute range ("sections 5 to 8 of the Interpretation Act")
    // can't be validated against *this* statute's section order — that
    // order belongs to a different, unloaded statute — so only the safe
    // plain-integer fallback (never the order-based lookup) ever applies
    // to it.
    const targets = expandNumberListItems(items, external ? null : orderedSectionNumbers);

    if (external) {
      const fullMatchedText = matchedText + external.matchedSuffix;
      for (const { sectionNumber, subsection } of targets) {
        externalStatuteRefs.push({
          sourceSectionId,
          matchedText: fullMatchedText,
          actNameHint: external.actNameHint,
          targetSectionNumber: sectionNumber,
          targetSubsection: subsection,
          type,
        });
      }
      continue;
    }

    for (const { sectionNumber, subsection } of targets) {
      occurrenceIndex += 1;
      references.push({
        id: `${sourceSectionId}->${sectionNumber}#${occurrenceIndex}`,
        sourceSectionId,
        sourceStatuteCode,
        targetSectionNumber: sectionNumber,
        targetSubsection: subsection,
        type,
        matchedText,
        context,
      });
    }
  }

  return { references, externalStatuteRefs };
}
