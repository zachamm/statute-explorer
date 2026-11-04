import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseCharterHtml } from "../parser/lib/parse-charter.js";
import type { CharterBlock, CharterSection } from "../parser/lib/parse-charter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The real Justice Laws page for the Constitution Act, 1982, pulled live
// from https://laws-lois.justice.gc.ca/eng/Const/page-12.html — the same
// fixture Statute Map's own tests/parseStatuteHtml.test.ts already uses
// (confirmed byte-identical to a fresh live re-fetch except for the page's
// own "date modified" metadata). Covers the Charter (Part I) plus the
// start of Part II, exactly as the real page does — not trimmed.
const SAMPLE_HTML = readFileSync(path.join(__dirname, "../fixtures/charter-page-12.html"), "utf-8");
const SOURCE_URL = "https://laws-lois.justice.gc.ca/eng/Const/page-12.html";

function section(sections: Record<string, CharterSection>, number: string): CharterSection {
  const found = sections[`s${number}`];
  if (!found) throw new Error(`Section ${number} not found in parsed fixture`);
  return found;
}

/** Flattens a block tree's own runs into plain text, depth-first — for
 *  asserting real section text without hand-writing the full runs shape. */
function flattenText(blocks: CharterBlock[]): string {
  let out = "";
  for (const b of blocks) {
    if (b.runs) out += b.runs.map((r) => r.value ?? "").join("");
    if (b.children) out += flattenText(b.children);
    out += " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

describe("parseCharterHtml against the real Justice Laws Charter page", () => {
  const { statuteDocument } = parseCharterHtml(SAMPLE_HTML, SOURCE_URL);

  it("parses document-level metadata", () => {
    // CHARTER (uppercase) deliberately matches Statute Map's own
    // STATUTE_LOOKUP code for the Charter — both apps' existing
    // cross-linking code (explorerSlugForCode / "View in graph") derives
    // its slug/id from this value, so this is what makes those links work
    // without any change to either app's linking logic.
    expect(statuteDocument.id).toBe("CHARTER");
    expect(statuteDocument.jurisdiction).toBe("federal");
    expect(statuteDocument.title).toBe("Canadian Charter of Rights and Freedoms");
    expect(statuteDocument.citation).toBe("Part I of the Constitution Act, 1982");
    expect(statuteDocument.sourceUrl).toBe(SOURCE_URL);
    expect(statuteDocument.consolidatedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has no defined-term glossary — the Charter doesn't have one", () => {
    expect(statuteDocument.definitions).toEqual({});
  });

  it("includes only Part I (the real Charter) — stops before Part II", () => {
    expect(statuteDocument.tree).toHaveLength(1);
    expect(statuteDocument.tree[0].title).toBe("Canadian Charter of Rights and Freedoms");
    // Section 35 ("Rights of the aboriginal peoples of Canada") is real
    // Part II content on the same page — must never appear here.
    expect(statuteDocument.sections["s35"]).toBeUndefined();
    // The real Charter runs sections 1-34 (plus the inserted 16.1) — 35
    // numbered sections total.
    expect(Object.keys(statuteDocument.sections)).toHaveLength(35);
  });

  it("groups sections into the Charter's real named divisions (headingPath)", () => {
    const divisionTitles = statuteDocument.tree[0].divisions.map((d) => d.title);
    expect(divisionTitles).toContain("Fundamental Freedoms");
    expect(divisionTitles).toContain("Legal Rights");
    expect(divisionTitles).toContain("Equality Rights");
    const s2 = section(statuteDocument.sections, "2");
    const s2Division = statuteDocument.tree[0].divisions.find((d) => d.id === s2.divisionId);
    expect(s2Division?.title).toBe("Fundamental Freedoms");
  });

  describe("section 2 (the section this fix is specifically about)", () => {
    const s2 = section(statuteDocument.sections, "2");

    it("has the real marginal note and lead text", () => {
      expect(s2.marginalNote).toBe("Fundamental freedoms");
      expect(flattenText(s2.body)).toContain("Everyone has the following fundamental freedoms:");
    });

    it("folds the real top-level-sibling <ul.ProvisionList> quirk into this section's own four lettered freedoms, in order", () => {
      // Real markup quirk: section 2's (a)-(d) list is a *sibling* of its
      // <p class="Section">, not nested inside it — confirmed live against
      // https://laws-lois.justice.gc.ca/eng/Const/page-12.html.
      const paragraphs = s2.body.filter((b) => b.type === "paragraph");
      expect(paragraphs.map((p) => p.label)).toEqual(["(a)", "(b)", "(c)", "(d)"]);
      expect(flattenText([paragraphs[0]])).toContain("freedom of conscience and religion");
      expect(flattenText([paragraphs[3]])).toContain("freedom of association");
    });
  });

  describe("section 33 (the notwithstanding clause) — a real range citation", () => {
    const s33 = section(statuteDocument.sections, "33");

    it("parses the real text with its range citation intact", () => {
      expect(flattenText(s33.body)).toContain("section 2 or sections 7 to 15 of this Charter");
    });

    it("expands the real 'sections 7 to 15' range to all nine sections (H-04), not just the two endpoints", () => {
      const targets = [...s33.outgoingRefs].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
      expect(targets).toEqual(["s2", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15"]);
    });

    it("is reflected in the reverse direction too (crossRefIndex incoming)", () => {
      expect(statuteDocument.crossRefIndex["s10"].incoming).toContain("s33");
    });
  });

  describe("section 23 (minority language educational rights) — real nested structure", () => {
    const s23 = section(statuteDocument.sections, "23");

    it("nests nested lettered paragraphs inside subsection (1), with the closing prose still attached to it", () => {
      const sub1 = s23.body.find((b) => b.type === "subsection" && b.label === "(1)");
      expect(sub1).toBeDefined();
      const paragraphLabels = sub1!.children!.filter((c) => c.type === "paragraph").map((c) => c.label);
      expect(paragraphLabels).toEqual(["(a)", "(b)"]);
      // Real markup: prose resumes *after* the lettered list but is still
      // part of subsection (1), not a new block of its own.
      expect(flattenText(sub1!.children!)).toContain("have the right to have their children receive primary and secondary school instruction");
    });

    it("gives each subsection its own real marginal note", () => {
      const sub2 = s23.body.find((b) => b.type === "subsection" && b.label === "(2)");
      const sub3 = s23.body.find((b) => b.type === "subsection" && b.label === "(3)");
      expect(sub2?.marginalNote).toBe("Continuity of language instruction");
      expect(sub3?.marginalNote).toBe("Application where numbers warrant");
    });
  });

  describe("section 16.1 (inserted decimal section) — a real multi-<li> subsection group with its own section-level marginal note", () => {
    const s161 = section(statuteDocument.sections, "16.1");

    it("has the real section-level marginal note (from the preceding sibling, not swallowed by subsection (2)'s own note)", () => {
      expect(s161.marginalNote).toBe("English and French linguistic communities in New Brunswick");
    });

    it("has both real subsections, (2) with its own distinct marginal note", () => {
      const labels = s161.body.map((b) => b.label);
      expect(labels).toEqual(["(1)", "(2)"]);
      const sub2 = s161.body.find((b) => b.label === "(2)");
      expect(sub2?.marginalNote).toBe("Role of the legislature and government of New Brunswick");
    });
  });

  it("skips the real unnumbered preamble ('Whereas Canada is founded...') as prose, not as a section", () => {
    const numbers = Object.values(statuteDocument.sections).map((s) => s.number);
    expect(numbers).not.toContain("");
    // Sanity: the preamble's own text shouldn't have become section 1's
    // marginal note or leaked into any section's body.
    const s1 = section(statuteDocument.sections, "1");
    expect(flattenText(s1.body)).not.toContain("Whereas Canada is founded");
  });
});
