import { forwardRef, useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { describeEntry, searchCatalog } from "../library/catalog";

/** The search box for finding a statute by name, short form or code. Standard
 *  ARIA combobox: focus stays in the input, arrows move a highlighted option. */
const StatuteFinder = forwardRef(function StatuteFinder(
  { entries, label, placeholder, onPick, shortcut, limit = 12 },
  ref,
) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const matches = useMemo(() => searchCatalog(entries, query, limit), [entries, query, limit]);
  const showList = open && query.trim().length > 0;

  const choose = (entry) => {
    setQuery("");
    setOpen(false);
    onPick(entry);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown" && matches.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp" && matches.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" && showList && matches[active]) {
      e.preventDefault();
      choose(matches[active]);
    }
  };

  return (
    <div className="finder">
      <Search className="finder-icon" size={15} aria-hidden="true" />
      {shortcut && !query && <kbd className="finder-kbd">{shortcut}</kbd>}
      <input
        ref={ref}
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delayed so a click on an option lands before the list goes away.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" aria-label="Matching statutes" className="finder-list" hidden={!showList}>
        {showList && matches.length === 0 && <li className="finder-empty">No statute matches that.</li>}
        {showList &&
          matches.map((entry, i) => (
            <li
              key={entry.slug}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="finder-option"
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(entry)}
            >
              <span className="finder-title">{entry.title}</span>
              <span className="finder-meta">
                {describeEntry(entry)} · {entry.code}
                {entry.saved ? " · saved" : ""}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
});

export default StatuteFinder;
