import * as d3 from "d3";
import type { GraphEdge, GraphModel, GraphNode } from "./model";
import { computeIncomingCounts, incomingEdges, outgoingEdges } from "./model";
import type { ReferenceType } from "../statute/classifyReferences";

/**
 * d3 force-directed graph: nodes = sections (real, filled by statute-of-
 * origin) or ghosts (greyed-out, dashed — a reference target that isn't
 * loaded), edges = references, colored by ReferenceType. Pan/zoom, drag,
 * and a click callback for the detail panel are the only interactions —
 * everything else (styling polish, legends-as-UI-chrome) is deliberately
 * left for later per the "UX later" instruction.
 *
 * Node placement has two layers, both explained in full in the README
 * ("How node placement works"):
 *  1. Semantic anchoring — every node is pulled toward a target point
 *     determined by its statute (outer ring of cluster centers) and,
 *     within a statute, its top-level Part/heading (a smaller ring
 *     around that statute's center). This is a real, fixed grouping —
 *     not emergent from the physics alone.
 *  2. Physics on top of that — link/charge/collision forces still run,
 *     so within a semantic cluster, actually-connected sections pull
 *     closer to each other and nothing overlaps.
 * Node *size* is separate from placement: it scales with in-degree (how
 * many other loaded sections reference this one), via computeIncomingCounts.
 *
 * The physics setup (buildSimulation) is deliberately DOM-free and
 * exported on its own — d3-force operates on plain JS objects, so it can
 * be unit-tested directly (real convergence, real node counts, asserting
 * zero overlap) without a browser. renderGraph() below is the only part
 * that touches the DOM/SVG.
 */

export const REFERENCE_TYPE_COLORS: Record<ReferenceType, string> = {
  DEFINITIONAL: "#4f7cff",
  PUNISHMENT: "#ef4444",
  PROCEDURAL: "#f59e0b",
  REPEAL: "#a855f7",
  OTHER: "#8b8b98",
};

/** H-06: every reference type previously used the same solid, same-width
 *  line — color was the *only* thing telling them apart, which fails for
 *  color-blind users (red/orange, the two hardest-to-distinguish hues for
 *  the most common form, are two different types here). A distinct
 *  `stroke-dasharray` per type means the same information survives in
 *  grayscale or a color-blind simulation. `null` (DEFINITIONAL, the most
 *  common type) renders as a plain solid line — reusing the same dashed
 *  convention already used well for ghost nodes' outline (`"3,2"`). Shared
 *  by both the graph's own edges and the legend's line swatches (main.ts)
 *  so the two can never drift apart. */
export const REFERENCE_TYPE_DASH: Record<ReferenceType, string | null> = {
  DEFINITIONAL: null,
  PUNISHMENT: "7,3",
  PROCEDURAL: "1,3",
  REPEAL: "7,3,1,3",
  OTHER: "2,2",
};

/** Short, plain-language gloss of what each ReferenceType actually means —
 *  shown as a hover tooltip on the legend (see main.ts's renderLegend), so
 *  someone doesn't have to already know classifyReferences.ts's phrasing
 *  rules to know what "PROCEDURAL" is standing in for. Kept in sync with
 *  classifyType()'s real trigger patterns there, not just a vibe. */
export const REFERENCE_TYPE_DESCRIPTIONS: Record<ReferenceType, string> = {
  DEFINITIONAL: "A term here is defined by, or has the same meaning as, the target section.",
  PUNISHMENT: "The target section sets the offence or penalty for contravening this one.",
  PROCEDURAL: "This is done \"in accordance with\", \"subject to\", or \"pursuant to\" the target section.",
  REPEAL: "The target section is being repealed or substituted.",
  OTHER: "Cites the target section, but not in a way that matches the other four patterns.",
};

const GHOST_COLOR = "#71717a";
// Dark enough for the white node labels to stay readable on every one.
const STATUTE_COLOR_SCALE = d3.scaleOrdinal<string, string>([
  "#4f46e5", "#d97706", "#059669", "#e11d48", "#0284c7", "#9333ea", "#0d9488", "#ea580c", "#4d7c0f", "#db2777",
]);

// Node radius: a small fixed base (so even an uncited node reads as a node)
// plus a sqrt-scaled amount driven by in-degree — sqrt so the circle's
// *area* (not just its radius) scales roughly linearly with reference
// count, which is the perceptually honest way to size things by count.
const BASE_RADIUS: Record<GraphNode["kind"], number> = { section: 9, ghost: 7 };
const MAX_EXTRA_RADIUS = 16;

// The node label's font size is fixed (see the "text" element below) —
// deliberately never scaled per-node, so every label reads at the same
// size regardless of that node's radius. That means a long label (a
// subsection number like "529.4") needs a wider circle to fit inside it
// with margin, not a smaller font, or it just overflows the bubble on the
// low-reference-count nodes that don't already get sized up. LABEL_CHAR_WIDTH
// is the advance width of one monospace character at that font size (the
// "ui-monospace, monospace" stack — the generic "monospace" fallback is a
// CSS-guaranteed fixed-width family, so a flat per-character estimate is
// accurate here in a way it wouldn't be for a proportional font).
const LABEL_FONT_SIZE = 9;
const LABEL_CHAR_WIDTH = LABEL_FONT_SIZE * 0.62;
const LABEL_MARGIN = 4;

