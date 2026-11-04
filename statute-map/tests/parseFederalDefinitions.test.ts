import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseFederalXml } from "../parser/lib/parse-federal.js";
import type { FederalDefinition } from "../parser/lib/parse-federal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Real excerpt of the Criminal Code XML — full, unmodified <Section>
// elements 2 (Definitions) and 153.1 (Sexual exploitation of person with
// disability), pulled live from https://laws-lois.justice.gc.ca/eng/XML/C-46.xml
// and wrapped in the same Identification/Body skeleton used by
// fixtures/criminal-code-sample.xml (the Part V heading around section
// 153.1 is reconstructed from the real document's own heading, same
// convention as that fixture).
const SAMPLE_XML = readFileSync(
  path.join(__dirname, "../fixtures/criminal-code-definitions-sample.xml"),
  "utf-8",
);

// Some real headwords use a typographic en-space (U+2002) rather than an
// ASCII space between the term and "means"/"includes" (e.g. the government
// XML's own "Act includes"). Collapsed here the same way parse-federal.js's
// own textContent() does, so assertions below can use plain spaces.
function previewText(definitions: Record<string, FederalDefinition>, id: string): string {
  const def = definitions[id];
  if (!def) throw new Error(`No definition found for "${id}"`);
  return def.previewRuns
    .map((r) => r.value ?? "")
    .join("")
    .replace(/\s+/g, " ");
}

describe("parseFederalXml definition previews (C-02)", () => {
  const { definitions } = parseFederalXml(SAMPLE_XML);

  // C-02's two reported cases -------------------------------------------

  it('"person" shows its own definition, not "Act"\'s', () => {
    const preview = previewText(definitions, "person");
    expect(preview).toContain("every one, person and owner");
    expect(preview).toContain("include Her Majesty and an organization");
    expect(preview).not.toContain("In this Act, Act includes an Act of Parliament");
  });

  it('"consent" shows its own definition (s.153.1(2)), not s.153.1(1)\'s offence text', () => {
    const preview = previewText(definitions, "consent");
    expect(preview).toContain("consent means, for the purposes of this section");
    expect(preview).toContain("voluntary agreement of the complainant");
    expect(preview).not.toContain("Every person who is in a position of trust or authority");
  });

  // A <Definition> can anchor more than one term at once — every co-defined
  // term must get that same shared text, not just the first one found.
  it("every term co-defined by one shared <Definition> gets that same text", () => {
    const shared = previewText(definitions, "every-one");
    expect(previewText(definitions, "person")).toBe(shared);
    expect(previewText(definitions, "owner")).toBe(shared);
  });

  // Regression guard for the fix's own narrow scope: a <DefinedTermEn> tag
  // used as a plain cross-reference mention inside a *different* term's
  // elaboration (not that term's own definition) must not be mistaken for
  // one. "justice system participant" mentions "peace officer" this way
  // while enumerating witness types; "peace officer" has its own separate
  // <Definition> later in the section.
  it("a term merely mentioned inside another term's definition still resolves to its own definition", () => {
    const preview = previewText(definitions, "peace-officer");
    expect(preview).toContain("peace officer includes a mayor, warden, reeve");
    expect(preview).not.toContain("within the meaning of any of paragraphs");
  });

  // Spot-check a handful of previously-correct, differently-shaped
  // definitions to confirm the fix didn't shift their boundaries.
  it.each([
    ["act", "Act includes an Act of Parliament"],
    ["weapon", "weapon means any thing used"],
    ["firearm", "firearm means a barrelled weapon"],
    ["property", "property includes real and personal property"],
    ["environment", "environment means the components of the Earth"],
  ])('"%s" still starts with its own definition text', (id, expectedStart) => {
    expect(previewText(definitions, id).startsWith(expectedStart)).toBe(true);
  });

  // Every definition's preview should actually mention its own term
  // somewhere (a much weaker, whole-table sanity net — not a substitute for
  // the targeted cases above, which check exact wording).
  it("every definition's preview text contains its own term", () => {
    for (const def of Object.values(definitions)) {
      const preview = previewText(definitions, def.id).toLowerCase();
      const term = def.term.toLowerCase();
      expect(preview.includes(term), `"${def.id}"'s preview doesn't mention "${def.term}": ${preview.slice(0, 80)}`).toBe(true);
    }
  });
});
