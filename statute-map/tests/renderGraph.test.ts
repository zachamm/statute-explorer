import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseStatuteXml } from "../src/statute/parseStatuteXml";
import { buildGraphModel } from "../src/graph/model";
import {
  buildSimulation,
  computeClusterTargets,
  computeLineEndpoint,
  computeNodeRadii,
  minRadiusForLabel,
  partClusterKey,
  REFERENCE_TYPE_COLORS,
  REFERENCE_TYPE_DASH,
  statuteClusterKey,
  subClusterKey,
} from "../src/graph/renderGraph";
import type { GhostGraphNode, SectionGraphNode } from "../src/graph/model";
import type { Statute, StatuteSection } from "../src/statute/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_XML = readFileSync(path.join(__dirname, "../fixtures/criminal-code-sample.xml"), "utf-8");
const SOURCE_URL = "https://laws-lois.justice.gc.ca/eng/XML/C-46.xml";

function makeSection(
  number: string,
  headingPath: string[],
  statuteCode = "TEST",
  text = "placeholder"
): SectionGraphNode {
  return { kind: "section", id: `${statuteCode}:${number}`, statuteCode, number, marginalNote: null, text, headingPath };
}

function makeGhost(id: string, statuteCode: string | null, number: string | null = null): GhostGraphNode {
  return { kind: "ghost", id, statuteCode, statuteName: statuteCode, number };
}

function dist(a: { x?: number; y?: number }, b: { x?: number; y?: number }): number {
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
}

// ---------------------------------------------------------------------------
// Pure clustering-key functions
// ---------------------------------------------------------------------------

describe("statuteClusterKey / partClusterKey / subClusterKey", () => {
  it("keys a section node by its statute code and top-level heading", () => {
    const s = makeSection("1", ["PART I — Foo", "Sub Heading"], "C-46");
    expect(statuteClusterKey(s)).toBe("C-46");
    expect(partClusterKey(s)).toBe("PART I — Foo");
  });

  it("keys a resolved ghost by its known statute code, with no Part (no text to derive one from)", () => {
    const g = makeGhost("C-5:38", "C-5");
    expect(statuteClusterKey(g)).toBe("C-5");
    expect(partClusterKey(g)).toBeNull();
  });

  it("keys an unresolved ghost (unknown Act) into a shared sentinel cluster", () => {
    const g = makeGhost("external:Some Act:1", null);
    expect(statuteClusterKey(g)).toBe("__unresolved__");
  });

  it("a section with no heading path at all keys to null (no Part sub-cluster)", () => {
    const s = makeSection("1", [], "TEST");
    expect(partClusterKey(s)).toBeNull();
  });

  it("subClusterKey never collides between different (statute, part) pairs that would concatenate the same", () => {
    // Would both naively produce "AB" + "C" / "A" + "BC" == "ABC" without a separator.
    expect(subClusterKey("AB", "C")).not.toBe(subClusterKey("A", "BC"));
  });
});

// ---------------------------------------------------------------------------
// computeClusterTargets
// ---------------------------------------------------------------------------

