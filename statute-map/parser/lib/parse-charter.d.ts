// Minimal type shim for parse-charter.js, just enough for tests/*.test.ts to
// import it (this project's tsconfig doesn't enable allowJs, so a plain .js
// module needs a declaration file to be importable from .ts at all). Not a
// full typing of the parser's output — see docs/SCHEMA.md for that.

export interface CharterTextRun {
  type: string;
  value?: string;
  termId?: string;
  isAnchor?: boolean;
  targets?: { sectionId: string; subsectionLabel?: string }[];
}

export interface CharterBlock {
  type: string;
  label?: string | null;
  marginalNote?: string | null;
  runs?: CharterTextRun[];
  children?: CharterBlock[];
}

export interface CharterSection {
  id: string;
  number: string;
  marginalNote: string | null;
  partId: string;
  divisionId: string;
  body: CharterBlock[];
  definesTerms: string[];
  outgoingRefs: string[];
  historicalNote: string | null;
}

export interface CharterDivision {
  id: string;
  title: string | null;
  sectionIds: string[];
}

export interface CharterPart {
  id: string;
  label: string | null;
  title: string;
  divisions: CharterDivision[];
}

export interface CharterStatuteDocument {
  id: string;
  jurisdiction: string;
  title: string;
  citation: string;
  sourceUrl: string;
  consolidatedDate: string | null;
  tree: CharterPart[];
  sections: Record<string, CharterSection>;
  definitions: Record<string, unknown>;
  crossRefIndex: Record<string, { outgoing: string[]; incoming: string[] }>;
}

export interface CharterParseResult {
  statuteDocument: CharterStatuteDocument;
  parts: CharterPart[];
  sections: Record<string, CharterSection>;
  definitions: Record<string, unknown>;
}

export function parseCharterHtml(html: string, sourceUrl: string): CharterParseResult;
