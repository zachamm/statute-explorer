// Minimal type shim for parse-federal.js, just enough for tests/*.test.ts to
// import it (this project's tsconfig doesn't enable allowJs, so a plain .js
// module needs a declaration file to be importable from .ts at all). Not a
// full typing of the parser's output — see docs/SCHEMA.md for that.

export interface FederalPreviewRun {
  type: string;
  value?: string;
  termId?: string;
  isAnchor?: boolean;
}

export interface FederalDefinition {
  id: string;
  term: string;
  sectionId: string;
  scope: string;
  previewRuns: FederalPreviewRun[];
}

export interface FederalParseResult {
  statuteDocument: unknown;
  parts: unknown[];
  sections: Record<string, unknown>;
  definitions: Record<string, FederalDefinition>;
}

export function parseFederalXml(xml: string, options?: { code?: string }): FederalParseResult;
