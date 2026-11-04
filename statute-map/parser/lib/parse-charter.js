// Pure parser: the real Justice Laws HTML page for the Constitution Act,
// 1982 in, StatuteDocument out (see ../../docs/SCHEMA.md) — but keeping
// only Part I, the Canadian Charter of Rights and Freedoms itself. No file
// I/O or network here — parse-charter.js (CLI) wraps this with its own way
// of getting the HTML text in the first place.
//
// The Charter isn't published as XML the way most federal Acts are —
// Justice Laws never generated machine-readable XML for the Constitution
// Acts — so this reads the same real HTML page Statute Map's own
// src/statute/parseStatuteHtml.ts already parses (see that file's header
// comment for the page's markup conventions, independently confirmed here
// against a live fetch of https://laws-lois.justice.gc.ca/eng/Const/page-12.html):
//
// - Content is a flat sequence of elements directly under
//   `div.wb-txthl > section`: `h2.Part` (new Part), `h3.Subheading` (new
//   Division within the current Part), `p.MarginalNote` (always a
//   preceding sibling of the section/subsection it annotates, never a
//   child), and either `p.Section` (no subsections) or
//   `ul.Section.ProvisionList` (a section broken into `(1)`/`(2)`
//   subsections, one per `<li>`).
// - Unlike Statute Map's flat text-only output, this adapter needs the
//   Explorer's structured `body` blocks — and unlike the flat Ontario
//   source (a bare sequence of sibling <p> tags needing a manual
//   open/close stack), the Charter's real markup is *genuinely tree-shaped*
//   (`<ul><li>` nesting), so this walks it with plain recursion instead —
//   closer in spirit to the XML pipeline's parseBlock than to Ontario's
//   stack-based attach().
// - A section's own number lives in a single `<a class="sectionLabel">` —
//   inline for a `p.Section`, inside the first `<li>` for a
//   `ul.Section.ProvisionList`. Subsection/paragraph numbers like "(1)",
//   "(a)" use `<span class="lawlabel">` instead.
// - A lettered `ul.ProvisionList` (without the "Section" class) sometimes
//   appears as a top-level sibling of a `p.Section` rather than nested
//   inside it (real markup quirk, confirmed live on the Charter's own
//   section 2) — folded onto whichever section is currently open, not
//   treated as a new one.
// - A `<li>` can contain, in order: an optional `p.MarginalNote`, its own
//   labelled `p.Subsection`/`p.Paragraph`, an optional nested
//   `ul.ProvisionList` for its own lettered sub-points, and an optional
//   trailing `p.ContinuedSectionSubsection` — prose that resumes *after*
//   that nested list but still belongs to the same subsection (confirmed
//   live on the Charter's own section 23(1)).
// - `span.wb-invisible` (screen-reader-only "Marginal note:" prefixes) and
//   `a[href^="endNotes"]` (footnote reference superscripts) are stripped
//   entirely — not part of the enacted text. No defined-term glossary
//   exists in the Charter itself, so `definitions` is always empty.
// - The page also contains Part II onward (aboriginal rights, amending
//   formula, etc.) — parsing stops the moment a *second* `h2.Part` is
//   seen, so only the real Charter (Part I) is ever included, matching
//   Statute Map's own `parseCharterHtml` filtering.
import * as cheerio from "cheerio";
import { createRunTokenizer } from "./text-runs.js";

const CHARTER_ID = "CHARTER"; // matches Statute Map's own STATUTE_LOOKUP code for
// the Charter — both apps' cross-links (explorerSlugForCode/"View in graph")
// derive their slug/id from this same value, so keeping it identical is what
// makes the two apps' existing linking code work with zero changes on
// either side.
const CHARTER_TITLE = "Canadian Charter of Rights and Freedoms";
const CHARTER_CITATION = "Part I of the Constitution Act, 1982";
const XREF_EXTERNAL_ACT_CLASS = "XRefExternalAct";

function primaryClasses(el, $) {
  return ($(el).attr("class") || "").trim().split(/\s+/).filter(Boolean);
}

function hasClass(el, $, name) {
  return primaryClasses(el, $).includes(name);
}

