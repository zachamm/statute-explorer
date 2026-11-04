import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDatabaseForTests } from "../src/db/database";
import { getCachedStatuteSource, getOrFetchStatuteSource, setCachedStatuteSource } from "../src/db/statuteCache";
import { StatuteFetchError } from "../src/statute/fetchStatute";

function fakeStatuteXml(code: string, shortTitle: string): string {
  return `<?xml version="1.0"?><Statute xmlns:lims="http://justice.gc.ca/lims"><Identification><LongTitle>An Act for testing</LongTitle><ShortTitle>${shortTitle}</ShortTitle><Chapter><ConsolidatedNumber>${code}</ConsolidatedNumber></Chapter></Identification><Body><Section><MarginalNote>Short title</MarginalNote><Label>1</Label><Text>This Act may be cited as the ${shortTitle}.</Text></Section></Body></Statute>`;
}

function fakeCharterHtml(): string {
  return '<div class="wb-txthl"><section><h2 class="Part"><span class="HLabel1">PART I</span><span class="HTitleText1">Test Charter</span></h2><p class="Section"><strong><a class="sectionLabel" id="s-1"><span class="sectionLabel">1</span></a></strong> Test.</p></section></div>';
}

function stubFetch(content: string, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Not Found",
    text: () => Promise.resolve(content),
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

describe("statuteCache", () => {
  it("returns undefined for a statute that hasn't been cached", async () => {
    expect(await getCachedStatuteSource("X-1")).toBeUndefined();
  });

  it("round-trips a cache entry through set/get", async () => {
    const xml = fakeStatuteXml("X-1", "Test Act");
    await setCachedStatuteSource({
      code: "X-1",
      sourceType: "xml",
      content: xml,
      sourceUrl: "https://example.test/X-1.xml",
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });
    const cached = await getCachedStatuteSource("X-1");
    expect(cached?.content).toBe(xml);
    expect(cached?.sourceUrl).toBe("https://example.test/X-1.xml");
  });

  it("fetches and caches on a miss, then reuses the cache on a hit without fetching again", async () => {
    const xml = fakeStatuteXml("C-46", "Criminal Code");
    const fetchMock = stubFetch(xml);

    const first = await getOrFetchStatuteSource("C-46");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.content).toBe(xml);
    expect(first.sourceType).toBe("xml");

    const second = await getOrFetchStatuteSource("C-46");
    expect(fetchMock).toHaveBeenCalledTimes(1); // still 1 — no redundant fetch
    expect(second.content).toBe(xml);
    expect(second.fetchedAt).toBe(first.fetchedAt); // same cached entry, not refetched
  });

  it("propagates a fetch failure as StatuteFetchError rather than caching a bad result", async () => {
    stubFetch("", false, 404);
    await expect(getOrFetchStatuteSource("NOPE")).rejects.toThrow(StatuteFetchError);
    expect(await getCachedStatuteSource("NOPE")).toBeUndefined();
  });

  it("uses xmlUrlForCode as the default source URL when none is given", async () => {
    const fetchMock = stubFetch(fakeStatuteXml("C-46", "Criminal Code"));
    await getOrFetchStatuteSource("C-46");
    expect(fetchMock).toHaveBeenCalledWith("https://laws-lois.justice.gc.ca/eng/XML/C-46.xml");
  });

  it('fetches via the HTML pipeline (not XML) when sourceType is "html", using the given URL', async () => {
    const html = fakeCharterHtml();
    const fetchMock = stubFetch(html);

    const entry = await getOrFetchStatuteSource("CHARTER", "html", "https://laws-lois.justice.gc.ca/eng/Const/page-12.html");
    expect(fetchMock).toHaveBeenCalledWith("https://laws-lois.justice.gc.ca/eng/Const/page-12.html");
    expect(entry.sourceType).toBe("html");
    expect(entry.content).toBe(html);

    // Cached — a second call doesn't refetch.
    await getOrFetchStatuteSource("CHARTER", "html", "https://laws-lois.justice.gc.ca/eng/Const/page-12.html");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
