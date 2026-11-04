import RenderRuns from "./Runs";

function BlockNode({ block, ...handlers }) {
  switch (block.type) {
    case "text":
      return (
        <p className="block-text">
          <RenderRuns runs={block.runs} {...handlers} />
        </p>
      );

    case "subsection":
    case "paragraph":
    case "subparagraph":
    case "clause":
      return (
        <div className={`block-row block-${block.type}`}>
          <span className="block-label">{block.label}</span>
          <div className="block-content">
            {block.marginalNote && (
              <div className="marginal-note">{block.marginalNote}</div>
            )}
            {block.children.map((child, i) => (
              <BlockNode key={i} block={child} {...handlers} />
            ))}
          </div>
        </div>
      );

    case "definition":
      return (
        <div className="block-definition" id={`def-${block.termId}`}>
          {block.children.map((child, i) => (
            <BlockNode key={i} block={child} {...handlers} />
          ))}
        </div>
      );

    case "continued":
      return (
        <div className="block-continued">
          {block.children.map((child, i) => (
            <BlockNode key={i} block={child} {...handlers} />
          ))}
        </div>
      );

    default:
      return null;
  }
}

export default function SectionBody({ blocks, ...handlers }) {
  return (
    <div className="section-body">
      {blocks.map((block, i) => (
        <BlockNode key={i} block={block} {...handlers} />
      ))}
    </div>
  );
}