/** The smallest radius a circle can be and still fit `label` (at the fixed
 *  node-label font size) inside it with LABEL_MARGIN of breathing room on
 *  each side — the minimum a bubble can shrink to before its own number
 *  starts pushing past its edge. Exported and pure so this is directly
 *  testable without rendering anything. */
export function minRadiusForLabel(label: string): number {
  return (label.length * LABEL_CHAR_WIDTH) / 2 + LABEL_MARGIN;
}
// Collision gets a little headroom beyond the drawn radius so circles
// never even visually touch, let alone overlap.
const COLLISION_PADDING = 2;
// How far short of the target node's true center an edge's line (and
// therefore its arrowhead) stops — the node's own drawn radius plus this
// gap. Node radius is now variable (scaled by reference count), so this
// has to be computed per-edge from the actual target; a fixed marker
// offset (the old approach) would draw the arrowhead exactly this far
// from the *center* regardless of that node's real size, hiding it
// under any node whose radius exceeds the offset.
const ARROW_GAP = 4;

// Not something a statute code would plausibly be, so it can't collide
// with a real one — the shared cluster point for ghosts whose target
// Act's identity isn't even known (an unresolved cross-statute name).
const UNRESOLVED_STATUTE_KEY = "__unresolved__";

function nodeFillColor(node: GraphNode): string {
  if (node.kind === "ghost") return GHOST_COLOR;
  return STATUTE_COLOR_SCALE(node.statuteCode);
}

/** The color a given statute's real (non-ghost) section nodes are drawn
 *  in — the exact same lookup nodeFillColor() uses internally, exported so
 *  a legend built elsewhere (main.ts's "by statute" key) always shows the
 *  graph's real node colors rather than a separately-derived guess that
 *  could drift out of sync. Safe to call before or after the graph has
 *  actually rendered: STATUTE_COLOR_SCALE is a module-level singleton, and
 *  d3's ordinal scales assign a color to a domain value once and return
 *  that same color on every later lookup, regardless of call order. Ghosts
 *  have no statute-specific color (always grey — see nodeFillColor), so
 *  this is only meaningful for a real, loaded statute's code. */
export function statuteNodeColor(code: string): string {
  return STATUTE_COLOR_SCALE(code);
}

/** Exported (not just used for the SVG hover `<title>`) so main.ts's
 *  keyboard-activation status announcement (C-03 §1.3b) reuses the exact
 *  same text a node's own `aria-label` is built from — the two can never
 *  drift apart since they're the same function. */
export function nodeLabel(node: GraphNode): string {
  if (node.kind === "section") {
    return `${node.statuteCode} s. ${node.number}${node.marginalNote ? `: ${node.marginalNote}` : ""}`;
  }
  const act = node.statuteName ?? "an unresolved Act";
  return `${act} s. ${node.number ?? "?"} (not loaded)`;
}

/** A node's screen-reader identity (C-03 §1.3a) — `nodeLabel()` plus, for a
 *  real section, how many sections cite it and how many it cites. Ghosts
 *  keep nodeLabel()'s existing "(not loaded)" phrasing verbatim with no
 *  added counts (a ghost has no outgoing edges at all — classifyReferences
 *  only ever runs on loaded sections — and the visible UI doesn't show
 *  ghost counts either, so this matches what a sighted user already sees).
 *  `incomingCounts`/`outgoingCounts` are pre-computed once for the whole
 *  model (see buildAccessibilityAttrs) rather than each node re-deriving
 *  its own via incomingEdges/outgoingEdges — O(1) per node instead of
 *  O(edges) per node, the difference that matters at ~1,700 nodes. */
function nodeAriaLabel(node: GraphNode, incomingCounts: Map<string, number>, outgoingCounts: Map<string, number>): string {
  if (node.kind === "ghost") return nodeLabel(node);
  const citedBy = incomingCounts.get(node.id) ?? 0;
  const cites = outgoingCounts.get(node.id) ?? 0;
  return `${nodeLabel(node)}. Cited by ${citedBy} section${citedBy === 1 ? "" : "s"}, cites ${cites} section${cites === 1 ? "" : "s"}.`;
}

/** The key used to group a node into its outer (statute-level) cluster. */
export function statuteClusterKey(node: GraphNode): string {
  if (node.kind === "section") return node.statuteCode;
  return node.statuteCode ?? UNRESOLVED_STATUTE_KEY;
}

/** The key used to group a node into its inner (Part-level) sub-cluster,
 *  within its statute cluster. Ghosts have no section text to derive a
 *  Part from, so they just sit at their statute's center (null = no
 *  sub-cluster, use the statute's own point). */
export function partClusterKey(node: GraphNode): string | null {
  return node.kind === "section" ? (node.headingPath[0] ?? null) : null;
}

export interface Point {
  x: number;
  y: number;
}

// "::" is not something a statute code or a heading's title text would
// plausibly contain, so joining two keys with it can't collide with a
// different (statuteKey, partKey) pair that happens to concatenate to
// the same string.
export function subClusterKey(statuteKey: string, partKey: string): string {
  return `${statuteKey}::${partKey}`;
}

