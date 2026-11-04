import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { getNeighborSections } from "../lib/statute";

// C-03 §2.2: the id of App.jsx's "Cites out"/"Cited by" lists container —
// this component's own aria-describedby links to it (shared as a named
// export, not a magic string duplicated in both files, so they can't
// silently drift apart).
export const REF_LISTS_ID = "section-map-ref-lists";
const MAX_DRAWABLE_NEIGHBORS = 60;

// A canvas can't use CSS variables, so the theme's colors are read out of the
// stylesheet by hand. The component is keyed on the theme in ReaderView, so it
// redraws when that changes.
function canvasColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const CONTAINER_HEIGHT = 300;
const LABEL_OFFSET = 14;
const LABEL_OFFSET_STEP = 6;
const LABEL_OFFSET_MAX = LABEL_OFFSET + 160;
const BUBBLE_PAD_X = 6;
const BUBBLE_PAD_Y = 4;
const BUBBLE_RADIUS = 9;
// Extra graph units, beyond the ring's own outer edge, reserved so labels
// on the outermost leaves aren't cropped by the initial framing.
const FOCUS_LABEL_MARGIN = 70;

// A tiny deterministic hash (not Math.random — positions must stay put
// across re-renders, not reshuffle every time). Two independent calls with
// different salts give two independent-looking values per section.
function hashUnit(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// Every edge here touches the current section — neighbours are never linked
// to each other — so this is always a star/hub graph, never a general
// network. Spokes from a shared centre point can only ever meet at that
// centre, never cross each other anywhere else, no matter where the far
// end of each one lands — so there's no need to fix leaves to a precise
// circle to keep them untangled. A perfect circle is what made earlier
// passes look like a wheel diagram; each leaf now gets its own small,
// stable (hash-seeded, not random-per-render) nudge to its distance and
// angle from the hub instead, so the ring reads as loosely gathered around
// the hub — petals at slightly different lengths — rather than measured
// out with a compass. Each label still rides in its own rounded bubble so
// it stays legible next to its neighbours, and the view opens zoomed in on
// the hub — pan or scroll to explore the rest, the same way you'd explore
// any mind map.
let measureCanvas;
function measureWidths(labels, font) {
  if (typeof document === "undefined") return labels.map((l) => l.length * 6);
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  ctx.font = font;
  return labels.map((l) => ctx.measureText(l).width);
}

// A narrow "straight up/down/sideways" zone gets centred/middle text;
// anything past it is angled enough to read better left/right or
// top/bottom-anchored — this is what lets neighbouring labels fan apart
// instead of stacking on the same row.
function labelAnchor(angle) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  return {
    dx,
    dy,
    align: Math.abs(dx) < 0.18 ? "center" : dx > 0 ? "left" : "right",
    baseline: Math.abs(dy) < 0.18 ? "middle" : dy > 0 ? "top" : "bottom",
  };
}

function bubbleRect(x, y, anchor, offset, textWidth, lineHeight) {
  const ax = x + anchor.dx * offset;
  const ay = y + anchor.dy * offset;
  const w = textWidth + BUBBLE_PAD_X * 2;
  const h = lineHeight + BUBBLE_PAD_Y * 2;
  const [left, right] =
    anchor.align === "left" ? [ax - BUBBLE_PAD_X, ax + w - BUBBLE_PAD_X]
    : anchor.align === "right" ? [ax - w + BUBBLE_PAD_X, ax + BUBBLE_PAD_X]
    : [ax - w / 2, ax + w / 2];
  const [top, bottom] =
    anchor.baseline === "top" ? [ay - BUBBLE_PAD_Y, ay + h - BUBBLE_PAD_Y]
    : anchor.baseline === "bottom" ? [ay - h + BUBBLE_PAD_Y, ay + BUBBLE_PAD_Y]
    : [ay - h / 2, ay + h / 2];
  return { left, right, top, bottom, textX: ax, textY: ay };
}

function rectsOverlap(a, b, buffer = 4) {
  return (
    a.left < b.right + buffer &&
    a.right > b.left - buffer &&
    a.top < b.bottom + buffer &&
    a.bottom > b.top - buffer
  );
}