/** Flattens an element's inline content to plain text, the same set of
 *  skip-rules Statute Map's own renderInline() uses on this exact source
 *  (see that file for why each one exists): screen-reader-only prefixes,
 *  footnote superscript links, the section's own number anchor, and the
 *  subsection/paragraph lawlabel (extracted separately — see
 *  splitLeadingLabel — never left inline, unlike Statute Map's flatter
 *  text-only output). */
function renderInline($el, $) {
  let out = "";
  for (const child of $el.contents().toArray()) {
    if (child.type === "text") {
      out += child.data ?? "";
      continue;
    }
    if (child.type !== "tag") continue;
    const $child = $(child);
    if (hasClass(child, $, "wb-invisible")) continue;
    if (child.tagName === "a" && ($child.attr("href") || "").startsWith("endNotes")) continue;
    if (child.tagName === "a" && hasClass(child, $, "sectionLabel")) continue;
    if (child.tagName === "span" && hasClass(child, $, "lawlabel")) continue;
    if (child.tagName === "sup") continue;
    out += renderInline($child, $);
  }
  return out;
}

/** True when `$el`'s inline content is immediately followed (as the very
 *  next sibling element) by a `<cite class="XRefExternalAct">` — the
 *  real markup's own "an Act's name follows here" marker, mirroring the
 *  federal XML pipeline's nextIsActName check (`<XRefExternal>` there).
 *  Confirmed live: only 3 occurrences on the whole page, none inside Part I
 *  adjacent to a numeric "sections N" citation, so this never actually
 *  changes today's output — kept for the same reason the other adapters
 *  keep it: a future amendment could introduce that ambiguity, and
 *  suppressing it is a one-line check against a real, government-authored
 *  signal, not a guess. */
function nextSiblingIsActName($el, $) {
  const next = $el.next();
  return next.length > 0 && next.get(0).tagName === "cite" && hasClass(next.get(0), $, XREF_EXTERNAL_ACT_CLASS);
}

function buildTextBlock(text, ctx, tokenizeText, nextIsActName) {
  return { type: "text", runs: tokenizeText(text, ctx, nextIsActName) };
}

/** Splits a labelled `<p>` (class Subsection/Paragraph) into its "(1)" /
 *  "(a)" label and the remaining body text — the lawlabel span itself is
 *  never left inline (renderInline already skips it); this just reads it
 *  separately first. */
function splitLeadingLabel($p, $) {
  const labelText = $p.find("span.lawlabel").first().text().trim();
  return { label: labelText || null, text: renderInline($p, $).trim() };
}

const TYPE_FOR_CLASS = { Subsection: "subsection", Paragraph: "paragraph", Subparagraph: "subparagraph", Clause: "clause" };

/** Parses one `<li>` of a Section/ProvisionList `<ul>` into a single block
 *  (subsection/paragraph/etc.), recursing into any nested
 *  `ul.ProvisionList` for that block's own lettered sub-points and folding
 *  a trailing `p.ContinuedSectionSubsection`/`p.ContinuedParagraph` back
 *  onto the same block — real markup, not a hypothetical (Charter s.23(1)
 *  has exactly this shape: "(1) Citizens of Canada" + a lettered (a)/(b)
 *  list + "have the right to have their children..." resuming after it,
 *  all one subsection). Returns null for a malformed/empty `<li>` (e.g. no
 *  recognized labelled paragraph at all) rather than throwing — a
 *  best-effort parse of one stray item shouldn't fail the whole document. */
