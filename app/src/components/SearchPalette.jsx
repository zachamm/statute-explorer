import { useEffect, useMemo, useRef, useState } from "react";
import { searchStatute } from "../lib/search";

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text, tokens) {
  if (!tokens.length) return text;
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  const tokenSet = new Set(tokens);
  return text
    .split(pattern)
    .map((part, i) =>
      tokenSet.has(part.toLowerCase()) ? <mark key={i}>{part}</mark> : part,
    );
}

export default function SearchPalette({ statute, onJumpSection, onClose }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );
  const results = useMemo(
    () => searchStatute(statute, query),
    [statute, query],
  );

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const jump = (id) => {
    onJumpSection(id);
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      jump(results[selected].id);
    }
  };

  return (
    <div className="search-backdrop" onClick={onClose}>
      <div className="search-palette" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <span className="search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search this statute by heading, section number, or term…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button type="button" className="search-close" onClick={onClose}>
            Esc
          </button>
        </div>

        {query.trim() === "" && (
          <p className="search-hint">
            Type to search {Object.keys(statute.sections).length} sections in{" "}
            {statute.title}.
          </p>
        )}

        {query.trim() !== "" && results.length === 0 && (
          <p className="search-hint">No sections match "{query.trim()}".</p>
        )}

        {results.length > 0 && (
          <ul className="search-results" ref={listRef}>
            {results.map((r, i) => (
              <li key={r.id} data-index={i}>
                <button
                  type="button"
                  className={i === selected ? "active" : ""}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => jump(r.id)}
                >
                  <div className="search-result-head">
                    <span className="search-result-num">s.{r.number}</span>
                    <span className="search-result-note">
                      {highlight(r.marginalNote || r.partTitle, tokens)}
                    </span>
                  </div>
                  <p className="search-result-snippet">
                    {highlight(r.snippet, tokens)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