/** Computes a fixed target point for every node: statutes arranged on an
 *  outer ring around the canvas center (or dead center, for a single
 *  statute), and — within each statute — its distinct top-level Parts
 *  arranged on a smaller ring around that statute's point. This is what
 *  makes placement semantic rather than purely emergent: two sections in
 *  the same Part of the same statute start out, and keep getting pulled
 *  back toward, the same neighborhood. Exported and pure so the
 *  clustering itself is directly testable, no simulation required. */
export function computeClusterTargets(nodes: GraphNode[], width: number, height: number): Map<string, Point> {
  const center: Point = { x: width / 2, y: height / 2 };
  const targets = new Map<string, Point>();

  const statuteKeys = [...new Set(nodes.map(statuteClusterKey))].sort();
  const statuteRingRadius = Math.min(width, height) * 0.32;
  const statuteCenters = new Map<string, Point>();

  statuteKeys.forEach((key, i) => {
    if (statuteKeys.length === 1) {
      statuteCenters.set(key, center);
      return;
    }
    const angle = (i / statuteKeys.length) * 2 * Math.PI - Math.PI / 2;
    statuteCenters.set(key, {
      x: center.x + statuteRingRadius * Math.cos(angle),
      y: center.y + statuteRingRadius * Math.sin(angle),
    });
  });

  for (const key of statuteKeys) {
    const statuteCenter = statuteCenters.get(key)!;
    const partKeys = [...new Set(nodes.filter((n) => statuteClusterKey(n) === key).map(partClusterKey))].filter(
      (k): k is string => k !== null
    );
    const partRingRadius = Math.min(statuteRingRadius * 0.5, 110);

    partKeys.forEach((partKey, i) => {
      const angle = (i / Math.max(partKeys.length, 1)) * 2 * Math.PI - Math.PI / 2;
      targets.set(subClusterKey(key, partKey), {
        x: statuteCenter.x + (partKeys.length > 1 ? partRingRadius * Math.cos(angle) : 0),
        y: statuteCenter.y + (partKeys.length > 1 ? partRingRadius * Math.sin(angle) : 0),
      });
    });
    targets.set(key, statuteCenter);
  }

  return targets;
}

function targetFor(node: GraphNode, clusterTargets: Map<string, Point>, fallback: Point): Point {
  const statuteKey = statuteClusterKey(node);
  const partKey = partClusterKey(node);
  if (partKey !== null) {
    const point = clusterTargets.get(subClusterKey(statuteKey, partKey));
    if (point) return point;
  }
  return clusterTargets.get(statuteKey) ?? fallback;
}

/** Where an edge's drawn line should stop: pulled back from the target's
 *  true center by its radius + a small gap, along the source→target
 *  direction — so the line (and the arrowhead marker drawn at its end)
 *  stops right at that node's actual edge, whatever its size, instead of
 *  running through its center. A fixed marker offset can't do this on
 *  its own once node radius varies by node (the bug this fixes: a large
 *  node's fill hid the arrowhead because the old fixed offset undershot
 *  its edge). Degenerates to the target's own position — rather than
 *  dividing by a zero distance — if source and target coincide. Pure and
 *  exported so this geometry is unit-testable without a DOM. */
export function computeLineEndpoint(source: Point, target: Point, targetRadius: number, gap: number): Point {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return target;
  const pullback = targetRadius + gap;
  return {
    x: target.x - (dx / dist) * pullback,
    y: target.y - (dy / dist) * pullback,
  };
}

export interface SimNode extends d3.SimulationNodeDatum {
  node: GraphNode;
  id: string;
  radius: number;
}

export interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  edge: GraphEdge;
}

/** Computes each node's drawn radius: a base size by kind, plus a
 *  sqrt-scaled amount proportional to how many times it's referenced.
 *  Pure and exported so size-by-reference-count is directly testable. */
export function computeNodeRadii(model: GraphModel): Map<string, number> {
  const incomingCounts = computeIncomingCounts(model);
  const maxIncoming = Math.max(0, ...model.nodes.map((n) => incomingCounts.get(n.id) ?? 0));
  const extraRadiusScale = d3
    .scaleSqrt()
    .domain([0, maxIncoming || 1])
    .range([0, MAX_EXTRA_RADIUS])
    .clamp(true);

  const radii = new Map<string, number>();
  for (const node of model.nodes) {
    const sizeByReferenceCount = BASE_RADIUS[node.kind] + extraRadiusScale(incomingCounts.get(node.id) ?? 0);
    // Whichever is bigger wins: a heavily-cited node is already sized well
    // past what its label needs, so this only ever pushes up the small,
    // rarely-referenced nodes whose base radius wouldn't otherwise leave
    // room for a long subsection number.
    radii.set(node.id, Math.max(sizeByReferenceCount, minRadiusForLabel(node.number ?? "?")));
  }
  return radii;
}

/** Builds the force simulation (nodes, links, and every force) with no
 *  DOM involved at all — d3-force works on plain objects. renderGraph()
 *  below layers SVG rendering on top of this; tests can drive this
 *  directly to assert on real convergence (no overlaps, correct
 *  clustering) without a browser. */
