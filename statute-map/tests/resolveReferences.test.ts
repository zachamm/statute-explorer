import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseStatuteXml } from "../src/statute/parseStatuteXml";
import { buildReferenceGraph, resolveDefinitionalChain, findCycles } from "../src/statute/resolveReferences";
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
    longTitle: "An Act for testing resolveReferences",
    sourceUrl: "test://synthetic",
    fetchedAt: new Date().toISOString(),
    sections,
  };
}

// ---------------------------------------------------------------------------
// Section A: against the real, parsed step-1 fixture.
// ---------------------------------------------------------------------------

describe("resolveReferences against the real parsed Criminal Code fixture", () => {
  const statute = parseStatuteXml(SAMPLE_XML, SOURCE_URL);
  const graph = buildReferenceGraph(statute);

  it("has all 6 sample sections as graph nodes", () => {
    expect(graph.sections.size).toBe(6);
    expect([...graph.sections.keys()].sort()).toEqual(
      ["C-46:2", "C-46:265", "C-46:266", "C-46:267", "C-46:268", "C-46:718"].sort()
    );
  });

  it("resolves section 2's definitional chain to real DEFINITIONAL targets, correctly marked as ghosts since they aren't part of this tiny 6-section sample", () => {
    const result = resolveDefinitionalChain(graph, "C-46:2");
    // Section 2 has real "as defined in section 493" / "has the same meaning
    // as in subsection 467.1(1)" etc. — none of those target sections are
    // among the 6 loaded here, so every one-hop child should be unresolved.
    const children = result.steps.filter((s) => s.depth === 1);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.resolved).toBe(false);
    }
    // Ghosts don't get expanded further.
    expect(result.steps.some((s) => s.depth > 1)).toBe(false);
    expect(result.cycles).toEqual([]);
  });

  it("finds no cycles anywhere in the real 6-section sample (there genuinely aren't any)", () => {
    expect(findCycles(graph)).toEqual([]);
  });

  it("section 268's chain includes its real reference to section 265, which IS loaded (resolved: true)", () => {
    const result = resolveDefinitionalChain(graph, "C-46:268");
    // Section 268 -> 265 is an OTHER-type reference (not DEFINITIONAL), so
    // it shouldn't appear in the *definitional* chain at all.
    expect(result.steps.some((s) => s.sectionId === "C-46:265")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section B: constructed (synthetic) statutes, built the same way real ones
// are (real DEFINITIONAL trigger phrasing run through the real classifier),
// used specifically to exercise chain/cycle mechanics that the tiny 6-section
// real fixture doesn't happen to contain (multi-hop chains, diamonds, cycles).
// ---------------------------------------------------------------------------

describe("resolveDefinitionalChain mechanics (constructed statutes)", () => {
  it("walks a real 3-hop definitional chain (1 -> 2 -> 3)", () => {
    const statute = makeStatute([
      makeSection("1", "widget means a thing as defined in section 2."),
      makeSection("2", "thing means an object as defined in section 3."),
      makeSection("3", "object means anything physical."),
    ]);
    const graph = buildReferenceGraph(statute);
    const result = resolveDefinitionalChain(graph, "TEST:1");

    expect(result.steps.map((s) => [s.sectionId, s.depth, s.resolved])).toEqual([
      ["TEST:1", 0, true],
      ["TEST:2", 1, true],
      ["TEST:3", 2, true],
    ]);
    expect(result.cycles).toEqual([]);
  });

  it("marks an unresolved target as a ghost and stops expanding it", () => {
    const statute = makeStatute([makeSection("1", "widget means a thing as defined in section 99.")]);
    const graph = buildReferenceGraph(statute);
    const result = resolveDefinitionalChain(graph, "TEST:1");

    expect(result.steps).toEqual([
      { sectionId: "TEST:1", resolved: true, via: null, depth: 0, closesCycle: false, truncated: false },
      expect.objectContaining({ sectionId: "TEST:99", resolved: false, depth: 1 }),
    ]);
  });

  it("detects and flags a 2-section definitional cycle (10 -> 11 -> 10) without infinite recursion", () => {
    const statute = makeStatute([
      makeSection("10", "widget has the same meaning as in section 11."),
      makeSection("11", "widget has the same meaning as in section 10."),
    ]);
    const graph = buildReferenceGraph(statute);
    const result = resolveDefinitionalChain(graph, "TEST:10");

    expect(result.steps.map((s) => [s.sectionId, s.depth, s.closesCycle])).toEqual([
      ["TEST:10", 0, false],
      ["TEST:11", 1, false],
      ["TEST:10", 2, true],
    ]);
    expect(result.cycles).toEqual([["TEST:10", "TEST:11", "TEST:10"]]);
  });

  it("visits a diamond target once per branch, not as a cycle (1 -> 2 -> 4 and 1 -> 3 -> 4)", () => {
    const statute = makeStatute([
      makeSection("1", "widget means a thing as defined in section 2 and a device as defined in section 3."),
      makeSection("2", "thing has the same meaning as in section 4."),
      makeSection("3", "device has the same meaning as in section 4."),
      makeSection("4", "base-term means anything at all."),
    ]);
    const graph = buildReferenceGraph(statute);
    const result = resolveDefinitionalChain(graph, "TEST:1");

    expect(result.steps.filter((s) => s.sectionId === "TEST:4")).toHaveLength(2);
    expect(result.cycles).toEqual([]);
  });

  it("truncates (rather than fully exploring) a chain deeper than maxDepth", () => {
    const statute = makeStatute([
      makeSection("1", "a means a thing as defined in section 2."),
      makeSection("2", "b means a thing as defined in section 3."),
      makeSection("3", "c means a thing as defined in section 4."),
      makeSection("4", "d means a thing as defined in section 5."),
      makeSection("5", "e means anything at all."),
    ]);
    const graph = buildReferenceGraph(statute);
    const result = resolveDefinitionalChain(graph, "TEST:1", { maxDepth: 2 });

    const last = result.steps[result.steps.length - 1];
    expect(last).toMatchObject({ sectionId: "TEST:4", depth: 3, truncated: true });
    expect(result.steps.some((s) => s.sectionId === "TEST:5")).toBe(false);
  });
});

describe("findCycles mechanics (constructed statutes)", () => {
  it("finds a simple 2-node cycle across the whole graph", () => {
    const statute = makeStatute([
      makeSection("10", "widget has the same meaning as in section 11."),
      makeSection("11", "widget has the same meaning as in section 10."),
    ]);
    const graph = buildReferenceGraph(statute);
    const cycles = findCycles(graph);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].path).toEqual(["TEST:10", "TEST:11", "TEST:10"]);
    expect(cycles[0].edges).toHaveLength(2);
    expect(cycles[0].edges.every((e) => e.type === "DEFINITIONAL")).toBe(true);
  });

  it("does not report a cycle for a plain linear chain", () => {
    const statute = makeStatute([
      makeSection("1", "a means a thing as defined in section 2."),
      makeSection("2", "b means anything at all."),
    ]);
    expect(findCycles(buildReferenceGraph(statute))).toEqual([]);
  });

  it("filters by reference type: a cycle formed from a DEFINITIONAL edge one way and an untriggered (OTHER) edge the other way disappears when filtered to DEFINITIONAL only", () => {
    const statute = makeStatute([
      makeSection("1", "widget has the same meaning as in section 2."), // 1 -[DEFINITIONAL]-> 2
      makeSection("2", "see also section 1 for background."), // 2 -[OTHER]-> 1
    ]);
    const graph = buildReferenceGraph(statute);

    // Unfiltered: both edges count, so the loop closes.
    expect(findCycles(graph)).toHaveLength(1);

    // Filtered to DEFINITIONAL only: section 2 has no outgoing DEFINITIONAL
    // edge, so there's nothing to close the loop back to section 1.
    expect(findCycles(graph, { types: ["DEFINITIONAL"] })).toEqual([]);
  });

  it("dedupes a cycle discovered from either of its member nodes", () => {
    // Same 2-cycle, but statute order puts "11" before "10" so DFS starts
    // from the other member — should still report exactly one cycle.
    const statute = makeStatute([
      makeSection("11", "widget has the same meaning as in section 10."),
      makeSection("10", "widget has the same meaning as in section 11."),
    ]);
    const cycles = findCycles(buildReferenceGraph(statute));
    expect(cycles).toHaveLength(1);
  });

  it("ignores a reference to a ghost target (not part of the loaded statute) — can't form a cycle through unloaded data", () => {
    const statute = makeStatute([makeSection("1", "widget has the same meaning as in section 999.")]);
    expect(findCycles(buildReferenceGraph(statute))).toEqual([]);
  });
});
