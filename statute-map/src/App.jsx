import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Library, LifeBuoy, Moon, Network, Scale, Sun } from "lucide-react";
import StatuteFinder from "./views/StatuteFinder";
import LibraryView from "./views/LibraryView";
import ReaderView from "./views/ReaderView";
import MapView from "./views/MapView";
import DocsView from "./reader/components/DocsView";
import { findEntry } from "./library/catalog";
import { getCatalog } from "./library/library";
import { resolveInitialSlug } from "./library/resolveInitialSlug";

const LAST_SLUG_KEY = "statute-explorer:last-slug";
const RECENT_KEY = "statute-map:recent";
const THEME_KEY = "statute-map:theme";
const TABS = [
  { key: "library", label: "Library", icon: Library },
  { key: "read", label: "Read", icon: BookOpen },
  { key: "map", label: "Map", icon: Network },
  { key: "guide", label: "Guide", icon: LifeBuoy },
];

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse this. These are only conveniences.
  }
}

/** `?view=read&statute=c-46&section=265`. The old two-page app's links
 *  (`/explorer/?statute=…`, `/?statute=…`) keep working. */
function parseLocation() {
  const params = new URLSearchParams(window.location.search);
  const statute = params.get("statute");
  const legacyView = window.location.pathname.startsWith("/explorer") ? "read" : statute ? "map" : "library";
  const view = params.get("view") ?? legacyView;
  return {
    view: TABS.some((t) => t.key === view) ? view : "library",
    statute,
    section: params.get("section"),
  };
}

