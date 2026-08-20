import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import guideMd from "../../../docs/GUIDE.md?raw";
import readmeMd from "../../../README.md?raw";
import schemaMd from "../../../docs/SCHEMA.md?raw";

const GROUPS = [
  {
    label: "Guide",
    docs: [{ key: "guide", label: "Using this app", content: guideMd }],
  },
  {
    label: "For developers",
    docs: [
      { key: "readme", label: "How it works", content: readmeMd },
      { key: "schema", label: "Data model", content: schemaMd },
    ],
  },
];

const ALL_DOCS = GROUPS.flatMap((g) => g.docs);

export default function DocsView() {
  const [active, setActive] = useState("guide");
  const activeDoc = ALL_DOCS.find((d) => d.key === active);

  return (
    <div className="docs-view">
      <nav className="docs-nav">
        {GROUPS.map((group) => (
          <div className="docs-nav-group" key={group.label}>
            <div className="docs-nav-group-label">{group.label}</div>
            {group.docs.map((d) => (
              <button
                key={d.key}
                type="button"
                className={d.key === active ? "active" : ""}
                onClick={() => setActive(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <article className="docs-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {activeDoc.content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
