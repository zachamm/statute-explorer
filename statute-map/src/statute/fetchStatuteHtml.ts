/**
 * Fetches raw statute HTML for documents Justice Laws only publishes as
 * HTML, not XML — the Constitution Acts (including the Charter, Part I
 * of the Constitution Act, 1982) are the motivating case: they predate
 * and sit outside the "Revised Statutes" chapter-numbering system the
 * XML-per-Act pipeline in fetchStatute.ts covers, so there's no
 * `/XML/{code}.xml` for them at all.
 *
 * Same CORS situation as the XML endpoints (`Access-Control-Allow-Origin: *`
 * confirmed on https://laws-lois.justice.gc.ca/eng/Const/page-12.html),
 * so this fetches directly from the browser too.
 */

import { StatuteFetchError } from "./fetchStatute";

export async function fetchStatuteHtml(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new StatuteFetchError(`Network error fetching statute HTML from ${url}.`, url, err);
  }

  if (!res.ok) {
    throw new StatuteFetchError(`Failed to fetch statute HTML: HTTP ${res.status} ${res.statusText}`, url);
  }

  const text = await res.text();

  if (!text.includes('class="wb-txthl"')) {
    throw new StatuteFetchError(
      "Response does not look like a Justice Laws constitutional-document page (no wb-txthl content container found).",
      url
    );
  }

  return text;
}
