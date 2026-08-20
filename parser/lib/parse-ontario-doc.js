// Pure parser: Ontario e-Laws JSON text in, StatuteDocument out (see
// ../../docs/SCHEMA.md). No file I/O or network here — parse-ontario.js
// (CLI) and the dev-server import API both wrap this with their own way of
// getting the JSON text in the first place.
//
// See parse-ontario.js's header comment for the full explanation of why
// this source needs a heuristic HTML-by-CSS-class walk rather than a
// schema-driven one the way the federal parser gets to do.
import * as cheerio from "cheerio";
import { createRunTokenizer, collectPreviewRuns, slugify } from "./text-runs.js";

const SKIP_CLASSES = new Set([
  "MsoNormal",
  "Pnote", // not-yet-in-force pending-amendment note — not current law
  "footnote",
  "table",
  "schedule",
  "line",
  "toc",
  "headingx", // "SCHEDULE" / table headings — schedules are out of scope for
  // v1 (same as federal), and can appear mid-document, not just at the end,
  // so this is skipped rather than treated as end-of-document.
  "heading3", // italicized Act-name list items inside a schedule; not
  // structural on their own (verified against a real schedule listing
  // related Acts) — dropped rather than guessed at.
]);

// Nesting depth for the stack-based attach model below — a block at level L
// closes out any currently-open block at level >= L (e.g. a new subsection
// ends whatever paragraph/subparagraph was open under the previous one).
const LEVEL = { subsection: 1, definition: 1, paragraph: 2, subpara: 3, subclause: 4 };
const TYPE_FOR_CLASS = {
  subsection: "subsection",
  paragraph: "paragraph",
  subpara: "subparagraph",
  subclause: "clause",
};

/**
 * @param {string} rawJsonText  the raw response body from
 *   ontario.ca/laws/api/v2/legislation/en/doc-search/statute/<alias>
 * @returns {{ statuteDocument: object, parts: object[], sections: object, definitions: object }}
 */
