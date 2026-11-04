import type { Statute, StatuteSection } from "./types";

/**
 * Flattens a parsed StatuteDocument (the reader's format, see docs/SCHEMA.md)
 * into the Statute shape the map works on. XML and the Charter's HTML have
 * their own parsers; this is how everything else gets onto the map, which
 * today means Ontario statutes.
 */

interface Run {
  value?: string;
}

interface Block {
  label?: string | null;
  runs?: Run[];
  children?: Block[];
}

export interface StatuteDocumentLike {
  id: string;
  title: string;
  sourceUrl: string;
  tree: Array<{
    label: string | null;
    title: string | null;
    divisions: Array<{ title: string | null; sectionIds: string[] }>;
  }>;
  sections: Record<string, { number: string; marginalNote?: string | null; body: Block[] }>;
}

function flattenBlocks(blocks: Block[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const own = (block.runs ?? []).map((run) => run.value ?? "").join("");
    const nested = block.children ? flattenBlocks(block.children) : "";
    // A label like "(a)" stays on the same line as the text it numbers.
    const line = [block.label, own, nested].filter(Boolean).join(" ").replace(/[^\S\n]+/g, " ").trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

export function documentToStatute(doc: StatuteDocumentLike, sourceUrl: string): Statute {
  const sections: StatuteSection[] = [];
  for (const part of doc.tree) {
    const partTitle = [part.label, part.title].filter(Boolean).join(" — ");
    for (const division of part.divisions) {
      const headingPath = [partTitle, division.title ?? ""].filter(Boolean);
      for (const sectionId of division.sectionIds) {
        const section = doc.sections[sectionId];
        if (!section) continue;
        sections.push({
          id: `${doc.id}:${section.number}`,
          statuteCode: doc.id,
          number: section.number,
          marginalNote: section.marginalNote ?? null,
          text: flattenBlocks(section.body),
          headingPath,
        });
      }
    }
  }
  return {
    code: doc.id,
    shortTitle: doc.title,
    longTitle: doc.title,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    sections,
  };
}
