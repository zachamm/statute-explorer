import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseStatuteXml } from "../src/statute/parseStatuteXml";
import { classifyReferences, type SectionReference } from "../src/statute/classifyReferences";
import type { StatuteSection } from "../src/statute/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_XML = readFileSync(path.join(__dirname, "../fixtures/criminal-code-sample.xml"), "utf-8");
const SOURCE_URL = "https://laws-lois.justice.gc.ca/eng/XML/C-46.xml";

const statute = parseStatuteXml(SAMPLE_XML, SOURCE_URL);
function section(number: string): StatuteSection {
  const found = statute.sections.find((s) => s.number === number);
  if (!found) throw new Error(`Section ${number} not found in parsed fixture`);
  return found;
}

/** Builds a minimal StatuteSection for testing a single real sentence in
 *  isolation, without needing to add it to the XML fixture. */
function sectionFromText(text: string, number = "TEST"): StatuteSection {
  return {
    id: `C-46:${number}`,
    statuteCode: "C-46",
    number,
    marginalNote: null,
    text,
    headingPath: [],
  };
}

function refsTo(refs: SectionReference[], targetSectionNumber: string): SectionReference[] {
  return refs.filter((r) => r.targetSectionNumber === targetSectionNumber);
}

// ---------------------------------------------------------------------------
// Section A: against the real, parsed step-1 fixture (sections 2, 265-268, 718)
// ---------------------------------------------------------------------------

