import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseStatuteXml, StatuteParseError } from "../src/statute/parseStatuteXml";
import type { StatuteSection } from "../src/statute/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Real excerpt of the Criminal Code XML (sections 2, 265-268, 718), pulled
// live from https://laws-lois.justice.gc.ca/eng/XML/C-46.xml. The Section
// blocks are byte-for-byte as fetched; the Heading blocks around them were
// reconstructed from the real document's own Part/Heading structure so
// headingPath assertions below reflect the actual Criminal Code layout.
const SAMPLE_XML = readFileSync(path.join(__dirname, "../fixtures/criminal-code-sample.xml"), "utf-8");
const SOURCE_URL = "https://laws-lois.justice.gc.ca/eng/XML/C-46.xml";

function section(sections: StatuteSection[], number: string): StatuteSection {
  const found = sections.find((s) => s.number === number);
  if (!found) throw new Error(`Section ${number} not found in parsed output`);
  return found;
}

describe("parseStatuteXml against real Criminal Code XML", () => {
  const statute = parseStatuteXml(SAMPLE_XML, SOURCE_URL);

  it("parses statute-level metadata", () => {
    expect(statute.code).toBe("C-46");
    expect(statute.shortTitle).toBe("Criminal Code");
    expect(statute.longTitle).toBe("An Act respecting the Criminal Law");
    expect(statute.sourceUrl).toBe(SOURCE_URL);
    expect(statute.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("parses exactly the 6 sample sections, in document order", () => {
    expect(statute.sections.map((s) => s.number)).toEqual(["2", "265", "266", "267", "268", "718"]);
  });

  it("gives every section a stable id of statuteCode:number", () => {
    for (const s of statute.sections) {
      expect(s.id).toBe(`C-46:${s.number}`);
      expect(s.statuteCode).toBe("C-46");
    }
  });

  describe("section 2 (Definitions)", () => {
    const s2 = section(statute.sections, "2");

    it("has the right marginal note and heading path", () => {
      expect(s2.marginalNote).toBe("Definitions");
      // "Short Title" and "Interpretation" are sibling level-1 headings in
      // the real XML (not nested), so only the latter applies to section 2.
      expect(s2.headingPath).toEqual(["Interpretation"]);
    });

    it("flattens nested Definition/Paragraph blocks into readable text", () => {
      expect(s2.text).toContain("In this Act,");
      expect(s2.text).toContain("Act includes");
      expect(s2.text).toContain("(a) an Act of Parliament,");
      expect(s2.text).toContain("(d) an Act or ordinance");
    });

    it("includes definitions added anywhere in the section (e.g. appearance notice)", () => {
      expect(s2.text).toContain("appearance notice");
      expect(s2.text).toContain("means a notice in Form 9 issued by a peace officer");
    });

    it("strips HistoricalNote / amendment citations from the flattened text", () => {
      expect(s2.text).not.toMatch(/R\.S\.,\s*c\./);
    });

    it("normalizes the Unicode EN SPACE Justice Laws uses after DefinedTermEn to a plain space", () => {
      // The raw XML has "DefinedTermEn>Act</DefinedTermEn> includes"
      // (U+2002 EN SPACE, not a regular space) purely for typographic control.
      expect(s2.text).not.toContain(" ");
      expect(s2.text).toContain("Act includes");
    });
  });

  describe("section 265 (Assault)", () => {
    const s265 = section(statute.sections, "265");

    it("has the right marginal note and heading path", () => {
      expect(s265.marginalNote).toBe("Assault");
      expect(s265.headingPath).toEqual(["PART VIII — Offences Against the Person and Reputation", "Assaults"]);
    });

    it("keeps subsection/paragraph numbering inline", () => {
      expect(s265.text).toContain("(1) A person commits an assault when");
      expect(s265.text).toContain("(a) without the consent of another person");
      expect(s265.text).toContain("(b) he attempts or threatens");
      expect(s265.text).toContain("(c) while openly wearing or carrying a weapon");
    });

    it("inlines a nested subsection's own marginal note", () => {
      expect(s265.text).toContain("[Application]");
      expect(s265.text).toContain("This section applies to all forms of assault");
    });
  });

  describe("section 266 (Assault punishment)", () => {
    const s266 = section(statute.sections, "266");

    it("contains the punishment language needed for classifyReferences later", () => {
      expect(s266.text).toContain("Every one who commits an assault is guilty of");
      expect(s266.text).toContain("(a) an indictable offence and is liable to imprisonment for a term not exceeding five years");
    });
  });

  describe("section 267 (Assault with a weapon or causing bodily harm)", () => {
    const s267 = section(statute.sections, "267");

    it("parses correctly", () => {
      expect(s267.marginalNote).toBe("Assault with a weapon or causing bodily harm");
      expect(s267.text).toContain("carries, uses or threatens to use a weapon");
      expect(s267.text).toContain("chokes, suffocates or strangles the complainant");
    });
  });

  describe("section 268 (Aggravated assault)", () => {
    const s268 = section(statute.sections, "268");

    it("parses multiple subsections including one with its own marginal note", () => {
      expect(s268.text).toContain("(1) Every one commits an aggravated assault");
      expect(s268.text).toContain("[Punishment]");
      expect(s268.text).toContain("liable to imprisonment for a term not exceeding fourteen years");
    });
  });

  describe("section 718 (Purpose of sentencing)", () => {
    const s718 = section(statute.sections, "718");

    it("is in a different Part than section 265-268", () => {
      expect(s718.headingPath).toEqual(["PART XXIII — Sentencing", "Purpose and Principles of Sentencing"]);
    });

    it("flattens the purpose list", () => {
      expect(s718.text).toContain("The fundamental purpose of sentencing");
      expect(s718.text).toContain("(a) to denounce unlawful conduct");
      expect(s718.text).toContain("(f) to promote a sense of responsibility in offenders");
    });
  });
});

describe("parseStatuteXml error handling", () => {
  it("throws StatuteParseError on malformed XML", () => {
    expect(() => parseStatuteXml("<Statute><Body>", SOURCE_URL)).toThrow(StatuteParseError);
  });

  it("throws StatuteParseError when root element is not <Statute>", () => {
    expect(() => parseStatuteXml("<NotAStatute></NotAStatute>", SOURCE_URL)).toThrow(StatuteParseError);
  });

  it("throws StatuteParseError when <Body> is missing", () => {
    expect(() =>
      parseStatuteXml(
        `<Statute><Identification><ShortTitle>X</ShortTitle><Chapter><ConsolidatedNumber>X-1</ConsolidatedNumber></Chapter></Identification></Statute>`,
        SOURCE_URL
      )
    ).toThrow(StatuteParseError);
  });
});
