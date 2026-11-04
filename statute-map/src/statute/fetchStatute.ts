/**
 * Fetches raw statute XML from Justice Laws (or any URL serving the same
 * schema). No parsing/processing here — that's parseStatuteXml's job —
 * this module's only concern is getting the bytes.
 *
 * Justice Laws currently serves XML with `Access-Control-Allow-Origin: *`,
 * so a direct browser fetch works without a proxy. If that ever changes
 * and requests start failing with a CORS/network error, swap the fetch
 * call below for one going through a minimal relay proxy — nothing else
 * in this module should need to change.
 */

export class StatuteFetchError extends Error {
  constructor(message: string, readonly url: string, readonly cause?: unknown) {
    super(message);
    this.name = "StatuteFetchError";
  }
}

export async function fetchStatuteXml(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new StatuteFetchError(
      `Network error fetching statute XML from ${url}. If this is a CORS failure, a relay proxy is needed.`,
      url,
      err
    );
  }

  if (!res.ok) {
    throw new StatuteFetchError(`Failed to fetch statute XML: HTTP ${res.status} ${res.statusText}`, url);
  }

  const text = await res.text();

  if (!text.includes("<Statute") && !text.includes("<Regulation")) {
    throw new StatuteFetchError(
      "Response does not look like Justice Laws statute XML (no <Statute> root element found).",
      url
    );
  }

  return text;
}
