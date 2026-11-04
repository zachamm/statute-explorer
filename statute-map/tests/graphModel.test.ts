import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseStatuteXml } from "../src/statute/parseStatuteXml";
import { buildGraphModel, computeIncomingCounts, incomingEdges, outgoingEdges } from "../src/graph/model";
import type { GhostGraphNode, GraphNode, SectionGraphNode } from "../src/graph/model";
import type { Statute, StatuteSection } from "../src/statute/types";

function expectGhost(node: GraphNode | undefined): GhostGraphNode {
  expect(node).toBeDefined();
  expect(node!.kind).toBe("ghost");
  return node as GhostGraphNode;
}

function expectSection(node: GraphNode | undefined): SectionGraphNode {
  expect(node).toBeDefined();
  expect(node!.kind).toBe("section");
  return node as SectionGraphNode;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_XML = readFileSync(path.join(__dirname, "../fixtures/criminal-code-sample.xml"), "utf-8");
const SOURCE_URL = "https://laws-lois.justice.gc.ca/eng/XML/C-46.xml";

function makeSection(number: string, text: string, statuteCode = "TEST"): StatuteSection {
  return { id: `${statuteCode}:${number}`, statuteCode, number, marginalNote: null, text, headingPath: [] };
}

function makeStatute(sections: StatuteSection[], statuteCode = "TEST", shortTitle = "Test Act"): Statute {
  return {
    code: statuteCode,
    shortTitle,
    longTitle: `An Act for testing (${statuteCode})`,
    sourceUrl: "test://synthetic",
    fetchedAt: new Date().toISOString(),
    sections,
  };
}

// ---------------------------------------------------------------------------
// Section A: against the real, parsed step-1 fixture.
// ---------------------------------------------------------------------------

describe("buildGraphModel against the real parsed Criminal Code fixture", () => {
  const statute = parseStatuteXml(SAMPLE_XML, SOURCE_URL);
  const model = buildGraphModel([statute]);

  it("has exactly the 6 loaded sections as real nodes", () => {
    const real = model.nodes.filter((n) => n.kind === "section");
    expect(real.map((n) => n.id).sort()).toEqual(
      ["C-46:2", "C-46:265", "C-46:266", "C-46:267", "C-46:268", "C-46:718"].sort()
    );
  });

  it("creates same-statute ghost nodes for real targets outside the tiny 6-section sample (e.g. section 493)", () => {
    const ghost = model.nodes.find((n) => n.id === "C-46:493");
    expect(ghost).toBeDefined();
    expect(ghost!.kind).toBe("ghost");
    expect((ghost as { statuteCode: string | null }).statuteCode).toBe("C-46");
  });

  it("creates a resolved cross-statute ghost for the Canada Evidence Act reference (real lookup match)", () => {
    const ghost = expectGhost(model.nodes.find((n) => n.id === "C-5:38"));
    expect(ghost.statuteCode).toBe("C-5");
    expect(ghost.statuteName).toBe("Canada Evidence Act");
    expect(ghost.number).toBe("38");
  });

  it("creates an unresolved-name ghost for a real Act mention that isn't in our small lookup table", () => {
    const ghost = expectGhost(model.nodes.find((n) => n.id === "external:Director of Public Prosecutions Act:3"));
    expect(ghost.statuteCode).toBeNull();
    expect(ghost.statuteName).toBe("Director of Public Prosecutions Act");
  });

  it("keeps the real section 268 -> 265 edge pointing at a real (not ghost) node", () => {
    const edge = model.edges.find((e) => e.source === "C-46:268" && e.target === "C-46:265");
    expect(edge).toBeDefined();
    expect(edge!.type).toBe("OTHER");
    expect(edge!.crossStatute).toBe(false);

    const target = model.nodes.find((n) => n.id === "C-46:265");
    expect(target!.kind).toBe("section");
  });

  it("incomingEdges(section 265) includes the edge from section 268", () => {
    const incoming = incomingEdges(model, "C-46:265");
    expect(incoming.some((e) => e.source === "C-46:268")).toBe(true);
  });

  it("outgoingEdges(section 268) includes the edge to section 265", () => {
    const outgoing = outgoingEdges(model, "C-46:268");
    expect(outgoing.some((e) => e.target === "C-46:265")).toBe(true);
  });

  it("sections 266, 267 and 718 have no outgoing edges at all (real self-contained provisions)", () => {
    for (const id of ["C-46:266", "C-46:267", "C-46:718"]) {
      expect(outgoingEdges(model, id)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Section B: constructed statutes — the multi-statute resolution behavior
// the real (single-statute) fixture can't exercise.
// ---------------------------------------------------------------------------

describe("buildGraphModel mechanics (constructed statutes)", () => {
  it("a cross-statute reference becomes a GHOST when the target statute isn't loaded", () => {
    const referencer = makeStatute(
      [makeSection("1", "term has the same meaning as in section 5 of the Interpretation Act.")],
      "TEST"
    );
    const model = buildGraphModel([referencer]);

    const target = expectGhost(model.nodes.find((n) => n.id === "I-21:5"));
    expect(target.statuteCode).toBe("I-21"); // known via the lookup table even though not loaded
    expect(target.statuteName).toBe("Interpretation Act");

    const edge = model.edges.find((e) => e.source === "TEST:1" && e.target === "I-21:5");
    expect(edge).toBeDefined();
    expect(edge!.crossStatute).toBe(true);
    expect(edge!.type).toBe("DEFINITIONAL");
  });

  it("that SAME cross-statute reference resolves to a REAL node once the target statute is also loaded", () => {
    const referencer = makeStatute(
      [makeSection("1", "term has the same meaning as in section 5 of the Interpretation Act.")],
      "TEST"
    );
    const interpretationAct = makeStatute(
      [makeSection("5", "In this Act, term means whatever this test says it means.", "I-21")],
      "I-21",
      "Interpretation Act"
    );
    const model = buildGraphModel([referencer, interpretationAct]);

    const target = expectSection(model.nodes.find((n) => n.id === "I-21:5"));
    expect(target.text).toContain("whatever this test says it means"); // no longer a ghost — it's actually loaded

    // Exactly one node for I-21:5 — not duplicated as both a ghost and a real node.
    expect(model.nodes.filter((n) => n.id === "I-21:5")).toHaveLength(1);
  });

  it("never drops a reference into a ghost that's part of the loaded statute itself", () => {
    const statute = makeStatute([
      makeSection("1", "widget means a thing as defined in section 2."),
      makeSection("2", "thing means an object."),
    ]);
    const model = buildGraphModel([statute]);
    expect(model.nodes.every((n) => n.kind === "section")).toBe(true);
  });
});

describe("incomingEdges / outgoingEdges", () => {
  it("filter correctly on a small hand-checkable model", () => {
    const statute = makeStatute([
      makeSection("1", "widget means a thing as defined in section 2 and section 3."),
      makeSection("2", "thing means an object."),
      makeSection("3", "gadget means a small device."),
    ]);
    const model = buildGraphModel([statute]);

    expect(outgoingEdges(model, "TEST:1")).toHaveLength(2);
    expect(incomingEdges(model, "TEST:2")).toHaveLength(1);
    expect(incomingEdges(model, "TEST:3")).toHaveLength(1);
    expect(incomingEdges(model, "TEST:1")).toEqual([]);
  });
});

describe("computeIncomingCounts", () => {
  it("counts in-degree per node, omitting nodes with zero incoming edges", () => {
    const statute = makeStatute([
      makeSection("1", "widget means a thing as defined in section 3."),
      makeSection("2", "gadget means a thing as defined in section 3."),
      makeSection("3", "base-term means anything at all."),
    ]);
    const model = buildGraphModel([statute]);
    const counts = computeIncomingCounts(model);

    expect(counts.get("TEST:3")).toBe(2); // referenced by both 1 and 2
    expect(counts.has("TEST:1")).toBe(false); // nothing references it
    expect(counts.has("TEST:2")).toBe(false);
  });
});