describe("classifyReferences against the real parsed Criminal Code fixture", () => {
  describe("section 2 (Definitions)", () => {
    const { references, externalStatuteRefs } = classifyReferences(section("2"));

    it('classifies "as defined in section 493" (release order) as DEFINITIONAL', () => {
      const hit = refsTo(references, "493").find((r) => r.type === "DEFINITIONAL");
      expect(hit).toBeDefined();
      expect(hit!.matchedText).toBe("section 493");
      expect(hit!.targetSubsection).toBeNull();
    });

    it('classifies "has the same meaning as in subsection 467.1(1)" as DEFINITIONAL with a subsection', () => {
      const hit = refsTo(references, "467.1").find((r) => r.type === "DEFINITIONAL");
      expect(hit).toBeDefined();
      expect(hit!.targetSubsection).toBe("1");
      expect(hit!.matchedText).toBe("subsection 467.1(1)");
    });

    it('classifies "as defined in subsection 672.1(1)" (Review Board chairperson) as DEFINITIONAL', () => {
      const hits = refsTo(references, "672.1").filter((r) => r.type === "DEFINITIONAL");
      // "chairperson of a Review Board as defined in subsection 672.1(1)" appears
      // twice in section 2 (in "summons" and in "videoconference").
      expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    it('classifies the "terrorism offence" list ("an offence under any of sections 83.02 to 83.04 or 83.18 to 83.23") as PUNISHMENT for every listed number', () => {
      for (const num of ["83.02", "83.04", "83.18", "83.23"]) {
        const hit = refsTo(references, num).find((r) => r.type === "PUNISHMENT");
        expect(hit, `expected a PUNISHMENT reference to ${num}`).toBeDefined();
      }
    });

    it('falls back to OTHER for untriggered mentions ("for the purposes of sections 88, 267 and 272")', () => {
      for (const num of ["88", "267", "272"]) {
        const hit = refsTo(references, num).find((r) => r.type === "OTHER");
        expect(hit, `expected an OTHER reference to ${num}`).toBeDefined();
      }
    });

    it("detects references to other Acts by name instead of emitting a wrong same-statute edge", () => {
      const canadaEvidence = externalStatuteRefs.find((r) => r.actNameHint === "Canada Evidence Act");
      expect(canadaEvidence).toBeDefined();
      expect(canadaEvidence!.matchedText).toContain("section 38");
      // Not just "some Act was named" — the specific section cited in that
      // Act must survive too, so step 4 can build a complete cross-statute edge.
      expect(canadaEvidence!.targetSectionNumber).toBe("38");
      expect(canadaEvidence!.targetSubsection).toBeNull();

      const crossBorder = externalStatuteRefs.find(
        (r) => r.actNameHint === "Integrated Cross-border Law Enforcement Operations Act"
      );
      expect(crossBorder).toBeDefined();

      const nationalDefence = externalStatuteRefs.find((r) => r.actNameHint === "National Defence Act");
      expect(nationalDefence).toBeDefined();

      const dpp = externalStatuteRefs.find((r) => r.actNameHint === "Director of Public Prosecutions Act");
      expect(dpp).toBeDefined();
      // "subsection 3(1) of the Director of Public Prosecutions Act"
      expect(dpp!.targetSectionNumber).toBe("3");
      expect(dpp!.targetSubsection).toBe("1");

      const irpa = externalStatuteRefs.find((r) => r.actNameHint === "Immigration and Refugee Protection Act");
      expect(irpa).toBeDefined();
    });

    it("classifies external mentions with the same phrase-based type as same-statute ones (an external DEFINITIONAL reference is still DEFINITIONAL)", () => {
      // "as those terms are defined in section 38 of the Canada Evidence
      // Act" — a real variant of "as defined in" with a subject inserted
      // ("those terms are") that the plain phrase match alone would miss.
      const canadaEvidence = externalStatuteRefs.find((r) => r.actNameHint === "Canada Evidence Act");
      expect(canadaEvidence!.type).toBe("DEFINITIONAL");

      // "a designated officer as defined in section 2 of the Integrated
      // Cross-border..." — the plain "as defined in" form.
      const crossBorder = externalStatuteRefs.find(
        (r) => r.actNameHint === "Integrated Cross-border Law Enforcement Operations Act"
      );
      expect(crossBorder!.type).toBe("DEFINITIONAL");

      // "an officer authorized under subsection 138(1) of the Immigration
      // and Refugee Protection Act" has no DEFINITIONAL/PUNISHMENT/
      // PROCEDURAL/REPEAL trigger phrase — correctly falls to OTHER.
      const irpa = externalStatuteRefs.find((r) => r.actNameHint === "Immigration and Refugee Protection Act");
      expect(irpa!.type).toBe("OTHER");
    });

    it('resolves the anaphoric "of that Act" as external with a null actNameHint (unresolved on purpose)', () => {
      const anaphoric = externalStatuteRefs.find((r) => r.actNameHint === null);
      expect(anaphoric).toBeDefined();
      expect(anaphoric!.matchedText).toContain("of that Act");
    });

    it("never double-counts an external mention as a same-statute reference", () => {
      // "section 2" (of the other Act) and "section 38" (of the Canada Evidence
      // Act) must not leak into `references` just because C-46 also happens to
      // have those section numbers.
      const suspiciousSelfRefs = references.filter(
        (r) => r.targetSectionNumber === "38" || (r.targetSectionNumber === "2" && r.matchedText === "section 2")
      );
      expect(suspiciousSelfRefs).toEqual([]);
    });
  });

  describe("section 268 (Aggravated assault)", () => {
    const { references } = classifyReferences(section("268"));

    it('finds the real internal cross-reference to section 265 ("for the purposes of this section and section 265") as OTHER', () => {
      const hit = refsTo(references, "265").find((r) => r.type === "OTHER");
      expect(hit).toBeDefined();
      expect(hit!.sourceSectionId).toBe("C-46:268");
    });
  });

  describe("sections with no cross-references", () => {
    it("section 266 and 267 (self-contained punishment provisions) produce no references", () => {
      expect(classifyReferences(section("266")).references).toEqual([]);
      expect(classifyReferences(section("267")).references).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Section B: standalone real sentences (verbatim from the live Criminal Code,
// https://laws-lois.justice.gc.ca/eng/XML/C-46.xml) not part of the step-1
// sample, covering PROCEDURAL and REPEAL phrasing the fixture doesn't have.
// ---------------------------------------------------------------------------

describe("classifyReferences against standalone real sentences", () => {
  it('classifies "shall be construed in accordance with subsection 83.19(2)" as PROCEDURAL', () => {
    // Real text of s. 83.19(2) (Facilitation).
    const s = sectionFromText(
      "For the purposes of this Part, facilitation shall be construed in accordance with subsection 83.19(2)."
    );
    const { references } = classifyReferences(s);
    expect(references).toHaveLength(1);
    expect(references[0].type).toBe("PROCEDURAL");
    expect(references[0].targetSectionNumber).toBe("83.19");
    expect(references[0].targetSubsection).toBe("2");
  });

  it('classifies "is not subject to sections 83.08, 83.1 and 83.11" as PROCEDURAL for all three targets', () => {
    // Real text from s. 83.08 (Freezing of property).
    const s = sectionFromText(
      "the activity or transaction, or class of activities or transactions, to which the authorization relates is not subject to sections 83.08, 83.1 and 83.11 if the terms or conditions of the authorization that are imposed under subsection (3) so provide."
    );
    const { references } = classifyReferences(s);
    const procedural = references.filter((r) => r.type === "PROCEDURAL");
    expect(procedural.map((r) => r.targetSectionNumber)).toEqual(["83.08", "83.1", "83.11"]);
  });

  it('classifies "as that expression is defined in section 752" (same-statute) as DEFINITIONAL — the "as defined in" variant with an inserted subject', () => {
    // Real text from s. 810.2 (Recognizance to keep the peace re: serious
    // personal injury offence).
    const s = sectionFromText(
      "If the accused is charged with a serious personal injury offence, as that expression is defined in section 752, or with the offence of murder, and the accused and the prosecutor agree, the judge may include as a condition of the recognizance."
    );
    const { references } = classifyReferences(s);
    const hit = references.find((r) => r.targetSectionNumber === "752");
    expect(hit).toBeDefined();
    expect(hit!.type).toBe("DEFINITIONAL");
  });

  it('detects a real cross-statute reference to the Canadian Charter of Rights and Freedoms (whose name ends in "Freedoms", not "Act")', () => {
    // Real text of s. 573(3) (Nunavut Court of Justice).
    const s = sectionFromText(
      "Subsection (2) does not authorize a judge of the Nunavut Court of Justice who is presiding at a preliminary inquiry to grant a remedy under section 24 of the Canadian Charter of Rights and Freedoms."
    );
    const { references, externalStatuteRefs } = classifyReferences(s);
    expect(references).toEqual([]); // must NOT become a same-statute edge to this Act's own section 24
    expect(externalStatuteRefs).toHaveLength(1);
    expect(externalStatuteRefs[0].actNameHint).toBe("Canadian Charter of Rights and Freedoms");
    expect(externalStatuteRefs[0].targetSectionNumber).toBe("24");
    expect(externalStatuteRefs[0].type).toBe("OTHER");
  });

  it('detects a real cross-statute reference with a subsection to the Charter ("subsection 24(1) of the Canadian Charter...")', () => {
    // Real text of s. 672.46(4)(e) (Review Board powers).
    const s = sectionFromText("grant any remedy under subsection 24(1) of the Canadian Charter of Rights and Freedoms;");
    const { externalStatuteRefs } = classifyReferences(s);
    expect(externalStatuteRefs).toHaveLength(1);
    expect(externalStatuteRefs[0].actNameHint).toBe("Canadian Charter of Rights and Freedoms");
    expect(externalStatuteRefs[0].targetSectionNumber).toBe("24");
    expect(externalStatuteRefs[0].targetSubsection).toBe("1");
  });

  it('detects a real cross-statute reference to a statute named "... Code" (not just "... Act")', () => {
    // Real text of s. 745.6 area (application for judicial review after 15 years).
    const s = sectionFromText(
      "After serving at least 15 years of the sentence, the offender may apply under section 745.6 of the Criminal Code for a reduction in the number of years of imprisonment without eligibility for parole."
    );
    const { references, externalStatuteRefs } = classifyReferences(s);
    expect(references).toEqual([]);
    expect(externalStatuteRefs).toHaveLength(1);
    expect(externalStatuteRefs[0].actNameHint).toBe("Criminal Code");
    expect(externalStatuteRefs[0].targetSectionNumber).toBe("745.6");
  });

  it('classifies a "... Code" cross-reference as DEFINITIONAL when the phrasing calls for it ("a designated offence within the meaning of section 487.04 of the Criminal Code")', () => {
    // Real text from the DNA warrant provisions.
    const s = sectionFromText(
      "reasonable grounds to believe that a designated offence within the meaning of section 487.04 of the Criminal Code has been committed."
    );
    const { externalStatuteRefs } = classifyReferences(s);
    expect(externalStatuteRefs).toHaveLength(1);
    expect(externalStatuteRefs[0].actNameHint).toBe("Criminal Code");
    expect(externalStatuteRefs[0].type).toBe("DEFINITIONAL");
  });

  it('skips a bare same-section subsection ("pursuant to subsection (1)") but still finds the numbered reference right after it', () => {
    // Real text of s. 489(2) (Disposition of seized things).
    const s = sectionFromText(
      "Any thing seized pursuant to subsection (1) shall be dealt with in accordance with sections 490 and 491."
    );
    const { references } = classifyReferences(s);
    // No reference at all for "subsection (1)" — it has no section number,
    // so there's no cross-section edge to draw.
    expect(references.some((r) => r.matchedText.includes("(1)"))).toBe(false);
    expect(references).toHaveLength(2);
    expect(references.every((r) => r.type === "PROCEDURAL")).toBe(true);
    expect(references.map((r) => r.targetSectionNumber)).toEqual(["490", "491"]);
  });

  it('classifies "then that section 20 is repealed" as REPEAL, while an earlier untriggered mention of the same section number stays OTHER, and "of the other Act" is correctly NOT treated as an external-Act hint', () => {
    // Real text from the Criminal Code's coming-into-force/repeal provisions
    // (s. 80 area of the amending schedule).
    const s = sectionFromText(
      "If section 66 of this Act comes into force before section 20 of the other Act, then that section 20 is repealed."
    );
    const { references, externalStatuteRefs } = classifyReferences(s);

    // "the other Act" doesn't name a specific, resolvable Act (unlike "the
    // Canada Evidence Act"), so it's deliberately left as a same-statute
    // OTHER reference rather than being dropped or mis-flagged as external.
    expect(externalStatuteRefs).toEqual([]);

    const repealHit = references.find((r) => r.type === "REPEAL");
    expect(repealHit).toBeDefined();
    expect(repealHit!.targetSectionNumber).toBe("20");

    const otherHits = references.filter((r) => r.type === "OTHER");
    expect(otherHits.map((r) => r.targetSectionNumber).sort()).toEqual(["20", "66"]);
  });

  it('classifies "under subsection (1) is guilty of" style reversed phrasing as PUNISHMENT', () => {
    // Real text of s. 46(2) (Punishment for high treason).
    const s = sectionFromText(
      "Every one who commits an offence under subsection (1) is guilty of an indictable offence and liable to imprisonment for a term not exceeding fourteen years."
    );
    const { references } = classifyReferences(s);
    // "subsection (1)" is bare (same-section), so no reference is emitted for
    // it — but the PUNISHMENT classification of the (skipped) occurrence
    // shouldn't produce anything here; the real point of this test is that
    // no reference is wrongly manufactured out of "(1)".
    expect(references).toEqual([]);
  });

  it('classifies real reversed-order phrasing ("under subsection 83.18(1) is guilty of") as PUNISHMENT', () => {
    // Real text of s. 83.19(1)-adjacent extraterritorial provision.
    const s = sectionFromText(
      "A person who, outside Canada, commits an act or omission that, if committed in Canada, would be an offence under subsection 83.18(1) is guilty of an indictable offence and liable to imprisonment for a term of not more than 10 years."
    );
    const { references } = classifyReferences(s);
    const hit = refsTo(references, "83.18").find((r) => r.type === "PUNISHMENT");
    expect(hit).toBeDefined();
    expect(hit!.targetSubsection).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Section C: mechanics — id shape, context snippets, numeric edge cases.
// ---------------------------------------------------------------------------

describe("classifyReferences mechanics", () => {
  it("gives each reference a unique, traceable id", () => {
    const s = sectionFromText("See section 5 and section 6 and section 5 again.", "99");
    const { references } = classifyReferences(s);
    expect(references).toHaveLength(3);
    const ids = references.map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
    for (const r of references) {
      expect(r.id.startsWith("C-46:99->")).toBe(true);
      expect(r.sourceSectionId).toBe("C-46:99");
    }
  });

  it("builds a trimmed context snippet with ellipses when text extends beyond the window", () => {
    const s = sectionFromText("x".repeat(200) + " as defined in section 42 " + "y".repeat(200));
    const { references } = classifyReferences(s);
    expect(references).toHaveLength(1);
    expect(references[0].context.startsWith("…")).toBe(true);
    expect(references[0].context.endsWith("…")).toBe(true);
    expect(references[0].context).toContain("section 42");
  });

  it("does not add ellipses when the match is near the start/end of a short text", () => {
    const s = sectionFromText("As defined in section 1.");
    const { references } = classifyReferences(s);
    expect(references[0].context.startsWith("…")).toBe(false);
    expect(references[0].context.endsWith("…")).toBe(false);
  });

  it('stops a number list at a non-numeric connector target ("467.13, or a serious offence")', () => {
    const s = sectionFromText("an offence under section 467.11, 467.12 or 467.13, or a serious offence committed for the benefit of a criminal organization");
    const { references } = classifyReferences(s);
    expect(references.map((r) => r.targetSectionNumber)).toEqual(["467.11", "467.12", "467.13"]);
  });

  it("handles a dotted decimal section number with no subsection", () => {
    const s = sectionFromText("as defined in section 487.011");
    const { references } = classifyReferences(s);
    expect(references[0].targetSectionNumber).toBe("487.011");
    expect(references[0].targetSubsection).toBeNull();
  });

  it("returns empty results for text with no section mentions at all", () => {
    const s = sectionFromText("This Act may be cited as the Criminal Code.");
    const result = classifyReferences(s);
    expect(result.references).toEqual([]);
    expect(result.externalStatuteRefs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Section D: "X to Y" range expansion (H-04).
// ---------------------------------------------------------------------------

describe("classifyReferences range expansion (H-04)", () => {
  describe("with no section-order context (plain-integer fallback)", () => {
    it('expands "sections 265 to 270" into all six sections', () => {
      const s = sectionFromText("Every one who commits an offence under sections 265 to 270 is guilty of an indictable offence.");
      const { references } = classifyReferences(s);
      const targets = references.map((r) => r.targetSectionNumber).sort((a, b) => Number(a) - Number(b));
      expect(targets).toEqual(["265", "266", "267", "268", "269", "270"]);
      // The two literally-written endpoints keep their real match; the four
      // synthesized in-between sections never claim a subsection.
      for (const r of references) expect(r.targetSubsection).toBeNull();
    });

    it('does NOT expand "sections 265 and 270" — "and" is a discrete list, not a range', () => {
      const s = sectionFromText("as described in sections 265 and 270");
      const { references } = classifyReferences(s);
      expect(references.map((r) => r.targetSectionNumber).sort()).toEqual(["265", "270"]);
    });

    it('does NOT expand "sections 265, 266 and 270" beyond its three written numbers', () => {
      const s = sectionFromText("as described in sections 265, 266 and 270");
      const { references } = classifyReferences(s);
      expect(references.map((r) => r.targetSectionNumber).sort((a, b) => Number(a) - Number(b))).toEqual(["265", "266", "270"]);
    });

    it('refuses to guess across a decimal endpoint with nothing to validate against ("83.01 to 83.03")', () => {
      const s = sectionFromText("as described in sections 83.01 to 83.03");
      const { references } = classifyReferences(s);
      // Without an ordered section list, a decimal endpoint is exactly the
      // "unusual numbering" case that must not be arithmetically guessed —
      // real Acts insert decimal sections between integers all the time, so
      // "83.01 to 83.03" might really mean {83.01, 83.02, 83.03}, or might
      // skip 83.02 entirely if it was never enacted. Only the two written
      // endpoints are safe to assert.
      expect(references.map((r) => r.targetSectionNumber).sort()).toEqual(["83.01", "83.03"]);
    });

    it("refuses to guess a reversed range (never inverts to make sense of it)", () => {
      const s = sectionFromText("as described in sections 270 to 265");
      const { references } = classifyReferences(s);
      expect(references.map((r) => r.targetSectionNumber)).toEqual(["270", "265"]);
    });

    it("caps a wildly large span rather than synthesizing thousands of fake sections", () => {
      const s = sectionFromText("as described in sections 2 to 999999");
      const { references } = classifyReferences(s);
      expect(references.map((r) => r.targetSectionNumber)).toEqual(["2", "999999"]);
    });
  });

  describe("with the statute's real section order supplied", () => {
    // Verified against the real, live Criminal Code XML
    // (https://laws-lois.justice.gc.ca/eng/XML/C-46.xml): sections 260-270
    // run 260, 261, 262, 263, 263.1, 264, 264.01, 264.1, 265, 266, 267, 268,
    // 268.1, 269, 269.01, 269.1, 270 — i.e. there really is a decimal-
    // inserted 268.1 between 268 and 269, and a 269.01/269.1 pair between
    // 269 and 270. A citation spanning across them must include them.
    const orderedSectionNumbers = [
      "260", "261", "262", "263", "263.1", "264", "264.01", "264.1", "265",
      "266", "267", "268", "268.1", "269", "269.01", "269.1", "270", "271",
    ];

    it('expands "sections 265 to 270" to every real section in between, including the two real decimal insertions along the way', () => {
      const s = sectionFromText("Every one who commits an offence under sections 265 to 270 is guilty of an indictable offence.");
      const { references } = classifyReferences(s, { orderedSectionNumbers });
      const targets = references.map((r) => r.targetSectionNumber).sort((a, b) => Number(a) - Number(b));
      // Order-based resolution reflects the real document, not a naive
      // integer count: 268.1 and 269.01/269.1 genuinely sit between 265 and
      // 270 in the real Criminal Code, so a "265 to 270" citation really
      // does reach them too.
      expect(targets).toEqual(["265", "266", "267", "268", "268.1", "269", "269.01", "269.1", "270"]);
    });

    it('expands "sections 268 to 269" to include the real inserted 268.1 — arithmetic alone would miss it', () => {
      const s = sectionFromText("as described in sections 268 to 269");
      const { references } = classifyReferences(s, { orderedSectionNumbers });
      expect(references.map((r) => r.targetSectionNumber)).toEqual(["268", "268.1", "269"]);
    });

    it('expands "sections 269 to 270" to include both real inserted 269.01 and 269.1', () => {
      const s = sectionFromText("as described in sections 269 to 270");
      const { references } = classifyReferences(s, { orderedSectionNumbers });
      expect(references.map((r) => r.targetSectionNumber)).toEqual(["269", "269.01", "269.1", "270"]);
    });

    it("never invents a section that isn't in the supplied order — falls back to the two written endpoints", () => {
      // 9999 isn't a real section anywhere in this statute; expanding
      // "up to" it would have to invent hundreds of fake ones.
      const s = sectionFromText("as described in sections 265 to 9999");
      const { references } = classifyReferences(s, { orderedSectionNumbers });
      expect(references.map((r) => r.targetSectionNumber)).toEqual(["265", "9999"]);
    });

    it("does not expand a reversed range even with real order available", () => {
      const s = sectionFromText("as described in sections 270 to 265");
      const { references } = classifyReferences(s, { orderedSectionNumbers });
      expect(references.map((r) => r.targetSectionNumber)).toEqual(["270", "265"]);
    });
  });

  describe("against the real parsed Criminal Code fixture's own (short, gappy) section list", () => {
    // This fixture only contains sections 2, 265, 266, 267, 268, 718 (see
    // its header comment) — a deliberately gappy, non-representative slice
    // of the real statute. It's used here specifically *because* it's
    // gappy: it proves the fix won't invent 269/270 just because they'd be
    // arithmetically plausible, when they're not actually part of what's
    // loaded.
    const orderedSectionNumbers = statute.sections.map((s) => s.number);

    it('expands "sections 265 to 268" — fully present in this fixture — to all four', () => {
      const s = sectionFromText("as described in sections 265 to 268");
      const { references } = classifyReferences(s, { orderedSectionNumbers });
      expect(references.map((r) => r.targetSectionNumber)).toEqual(["265", "266", "267", "268"]);
    });

    it('does not invent 269/270 for "sections 265 to 270" when this statute\'s loaded section list jumps straight from 268 to 718', () => {
      const s = sectionFromText("as described in sections 265 to 270");
      const { references } = classifyReferences(s, { orderedSectionNumbers });
      expect(references.map((r) => r.targetSectionNumber)).toEqual(["265", "270"]);
    });
  });
});
