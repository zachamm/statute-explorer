import { describe, expect, it } from "vitest";
import { resolveInitialSlug } from "../src/library/resolveInitialSlug";

// C-01: the Explorer must never silently substitute a different statute
// when the one requested by a `?statute=` link isn't in its manifest.

const manifest = [{ slug: "c-46" }, { slug: "i-21" }];

describe("resolveInitialSlug", () => {
  it("uses the linked slug when it exists in the manifest", () => {
    const result = resolveInitialSlug(manifest, { linkedSlug: "c-46", remembered: "i-21" });
    expect(result).toEqual({ slug: "c-46", unavailableSlug: null });
  });

  it("flags the linked slug as unavailable instead of falling back to the remembered slug", () => {
    const result = resolveInitialSlug(manifest, { linkedSlug: "c-5", remembered: "i-21" });
    expect(result).toEqual({ slug: null, unavailableSlug: "c-5" });
  });

  it("flags the linked slug as unavailable instead of falling back to the first statute", () => {
    const result = resolveInitialSlug(manifest, { linkedSlug: "charter", remembered: null });
    expect(result).toEqual({ slug: null, unavailableSlug: "charter" });
  });

  it("falls back to the remembered slug when there is no link", () => {
    const result = resolveInitialSlug(manifest, { linkedSlug: null, remembered: "i-21" });
    expect(result).toEqual({ slug: "i-21", unavailableSlug: null });
  });

  it("falls back to the first statute when there is no link and nothing remembered", () => {
    const result = resolveInitialSlug(manifest, { linkedSlug: null, remembered: null });
    expect(result).toEqual({ slug: "c-46", unavailableSlug: null });
  });

  it("falls back to the first statute when the remembered slug no longer exists", () => {
    const result = resolveInitialSlug(manifest, { linkedSlug: null, remembered: "deleted-slug" });
    expect(result).toEqual({ slug: "c-46", unavailableSlug: null });
  });

  it("treats an empty link parameter the same as no link", () => {
    const result = resolveInitialSlug(manifest, { linkedSlug: "", remembered: "i-21" });
    expect(result).toEqual({ slug: "i-21", unavailableSlug: null });
  });

  it("returns nothing loadable for an empty manifest", () => {
    const result = resolveInitialSlug([], { linkedSlug: null, remembered: null });
    expect(result).toEqual({ slug: null, unavailableSlug: null });
  });
});
