import { useEffect, useState } from "react";

export default function SectionTree({ statute, selectedSectionId, onSelect }) {
  const [collapsedParts, setCollapsedParts] = useState(() => new Set());

  const togglePart = (id) => {
    setCollapsedParts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    document
      .querySelector(`.tree-section-link[data-id="${selectedSectionId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedSectionId]);

  return (
    <nav className="section-tree" aria-label="Statute section navigation">
      {statute.tree.map((part) => {
        const isCollapsed = collapsedParts.has(part.id);
        return (
          <div className="tree-part" key={part.id}>
            <button
              type="button"
              className="tree-part-header"
              onClick={() => togglePart(part.id)}
              aria-expanded={!isCollapsed}
            >
              <span className={`tree-caret${isCollapsed ? " is-collapsed" : ""}`}>
                ▸
              </span>
              {part.label && <span className="tree-part-tag">{part.label}</span>}
              <span className="tree-part-title">{part.title}</span>
            </button>
            {!isCollapsed && (
              <div className="tree-divisions">
                {part.divisions.map((div) => (
                  <div className="tree-division" key={div.id}>
                    {div.title && (
                      <div className="tree-division-title">{div.title}</div>
                    )}
                    <ul className="tree-sections">
                      {div.sectionIds.map((id) => {
                        const section = statute.sections[id];
                        const active = id === selectedSectionId;
                        return (
                          <li key={id}>
                            <button
                              type="button"
                              data-id={id}
                              className={`tree-section-link${active ? " active" : ""}`}
                              onClick={() => onSelect(id)}
                            >
                              <span className="tree-section-number">
                                {section.number}
                              </span>
                              <span className="tree-section-note">
                                {section.marginalNote ?? "—"}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
