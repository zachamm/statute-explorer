import { idbDelete, idbGet, idbPut, STATUTE_CACHE_STORE } from "./database";
import { fetchStatuteXml } from "../statute/fetchStatute";
import { fetchStatuteHtml } from "../statute/fetchStatuteHtml";
import { xmlUrlForCode, type StatuteSourceType } from "../statute/lookup";
import type { CachedStatuteSource } from "./types";

/** The shared, cross-project statute cache — "fetched once, reused
 *  across projects" per the spec. Keyed by statute code so two projects
 *  that both load the Criminal Code share one copy of its XML. Holds
 *  both XML-sourced and HTML-sourced (e.g. the Charter) statutes. */

export async function getCachedStatuteSource(code: string): Promise<CachedStatuteSource | undefined> {
  return idbGet<CachedStatuteSource>(STATUTE_CACHE_STORE, code);
}

export async function setCachedStatuteSource(entry: CachedStatuteSource): Promise<void> {
  return idbPut(STATUTE_CACHE_STORE, entry);
}

// Two overlapping requests for the same uncached statute share one download.
const inFlight = new Map<string, Promise<CachedStatuteSource>>();

export async function deleteCachedStatuteSource(code: string): Promise<void> {
  return idbDelete(STATUTE_CACHE_STORE, code);
}

/** Returns a statute's cached source, fetching (XML or HTML, per
 *  `sourceType`) and caching the result only when it isn't already
 *  cached. `sourceType`/`sourceUrl` default to the ordinary XML pipeline
 *  so existing single-argument call sites keep working unchanged. */
export async function getOrFetchStatuteSource(
  code: string,
  sourceType: StatuteSourceType = "xml",
  sourceUrl?: string
): Promise<CachedStatuteSource> {
  const cached = await getCachedStatuteSource(code);
  if (cached) return cached;

  const pending = inFlight.get(code);
  if (pending) return pending;

  const request = (async () => {
    const url = sourceUrl ?? xmlUrlForCode(code);
    const content = sourceType === "html" ? await fetchStatuteHtml(url) : await fetchStatuteXml(url);
    const entry: CachedStatuteSource = { code, sourceType, content, sourceUrl: url, fetchedAt: new Date().toISOString() };
    await setCachedStatuteSource(entry);
    return entry;
  })();
  inFlight.set(code, request);
  try {
    return await request;
  } finally {
    inFlight.delete(code);
  }
}