function buildUrl(view, statute, section) {
  const params = new URLSearchParams();
  if (view !== "library") params.set("view", view);
  if (statute) params.set("statute", statute);
  if (section) params.set("section", section);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function initialTheme() {
  const stored = readStored(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [entries, setEntries] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const [view, setView] = useState(() => parseLocation().view);
  const [readTarget, setReadTarget] = useState(null);
  const [mapTarget, setMapTarget] = useState(null);
  const [mapOpened, setMapOpened] = useState(false);
  const [unavailable, setUnavailable] = useState(null);
  const [recent, setRecent] = useState(() => {
    try {
      return JSON.parse(readStored(RECENT_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const [theme, setTheme] = useState(initialTheme);
  const finderRef = useRef(null);
  // What each view is currently showing, for building its URL.
  const locations = useRef({ read: {}, map: {} });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const refreshEntries = useCallback(() => getCatalog().then(setEntries), []);

  const openRead = useCallback((entry, section = null) => {
    setUnavailable(null);
    setReadTarget({ entry, section, at: Date.now() });
    setView("read");
    locations.current.read = { statute: entry.slug, section };
    window.history.pushState(null, "", buildUrl("read", entry.slug, section));
    writeStored(LAST_SLUG_KEY, entry.slug);
    setRecent((prev) => {
      const next = [entry.slug, ...prev.filter((s) => s !== entry.slug)].slice(0, 6);
      writeStored(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const openMap = useCallback((entry, section = null) => {
    setMapTarget({ entry, section, at: Date.now() });
    setMapOpened(true);
    setView("map");
    locations.current.map = { statute: entry.code, section };
    window.history.pushState(null, "", buildUrl("map", entry.code, section));
  }, []);

  /** Applies whatever the address bar says, on load and on back/forward. */
  const applyLocation = useCallback(async () => {
    const list = await getCatalog();
    const { view: nextView, statute, section } = parseLocation();
    setView(nextView);
    setUnavailable(null);
    if (nextView === "map") setMapOpened(true);
    if (!statute) return;

    const linked = findEntry(list, statute);
    const { unavailableSlug } = resolveInitialSlug(list, {
      linkedSlug: linked?.slug ?? statute,
      remembered: null,
    });
    if (unavailableSlug) {
      setView("read");
      setUnavailable(unavailableSlug);
    } else if (nextView === "map") {
      setMapTarget({ entry: linked, section, at: Date.now() });
    } else if (nextView === "read") {
      setReadTarget({ entry: linked, section, at: Date.now() });
    }
  }, []);

  useEffect(() => {
    getCatalog()
      .then(setEntries)
      .then(applyLocation)
      .catch((err) => setCatalogError(err.message));
    const onPop = () => void applyLocation();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [applyLocation]);

  // "/" jumps to statute search from anywhere you're not already typing.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (e.key !== "/" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      finderRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (view === "library") document.title = "Library · Statute Map";
    if (view === "guide") document.title = "Guide · Statute Map";
    if (view === "map") document.title = "Map · Statute Map";
  }, [view]);

  const selectTab = (key) => {
    setView(key);
    if (key === "map") setMapOpened(true);
    const location = locations.current[key] ?? {};
    window.history.pushState(null, "", buildUrl(key, location.statute, location.section));
    if (key === "read" && !readTarget && !unavailable && entries) {
      const last = findEntry(entries, readStored(LAST_SLUG_KEY));
      if (last) openRead(last);
    }
  };

  const handleReadLocation = useCallback((entry, section) => {
    locations.current.read = { statute: entry.slug, section };
    if (parseLocation().view === "read") {
      window.history.replaceState(null, "", buildUrl("read", entry.slug, section));
    }
  }, []);

  const handleMapLocation = useCallback((code, section) => {
    locations.current.map = code ? { statute: code, section } : {};
    if (parseLocation().view === "map") {
      window.history.replaceState(null, "", buildUrl("map", code, section));
    }
  }, []);

  const readFromMap = useCallback(
    async (code, section) => {
      const entry = findEntry(await getCatalog(), code);
      if (entry) openRead(entry, section);
    },
    [openRead],
  );

  if (catalogError) {
    return <div className="load-error">Couldn't load the statute list: {catalogError}</div>;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button type="button" className="brand" onClick={() => selectTab("library")}>
          <span className="brand-mark" aria-hidden="true"><Scale size={15} /></span>
          <span className="brand-name">Statute Map</span>
        </button>

        <nav className="view-tabs" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={t.key === view ? "active" : ""}
              aria-current={t.key === view ? "page" : undefined}
              onClick={() => selectTab(t.key)}
            >
              <t.icon size={15} aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="header-tools">
          {view !== "library" && (
            <StatuteFinder
              ref={finderRef}
              entries={entries ?? []}
              label="Find a statute"
              placeholder="Find a statute"
              shortcut="/"
              onPick={(entry) => openRead(entry)}
            />
          )}
          <button
            type="button"
            className="theme-toggle"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              writeStored(THEME_KEY, next);
            }}
          >
            {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>
      </header>

      {view === "library" && (
        <LibraryView
          ref={finderRef}
          entries={entries}
          recent={recent}
          onRead={openRead}
          onMap={openMap}
          onEntriesChanged={refreshEntries}
        />
      )}

      {view === "guide" && <DocsView />}

      {/* These two stay mounted once opened, so going back to one finds it
          exactly as you left it: same section, same pan and zoom. */}
      <div className="view-slot" hidden={view !== "read"}>
        <ReaderView
          entries={entries ?? []}
          target={readTarget}
          unavailable={unavailable}
          theme={theme}
          visible={view === "read"}
          onShowOnMap={openMap}
          onOpen={openRead}
          onEntriesChanged={refreshEntries}
          onLocation={handleReadLocation}
          onBrowse={() => selectTab("library")}
        />
      </div>

      {mapOpened && (
        <div className="view-slot" hidden={view !== "map"}>
          <MapView
            entries={entries ?? []}
            target={mapTarget}
            visible={view === "map"}
            onRead={readFromMap}
            onLocation={handleMapLocation}
            onOpenGuide={() => selectTab("guide")}
          />
        </div>
      )}
    </div>
  );
}