export function buildSimulation(
  model: GraphModel,
  width: number,
  height: number
): { simulation: d3.Simulation<SimNode, SimLink>; simNodes: SimNode[]; simLinks: SimLink[] } {
  const radii = computeNodeRadii(model);

  const simNodes: SimNode[] = model.nodes.map((node) => ({
    node,
    id: node.id,
    radius: radii.get(node.id)!,
  }));
  const simLinks: SimLink[] = model.edges.map((edge) => ({
    edge,
    source: edge.source,
    target: edge.target,
  }));

  const clusterTargets = computeClusterTargets(model.nodes, width, height);
  const fallbackCenter: Point = { x: width / 2, y: height / 2 };

  const simulation = d3
    .forceSimulation(simNodes)
    .force(
      "link",
      d3
        .forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance(90)
        .strength(0.35)
    )
    .force("charge", d3.forceManyBody().strength(-220))
    // Pulls each node toward its statute/Part cluster point — the
    // "semantic" part of the layout (see computeClusterTargets above).
    .force(
      "clusterX",
      d3.forceX<SimNode>((d) => targetFor(d.node, clusterTargets, fallbackCenter).x).strength(0.15)
    )
    .force(
      "clusterY",
      d3.forceY<SimNode>((d) => targetFor(d.node, clusterTargets, fallbackCenter).y).strength(0.15)
    )
    .force(
      "collide",
      d3
        .forceCollide<SimNode>((d) => d.radius + COLLISION_PADDING)
        .iterations(3) // denser semantic clusters need more passes to fully separate
    );

  return { simulation, simNodes, simLinks };
}

export interface GraphHandle {
  /** Stops the force simulation and clears the container's contents. */
  destroy(): void;
  /** Re-centers/re-heats the layout (useful after a resize). */
  reheat(): void;
  /** Pans/zooms the camera to center on a node (e.g. one just opened from
   *  the detail panel, or handed off from a deep link) and rings it with a
   *  brief pulse so it's findable among a few hundred identical-looking
   *  circles. If the simulation is still actively settling, the camera
   *  keeps tracking the node tick-by-tick until it stops (or the user
   *  manually pans/zooms, which cancels tracking) rather than aiming at a
   *  position the node has already drifted away from. No-op if the node
   *  isn't in this graph. */
  focusNode(nodeId: string): void;
  /** Pans/zooms the camera to fit every loaded (real, non-ghost) section of
   *  a statute on screen at once — e.g. clicking that statute in the
   *  sidebar's loaded-statutes list. Tracks tick-by-tick like focusNode()
   *  while the cluster is still settling, and is mutually exclusive with
   *  it (focusing a statute cancels a single-node focus and vice versa —
   *  only the most recent request drives the camera). No-op if the statute
   *  has no real nodes in this graph. */
  focusStatute(code: string): void;
  /** Updates the svg's own width/height/viewBox to match the container's
   *  new actual pixel size — e.g. after #graphArea reflows because the
   *  detail panel opened or closed — WITHOUT touching node positions, the
   *  simulation, or the current pan/zoom transform. Deliberately lighter
   *  than a full re-render: the data didn't change, just the box, and
   *  content should stay pixel-for-pixel where it visually was rather than
   *  the browser's default "rescale the viewBox to fit" behavior a stale
   *  viewBox would otherwise produce (that mismatch is what used to make
   *  the graph visibly jump every time the panel opened/closed). */
  resizeViewport(width: number, height: number): void;
  /** C-03: moves real keyboard focus (roving tabindex + DOM `.focus()`) to
   *  a node — used when the caller (main.ts's "Jump to section" search)
   *  wants the graph to pick up keyboard interaction right where a search
   *  result landed. Deliberately separate from focusNode(): focusNode() is
   *  also called on plain page-load deep links, where silently stealing
   *  keyboard focus on load would be surprising; this is only ever called
   *  from a deliberate keyboard action. Does not pan/zoom the camera on its
   *  own — callers that also want that call focusNode() first (as the
   *  search flow does). No-op if the node isn't in this graph. */
  focusNodeForKeyboard(nodeId: string): void;
  /** The id of the node currently holding the graph's one roving Tab stop
   *  (`tabindex="0"`), or null if the graph has no nodes at all. Used by
   *  main.ts to carry keyboard position across a full graph rebuild (C-03
   *  §1.6) — pass it back in as `initialCurrentNodeId` next time. */
  getCurrentNodeId(): string | null;
  /** Frames the whole graph. */
  fit(): void;
  /** Marks one node as the selected one (the section the detail panel is
   *  showing), replacing any previous selection; null clears it. Styling
   *  is the `.is-selected` rule in map.css. */
  setSelectedNode(nodeId: string | null): void;
}

