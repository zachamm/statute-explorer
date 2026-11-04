import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectFromContent, detectFromUrl, parseContent } from "../parser/lib/import-logic.js";

const xml = readFileSync("fixtures/criminal-code-sample.xml", "utf-8");
const charter = readFileSync("fixtures/charter-page-12.html", "utf-8");

describe("detectFromUrl", () => {
  it("understands the links people actually copy", () => {
    expect(detectFromUrl("https://laws-lois.justice.gc.ca/eng/acts/C-46/")).toEqual({ jurisdiction: "federal", identifier: "C-46" });
    expect(detectFromUrl("https://laws-lois.justice.gc.ca/eng/acts/C-46/page-1.html")).toEqual({ jurisdiction: "federal", identifier: "C-46" });
    expect(detectFromUrl("https://laws-lois.justice.gc.ca/eng/XML/C-38.8.xml")).toEqual({ jurisdiction: "federal", identifier: "C-38.8" });
    expect(detectFromUrl("https://laws-lois.justice.gc.ca/eng/regulations/SOR-2002-227/index.html")).toEqual({ jurisdiction: "federal", identifier: "SOR-2002-227" });
    expect(detectFromUrl("https://www.ontario.ca/laws/statute/90h08#BK5")).toEqual({ jurisdiction: "ontario", identifier: "90h08" });
  });

  it("rejects anything else, including lookalike hosts", () => {
    expect(detectFromUrl("https://example.com/eng/acts/C-46/")).toBeNull();
  });
});

describe("parseContent", () => {
  it("detects and parses federal XML", async () => {
    expect(detectFromContent(xml)).toBe("federal");
    const { slug, statuteDocument } = await parseContent(xml);
    expect(slug).toBe("c-46");
    expect(statuteDocument.title).toBe("Criminal Code");
    expect(Object.keys(statuteDocument.sections).length).toBeGreaterThan(0);
  });

  it("detects and parses the Charter's HTML", async () => {
    expect(detectFromContent(charter)).toBe("charter");
    const { slug, statuteDocument } = await parseContent(charter, { sourceUrl: "https://example.test/" });
    expect(slug).toBe("charter");
    expect(statuteDocument.sections.s7).toBeTruthy();
  });

  it("parses a regulation under the code it was requested with", async () => {
    const regulation = `<?xml version="1.0"?><Regulation xmlns:lims="http://justice.gc.ca/lims"><Identification><InstrumentNumber>SOR/2002-227</InstrumentNumber><LongTitle>Example Regulations</LongTitle></Identification><Body><Section><Label>1</Label><Text>Hello.</Text></Section></Body></Regulation>`;
    const { slug, statuteDocument } = await parseContent(regulation, { code: "SOR-2002-227" });
    expect(slug).toBe("sor-2002-227");
    expect(statuteDocument.title).toBe("Example Regulations");
    expect(statuteDocument.citation).toBe("SOR/2002-227");
    expect(statuteDocument.sections.s1).toBeTruthy();
  });

  it("refuses a file it can't identify, in plain language", async () => {
    await expect(parseContent("not a statute")).rejects.toThrow(/isn't federal Justice Laws XML/);
  });
});