function layoutStarGraph(sectionId, outgoing, incoming, statute, fontSize) {
  const leafIds = [...new Set([...outgoing, ...incoming])];
  const leafLabels = leafIds.map((id) => `s.${statute.sections[id].number}`);
  const n = leafIds.length;

  const font = `500 ${fontSize}px "Lexend Variable", sans-serif`;
  const widths = measureWidths(leafLabels, font);
  const lineHeight = fontSize * 1.3;

  // A ring sized to the neighbour count — not to any container — so
  // density is handled by giving leaves more room, never by squashing the
  // circle into an ellipse.
  const radius = Math.max(80, (n * 44) / (2 * Math.PI));
  const angleStep = (2 * Math.PI) / n;

  const leaves = leafIds.map((id, i) => {
    // Start at 12 o'clock, go clockwise, so a single or pair of leaves
    // reads top-down rather than landing awkwardly to one side. Each leaf
    // gets a small, stable-per-id nudge off that perfectly even slot —
    // capped well under half a slot so leaves never actually swap places
    // (which the declutter pass below relies on, since it only checks
    // each leaf against its immediate array-order neighbour) — and off the
    // shared radius, so the ring reads as gathered rather than compassed.
    const angle = -Math.PI / 2 + angleStep * i + (hashUnit(`${id}:a`) - 0.5) * angleStep * 0.7;
    const leafRadius = radius * (0.8 + hashUnit(`${id}:r`) * 0.4);
    return {
      id,
      label: leafLabels[i],
      isCurrent: false,
      angle,
      dotScale: 0.85 + hashUnit(`${id}:d`) * 0.3,
      anchor: labelAnchor(angle),
      x: leafRadius * Math.cos(angle),
      y: leafRadius * Math.sin(angle),
      textWidth: widths[i],
    };
  });
  leaves.forEach((leaf) => {
    leaf.fx = leaf.x;
    leaf.fy = leaf.y;
  });

  // Walk the leaves in angular order, growing each one's bubble offset
  // past its predecessor's until the two no longer overlap. Pushing a
  // bubble further out never moves its node, so the non-crossing spokes
  // are unaffected — only where its label sits changes. With the ring no
  // longer squeezed to fit a small box, there's plenty of room to push
  // into, so this virtually always finds a clear spot.
  const placedRects = [];
  leaves.forEach((leaf) => {
    let offset = LABEL_OFFSET;
    let rect = bubbleRect(leaf.x, leaf.y, leaf.anchor, offset, leaf.textWidth, lineHeight);
    const prev = placedRects[placedRects.length - 1];
    while (prev && rectsOverlap(rect, prev) && offset < LABEL_OFFSET_MAX) {
      offset += LABEL_OFFSET_STEP;
      rect = bubbleRect(leaf.x, leaf.y, leaf.anchor, offset, leaf.textWidth, lineHeight);
    }
    leaf.labelOffset = offset;
    leaf.bubble = rect;
    placedRects.push(rect);
  });
  // The ring wraps around: check the last leaf against the first too.
  if (leaves.length > 1) {
    const first = placedRects[0];
    const last = leaves[leaves.length - 1];
    while (rectsOverlap(last.bubble, first) && last.labelOffset < LABEL_OFFSET_MAX) {
      last.labelOffset += LABEL_OFFSET_STEP;
      last.bubble = bubbleRect(last.x, last.y, last.anchor, last.labelOffset, last.textWidth, lineHeight);
    }
  }

  const hub = {
    id: sectionId,
    label: `s.${statute.sections[sectionId].number}`,
    isCurrent: true,
    x: 0,
    y: 0,
    fx: 0,
    fy: 0,
  };

  const links = [
    ...outgoing.map((t) => ({ source: sectionId, target: t })),
    ...incoming.map((s) => ({ source: s, target: sectionId })),
  ];

  // The jitter above pushes individual leaves up to 20% past the base
  // radius — callers that need "how far out does this ring actually
  // reach" (to frame a view around it) should use this, not `radius`.
  const maxRadius = radius * 1.2;

  return { nodes: [hub, ...leaves], links, maxRadius };
}

