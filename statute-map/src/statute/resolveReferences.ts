import type { Statute, StatuteSection } from "./types";
import { classifyReferences, type SectionReference } from "./classifyReferences";

/**
 * Builds the (single-statute) reference graph and walks it two ways:
 *
 * - `resolveDefinitionalChain` follows DEFINITIONAL edges from one section
 *   outward (A refers to B refers to C), producing the full unrolled tree
 *   of what a section's definitions depend on — flagging cycles and
 *   sections that aren't part of the loaded statute (ghosts) as it goes.
 * - `findCycles` audits the *whole* graph (any edge type, by default) for
 *   circular references, independent of any particular starting section.
 *
 * Scope note: edges here only ever point within the same statute — that's
 * all classifyReferences (step 2) produces. Multi-statute graphs are step
 * 4/6's job; this module doesn't need to know about `externalStatuteRefs`
 * at all.
 */

export interface ReferenceGraph {
  sections: Map<string, StatuteSection>;
  /** sectionId -> its outgoing same-statute references. */
  edges: Map<string, SectionReference[]>;
}

export function buildReferenceGraph(statute: Statute): ReferenceGraph {
  const sections = new Map<string, StatuteSection>();
  const edges = new Map<string, SectionReference[]>();
  // Real document order, so a "sections X to Y" range (H-04) resolves
  // against what's actually there instead of being guessed at.
  const orderedSectionNumbers = statute.sections.map((s) => s.number);
  for (const section of statute.sections) {
    sections.set(section.id, section);
    edges.set(section.id, classifyReferences(section, { orderedSectionNumbers }).references);
  }
  return { sections, edges };
}

function targetSectionId(ref: SectionReference): string {
  return `${ref.sourceStatuteCode}:${ref.targetSectionNumber}`;
}

// --- recursive definitional resolution -------------------------------------

export interface DefinitionalChainStep {
  sectionId: string;
  /** false when this id isn't in the loaded statute — a ghost target this
   *  chain can't expand any further (no text/edges available for it). */
  resolved: boolean;
  /** The DEFINITIONAL reference that led here from its parent; null for the root. */
  via: SectionReference | null;
  /** How many hops from the root (root = 0). */
  depth: number;
  /** true if this step is where the walk re-encountered a section already
   *  on the current path — the loop is recorded in `cycles` and this
   *  branch stops here rather than recursing forever. */
  closesCycle: boolean;
  /** true if this branch was cut off by the depth guard rather than by
   *  running out of edges or hitting a cycle (defensive circuit breaker
   *  for pathological/unexpected data, not something real chains should
   *  ever hit). */
  truncated: boolean;
}

export interface DefinitionalChainResult {
  rootSectionId: string;
  /** Every step in DFS order, root first. Note this is a fully unrolled
   *  TREE, not a deduped DAG: a section reached via two different parents
   *  (a "diamond") appears twice, once per branch, since each occurrence
   *  has a different `via` explaining why it's relevant on that branch. */
  steps: DefinitionalChainStep[];
  /** Distinct cycles found while walking, each as the ordered section ids
   *  forming the loop (first === last). */
  cycles: string[][];
}

const DEFAULT_MAX_DEPTH = 50;

export function resolveDefinitionalChain(
  graph: ReferenceGraph,
  rootSectionId: string,
  options: { maxDepth?: number } = {}
): DefinitionalChainResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const steps: DefinitionalChainStep[] = [];
  const cycles: string[][] = [];
  const pathStack: string[] = [];

  function walk(sectionId: string, via: SectionReference | null, depth: number): void {
    const cycleStartIndex = pathStack.indexOf(sectionId);
    if (cycleStartIndex !== -1) {
      cycles.push([...pathStack.slice(cycleStartIndex), sectionId]);
      steps.push({
        sectionId,
        resolved: graph.sections.has(sectionId),
        via,
        depth,
        closesCycle: true,
        truncated: false,
      });
      return;
    }

    const resolved = graph.sections.has(sectionId);
    if (depth > maxDepth) {
      steps.push({ sectionId, resolved, via, depth, closesCycle: false, truncated: true });
      return;
    }

    steps.push({ sectionId, resolved, via, depth, closesCycle: false, truncated: false });
    if (!resolved) return; // ghost — no text/edges to expand

    pathStack.push(sectionId);
    const seenTargets = new Set<string>();
    for (const ref of graph.edges.get(sectionId) ?? []) {
      if (ref.type !== "DEFINITIONAL") continue;
      const tId = targetSectionId(ref);
      if (seenTargets.has(tId)) continue; // don't re-walk the same target twice for one section's own multiple mentions of it
      seenTargets.add(tId);
      walk(tId, ref, depth + 1);
    }
    pathStack.pop();
  }

  walk(rootSectionId, null, 0);
  return { rootSectionId, steps, cycles };
}

// --- whole-graph cycle detection --------------------------------------------

export interface GraphCycle {
  /** section ids forming the loop, in order, first === last. */
  path: string[];
  /** the reference edges connecting each consecutive pair in `path`. */
  edges: SectionReference[];
}

/**
 * Standard DFS back-edge cycle detection: finds one representative cycle
 * per back edge encountered. For a sparse, mostly-acyclic graph like a
 * statute's cross-references this is a complete audit; it is NOT an
 * exhaustive enumeration of every simple cycle in a pathological
 * densely-interconnected graph (that's combinatorial and not what a
 * "flag circular references" feature needs).
 */
export function findCycles(graph: ReferenceGraph, options: { types?: SectionReference["type"][] } = {}): GraphCycle[] {
  const typeFilter = options.types;
  const color = new Map<string, "gray" | "black">();
  const pathStack: string[] = [];
  const edgeStack: SectionReference[] = [];
  const found: GraphCycle[] = [];
  const seenKeys = new Set<string>();

  function edgesFrom(id: string): SectionReference[] {
    const all = graph.edges.get(id) ?? [];
    return typeFilter ? all.filter((r) => typeFilter.includes(r.type)) : all;
  }

  function dfs(id: string): void {
    color.set(id, "gray");
    pathStack.push(id);
    for (const ref of edgesFrom(id)) {
      const tId = targetSectionId(ref);
      if (!graph.sections.has(tId)) continue; // ghost target — can't form a cycle through unloaded data
      const c = color.get(tId);
      if (c === undefined) {
        edgeStack.push(ref);
        dfs(tId);
        edgeStack.pop();
      } else if (c === "gray") {
        const idx = pathStack.indexOf(tId);
        const path = [...pathStack.slice(idx), tId];
        const edges = [...edgeStack.slice(idx), ref];
        const key = canonicalCycleKey(path);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          found.push({ path, edges });
        }
      }
      // "black": already fully explored elsewhere — no new cycle info.
    }
    pathStack.pop();
    color.set(id, "black");
  }

  for (const id of graph.sections.keys()) {
    if (!color.has(id)) dfs(id);
  }

  return found;
}

function canonicalCycleKey(path: string[]): string {
  const ring = path.slice(0, -1); // drop the closing element (equals the first)
  let minIdx = 0;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i] < ring[minIdx]) minIdx = i;
  }
  return [...ring.slice(minIdx), ...ring.slice(0, minIdx)].join("|");
}
