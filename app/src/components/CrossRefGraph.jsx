import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { forceCollide } from "d3-force-3d";
import { getNeighborSections } from "../lib/statute";

const MIN_HEIGHT = 200;
const MAX_HEIGHT = 420;

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
  // state like a definition-hover tooltip — and reset the force simulation
  // each time.
  const data = useMemo(() => {
    const { outgoing, incoming } = getNeighborSections(statute, sectionId);
    const nodeIds = new Set([sectionId, ...outgoing, ...incoming]);
    const nodes = [...nodeIds].map((id) => ({
      id,
      label: `s.${statute.sections[id].number}`,
      isCurrent: id === sectionId,
    }));
    const links = [
      ...outgoing.map((t) => ({ source: sectionId, target: t })),
      ...incoming.map((s) => ({ source: s, target: sectionId })),
    ];
    return { nodes, links };
  }, [statute, sectionId]);

  // Highly-cited sections (e.g. a definitions section in a large Code) can
  // have 20+ neighbours. Give those graphs more canvas room and stronger
  // node repulsion so labels don't pile on top of each other — a fixed
  // 210px box that works for a 3-node graph is way too cramped for 20.
  const height = Math.round(
    Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, 150 + data.nodes.length * 9)),
  );
  const fontSize = data.nodes.length > 16 ? 9.5 : data.nodes.length > 8 ? 10.5 : 11;

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    // A collision force keeps nodes (and the labels drawn above them) from
    // overlapping — the default simulation only prevents links from
    // crossing, not nodes from sitting on top of each other.
    fg.d3Force("collide", forceCollide(data.nodes.length > 12 ? 26 : 20));
    fg.d3Force("charge")?.strength(-70 - Math.min(data.nodes.length, 30) * 4);
    fg.d3ReheatSimulation?.();
  }, [statute, sectionId, data.nodes.length]);

  const handleEngineStop = () => {
    // Once the simulation settles, pan/zoom so every node — including ones
    // the layout pushed near an edge — is fully inside the canvas with
    // room for its label. Without this, a node that lands near y=0 has its
    // above-node label clipped by the canvas edge.
    fgRef.current?.zoomToFit(300, 28);
  };

  if (data.nodes.length <= 1) {
    return (
      <p className="graph-empty">
        No cross-references to or from this section.
      </p>
    );
  }

  return (
    <div className="cross-ref-graph" ref={containerRef}>
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        width={width}
        height={height}
        nodeLabel="label"
        nodeRelSize={5}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={1}
        linkColor={() => "rgba(148, 138, 122, 0.55)"}
        linkWidth={1.2}
        cooldownTicks={100}
        onEngineStop={handleEngineStop}
        onNodeClick={(node) => onJumpSection(node.id)}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const scaledFont = fontSize / globalScale;
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.isCurrent ? 7 : 5, 0, 2 * Math.PI);
          ctx.fillStyle = node.isCurrent ? "#b5451b" : "#3b5bab";
          ctx.fill();
          ctx.font = `${node.isCurrent ? "700" : "500"} ${scaledFont}px Inter, sans-serif`;
          ctx.fillStyle = "#3a342a";
          ctx.textAlign = "center";
          ctx.fillText(node.label, node.x, node.y - (node.isCurrent ? 12 : 10));
        }}
      />
    </div>
  );
}
