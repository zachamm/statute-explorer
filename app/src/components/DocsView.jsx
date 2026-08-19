import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchDoc } from "../lib/importApi";

const GROUPS = [
  {
    label: "Guide",
    docs: [{ key: "guide", label: "Using this app" }],
  },
  {
    label: "For developers",
    docs: [
      { key: "readme", label: "How it works" },
      { key: "schema", label: "Data model" },
    ],
  },
];

export default function DocsView() {
  const [active, setActive] = useState("guide");
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setContent(null);
    setError(null);
    fetchDoc(active)
      .then(setContent)
      .catch((err) => setError(err.message));
  }, [active]);

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
        {error && (
          <p className="docs-error">
            Couldn't load this doc: {error}. This only works when the app
            is running via <code>npm run dev</code> — the docs API is a
            dev-server-only feature.
          </p>
        )}
        {!error && !content && <p className="docs-loading">Loading…</p>}
        {content && (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        )}
      </article>
    </div>
  );
}