describe("computeClusterTargets", () => {
  it("puts a single statute dead center", () => {
    const nodes = [makeSection("1", ["Part A"], "TEST"), makeSection("2", ["Part B"], "TEST")];
    const targets = computeClusterTargets(nodes, 800, 600);
    expect(targets.get("TEST")).toEqual({ x: 400, y: 300 });
  });

  it("gives two different statutes two distinct, non-center points", () => {
    const nodes = [makeSection("1", [], "AAA"), makeSection("1", [], "BBB")];
    const targets = computeClusterTargets(nodes, 800, 600);
    const a = targets.get("AAA")!;
    const b = targets.get("BBB")!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toEqual(b);
    expect(a).not.toEqual({ x: 400, y: 300 });
  });

  it("gives the same (statute, Part) pair one shared point, and a different Part a different point", () => {
    const nodes = [
      makeSection("1", ["Part A"], "TEST"),
      makeSection("2", ["Part A"], "TEST"), // same statute + same Part as s.1
      makeSection("3", ["Part B"], "TEST"), // same statute, different Part
    ];
    const targets = computeClusterTargets(nodes, 800, 600);
    const partA = targets.get(subClusterKey("TEST", "Part A"));
    const partB = targets.get(subClusterKey("TEST", "Part B"));
    expect(partA).toBeDefined();
    expect(partB).toBeDefined();
    expect(partA).not.toEqual(partB);
  });

  it("a lone Part in a statute sits exactly at that statute's own center (nothing to spread out around)", () => {
    const nodes = [makeSection("1", ["Only Part"], "TEST"), makeSection("2", ["Only Part"], "TEST")];
    const targets = computeClusterTargets(nodes, 800, 600);
    expect(targets.get(subClusterKey("TEST", "Only Part"))).toEqual(targets.get("TEST"));
  });

  it("a resolved-but-unloaded ghost still gets its own statute cluster point", () => {
    const nodes = [makeSection("1", [], "TEST"), makeGhost("C-5:1", "C-5")];
    const targets = computeClusterTargets(nodes, 800, 600);
    expect(targets.has("C-5")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeNodeRadii — size scales with how often a node is referenced
// ---------------------------------------------------------------------------

describe("computeNodeRadii", () => {
  function statuteWithFanIn(hubRefCount: number): Statute {
    const sections: StatuteSection[] = [
      { id: "TEST:hub", statuteCode: "TEST", number: "hub", marginalNote: null, text: "the hub, defined nowhere else", headingPath: [] },
    ];
    // Section "0" is the hub; sections 1..N each cite it by its real
    // (numeric) number — a citation regex only ever matches digits, so the
    // target must actually be "0", not a word like "hub".
    for (let i = 1; i <= hubRefCount; i++) {
      sections.push({
        id: `TEST:${i}`,
        statuteCode: "TEST",
        number: String(i),
        marginalNote: null,
        text: "term has the same meaning as in section 0.",
        headingPath: [],
      });
    }
    return { code: "TEST", shortTitle: "Test", longTitle: "Test", sourceUrl: "test://", fetchedAt: new Date().toISOString(), sections };
  }

  it("a heavily-referenced node is drawn larger than one referenced zero times", () => {
    const statute = statuteWithFanIn(10);
    const model = buildGraphModel([statute]);
    const radii = computeNodeRadii(model);

    const hubRadius = radii.get("TEST:0")!;
    const leafRadius = radii.get("TEST:1")!; // itself referenced by nothing
    expect(hubRadius).toBeGreaterThan(leafRadius);
  });

  it("radius grows monotonically with reference count (compared within one model, since the scale normalizes relative to that model's own max) and stays within bounds", () => {
    // Targets "1", "2", "3" are cited 1, 5, and 20 times respectively, all
    // within one model — the scale's domain is shared across it, so their
    // radii are directly comparable to each other.
    const citeCounts: Record<string, number> = { "1": 1, "2": 5, "3": 20 };
    const sections: StatuteSection[] = ["1", "2", "3"].map((num) => ({
      id: `TEST:${num}`,
      statuteCode: "TEST",
      number: num,
      marginalNote: null,
      text: "placeholder",
      headingPath: [],
    }));
    let citerIndex = 0;
    for (const [target, count] of Object.entries(citeCounts)) {
      for (let i = 0; i < count; i++) {
        sections.push({
          id: `TEST:c${citerIndex}`,
          statuteCode: "TEST",
          number: `c${citerIndex}`,
          marginalNote: null,
          text: `term has the same meaning as in section ${target}.`,
          headingPath: [],
        });
        citerIndex++;
      }
    }

    const statute: Statute = {
      code: "TEST",
      shortTitle: "Test",
      longTitle: "Test",
      sourceUrl: "test://",
      fetchedAt: new Date().toISOString(),
      sections,
    };
    const radii = computeNodeRadii(buildGraphModel([statute]));
    const few = radii.get("TEST:1")!;
    const some = radii.get("TEST:2")!;
    const many = radii.get("TEST:3")!;

    expect(few).toBeLessThan(some);
    expect(some).toBeLessThan(many);
    expect(few).toBeGreaterThanOrEqual(9); // base section radius, never shrinks below it
    expect(many).toBeLessThanOrEqual(9 + 16); // base + MAX_EXTRA_RADIUS
  });

  it("at equal reference counts, a ghost is still drawn smaller than a section (lower base radius by kind)", () => {
    // A ghost is by definition referenced at least once (that's how it came
    // to exist at all), so "compare at zero" isn't a constructible scenario
    // — instead hold the reference count equal (1 each) and isolate the
    // base-radius-by-kind difference: TEST:2 (a loaded section) and
    // TEST:999 (a ghost) are each cited exactly once.
    const statute: Statute = {
      code: "TEST",
      shortTitle: "Test",
      longTitle: "Test",
      sourceUrl: "test://",
      fetchedAt: new Date().toISOString(),
      sections: [
        { id: "TEST:1", statuteCode: "TEST", number: "1", marginalNote: null, text: "as defined in section 2.", headingPath: [] },
        { id: "TEST:2", statuteCode: "TEST", number: "2", marginalNote: null, text: "placeholder", headingPath: [] },
        { id: "TEST:3", statuteCode: "TEST", number: "3", marginalNote: null, text: "as defined in section 999.", headingPath: [] },
      ],
    };
    const model = buildGraphModel([statute]);
    const radii = computeNodeRadii(model);
    expect(radii.get("TEST:999")!).toBeLessThan(radii.get("TEST:2")!);
  });

  it("a long subsection number on a barely-referenced node still gets a radius wide enough to fit it (not just its reference-count size)", () => {
    // "529.4" is a real, common shape for a Criminal Code cross-reference
    // target (subsection numbers with a decimal point) — cited exactly
    // once, which is the smallest reference count a ghost can have, so its
    // reference-count-driven radius alone would be tiny.
    const statute: Statute = {
      code: "TEST",
      shortTitle: "Test",
      longTitle: "Test",
      sourceUrl: "test://",
      fetchedAt: new Date().toISOString(),
      sections: [
        { id: "TEST:1", statuteCode: "TEST", number: "1", marginalNote: null, text: "as authorized under subsection 529.4(1).", headingPath: [] },
      ],
    };
    const model = buildGraphModel([statute]);
    const radii = computeNodeRadii(model);
    const ghostRadius = radii.get("TEST:529.4")!;
    expect(ghostRadius).toBeGreaterThanOrEqual(minRadiusForLabel("529.4"));
  });
});

describe("minRadiusForLabel", () => {
  it("grows with label length, so a longer number needs a wider circle", () => {
    expect(minRadiusForLabel("529.4")).toBeGreaterThan(minRadiusForLabel("5"));
  });
});

// ---------------------------------------------------------------------------
// computeLineEndpoint — where an edge's arrowhead actually lands. A real
// bug here (a fixed marker offset that only worked when every node shared
// one radius) is exactly why this exists as its own testable function
// instead of only living inline in the DOM tick handler.
// ---------------------------------------------------------------------------

describe("computeLineEndpoint", () => {
  it("pulls the endpoint back from the target's center by exactly radius + gap, along a horizontal line", () => {
    const end = computeLineEndpoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, 4);
    expect(end).toEqual({ x: 76, y: 0 }); // 100 - (20 + 4)
  });

  it("pulls back by the same amount along a vertical line", () => {
    const end = computeLineEndpoint({ x: 0, y: 0 }, { x: 0, y: 100 }, 10, 5);
    expect(end).toEqual({ x: 0, y: 85 });
  });

  it("a larger target radius pulls the endpoint back further — the actual fix for the reported bug (arrowheads swallowed by big nodes)", () => {
    const smallTargetEnd = computeLineEndpoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 9, 4);
    const largeTargetEnd = computeLineEndpoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 25, 4);
    // The larger node's endpoint sits further from its own center...
    expect(100 - largeTargetEnd.x).toBeGreaterThan(100 - smallTargetEnd.x);
    // ...specifically clear of that node's own circle, not still inside it.
    expect(100 - largeTargetEnd.x).toBeGreaterThanOrEqual(25);
  });

  it("keeps the correct direction on a diagonal line (not just axis-aligned)", () => {
    // A 3-4-5 triangle: distance 5, so pulling back by 5 should land exactly on the source.
    const end = computeLineEndpoint({ x: 0, y: 0 }, { x: 3, y: 4 }, 5, 0);
    expect(end.x).toBeCloseTo(0);
    expect(end.y).toBeCloseTo(0);
  });

  it("degrades to the target's own position rather than NaN when source and target coincide", () => {
    const end = computeLineEndpoint({ x: 50, y: 50 }, { x: 50, y: 50 }, 10, 4);
    expect(end).toEqual({ x: 50, y: 50 });
    expect(Number.isNaN(end.x)).toBe(false);
    expect(Number.isNaN(end.y)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSimulation — runs the REAL physics (no DOM needed) and checks real
// convergence properties: zero overlap, and statute clustering coherence.
// ---------------------------------------------------------------------------

describe("buildSimulation convergence (real forces, no DOM)", () => {
  function settle(model: ReturnType<typeof buildGraphModel>, width = 900, height = 700) {
    const { simulation, simNodes } = buildSimulation(model, width, height);
    simulation.stop();
    for (let i = 0; i < 500; i++) simulation.tick();
    return simNodes;
  }

  it("produces zero overlapping nodes on the real, parsed Criminal Code sample (6 sections + their real ghosts)", () => {
    const statute = parseStatuteXml(SAMPLE_XML, SOURCE_URL);
    const model = buildGraphModel([statute]);
    const simNodes = settle(model);

    expect(simNodes.length).toBeGreaterThan(10); // sanity: real ghosts did get included

    let overlaps = 0;
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const minGap = simNodes[i].radius + simNodes[j].radius;
        if (dist(simNodes[i], simNodes[j]) < minGap) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });

  it("also holds with zero overlap on a denser constructed graph with many mutual references", () => {
    // A small hub-and-spoke statute where everything cites everything near
    // it — the kind of dense local cluster most likely to overlap if the
    // collision force weren't doing its job.
    const sections: StatuteSection[] = Array.from({ length: 25 }, (_, i) => ({
      id: `TEST:${i}`,
      statuteCode: "TEST",
      number: String(i),
      marginalNote: null,
      text: `term has the same meaning as in section ${(i + 1) % 25} and section ${(i + 2) % 25}.`,
      headingPath: ["Only Part"],
    }));
    const statute: Statute = {
      code: "TEST",
      shortTitle: "Test",
      longTitle: "Test",
      sourceUrl: "test://",
      fetchedAt: new Date().toISOString(),
      sections,
    };
    const model = buildGraphModel([statute]);
    const simNodes = settle(model);

    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const minGap = simNodes[i].radius + simNodes[j].radius;
        expect(dist(simNodes[i], simNodes[j])).toBeGreaterThanOrEqual(minGap);
      }
    }
  });

  it("clusters nodes of the same statute closer together than nodes of a different statute", () => {
    const makeStatute = (code: string): Statute => ({
      code,
      shortTitle: code,
      longTitle: code,
      sourceUrl: "test://",
      fetchedAt: new Date().toISOString(),
      sections: Array.from({ length: 6 }, (_, i) => ({
        id: `${code}:${i}`,
        statuteCode: code,
        number: String(i),
        marginalNote: null,
        text: "placeholder, no cross-references",
        headingPath: [],
      })),
    });

    const model = buildGraphModel([makeStatute("AAA"), makeStatute("BBB")]);
    const simNodes = settle(model);

    const aNodes = simNodes.filter((n) => n.node.kind === "section" && n.node.statuteCode === "AAA");
    const bNodes = simNodes.filter((n) => n.node.kind === "section" && n.node.statuteCode === "BBB");

    const avgWithin = (group: typeof aNodes) => {
      let total = 0;
      let count = 0;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          total += dist(group[i], group[j]);
          count++;
        }
      }
      return total / count;
    };
    const avgBetween = () => {
      let total = 0;
      let count = 0;
      for (const a of aNodes) {
        for (const b of bNodes) {
          total += dist(a, b);
          count++;
        }
      }
      return total / count;
    };

    const withinA = avgWithin(aNodes);
    const withinB = avgWithin(bNodes);
    const between = avgBetween();

    expect(withinA).toBeLessThan(between);
    expect(withinB).toBeLessThan(between);
  });
});

// H-06: reference-type arrows used to be distinguished by color alone —
// the hardest-to-distinguish pair for the most common form of color
// blindness (red/orange) mapped to two different, real reference types
// (Punishment/Procedural). Every type now also gets a distinct
// stroke-dasharray, so the same information survives in grayscale.
describe("REFERENCE_TYPE_DASH (H-06)", () => {
  it("covers every reference type with its own color", () => {
    expect(Object.keys(REFERENCE_TYPE_DASH).sort()).toEqual(Object.keys(REFERENCE_TYPE_COLORS).sort());
  });

  it("gives every type a dash pattern distinguishable from every other type", () => {
    const patterns = Object.values(REFERENCE_TYPE_DASH);
    const unique = new Set(patterns);
    expect(unique.size).toBe(patterns.length);
  });

  it("keeps DEFINITIONAL (the most common type) as a plain solid line", () => {
    expect(REFERENCE_TYPE_DASH.DEFINITIONAL).toBeNull();
  });
});