function drawBubble(ctx, rect, fill, stroke) {
  const { left, top, right, bottom } = rect;
  const w = right - left;
  const h = bottom - top;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(left, top, w, h, BUBBLE_RADIUS);
  else ctx.rect(left, top, w, h);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

export default function CrossRefGraph({ statute, sectionId, onJumpSection }) {
  const fgRef = useRef();
  const containerRef = useRef();
  const [width, setWidth] = useState(260);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Recompute only when the section actually changes. getNeighborSections
  // allocates fresh arrays on every call, so calling it in the render body
  // (rather than inside this memo) would give useMemo a new dependency
  // reference on every render — including renders triggered by unrelated
  // state like a definition-hover tooltip — and redo the layout each time.
  const { outgoingCount, incomingCount, neighborCount } = useMemo(() => {
    const { outgoing, incoming } = getNeighborSections(statute, sectionId);
    return {
      outgoingCount: outgoing.length,
      incomingCount: incoming.length,
      neighborCount: new Set([...outgoing, ...incoming]).size,
    };
  }, [statute, sectionId]);

  const fontSize = neighborCount > 26 ? 9 : neighborCount > 14 ? 10 : 11;

  const data = useMemo(() => {
    const { outgoing, incoming } = getNeighborSections(statute, sectionId);
    return layoutStarGraph(sectionId, outgoing, incoming, statute, fontSize);
  }, [statute, sectionId, fontSize]);

  const focusHub = () => {
    // Snap back to centred-on-the-hub, freshly zoomed to frame this
    // section's own ring, every time the map opens on a (possibly new)
    // section — not just left wherever a previous pan/zoom left off.
    // zoomToFit's bounding box degenerates to a single point for a
    // one-node filter, which it doesn't handle predictably, so the zoom
    // is computed directly from the ring's own reach (data.maxRadius, from
    // layoutStarGraph) instead: sized to the graph at hand, so the hub is
    // always framed together with its ring, rather than a hardcoded
    // zoom that shows everything for a small ring and almost nothing for
    // a dense one. Pan or scroll-zoom still reaches beyond the frame for
    // whatever's a tight fit, the same way you'd explore any mind map.
    const fg = fgRef.current;
    if (!fg) return;
    const targetZoom = Math.min(width, CONTAINER_HEIGHT) / (2 * (data.maxRadius + FOCUS_LABEL_MARGIN));
    fg.centerAt(0, 0, 0);
    fg.zoom(Math.min(2.4, Math.max(0.4, targetZoom)), 0);
  };

  useEffect(focusHub, [data, width]);

  if (data.nodes.length <= 1) {
    return (
      <p className="graph-empty">
        No cross-references to or from this section.
      </p>
    );
  }

  // A radial diagram stops saying anything long before this many spokes, and
  // the lists below hold the same information in a form that still works.
  if (neighborCount > MAX_DRAWABLE_NEIGHBORS) {
    return (
      <p className="graph-empty">
        This section connects to {neighborCount} others, too many to draw
        clearly. They're all listed below.
      </p>
    );
  }

  // C-03 §2.1: react-force-graph-2d renders onto a plain <canvas>, which
  // has no accessible internal structure at all — individual drawn nodes
  // can't be made separately focusable no matter how the canvas element
  // itself is decorated. Rather than build a second, parallel keyboard
  // system for it, this becomes a labeled, non-interactive graphic (never
  // a Tab stop — canvas isn't focusable by default, so nothing extra is
  // needed for that) whose real text equivalent is the "Cites out"/"Cited
  // by" lists already rendered right after it (§2.2) — aria-describedby
  // points there explicitly, on top of them already being next in normal
  // reading order.
  const graphAriaLabel = `Section map: cites out ${outgoingCount} section${outgoingCount === 1 ? "" : "s"}, cited by ${incomingCount} section${incomingCount === 1 ? "" : "s"}. See the lists below for the same information as text.`;

  return (
    <div
      className="cross-ref-graph"
      ref={containerRef}
      role="img"
      aria-label={graphAriaLabel}
      aria-describedby={REF_LISTS_ID}
    >
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        width={width}
        height={CONTAINER_HEIGHT}
        nodeLabel="label"
        nodeRelSize={5}
        enableNodeDrag={false}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={1}
        linkColor={() => canvasColor("--graph-link")}
        linkWidth={1.2}
        cooldownTicks={0}
        onEngineStop={focusHub}
        onNodeClick={(node) => onJumpSection(node.id)}
        nodeCanvasObject={(node, ctx) => {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.isCurrent ? 7 : 5 * node.dotScale, 0, 2 * Math.PI);
          ctx.fillStyle = node.isCurrent ? canvasColor("--accent") : canvasColor("--ink-faint");
          ctx.fill();

          if (node.isCurrent) {
            ctx.font = `700 ${fontSize}px "Lexend Variable", sans-serif`;
            const rect = bubbleRect(
              node.x, node.y - 16, { dx: 0, dy: 0, align: "center", baseline: "middle" },
              0, ctx.measureText(node.label).width, fontSize * 1.3,
            );
            drawBubble(ctx, rect, canvasColor("--surface"), canvasColor("--line-strong"));
            ctx.fillStyle = canvasColor("--ink");
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(node.label, rect.textX, rect.textY);
            return;
          }

          ctx.font = `500 ${fontSize}px "Lexend Variable", sans-serif`;
          drawBubble(ctx, node.bubble, canvasColor("--surface"), canvasColor("--line"));
          ctx.fillStyle = canvasColor("--ink");
          ctx.textAlign = node.anchor.align;
          ctx.textBaseline = node.anchor.baseline;
          ctx.fillText(
            node.label,
            node.x + node.anchor.dx * node.labelOffset,
            node.y + node.anchor.dy * node.labelOffset,
          );
        }}
      />
    </div>
  );
}