function parseListItem($li, $, ctx, tokenizeText) {
  let marginalNote = null;
  let block = null;
  const trailing = [];

  for (const child of $li.children().toArray()) {
    const $child = $(child);
    const cls = primaryClasses(child, $)[0];

    if (child.tagName === "p" && cls === "MarginalNote") {
      marginalNote = renderInline($child, $).trim();
      continue;
    }
    if (child.tagName === "ul" && hasClass(child, $, "ProvisionList")) {
      trailing.push(...renderProvisionList($child, $, ctx, tokenizeText));
      continue;
    }
    if (child.tagName === "p" && TYPE_FOR_CLASS[cls]) {
      const { label, text } = splitLeadingLabel($child, $);
      const nextIsActName = nextSiblingIsActName($child, $);
      block = { type: TYPE_FOR_CLASS[cls], label, children: text ? [buildTextBlock(text, ctx, tokenizeText, nextIsActName)] : [] };
      if (cls === "Subsection") block.marginalNote = marginalNote;
      continue;
    }
    if (child.tagName === "p" && cls?.startsWith("Continued")) {
      const text = renderInline($child, $).trim();
      if (text) trailing.push(buildTextBlock(text, ctx, tokenizeText, nextSiblingIsActName($child, $)));
      continue;
    }
    // Unrecognized child inside a <li>: best-effort inline render rather
    // than silently dropping real enacted text.
    const text = renderInline($child, $).trim();
    if (text) trailing.push(buildTextBlock(text, ctx, tokenizeText, false));
  }

  if (!block) return null;
  block.children.push(...trailing);
  return block;
}

function renderProvisionList($ul, $, ctx, tokenizeText) {
  const blocks = [];
  for (const li of $ul.children("li").toArray()) {
    const block = parseListItem($(li), $, ctx, tokenizeText);
    if (block) blocks.push(block);
  }
  return blocks;
}

/**
 * @param {string} html  the real page's raw HTML
 * @param {string} sourceUrl
 * @returns {{ statuteDocument: object, parts: object[], sections: object, definitions: object }}
 */
