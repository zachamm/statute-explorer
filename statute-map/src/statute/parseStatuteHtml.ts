import type { Statute, StatuteSection } from "./types";
import { StatuteParseError } from "./parseStatuteXml";

/**
 * Parses Justice Laws' HTML-only constitutional-document pages (the
 * Constitution Acts, 1867 to 1982 — including the Charter, which is
 * Part I of the Constitution Act, 1982). These documents predate the
 * "Revised Statutes" chapter-numbering scheme the XML pipeline covers,
 * so Justice Laws never generated XML for them; this is the HTML
 * equivalent of parseStatuteXml.ts, producing the exact same
 * StatuteSection shape so every downstream module (classifyReferences,
 * the graph, projects) works on HTML-sourced statutes unmodified.
 *
 * Markup notes (from inspecting the real page,
 * https://laws-lois.justice.gc.ca/eng/Const/page-12.html):
 *
 * - Content lives in a flat sequence of elements directly under
 *   `div.wb-txthl > section`: `h2.Part` (Part-level heading, "PART I" +
 *   title), `h3.Subheading` (sub-heading), `p.MarginalNote` (always
 *   precedes the section/subsection it annotates as a preceding
 *   sibling, never a child), and either `p.Section` (a section with no
 *   subsections) or `ul.Section.ProvisionList` (a section broken into
 *   numbered subsections, one per `<li>`).
 * - A section's own number lives in a single `<a class="sectionLabel">`
 *   — for a `p.Section` it's inline; for a `ul.Section.ProvisionList`
 *   it's inside the first `<li>`. Subsection/paragraph numbers like
 *   "(1)", "(a)" use `<span class="lawlabel">` instead, and are kept
 *   inline (mirrors the XML parser's Label handling).
 * - Occasionally a lettered `ul.ProvisionList` (without the "Section"
 *   class) appears as a top-level sibling rather than nested inside the
 *   section's own `<li>` — a markup quirk, not a new section; it's
 *   folded into whichever section is currently open.
 * - `span.wb-invisible` (screen-reader-only "Marginal note:"/"End note "
 *   labels) and `a[href^="endNotes"]` (footnote reference superscripts)
 *   are stripped entirely — not part of the enacted text.
 */

export interface ConstitutionDocumentMeta {
  code: string;
  shortTitle: string;
  longTitle: string;
}

function parseHtmlDocument(html: string): Document {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const container = doc.querySelector("div.wb-txthl > section");
  if (!container) {
    throw new StatuteParseError(
      "Could not find the content container (div.wb-txthl > section) — this doesn't look like a Justice Laws constitutional-document page."
    );
  }
  return doc;
}

function hasClass(el: Element, name: string): boolean {
  return (el.getAttribute("class") ?? "").split(/\s+/).includes(name);
}

function renderInline(node: Node): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? "";
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName;

    if (hasClass(el, "wb-invisible")) continue; // "Marginal note:" / "End note " a11y-only prefixes
    if (tag === "A" && (el.getAttribute("href") ?? "").startsWith("endNotes")) continue; // footnote ref
    if (tag === "A" && hasClass(el, "sectionLabel")) continue; // the section's own number, extracted separately
    if (tag === "SUP") continue; // defensive: a stray footnote superscript outside an endNotes link

    if (hasClass(el, "lawlabel")) {
      out += `${el.textContent ?? ""} `;
      continue;
    }

    out += renderInline(el);
  }
  return out;
}

function normalizeWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Renders the `<li>` children of a `ul.ProvisionList` (nested inside a
 *  section, at any depth) into block lines, recursing into further
 *  nested ProvisionLists for lettered sub-paragraphs. */
function renderProvisionList(ul: Element): string[] {
  const lines: string[] = [];
  let pendingNote: string | null = null;

  for (const li of Array.from(ul.children)) {
    if (li.tagName !== "LI") continue;

    for (const child of Array.from(li.children)) {
      if (child.tagName === "P" && hasClass(child, "MarginalNote")) {
        pendingNote = renderInline(child).trim();
        continue;
      }
      if (child.tagName === "UL" && hasClass(child, "ProvisionList")) {
        lines.push(...renderProvisionList(child));
        continue;
      }
      if (child.tagName === "P") {
        const text = renderInline(child).trim();
        if (text) lines.push(pendingNote ? `[${pendingNote}] ${text}` : text);
        pendingNote = null;
        continue;
      }
      // Unrecognized child: best-effort inline render rather than dropping it.
      const text = renderInline(child).trim();
      if (text) lines.push(text);
    }
  }

  return lines;
}

interface OpenSection {
  number: string;
  marginalNote: string | null;
  headingPath: string[];
  blocks: string[];
}

/**
 * Generic parser for one Justice Laws constitutional-document HTML page.
 * Returns *every* section found on the page in document order — for a
 * page spanning multiple Parts (as these pages do), filter the result by
 * `headingPath` for just the Part you want (see parseCharterHtml below).
 */
