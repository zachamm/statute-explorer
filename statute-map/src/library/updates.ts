/**
 * Checks whether a saved statute has a newer official version, by comparing
 * "last amended" dates. Only the start of a federal file is read, since the
 * date is an attribute on its root element. Results are remembered for a day
 * so the government sites aren't asked on every page load.
 */
import type { CatalogEntry } from "./catalog";

const CHECKS_KEY = "statute-map:update-checks";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface Check {
  at: number;
  latest: string;
}

function readChecks(): Record<string, Check> {
  try {
    return JSON.parse(localStorage.getItem(CHECKS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeChecks(checks: Record<string, Check>): void {
  try {
    localStorage.setItem(CHECKS_KEY, JSON.stringify(checks));
  } catch {
    // Without this we'd just check again next time.
  }
}

export function clearUpdateCheck(code: string): void {
  const checks = readChecks();
  delete checks[code];
  writeChecks(checks);
}

export function parseAmendedDate(xml: string): string | null {
  return /lims:lastAmendedDate="([\d-]+)"/.exec(xml)?.[1] ?? null;
}

async function latestFederalDate(code: string): Promise<string | null> {
  const controller = new AbortController();
  const res = await fetch(`https://laws-lois.justice.gc.ca/eng/XML/${code}.xml`, { signal: controller.signal });
  if (!res.ok || !res.body) return null;
  const reader = res.body.getReader();
  const { value } = await reader.read();
  // The rest of a file that can run to tens of megabytes isn't needed.
  controller.abort();
  return value ? parseAmendedDate(new TextDecoder().decode(value)) : null;
}

async function latestOntarioDate(alias: string): Promise<string | null> {
  const res = await fetch(`/api/ontario/${encodeURIComponent(alias)}`);
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
  const { dateFrom } = await res.json();
  return dateFrom ? String(dateFrom).slice(0, 10) : null;
}

/** Returns the newer version's date if there is one, otherwise null. Never
 *  throws: being offline just means no alert. */
export async function checkForUpdate(entry: CatalogEntry, localDate: string | null | undefined): Promise<string | null> {
  // The Charter's only date is when its web page last changed, which says
  // nothing about its text.
  if (!localDate || entry.code === "CHARTER") return null;

  const checks = readChecks();
  const previous = checks[entry.code];
  let latest = previous && Date.now() - previous.at < CHECK_INTERVAL_MS ? previous.latest : null;
  if (!latest) {
    try {
      latest = entry.jurisdiction === "ontario" ? await latestOntarioDate(entry.code) : await latestFederalDate(entry.code);
    } catch {
      return null;
    }
    if (!latest) return null;
    writeChecks({ ...readChecks(), [entry.code]: { at: Date.now(), latest } });
  }
  return latest > localDate ? latest : null;
}
