// Pure decision logic for App.jsx's "which statute do we load when a
// `?statute=` link is followed" step, pulled out of the component so it's
// unit-testable without rendering React.

export interface ManifestEntry {
  slug: string;
}

export type InitialSlugResult =
  | { slug: string; unavailableSlug: null }
  | { slug: null; unavailableSlug: string }
  | { slug: null; unavailableSlug: null };

/**
 * Decides which statute to load.
 *
 * A `?statute=` link (e.g. from Statute Map's "Read full text in Explorer"
 * button) always wins over the remembered last-viewed slug *when it
 * resolves to something in this Explorer's manifest*. When a link is
 * present but doesn't resolve, that's a genuine "not available in this
 * Explorer" case — the caller must show an error and must NOT fall back to
 * the remembered or first statute, which would silently show the wrong
 * statute's content under the requested one's URL (C-01).
 *
 * With no link at all, the old undirected behavior applies: remembered
 * slug, else the first statute in the manifest.
 */
export function resolveInitialSlug(
  manifest: ManifestEntry[],
  { linkedSlug, remembered }: { linkedSlug: string | null; remembered: string | null },
): InitialSlugResult {
  if (linkedSlug) {
    const found = manifest.find((m) => m.slug === linkedSlug);
    return found
      ? { slug: found.slug, unavailableSlug: null }
      : { slug: null, unavailableSlug: linkedSlug };
  }
  const initial = manifest.find((m) => m.slug === remembered) ?? manifest[0] ?? null;
  return initial ? { slug: initial.slug, unavailableSlug: null } : { slug: null, unavailableSlug: null };
}