export function parseCharterHtml(html, sourceUrl) {
  const $ = cheerio.load(html);
  const container = $("div.wb-txthl > section").first();
  if (container.length === 0) {
    throw new Error("Could not find the content container (div.wb-txthl > section) — this doesn't look like a Justice Laws constitutional-document page.");
  }

  const children = container.children().toArray();

  // ---------- pass 1: valid section ids within Part I only ----------
  // (No definitions to collect — the Charter has no defined-term glossary.)
  const validSectionIds = new Set();
  {
    let partHeadingsSeen = 0;
    for (const el of children) {
      if (el.tagName === "h2" && hasClass(el, $, "Part")) {
        partHeadingsSeen++;
        if (partHeadingsSeen > 1) break; // Part II onward — stop collecting
        continue;
      }
      if (partHeadingsSeen === 0) continue; // before Part I's own heading (the bare document-title <h2>)
      if (el.tagName === "p" && hasClass(el, $, "Section")) {
        const number = $(el).find("a.sectionLabel").first().text().trim();
        if (number) validSectionIds.add(`s${number}`);
      } else if (el.tagName === "ul" && hasClass(el, $, "Section") && hasClass(el, $, "ProvisionList")) {
        const number = $(el).find("a.sectionLabel").first().text().trim();
        if (number) validSectionIds.add(`s${number}`);
      }
    }
  }

  const { tokenizeText } = createRunTokenizer({ definitions: {}, validSectionIds });

  // ---------- pass 2: real tree, Part I only ----------

  const parts = [];
  const sections = {};
  let currentPart = null;
  let currentDivision = null;
  let currentSection = null;
  let pendingNote = null;
  let partHeadingsSeen = 0;

  function ensureDivision() {
    if (!currentDivision) {
      currentDivision = { id: `${currentPart.id}-main`, title: null, sectionIds: [] };
      currentPart.divisions.push(currentDivision);
    }
  }

  for (const el of children) {
    if (el.tagName === "h2" && hasClass(el, $, "Part")) {
      partHeadingsSeen++;
      if (partHeadingsSeen > 1) break; // Part II onward — the Charter itself (Part I) is done
      const label = $(el).find(".HLabel1").text().trim();
      const title = $(el).find(".HTitleText1").text().trim();
      currentPart = { id: "part-1", label: label || null, title: title || CHARTER_TITLE, divisions: [] };
      parts.push(currentPart);
      currentDivision = null;
      pendingNote = null;
      continue;
    }
    if (partHeadingsSeen === 0) continue; // before Part I's heading

    if (el.tagName === "h3" && hasClass(el, $, "Subheading")) {
      const title = $(el).find(".HTitleText2").text().trim();
      currentDivision = { id: `${currentPart.id}-div-${currentPart.divisions.length + 1}`, title, sectionIds: [] };
      currentPart.divisions.push(currentDivision);
      pendingNote = null;
      continue;
    }

    if (el.tagName === "p" && hasClass(el, $, "MarginalNote")) {
      pendingNote = renderInline($(el), $).trim();
      continue;
    }

    if (el.tagName === "p" && hasClass(el, $, "Section")) {
      const $el = $(el);
      const number = $el.find("a.sectionLabel").first().text().trim();
      if (!number) {
        // Unnumbered lead-in text (the Charter's own "Whereas Canada is
        // founded upon..." preamble) — not a real section, nothing to link to.
        pendingNote = null;
        continue;
      }
      ensureDivision();
      const id = `s${number}`;
      const ctx = { sectionId: id, outgoingRefs: new Set() };
      const leadText = renderInline($el, $).trim();
      currentSection = {
        id,
        number,
        marginalNote: pendingNote,
        partId: currentPart.id,
        divisionId: currentDivision.id,
        body: leadText ? [buildTextBlock(leadText, ctx, tokenizeText, nextSiblingIsActName($el, $))] : [],
        definesTerms: [],
        outgoingRefs: ctx.outgoingRefs,
        historicalNote: null,
        _ctx: ctx,
      };
      sections[id] = currentSection;
      currentDivision.sectionIds.push(id);
      pendingNote = null;
      continue;
    }

    if (el.tagName === "ul" && hasClass(el, $, "Section") && hasClass(el, $, "ProvisionList")) {
      const $el = $(el);
      const number = $el.find("a.sectionLabel").first().text().trim();
      if (!number) {
        pendingNote = null;
        continue;
      }
      ensureDivision();
      const id = `s${number}`;
      const ctx = { sectionId: id, outgoingRefs: new Set() };
      currentSection = {
        id,
        number,
        marginalNote: pendingNote,
        partId: currentPart.id,
        divisionId: currentDivision.id,
        body: renderProvisionList($el, $, ctx, tokenizeText),
        definesTerms: [],
        outgoingRefs: ctx.outgoingRefs,
        historicalNote: null,
        _ctx: ctx,
      };
      sections[id] = currentSection;
      currentDivision.sectionIds.push(id);
      pendingNote = null;
      continue;
    }

    if (el.tagName === "ul" && hasClass(el, $, "ProvisionList") && !hasClass(el, $, "Section")) {
      // Real markup quirk (confirmed on the Charter's own section 2): a
      // lettered list lands as a top-level sibling instead of nested
      // inside the section's own <li> — still belongs to whichever
      // section is currently open, not a new section.
      if (currentSection) {
        currentSection.body.push(...renderProvisionList($(el), $, currentSection._ctx, tokenizeText));
      }
      continue;
    }

    // Anything else at the top level (stray text, unexpected tags):
    // ignored rather than thrown on — real government HTML has odd
    // corners, and a missed decorative element shouldn't fail the parse.
  }

  // finalize sections: Set -> array, drop the pass-2-only _ctx scratch field
  for (const section of Object.values(sections)) {
    section.outgoingRefs = [...section.outgoingRefs];
    delete section._ctx;
  }

  const crossRefIndex = {};
  for (const id of Object.keys(sections)) crossRefIndex[id] = { outgoing: [], incoming: [] };
  for (const section of Object.values(sections)) {
    for (const target of section.outgoingRefs) {
      if (!crossRefIndex[target]) continue; // guards against stray ids
      crossRefIndex[section.id].outgoing.push(target);
      crossRefIndex[target].incoming.push(section.id);
    }
  }

  const consolidatedDate = $('time[property="dateModified"]').first().text().trim() || null;

  const statuteDocument = {
    id: CHARTER_ID,
    jurisdiction: "federal",
    title: CHARTER_TITLE,
    citation: CHARTER_CITATION,
    sourceUrl,
    consolidatedDate,
    tree: parts,
    sections,
    definitions: {},
    crossRefIndex,
  };

  return { statuteDocument, parts, sections, definitions: {} };
}