export function renderGraph(
  container: HTMLElement,
  model: GraphModel,
  options: {
    width: number;
    height: number;
    onNodeClick?: (node: GraphNode) => void;
    /** Fired on a click that lands on empty canvas — not a node, not
     *  during a pan/zoom drag — so the caller can e.g. close the detail
     *  panel the way clicking outside a popover normally does. */
    onBackgroundClick?: () => void;
    /** C-03 §1.4: fired when a focused node's Escape key is pressed — the
     *  caller (main.ts) moves focus to the "Jump to section" search input,
     *  a predictable, safe place to land rather than losing focus to
     *  `<body>`. */
    onEscape?: () => void;
    /** C-03 §1.6: the roving-tabindex node id to start on, carried over
     *  from a previous render of this same graph (see GraphHandle's
     *  getCurrentNodeId) — falls back to the first node in `model.nodes`
     *  order if omitted or no longer present in this model. */
    initialCurrentNodeId?: string;
    /** C-03 §1.6: when true, real DOM focus is moved to the resolved
     *  initial/current node as soon as it's rendered — set by the caller
     *  only when the user's keyboard focus was already inside the graph
     *  at the moment it triggered this re-render, so a data change (e.g.
     *  adding a statute) never silently steals focus from elsewhere on
     *  the page. */
    focusOnInit?: boolean;
  }
): GraphHandle {
  // width/height are mutable — resizeViewport() below updates them (and the
  // svg's own attrs) when the container's box changes for a reason that
  // isn't "the data changed" (e.g. the detail panel opening/closing), so
  // later centerOn/centerOnBounds calls stay correct without needing a
  // full re-render.
  let { width, height } = options;
  const { onNodeClick, onBackgroundClick, onEscape } = options;

  d3.select(container).selectAll("*").remove();

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height].join(" "))
    .style("width", "100%")
    .style("height", "100%");

  // Only the svg root itself is a legitimate "background" target — a click
  // on a node lands on that node's own <circle>/<text>, and (per SVG's
  // normal DOM bubbling) still reaches this listener afterward, so relying
  // on event.target rather than a capture-phase check is what keeps a node
  // click from also being read as a background click.
  svg.on("click", (event: MouseEvent) => {
    if (event.target === svg.node()) onBackgroundClick?.();
  });

  const defs = svg.append("defs");
  for (const [type, color] of Object.entries(REFERENCE_TYPE_COLORS)) {
    defs
      .append("marker")
      .attr("id", `arrow-${type}`)
      .attr("viewBox", "0 -5 10 10")
      // The tip of the triangle path below is at x=10; refX=10 aligns that
      // tip exactly with the line's endpoint. The line itself is now
      // shortened (per edge, by the target's real radius — see the tick
      // handler) to stop right at each node's edge, so the tip lands there
      // regardless of that node's size, rather than the old fixed offset
      // that only worked when every node shared one fixed radius.
      .attr("refX", 10)
      .attr("refY", 0)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", color);
  }

  const zoomLayer = svg.append("g");
  // Node the camera is currently following (see focusNode below). Cleared
  // as soon as the user does their own pan/zoom — event.sourceEvent is
  // only set for a real user gesture, never for the programmatic
  // `.call(zoomBehavior.transform, ...)` this file uses to move the
  // camera itself, so this can't cancel its own tracking.
  let focusNodeId: string | null = null;
  // Statute the camera is currently fitted to (see focusStatute below) —
  // mutually exclusive with focusNodeId; only one camera-follow mode runs
  // at a time, whichever was requested most recently.
  let focusStatuteCode: string | null = null;
  let userMovedCamera = false;
  const zoomBehavior = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.15, 5])
    .on("zoom", (event) => {
      zoomLayer.attr("transform", event.transform);
      if (event.sourceEvent) {
        userMovedCamera = true;
        focusNodeId = null;
        focusStatuteCode = null;
      }
    });
  svg.call(zoomBehavior);

  const incomingCounts = computeIncomingCounts(model);
  // Same one-pass-over-edges shape as computeIncomingCounts, just keyed by
  // source instead of target — used only for the aria-label's "cites N
  // sections" count (see nodeAriaLabel), so every node's label is O(1) to
  // build instead of each calling outgoingEdges().length (O(edges)) itself.
  const outgoingCounts = new Map<string, number>();
  for (const edge of model.edges) {
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1);
  }
  const { simulation, simNodes, simLinks } = buildSimulation(model, width, height);

  zoomLayer
    .append("g")
    .attr("fill", "none")
    .selectAll<SVGPathElement, SimLink>("path")
    .data(simLinks)
    .join("path")
    .attr("stroke", (d) => REFERENCE_TYPE_COLORS[d.edge.type])
    .attr("stroke-width", 1.5)
    .attr("stroke-opacity", 0.65)
    .attr("stroke-dasharray", (d) => REFERENCE_TYPE_DASH[d.edge.type])
    .attr("marker-end", (d) => `url(#arrow-${d.edge.type})`)
    .append("title")
    .text((d) => `[${d.edge.type}] ${d.edge.matchedText}`);

  const linkPaths = zoomLayer.selectAll<SVGPathElement, SimLink>("path");

  // C-03 §1.1: which node currently holds the graph's one roving Tab stop.
  // Resolved from the caller's carried-over id (re-render continuity,
  // §1.6) when it's still present in this model, else the first node in
  // document order — never left unset as long as there's at least one node.
  const requestedInitialId = options.initialCurrentNodeId;
  let currentNodeId: string | null =
    requestedInitialId && simNodes.some((n) => n.id === requestedInitialId) ? requestedInitialId : (simNodes[0]?.id ?? null);

  const nodeGroup = zoomLayer
    .append("g")
    .selectAll<SVGGElement, SimNode>("g")
    .data(simNodes)
    .join("g")
    .attr("cursor", "pointer")
    // C-03 §1.1/§1.3a: every node is independently focusable (role +
    // aria-label), but only the current one is ever a real Tab stop —
    // tabindex="-1" removes an element from the natural Tab sequence
    // entirely regardless of how many other nodes share it, which is what
    // keeps this correct at 1,700 nodes without a special case. `outline:
    // none` because the persistent keyboard-focus ring (see the
    // focusin/focusout handlers below) replaces the browser's default
    // focus rectangle with a themed one, not removes it outright.
    .attr("role", "button")
    .attr("tabindex", (d) => (d.id === currentNodeId ? "0" : "-1"))
    .attr("aria-label", (d) => nodeAriaLabel(d.node, incomingCounts, outgoingCounts))
    .style("outline", "none")
    .call(dragBehavior(simulation));

  let selectedNodeId: string | null = null;

  // O(1) id -> element lookup for keyboard navigation and the roving
  // tabindex swap, instead of re-scanning `nodeGroup` (O(nodes)) on every
  // arrow-key press.
  const nodeElById = new Map<string, SVGGElement>();
  nodeGroup.each(function (d) {
    nodeElById.set(d.id, this);
  });

  nodeGroup
    .append("circle")
    .attr("r", (d) => d.radius)
    .attr("fill", (d) => nodeFillColor(d.node))
    .style("stroke", (d) => (d.node.kind === "ghost" ? "#a1a1aa" : "var(--surface)"))
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", (d) => (d.node.kind === "ghost" ? "3,2" : null))
    .attr("opacity", (d) => (d.node.kind === "ghost" ? 0.55 : 1));

  nodeGroup
    .append("text")
    .text((d) => d.node.number ?? "?")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .attr("font-size", LABEL_FONT_SIZE)
    .attr("font-family", "Lexend Variable, system-ui, sans-serif")
    .attr("fill", "#fff")
    .attr("pointer-events", "none");

  nodeGroup.append("title").text((d) => `${nodeLabel(d.node)} (referenced ${incomingCounts.get(d.id) ?? 0} time(s))`);

  nodeGroup.on("click", (_event, d) => onNodeClick?.(d.node));

  // --- C-03 §1.4: arrow-key navigation follows real citation edges -------
  //
  // Each cursor advances one step (wrapping) every time the corresponding
  // arrow is pressed *from that specific node* — so repeatedly pressing →
  // on the same node walks its own outgoing list in order, matching the
  // visible "References" panel entry-for-entry (same function, same
  // order, deliberately not de-duplicated by target — a section cited
  // twice from two different phrases shows up twice in both places).
  // Reset whenever the graph itself is rebuilt (a fresh renderGraph() call
  // gets fresh Maps), which is fine — this is just a keyboard convenience,
  // not state anything else depends on.
  const outgoingCursor = new Map<string, number>();
  const incomingCursor = new Map<string, number>();

  function nextOutgoingTarget(id: string): string | null {
    const edges = outgoingEdges(model, id);
    if (edges.length === 0) return null;
    const i = ((outgoingCursor.get(id) ?? -1) + 1) % edges.length;
    outgoingCursor.set(id, i);
    return edges[i].target;
  }

  function nextIncomingSource(id: string): string | null {
    const edges = incomingEdges(model, id);
    if (edges.length === 0) return null;
    const i = ((incomingCursor.get(id) ?? -1) + 1) % edges.length;
    incomingCursor.set(id, i);
    return edges[i].source;
  }

  /** Moves the graph's one roving Tab stop to `nodeId` — the two-attribute
   *  swap described in §1.1 (old current -> tabindex -1, new -> 0) plus,
   *  depending on the caller: `recenter` re-runs the exact camera-pan +
   *  pulse-ring behavior focusNode() uses (arrow-key moves are effectively
   *  "focusNode, but also keyboard state" per §1.4's own description);
   *  `focusDom` calls real `.focus()` so both the visual focus ring
   *  (via the focusin listener below) and screen-reader announcement
   *  follow. No-op if the node isn't in this graph. */
  function setCurrentNode(nodeId: string, opts: { focusDom: boolean; recenter: boolean }): void {
    const target = simNodes.find((n) => n.id === nodeId);
    if (!target) return;

    if (currentNodeId && currentNodeId !== nodeId) {
      nodeElById.get(currentNodeId)?.setAttribute("tabindex", "-1");
    }
    currentNodeId = nodeId;
    nodeElById.get(nodeId)?.setAttribute("tabindex", "0");

    if (opts.recenter) {
      focusStatuteCode = null;
      focusNodeId = nodeId;
      centerOn(target);
      focusRing?.remove();
      focusRing = zoomLayer.append("circle").attr("fill", "none").style("stroke", "var(--focus)").attr("stroke-width", 3).attr("pointer-events", "none");
      focusRingTarget = target;
      pulseFocusRing(target, 3);
    }

    if (opts.focusDom) {
      nodeElById.get(nodeId)?.focus();
    }
  }

  // One delegated listener per interaction type on the svg root, rather
  // than one per node (~1,700 listeners at Criminal-Code scale) — the
  // datum for whichever node the event actually landed on is read back via
  // d3's own data binding (`.datum()` on the closest role="button"
  // ancestor), not a hand-rolled data-* attribute.
  function nodeElFromEvent(event: Event): SVGGElement | null {
    const el = (event.target as Element | null)?.closest('g[role="button"]');
    return el as SVGGElement | null;
  }

  svg.on("keydown", (event: KeyboardEvent) => {
    const el = nodeElFromEvent(event);
    if (!el) return;
    const d = d3.select<SVGGElement, SimNode>(el).datum();
    if (!d) return;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown": {
        event.preventDefault();
        const next = nextOutgoingTarget(d.id);
        if (next) setCurrentNode(next, { focusDom: true, recenter: true });
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        event.preventDefault();
        const next = nextIncomingSource(d.id);
        if (next) setCurrentNode(next, { focusDom: true, recenter: true });
        break;
      }
      case "Enter":
      case " ":
      case "Spacebar":
        // Space's default browser behavior (scroll the page) would
        // otherwise fire too, since a non-native-<button> role="button"
        // doesn't get that suppression for free the way a real <button>
        // does.
        event.preventDefault();
        onNodeClick?.(d.node);
        break;
      case "Escape":
        event.preventDefault();
        onEscape?.();
        break;
    }
  });

  // --- C-03 §1.4 (visual): a persistent focus ring, separate from the
  // transient pulse-and-fade above --------------------------------------
  //
  // focus/blur don't bubble; focusin/focusout are their bubbling
  // equivalents, so one delegated pair here covers every node the same
  // way the keydown listener above does. This tracks *real* DOM focus
  // however it got there (Tab, arrow-key move, search selection, or even
  // a mouse click that happens to focus the element) — a single source of
  // truth rather than something the keyboard handlers above have to
  // remember to also toggle.
  let keyboardFocusRing: d3.Selection<SVGCircleElement, unknown, null, undefined> | null = null;
  let keyboardFocusTarget: SimNode | null = null;

  svg.on("focusin", (event: FocusEvent) => {
    const el = nodeElFromEvent(event);
    if (!el) return;
    const d = d3.select<SVGGElement, SimNode>(el).datum();
    if (!d) return;
    keyboardFocusTarget = d;
    keyboardFocusRing?.remove();
    keyboardFocusRing = zoomLayer
      .append("circle")
      .attr("fill", "none")
      .style("stroke", "var(--focus)")
      .attr("stroke-width", 2)
      .attr("pointer-events", "none")
      .attr("cx", d.x ?? 0)
      .attr("cy", d.y ?? 0)
      .attr("r", d.radius + 5);
  });

  svg.on("focusout", (event: FocusEvent) => {
    const el = nodeElFromEvent(event);
    if (!el) return;
    keyboardFocusTarget = null;
    keyboardFocusRing?.remove();
    keyboardFocusRing = null;
  });

  // Pans the camera so `target` lands at the viewport's center, at a fixed
  // zoomed-in scale — used both for the immediate jump in focusNode() and
  // for tick-by-tick tracking while that node is still being pushed around
  // by the simulation. Programmatic (goes through zoomBehavior.transform,
  // not a raw attr set) so the zoom handler above stays the single source
  // of truth for zoomLayer's transform.
  function centerOn(target: SimNode): void {
    const scale = 1.8;
    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-(target.x ?? 0), -(target.y ?? 0));
    svg.call(zoomBehavior.transform, transform);
  }

  // Pans/zooms so every node in `nodes` fits on screen (with a margin) —
  // used for focusStatute()'s "zoom in on that statute's whole cluster"
  // rather than a single point, so a small Act isn't over-zoomed and a
  // large one isn't clipped. Falls back to a fixed 1.8x centered on the
  // group's centroid if the nodes are all on top of each other (bbox has
  // ~zero area — e.g. a single-section statute), since "fit" is meaningless
  // for a zero-size box and would otherwise blow the zoom out to the
  // scaleExtent's max.
  const FIT_PADDING = 60;
  function centerOnBounds(nodes: SimNode[], animate = false): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      minX = Math.min(minX, x - n.radius);
      maxX = Math.max(maxX, x + n.radius);
      minY = Math.min(minY, y - n.radius);
      maxY = Math.max(maxY, y + n.radius);
    }
    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const [minScale, maxScale] = zoomBehavior.scaleExtent();

    const scale =
      boxWidth < 1 || boxHeight < 1
        ? 1.8
        : Math.max(minScale, Math.min((width - FIT_PADDING * 2) / boxWidth, (height - FIT_PADDING * 2) / boxHeight, maxScale));

    const transform = d3.zoomIdentity.translate(width / 2, height / 2).scale(scale).translate(-cx, -cy);
    if (animate) svg.transition().duration(450).call(zoomBehavior.transform, transform);
    else svg.call(zoomBehavior.transform, transform);
  }

  // Frames everything once the layout settles, unless the user has already
  // moved the camera or asked to look at something specific.
  simulation.on("end.fit", () => {
    if (!userMovedCamera && !focusNodeId && !focusStatuteCode) centerOnBounds(simNodes, true);
  });

  // A ring that pulses outward around the node focusNode() is called with —
  // findable among a graph that can have hundreds of near-identical
  // circles. Re-centered on the node every tick alongside the ring's own
  // grow/fade transition so it doesn't drift off a node that's still
  // settling into place.
  let focusRing: d3.Selection<SVGCircleElement, unknown, null, undefined> | null = null;
  let focusRingTarget: SimNode | null = null;

  function pulseFocusRing(target: SimNode, cyclesLeft: number): void {
    if (!focusRing || focusRingTarget !== target) return;
    focusRing
      .attr("cx", target.x ?? 0)
      .attr("cy", target.y ?? 0)
      .attr("r", target.radius)
      .attr("opacity", 0.9)
      .transition()
      .duration(700)
      .ease(d3.easeCubicOut)
      .attr("r", target.radius + 16)
      .attr("opacity", 0)
      .on("end", () => {
        if (cyclesLeft > 1) pulseFocusRing(target, cyclesLeft - 1);
        else {
          focusRing?.remove();
          focusRing = null;
          focusRingTarget = null;
        }
      });
  }

  simulation.on("tick", () => {
    linkPaths.attr("d", (d) => {
      const s = d.source as SimNode;
      const t = d.target as SimNode;
      const source = { x: s.x ?? 0, y: s.y ?? 0 };
      const target = { x: t.x ?? 0, y: t.y ?? 0 };
      const end = computeLineEndpoint(source, target, t.radius, ARROW_GAP);
      return `M${source.x},${source.y}L${end.x},${end.y}`;
    });
    nodeGroup.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

    if (focusNodeId) {
      const target = simNodes.find((n) => n.id === focusNodeId);
      if (target) centerOn(target);
    }
    if (focusStatuteCode) {
      const nodes = simNodes.filter((n) => n.node.kind === "section" && n.node.statuteCode === focusStatuteCode);
      if (nodes.length > 0) centerOnBounds(nodes);
    }
    if (focusRing && focusRingTarget) {
      focusRing.attr("cx", focusRingTarget.x ?? 0).attr("cy", focusRingTarget.y ?? 0);
    }
    if (keyboardFocusRing && keyboardFocusTarget) {
      keyboardFocusRing.attr("cx", keyboardFocusTarget.x ?? 0).attr("cy", keyboardFocusTarget.y ?? 0);
    }
  });

  function dragBehavior(sim: d3.Simulation<SimNode, SimLink>) {
    return d3
      .drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }

  // Someone who's asked for less motion gets the settled layout straight away
  // instead of watching every node drift into place.
  if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    simulation.stop();
    simulation.tick(300);
    simulation.on("tick")?.call(simulation);
    if (!focusNodeId && !focusStatuteCode) centerOnBounds(simNodes);
  }

  // C-03 §1.6: only steal real DOM focus on initial render when the
  // caller explicitly says the user's keyboard focus was already inside
  // the graph before this render happened (e.g. a data change mid-use) —
  // never on a first render nobody asked to be focused for (a fresh
  // project load, or a background statute add the user didn't trigger
  // from inside the graph).
  if (options.focusOnInit && currentNodeId) {
    nodeElById.get(currentNodeId)?.focus();
  }

  return {
    destroy() {
      simulation.stop();
      focusNodeId = null;
      focusStatuteCode = null;
      focusRingTarget = null;
      keyboardFocusTarget = null;
      d3.select(container).selectAll("*").remove();
    },
    reheat() {
      simulation.alpha(1).restart();
    },
    focusNode(nodeId: string) {
      const target = simNodes.find((n) => n.id === nodeId);
      if (!target) return;

      focusStatuteCode = null; // mutually exclusive — see focusStatuteCode's declaration
      focusNodeId = nodeId;
      centerOn(target);

      focusRing?.remove();
      focusRing = zoomLayer
        .append("circle")
        .attr("fill", "none")
        .style("stroke", "var(--focus)")
        .attr("stroke-width", 3)
        .attr("pointer-events", "none");
      focusRingTarget = target;
      pulseFocusRing(target, 3);
    },
    focusStatute(code: string) {
      const nodes = simNodes.filter((n) => n.node.kind === "section" && n.node.statuteCode === code);
      if (nodes.length === 0) return;

      focusNodeId = null; // mutually exclusive with a single-node focus
      focusRing?.remove();
      focusRing = null;
      focusRingTarget = null;

      focusStatuteCode = code;
      centerOnBounds(nodes);
    },
    resizeViewport(newWidth: number, newHeight: number) {
      width = newWidth;
      height = newHeight;
      svg.attr("width", width).attr("height", height).attr("viewBox", [0, 0, width, height].join(" "));
    },
    focusNodeForKeyboard(nodeId: string) {
      setCurrentNode(nodeId, { focusDom: true, recenter: false });
    },
    getCurrentNodeId() {
      return currentNodeId;
    },
    fit() {
      focusNodeId = null;
      focusStatuteCode = null;
      centerOnBounds(simNodes, true);
    },
    setSelectedNode(nodeId: string | null) {
      if (selectedNodeId) nodeElById.get(selectedNodeId)?.classList.remove("is-selected");
      selectedNodeId = nodeId;
      if (nodeId) {
        const el = nodeElById.get(nodeId);
        el?.classList.add("is-selected");
        // SVG has no z-index: last in the DOM paints on top, so a selected
        // section is never left hidden behind its neighbours.
        el?.parentNode?.appendChild(el);
      }
    },
  };
}
