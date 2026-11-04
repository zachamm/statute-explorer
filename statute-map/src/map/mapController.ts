/**
 * The map view: a project-aware cross-reference graph across any number of
 * statutes. Projects persist in IndexedDB; statute source is fetched once and
 * shared across every project via the cache in src/db/statuteCache.ts; each
 * project's graph is independent because it's just a list of statute codes.
 *
 * Plain DOM + d3 rather than React, because the graph is a large imperative
 * SVG. views/MapView.jsx renders the markup this attaches to and calls
 * mountMap() once, the first time the map is shown.
 */
import { StatuteFetchError } from "../statute/fetchStatute";
import { StatuteParseError } from "../statute/parseStatuteXml";
import { findStatuteByCode, xmlUrlForCode } from "../statute/lookup";
import type { StatuteSourceType } from "../statute/lookup";
import {
  addStatuteToProject,
  createProject,
  deleteProject,
  exportProject,
  getProject,
  importProject,
  listProjects,
  loadProjectStatutes,
  removeStatuteFromProject,
  renameProject,
} from "../db/projects";
import type { Project } from "../db/types";
import { buildGraphModel, incomingEdges, outgoingEdges } from "../graph/model";
import type { GraphModel, GraphNode } from "../graph/model";
import { renderGraph, nodeLabel, REFERENCE_TYPE_COLORS, REFERENCE_TYPE_DASH, REFERENCE_TYPE_DESCRIPTIONS, statuteNodeColor } from "../graph/renderGraph";
import type { GraphHandle } from "../graph/renderGraph";
import { buildReferenceGraph, findCycles, resolveDefinitionalChain } from "../statute/resolveReferences";
import type { Statute } from "../statute/types";
import { findEntry } from "../library/catalog";
import type { CatalogEntry } from "../library/catalog";
import { STATUTE_REMOVED_EVENT, getCatalog, localAmendedDate, prepareMapSource, removeSaved } from "../library/library";
import { checkForUpdate } from "../library/updates";
import { casesUrl } from "../library/legalLinks";
import { getCachedStatuteSource } from "../db/statuteCache";
import { confirmDialog, promptDialog } from "./dialogs";

const LAST_PROJECT_KEY = "statute-map:last-project-id"; // a UI preference pointer only — no statute data here.

export interface MapHooks {
  /** "Read full text": show this section in the reader. */
  onReadSection(code: string, sectionNumber: string): void;
  /** The section on screen changed, so the URL can follow. */
  onSectionChange(code: string | null, sectionNumber: string | null): void;
  /** The project's statutes changed, so the sidebar's suggestions can follow. */
  onProjectChange(codes: string[]): void;
}

export interface MapController {
  addEntry(entry: CatalogEntry): Promise<void>;
  /** Opens a section, loading its statute into the project if it isn't there. */
  openSection(entry: CatalogEntry, sectionNumber: string | null): Promise<void>;
  /** The view just became visible, so the graph can draw at its real size. */
  onShow(): void;
}

