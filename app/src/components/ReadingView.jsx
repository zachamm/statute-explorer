import {
  getDivisionForSection,
  getPartForSection,
  orderedSectionIds,
} from "../lib/statute";
import SectionBody from "./SectionBody";

function pagerLabel(section) {
  return section.number ? `s.${section.number}` : section.marginalNote;
}

export default function ReadingView({
  statute,
  sectionId,
  onJumpSection,
  onHoverTerm,
}) {
  const section = statute.sections[sectionId];
  const part = getPartForSection(statute, section);
  const division = getDivisionForSection(statute, section);
  const order = orderedSectionIds(statute);
  const idx = order.indexOf(sectionId);
  const prevId = idx > 0 ? order[idx - 1] : null;
  const nextId = idx < order.length - 1 ? order[idx + 1] : null;

  return (
    <article className="reading-view">
      <div className="breadcrumb">
        {part.label && <span className="crumb-tag">{part.label}</span>}
        <span>{part.title}</span>
        {division.title && (
          <>
            <span className="crumb-sep">/</span>
            <span>{division.title}</span>
          </>
        )}
      </div>

      <header className="section-header">
        {section.number && (
          <>
            <span className="section-number-ghost" aria-hidden="true">
              {section.number}
            </span>
            <span className="section-number-big">{section.number}</span>
          </>
        )}
        {section.marginalNote && <h1>{section.marginalNote}</h1>}
      </header>

      <SectionBody
        statute={statute}
        blocks={section.body}
        onJumpSection={onJumpSection}
        onHoverTerm={onHoverTerm}
      />

      {section.historicalNote && (
        <p className="historical-note">{section.historicalNote}</p>
      )}

      <nav className="section-pager">
        {prevId ? (
          <button type="button" onClick={() => onJumpSection(prevId)}>
            ← {pagerLabel(statute.sections[prevId])}
          </button>
        ) : (
          <span />
        )}
        {nextId ? (
          <button type="button" onClick={() => onJumpSection(nextId)}>
            {pagerLabel(statute.sections[nextId])} →
          </button>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}
