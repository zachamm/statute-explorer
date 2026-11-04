import type { Statute, StatuteSection } from "../statute/types";
import { classifyReferences, type ReferenceType } from "../statute/classifyReferences";
import { resolveCrossStatuteReferences } from "../statute/resolveCrossStatute";

/**
 * Turns one or more parsed Statutes into a renderable graph: nodes =
 * sections (real, or "ghost" placeholders for anything referenced but not
 * loaded), edges = references, typed for color-coding.
 *
 * Takes an array of Statutes (not just one) so a reference that resolves
 * to a statute the caller *has* loaded lands on a real node instead of a
 * ghost, even though today's callers (steps 1-4) only ever load one at a
 * time — the multi-statute project layer is step 6, this just shouldn't
 * need rework when that arrives.
 */

export interface SectionGraphNode {
  kind: "section";
  id: string;
  statuteCode: string;
  number: string;
  marginalNote: string | null;
  text: string;
  headingPath: string[];
}

/** A reference target that isn't part of any loaded statute — either a
 *  same-statute section outside the loaded subset, or a cross-statute
 *  reference to a statute that isn't loaded (or whose name didn't match
 *  anything in the lookup table at all). Never silently dropped. */
export interface GhostGraphNode {
  kind: "ghost";
  id: string;
  /** Known statute code, if the target statute is known even though it
   *  isn't loaded (e.g. resolved via the lookup table). Null when even
   *  the Act's identity is unknown (an unresolved name, or an anaphoric
   *  "of that Act" with nothing to resolve it against). */
  statuteCode: string | null;
  /** Human-readable label for the ghost's Act, e.g. "Canada Evidence Act"
   *  — either the lookup table's canonical name or the raw name as
   *  written in the source text. Null when nothing is known at all. */
  statuteName: string | null;
  number: string | null;
}

export type GraphNode = SectionGraphNode | GhostGraphNode;

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: ReferenceType;
  matchedText: string;
  context: string;
  crossStatute: boolean;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Classifying every section of a large statute is the slow part of building
// the graph, and a section's text never changes, so this only ever happens
// once per section however many times the graph is rebuilt around it.
const classifiedBySection = new WeakMap<StatuteSection, ReturnType<typeof classifyReferences>>();

function classifySections(statute: Statute): Array<ReturnType<typeof classifyReferences>> {
  // Real document order, so a "sections X to Y" range (H-04) resolves
  // against what's actually there instead of being guessed at.
  const orderedSectionNumbers = statute.sections.map((s) => s.number);
  return statute.sections.map((section) => {
    let classified = classifiedBySection.get(section);
    if (!classified) {
      classified = classifyReferences(section, { orderedSectionNumbers });
      classifiedBySection.set(section, classified);
    }
    return classified;
  });
}

function sectionNode(section: StatuteSection): SectionGraphNode {
  return {
    kind: "section",
    id: section.id,
    statuteCode: section.statuteCode,
    number: section.number,
    marginalNote: section.marginalNote,
    text: section.text,
    headingPath: section.headingPath,
  };
}

export function buildGraphModel(statutes: Statute[]): GraphModel {
  const nodesById = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // Pass 1: every loaded section becomes a real node, up front — so later
  // passes can tell a genuinely-missing target apart from one that's just
  // not been processed yet.
  for (const statute of statutes) {
    for (const section of statute.sections) {
      nodesById.set(section.id, sectionNode(section));
    }
  }

  for (const statute of statutes) {
    for (const { references, externalStatuteRefs } of classifySections(statute)) {

      // Pass 2: same-statute references.
      for (const ref of references) {
        const targetId = `${ref.sourceStatuteCode}:${ref.targetSectionNumber}`;
        if (!nodesById.has(targetId)) {
          nodesById.set(targetId, {
            kind: "ghost",
            id: targetId,
            statuteCode: ref.sourceStatuteCode,
            statuteName: null,
            number: ref.targetSectionNumber,
          });
        }
        edges.push({
          id: ref.id,
          source: ref.sourceSectionId,
          target: targetId,
          type: ref.type,
          matchedText: ref.matchedText,
          context: ref.context,
          crossStatute: false,
        });
      }

      // Pass 3: cross-statute references, resolved against the lookup table.
      for (const ref of resolveCrossStatuteReferences(externalStatuteRefs)) {
        const targetId = ref.statute
          ? `${ref.statute.code}:${ref.targetSectionNumber}`
          : `external:${ref.actName ?? "unknown-act"}:${ref.targetSectionNumber}`;

        if (!nodesById.has(targetId)) {
          nodesById.set(targetId, {
            kind: "ghost",
            id: targetId,
            statuteCode: ref.statute?.code ?? null,
            statuteName: ref.statute?.name ?? ref.actName,
            number: ref.targetSectionNumber,
          });
        }
        edges.push({
          id: `${ref.sourceSectionId}->${targetId}`,
          source: ref.sourceSectionId,
          target: targetId,
          type: ref.type,
          matchedText: ref.matchedText,
          context: ref.matchedText,
          crossStatute: true,
        });
      }
    }
  }

  return { nodes: [...nodesById.values()], edges };
}

/** All edges pointing *at* a node — "what references it", for the
 *  click-through detail panel. */
export function incomingEdges(model: GraphModel, nodeId: string): GraphEdge[] {
  return model.edges.filter((e) => e.target === nodeId);
}

/** All edges pointing *out of* a node. */
export function outgoingEdges(model: GraphModel, nodeId: string): GraphEdge[] {
  return model.edges.filter((e) => e.source === nodeId);
}

/** How many times each node is referenced (in-degree), keyed by node id.
 *  Nodes with no incoming edges at all are simply absent from the map —
 *  callers should treat a missing key as 0. Used to scale node size by
 *  "how often is this cited" in the renderer. */
export function computeIncomingCounts(model: GraphModel): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of model.edges) {
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  }
  return counts;
}