export function mountMap(hooks: MapHooks): MapController {

const projectSelect = document.getElementById("projectSelect") as HTMLSelectElement;
const newProjectBtn = document.getElementById("newProjectBtn") as HTMLButtonElement;
const renameProjectBtn = document.getElementById("renameProjectBtn") as HTMLButtonElement;
const deleteProjectBtn = document.getElementById("deleteProjectBtn") as HTMLButtonElement;
const exportBtn = document.getElementById("exportBtn") as HTMLButtonElement;
const importBtn = document.getElementById("importBtn") as HTMLButtonElement;
const importFile = document.getElementById("importFile") as HTMLInputElement;

const statusEl = document.getElementById("status") as HTMLDivElement;
const statuteListEl = document.getElementById("statuteList") as HTMLDivElement;

const graphArea = document.getElementById("graphArea") as HTMLDivElement;
const graphContainer = document.getElementById("graphContainer") as HTMLDivElement;
const legendEl = document.getElementById("legend") as HTMLDivElement;
const emptyStateEl = document.getElementById("emptyState") as HTMLDivElement;
const graphBusyEl = document.getElementById("graphBusy") as HTMLDivElement;
const graphBusyLabel = document.getElementById("graphBusyLabel") as HTMLSpanElement;
const cycleBtn = document.getElementById("cycleBtn") as HTMLButtonElement;
const cycleResults = document.getElementById("cycleResults") as HTMLDivElement;
const detailPanel = document.getElementById("detailPanel") as HTMLDivElement;

// C-03 §1.2: "Jump to section" — the graph's primary keyboard entry point.
const jumpToSectionInput = document.getElementById("jumpToSectionInput") as HTMLInputElement;
const jumpToSectionListbox = document.getElementById("jumpToSectionListbox") as HTMLUListElement;

let projects: Project[] = [];
let currentProject: Project | null = null;
let currentStatutes: Statute[] = [];
let currentModel: GraphModel | null = null;
let currentHandle: GraphHandle | null = null;
let selectedNodeId: string | null = null;
let graphSize = { width: 0, height: 0 };

renderLegend();
const ready = init();

async function init(): Promise<void> {
  projects = await listProjects();

  if (projects.length === 0) {
    const seeded = await createProject("My First Project");
    projects = [seeded];
  }

  const lastId = localStorage.getItem(LAST_PROJECT_KEY);
  const initial = projects.find((p) => p.id === lastId) ?? projects[0];
  await switchToProject(initial.id);
}

// --- project switcher --------------------------------------------------

function renderProjectSelect(): void {
  projectSelect.innerHTML = "";
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.statuteCodes.length})`;
    projectSelect.appendChild(opt);
  }
  if (currentProject) projectSelect.value = currentProject.id;
}

async function switchToProject(id: string): Promise<void> {
  const project = await getProject(id);
  if (!project) {
    setStatus(`Project ${id} no longer exists.`, true);
    return;
  }
  currentProject = project;
  localStorage.setItem(LAST_PROJECT_KEY, project.id);
  renderProjectSelect();
  closeDetailPanel();
  await reloadCurrentProjectGraph();
}

projectSelect.addEventListener("change", () => void switchToProject(projectSelect.value));

newProjectBtn.addEventListener("click", async () => {
  const name = (await promptDialog("Name this project", "New project"))?.trim();
  if (!name) return;
  try {
    const project = await createProject(name);
    projects = await listProjects();
    await switchToProject(project.id);
  } catch (err) {
    setStatus(describeError(err), true);
  }
});

renameProjectBtn.addEventListener("click", async () => {
  if (!currentProject) return;
  const name = (await promptDialog("Rename this project", currentProject.name))?.trim();
  if (!name || name === currentProject.name) return;
  try {
    await renameProject(currentProject.id, name);
    projects = await listProjects();
    await switchToProject(currentProject.id);
  } catch (err) {
    setStatus(describeError(err), true);
  }
});

deleteProjectBtn.addEventListener("click", async () => {
  if (!currentProject) return;
  const confirmed = await confirmDialog(`Delete the project "${currentProject.name}"?`, "Your downloaded statutes stay available for other projects.", "Delete");
  if (!confirmed) return;
  try {
    await deleteProject(currentProject.id);
    projects = await listProjects();
    if (projects.length === 0) {
      const seeded = await createProject("My First Project");
      projects = [seeded];
    }
    await switchToProject(projects[0].id);
  } catch (err) {
    setStatus(describeError(err), true);
  }
});

exportBtn.addEventListener("click", async () => {
  if (!currentProject) return;
  const file = await exportProject(currentProject);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(currentProject.name)}.statute-map.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`Exported "${currentProject.name}" (${file.statutes.length} statute${file.statutes.length === 1 ? "" : "s"}).`);
});

importBtn.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const project = await importProject(parsed);
    projects = await listProjects();
    await switchToProject(project.id);
    // Only report success if every statute this project declares actually
    // finished loading. switchToProject -> reloadCurrentProjectGraph()
    // swallows its own load failure into an error status plus an empty
    // currentStatutes; unconditionally showing "Imported" afterward would
    // silently paper over that real failure (H-03) — importProject's own
    // shape validation already rejects the mismatched-statutes case that
    // triggered this, but this guards the rarer case of bundled statute
    // source that's present but corrupt/unparseable.
    if (currentStatutes.length === project.statuteCodes.length) {
      setStatus(`Imported "${project.name}".`);
    }
  } catch (err) {
    setStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`, true);
  }
});

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

// --- add / remove statutes ----------------------------------------------

function setBusy(label: string | null): void {
  graphBusyEl.hidden = label === null;
  graphBusyLabel.textContent = label ?? "";
  if (label) emptyStateEl.classList.remove("visible");
}

