import { describe, expect, it } from "vitest";
import {
  extractStatuteCodeFromUrl,
  findStatuteByCode,
  findStatuteByName,
  xmlUrlForCode,
} from "../src/statute/lookup";

describe("extractStatuteCodeFromUrl", () => {
  it("extracts the code from a real Justice Laws XML URL", () => {
    expect(extractStatuteCodeFromUrl("https://laws-lois.justice.gc.ca/eng/XML/C-46.xml")).toBe("C-46");
  });

  it("handles codes with dots (e.g. Controlled Drugs and Substances Act)", () => {
    expect(extractStatuteCodeFromUrl("https://laws-lois.justice.gc.ca/eng/XML/C-38.8.xml")).toBe("C-38.8");
  });

  it("round-trips with xmlUrlForCode", () => {
    expect(extractStatuteCodeFromUrl(xmlUrlForCode("Y-1.5"))).toBe("Y-1.5");
  });

  it("returns null for a non-Justice-Laws URL", () => {
    expect(extractStatuteCodeFromUrl("https://example.com/whatever.xml")).toBeNull();
    expect(extractStatuteCodeFromUrl("not a url at all")).toBeNull();
  });

  it("ignores surrounding whitespace (e.g. pasted from a browser address bar)", () => {
    expect(extractStatuteCodeFromUrl("  https://laws-lois.justice.gc.ca/eng/XML/C-46.xml  ")).toBe("C-46");
  });
});

describe("findStatuteByName", () => {
  it("matches by exact name and by alias", () => {
    expect(findStatuteByName("Criminal Code")?.code).toBe("C-46");
    expect(findStatuteByName("cc")?.code).toBe("C-46");
  });

  it("is case-insensitive", () => {
    expect(findStatuteByName("criminal code")?.code).toBe("C-46");
  });

  it("returns null for no match", () => {
    expect(findStatuteByName("Not A Real Act")).toBeNull();
  });

  it('finds the Charter by name, alias, or short form ("charter")', () => {
    expect(findStatuteByName("Canadian Charter of Rights and Freedoms")?.code).toBe("CHARTER");
    expect(findStatuteByName("charter")?.code).toBe("CHARTER");
  });
});

describe("findStatuteByCode", () => {
  it("finds an entry by its exact code", () => {
    expect(findStatuteByCode("C-46")?.name).toBe("Criminal Code");
  });

  it("returns null for an unknown code", () => {
    expect(findStatuteByCode("Z-999")).toBeNull();
  });
});

describe("HTML-sourced entries (the Charter)", () => {
  it("is marked sourceType html with an explicit (non-XML) url, unlike every other entry", () => {
    const charter = findStatuteByCode("CHARTER")!;
    expect(charter.sourceType).toBe("html");
    expect(charter.url).toBe("https://laws-lois.justice.gc.ca/eng/Const/page-12.html");

    const criminalCode = findStatuteByCode("C-46")!;
    expect(criminalCode.sourceType).toBe("xml");
    expect(criminalCode.url).toBe(xmlUrlForCode("C-46"));
  });
});
