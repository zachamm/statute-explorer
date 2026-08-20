import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import guideMd from "../../../docs/GUIDE.md?raw";
import readmeMd from "../../../README.md?raw";
import schemaMd from "../../../docs/SCHEMA.md?raw";
import { extractHeadings } from "../lib/docOutline";

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
for (const doc of ALL_DOCS) doc.outline = extractHeadings(doc.content);

export default function DocsView() {
  const [active, setActive] = useState("guide");
  const [activeHeading, setActiveHeading] = useState(null);
  const contentRef = useRef(null);
  const activeDoc = ALL_DOCS.find((d) => d.key === active);

  // Highlights whichever heading is currently at the top of the visible
  // content, so the outline tracks scroll position the way Netlify's or
  // Mintlify's docs do — without this, "on this page" nav is just a
  // one-way jump list with no sense of where you actually are.
  useEffect(() => {
    setActiveHeading(activeDoc.outline[0]?.id ?? null);
    const container = contentRef.current;
    if (!container || activeDoc.outline.length === 0) return;

    const headingEls = activeDoc.outline
      .map((h) => document.getElementById(h.id))
      .filter(Boolean);
    if (headingEls.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveHeading(visible[0].target.id);
      },
      { root: container, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    headingEls.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [activeDoc]);

  const jumpToHeading = (id) => {
    // Set directly rather than leaving it to the IntersectionObserver: a
    // short doc can't always scroll its last heading(s) into that
    // observer's trigger zone (there's not enough content left below to
    // push them up), so a click near the end of the outline could
    // otherwise scroll correctly but highlight the wrong, earlier item.
    setActiveHeading(id);
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="docs-view">
      <nav className="docs-nav">
        {GROUPS.map((group) => (
          <div className="docs-nav-group" key={group.label}>
            <div className="docs-nav-group-label">{group.label}</div>
            {group.docs.map((d) => (
              <div key={d.key}>
                <button
                  type="button"
                  className={d.key === active ? "active" : ""}
                  onClick={() => setActive(d.key)}
                >
                  {d.label}
                </button>
                {d.key === active && d.outline.length > 0 && (
                  <ul className="docs-outline">
                    {d.outline.map((h) => (
                      <li key={h.id} className={`depth-${h.depth}`}>
                        <button
                          type="button"
                          className={h.id === activeHeading ? "active" : ""}
                          onClick={() => jumpToHeading(h.id)}
                        >
                          {h.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ))}
      </nav>
      <article className="docs-content" ref={contentRef}>
        <div className="docs-card">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]}>
            {activeDoc.content}
          </ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
