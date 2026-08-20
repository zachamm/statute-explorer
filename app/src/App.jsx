import { useCallback, useEffect, useMemo, useState } from "react";
import SectionTree from "./components/SectionTree";
import ReadingView from "./components/ReadingView";
import CrossRefGraph from "./components/CrossRefGraph";
import DefinitionTooltip from "./components/DefinitionTooltip";
import DocsView from "./components/DocsView";
import ImportView from "./components/ImportView";
import SearchPalette from "./components/SearchPalette";
import {
  fetchManifest,
  fetchStatute,
  orderedSectionIds,
  getNeighborSections,
} from "./lib/statute";

const LAST_SLUG_KEY = "statute-explorer:last-slug";
const JURISDICTION_ORDER = ["federal", "ontario"];
const JURISDICTION_LABEL = { federal: "Federal", ontario: "Ontario" };
const TABS = [
  { key: "reader", label: "Reader" },
  { key: "import", label: "Add a statute" },
  { key: "docs", label: "Documentation" },
];

function App() {
  const [view, setView] = useState("reader");
  const [manifest, setManifest] = useState(null);
  const [manifestError, setManifestError] = useState(null);
  const [slug, setSlug] = useState(null);
  const [statute, setStatute] = useState(null);
  const [statuteError, setStatuteError] = useState(null);
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [hover, setHover] = useState({ termId: null, position: { x: 0, y: 0 } });
  const [mobilePanel, setMobilePanel] = useState(null); // null | "tree" | "graph" — narrow-viewport drawers
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    fetchManifest()
      .then((list) => {
        setManifest(list);
        const remembered = localStorage.getItem(LAST_SLUG_KEY);
        const initial = list.find((m) => m.slug === remembered) ?? list[0];
        if (initial) setSlug(initial.slug);
      })
      .catch((err) => setManifestError(err.message));
  }, []);

  useEffect(() => {
    if (!slug) return;
    setStatute(null);
    setStatuteError(null);
    setMobilePanel(null);
    setSearchOpen(false);
    fetchStatute(slug)
      .then((doc) => {
        setStatute(doc);
        setSelectedSectionId(orderedSectionIds(doc)[0]);
        localStorage.setItem(LAST_SLUG_KEY, slug);
      })
      .catch((err) => setStatuteError(err.message));
  }, [slug]);

  // Cmd/Ctrl+K opens search from anywhere while reading — the visible
  // button in the tree pane covers people who'd never think to try it.
  useEffect(() => {
    if (view !== "reader") return;
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view]);

  const handleJump = useCallback((sectionId) => {
    setSelectedSectionId(sectionId);
    setHover({ termId: null, position: { x: 0, y: 0 } });
    setMobilePanel(null);
    document.querySelector(".reading-pane")?.scrollTo({ top: 0 });
  }, []);

  const handleHoverTerm = useCallback((termId, position) => {
    setHover((prev) =>
      termId ? { termId, position } : { ...prev, termId: null },
    );
  }, []);

  const handleImported = useCallback((newSlug) => {
    fetchManifest()
      .then((list) => {
        setManifest(list);
        setSlug(newSlug);
        setView("reader");
      })
      .catch((err) => setManifestError(err.message));
  }, []);

  const alphabetizedTerms = useMemo(() => {
    if (!statute) return [];
    return Object.values(statute.definitions).sort((a, b) =>
      a.term.localeCompare(b.term),
    );
  }, [statute]);

  const { outgoing, incoming } = useMemo(
    () =>
      statute && selectedSectionId
        ? getNeighborSections(statute, selectedSectionId)
        : { outgoing: [], incoming: [] },
    [statute, selectedSectionId],
  );

  if (manifestError) {
    return (
      <div className="load-error">
        Couldn't load the statute list: {manifestError}
      </div>
    );
  }

  const readerReady = manifest && statute && selectedSectionId;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <h1>
            {view === "reader" && readerReady
              ? statute.title
              : "Statute Anatomy Explorer"}
          </h1>
          <span className="brand-eyebrow">Statute Anatomy Explorer</span>
        </div>

        <nav className="view-tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={t.key === view ? "active" : ""}
              onClick={() => {
                setView(t.key);
                setMobilePanel(null);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {view === "reader" && readerReady && manifest.length > 1 && (
          <select
            className="statute-picker"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            aria-label="Choose a statute"
          >
            {JURISDICTION_ORDER.filter((j) =>
              manifest.some((m) => m.jurisdiction === j),
            ).map((j) => (
              <optgroup key={j} label={JURISDICTION_LABEL[j] ?? j}>
                {manifest
                  .filter((m) => m.jurisdiction === j)
                  .map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.title} ({m.id})
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        )}

        {view === "reader" && readerReady && (
          <span className="app-citation">
            {statute.citation}
            <span className="citation-sep">·</span>
            current to {statute.consolidatedDate}
          </span>
        )}
      </header>

      {view === "docs" && <DocsView />}

      {view === "import" && (
        <ImportView
          onImported={handleImported}
          onOpenDocs={() => setView("docs")}
        />
      )}

      {view === "reader" && !readerReady && (
        <div className="load-pending">
          {statuteError ? `Couldn't load that statute: ${statuteError}` : "Loading…"}
        </div>
      )}

      {view === "reader" && readerReady && (
        <div className="mobile-toolbar">
          <button type="button" onClick={() => setSearchOpen(true)}>
            ⌕ Search
          </button>
          <button type="button" onClick={() => setMobilePanel("tree")}>
            ☰ Contents
          </button>
          <button type="button" onClick={() => setMobilePanel("graph")}>
            Section map
          </button>
        </div>
      )}

      {view === "reader" && readerReady && mobilePanel && (
        <div
          className="mobile-backdrop"
          onClick={() => setMobilePanel(null)}
          aria-hidden="true"
        />
      )}

      {view === "reader" && readerReady && (
        <div className="app-body">
          <aside className={`tree-pane${mobilePanel === "tree" ? " mobile-open" : ""}`}>
            <button
              type="button"
              className="mobile-drawer-close"
              onClick={() => setMobilePanel(null)}
            >
              Close ✕
            </button>
            <button type="button" className="tree-search-trigger" onClick={() => setSearchOpen(true)}>
              <span aria-hidden="true">⌕</span> Search this statute
              <kbd>{navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K"}</kbd>
            </button>
            <SectionTree
              key={statute.id}
              statute={statute}
              selectedSectionId={selectedSectionId}
              onSelect={handleJump}
            />
          </aside>

          <main className="reading-pane">
            <ReadingView
              statute={statute}
              sectionId={selectedSectionId}
              onJumpSection={handleJump}
              onHoverTerm={handleHoverTerm}
            />
          </main>

          <aside className={`graph-pane${mobilePanel === "graph" ? " mobile-open" : ""}`}>
            <button
              type="button"
              className="mobile-drawer-close"
              onClick={() => setMobilePanel(null)}
            >
              Close ✕
            </button>
            <section>
              <h2 className="rail-heading">
                <span className="rail-heading-index">01</span>Section map
              </h2>
              <CrossRefGraph
                statute={statute}
                sectionId={selectedSectionId}
                onJumpSection={handleJump}
              />
              <div className="ref-lists">
                <div>
                  <h3>Cites out — {outgoing.length}</h3>
                  <ul>
                    {outgoing.map((id) => (
                      <li key={id}>
                        <button type="button" onClick={() => handleJump(id)}>
                          <span className="ref-arrow" aria-hidden="true">
                            →
                          </span>
                          <span className="ref-num">s.{statute.sections[id].number}</span>
                          <span className="ref-note">
                            {statute.sections[id].marginalNote}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>Cited by — {incoming.length}</h3>
                  <ul>
                    {incoming.map((id) => (
                      <li key={id}>
                        <button type="button" onClick={() => handleJump(id)}>
                          <span className="ref-arrow" aria-hidden="true">
                            ←
                          </span>
                          <span className="ref-num">s.{statute.sections[id].number}</span>
                          <span className="ref-note">
                            {statute.sections[id].marginalNote}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section className="defined-terms-panel">
              <h2 className="rail-heading">
                <span className="rail-heading-index">02</span>Index of defined terms
              </h2>
              <ul>
                {alphabetizedTerms.map((def) => (
                  <li key={def.id}>
                    <button
                      type="button"
                      className={def.sectionId === selectedSectionId ? "active" : ""}
                      onClick={() => handleJump(def.sectionId)}
                    >
                      <span className="index-term">{def.term}</span>
                      <span className="index-leader" aria-hidden="true" />
                      <span className="index-loc">
                        s.{statute.sections[def.sectionId].number}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      )}

      {view === "reader" && readerReady && (
        <DefinitionTooltip
          statute={statute}
          termId={hover.termId}
          position={hover.position}
        />
      )}

      {view === "reader" && readerReady && searchOpen && (
        <SearchPalette
          statute={statute}
          onJumpSection={handleJump}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