/** Lets the browser paint the "busy" state before a parse blocks the thread. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 30));
}

async function addStatute(code: string, sourceUrl: string, label: string, sourceType: StatuteSourceType = "xml"): Promise<void> {
  if (!currentProject) return;
  try {
    setBusy(`Loading ${label}…`);
    setStatus(`Loading ${label}…`);
    await nextPaint();
    const updated = await addStatuteToProject(currentProject.id, code, sourceType, sourceUrl);
    currentProject = updated;
    projects = await listProjects();
    renderProjectSelect();
    await reloadCurrentProjectGraph();
    if (currentStatutes.find((statute) => statute.code === code)?.sections.length === 0) {
      await removeStatute(code);
      setStatus(`${label} has no numbered sections, so there's nothing to map. You can still read it.`, true);
      return;
    }
    setStatus(`Added ${label}.`);
  } catch (err) {
    setStatus(describeError(err), true);
  } finally {
    setBusy(null);
    emptyStateEl.classList.toggle("visible", !currentModel?.nodes.length);
  }
}

async function addEntry(entry: CatalogEntry): Promise<void> {
  await ready;
  try {
    setBusy(`Loading ${entry.title}…`);
    const source = await prepareMapSource(entry, (message) => setBusy(message));
    await addStatute(source.code, source.url, source.label, source.sourceType);
    currentHandle?.focusStatute(source.code);
  } catch (err) {
    setBusy(null);
    setStatus(describeError(err), true);
  }
}

async function openSection(entry: CatalogEntry, sectionNumber: string | null): Promise<void> {
  await ready;
  if (!currentProject?.statuteCodes.includes(entry.code)) await addEntry(entry);
  if (!sectionNumber) return;
  const node = currentModel?.nodes.find((n) => n.id === `${entry.code}:${sectionNumber}`);
  if (node) {
    showDetail(node);
    currentHandle?.focusNode(node.id);
  }
}

async function removeStatute(code: string): Promise<void> {
  if (!currentProject) return;
  const updated = await removeStatuteFromProject(currentProject.id, code);
  currentProject = updated;
  projects = await listProjects();
  renderProjectSelect();
  closeDetailPanel();
  await reloadCurrentProjectGraph();
}

function renderStatuteList(): void {
  statuteListEl.innerHTML = "";
  if (!currentProject || currentProject.statuteCodes.length === 0) {
    statuteListEl.innerHTML = '<div class="empty-note">Nothing on this map yet.</div>';
    return;
  }
  for (const code of currentProject.statuteCodes) {
    const statute = currentStatutes.find((s) => s.code === code);
    const el = document.createElement("div");
    el.className = "statute-item";
    el.dataset.code = code;
    el.innerHTML = `<span class="statute-item-name">${escapeHtml(statute?.shortTitle ?? code)}</span>`;
    // Click the name to pan/zoom the graph to that statute's whole cluster
    // — separate from the Remove button below so the two can't collide.
    el.querySelector<HTMLSpanElement>(".statute-item-name")!.addEventListener("click", () => currentHandle?.focusStatute(code));
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => void removeStatute(code));
    el.appendChild(removeBtn);
    statuteListEl.appendChild(el);
  }
}

// --- graph ---------------------------------------------------------------

/** A statute with no XML source only reaches the map through its parsed
 *  document, so if that was removed it has to be rebuilt before loading. */
async function restoreDocumentSources(project: Project): Promise<void> {
  const entries = await getCatalog();
  for (const code of project.statuteCodes) {
    const entry = findEntry(entries, code);
    if (entry?.jurisdiction === "ontario" && !(await getCachedStatuteSource(code))) {
      await prepareMapSource(entry);
    }
  }
}

/** Offers an Update button beside any statute with a newer official version. */
async function flagOutdatedStatutes(): Promise<void> {
  const entries = await getCatalog();
  for (const code of currentProject?.statuteCodes ?? []) {
    const entry = findEntry(entries, code);
    if (!entry) continue;
    const latest = await checkForUpdate(entry, await localAmendedDate(code));
    const row = statuteListEl.querySelector<HTMLElement>(`[data-code="${CSS.escape(code)}"]`);
    if (!latest || !row || row.querySelector(".statute-update")) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "statute-update";
    button.textContent = "Update";
    button.title = `A newer version is available, last amended ${latest}`;
    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "Updating…";
      void removeSaved(entry);
    });
    row.insertBefore(button, row.lastElementChild);
  }
}

window.addEventListener(STATUTE_REMOVED_EVENT, (event) => {
  const { code } = (event as CustomEvent<{ code: string }>).detail;
  if (currentProject?.statuteCodes.includes(code)) void reloadCurrentProjectGraph();
});

async function reloadCurrentProjectGraph(): Promise<void> {
  if (!currentProject) return;
  const failures: string[] = [];
  try {
    await restoreDocumentSources(currentProject);
    currentStatutes = await loadProjectStatutes(currentProject, {
      onStatuteError: (code, err) => failures.push(`${code}: ${describeError(err)}`),
    });
  } catch (err) {
    failures.push(describeError(err));
    currentStatutes = [];
  }
  if (failures.length > 0) setStatus(`Couldn't load ${failures.join("\n")}`, true);
  renderStatuteList();
  void flagOutdatedStatutes();
  hooks.onProjectChange(currentProject.statuteCodes);
  cycleResults.innerHTML = "";
  currentModel = buildGraphModel(currentStatutes);
  renderCurrentGraph();
  // After, not before: renderCurrentGraph() is what actually assigns each
  // statute's color (via nodeFillColor→statuteNodeColor while drawing every
  // node), so building the legend afterward guarantees its swatches read
  // back the colors the graph really used rather than racing them.
  renderLegend();
}

