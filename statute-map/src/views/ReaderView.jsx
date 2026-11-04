import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, Gavel, List, Network, RefreshCw, Search, X } from "lucide-react";
import SectionTree from "../reader/components/SectionTree";
import ReadingView from "../reader/components/ReadingView";
import CrossRefGraph, { REF_LISTS_ID } from "../reader/components/CrossRefGraph";
import DefinitionTooltip from "../reader/components/DefinitionTooltip";
import SearchPalette from "../reader/components/SearchPalette";
import { orderedSectionIds, getNeighborSections } from "../reader/lib/statute";
import { describeEntry, findEntry } from "../library/catalog";
import { loadDocument, removeSaved } from "../library/library";
import { casesUrl, copyCitation } from "../library/legalLinks";
import { checkForUpdate } from "../library/updates";

function RegulationLinks({ codes, entries, onOpen }) {
  return (
    <ul className="rail-links">
      {codes
        .map((code) => findEntry(entries, code))
        .filter(Boolean)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((entry) => (
          <li key={entry.slug}>
            <button type="button" onClick={() => onOpen(entry)}>{entry.title}</button>
          </li>
        ))}
    </ul>
  );
}

export default function ReaderView({
  entries,
  target,
  unavailable,
  theme,
  visible,
  onShowOnMap,
  onOpen,
  onEntriesChanged,
  onLocation,
  onBrowse,
}) {
  const [entry, setEntry] = useState(null);
  const [statute, setStatute] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [hover, setHover] = useState({ termId: null, position: { x: 0, y: 0 } });
  const [mobilePanel, setMobilePanel] = useState(null); // null | "tree" | "graph" — narrow-viewport drawers
  const [searchOpen, setSearchOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [latest, setLatest] = useState(null);
  const [reloads, setReloads] = useState(0);
  const loadedSlug = useRef(null);
  // Where to land after an update reloads the statute in place.
  const resumeSection = useRef(null);

  const initialSectionId = (doc, number) => {
    const linked = number ? `s${number}` : null;
    return linked && doc.sections[linked] ? linked : orderedSectionIds(doc)[0] ?? null;
  };

  useEffect(() => {
    if (!target) return undefined;
    // Already open: this is just a jump to another section of it.
    if (target.entry.slug === loadedSlug.current && statute) {
      setSelectedSectionId(initialSectionId(statute, target.section));
      return undefined;
    }

    let cancelled = false;
    setEntry(target.entry);
    setStatute(null);
    setLoadError(null);
    setLatest(null);
    setMobilePanel(null);
    setSearchOpen(false);
    loadDocument(target.entry, (message) => {
      if (!cancelled) setProgress(message);
    })
      .then((doc) => {
        if (cancelled) return;
        loadedSlug.current = target.entry.slug;
        setStatute(doc);
        setProgress(null);
        setSelectedSectionId(initialSectionId(doc, resumeSection.current ?? target.section));
        resumeSection.current = null;
      })
      .catch((err) => {
        if (cancelled) return;
        setProgress(null);
        setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // `statute` is only read to detect "already open"; a change to it alone
    // must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reloads]);

  useEffect(() => {
    if (!statute || !entry) return undefined;
    let cancelled = false;
    checkForUpdate(entry, statute.consolidatedDate).then((date) => {
      if (!cancelled) setLatest(date);
    });
    return () => {
      cancelled = true;
    };
  }, [statute, entry]);

  // The banner shortens the panes beneath it, which can push the current
  // section out of the table of contents' view.
  useEffect(() => {
    if (latest) document.querySelector(".tree-section-link.active")?.scrollIntoView({ block: "nearest" });
  }, [latest]);

  const updateStatute = async () => {
    const section = statute.sections[selectedSectionId]?.number ?? null;
    await removeSaved(entry);
    await onEntriesChanged();
    loadedSlug.current = null;
    resumeSection.current = section;
    setReloads((n) => n + 1);
  };

  const handleCopy = async () => {
    await copyCitation(statute, currentNumber);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const currentSection = statute && selectedSectionId ? statute.sections[selectedSectionId] : null;
  const currentNumber = currentSection?.number ?? null;

  useEffect(() => {
    if (!entry || !currentNumber) return;
    onLocation(entry, currentNumber);
    if (visible) document.title = `${statute.title} s. ${currentNumber} · Statute Map`;
  }, [entry, currentNumber, statute, visible, onLocation]);

  // Cmd/Ctrl+K opens search from anywhere while reading — the visible
  // button in the tree pane covers people who'd never think to try it.
  useEffect(() => {
    if (!visible || !statute) return;
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, statute]);

  const handleJump = useCallback((sectionId) => {
    setSelectedSectionId(sectionId);
    setHover({ termId: null, position: { x: 0, y: 0 } });
    setMobilePanel(null);
    document.querySelector(".reading-pane")?.scrollTo({ top: 0 });
  }, []);

  const handleHoverTerm = useCallback((termId, position) => {
    setHover((prev) => (termId ? { termId, position } : { ...prev, termId: null }));
  }, []);

  const alphabetizedTerms = useMemo(() => {
    if (!statute) return [];
    return Object.values(statute.definitions).sort((a, b) => a.term.localeCompare(b.term));
  }, [statute]);

  const { outgoing, incoming } = useMemo(
    () =>
      statute && selectedSectionId
        ? getNeighborSections(statute, selectedSectionId)
        : { outgoing: [], incoming: [] },
    [statute, selectedSectionId],
  );

  if (unavailable) {
    return (
      <div className="reader-message">
        <h2>That statute isn't in the catalogue</h2>
        <p>The link asked for "{unavailable}", which doesn't match anything in the index.</p>
        <button type="button" className="primary-action" onClick={onBrowse}>Search the library</button>
      </div>
    );
  }

  if (!target) {
    return (
      <div className="reader-message">
        <h2>Nothing open yet</h2>
        <p>Choose a statute to read. Every federal Act and regulation is one search away.</p>
        <button type="button" className="primary-action" onClick={onBrowse}>Go to the library</button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="reader-message">
        <h2>Couldn't open {entry?.title ?? "that statute"}</h2>
        <p>{loadError}</p>
        <button type="button" className="primary-action" onClick={onBrowse}>Back to the library</button>
      </div>
    );
  }

  if (!statute) {
    return (
      <div className="reader-message" role="status">
        <span className="spinner" aria-hidden="true" />
        <p>{progress ?? "Loading…"}</p>
      </div>
    );
  }

  // The catalogue's links are more complete than the entry a link was opened
  // with, which may predate the catalogue finishing a refresh.
  const known = findEntry(entries, entry.slug) ?? entry;

  if (!selectedSectionId) {
    return (
      <div className="reader-message">
        <h2>{statute.title} has no numbered sections</h2>
        <p>Some orders and regulations are a single block of text with nothing to navigate, so there's nothing to show here.</p>
        <a className="primary-action" href={statute.sourceUrl} target="_blank" rel="noopener noreferrer">Read it on the government site</a>
      </div>
    );
  }

  return (
    <div className="reader">
      <div className="reader-bar">
        <div className="reader-bar-title">
          <h1>{statute.title}</h1>
          <span className="reader-bar-citation">
            {describeEntry(entry)}
            {statute.citation ? ` · ${statute.citation}` : ""}
            {statute.consolidatedDate && entry.code !== "CHARTER" ? ` · last amended ${statute.consolidatedDate}` : ""}
          </span>
        </div>
        <a className="ghost-button" href={statute.sourceUrl} target="_blank" rel="noopener noreferrer">
          Official text <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>

      {latest && (
        <div className="update-banner" role="status">
          <RefreshCw size={15} aria-hidden="true" />
          <span>A newer version of this statute is available, last amended {latest}.</span>
          <button type="button" onClick={updateStatute}>Update now</button>
          <button type="button" className="update-dismiss" aria-label="Dismiss" onClick={() => setLatest(null)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="mobile-toolbar">
        <button type="button" onClick={() => setSearchOpen(true)}><Search size={14} aria-hidden="true" /> Search</button>
        <button type="button" onClick={() => setMobilePanel("tree")}><List size={14} aria-hidden="true" /> Contents</button>
        <button type="button" onClick={() => setMobilePanel("graph")}><Network size={14} aria-hidden="true" /> Connections</button>
      </div>

      {mobilePanel && (
        <div className="mobile-backdrop" onClick={() => setMobilePanel(null)} aria-hidden="true" />
      )}

      <div className="app-body">
        <aside className={`tree-pane${mobilePanel === "tree" ? " mobile-open" : ""}`}>
          <button type="button" className="mobile-drawer-close" onClick={() => setMobilePanel(null)}>
            <X size={15} aria-hidden="true" /> Close
          </button>
          <button type="button" className="tree-search-trigger" onClick={() => setSearchOpen(true)}>
            <Search size={14} aria-hidden="true" /> Search this statute
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
            actions={
              <div className="section-actions">
                <button type="button" className="ghost-button" onClick={handleCopy}>
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  <span aria-live="polite">{copied ? "Copied" : "Copy citation"}</span>
                </button>
                <a
                  className="ghost-button"
                  href={casesUrl(statute.title, currentNumber)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Gavel size={14} aria-hidden="true" /> Find cases
                </a>
                <button type="button" className="ghost-button" onClick={() => onShowOnMap(entry, currentNumber)}>
                  <Network size={14} aria-hidden="true" /> Show on map
                </button>
              </div>
            }
          />
        </main>

        <aside className={`graph-pane${mobilePanel === "graph" ? " mobile-open" : ""}`}>
          <button type="button" className="mobile-drawer-close" onClick={() => setMobilePanel(null)}>
            <X size={15} aria-hidden="true" /> Close
          </button>
          <section>
            <h2 className="rail-heading">
              Section map
            </h2>
            <CrossRefGraph
              key={theme}
              statute={statute}
              sectionId={selectedSectionId}
              onJumpSection={handleJump}
            />
            {/* id targeted by CrossRefGraph's aria-describedby (C-03 §2.2) —
                this is the canvas mini-graph's real text equivalent, not a
                redundant duplicate of it. */}
            <div className="ref-lists" id={REF_LISTS_ID}>
              <div>
                <h3>Cites out ({outgoing.length})</h3>
                <ul>
                  {outgoing.map((id) => (
                    <li key={id}>
                      <button type="button" onClick={() => handleJump(id)}>
                                                <span className="ref-num">s.{statute.sections[id].number}</span>
                        <span className="ref-note">{statute.sections[id].marginalNote}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Cited by ({incoming.length})</h3>
                <ul>
                  {incoming.map((id) => (
                    <li key={id}>
                      <button type="button" onClick={() => handleJump(id)}>
                                                <span className="ref-num">s.{statute.sections[id].number}</span>
                        <span className="ref-note">{statute.sections[id].marginalNote}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {known.enablingActs.length > 0 && (
            <section>
              <h2 className="rail-heading">Made under</h2>
              <RegulationLinks codes={known.enablingActs} entries={entries} onOpen={onOpen} />
            </section>
          )}

          {known.regulations.length > 0 && (
            <details className="rail-details">
              <summary className="rail-heading">Regulations under this Act ({known.regulations.length})</summary>
              <RegulationLinks codes={known.regulations} entries={entries} onOpen={onOpen} />
            </details>
          )}

          <section className="defined-terms-panel">
            <h2 className="rail-heading">
              Defined terms
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
                    <span className="index-loc">s.{statute.sections[def.sectionId].number}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <DefinitionTooltip statute={statute} termId={hover.termId} position={hover.position} />

      {searchOpen && (
        <SearchPalette statute={statute} onJumpSection={handleJump} onClose={() => setSearchOpen(false)} />
      )}
    </div>
  );
}
