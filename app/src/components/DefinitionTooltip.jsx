import { runsToPlainText } from "../lib/statute";

export default function DefinitionTooltip({ statute, termId, position }) {
  if (!termId) return null;
  const def = statute.definitions[termId];
  if (!def) return null;
  const section = statute.sections[def.sectionId];
  const preview = runsToPlainText(def.previewRuns).trim();
  const truncated = preview.length > 280 ? `${preview.slice(0, 280)}…` : preview;

  return (
    <div
      className="definition-tooltip"
      style={{ left: position.x + 14, top: position.y + 18 }}
      role="tooltip"
    >
      <div className="tooltip-term">{def.term}</div>
      <div className="tooltip-scope">
        Defined in {def.scope} — s.{section.number}
      </div>
      <div className="tooltip-preview">{truncated}</div>
    </div>
  );
}