function renderCurrentGraph(): void {
  // C-03 §1.6: renderGraph() fully tears down and rebuilds the SVG on
  // every call — capture, before that happens, which node held the
  // roving Tab stop and whether the user's actual keyboard focus was
  // inside the graph at this moment, so both can be restored afterward.
  // Checked BEFORE destroy(), which removes the DOM this activeElement
  // check needs to see.
  const graphHadFocus = !!currentHandle && graphContainer.contains(document.activeElement);
  const previousCurrentNodeId = currentHandle?.getCurrentNodeId() ?? undefined;

  currentHandle?.destroy();
  currentHandle = null;

  const hasNodes = !!currentModel && currentModel.nodes.length > 0;
  emptyStateEl.classList.toggle("visible", !hasNodes);
  if (!hasNodes || !currentModel) return;

  const rect = graphArea.getBoundingClientRect();
  graphSize = { width: rect.width, height: rect.height };
  // Hidden behind another tab: onShow() draws it once there's a real size.
  if (rect.width === 0) return;
  currentHandle = renderGraph(graphContainer, currentModel, {
    width: rect.width,
    height: rect.height,
    onNodeClick: showDetail,
    onBackgroundClick: closeDetailPanel,
    // C-03 §1.4/§1.7: Escape backs out of the graph to a predictable,
    // safe place rather than losing focus to <body>.
    onEscape: () => jumpToSectionInput.focus(),
    initialCurrentNodeId: previousCurrentNodeId,
    focusOnInit: graphHadFocus,
  });
  if (selectedNodeId) currentHandle.setSelectedNode(selectedNodeId);
}

window.addEventListener("resize", () => {
  if (currentModel && graphArea.getBoundingClientRect().width > 0) renderCurrentGraph();
});

function onShow(): void {
  const rect = graphArea.getBoundingClientRect();
  if (!currentModel || rect.width === 0) return;
  if (!currentHandle || rect.width !== graphSize.width || rect.height !== graphSize.height) renderCurrentGraph();
}

// --- jump to section (C-03 §1.2) -------------------------------------------
//
// The graph's primary keyboard entry point: search by section number or
// heading text across every loaded statute, rather than relying on
// spatial Tab/arrow exploration to reach any one of up to ~1,700 nodes.
// Standard ARIA combobox pattern — real DOM focus stays on the input the
// whole time the listbox is open; arrow keys move a highlighted option via
// aria-activedescendant, not real focus.

const JUMP_MATCH_LIMIT = 20;
let jumpMatches: GraphNode[] = [];
let jumpActiveIndex = -1; // -1 = no option highlighted yet

function jumpSearchText(node: GraphNode): string {
  const secondary = node.kind === "section" ? (node.marginalNote ?? "") : (node.statuteName ?? "");
  return `${node.number ?? ""} ${secondary}`.toLowerCase();
}

function jumpDisplayText(node: GraphNode): string {
  return nodeLabel(node);
}

function findJumpMatches(query: string): GraphNode[] {
  const q = query.trim().toLowerCase();
  if (!q || !currentModel) return [];
  const starts: GraphNode[] = [];
  const contains: GraphNode[] = [];
  for (const node of currentModel.nodes) {
    const text = jumpSearchText(node);
    if (text.startsWith(q) || (node.number ?? "").toLowerCase().startsWith(q)) starts.push(node);
    else if (text.includes(q)) contains.push(node);
    if (starts.length >= JUMP_MATCH_LIMIT) break;
  }
  return [...starts, ...contains].slice(0, JUMP_MATCH_LIMIT);
}

function closeJumpListbox(): void {
  jumpMatches = [];
  jumpActiveIndex = -1;
  jumpToSectionListbox.hidden = true;
  jumpToSectionListbox.innerHTML = "";
  jumpToSectionInput.setAttribute("aria-expanded", "false");
  jumpToSectionInput.removeAttribute("aria-activedescendant");
}