export function parseConstitutionDocumentHtml(html: string, sourceUrl: string, meta: ConstitutionDocumentMeta): Statute {
  const doc = parseHtmlDocument(html);
  const container = doc.querySelector("div.wb-txthl > section")!;

  const sections: StatuteSection[] = [];
  const stack: Array<{ level: 1 | 2; title: string }> = [];
  let pendingNote: string | null = null;
  let current: OpenSection | null = null;

  function flush(): void {
    if (current && current.number) {
      sections.push({
        id: `${meta.code}:${current.number}`,
        statuteCode: meta.code,
        number: current.number,
        marginalNote: current.marginalNote,
        text: normalizeWhitespace(current.blocks.join("\n")),
        headingPath: current.headingPath,
      });
    }
    current = null;
  }

  for (const child of Array.from(container.children)) {
    const tag = child.tagName;

    if (tag === "H2" && hasClass(child, "Part")) {
      flush();
      pendingNote = null;
      const label = child.querySelector(".HLabel1")?.textContent?.trim() ?? "";
      const title = child.querySelector(".HTitleText1")?.textContent?.trim() ?? "";
      while (stack.length > 0 && stack[stack.length - 1].level >= 1) stack.pop();
      stack.push({ level: 1, title: label ? `${label} — ${title}` : title });
      continue;
    }

    if (tag === "H3" && hasClass(child, "Subheading")) {
      flush();
      pendingNote = null;
      const title = child.querySelector(".HTitleText2")?.textContent?.trim() ?? "";
      while (stack.length > 0 && stack[stack.length - 1].level >= 2) stack.pop();
      stack.push({ level: 2, title });
      continue;
    }

    if (tag === "P" && hasClass(child, "MarginalNote")) {
      flush();
      pendingNote = renderInline(child).trim();
      continue;
    }

    if (tag === "P" && hasClass(child, "Section")) {
      flush();
      const number = child.querySelector("a.sectionLabel")?.textContent?.trim() ?? "";
      if (!number) {
        // Unnumbered lead-in text (e.g. the Charter's "Whereas Canada is
        // founded upon..." preamble) — not a real section, nothing to link to.
        pendingNote = null;
        continue;
      }
      current = { number, marginalNote: pendingNote, headingPath: stack.map((s) => s.title), blocks: [renderInline(child).trim()] };
      pendingNote = null;
      continue;
    }

    if (tag === "UL" && hasClass(child, "Section") && hasClass(child, "ProvisionList")) {
      flush();
      const number = child.querySelector("a.sectionLabel")?.textContent?.trim() ?? "";
      if (!number) {
        pendingNote = null;
        continue;
      }
      current = {
        number,
        marginalNote: pendingNote,
        headingPath: stack.map((s) => s.title),
        blocks: renderProvisionList(child),
      };
      pendingNote = null;
      continue;
    }

    if (tag === "UL" && hasClass(child, "ProvisionList")) {
      // A lettered list that landed as a top-level sibling instead of nested
      // inside the section's own <li> (a real markup quirk) — it still
      // belongs to whichever section is currently open.
      current?.blocks.push(...renderProvisionList(child));
      continue;
    }

    // Anything else at the top level (stray text, unexpected tags): ignored
    // rather than thrown on — real government HTML has odd corners, and a
    // missed decorative element shouldn't fail the whole parse.
  }

  flush();

  return {
    code: meta.code,
    shortTitle: meta.shortTitle,
    longTitle: meta.longTitle,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    sections,
  };
}

const CHARTER_META: ConstitutionDocumentMeta = {
  code: "CHARTER",
  shortTitle: "Canadian Charter of Rights and Freedoms",
  longTitle: "Part I of the Constitution Act, 1982",
};
const CHARTER_PART_HEADING = "PART I — Canadian Charter of Rights and Freedoms";

/** Parses just the Charter (Part I of the Constitution Act, 1982) out of
 *  its Justice Laws HTML page — which also contains Part II onward, since
 *  Justice Laws paginates this document by page, not by Part. */
export function parseCharterHtml(html: string, sourceUrl: string): Statute {
  const full = parseConstitutionDocumentHtml(html, sourceUrl, CHARTER_META);
  return {
    ...full,
    sections: full.sections.filter((s) => s.headingPath[0] === CHARTER_PART_HEADING),
  };
}

/** Registry of HTML parsers keyed by statute code, so callers (the
 *  Projects layer) can dispatch on a cached entry's code without needing
 *  to hardcode "the only HTML statute is the Charter" themselves. Add an
 *  entry here (and to STATUTE_LOOKUP) when a second HTML-sourced
 *  document is supported. */
export const HTML_STATUTE_PARSERS: Record<string, (html: string, sourceUrl: string) => Statute> = {
  CHARTER: parseCharterHtml,
};
