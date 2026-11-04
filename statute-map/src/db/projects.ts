import { idbDelete, idbGet, idbGetAll, idbPut, PROJECTS_STORE } from "./database";
import { getCachedStatuteSource, getOrFetchStatuteSource, setCachedStatuteSource } from "./statuteCache";
import { parseStatuteXml } from "../statute/parseStatuteXml";
import { HTML_STATUTE_PARSERS } from "../statute/parseStatuteHtml";
import { documentToStatute, type StatuteDocumentLike } from "../statute/documentToStatute";
import { findStatuteByCode, type StatuteSourceType } from "../statute/lookup";
import type { Statute } from "../statute/types";
import type { CachedStatuteSource, Project, ProjectExportFile } from "./types";

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = "ProjectNotFoundError";
  }
}

// H-01: an unbounded project name (e.g. an accidentally pasted paragraph)
// previously stretched the toolbar's project <select> to tens of thousands
// of pixels, pushing every other toolbar control off-screen. The <select>
// itself is now capped+ellipsized in index.html regardless, but the name is
// also capped here at the source so nothing this long is ever stored.
const MAX_PROJECT_NAME_LENGTH = 200;

function clampProjectName(name: string): string {
  return name.trim().slice(0, MAX_PROJECT_NAME_LENGTH);
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older browsers,
  // non-secure contexts) — not cryptographically strong, doesn't need to be.
  return `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function listProjects(): Promise<Project[]> {
  const all = await idbGetAll<Project>(PROJECTS_STORE);
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProject(id: string): Promise<Project | undefined> {
  return idbGet<Project>(PROJECTS_STORE, id);
}

async function requireProject(id: string): Promise<Project> {
  const project = await getProject(id);
  if (!project) throw new ProjectNotFoundError(id);
  return project;
}

export async function createProject(name: string): Promise<Project> {
  const now = new Date().toISOString();
  const project: Project = { id: newId(), name: clampProjectName(name), createdAt: now, updatedAt: now, statuteCodes: [] };
  await idbPut(PROJECTS_STORE, project);
  return project;
}

export async function renameProject(id: string, name: string): Promise<Project> {
  const project = await requireProject(id);
  const updated: Project = { ...project, name: clampProjectName(name), updatedAt: new Date().toISOString() };
  await idbPut(PROJECTS_STORE, updated);
  return updated;
}

export async function deleteProject(id: string): Promise<void> {
  await idbDelete(PROJECTS_STORE, id);
}

/** Adds a statute to a project, fetching+caching its source first (XML or
 *  HTML, per `sourceType`) if it isn't already in the shared cache. A
 *  no-op (besides ensuring the cache entry exists) if the statute is
 *  already in this project. */
export async function addStatuteToProject(
  projectId: string,
  code: string,
  sourceType: StatuteSourceType = "xml",
  sourceUrl?: string
): Promise<Project> {
  const project = await requireProject(projectId);
  await getOrFetchStatuteSource(code, sourceType, sourceUrl);

  if (project.statuteCodes.includes(code)) return project;

  const updated: Project = {
    ...project,
    statuteCodes: [...project.statuteCodes, code],
    updatedAt: new Date().toISOString(),
  };
  await idbPut(PROJECTS_STORE, updated);
  return updated;
}

export async function removeStatuteFromProject(projectId: string, code: string): Promise<Project> {
  const project = await requireProject(projectId);
  const updated: Project = {
    ...project,
    statuteCodes: project.statuteCodes.filter((c) => c !== code),
    updatedAt: new Date().toISOString(),
  };
  await idbPut(PROJECTS_STORE, updated);
  return updated;
}

export class UnsupportedStatuteSourceError extends Error {
  constructor(code: string) {
    super(`No HTML parser registered for statute code "${code}" (see HTML_STATUTE_PARSERS in parseStatuteHtml.ts).`);
    this.name = "UnsupportedStatuteSourceError";
  }
}

function parseCachedSource(cached: CachedStatuteSource): Statute {
  if (cached.sourceType === "html") {
    const parser = HTML_STATUTE_PARSERS[cached.code];
    if (!parser) throw new UnsupportedStatuteSourceError(cached.code);
    return parser(cached.content, cached.sourceUrl);
  }
  if (cached.sourceType === "document") {
    return documentToStatute(JSON.parse(cached.content) as StatuteDocumentLike, cached.sourceUrl);
  }
  return parseStatuteXml(cached.content, cached.sourceUrl, cached.code);
}

// Parsing a large statute takes seconds and its source never changes under a
// given fetchedAt, so adding a second statute doesn't re-parse the first.
const parsedStatutes = new Map<string, Statute>();

function parseCachedSourceOnce(cached: CachedStatuteSource): Statute {
  const key = `${cached.code}|${cached.fetchedAt}`;
  let statute = parsedStatutes.get(key);
  if (!statute) {
    statute = parseCachedSource(cached);
    parsedStatutes.set(key, statute);
  }
  // Each caller still gets its own list, so projects stay independent.
  return { ...statute, sections: [...statute.sections] };
}

/** Parses every statute currently loaded into a project, from the shared
 *  cache (fetching+caching anything unexpectedly missing — e.g. the cache
 *  was cleared out from under an existing project; assumes XML if the
 *  source type can't be recovered, matching every entry added before
 *  HTML sources existed). Each project's parsed Statute objects are
 *  independent even when two projects share the same cached source —
 *  nothing here is mutated in place. */
export async function loadProjectStatutes(
  project: Project,
  options: { onStatuteError?: (code: string, err: unknown) => void } = {}
): Promise<Statute[]> {
  const statutes: Statute[] = [];
  for (const code of project.statuteCodes) {
    try {
      const known = findStatuteByCode(code);
      const cached = await getOrFetchStatuteSource(code, known?.sourceType, known?.url);
      statutes.push(parseCachedSourceOnce(cached));
    } catch (err) {
      // With a handler, one unavailable statute (say, offline and no longer
      // cached) doesn't take the rest of the project down with it.
      if (!options.onStatuteError) throw err;
      options.onStatuteError(code, err);
    }
  }
  return statutes;
}

export async function exportProject(project: Project): Promise<ProjectExportFile> {
  const statutes: CachedStatuteSource[] = [];
  for (const code of project.statuteCodes) {
    const cached = await getCachedStatuteSource(code);
    // Every code in statuteCodes should have a cache entry (addStatuteToProject
    // guarantees it going in) — skip defensively rather than throw if one is
    // somehow missing, so exporting an otherwise-fine project doesn't fail outright.
    if (cached) statutes.push(cached);
  }
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    project: { name: project.name, statuteCodes: project.statuteCodes },
    statutes,
  };
}

export class UnsupportedProjectFormatError extends Error {
  constructor(version: unknown) {
    super(`Unsupported project export format version: ${String(version)}`);
    this.name = "UnsupportedProjectFormatError";
  }
}

/** A structurally-invalid or incomplete import file (H-03, L-03) — as
 *  opposed to UnsupportedProjectFormatError, which is specifically a
 *  version mismatch on an otherwise well-shaped file. */
export class InvalidProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProjectFileError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validates an untrusted, just-parsed-from-JSON import file before any of
 *  its data is used, so a malformed or incomplete file fails with one
 *  clear, plain-English message instead of a raw JS error at whatever line
 *  first happens to touch the missing/wrong-shaped field — e.g. "file
 *  .statutes is not iterable" (L-03). This also closes H-03: a project
 *  whose declared statuteCodes don't all have a matching entry in
 *  `statutes` is rejected outright here, before a project is ever created,
 *  rather than being silently imported as one that then shows empty. */
function validateProjectExportFile(file: unknown): asserts file is ProjectExportFile {
  if (!isPlainObject(file)) {
    throw new InvalidProjectFileError("This doesn't look like a Statute Map project export — the file isn't a JSON object.");
  }
  if (file.formatVersion !== 1) {
    throw new UnsupportedProjectFormatError(file.formatVersion);
  }
  if (!isPlainObject(file.project)) {
    throw new InvalidProjectFileError("This file is missing its project information and can't be imported.");
  }
  if (typeof file.project.name !== "string" || !file.project.name.trim()) {
    throw new InvalidProjectFileError("This file's project has no name and can't be imported.");
  }

  const statuteCodes = file.project.statuteCodes;
  if (!Array.isArray(statuteCodes) || !statuteCodes.every((c): c is string => typeof c === "string")) {
    throw new InvalidProjectFileError("This file's list of statutes is missing or malformed and can't be imported.");
  }

  const statutes = file.statutes;
  if (!Array.isArray(statutes) || !statutes.every((s): s is { code: string } => isPlainObject(s) && typeof s.code === "string")) {
    throw new InvalidProjectFileError("This file's bundled statute data is missing or malformed and can't be imported.");
  }

  const bundledCodes = new Set(statutes.map((s) => s.code));
  const missing = statuteCodes.filter((code) => !bundledCodes.has(code));
  if (missing.length > 0) {
    throw new InvalidProjectFileError(
      `This file's project expects ${missing.length === 1 ? "a statute" : "statutes"} (${missing.join(", ")}) that ${missing.length === 1 ? "isn't" : "aren't"} actually bundled in the file, so it can't be imported.`,
    );
  }
}

/** Imports a project export as a brand-new project (its own id — this
 *  never overwrites an existing project). Statute source bundled in the
 *  file is added to the shared cache without clobbering a possibly-newer
 *  cached copy of the same statute. `file` is untrusted, just-parsed JSON
 *  — see validateProjectExportFile for what's checked before any of it is
 *  used (H-03, L-03). */
export async function importProject(file: unknown): Promise<Project> {
  validateProjectExportFile(file);

  for (const statute of file.statutes) {
    const existing = await getCachedStatuteSource(statute.code);
    if (!existing) await setCachedStatuteSource(statute);
  }

  const now = new Date().toISOString();
  const project: Project = {
    id: newId(),
    name: file.project.name,
    createdAt: now,
    updatedAt: now,
    statuteCodes: file.project.statuteCodes,
  };
  await idbPut(PROJECTS_STORE, project);
  return project;
}