function renderJumpListbox(): void {
  jumpToSectionListbox.innerHTML = "";
  if (jumpMatches.length === 0) {
    const li = document.createElement("li");
    li.className = "combobox-empty";
    li.textContent = "No matching sections.";
    jumpToSectionListbox.appendChild(li);
    jumpToSectionListbox.hidden = false;
    jumpToSectionInput.setAttribute("aria-expanded", "true");
    jumpToSectionInput.removeAttribute("aria-activedescendant");
    return;
  }
  jumpMatches.forEach((node, i) => {
    const li = document.createElement("li");
    li.id = `jump-option-${i}`;
    li.setAttribute("role", "option");
    li.className = "combobox-option";
    li.setAttribute("aria-selected", String(i === jumpActiveIndex));
    const kindNote = node.kind === "ghost" ? '<div class="combobox-option-note">not loaded</div>' : "";
    li.innerHTML = `<div>${escapeHtml(jumpDisplayText(node))}</div>${kindNote}`;
    li.addEventListener("click", () => selectJumpMatch(node));
    jumpToSectionListbox.appendChild(li);
  });
  jumpToSectionListbox.hidden = false;
  jumpToSectionInput.setAttribute("aria-expanded", "true");
  if (jumpActiveIndex >= 0) jumpToSectionInput.setAttribute("aria-activedescendant", `jump-option-${jumpActiveIndex}`);
  else jumpToSectionInput.removeAttribute("aria-activedescendant");
}

/** Selecting a match (C-03 §1.2): pans/zooms + pulses (focusNode,
 *  unchanged), opens the detail panel (showDetail, unchanged), then hands
 *  real keyboard focus to that node in the graph so the screen reader
 *  announces its aria-label immediately and arrow-key traversal can
 *  continue right from there without an extra Tab press. */
function selectJumpMatch(node: GraphNode): void {
  currentHandle?.focusNode(node.id);
  showDetail(node);
  currentHandle?.focusNodeForKeyboard(node.id);
  jumpToSectionInput.value = "";
  closeJumpListbox();
}

jumpToSectionInput.addEventListener("input", () => {
  jumpMatches = findJumpMatches(jumpToSectionInput.value);
  jumpActiveIndex = -1;
  if (jumpToSectionInput.value.trim()) renderJumpListbox();
  else closeJumpListbox();
});

jumpToSectionInput.addEventListener("keydown", (e) => {
  if (jumpToSectionListbox.hidden && e.key !== "ArrowDown") return;
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      if (jumpToSectionListbox.hidden) {
        jumpMatches = findJumpMatches(jumpToSectionInput.value);
        if (jumpMatches.length) renderJumpListbox();
        return;
      }
      if (jumpMatches.length) {
        jumpActiveIndex = (jumpActiveIndex + 1) % jumpMatches.length;
        renderJumpListbox();
      }
      break;
    case "ArrowUp":
      e.preventDefault();
      if (jumpMatches.length) {
        jumpActiveIndex = jumpActiveIndex <= 0 ? jumpMatches.length - 1 : jumpActiveIndex - 1;
        renderJumpListbox();
      }
      break;
    case "Enter": {
      e.preventDefault();
      const chosen = jumpMatches[jumpActiveIndex] ?? jumpMatches[0];
      if (chosen) selectJumpMatch(chosen);
      break;
    }
    case "Escape":
      e.preventDefault();
      closeJumpListbox();
      break;
  }
});

jumpToSectionInput.addEventListener("blur", () => {
  // A short delay so a click on a listbox option (which blurs the input
  // just before its own click handler runs) still gets to fire — closing
  // synchronously on blur would remove the option from the DOM first.
  window.setTimeout(closeJumpListbox, 150);
});

function renderLegend(): void {
  const typeRows = Object.entries(REFERENCE_TYPE_COLORS)
    .map(([type, color]) => {
      const description = REFERENCE_TYPE_DESCRIPTIONS[type as keyof typeof REFERENCE_TYPE_DESCRIPTIONS];
      const dash = REFERENCE_TYPE_DASH[type as keyof typeof REFERENCE_TYPE_DASH];
      // H-06: a line swatch (not the circular dot used for bubbles below) —
      // it draws with the exact same stroke-dasharray as the real graph
      // edges, so color-blind/grayscale users get the same distinguishing
      // cue here as in the graph itself, not just a description of it.
      const lineSwatch = `<svg class="legend-line" width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="${color}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ""}/></svg>`;
      // data-tip, not the native title= attribute: title's tooltip is
      // drawn by the OS/browser chrome outside the page's own render
      // surface, so (a) it can't be screenshotted for verification and
      // (b) it can't be styled to match the app's dark theme. See the
      // hover-tip delegation below.
      return `<div data-tip="${escapeHtml(description)}">${lineSwatch}${type}</div>`;
    })
    .join("");

  // Bubble color ≠ arrow color: arrows above are reference type, bubbles
  // are statute-of-origin (ghosts excepted — always grey, and called out
  // separately in the static #ghostLegend box rather than here). Only
  // listed once at least one statute is loaded, and rebuilt every time the
  // loaded set changes, so it can never drift out of sync with what's
  // actually on screen.
  const statuteRows = currentStatutes
    .map(
      (s) =>
        `<div><span class="swatch" style="background:${statuteNodeColor(s.code)}"></span>${escapeHtml(s.shortTitle)} <span class="legend-code">${escapeHtml(s.code)}</span></div>`
    )
    .join("");
  const statuteSection = currentStatutes.length
    ? `<div class="legend-divider"></div><div class="legend-heading">Bubbles (by statute)</div>${statuteRows}`
    : "";

  // Its own section, right under Arrows/Bubbles — not folded into either,
  // since a ghost's grey isn't a reference type or a statute-of-origin
  // color, it's a third, independent thing a bubble's fill can mean.
  const ghostSection = `<div class="legend-divider"></div><div class="legend-heading">Ghosts</div><div data-tip="A section that something on this map cites, but whose statute isn't on the map. Click one to load it."><span class="swatch" style="background:#4a4f5a;border:1px dashed #888"></span>cited, not on this map</div>`;

  // Rebuilt often, so the open/closed choice is carried over by hand.
  const wasOpen = legendEl.querySelector("details")?.open ?? false;
  legendEl.innerHTML = `<details${wasOpen ? " open" : ""}><summary>Legend</summary><div class="legend-heading">Arrows (by reference type)</div>${typeRows}${statuteSection}${ghostSection}</details>`;
}

