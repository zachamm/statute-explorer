import { describe, expect, it } from "vitest";
import { buildCitation, casesUrl, mcgillSource } from "../src/library/legalLinks";
import { parseAmendedDate } from "../src/library/updates";
import { buildEntries } from "../src/library/catalog";

describe("mcgillSource", () => {
  it("formats federal, Ontario and regulation citations", () => {
    expect(mcgillSource("R.S.C., 1985, c. C-46")).toBe("RSC 1985, c C-46");
    expect(mcgillSource("S.C. 1996, c. 19")).toBe("SC 1996, c 19");
    expect(mcgillSource("R.S.C., 1985, c. 22 (4th Supp.)")).toBe("RSC 1985, c 22 (4th Supp)");
    expect(mcgillSource("R.S.O. 1990, c. H.8")).toBe("RSO 1990, c H.8");
    expect(mcgillSource("S.O. 2002, c. 24, Sched. B")).toBe("SO 2002, c 24, Sch B");
    expect(mcgillSource("SOR/2002-227")).toBe("SOR/2002-227");
    expect(mcgillSource("C.R.C., c. 836")).toBe("CRC, c 836");
  });
});

describe("buildCitation", () => {
  it("pinpoints the section", () => {
    expect(buildCitation({ title: "Criminal Code", citation: "R.S.C., 1985, c. C-46" }, "265")).toEqual({
      title: "Criminal Code",
      rest: "RSC 1985, c C-46, s 265",
    });
  });

  it("uses the Charter's own form, with the pinpoint before the source", () => {
    const { rest } = buildCitation(
      { title: "Canadian Charter of Rights and Freedoms", citation: "Part I of the Constitution Act, 1982" },
      "7",
    );
    expect(rest).toBe("s 7, Part I of the Constitution Act, 1982, being Schedule B to the Canada Act 1982 (UK), 1982, c 11");
  });

  it("copes with no citation at all", () => {
    expect(buildCitation({ title: "Uploaded Act" }, "1")).toEqual({ title: "Uploaded Act", rest: "s 1" });
  });
});

describe("casesUrl", () => {
  it("searches CanLII for the Act and section, without a year in the Act's name", () => {
    const url = decodeURIComponent(casesUrl("Limitations Act, 2002", "4"));
    expect(url).toContain("canlii.org");
    expect(url).toContain('"Limitations Act"');
    expect(url).toContain('"section 4"');
  });
});

describe("parseAmendedDate", () => {
  it("reads the date off a federal file's root element", () => {
    expect(parseAmendedDate('<Statute lims:pit-date="2026-06-18" lims:lastAmendedDate="2026-06-15" xml:lang="en">')).toBe("2026-06-15");
    expect(parseAmendedDate("<Statute>")).toBeNull();
  });
});

describe("regulation links", () => {
  it("connects an Act to its regulations in both directions", () => {
    const entries = buildEntries(
      [
        { c: "A-1", t: "Access to Information Act", k: "a", d: "", g: ["SOR-83-507"] },
        { c: "SOR-83-507", t: "Access to Information Regulations", k: "r", d: "" },
      ],
      [],
    );
    expect(entries.find((e) => e.code === "A-1")!.regulations).toEqual(["SOR-83-507"]);
    expect(entries.find((e) => e.code === "SOR-83-507")!.enablingActs).toEqual(["A-1"]);
  });
});
