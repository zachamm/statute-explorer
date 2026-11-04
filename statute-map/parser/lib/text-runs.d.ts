// Minimal type shim for text-runs.js, just enough for tests/*.test.ts to
// import it (this project's tsconfig doesn't enable allowJs, so a plain .js
// module needs a declaration file to be importable from .ts at all). Not a
// full typing of the module — see docs/SCHEMA.md.

export function slugify(term: string): string;
export function escapeRegExp(s: string): string;
export function mergeAdjacentTextRuns<T extends { type: string; value?: string }>(runs: T[]): T[];
export function collectPreviewRuns(blocks: unknown[]): unknown[];

export interface RunTokenizerInput {
  definitions: Record<string, { id: string; term: string }>;
  validSectionIds: Set<string>;
}

export interface TokenizerContext {
  outgoingRefs: Set<string>;
}

export interface RunTokenizer {
  tokenizeText(raw: string, ctx: TokenizerContext, nextIsActName: boolean): unknown[];
}

export function createRunTokenizer(input: RunTokenizerInput): RunTokenizer;
