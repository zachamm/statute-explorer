export default function RenderRuns({ statute, runs, onJumpSection, onHoverTerm }) {
  return runs.map((run, i) => {
    switch (run.type) {
      case "text":
        return <span key={i}>{run.value}</span>;

      case "defterm": {
        const def = statute.definitions[run.termId];
        return (
          <button
            key={i}
            type="button"
            className={`term-link${run.isAnchor ? " is-anchor" : ""}`}
            onClick={() => def && onJumpSection(def.sectionId)}
            onMouseEnter={(e) =>
              onHoverTerm(run.termId, { x: e.clientX, y: e.clientY })
            }
            onMouseLeave={() => onHoverTerm(null)}
            onFocus={(e) => {
              const rect = e.target.getBoundingClientRect();
              onHoverTerm(run.termId, { x: rect.left, y: rect.bottom });
            }}
            onBlur={() => onHoverTerm(null)}
          >
            {run.value}
          </button>
        );
      }

      case "xref-internal":
        return (
          <button
            key={i}
            type="button"
            className="xref-link"
            title={`Jump to ${run.targets.map((t) => `s.${t.sectionId.slice(1)}${t.subsectionLabel ?? ""}`).join(", ")}`}
            onClick={() => onJumpSection(run.targets[0].sectionId)}
          >
            {run.value}
          </button>
        );

      case "xref-external":
        return (
          <em key={i} className="xref-external" title={`External statute: ${run.act}`}>
            {run.value}
          </em>
        );

      default:
        return <span key={i}>{run.value}</span>;
    }
  });
}
