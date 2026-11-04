// Pure parser: federal "LIMS" XML text in, StatuteDocument out (see
// ../../docs/SCHEMA.md). No file I/O or network here: import-logic.js passes
// it the XML text.
import { DOMParser } from "@xmldom/xmldom";
import {
  createRunTokenizer,
  collectPreviewRuns,
  mergeAdjacentTextRuns,
  slugify,
} from "./text-runs.js";

function getChildElements(el, tagName) {
  if (!el) return [];
  const out = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 1 && (!tagName || node.tagName === tagName)) {
      out.push(node);
    }
  }
  return out;
}

function getDirectChild(el, tagName) {
  return getChildElements(el, tagName)[0] ?? null;
}

function textContent(node) {
  if (!node) return "";
  return node.textContent.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} xml
 * @param {{ code?: string }} [options] `code` is the Justice Laws catalogue id
 *   this XML was requested under, used as the statute's id when the document
 *   doesn't carry its own (regulations, and the odd Act with no consolidated
 *   number) so the result still lines up with the catalogue entry.
 * @returns {{ statuteDocument: object, parts: object[], sections: object, definitions: object }}
 */
export function parseFederalXml(xml, { code } = {}) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const isRegulation = !doc.getElementsByTagName("Statute")[0];
  const statuteEl = isRegulation
    ? doc.getElementsByTagName("Regulation")[0]
    : doc.getElementsByTagName("Statute")[0];
  if (!statuteEl) {
    throw new Error("Not a recognized federal Statute or Regulation XML document.");
  }
  const identificationEl = getDirectChild(statuteEl, "Identification");
  const bodyEl = getDirectChild(statuteEl, "Body");

  const shortTitle =
    textContent(getDirectChild(identificationEl, "ShortTitle")) ||
    textContent(getDirectChild(identificationEl, "LongTitle"));
  const instrumentNumber = textContent(getDirectChild(identificationEl, "InstrumentNumber"));
  const chapterEl = getDirectChild(identificationEl, "Chapter");
  const consolidatedNumber = textContent(
    getDirectChild(chapterEl, "ConsolidatedNumber"),
  );
  // Not every Act cites itself against an annual/revised-statute chapter
  // number — some (e.g. the Canadian Human Rights Act, "H-6") are cited by
  // consolidated number alone, and have no <AnnualStatuteId> at all.
  const annualStatuteEl = getDirectChild(chapterEl, "AnnualStatuteId");
  const annualNumber = textContent(
    getDirectChild(annualStatuteEl, "AnnualStatuteNumber"),
  );
  const annualYear = textContent(getDirectChild(annualStatuteEl, "YYYY"));
  // Acts cited by consolidated number alone (no <AnnualStatuteId>) are, as a
  // rule of the Canadian statute-citation scheme, drawn from the single 1985
  // general revision — that's what "R.S.C., 1985, c. X" identifies.
  const citation = isRegulation
    ? instrumentNumber
    : !annualStatuteEl
    ? `R.S.C., 1985, c. ${consolidatedNumber}`
    : annualStatuteEl.getAttribute("revised-statute") === "yes"
      ? `R.S.C., ${annualYear}, c. ${annualNumber}`
      : `S.C. ${annualYear}, c. ${annualNumber}`;
  const consolidatedDate = statuteEl.getAttribute("lims:lastAmendedDate");

  const bodyChildren = getChildElements(bodyEl);

  // ---------- pass 1: definitions + valid section ids ----------

  const definitions = {};
  const validSectionIds = new Set();

  function scopeFromSectionLeadText(sectionEl) {
    const leadText = getDirectChild(sectionEl, "Text");
    const lead = textContent(leadText).toLowerCase();
    if (lead.startsWith("in this act")) return "this Act";
    if (lead.startsWith("in this part")) return "this Part";
    if (lead.startsWith("in this division")) return "this Division";
    if (lead.includes("for the purposes of this act")) return "this Act";
    return "this Act";
  }

  for (const child of bodyChildren) {
    if (child.tagName !== "Section") continue;
    const label = textContent(getDirectChild(child, "Label"));
    validSectionIds.add(`s${label}`);

    const scope = scopeFromSectionLeadText(child);
    for (const dt of Array.from(child.getElementsByTagName("DefinedTermEn"))) {
      const term = textContent(dt);
      const id = slugify(term);
      if (definitions[id]) continue; // first occurrence in document order wins
      definitions[id] = {
        id,
        term,
        sectionId: `s${label}`,
        scope,
        previewRuns: null, // filled in during pass 2
      };
    }
  }

  const { tokenizeText } = createRunTokenizer({ definitions, validSectionIds });

  // ---------- pass 2: full tree + runs ----------

  // Resolves each not-yet-resolved definition's hover-preview text (C-02).
  //
  // Root cause this fixes: a <DefinedTermEn> anchor tag doesn't only appear
  // inside a <Definition> element, and a <Definition> can anchor *more than
  // one* term at once (e.g. C-46 s.2's "<DefinedTermEn>every one</DefinedTermEn>,
  // <DefinedTermEn>person</DefinedTermEn> and <DefinedTermEn>owner</DefinedTermEn>
  // ... include Her Majesty and an organization" is one shared definition for
  // three terms). Many Criminal Code terms are instead defined inline inside
  // a plain <Subsection> with no <Definition> wrapper at all (e.g. s.153.1(2):
  // "consent means, for the purposes of this section, ..."). Previously only
  // the *first* <DefinedTermEn> found in a <Definition> element got real
  // preview text; every other co-defined term, and every subsection-defined
  // term, fell through to a fallback that used the *entire section's* text
  // from the top — which is why "person" showed "Act"'s definition (s.2's
  // first entry) and "consent" showed s.153.1(1)'s unrelated offence text.
  //
  // Fix: call this for the two block types that are ever themselves *the*
  // definitional unit for a term — Subsection (bare inline definitions like
  // consent) and Definition (the dedicated wrapper). It looks ONLY at `el`'s
  // own direct <Text> child, never descending into nested Paragraph/
  // Subparagraph/Clause children, and for any term anchored there that
  // doesn't have preview text yet, uses *this* block's own parsed children
  // as the preview.
  //
  // Deliberately NOT applied to Paragraph/Subparagraph/Clause: those are
  // list-item/elaboration units, not definitional units, and a <DefinedTermEn>
  // tag can legitimately appear inside one of them as a plain cross-reference
  // mention of an *already/later*-defined term rather than defining it — e.g.
  // s.2's "justice system participant" definition enumerates witness types
  // including "(vi) a peace officer within the meaning of ... the definition
  // <DefinedTermEn>peace officer</DefinedTermEn>,", which is not "peace
  // officer"'s own definition (that's a separate <Definition> later in the
  // section). Restricting to each block's own direct <Text> (not deeper
  // descendants) keeps a Definition's multi-term head from reaching into its
  // own nested elaboration and picking up exactly this kind of mention.
  function assignPreviewRuns(el, children) {
    const textEl = getDirectChild(el, "Text");
    if (!textEl) return;
    for (const dt of Array.from(textEl.getElementsByTagName("DefinedTermEn"))) {
      const def = definitions[slugify(textContent(dt))];
      if (def && !def.previewRuns) {
        def.previewRuns = collectPreviewRuns(children);
      }
    }
  }

  function parseRuns(textEl, ctx) {
    const nodes = Array.from(textEl.childNodes);
    const runs = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.nodeType === 3) {
        const nextEl = nodes.slice(i + 1).find((n) => n.nodeType === 1);
        const nextIsActName = nextEl?.tagName === "XRefExternal";
        runs.push(...tokenizeText(node.nodeValue, ctx, nextIsActName));
      } else if (node.nodeType === 1) {
        const tag = node.tagName;
        if (tag === "DefinedTermEn") {
          const term = textContent(node);
          runs.push({
            type: "defterm",
            value: term,
            termId: slugify(term),
            isAnchor: true,
          });
        } else if (tag === "DefinedTermFr") {
          runs.push({ type: "text", value: textContent(node) });
        } else if (tag === "XRefExternal") {
          runs.push({
            type: "xref-external",
            value: textContent(node),
            act: textContent(node),
            link: node.getAttribute("link"),
          });
        } else {
          // Emphasis and any other inline wrapper: flatten to plain text,
          // still eligible for term/xref matching.
          runs.push(...tokenizeText(textContent(node), ctx, false));
        }
      }
    }
    return mergeAdjacentTextRuns(runs);
  }

  function parseBlock(el, ctx) {
    switch (el.tagName) {
      case "Text":
        return { type: "text", runs: parseRuns(el, ctx) };
      case "Subsection": {
        const label = textContent(getDirectChild(el, "Label"));
        const marginalNoteEl = getDirectChild(el, "MarginalNote");
        const kids = getChildElements(el).filter(
          (c) => c.tagName !== "Label" && c.tagName !== "MarginalNote",
        );
        const children = kids.map((k) => parseBlock(k, ctx));
        assignPreviewRuns(el, children);
        return {
          type: "subsection",
          label,
          marginalNote: marginalNoteEl ? textContent(marginalNoteEl) : null,
          children,
        };
      }
      case "Paragraph": {
        // No assignPreviewRuns here — see its comment: a Paragraph is an
        // elaboration/list-item unit, not a definitional one, and can
        // legitimately contain a plain cross-reference mention of another
        // term rather than that term's own definition.
        const label = textContent(getDirectChild(el, "Label"));
        const kids = getChildElements(el).filter((c) => c.tagName !== "Label");
        return {
          type: "paragraph",
          label,
          children: kids.map((k) => parseBlock(k, ctx)),
        };
      }
      case "Subparagraph": {
        const label = textContent(getDirectChild(el, "Label"));
        const kids = getChildElements(el).filter((c) => c.tagName !== "Label");
        return {
          type: "subparagraph",
          label,
          children: kids.map((k) => parseBlock(k, ctx)),
        };
      }
      case "Clause": {
        const label = textContent(getDirectChild(el, "Label"));
        const kids = getChildElements(el).filter((c) => c.tagName !== "Label");
        return {
          type: "clause",
          label,
          children: kids.map((k) => parseBlock(k, ctx)),
        };
      }
      case "Definition": {
        const dtEl = el.getElementsByTagName("DefinedTermEn")[0];
        const term = dtEl ? textContent(dtEl) : null;
        const termId = term ? slugify(term) : null;
        const kids = getChildElements(el);
        const children = kids.map((k) => parseBlock(k, ctx));
        assignPreviewRuns(el, children);
        return { type: "definition", termId, children };
      }
      case "ContinuedSectionSubsection":
      case "ContinuedDefinition": {
        // These continue a Subsection/Definition across an amendment split
        // — same definitional-unit reasoning as their unbroken counterparts
        // above, so they get the same check.
        const kids = getChildElements(el);
        const children = kids.map((k) => parseBlock(k, ctx));
        assignPreviewRuns(el, children);
        return { type: "continued", children };
      }
      case "ContinuedParagraph": {
        // Continues a Paragraph — an elaboration unit, not a definitional
        // one (see the Paragraph case above); no assignPreviewRuns here.
        const kids = getChildElements(el);
        return { type: "continued", children: kids.map((k) => parseBlock(k, ctx)) };
      }
      default:
        return { type: "text", runs: [{ type: "text", value: textContent(el) }] };
    }
  }

  function parseSection(el, partId, divisionId) {
    const label = textContent(getDirectChild(el, "Label"));
    const id = `s${label}`;
    const marginalNoteEl = getDirectChild(el, "MarginalNote");
    const historicalNoteEl = getDirectChild(el, "HistoricalNote");
    let historicalNote = null;
    if (historicalNoteEl) {
      historicalNote = Array.from(
        historicalNoteEl.getElementsByTagName("HistoricalNoteSubItem"),
      )
        .map(textContent)
        .join("; ");
    }

    const outgoingRefs = new Set();
    const ctx = { sectionId: id, outgoingRefs };
    const bodyBlocks = getChildElements(el).filter(
      (c) =>
        c.tagName !== "Label" &&
        c.tagName !== "MarginalNote" &&
        c.tagName !== "HistoricalNote",
    );

    return {
      id,
      number: label,
      marginalNote: marginalNoteEl ? textContent(marginalNoteEl) : null,
      partId,
      divisionId,
      body: bodyBlocks.map((b) => parseBlock(b, ctx)),
      definesTerms: [], // filled after full pass, grouped from `definitions`
      outgoingRefs: [...outgoingRefs],
      historicalNote,
    };
  }

  const parts = [];
  let currentPart = null;
  let currentDivision = null;
  const sections = {};

  function ensurePart() {
    if (!currentPart) {
      currentPart = {
        id: "preliminary",
        label: null,
        title: "Preliminary Provisions",
        divisions: [],
      };
      parts.push(currentPart);
    }
  }

  function ensureDivision() {
    ensurePart();
    if (!currentDivision) {
      currentDivision = {
        id: `${currentPart.id}-main`,
        title: null,
        sectionIds: [],
      };
      currentPart.divisions.push(currentDivision);
    }
  }

  for (const child of bodyChildren) {
    if (child.tagName === "Heading") {
      const level = child.getAttribute("level");
      const label = textContent(getDirectChild(child, "Label"));
      const title = textContent(getDirectChild(child, "TitleText"));
      if (level === "1") {
        currentPart = {
          id: `part-${parts.length + 1}`,
          label: label || null,
          title,
          divisions: [],
        };
        parts.push(currentPart);
        currentDivision = null;
      } else if (level === "2") {
        ensurePart();
        currentDivision = {
          id: `${currentPart.id}-div-${currentPart.divisions.length + 1}`,
          title,
          sectionIds: [],
        };
        currentPart.divisions.push(currentDivision);
      }
    } else if (child.tagName === "Section") {
      ensureDivision();
      const section = parseSection(child, currentPart.id, currentDivision.id);
      sections[section.id] = section;
      currentDivision.sectionIds.push(section.id);
    }
  }

  // group defined terms back onto their owning section
  for (const def of Object.values(definitions)) {
    sections[def.sectionId]?.definesTerms.push(def.id);
  }

  // Last-resort fallback: assignPreviewRuns (above) now catches every term
  // whose anchor tag sits inside a Subsection/Paragraph/Subparagraph/Clause/
  // Definition, which is effectively all real cases. This only still fires
  // for the rare term anchored directly in a bare <Text> with no such
  // wrapper (nothing to narrow the preview to below "the whole section").
  for (const def of Object.values(definitions)) {
    if (!def.previewRuns) {
      def.previewRuns = collectPreviewRuns(sections[def.sectionId]?.body ?? []);
    }
  }

  // cross-reference index, inverted from each section's outgoingRefs
  const crossRefIndex = {};
  for (const id of Object.keys(sections)) {
    crossRefIndex[id] = { outgoing: [], incoming: [] };
  }
  for (const section of Object.values(sections)) {
    for (const target of section.outgoingRefs) {
      if (!crossRefIndex[target]) continue; // guards against stray ids
      crossRefIndex[section.id].outgoing.push(target);
      crossRefIndex[target].incoming.push(section.id);
    }
  }

  const id = consolidatedNumber || code || instrumentNumber.replace(/\//g, "-").replace(/\s+/g, "_");
  const statuteDocument = {
    id,
    jurisdiction: "federal",
    title: shortTitle,
    citation,
    sourceUrl: `https://laws-lois.justice.gc.ca/eng/${isRegulation ? "regulations" : "acts"}/${id}/FullText.html`,
    consolidatedDate,
    tree: parts,
    sections,
    definitions,
    crossRefIndex,
  };

  return { statuteDocument, parts, sections, definitions };
}