export function parseOntarioJson(rawJsonText) {
  let raw;
  try {
    raw = JSON.parse(rawJsonText);
  } catch {
    throw new Error("Not valid JSON.");
  }
  if (!raw.content) {
    throw new Error("Not a recognized Ontario e-Laws document (no content field).");
  }
  const alias = String(raw.alias ?? "").replace(/^statute\//, "");
  if (!alias) {
    throw new Error("Ontario document has no self-reported alias.");
  }

  const $ = cheerio.load(raw.content);

  const shortTitle =
    raw.actName?.en ?? cheerio.load(raw.shortTitle ?? "")("body").text().trim();
  const chapterText = cheerio.load(raw.chapter ?? "")("body").text().trim(); // "R.S.O. 1990, CHAPTER H.8"
  const citation = chapterText.replace(/CHAPTER/i, "c.");
  const consolidatedDate = raw.dateFrom ? raw.dateFrom.slice(0, 10) : null;

  // Every structurally meaningful <p> in document order, excluding anything
  // inside a <table> (the table of contents, and any in-body schedule/rate
  // tables) — those never carry operative section text.
  const paragraphs = $("p")
    .toArray()
    .filter((el) => $(el).closest("table").length === 0);

  function primaryClass(el) {
    const cls = ($(el).attr("class") || "").trim();
    return cls.split(/\s+/)[0] ?? "";
  }

  function shouldSkip(el) {
    const cls = ($(el).attr("class") || "").trim();
    if (!cls) return true;
    if (cls.startsWith("Y")) return true; // parallel "future law" overlay block
    const first = primaryClass(el);
    if (first === "footnoteLeft") return true; // amendment-history footnote block
    return SKIP_CLASSES.has(first);
  }

  /** Text of `el` with `.citation` (amendment history) stripped, plus that
   * stripped text separately — cheerio/parse5 recovers a sane tree from the
   * source's malformed nested citation spans, so a clone-and-remove is safe.
   * The source wraps one citation in several NESTED `.citation` spans (each
   * word gets its own, e.g. "R." / "S.O." / "1990, c. H.8, s. 3 (1)." each
   * in a `.citation` span nested inside the last) — `.text()` on every
   * matched span would concatenate the same content two or three times
   * over, since a parent span's text already includes its nested spans'.
   * Only the outermost span per group is used. */
  function splitCitation(el) {
    const $el = $(el);
    const clone = $el.clone();
    const allCitations = clone.find(".citation");
    const topLevel = allCitations.filter(
      (i, node) => $(node).parents(".citation").length === 0,
    );
    const citation = topLevel
      .map((i, node) => $(node).text())
      .get()
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    topLevel.remove();
    clone.find("a[name]").remove();
    const text = clone.text().replace(/\s+/g, " ").trim();
    return { text, citation: citation || null };
  }

  // ---------- pass 1: definitions + valid section ids ----------

  const definitions = {};
  const validSectionIds = new Set();
  let scanSectionId = null;
  let scanSectionLead = null;

  for (const el of paragraphs) {
    if (shouldSkip(el)) continue;
    const cls = primaryClass(el);
    if (cls === "section") {
      const number = $(el).find("b").first().text().trim();
      if (!number) continue; // continuation of the current section, not a new one — see pass 2
      scanSectionId = `s${number}`;
      validSectionIds.add(scanSectionId);
      scanSectionLead = splitCitation(el).text.toLowerCase();
    } else if (cls === "definition") {
      const { text } = splitCitation(el);
      const m = text.match(/^[“"]([^”"]+)[”"]/);
      if (!m || !scanSectionId) continue;
      const term = m[1];
      const id = slugify(term);
      if (definitions[id]) continue;
      let scope = "this Act";
      if (scanSectionLead?.startsWith("in this part")) scope = "this Part";
      definitions[id] = { id, term, sectionId: scanSectionId, scope, previewRuns: null };
    }
  }

  const { tokenizeText } = createRunTokenizer({ definitions, validSectionIds });

  // ---------- pass 2: full tree + runs ----------

  function buildTextBlock(text, ctx) {
    return { type: "text", runs: tokenizeText(text, ctx, false) };
  }

  let parts = [];
  let currentPart = null;
  let currentDivision = null;
  let currentSection = null;
  let stack = []; // [{ level, block }], deepest open block last
  let pendingHeadnotes = [];
  const sections = {};

  function ensurePart() {
    if (!currentPart) {
      currentPart = { id: "preliminary", label: null, title: "Preliminary Provisions", divisions: [] };
      parts.push(currentPart);
    }
  }

  function ensureDivision() {
    ensurePart();
    if (!currentDivision) {
      currentDivision = { id: `${currentPart.id}-main`, title: null, sectionIds: [] };
      currentPart.divisions.push(currentDivision);
    }
  }

  function flushHeadnote() {
    const note = pendingHeadnotes.length ? pendingHeadnotes.join(" — ") : null;
    pendingHeadnotes = [];
    return note;
  }

  /** Attaches `block` under whatever's currently open at the right depth,
   * closing deeper contexts (e.g. a new subsection ends an open definition's
   * lettered clauses) — see LEVEL. */
  function attach(levelName, block) {
    const level = LEVEL[levelName];
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parentChildren = stack.length ? stack[stack.length - 1].block.children : currentSection.body;
    parentChildren.push(block);
    stack.push({ level, block });
  }

  /** A "definition" paragraph with no leading quoted term continues the
   * currently-open definition (e.g. the closing clause + French term after
   * a lettered list) rather than starting a new one. */
  function continueOpenDefinition(textBlock) {
    while (stack.length && stack[stack.length - 1].level > 1) stack.pop();
    const top = stack[stack.length - 1];
    if (top?.block.type === "definition") {
      top.block.children.push(textBlock);
    } else {
      currentSection.body.push(textBlock);
    }
  }

  /** Builds a labelled block (subsection/paragraph/subpara/subclause) from
   * its leading "(N)" / "(a)" / "(i)" marker, or a label-less "continued"
   * block when the source resumed prose after a lettered list without one. */
  function buildLeveledBlock(kindLevel, el, ctx, marginalNote) {
    const { text, citation } = splitCitation(el);
    const m = text.match(/^\(([^)]+)\)\s*/);
    const type = TYPE_FOR_CLASS[kindLevel];
    if (m) {
      const label = `(${m[1]})`;
      const remainder = text.slice(m[0].length);
      const block = { type, label, children: [buildTextBlock(remainder, ctx)] };
      if (kindLevel === "subsection") block.marginalNote = marginalNote ?? null;
      if (citation) ctx.historicalNotes.push(citation);
      return block;
    }
    if (citation) ctx.historicalNotes.push(citation);
    return { type: "continued", children: [buildTextBlock(text, ctx)] };
  }

  for (const el of paragraphs) {
    if (shouldSkip(el)) continue;
    const cls = primaryClass(el);

    if (cls === "partnum") {
      // "PART I <br> ADMINISTRATION" — split the raw HTML on the actual
      // <br> tag itself, not on whitespace (the label "PART I" has its own
      // space).
      const innerHtml = $(el).html() || "";
      const [labelHtml, titleHtml] = innerHtml.split(/<br\s*\/?>/i);
      const cleanText = (fragment) =>
        cheerio
          .load(`<div>${fragment ?? ""}</div>`)("div")
          .text()
          .replace(/\s+/g, " ")
          .trim();
      const labelPart = cleanText(labelHtml);
      const titlePart = cleanText(titleHtml);
      currentPart = {
        id: `part-${parts.length + 1}`,
        label: titlePart ? labelPart : null,
        title: titlePart || labelPart,
        divisions: [],
      };
      parts.push(currentPart);
      currentDivision = null;
      continue;
    }

    if (cls === "heading1") {
      ensurePart();
      currentDivision = {
        id: `${currentPart.id}-div-${currentPart.divisions.length + 1}`,
        title: $(el).text().trim(),
        sectionIds: [],
      };
      currentPart.divisions.push(currentDivision);
      continue;
    }

    if (cls === "headnote") {
      pendingHeadnotes.push($(el).text().trim());
      continue;
    }

    if (cls === "section") {
      const number = $(el).find("b").first().text().trim();
      if (!number) {
        // Word's export occasionally splits one section's text across
        // multiple class="section" paragraphs — only the first carries the
        // bold section number. Without a number this is a continuation of
        // the current section, not a new one (a bogus empty-number
        // section otherwise gets created here).
        if (currentSection) {
          const { text, citation } = splitCitation(el);
          if (citation) currentSection.historicalNotes.push(citation);
          if (text) {
            const ctx = {
              sectionId: currentSection.id,
              outgoingRefs: currentSection.outgoingRefs,
              historicalNotes: currentSection.historicalNotes,
            };
            const target = stack.length ? stack[stack.length - 1].block.children : currentSection.body;
            target.push(buildTextBlock(text, ctx));
          }
        }
        continue;
      }
      ensureDivision();
      const marginalNote = flushHeadnote();
      const id = `s${number}`;
      currentSection = {
        id,
        number,
        marginalNote,
        partId: currentPart.id,
        divisionId: currentDivision.id,
        body: [],
        definesTerms: [],
        outgoingRefs: new Set(),
        historicalNotes: [],
      };
      sections[id] = currentSection;
      currentDivision.sectionIds.push(id);
      stack = [];

      const { text, citation } = splitCitation(el);
      const leadText = text.replace(/^\S+\s*/, ""); // drop the bold section number itself
      if (citation) currentSection.historicalNotes.push(citation);
      const ctx = { sectionId: id, outgoingRefs: currentSection.outgoingRefs, historicalNotes: currentSection.historicalNotes };
      const m = leadText.match(/^\(([^)]+)\)\s*/);
      if (m) {
        const label = `(${m[1]})`;
        const remainder = leadText.slice(m[0].length);
        const block = { type: "subsection", label, marginalNote: null, children: [buildTextBlock(remainder, ctx)] };
        currentSection.body.push(block);
        stack.push({ level: LEVEL.subsection, block });
      } else if (leadText) {
        currentSection.body.push(buildTextBlock(leadText, ctx));
      }
      continue;
    }

    if (!currentSection) continue; // stray content before the first section

    const ctx = {
      sectionId: currentSection.id,
      outgoingRefs: currentSection.outgoingRefs,
      historicalNotes: currentSection.historicalNotes,
    };

    if (cls === "subsection") {
      const marginalNote = flushHeadnote();
      attach("subsection", buildLeveledBlock("subsection", el, ctx, marginalNote));
    } else if (cls === "paragraph") {
      attach("paragraph", buildLeveledBlock("paragraph", el, ctx));
    } else if (cls === "subpara") {
      attach("subpara", buildLeveledBlock("subpara", el, ctx));
    } else if (cls === "subclause") {
      attach("subclause", buildLeveledBlock("subclause", el, ctx));
    } else if (cls === "definition") {
      const { text, citation } = splitCitation(el);
      if (citation) ctx.historicalNotes.push(citation);
      const m = text.match(/^[“"]([^”"]+)[”"]\s*/);
      if (m) {
        const term = m[1];
        const termId = slugify(term);
        const remainder = text.slice(m[0].length);
        const block = {
          type: "definition",
          termId,
          children: [buildTextBlock(remainder, ctx)],
        };
        attach("definition", block);
        if (definitions[termId] && !definitions[termId].previewRuns) {
          definitions[termId].previewRuns = collectPreviewRuns(block.children);
        }
      } else {
        continueOpenDefinition(buildTextBlock(text, ctx));
      }
    }
    // headnoteitalic/heading3: rare inline emphasis, not structural —
    // dropped rather than guessed at, per-instance content loss is
    // preferable to a wrong tree.
  }

  // group defined terms back onto their owning section
  for (const def of Object.values(definitions)) {
    sections[def.sectionId]?.definesTerms.push(def.id);
  }
  for (const def of Object.values(definitions)) {
    if (!def.previewRuns) {
      def.previewRuns = collectPreviewRuns(sections[def.sectionId]?.body ?? []);
    }
  }

  const crossRefIndex = {};
  for (const id of Object.keys(sections)) crossRefIndex[id] = { outgoing: [], incoming: [] };
  for (const section of Object.values(sections)) {
    for (const target of section.outgoingRefs) {
      if (!crossRefIndex[target]) continue;
      crossRefIndex[section.id].outgoing.push(target);
      crossRefIndex[target].incoming.push(section.id);
    }
  }

  // finalize sections: Set -> array, historicalNotes array -> joined string
  for (const section of Object.values(sections)) {
    section.outgoingRefs = [...section.outgoingRefs];
    section.historicalNote = section.historicalNotes.length
      ? section.historicalNotes.join("; ")
      : null;
    delete section.historicalNotes;
  }

  // Not every Ontario Act drafts a "short title" as its own numbered
  // section the way federal Acts always do (Highway Traffic Act doesn't —
  // its actual section 1 is definitions). Rather than let the reading view
  // just start mid-Act with no title, prepend a small citation entry from
  // the Act's own metadata. It's deliberately NOT labelled "Short title" —
  // that's specific legal terminology for a formally drafted provision,
  // and this isn't one; calling it that would make something I generated
  // look like it's part of the enacted text. Only added if the source
  // doesn't already have a real numbered short-title section.
  const hasShortTitleSection = Object.values(sections).some((s) =>
    /short title/i.test(s.marginalNote ?? ""),
  );
  if (!hasShortTitleSection) {
    const titlePart = {
      id: "about-this-act",
      label: null,
      title: "About This Act",
      divisions: [{ id: "about-this-act-main", title: null, sectionIds: ["title"] }],
    };
    parts.unshift(titlePart);
    sections.title = {
      id: "title",
      number: "",
      marginalNote: "About this Act",
      partId: "about-this-act",
      divisionId: "about-this-act-main",
      body: [
        { type: "text", runs: [{ type: "text", value: `${shortTitle}, ${citation}.` }] },
      ],
      definesTerms: [],
      outgoingRefs: [],
      historicalNote:
        "Not a section of the Act — the Ontario source doesn't number a short title the way federal statutes do. Shown here from the Act's own citation metadata.",
    };
    crossRefIndex.title = { outgoing: [], incoming: [] };
  }

  const statuteDocument = {
    id: alias,
    jurisdiction: "ontario",
    title: shortTitle,
    citation,
    sourceUrl: `https://www.ontario.ca/laws/statute/${alias}`,
    consolidatedDate,
    tree: parts,
    sections,
    definitions,
    crossRefIndex,
  };

  return { statuteDocument, parts, sections, definitions };
}
