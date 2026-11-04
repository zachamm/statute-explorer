import type { Statute, StatuteSection } from "./types";

/**
 * Parses Justice Laws statute XML into a flat list of sections.
 *
 * Justice Laws XML structure notes (from inspecting the real Criminal
 * Code XML, https://laws-lois.justice.gc.ca/eng/XML/C-46.xml):
 *
 * - <Body> holds a *flat* sequence of <Heading level="N"> and <Section>
 *   siblings — Parts/headings are NOT nested in the XML tree, just
 *   marked with a `level` attribute. We reconstruct the hierarchy with
 *   a stack keyed by level.
 * - A <Section> carries an optional <MarginalNote>, a <Label> (the
 *   section number), then a mix of <Text>, <Subsection>, <Paragraph>,
 *   <Subparagraph>, <Clause>, <Definition>, <ContinuedDefinition> and a
 *   trailing <HistoricalNote> (amendment citations — not enacted text).
 * - Nested block elements (Subsection/Paragraph/...) repeat the same
 *   Label + MarginalNote + content pattern recursively.
 */

export class StatuteParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatuteParseError";
  }
}

/** Element tags that introduce a new block (own line) when flattening text. */
const BLOCK_TAGS = new Set([
  "Subsection",
  "Paragraph",
  "Subparagraph",
  "Clause",
  "Subclause",
  "Definition",
  "ContinuedDefinition",
  "FormulaGroup",
]);

/** Tags whose content is not enacted legal text and should be dropped entirely. */
const SKIP_TAGS = new Set(["HistoricalNote", "Note", "Footnote", "FootnoteRef"]);

interface RenderOptions {
  /** Skip (and consume) the first Label seen — used at the Section root,
   *  since the section's own number is extracted separately. */
  skipFirstLabel: boolean;
  /** Same idea for the Section's own MarginalNote. */
  skipFirstMarginalNote: boolean;
}

function renderChildren(el: Element, opts: RenderOptions): string {
  const blocks: string[] = [];
  let inline = "";
  let labelPending = opts.skipFirstLabel;
  let notePending = opts.skipFirstMarginalNote;

  const flushInline = () => {
    if (inline.trim()) blocks.push(inline.trim());
    inline = "";
  };

  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === node.TEXT_NODE) {
      inline += node.textContent ?? "";
      continue;
    }
    if (node.nodeType !== node.ELEMENT_NODE) continue;
    const child = node as Element;
    const tag = child.tagName;

    if (tag === "Label") {
      if (labelPending) {
        labelPending = false; // consume the section/block's own number, don't render it
        continue;
      }
      inline += child.textContent ?? "";
      inline += " ";
      continue;
    }

    if (tag === "MarginalNote") {
      if (notePending) {
        notePending = false;
        continue;
      }
      inline += `[${child.textContent ?? ""}] `;
      continue;
    }

    if (SKIP_TAGS.has(tag)) continue;

    if (BLOCK_TAGS.has(tag)) {
      flushInline();
      const rendered = renderChildren(child, { skipFirstLabel: false, skipFirstMarginalNote: false }).trim();
      if (rendered) blocks.push(rendered);
      continue;
    }

    // Inline/unknown element (Text, XRefInternal, XRefExternal, DefinedTermEn,
    // DefinedTermFr, and any tag we haven't special-cased): fold its text
    // into the current inline run rather than starting a new block.
    inline += renderChildren(child, { skipFirstLabel: false, skipFirstMarginalNote: false });
  }

  flushInline();
  return blocks.join("\n");
}

function directChild(el: Element, tagName: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName === tagName) return child;
  }
  return null;
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}

function normalizeWhitespace(text: string): string {
  // Justice Laws XML text nodes use assorted Unicode space characters
  // (e.g. U+2002 EN SPACE between a <DefinedTermEn> and the word that
  // follows it) instead of plain ASCII spaces, purely for typographic
  // control. Collapse any run of non-newline whitespace to a single
  // regular space so downstream regex matching (step 2+) can rely on
  // plain " " everywhere.
  return text
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function parseSection(sectionEl: Element, statuteCode: string, headingPath: string[]): StatuteSection {
  const labelEl = directChild(sectionEl, "Label");
  const marginalNoteEl = directChild(sectionEl, "MarginalNote");
  const number = textOf(labelEl);

  if (!number) {
    throw new StatuteParseError(
      `Encountered a <Section> with no <Label> (section number) under heading path ${JSON.stringify(headingPath)}.`
    );
  }

  const text = normalizeWhitespace(
    renderChildren(sectionEl, { skipFirstLabel: true, skipFirstMarginalNote: true })
  );

  return {
    id: `${statuteCode}:${number}`,
    statuteCode,
    number,
    marginalNote: marginalNoteEl ? textOf(marginalNoteEl) : null,
    text,
    headingPath: [...headingPath],
  };
}

function parseXmlDocument(xmlText: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");

  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new StatuteParseError(`Failed to parse statute XML: ${parserError.textContent ?? "unknown XML error"}`);
  }

  return doc;
}

export function parseStatuteXml(xmlText: string, sourceUrl: string, fallbackCode?: string): Statute {
  const doc = parseXmlDocument(xmlText);

  const statuteEl = doc.documentElement;
  if (!statuteEl || (statuteEl.tagName !== "Statute" && statuteEl.tagName !== "Regulation")) {
    throw new StatuteParseError(`Expected a <Statute> root element, got <${statuteEl?.tagName ?? "unknown"}>.`);
  }

  const identificationEl = directChild(statuteEl, "Identification");
  const bodyEl = directChild(statuteEl, "Body");
  // Plenty of orders are a single block of text with no body of sections, which
  // is a legitimate document with nothing to map, not a malformed one.
  if (!bodyEl && statuteEl.tagName !== "Regulation") {
    throw new StatuteParseError("Statute XML has no <Body> element.");
  }

  // Regulations have no consolidated number of their own, so the code they
  // were requested under (see parseCachedSource) stands in for it.
  const code = textOf(identificationEl && findDescendant(identificationEl, "ConsolidatedNumber")) || fallbackCode;
  const longTitle = textOf(identificationEl && directChild(identificationEl, "LongTitle"));
  const shortTitle = textOf(identificationEl && directChild(identificationEl, "ShortTitle")) || longTitle;

  if (!code) {
    throw new StatuteParseError("Could not find the statute's consolidated number (<ConsolidatedNumber>).");
  }

  const sections: StatuteSection[] = [];
  // Stack of enclosing Part/Heading breadcrumbs, keyed by their `level` attribute.
  const stack: Array<{ level: number; title: string }> = [];

  for (const child of Array.from(bodyEl?.children ?? [])) {
    if (child.tagName === "Heading") {
      const level = Number(child.getAttribute("level") ?? "1");
      const labelText = textOf(directChild(child, "Label"));
      const titleText = textOf(directChild(child, "TitleText"));
      const title = labelText ? `${labelText} — ${titleText}` : titleText;

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack.push({ level, title });
      continue;
    }

    if (child.tagName === "Section") {
      const headingPath = stack.map((s) => s.title);
      sections.push(parseSection(child, code, headingPath));
    }

    // Other top-level tags (e.g. <Schedule>) are out of scope for step 1.
  }

  return {
    code,
    shortTitle,
    longTitle,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    sections,
  };
}

function findDescendant(el: Element, tagName: string): Element | null {
  return el.getElementsByTagName(tagName)[0] ?? null;
}
