import type { StatuteSourceType } from "../statute/lookup";

/**
 * Persistence model for the Projects layer.
 *
 * A Project is deliberately lightweight: it's just a name plus an ordered
 * list of statute codes. It never stores statute source itself — that
 * lives once in the shared statute cache (keyed by code) and is reused
 * across every project, per the "cached once, reused across projects"
 * spec. This also means two projects that both load the Criminal Code
 * never duplicate its ~5.5MB of XML in IndexedDB.
 */

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Statute codes loaded into this project, in the order they were added. */
  statuteCodes: string[];
}

/** One statute's raw source (XML or HTML, per sourceType), cached once
 *  and shared across all projects. */
export interface CachedStatuteSource {
  code: string;
  sourceType: StatuteSourceType;
  /** The raw fetched text — XML for sourceType "xml", HTML for "html". */
  content: string;
  sourceUrl: string;
  fetchedAt: string;
}

/** A portable, self-contained export of one project: its own metadata
 *  plus the full raw source of every statute it uses, so importing it
 *  elsewhere doesn't require re-fetching anything from Justice Laws. */
export interface ProjectExportFile {
  formatVersion: 1;
  exportedAt: string;
  project: {
    name: string;
    statuteCodes: string[];
  };
  statutes: CachedStatuteSource[];
}
