import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDatabaseForTests } from "../src/db/database";
import { getCachedStatuteSource } from "../src/db/statuteCache";
import {
  addStatuteToProject,
  createProject,
  deleteProject,
  exportProject,
  getProject,
  importProject,
  InvalidProjectFileError,
  listProjects,
  loadProjectStatutes,
  ProjectNotFoundError,
  removeStatuteFromProject,
  renameProject,
  UnsupportedProjectFormatError,
} from "../src/db/projects";
import type { ProjectExportFile } from "../src/db/types";

function fakeStatuteXml(code: string, shortTitle: string): string {
  return `<?xml version="1.0"?><Statute xmlns:lims="http://justice.gc.ca/lims"><Identification><LongTitle>An Act for testing</LongTitle><ShortTitle>${shortTitle}</ShortTitle><Chapter><ConsolidatedNumber>${code}</ConsolidatedNumber></Chapter></Identification><Body><Section><MarginalNote>Short title</MarginalNote><Label>1</Label><Text>This Act may be cited as the ${shortTitle}.</Text></Section></Body></Statute>`;
}

function stubFetchByCode(xmlByCode: Record<string, string>): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockImplementation((url: string) => {
    const code = Object.keys(xmlByCode).find((c) => url.includes(c));
    if (!code) return Promise.resolve({ ok: false, status: 404, statusText: "Not Found", text: () => Promise.resolve("") });
    return Promise.resolve({ ok: true, status: 200, statusText: "OK", text: () => Promise.resolve(xmlByCode[code]) });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(async () => {
  await _resetDatabaseForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project CRUD", () => {
  it("creates, lists, gets, renames, and deletes a project", async () => {
    const p1 = await createProject("Fraud Cases");
    const p2 = await createProject("Assault Cases");

    expect((await listProjects()).map((p) => p.name)).toEqual(["Assault Cases", "Fraud Cases"]); // alphabetical

    expect(await getProject(p1.id)).toMatchObject({ name: "Fraud Cases", statuteCodes: [] });

    const renamed = await renameProject(p1.id, "Fraud Cases (2026)");
    expect(renamed.name).toBe("Fraud Cases (2026)");
    expect(renamed.updatedAt).not.toBe(p1.updatedAt);

    await deleteProject(p2.id);
    expect(await getProject(p2.id)).toBeUndefined();
    expect((await listProjects()).map((p) => p.id)).toEqual([p1.id]);
  });

  it("throws ProjectNotFoundError for operations on a nonexistent project", async () => {
    await expect(renameProject("nope", "x")).rejects.toThrow(ProjectNotFoundError);
    await expect(addStatuteToProject("nope", "C-46")).rejects.toThrow(ProjectNotFoundError);
    await expect(removeStatuteFromProject("nope", "C-46")).rejects.toThrow(ProjectNotFoundError);
  });

  // H-01: an unbounded name (e.g. an accidentally pasted paragraph) used to
  // stretch the toolbar's project <select> to tens of thousands of pixels.
  // The <select> itself is capped+ellipsized in index.html regardless, but
  // the name is also clamped here so nothing this long is ever stored.
  it("clamps an extremely long name on create, and trims whitespace", async () => {
    const longName = "A".repeat(5000);
    const project = await createProject(longName);
    expect(project.name.length).toBe(200);
    expect(project.name).toBe("A".repeat(200));

    const padded = await createProject("  Padded Name  ");
    expect(padded.name).toBe("Padded Name");
  });

  it("clamps an extremely long name on rename", async () => {
    const project = await createProject("Short Name");
    const renamed = await renameProject(project.id, "B".repeat(5000));
    expect(renamed.name.length).toBe(200);
    expect(renamed.name).toBe("B".repeat(200));
  });
});

describe("statute caching across projects", () => {
  it("shares one fetch across two different projects loading the same statute", async () => {
    const fetchMock = stubFetchByCode({ "C-46": fakeStatuteXml("C-46", "Criminal Code") });

    const p1 = await createProject("Project One");
    const p2 = await createProject("Project Two");

    await addStatuteToProject(p1.id, "C-46");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A second, different project loading the SAME statute reuses the cache.
    await addStatuteToProject(p2.id, "C-46");
    expect(fetchMock).toHaveBeenCalledTimes(1); // still 1 — no redundant fetch

    expect((await getProject(p1.id))!.statuteCodes).toEqual(["C-46"]);
    expect((await getProject(p2.id))!.statuteCodes).toEqual(["C-46"]);
  });

  it("does not duplicate a statute code when added to the same project twice", async () => {
    stubFetchByCode({ "C-46": fakeStatuteXml("C-46", "Criminal Code") });
    const project = await createProject("Test");
    await addStatuteToProject(project.id, "C-46");
    const updated = await addStatuteToProject(project.id, "C-46");
    expect(updated.statuteCodes).toEqual(["C-46"]);
  });

  it("removing a statute from a project does not evict it from the shared cache", async () => {
    stubFetchByCode({ "C-46": fakeStatuteXml("C-46", "Criminal Code") });
    const project = await createProject("Test");
    await addStatuteToProject(project.id, "C-46");
    const updated = await removeStatuteFromProject(project.id, "C-46");

    expect(updated.statuteCodes).toEqual([]);
    expect(await getCachedStatuteSource("C-46")).toBeDefined(); // still cached for reuse
  });

  it("each project's loaded statutes stay independent even sharing the same cached XML", async () => {
    stubFetchByCode({ "C-46": fakeStatuteXml("C-46", "Criminal Code") });
    const p1 = await createProject("One");
    const p2 = await createProject("Two");
    await addStatuteToProject(p1.id, "C-46");
    await addStatuteToProject(p2.id, "C-46");

    const [s1] = await loadProjectStatutes((await getProject(p1.id))!);
    const [s2] = await loadProjectStatutes((await getProject(p2.id))!);

    expect(s1).not.toBe(s2); // distinct object instances
    expect(s1.shortTitle).toBe("Criminal Code");
    s1.sections.push({ id: "fake", statuteCode: "C-46", number: "999", marginalNote: null, text: "", headingPath: [] });
    expect(s2.sections).toHaveLength(1); // mutating one project's copy doesn't touch the other's
  });
});

describe("loadProjectStatutes", () => {
  it("parses real Statute objects from a project's loaded codes, in order", async () => {
    stubFetchByCode({
      "C-46": fakeStatuteXml("C-46", "Criminal Code"),
      "I-21": fakeStatuteXml("I-21", "Interpretation Act"),
    });
    const project = await createProject("Test");
    await addStatuteToProject(project.id, "C-46");
    await addStatuteToProject(project.id, "I-21");

    const statutes = await loadProjectStatutes((await getProject(project.id))!);
    expect(statutes.map((s) => s.code)).toEqual(["C-46", "I-21"]);
    expect(statutes.map((s) => s.shortTitle)).toEqual(["Criminal Code", "Interpretation Act"]);
  });

  it("returns an empty array for a project with no statutes loaded", async () => {
    const project = await createProject("Empty");
    expect(await loadProjectStatutes(project)).toEqual([]);
  });
});

describe("export / import", () => {
  it("round-trips a project through export -> import as a new, independent project", async () => {
    stubFetchByCode({ "C-46": fakeStatuteXml("C-46", "Criminal Code") });
    const original = await createProject("Original");
    await addStatuteToProject(original.id, "C-46");

    const exported = await exportProject((await getProject(original.id))!);
    expect(exported.formatVersion).toBe(1);
    expect(exported.project.name).toBe("Original");
    expect(exported.statutes).toHaveLength(1);
    expect(exported.statutes[0].code).toBe("C-46");

    const imported = await importProject(exported);
    expect(imported.id).not.toBe(original.id); // a genuinely new project
    expect(imported.name).toBe("Original");
    expect(imported.statuteCodes).toEqual(["C-46"]);

    // Importable without any further fetch — the export bundled the XML.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const statutes = await loadProjectStatutes(imported);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statutes[0].shortTitle).toBe("Criminal Code");
  });

  it("rejects an export file with an unsupported format version", async () => {
    const badFile = { formatVersion: 2, exportedAt: "x", project: { name: "x", statuteCodes: [] }, statutes: [] };
    await expect(importProject(badFile as unknown as ProjectExportFile)).rejects.toThrow(UnsupportedProjectFormatError);
  });

  it("does not clobber an existing cache entry with an imported one for the same code", async () => {
    const original = fakeStatuteXml("C-46", "Criminal Code (already cached)");
    const imported = fakeStatuteXml("C-46", "Criminal Code (from import)");

    stubFetchByCode({ "C-46": original });
    const p = await createProject("Existing");
    await addStatuteToProject(p.id, "C-46"); // seeds the cache with `original`

    const file: ProjectExportFile = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      project: { name: "Imported", statuteCodes: ["C-46"] },
      statutes: [
        {
          code: "C-46",
          sourceType: "xml",
          content: imported,
          sourceUrl: "https://example.test/C-46.xml",
          fetchedAt: new Date().toISOString(),
        },
      ],
    };
    await importProject(file);

    const cached = await getCachedStatuteSource("C-46");
    expect(cached?.content).toBe(original); // NOT overwritten by the import
  });
});

describe("importProject rejects malformed/incomplete files with a plain-English error (H-03, L-03)", () => {
  const validFile: ProjectExportFile = {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    project: { name: "Valid Project", statuteCodes: ["C-46"] },
    statutes: [
      {
        code: "C-46",
        sourceType: "xml",
        content: fakeStatuteXml("C-46", "Criminal Code"),
        sourceUrl: "https://example.test/C-46.xml",
        fetchedAt: new Date().toISOString(),
      },
    ],
  };

  /** Neither of these two raw JS error shapes should ever escape
   *  importProject — every rejection should be a plain-English
   *  InvalidProjectFileError (or UnsupportedProjectFormatError) instead. */
  function expectNotARawJsError(err: unknown): void {
    expect(err).toBeInstanceOf(InvalidProjectFileError);
    const message = (err as Error).message;
    expect(message).not.toMatch(/is not iterable/i);
    expect(message).not.toMatch(/cannot read propert/i);
    expect(message).not.toMatch(/undefined is not/i);
  }

  it("rejects a file with no statutes array at all (L-03's exact repro: 'file.statutes is not iterable')", async () => {
    const { statutes: _statutes, ...withoutStatutes } = validFile;
    const before = await listProjects();
    try {
      await importProject(withoutStatutes);
      expect.unreachable("importProject should have rejected this file");
    } catch (err) {
      expectNotARawJsError(err);
    }
    // Never got far enough to create a project.
    expect(await listProjects()).toEqual(before);
  });

  it("rejects a file whose statuteCodes reference statutes not actually bundled in the file (H-03's exact repro)", async () => {
    const orphaned: ProjectExportFile = {
      ...validFile,
      project: { name: "Orphaned Codes Project", statuteCodes: ["C-46", "I-21"] },
      statutes: [], // neither C-46 nor I-21 is actually included
    };
    const before = await listProjects();
    await expect(importProject(orphaned)).rejects.toThrow(InvalidProjectFileError);
    await expect(importProject(orphaned)).rejects.toThrow(/C-46.*I-21|I-21.*C-46/);
    // Rejected outright — no half-imported "Orphaned Codes Project" with
    // nothing loaded ever gets created (the exact contradiction H-03 found:
    // "Imported ..." shown while the graph panel says nothing loaded).
    expect(await listProjects()).toEqual(before);
  });

  it("rejects a file that isn't a JSON object at all", async () => {
    await expect(importProject(null)).rejects.toThrow(InvalidProjectFileError);
    await expect(importProject("just a string")).rejects.toThrow(InvalidProjectFileError);
    await expect(importProject(42)).rejects.toThrow(InvalidProjectFileError);
  });

  it("rejects a file missing its project info", async () => {
    const { project: _project, ...withoutProject } = validFile;
    await expect(importProject(withoutProject)).rejects.toThrow(InvalidProjectFileError);
  });

  it("rejects a file whose project has no name", async () => {
    const blankName = { ...validFile, project: { name: "   ", statuteCodes: ["C-46"] } };
    await expect(importProject(blankName)).rejects.toThrow(InvalidProjectFileError);
  });

  it("rejects a file whose statuteCodes isn't an array", async () => {
    const badCodes = { ...validFile, project: { name: "X", statuteCodes: "C-46" } };
    await expect(importProject(badCodes)).rejects.toThrow(InvalidProjectFileError);
  });

  it("rejects a file whose bundled statute entries are missing their own code", async () => {
    const badStatutes = {
      ...validFile,
      statutes: [{ sourceType: "xml", content: "<Statute/>", sourceUrl: "x", fetchedAt: "x" }],
    };
    await expect(importProject(badStatutes)).rejects.toThrow(InvalidProjectFileError);
  });

  it("still accepts a genuinely well-formed file (no false positives from the new validation)", async () => {
    const imported = await importProject(validFile);
    expect(imported.name).toBe("Valid Project");
    expect(imported.statuteCodes).toEqual(["C-46"]);
  });

  it("still rejects an unsupported format version as UnsupportedProjectFormatError specifically, not InvalidProjectFileError", async () => {
    const wrongVersion = { ...validFile, formatVersion: 2 };
    await expect(importProject(wrongVersion)).rejects.toThrow(UnsupportedProjectFormatError);
  });
});

describe("HTML-sourced statutes (e.g. the Charter)", () => {
  function fakeCharterHtml(): string {
    return (
      '<div class="wb-txthl"><section>' +
      '<h2 class="Part"><span class="HLabel1">PART I</span><span class="HTitleText1">Canadian Charter of Rights and Freedoms</span></h2>' +
      '<h3 class="Subheading"><span class="HTitleText2">Guarantee of Rights and Freedoms</span></h3>' +
      '<p class="MarginalNote"><span class="wb-invisible">Marginal note:</span>Rights and freedoms in Canada</p>' +
      '<p class="Section"><strong><a class="sectionLabel" id="s-1"><span class="sectionLabel">1</span></a></strong> Test guarantee text.</p>' +
      "</section></div>"
    );
  }

  it("addStatuteToProject fetches via the HTML pipeline and loadProjectStatutes parses it with the Charter parser", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(fakeCharterHtml()),
    });
    vi.stubGlobal("fetch", fetchMock);

    const project = await createProject("Rights Cases");
    await addStatuteToProject(project.id, "CHARTER", "html", "https://laws-lois.justice.gc.ca/eng/Const/page-12.html");
    expect(fetchMock).toHaveBeenCalledWith("https://laws-lois.justice.gc.ca/eng/Const/page-12.html");

    const [statute] = await loadProjectStatutes((await getProject(project.id))!);
    expect(statute.code).toBe("CHARTER");
    expect(statute.shortTitle).toBe("Canadian Charter of Rights and Freedoms");
    expect(statute.sections).toHaveLength(1);
    expect(statute.sections[0].text).toBe("Test guarantee text.");
  });

  it("a project mixing an XML statute and the HTML-sourced Charter loads both correctly", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("Const")) {
        return Promise.resolve({ ok: true, status: 200, statusText: "OK", text: () => Promise.resolve(fakeCharterHtml()) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(fakeStatuteXml("C-46", "Criminal Code")),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const project = await createProject("Mixed");
    await addStatuteToProject(project.id, "C-46", "xml");
    await addStatuteToProject(project.id, "CHARTER", "html", "https://laws-lois.justice.gc.ca/eng/Const/page-12.html");

    const statutes = await loadProjectStatutes((await getProject(project.id))!);
    expect(statutes.map((s) => s.code)).toEqual(["C-46", "CHARTER"]);
  });
});
