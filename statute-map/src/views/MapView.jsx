import { useEffect, useRef, useState } from "react";
import { Download, Maximize, MoreHorizontal, Pencil, Plus, Trash2, Upload } from "lucide-react";
import StatuteFinder from "./StatuteFinder";
import { findEntry } from "../library/catalog";
import { mountMap } from "../map/mapController";

const SUGGESTED = ["C-46", "CHARTER", "C-5", "I-21", "C-38.8", "Y-1.5"];

export default function MapView({ entries, target, visible, onRead, onLocation, onOpenGuide }) {
  const controller = useRef(null);
  const [loadedCodes, setLoadedCodes] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Hooks are read through a ref so the controller, which lives for the whole
  // session, always reaches the latest callbacks.
  const hooks = useRef({});
  hooks.current = { onRead, onLocation };

  useEffect(() => {
    if (controller.current) return;
    controller.current = mountMap({
      onReadSection: (code, section) => hooks.current.onRead(code, section),
      onSectionChange: (code, section) => hooks.current.onLocation(code, section),
      onProjectChange: setLoadedCodes,
    });
  }, []);

  useEffect(() => {
    if (visible) controller.current?.onShow();
  }, [visible]);

  useEffect(() => {
    if (target?.entry) void controller.current?.openSection(target.entry, target.section);
  }, [target]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const suggestions = SUGGESTED.filter((code) => !loadedCodes.includes(code))
    .map((code) => findEntry(entries, code))
    .filter(Boolean);

  return (
    <div className="map-view">
      <div id="mapBody">
        <aside id="sidebar">
          <div className="project-bar">
            <label htmlFor="projectSelect" className="sr-only">Project</label>
            <select id="projectSelect" />
            <div className="project-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="icon-button"
                aria-label="Project options"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
              {/* Stays in the DOM while closed: the controller holds these buttons. */}
              <div className="project-menu" hidden={!menuOpen} onClick={() => setMenuOpen(false)}>
                <button id="newProjectBtn" type="button"><Plus size={14} aria-hidden="true" /> New project</button>
                <button id="renameProjectBtn" type="button"><Pencil size={14} aria-hidden="true" /> Rename</button>
                <button id="exportBtn" type="button"><Download size={14} aria-hidden="true" /> Export</button>
                <button id="importBtn" type="button"><Upload size={14} aria-hidden="true" /> Import</button>
                <button id="deleteProjectBtn" type="button" className="danger"><Trash2 size={14} aria-hidden="true" /> Delete</button>
              </div>
            </div>
            <input type="file" id="importFile" accept="application/json" hidden />
          </div>

          <h2>Add a statute</h2>
          <StatuteFinder
            entries={entries}
            label="Add a statute to this map"
            placeholder="Search every statute…"
            onPick={(entry) => void controller.current?.addEntry(entry)}
          />
          {suggestions.length > 0 && (
            <div className="quick-links">
              {suggestions.map((entry) => (
                <button key={entry.code} type="button" onClick={() => void controller.current?.addEntry(entry)}>
                  {entry.title}
                </button>
              ))}
            </div>
          )}
          {/* role="status" + aria-live="polite" (C-03 §1.3b): every status
              message here is announced to a screen reader for free; graph
              node activation reuses this element rather than a second live
              region. */}
          <div id="status" role="status" aria-live="polite" />

          <h2>On this map</h2>
          <div id="statuteList" />

          {/* C-03 §1.2: the graph's primary keyboard entry point — a
              1,700-node force graph is impractical to reach any one section
              of by spatial Tab/arrow exploration alone. */}
          <h2>Jump to a section</h2>
          <label htmlFor="jumpToSectionInput" className="sr-only">Section number or heading text</label>
          <div className="combobox-wrap">
            <input
              id="jumpToSectionInput"
              type="text"
              role="combobox"
              aria-expanded="false"
              aria-controls="jumpToSectionListbox"
              aria-autocomplete="list"
              autoComplete="off"
              placeholder="e.g. 265 or Assault"
            />
            <ul id="jumpToSectionListbox" role="listbox" className="combobox-listbox" aria-label="Matching sections" hidden />
          </div>

          <h2>Check definitions</h2>
          <button id="cycleBtn" type="button" className="sidebar-action">Look for circular definitions</button>
          <div id="cycleResults" />
        </aside>
        <div id="graphArea">
          <div id="graphContainer" />
          <div id="legend" />
          <button id="fitBtn" type="button" className="graph-fit" aria-label="Fit the whole map on screen" title="Fit the whole map on screen">
            <Maximize size={15} aria-hidden="true" />
          </button>
          <div id="emptyState">
            <h3>Nothing on this map yet</h3>
            <p>
              Search for a statute to see how its sections cite each other. Add a second one
              to see how they connect.
            </p>
            <button type="button" className="link-button" onClick={onOpenGuide}>How to read the map</button>
          </div>
          <div id="graphBusy" hidden>
            <span className="spinner" aria-hidden="true" />
            <span id="graphBusyLabel" />
          </div>
        </div>
        <aside id="detailPanel" />
      </div>
    </div>
  );
}
