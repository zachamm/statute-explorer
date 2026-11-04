import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseCharterHtml, parseConstitutionDocumentHtml } from "../src/statute/parseStatuteHtml";
import { StatuteParseError } from "../src/statute/parseStatuteXml";
import { classifyReferences } from "../src/statute/classifyReferences";
import type { StatuteSection } from "../src/statute/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The real page, byte-for-byte as fetched from
// https://laws-lois.justice.gc.ca/eng/Const/page-12.html
const CHARTER_HTML = readFileSync(path.join(__dirname, "../fixtures/charter-page-12.html"), "utf-8");
const SOURCE_URL = "https://laws-lois.justice.gc.ca/eng/Const/page-12.html";

function section(sections: StatuteSection[], number: string): StatuteSection {
  const found = sections.find((s) => s.number === number);
  if (!found) throw new Error(`Section ${number} not found in parsed output`);
  return found;
}

describe("parseCharterHtml against the real Justice Laws Charter page", () => {
  const statute = parseCharterHtml(CHARTER_HTML, SOURCE_URL);

  it("parses statute-level metadata", () => {
    expect(statute.code).toBe("CHARTER");
    expect(statute.shortTitle).toBe("Canadian Charter of Rights and Freedoms");
    expect(statute.sourceUrl).toBe(SOURCE_URL);
  });

  it("parses sections 1 through 34 in order (including real section 16.1, added by amendment in 1993), with none of Part II leaking in", () => {
    const numbers = statute.sections.map((s) => s.number);
    const expected = Array.from({ length: 34 }, (_, i) => String(i + 1));
    expected.splice(expected.indexOf("17"), 0, "16.1"); // New Brunswick linguistic communities, s. 16.1
    expect(numbers).toEqual(expected);
    expect(numbers).not.toContain("35"); // first section of PART II — Aboriginal rights
  });

  it("gives every section the Charter's Part heading and a stable id", () => {
    for (const s of statute.sections) {
      expect(s.headingPath[0]).toBe("PART I — Canadian Charter of Rights and Freedoms");
      expect(s.id).toBe(`CHARTER:${s.number}`);
      expect(s.statuteCode).toBe("CHARTER");
    }
  });

  describe("section 1 (a simple, single-paragraph section)", () => {
    const s1 = section(statute.sections, "1");

    it("has the right marginal note, subheading, and text", () => {
      expect(s1.marginalNote).toBe("Rights and freedoms in Canada");
      expect(s1.headingPath).toEqual(["PART I — Canadian Charter of Rights and Freedoms", "Guarantee of Rights and Freedoms"]);
      expect(s1.text).toContain("The Canadian Charter of Rights and Freedoms guarantees the rights and freedoms");
      expect(s1.text).toContain("demonstrably justified in a free and democratic society");
    });

    it("strips the sectionLabel and footnote markup cleanly (no stray '1' or footnote artifacts)", () => {
      expect(s1.text.startsWith("The Canadian Charter")).toBe(true);
    });
  });

  describe("section 6 (Mobility Rights — multiple subsections with lettered sub-paragraphs)", () => {
    const s6 = section(statute.sections, "6");

    it("keeps subsection and paragraph numbering inline", () => {
      expect(s6.marginalNote).toBe("Mobility of citizens");
      expect(s6.headingPath[1]).toBe("Mobility Rights");
      expect(s6.text).toContain("(1) Every citizen of Canada has the right to enter, remain in and leave Canada.");
      expect(s6.text).toContain("(2) Every citizen of Canada and every person who has the status of a permanent resident");
      expect(s6.text).toContain("(a) to move to and take up residence in any province; and");
      expect(s6.text).toContain("(b) to pursue the gaining of a livelihood in any province.");
    });

    it("inlines each subsection's own marginal note", () => {
      expect(s6.text).toContain("[Rights to move and gain livelihood]");
      expect(s6.text).toContain("[Limitation]");
      expect(s6.text).toContain("[Affirmative action programs]");
    });
  });

  describe("section 15 (Equality Rights)", () => {
    const s15 = section(statute.sections, "15");

    it("parses correctly", () => {
      expect(s15.text).toContain("Every individual is equal before and under the law");
      expect(s15.text).toContain("without discrimination");
    });
  });

  describe("section 24 (Enforcement)", () => {
    const s24 = section(statute.sections, "24");

    it("has the Enforcement subheading and both subsections", () => {
      expect(s24.headingPath[1]).toBe("Enforcement");
      expect(s24.text).toContain("(1)");
      expect(s24.text).toContain("a court of competent jurisdiction");
      expect(s24.text).toContain("(2)");
      expect(s24.text).toContain("bring the administration of justice into disrepute");
    });
  });

  describe("section 33 (the notwithstanding clause) — a real internal cross-reference", () => {
    const s33 = section(statute.sections, "33");

    it("parses the real text with its section-number cross-references intact", () => {
      expect(s33.headingPath[1]).toBe("Application of Charter");
      expect(s33.text).toContain("section 2 or sections 7 to 15 of this Charter");
    });

    it("classifyReferences finds the real cross-references in this HTML-sourced text, including the full 7-to-15 range (H-04)", () => {
      const { references, externalStatuteRefs } = classifyReferences(s33);
      const targets = references.map((r) => r.targetSectionNumber).sort((a, b) => Number(a) - Number(b));
      // "sections 7 to 15" is a real range in the real Charter text — every
      // section from 7 through 15 is being cited, not just the two written
      // endpoints. This section has no parent Statute in this test (it's a
      // single HTML-sourced section, not part of a whole parsed statute),
      // so this exercises expandRange's plain-integer fallback rather than
      // order-based resolution — safe here since 7-15 are all bare integers
      // with no decimal insertions in the real Charter.
      expect(targets).toEqual(["2", "7", "8", "9", "10", "11", "12", "13", "14", "15"]);
      // "of this Charter" doesn't match the "of the X Act"/"of that Act"
      // external-statute pattern, so this correctly stays a same-statute
      // reference rather than being (wrongly) flagged as external.
      expect(externalStatuteRefs).toEqual([]);
    });
  });

  describe("section 34 (Citation)", () => {
    const s34 = section(statute.sections, "34");

    it("parses the closing citation section", () => {
      expect(s34.marginalNote).toBe("Citation");
      expect(s34.text).toContain("This Part may be cited as the Canadian Charter of Rights and Freedoms");
    });
  });
});

describe("parseConstitutionDocumentHtml (generic, unfiltered)", () => {
  it("also picks up Part II sections that happen to be on the same page, unfiltered", () => {
    const statute = parseConstitutionDocumentHtml(CHARTER_HTML, SOURCE_URL, {
      code: "CONST1982",
      shortTitle: "Constitution Act, 1982",
      longTitle: "Constitution Act, 1982",
    });
    const s35 = statute.sections.find((s) => s.number === "35");
    expect(s35).toBeDefined();
    expect(s35!.headingPath[0]).toContain("PART II");
  });
});

describe("parseStatuteHtml error handling", () => {
  it("throws StatuteParseError when the content container isn't found", () => {
    expect(() =>
      parseCharterHtml("<html><body>not a Justice Laws page</body></html>", SOURCE_URL)
    ).toThrow(StatuteParseError);
  });
});