// Delegated (not one listener per row) since renderLegend() rebuilds the
// legend's contents from scratch every time the loaded statute set
// changes — a delegated listener on the never-replaced #legend container
// survives that, where one attached per-row would silently stop working
// the next time the legend re-renders.
let hoverTipEl: HTMLDivElement | null = null;

legendEl.addEventListener("mouseover", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
  if (!row || !legendEl.contains(row)) return;

  hoverTipEl?.remove();
  hoverTipEl = document.createElement("div");
  hoverTipEl.className = "hover-tip";
  hoverTipEl.textContent = row.dataset.tip ?? "";
  document.body.appendChild(hoverTipEl);

  // Prefer opening to the right of the legend box (where there's usually
  // open graph canvas); fall back under the row if that would run off the
  // right edge of the window.
  const rowRect = row.getBoundingClientRect();
  const legendRect = legendEl.getBoundingClientRect();
  const tipRect = hoverTipEl.getBoundingClientRect();
  const fitsToTheRight = legendRect.right + 8 + tipRect.width <= window.innerWidth;
  hoverTipEl.style.left = `${fitsToTheRight ? legendRect.right + 8 : rowRect.left}px`;
  hoverTipEl.style.top = `${fitsToTheRight ? rowRect.top : rowRect.bottom + 4}px`;
});

legendEl.addEventListener("mouseout", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
  const toRow = (e.relatedTarget as HTMLElement | null)?.closest<HTMLElement>("[data-tip]");
  if (row && row !== toRow) {
    hoverTipEl?.remove();
    hoverTipEl = null;
  }
});

// --- detail panel ----------------------------------------------------------

/** #graphArea reflows (gets wider/narrower) whenever the detail panel
 *  opens or closes, since it's a flex sibling that reclaims/gives up the
 *  panel's 380px. The svg's own width/height/viewBox were fixed at
 *  whatever size the container was at render time, so left alone they'd
 *  go stale the moment that reflow happens — and a stale viewBox is what
 *  makes the browser rescale/re-center everything to fit the new box,
 *  which reads as the graph "snapping" on every panel toggle. Calling
 *  this right after the class toggle (classList changes apply
 *  synchronously to the CSSOM, and getBoundingClientRect() forces the
 *  layout that reads them back) keeps the svg's coordinate box in sync
 *  with reality without moving anything — see resizeViewport's own doc
 *  comment for why that's different from a full re-render. */
function resizeGraphViewport(): void {
  if (!currentHandle) return;
  const rect = graphArea.getBoundingClientRect();
  currentHandle.resizeViewport(rect.width, rect.height);
}

function closeDetailPanel(): void {
  detailPanel.classList.remove("open");
  detailPanel.innerHTML = "";
  selectedNodeId = null;
  currentHandle?.setSelectedNode(null);
  hooks.onSectionChange(null, null);
  resizeGraphViewport();
}

