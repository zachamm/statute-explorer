import { describe, expect, it } from "vitest";
import { acronym, buildEntries, findEntry, searchCatalog, slugForCode, type CatalogRow } from "../src/library/catalog";

const rows: CatalogRow[] = [
  { c: "C-46", t: "Criminal Code", k: "a", d: "2026-10-19" },
  { c: "C-38.8", t: "Controlled Drugs and Substances Act", k: "a", d: "2026-10-19" },
  { c: "Y-1.5", t: "Youth Criminal Justice Act", k: "a", d: "2026-10-19" },
  { c: "SOR-2002-227", t: "Criminal Records Regulations", k: "r", d: "2026-10-19" },
  { c: "CHARTER", t: "Canadian Charter of Rights and Freedoms", k: "a", d: "", n: "Part I of the Constitution Act, 1982" },
  { c: "90h08", t: "Highway Traffic Act", k: "a", d: "2026-07-01", j: "on", n: "R.S.O. 1990, c. H.8" },
];
const entries = buildEntries(rows, []);
const titles = (q: string) => searchCatalog(entries, q).map((e) => e.title);

describe("slugForCode", () => {
  it("makes the same filename-safe slugs the parser always has", () => {
    expect(slugForCode("C-38.8")).toBe("c-38-8");
    expect(slugForCode("SOR-2002-227")).toBe("sor-2002-227");
    expect(slugForCode("C.R.C.,_c._870")).toBe("c-r-c-c-870");
  });
});

describe("acronym", () => {
  it("skips minor words and years the way lawyers do", () => {
    expect(acronym("Controlled Drugs and Substances Act")).toBe("cdsa");
    expect(acronym("Residential Tenancies Act, 2006")).toBe("rta");
  });
});

describe("buildEntries", () => {
  it("gives Ontario statutes their own slug namespace and jurisdiction", () => {
    const hta = entries.find((e) => e.code === "90h08")!;
    expect(hta.slug).toBe("on-90h08");
    expect(hta.jurisdiction).toBe("ontario");
    expect(hta.citation).toBe("R.S.O. 1990, c. H.8");
  });

  it("marks what this browser has saved, and adds saved statutes the index doesn't list", () => {
    const merged = buildEntries(rows, [
      { slug: "c-46", id: "C-46", jurisdiction: "federal", title: "Criminal Code", citation: "R.S.C., 1985, c. C-46", sectionCount: 1696 },
      { slug: "on-99z99", id: "99z99", jurisdiction: "ontario", title: "Uploaded Act" },
    ]);
    expect(merged.find((e) => e.code === "C-46")).toMatchObject({ saved: true, sectionCount: 1696 });
    expect(merged.find((e) => e.code === "99z99")).toMatchObject({ saved: true, jurisdiction: "ontario" });
    expect(merged.filter((e) => e.code === "C-46")).toHaveLength(1);
  });
});

describe("searchCatalog", () => {
  it("finds a statute by title, code, short form, and word prefixes", () => {
    expect(titles("criminal code")[0]).toBe("Criminal Code");
    expect(titles("c-46")[0]).toBe("Criminal Code");
    expect(titles("cdsa")[0]).toBe("Controlled Drugs and Substances Act");
    expect(titles("cc")[0]).toBe("Criminal Code");
    expect(titles("youth just")[0]).toBe("Youth Criminal Justice Act");
    expect(titles("charter")[0]).toBe("Canadian Charter of Rights and Freedoms");
  });

  it("ranks an Act above a regulation for the same words", () => {
    expect(titles("criminal")[0]).toBe("Criminal Code");
    expect(titles("criminal")).toContain("Criminal Records Regulations");
  });

  it("returns nothing for an empty or unmatched query", () => {
    expect(searchCatalog(entries, "   ")).toEqual([]);
    expect(searchCatalog(entries, "zzzz")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchCatalog(entries, "act", 2)).toHaveLength(2);
  });
});

describe("findEntry", () => {
  it("resolves a statute by slug or code, whichever a link happens to use", () => {
    expect(findEntry(entries, "c-38-8")?.code).toBe("C-38.8");
    expect(findEntry(entries, "C-38.8")?.code).toBe("C-38.8");
    expect(findEntry(entries, "on-90h08")?.code).toBe("90h08");
    expect(findEntry(entries, "90h08")?.code).toBe("90h08");
    expect(findEntry(entries, "nope")).toBeNull();
    expect(findEntry(entries, null)).toBeNull();
  });
});
