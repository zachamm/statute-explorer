import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseStatuteXml } from "../src/statute/parseStatuteXml";
import { classifyReferences } from "../src/statute/classifyReferences";
import {
  resolveCrossStatuteReferences,
  resolveCrossStatuteReferencesForStatute,
} from "../src/statute/resolveCrossStatute";
import type { Statute, StatuteSection } from "../src/statute/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_XML = readFileSync(path.join(__dirname, "../fixtures/criminal-code-sample.xml"), "utf-8");
const SOURCE_URL = "https://laws-lois.justice.gc.ca/eng/XML/C-46.xml";

function makeSection(number: string, text: string, statuteCode = "TEST"): StatuteSection {
  return { id: `${statuteCode}:${number}`, statuteCode, number, marginalNote: null, text, headingPath: [] };
}

function makeStatute(sections: StatuteSection[], statuteCode = "TEST"): Statute {
  return {
    code: statuteCode,
    shortTitle: "Test Act",
    longTitle: "An Act for testing resolveCrossStatute",
    sourceUrl: "test://synthetic",
    fetchedAt: new Date().toISOString(),
    sections,
  };
}

// ---------------------------------------------------------------------------
// Section A: against the real, parsed step-1 fixture (section 2's real
// cross-statute mentions, already verified in classifyReferences.test.ts).
// ---------------------------------------------------------------------------

describe("resolveCrossStatuteReferences against real Criminal Code section 2", () => {
  const statute = parseStatuteXml(SAMPLE_XML, SOURCE_URL);
  const section2 = statute.sections.find((s) => s.number === "2")!;
  const { externalStatuteRefs } = classifyReferences(section2);
  const resolved = resolveCrossStatuteReferences(externalStatuteRefs);

  it("resolves 6 real external mentions", () => {
    expect(resolved).toHaveLength(6);
  });

  it('matches "Canada Evidence Act" against the lookup table (it IS in the small table)', () => {
    const hit = resolved.find((r) => r.actName === "Canada Evidence Act");
    expect(hit).toBeDefined();
    expect(hit!.statute?.code).toBe("C-5");
    expect(hit!.targetSectionNumber).toBe("38");
    expect(hit!.anaphoricallyResolved).toBe(false);
  });

  it("leaves real Acts that simply aren't in our small lookup table as statute: null — not an error, just unresolved", () => {
    for (const name of [
      "Director of Public Prosecutions Act",
      "Integrated Cross-border Law Enforcement Operations Act",
      "Immigration and Refugee Protection Act",
      "National Defence Act",
    ]) {
      const hit = resolved.find((r) => r.actName === name);
      expect(hit, `expected a resolved-name entry for "${name}"`).toBeDefined();
      expect(hit!.statute).toBeNull();
      expect(hit!.anaphoricallyResolved).toBe(false);
    }
  });

  it('resolves the anaphoric "of that Act" back to the Integrated Cross-border Law Enforcement Operations Act, the nearest earlier named Act in section 2\'s text', () => {
    const anaphoric = resolved.find((r) => r.anaphoricallyResolved);
    expect(anaphoric).toBeDefined();
    expect(anaphoric!.actName).toBe("Integrated Cross-border Law Enforcement Operations Act");
    expect(anaphoric!.statute).toBeNull(); // that Act isn't in our table either
    expect(anaphoric!.targetSectionNumber).toBe("2");
  });

  it("resolveCrossStatuteReferencesForStatute produces the same 6 results when run over the whole (6-section) fixture", () => {
    // Sections 265-268 and 718 have no external-Act mentions at all, so the
    // whole-statute total should equal section 2's total exactly.
    const all = resolveCrossStatuteReferencesForStatute(statute);
    expect(all).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Section B: constructed sections (real trigger phrasing through the real
// classifier) for cases the real fixture doesn't happen to exercise.
// ---------------------------------------------------------------------------

describe("resolveCrossStatuteReferences mechanics (constructed sections)", () => {
  it('matches a second lookup-table entry too ("Interpretation Act"), proving this isn\'t hardcoded to Canada Evidence Act', () => {
    const s = makeSection("1", "term has the same meaning as in section 35 of the Interpretation Act.");
    const { externalStatuteRefs } = classifyReferences(s);
    const [hit] = resolveCrossStatuteReferences(externalStatuteRefs);
    expect(hit.statute?.code).toBe("I-21");
    expect(hit.targetSectionNumber).toBe("35");
  });

  it("leaves a made-up Act name unresolved rather than guessing", () => {
    const s = makeSection("1", "widget means the thing as defined in section 5 of the Widget Registration Act.");
    const { externalStatuteRefs } = classifyReferences(s);
    const [hit] = resolveCrossStatuteReferences(externalStatuteRefs);
    expect(hit.actName).toBe("Widget Registration Act");
    expect(hit.statute).toBeNull();
  });

  it('resolves TWO separate "of that Act" mentions to the same earlier-named Act, not just the immediately preceding hint', () => {
    const s = makeSection(
      "1",
      "peace officer means a person as defined in section 2 of the Firearms Act, and includes anyone authorized under section 3 of that Act or designated under section 4 of that Act."
    );
    const { externalStatuteRefs } = classifyReferences(s);
    const resolved = resolveCrossStatuteReferences(externalStatuteRefs);

    expect(resolved).toHaveLength(3);
    expect(resolved.map((r) => r.actName)).toEqual(["Firearms Act", "Firearms Act", "Firearms Act"]);
    expect(resolved.map((r) => r.anaphoricallyResolved)).toEqual([false, true, true]);
    expect(resolved.map((r) => r.targetSectionNumber)).toEqual(["2", "3", "4"]);
    expect(resolved.every((r) => r.statute?.code === "F-11.6")).toBe(true);
  });

  it('leaves "of that Act" unresolved (actName: null) when there is no earlier named Act in the section at all', () => {
    const s = makeSection("1", "widget means the thing as defined in section 5 of that Act.");
    const { externalStatuteRefs } = classifyReferences(s);
    const [hit] = resolveCrossStatuteReferences(externalStatuteRefs);

    expect(hit.actName).toBeNull();
    expect(hit.anaphoricallyResolved).toBe(false);
    expect(hit.statute).toBeNull();
    expect(hit.targetSectionNumber).toBe("5");
  });

  it("does not let anaphora leak across sections when resolving a whole statute", () => {
    const statute = makeStatute([
      makeSection("1", "term has the same meaning as in section 2 of the Firearms Act."),
      // Section 2 never names an Act itself — "that Act" here must NOT
      // resolve to the Firearms Act named in a *different* section.
      makeSection("2", "other-term means a thing as defined in section 3 of that Act."),
    ]);
    const all = resolveCrossStatuteReferencesForStatute(statute);
    const crossSectionAnaphor = all.find((r) => r.sourceSectionId === "TEST:2");

    expect(crossSectionAnaphor).toBeDefined();
    expect(crossSectionAnaphor!.actName).toBeNull();
    expect(crossSectionAnaphor!.anaphoricallyResolved).toBe(false);
  });

  it("returns an empty array for a section with no external-Act mentions", () => {
    const s = makeSection("1", "This section applies to all forms of assault.");
    const { externalStatuteRefs } = classifyReferences(s);
    expect(resolveCrossStatuteReferences(externalStatuteRefs)).toEqual([]);
  });
});
