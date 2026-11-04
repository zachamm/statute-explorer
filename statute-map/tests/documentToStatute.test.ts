import { describe, expect, it } from "vitest";
import { documentToStatute } from "../src/statute/documentToStatute";
import { classifyReferences } from "../src/statute/classifyReferences";

const doc = {
  id: "90h08",
  title: "Highway Traffic Act",
  sourceUrl: "https://www.ontario.ca/laws/statute/90h08",
  tree: [
    {
      label: "PART I",
      title: "Permits",
      divisions: [{ title: "General", sectionIds: ["s2", "s1", "missing"] }],
    },
  ],
  sections: {
    s1: { number: "1", marginalNote: "Definitions", body: [{ type: "text", runs: [{ value: "In this Act," }] }] },
    s2: {
      number: "2",
      marginalNote: null,
      body: [
        {
          label: "(1)",
          children: [{ runs: [{ value: "As defined in " }, { value: "section 1" }, { value: "." }] }],
        },
      ],
    },
  },
};

describe("documentToStatute", () => {
  const statute = documentToStatute(doc, "https://example.test/");

  it("follows the tree's order and skips ids with no section", () => {
    expect(statute.sections.map((s) => s.number)).toEqual(["2", "1"]);
  });

  it("gives sections the ids and heading path the map expects", () => {
    expect(statute.code).toBe("90h08");
    expect(statute.sections[0].id).toBe("90h08:2");
    expect(statute.sections[0].headingPath).toEqual(["PART I — Permits", "General"]);
  });

  it("flattens nested blocks into text the classifier can read", () => {
    expect(statute.sections[0].text).toContain("(1)");
    const { references } = classifyReferences(statute.sections[0]);
    expect(references.map((r) => r.targetSectionNumber)).toContain("1");
  });
});
