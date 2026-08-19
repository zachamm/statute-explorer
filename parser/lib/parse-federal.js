// Pure parser: federal "LIMS" XML text in, StatuteDocument out (see
// ../../docs/SCHEMA.md). No file I/O or network here — parse.js (CLI) and
// the dev-server import API both wrap this with their own way of getting
// the XML text in the first place.
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
 * @returns {{ statuteDocument: object, parts: object[], sections: object, definitions: object }}
 */
export function parseFederalXml(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const statuteEl = doc.getElementsByTagName("Statute")[0];
  if (!statuteEl) {
    throw new Error("Not a recognized federal Statute XML document.");
  }
  const identificationEl = getDirectChild(statuteEl, "Identification");
  const bodyEl = getDirectChild(statuteEl, "Body");

  const shortTitle = textContent(getDirectChild(identificationEl, "ShortTitle"));
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
  const citation = !annualStatuteEl
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
        return {
          type: "subsection",
          label,
          marginalNote: marginalNoteEl ? textContent(marginalNoteEl) : null,
          children: kids.map((k) => parseBlock(k, ctx)),
        };
      }
      case "Paragraph": {
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
        if (termId && definitions[termId] && !definitions[termId].previewRuns) {
          definitions[termId].previewRuns = collectPreviewRuns(children);
        }
        return { type: "definition", termId, children };
      }
      case "ContinuedSectionSubsection":
      case "ContinuedDefinition":
      case "ContinuedParagraph": {
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

  // fallback preview text for terms defined inline outside a <Definition> block
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

  const statuteDocument = {
    id: consolidatedNumber,
    jurisdiction: "federal",
    title: shortTitle,
    citation,
    sourceUrl: `https://laws-lois.justice.gc.ca/eng/acts/${consolidatedNumber}/FullText.html`,
    consolidatedDate,
    tree: parts,
    sections,
    definitions,
    crossRefIndex,
  };

  return { statuteDocument, parts, sections, definitions };
}
