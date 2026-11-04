import { forwardRef, useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, Network, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { STARTING_POINTS, describeEntry, findEntry, searchCatalog } from "../library/catalog";
import { addUploadedFile, removeSaved, resolveLink } from "../library/library";
import { checkForUpdate } from "../library/updates";

const FILTERS = [
  { key: "all", label: "Everything", test: () => true },
  { key: "act", label: "Federal Acts", test: (e) => e.jurisdiction === "federal" && e.kind === "act" },
  { key: "regulation", label: "Regulations", test: (e) => e.kind === "regulation" },
  { key: "ontario", label: "Ontario", test: (e) => e.jurisdiction === "ontario" },
];

function formatCount(entry) {
  return entry.sectionCount ? `${entry.sectionCount.toLocaleString()} sections` : null;
}

function StatuteRow({ entry, onRead, onMap, onRemove, latest, onUpdate }) {
  const meta = [describeEntry(entry), entry.citation ?? entry.code, formatCount(entry)].filter(Boolean);
  return (
    <li className="statute-row">
      <button type="button" className="statute-row-main" onClick={() => onRead(entry)}>
        <span className="statute-row-title">{entry.title}</span>
        <span className="statute-row-meta">{meta.join(" · ")}</span>
      </button>
      <div className="statute-row-actions">
        {latest && (
          <button
            type="button"
            className="row-action is-update"
            title={`A newer version is available, last amended ${latest}`}
            onClick={() => onUpdate(entry)}
          >
            <RefreshCw size={14} aria-hidden="true" /> Update
          </button>
        )}
        <button type="button" className="row-action" aria-label={`Read ${entry.title}`} onClick={() => onRead(entry)}>
          <BookOpen size={14} aria-hidden="true" /> Read
        </button>
        <button type="button" className="row-action" aria-label={`Map ${entry.title}`} onClick={() => onMap(entry)}>
          <Network size={14} aria-hidden="true" /> Map
        </button>
        {onRemove && (
          <button
            type="button"
            className="row-action is-icon"
            aria-label={`Remove ${entry.title} from this browser`}
            title="Remove from this browser"
            onClick={() => onRemove(entry)}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

const LibraryView = forwardRef(function LibraryView(
  { entries, recent, onRead, onMap, onEntriesChanged },
  ref,
) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [updates, setUpdates] = useState({});

  const list = useMemo(() => entries ?? [], [entries]);
  const looksLikeLink = /^(https?:\/\/|www\.|laws-lois\.|ontario\.ca)/i.test(query.trim());
  const pool = useMemo(
    () => list.filter(FILTERS.find((f) => f.key === filter).test),
    [list, filter],
  );
  const results = useMemo(
    () => (looksLikeLink ? [] : searchCatalog(pool, query, 60)),
    [pool, query, looksLikeLink],
  );
  const startingPoints = useMemo(
    () => STARTING_POINTS.map((code) => findEntry(list, code)).filter(Boolean),
    [list],
  );
  const saved = useMemo(() => list.filter((e) => e.saved), [list]);
  const recentEntries = useMemo(
    () => recent.map((slug) => findEntry(list, slug)).filter(Boolean),
    [recent, list],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const entry of saved) {
        const latest = await checkForUpdate(entry, entry.currentTo);
        if (cancelled) return;
        if (latest) setUpdates((prev) => ({ ...prev, [entry.slug]: latest }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [saved]);

  const handleUpdate = async (entry) => {
    await removeSaved(entry);
    await onEntriesChanged();
    setUpdates(({ [entry.slug]: _done, ...rest }) => rest);
    onRead(entry);
  };

  const openLink = async () => {
    setNotice(null);
    try {
      onRead(await resolveLink(query.trim()));
    } catch (err) {
      setNotice({ error: true, text: err.message });
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setNotice({ text: `Reading ${file.name}…` });
    try {
      const entry = await addUploadedFile(file);
      await onEntriesChanged();
      setNotice(null);
      onRead(entry);
    } catch (err) {
      setNotice({ error: true, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (entry) => {
    await removeSaved(entry);
    await onEntriesChanged();
    setNotice({ text: `Removed ${entry.title} from this browser. It will download the current text the next time you open it.` });
  };

  const searching = query.trim().length > 0;

  return (
    <div className="library">
      <div className="library-column">
        <section className="library-hero">
          <h1>Find any Canadian statute</h1>
          <p>
            Search every federal Act and regulation and the main Ontario Acts. The text
            comes straight from Justice Laws and e-Laws when you open one, with its
            definitions and cross-references linked.
          </p>
          <div className="library-search">
            <Search className="library-search-icon" size={20} aria-hidden="true" />
            <input
              ref={ref}
              type="search"
              aria-label="Search for a statute, or paste a link to one"
              placeholder="Name, short form like CDSA, code, or a link"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (looksLikeLink) void openLink();
                else if (results[0]) onRead(results[0]);
              }}
            />
          </div>
          <div className="library-filters" role="group" aria-label="Filter results">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                className={filter === f.key ? "active" : ""}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </section>

        {notice && (
          <div className={`library-notice${notice.error ? " is-error" : ""}`} role="status">
            {notice.text}
          </div>
        )}

        {entries === null && <div className="library-loading">Loading the catalogue…</div>}

        {looksLikeLink && (
          <section>
            <button type="button" className="primary-action" onClick={openLink}>
              Open this link <ArrowRight size={15} aria-hidden="true" />
            </button>
          </section>
        )}

        {searching && !looksLikeLink && entries && (
          <section>
            <h2 className="library-heading">
              {results.length === 0
                ? "Nothing matches that"
                : `${results.length === 60 ? "Top 60" : results.length} result${results.length === 1 ? "" : "s"}`}
            </h2>
            {results.length === 0 && (
              <p className="library-hint">
                Try fewer words, or paste the statute's link from laws-lois.justice.gc.ca or
                ontario.ca/laws. The filter above may be hiding it, too.
              </p>
            )}
            <ul className="statute-list">
              {results.map((entry) => (
                <StatuteRow key={entry.slug} entry={entry} onRead={onRead} onMap={onMap} />
              ))}
            </ul>
          </section>
        )}

        {!searching && entries && (
          <>
            {recentEntries.length > 0 && (
              <section>
                <h2 className="library-heading">Pick up where you left off</h2>
                <ul className="statute-list">
                  {recentEntries.map((entry) => (
                    <StatuteRow key={entry.slug} entry={entry} onRead={onRead} onMap={onMap} />
                  ))}
                </ul>
              </section>
            )}

            {saved.length > 0 && (
              <section>
                <h2 className="library-heading">Saved in this browser</h2>
                <ul className="statute-list">
                  {saved.map((entry) => (
                    <StatuteRow
                      key={entry.slug}
                      entry={entry}
                      onRead={onRead}
                      onMap={onMap}
                      onRemove={handleRemove}
                      latest={updates[entry.slug]}
                      onUpdate={handleUpdate}
                    />
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h2 className="library-heading">Common starting points</h2>
              <ul className="statute-list">
                {startingPoints.map((entry) => (
                  <StatuteRow key={entry.slug} entry={entry} onRead={onRead} onMap={onMap} />
                ))}
              </ul>
            </section>

            <section>
              <h2 className="library-heading">Have a file instead?</h2>
              <label
                className={`import-dropzone${dragOver ? " is-drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void handleFile(e.dataTransfer.files[0]);
                }}
              >
                <input
                  type="file"
                  accept=".xml,.json"
                  disabled={busy}
                  onChange={(e) => void handleFile(e.target.files[0])}
                  hidden
                />
                <Upload size={18} aria-hidden="true" />
                <span className="import-dropzone-title">Upload a Justice Laws XML or e-Laws JSON file</span>
                <span className="import-dropzone-hint">
                  You shouldn't need this, since search covers federal law and any e-Laws link opens directly. Drag a file here, or click to browse.
                </span>
              </label>
            </section>
          </>
        )}
      </div>
    </div>
  );
});

export default LibraryView;
