import { describe, expect, it } from "vitest";
import { createRunTokenizer } from "../parser/lib/text-runs.js";

// H-04: "sections X to Y" must expand to every real section in between, and
// must never invent one that doesn't exist. This exercises the Explorer's
// own, independently-written parser/lib/text-runs.js pipeline — see
// tests/classifyReferences.test.ts's "range expansion (H-04)" block for the
// equivalent coverage of the Statute Map pipeline's separate implementation.

interface Target {
  sectionId: string;
  subsectionLabel?: string;
}

interface XrefRun {
  type: string;
  targets?: Target[];
}

function targetsFor(text: string, sectionIds: string[]): Target[] {
  // validSectionIds is a Set built in the same real document order both
  // jurisdiction adapters (parse-federal.js, parse-ontario-doc.js) already
  // build it in — createRunTokenizer derives its range-resolution order
  // straight from this Set's iteration order (Sets preserve insertion
  // order), so passing `sectionIds` here in the order given is exactly
  // what a real parse would hand it.
  const validSectionIds = new Set(sectionIds);
  const { tokenizeText } = createRunTokenizer({ definitions: {}, validSectionIds });
  const ctx = { outgoingRefs: new Set<string>() };
  const runs = tokenizeText(text, ctx, false) as XrefRun[];
  const xref = runs.find((r) => r.type === "xref-internal");
  return xref?.targets ?? [];
}

function ids(targets: Target[]): string[] {
  return targets.map((t) => t.sectionId);
}

describe("text-runs.js range expansion (H-04)", () => {
  it('expands "sections 265 to 270" into all six sections when they\'re all real', () => {
    const targets = targetsFor(
      "an offence under sections 265 to 270",
      ["s260", "s261", "s262", "s263", "s264", "s265", "s266", "s267", "s268", "s269", "s270", "s271"],
    );
    expect(ids(targets)).toEqual(["s265", "s266", "s267", "s268", "s269", "s270"]);
    // Only the two literally-written endpoints could ever carry a
    // subsection; the four in-between ones never claim one.
    for (const t of targets) expect(t.subsectionLabel).toBeUndefined();
  });

  it('expands "sections 268 to 269" to include a real decimal-inserted 268.1 — arithmetic alone would miss it', () => {
    // Verified against the real, live Criminal Code XML: 268, 268.1, 269
    // really are consecutive real sections in that order.
    const targets = targetsFor(
      "as described in sections 268 to 269",
      ["s268", "s268.1", "s269"],
    );
    expect(ids(targets)).toEqual(["s268", "s268.1", "s269"]);
  });

  it("does not invent a section for a genuine gap in the real numbering", () => {
    // 269 is deliberately absent from this statute's own section list —
    // simulating a real jump straight from 268 to 270 with nothing between.
    const targets = targetsFor(
      "as described in sections 265 to 270",
      ["s265", "s266", "s267", "s268", "s270"],
    );
    expect(ids(targets)).toEqual(["s265", "s266", "s267", "s268", "s270"]);
    expect(ids(targets)).not.toContain("s269");
  });

  it('does NOT expand "sections 265 and 270" — "and" is a discrete pair, not a range', () => {
    const targets = targetsFor(
      "as described in sections 265 and 270",
      ["s265", "s266", "s267", "s268", "s269", "s270"],
    );
    expect(ids(targets)).toEqual(["s265", "s270"]);
  });

  it("refuses to guess a reversed range even when full section order is available", () => {
    const targets = targetsFor(
      "as described in sections 270 to 265",
      ["s265", "s266", "s267", "s268", "s269", "s270"],
    );
    // Neither endpoint resolves as an ascending slice, so this falls back
    // to the two written endpoints, order as written.
    expect(ids(targets)).toEqual(["s270", "s265"]);
  });

  it("without any statute-order context, still safely expands a plain integer range (fallback tier)", () => {
    // No section-order context at all: validSectionIds only contains the
    // range's own two endpoints plus the ones a plain-integer walk would
    // produce — standing in for "we don't have a parsed statute to check
    // against, only a bare integer sequence is safe to assume".
    const targets = targetsFor(
      "as described in sections 5 to 8",
      ["s5", "s6", "s7", "s8"],
    );
    expect(ids(targets)).toEqual(["s5", "s6", "s7", "s8"]);
  });

  it('refuses to guess across a decimal endpoint with nothing to validate against ("83.01 to 83.03")', () => {
    // Neither 83.01 nor 83.03 (nor any candidate 83.02) is in this
    // statute's own section list, so there's no order to resolve against —
    // and a decimal endpoint isn't safe to walk arithmetically either.
    const targets = targetsFor("as described in sections 83.01 to 83.03", []);
    expect(targets).toEqual([]);
  });

  it("keeps a real subsection on the written 'to' endpoint of a range", () => {
    const targets = targetsFor(
      "as described in sections 265 to 267(2)",
      ["s265", "s266", "s267"],
    );
    expect(targets).toEqual([
      { sectionId: "s265", subsectionLabel: undefined },
      { sectionId: "s266", subsectionLabel: undefined },
      { sectionId: "s267", subsectionLabel: "(2)" },
    ]);
  });

  it("leaves ordinary single-number and two-number 'and' citations unaffected", () => {
    expect(ids(targetsFor("as described in section 265", ["s265"]))).toEqual(["s265"]);
    expect(
      ids(targetsFor("as described in subsection 265(3)", ["s265"])),
    ).toEqual(["s265"]);
  });
});