function showDetail(node: GraphNode): void {
  if (!currentModel) return;
  const incoming = incomingEdges(currentModel, node.id);
  const outgoing = outgoingEdges(currentModel, node.id);

  selectedNodeId = node.id;
  currentHandle?.setSelectedNode(node.id);
  hooks.onSectionChange(node.statuteCode, node.number);

  // A ghost in a statute that's already on the map isn't "not loaded" at all:
  // the text cites a section this consolidation doesn't have, usually because
  // it's been repealed. Offering to load it again could never help.
  const ghostStatuteLoaded = node.kind === "ghost" && !!node.statuteCode && !!currentProject?.statuteCodes.includes(node.statuteCode);
  const loadAction =
    node.kind !== "ghost"
      ? ""
      : ghostStatuteLoaded
        ? ""
        : node.statuteCode
          ? `<button class="primary" id="loadGhostBtn">Add ${escapeHtml(node.statuteName ?? node.statuteCode)} to this map</button>`
          : `<div class="empty-note">"${escapeHtml(node.statuteName ?? "This Act")}" doesn't match anything in the federal catalogue, so it can't be loaded automatically. It may be an old or provincial Act.</div>`;
  const ghostNote = ghostStatuteLoaded
    ? "This statute is on the map, but its current text has no such section. The section was probably repealed or renumbered."
    : "This section's statute isn't on this map yet, so there's no text to show.";

  const header =
    node.kind === "section"
      ? `
        <div class="detail-head"><span class="detail-num">${escapeHtml(node.statuteCode)} s. ${escapeHtml(node.number)}</span> ${node.marginalNote ? `<span class="detail-note">${escapeHtml(node.marginalNote)}</span>` : ""}</div>
        <div class="detail-path">${escapeHtml(node.headingPath.join(" › ") || "(no heading)")}</div>
        <div class="detail-actions">
          <button type="button" class="read-link" id="readSectionBtn">Read in full</button>
          <a class="read-link" href="${escapeHtml(casesUrl(currentStatutes.find((s) => s.code === node.statuteCode)?.shortTitle ?? node.statuteCode, node.number))}" target="_blank" rel="noopener noreferrer">Find cases</a>
        </div>
        <div class="detail-text">${escapeHtml(node.text)}</div>
        <details class="chain" id="chainDetails"><summary>Follow its definitions</summary><div id="chainBody"></div></details>
      `
      : `
        <div class="detail-head"><span class="detail-num">s. ${escapeHtml(node.number ?? "?")}</span> <span class="ghost-badge">${ghostStatuteLoaded ? "not found" : "not on this map"}</span></div>
        <div class="detail-path">${escapeHtml(node.statuteName ?? (node.statuteCode ? currentStatutes.find((s) => s.code === node.statuteCode)?.shortTitle ?? "" : "Unknown Act"))}${node.statuteCode ? ` (${escapeHtml(node.statuteCode)})` : ""}</div>
        <div class="empty-note">${ghostNote}</div>
        ${loadAction}
      `;

  detailPanel.innerHTML = `
    <button type="button" class="detail-close" id="detailClose" aria-label="Close this panel">×</button>
    ${header}
    <h2>Referenced by (${incoming.length})</h2>
    ${incoming.length ? "" : '<div class="empty-note">Nothing references this section.</div>'}
    <div id="incomingList"></div>
    <h2>References (${outgoing.length})</h2>
    ${outgoing.length ? "" : '<div class="empty-note">This section references nothing else.</div>'}
    <div id="outgoingList"></div>
  `;
  detailPanel.classList.add("open");
  resizeGraphViewport();

  // C-03 §1.3b: activating a node (keyboard Enter/Space, or a mouse click
  // — one code path, both the same) opens this panel elsewhere on the
  // page; a screen reader has no way to know that just from focus staying
  // on the node it activated. Reuses nodeLabel() (the same function a
  // node's own aria-label is built from) and the exact counts these two
  // headings above just showed, so the announced text can never drift out
  // of sync with what's visually on screen.
  setStatus(
    `Opened ${nodeLabel(node)}. ${outgoing.length} reference${outgoing.length === 1 ? "" : "s"}, ${incoming.length} referenced by.`
  );

  detailPanel.querySelector("#detailClose")?.addEventListener("click", closeDetailPanel);
  if (node.kind === "section") {
    detailPanel.querySelector("#readSectionBtn")?.addEventListener("click", () => hooks.onReadSection(node.statuteCode, node.number));
    const chainDetails = detailPanel.querySelector<HTMLDetailsElement>("#chainDetails");
    chainDetails?.addEventListener("toggle", () => {
      if (chainDetails.open) renderDefinitionChain(node.statuteCode, node.id);
    }, { once: true });
  }

  const incomingList = detailPanel.querySelector("#incomingList")!;
  for (const edge of incoming) {
    incomingList.appendChild(buildRefItem(edge.source, edge.type, edge.matchedText, edge.context));
  }
  const outgoingList = detailPanel.querySelector("#outgoingList")!;
  for (const edge of outgoing) {
    outgoingList.appendChild(buildRefItem(edge.target, edge.type, edge.matchedText, edge.context));
  }

  const loadBtnEl = detailPanel.querySelector<HTMLButtonElement>("#loadGhostBtn");
  loadBtnEl?.addEventListener("click", async () => {
    if (node.kind !== "ghost" || !node.statuteCode) return;
    loadBtnEl.disabled = true;
    loadBtnEl.textContent = "Loading…";
    const catalogEntry = findEntry(await getCatalog(), node.statuteCode);
    if (catalogEntry) {
      await addEntry(catalogEntry);
    } else {
      const known = findStatuteByCode(node.statuteCode);
      await addStatute(node.statuteCode, known?.url ?? xmlUrlForCode(node.statuteCode), node.statuteName ?? node.statuteCode, known?.sourceType ?? "xml");
    }
    const reResolved = currentModel?.nodes.find((n) => n.id === `${node.statuteCode}:${node.number}`);
    if (reResolved) {
      showDetail(reResolved);
      // It just swapped from a grey ghost to a real node somewhere else in
      // its statute's cluster — worth centering on, not just updating text.
      currentHandle?.focusNode(reResolved.id);
    }
  });
}

