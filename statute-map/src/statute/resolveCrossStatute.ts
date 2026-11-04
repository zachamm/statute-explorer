import type { Statute } from "./types";
import { classifyReferences, type ExternalStatuteHint, type ReferenceType } from "./classifyReferences";
import { findStatuteByName, type StatuteLookupEntry } from "./lookup";

/**
 * Resolves the "this points at some other Act" hints that classifyReferences
 * (step 2) already separated out from same-statute references, by matching
 * the named Act against the local lookup table.
 *
 * Two things happen here that step 2 deliberately left undone, because
 * neither is "extract and classify a single reference" — they need to see
 * hints in relation to each other or to an external table:
 *
 *  1. Anaphoric "of that Act" mentions (`actNameHint: null`) are resolved
 *     against the nearest *earlier* named Act in the same section's text,
 *     in document order — e.g. "... as defined in section 2 of the
 *     Integrated Cross-border Law Enforcement Operations Act, when (i)
 *     ... as defined in section 2 of that Act" resolves "that Act" to the
 *     Integrated Cross-border Law Enforcement Operations Act. This is a
 *     real pattern in the Criminal Code (see section 2's "associated
 *     personnel" wording). Scope is deliberately limited to one section —
 *     cross-section anaphora would need discourse tracking this app has
 *     no reliable signal for.
 *  2. The resolved name is looked up in STATUTE_LOOKUP. A miss (a real Act
 *     name that simply isn't in our small local table) is not an error —
 *     it's recorded as `statute: null` so the caller (the graph/ghost-node
 *     layer, later steps) can decide how to represent an unresolvable
 *     external reference rather than this module guessing.
 */

export interface CrossStatuteReference {
  sourceSectionId: string;
  /** The Act name actually used to resolve this reference — either as
   *  written at this occurrence, or (see `anaphoricallyResolved`) recovered
   *  from an earlier occurrence in the same section. Null when this was an
   *  anaphoric "of that Act" with no earlier named Act to resolve against. */
  actName: string | null;
  /** True when `actName` came from resolving "of that Act" against an
   *  earlier mention in the same section, not named at this occurrence. */
  anaphoricallyResolved: boolean;
  /** The section number cited in the other Act, e.g. "38" in "section 38
   *  of the Canada Evidence Act". */
  targetSectionNumber: string;
  targetSubsection: string | null;
  /** The raw matched phrase from the source text. */
  matchedText: string;
  /** Classified the same way as a same-statute reference, from the same
   *  surrounding phrase (e.g. still DEFINITIONAL even though the target
   *  is in another Act). */
  type: ReferenceType;
  /** The lookup table match, or null when `actName` isn't a name in our
   *  table (including when `actName` itself is null). */
  statute: StatuteLookupEntry | null;
}

/** Resolves one section's external-statute hints. Anaphora tracking
 *  ("of that Act") is scoped to the hints passed in, in order — call this
 *  once per section, not once for a whole statute's hints concatenated
 *  together, or "that Act" could resolve across a section boundary. */
export function resolveCrossStatuteReferences(externalRefs: ExternalStatuteHint[]): CrossStatuteReference[] {
  let lastNamedAct: string | null = null;
  const results: CrossStatuteReference[] = [];

  for (const ref of externalRefs) {
    let actName: string | null;
    let anaphoricallyResolved: boolean;

    if (ref.actNameHint !== null) {
      actName = ref.actNameHint;
      anaphoricallyResolved = false;
      lastNamedAct = ref.actNameHint;
    } else if (lastNamedAct !== null) {
      actName = lastNamedAct;
      anaphoricallyResolved = true;
    } else {
      // "of that Act" with nothing earlier in this section to resolve it against.
      actName = null;
      anaphoricallyResolved = false;
    }

    results.push({
      sourceSectionId: ref.sourceSectionId,
      actName,
      anaphoricallyResolved,
      targetSectionNumber: ref.targetSectionNumber,
      targetSubsection: ref.targetSubsection,
      matchedText: ref.matchedText,
      type: ref.type,
      statute: actName ? findStatuteByName(actName) : null,
    });
  }

  return results;
}

/** Runs classifyReferences + resolveCrossStatuteReferences across every
 *  section of a statute, section-by-section (so anaphora stays correctly
 *  scoped per section). */
export function resolveCrossStatuteReferencesForStatute(statute: Statute): CrossStatuteReference[] {
  const all: CrossStatuteReference[] = [];
  for (const section of statute.sections) {
    const { externalStatuteRefs } = classifyReferences(section);
    all.push(...resolveCrossStatuteReferences(externalStatuteRefs));
  }
  return all;
}
