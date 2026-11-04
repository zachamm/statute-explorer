/**
 * Core data model for a parsed federal statute.
 *
 * These types describe the *parsing* layer only (step 1). Reference
 * extraction/classification (step 2+) will add fields on top of this
 * (e.g. an array of References per section) rather than changing what's
 * here, so keep this module free of anything reference-related.
 */

/** A single enacted section of a statute, flattened to plain text. */
export interface StatuteSection {
  /** Stable id: `${statuteCode}:${number}`, e.g. "C-46:265". Used as the
   *  graph node id once we get to rendering. */
  id: string;
  /** Consolidated statute code this section belongs to, e.g. "C-46". */
  statuteCode: string;
  /** The section's own label as printed, e.g. "2", "265", "487.011". */
  number: string;
  /** The MarginalNote directly on the Section element, if any (e.g. "Assault"). */
  marginalNote: string | null;
  /** Full flattened body text of the section (all subsections, paragraphs,
   *  definitions, etc.), with original numbering like "(1)", "(a)" kept
   *  inline. HistoricalNote/amendment citations are stripped — they aren't
   *  part of the enacted text and would pollute later regex matching. */
  text: string;
  /** Breadcrumb of enclosing Part/Heading titles in document order, e.g.
   *  ["PART VIII — Offences Against the Person and Reputation", "Assaults"]. */
  headingPath: string[];
}

/** A fully parsed statute: metadata plus its flattened sections. */
export interface Statute {
  /** Consolidated number / Justice Laws code, e.g. "C-46". */
  code: string;
  shortTitle: string;
  longTitle: string;
  /** The Justice Laws XML URL this statute was fetched from. */
  sourceUrl: string;
  /** ISO timestamp of when this statute was fetched/parsed. */
  fetchedAt: string;
  sections: StatuteSection[];
}