function openNodeById(nodeId: string): void {
  const target = currentModel?.nodes.find((n) => n.id === nodeId);
  if (target) {
    showDetail(target);
    currentHandle?.focusNode(target.id);
  }
}

// Classifying a whole statute isn't free, so these two only build a statute's
// reference graph when someone actually asks for one of them.
const referenceGraphs = new WeakMap<Statute, ReturnType<typeof buildReferenceGraph>>();

function referenceGraphFor(statute: Statute): ReturnType<typeof buildReferenceGraph> {
  let graph = referenceGraphs.get(statute);
  if (!graph) {
    graph = buildReferenceGraph(statute);
    referenceGraphs.set(statute, graph);
  }
  return graph;
}

function sectionButton(sectionId: string, indent = 0): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chain-step";
  btn.style.marginLeft = `${indent * 12}px`;
  const node = currentModel?.nodes.find((n) => n.id === sectionId);
  btn.textContent = node ? nodeLabel(node) : sectionId;
  btn.addEventListener("click", () => openNodeById(sectionId));
  return btn;
}

/** The section's definitions followed all the way down: what it borrows a
 *  meaning from, what that borrows from, and so on. */
function renderDefinitionChain(code: string, sectionId: string): void {
  const body = detailPanel.querySelector("#chainBody");
  const statute = currentStatutes.find((s) => s.code === code);
  if (!body || !statute) return;
  const { steps, cycles } = resolveDefinitionalChain(referenceGraphFor(statute), sectionId);
  const followed = steps.slice(1);
  if (followed.length === 0) {
    body.innerHTML = '<div class="empty-note">This section doesn\'t take any of its meaning from another section.</div>';
    return;
  }
  for (const step of followed) body.appendChild(sectionButton(step.sectionId, step.depth - 1));
  if (cycles.length > 0) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = "These definitions are circular: following them leads back to where they started.";
    body.appendChild(note);
  }
}

document.getElementById("fitBtn")?.addEventListener("click", () => currentHandle?.fit());

cycleBtn.addEventListener("click", () => {
  cycleResults.innerHTML = "";
  const loops = currentStatutes.flatMap((statute) => findCycles(referenceGraphFor(statute), { types: ["DEFINITIONAL"] }));
  if (loops.length === 0) {
    cycleResults.innerHTML = '<div class="empty-note">No circular definitions on this map.</div>';
    return;
  }
  for (const loop of loops.slice(0, 50)) {
    const row = document.createElement("div");
    row.className = "cycle-row";
    for (const id of new Set(loop.path)) row.appendChild(sectionButton(id));
    cycleResults.appendChild(row);
  }
});

function buildRefItem(otherNodeId: string, type: string, matchedText: string, context: string): HTMLElement {
  // A real <button> (was a plain clickable <div>, not keyboard-reachable
  // at all — C-03 §1.5), so Tab/Enter/Space work by native browser
  // behavior with no extra keydown handling needed here. index.html's
  // .ref-item CSS undoes the global button{} styling this now inherits.
  const el = document.createElement("button");
  el.type = "button";
  el.className = "ref-item";
  const color = (REFERENCE_TYPE_COLORS as Record<string, string>)[type] ?? "#71717a";
  const otherNode = currentModel?.nodes.find((n) => n.id === otherNodeId);
  el.innerHTML = `
    <div><span class="ref-type" style="color:${color}">${escapeHtml(type)}</span> · ${escapeHtml(otherNode ? nodeLabel(otherNode) : otherNodeId)}</div>
    <div class="ref-context">"${escapeHtml(matchedText)}" · ${escapeHtml(context)}</div>
  `;
  el.addEventListener("click", () => openNodeById(otherNodeId));
  return el;
}

// --- helpers ---------------------------------------------------------------

function setStatus(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function describeError(err: unknown): string {
  if (err instanceof StatuteFetchError || err instanceof StatuteParseError || err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

return { addEntry, openSection, onShow };
}
