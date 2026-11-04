import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// H-02: New/Rename/Delete project must surface a storage-write failure
// (e.g. a real browser QuotaExceededError) instead of silently doing
// nothing. src/main.ts's click handlers are a thin try/catch around
// createProject/renameProject/deleteProject — the actual contract that
// matters, and the one worth a regression test, is that those functions
// genuinely *propagate* a write failure rather than swallowing it. This is
// isolated in its own file (not tests/projects.test.ts) because vi.mock
// calls are hoisted and apply file-wide — every other projects.test.ts
// test needs the real, working idbPut/idbDelete.

vi.mock("../src/db/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/database")>();
  return {
    ...actual,
    idbPut: vi.fn(actual.idbPut),
    idbDelete: vi.fn(actual.idbDelete),
  };
});

import { _resetDatabaseForTests, idbDelete, idbPut } from "../src/db/database";
import { createProject, deleteProject, listProjects, renameProject } from "../src/db/projects";

/** The real browser error this class of failure actually throws — same
 *  message the audit confirmed for the *already*-correct addStatute()
 *  error path, which New/Rename/Delete now match. */
function quotaExceededError(): DOMException {
  return new DOMException("The quota has been exceeded.", "QuotaExceededError");
}

beforeEach(async () => {
  await _resetDatabaseForTests();
  vi.mocked(idbPut).mockClear();
  vi.mocked(idbDelete).mockClear();
});

afterEach(() => {
  vi.mocked(idbPut).mockReset();
  vi.mocked(idbDelete).mockReset();
});

describe("New/Rename/Delete project surface a storage-write failure (H-02)", () => {
  it("createProject rejects when the underlying write fails, instead of resolving as if it succeeded", async () => {
    vi.mocked(idbPut).mockRejectedValueOnce(quotaExceededError());
    await expect(createProject("Will fail")).rejects.toThrow(/quota/i);
    // Nothing was actually created.
    expect(await listProjects()).toEqual([]);
  });

  it("renameProject rejects when the underlying write fails, leaving the project's real name untouched", async () => {
    const project = await createProject("Original name");
    vi.mocked(idbPut).mockRejectedValueOnce(quotaExceededError());
    await expect(renameProject(project.id, "New name")).rejects.toThrow(/quota/i);

    const stored = (await listProjects()).find((p) => p.id === project.id);
    expect(stored?.name).toBe("Original name");
  });

  it("deleteProject rejects when the underlying write fails, leaving the project in place", async () => {
    const project = await createProject("To delete");
    vi.mocked(idbDelete).mockRejectedValueOnce(quotaExceededError());
    await expect(deleteProject(project.id)).rejects.toThrow(/quota/i);

    expect((await listProjects()).some((p) => p.id === project.id)).toBe(true);
  });

  it("recovers on the next attempt once the underlying write succeeds again", async () => {
    vi.mocked(idbPut).mockRejectedValueOnce(quotaExceededError());
    await expect(createProject("First try fails")).rejects.toThrow();

    const project = await createProject("Second try works");
    expect(project.name).toBe("Second try works");
    expect(await listProjects()).toHaveLength(1);
  });
});
