// Rebuilds public/data/catalog.json, the search index of what legislation
// exists. It holds titles and codes only, never statute text: that's always
// fetched from its government source when someone opens it.
//
// Usage: npm run data
//
// Federal: every Act and regulation, from Justice Laws' own index.
// Ontario: e-Laws publishes no index, so parser/ontario-index.json lists the
// statutes to include. Any other Ontario statute opens by pasting its link.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DOMParser } from "@xmldom/xmldom";
import { parseOntarioJson } from "./lib/parse-ontario-doc.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "../public/data");
const USER_AGENT = "Mozilla/5.0 (compatible; statute-map/1.0)";
// ontario.ca's robots.txt asks for one request per second.
const ONTARIO_DELAY_MS = 1000;

async function download(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

/** `c` code, `t` title, `k` a(ct) or r(egulation), `d` the date it's current
 *  to, `j` "on" for Ontario, `n` citation, `g` the codes of the regulations
 *  made under an Act. Short keys because there are ~5,900. */
async function federalRows() {
  const doc = new DOMParser().parseFromString(
    await download("https://laws-lois.justice.gc.ca/eng/XML/Legis.xml"),
    "text/xml",
  );
  const rows = [];
  const read = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
  // The id comes from the XML link, not <UniqueId>: for older regulations
  // that's "C.R.C., c. 836" while the file is "C.R.C.,_c._836.xml".
  const codeOf = (el) => read(el, "LinkToXML").split("/").pop().replace(/\.xml$/, "");

  const regulationCodes = new Map();
  for (const el of Array.from(doc.getElementsByTagName("Regulation"))) {
    regulationCodes.set(el.getAttribute("id"), codeOf(el));
  }

  for (const [tag, k] of [["Act", "a"], ["Regulation", "r"]]) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) {
      if (read(el, "Language") !== "eng") continue;
      const code = codeOf(el);
      const uniqueId = read(el, "UniqueId");
      const regulations = Array.from(el.getElementsByTagName("Reg"))
        .map((reg) => regulationCodes.get(reg.getAttribute("idRef")))
        .filter(Boolean);
      rows.push({
        c: code,
        t: read(el, "Title"),
        k,
        d: read(el, "CurrentToDate"),
        ...(uniqueId !== code && { n: uniqueId }),
        ...(regulations.length > 0 && { g: regulations }),
      });
    }
  }
  rows.push({ c: "CHARTER", t: "Canadian Charter of Rights and Freedoms", k: "a", d: "", n: "Part I of the Constitution Act, 1982" });
  return rows;
}

async function ontarioRows() {
  const aliases = JSON.parse(readFileSync(path.join(ROOT, "ontario-index.json"), "utf-8"));
  const rows = [];
  for (const alias of aliases) {
    try {
      const json = await download(`https://www.ontario.ca/laws/api/v2/legislation/en/doc-search/statute/${alias}`);
      const { statuteDocument: d } = parseOntarioJson(json);
      rows.push({ c: alias, t: d.title, k: "a", d: d.consolidatedDate ?? "", j: "on", n: d.citation });
    } catch (err) {
      console.warn(`  skipped ${alias}: ${err.message}`);
    }
    await sleep(ONTARIO_DELAY_MS);
  }
  return rows;
}

const federal = await federalRows();
const ontario = await ontarioRows();
const rows = [...federal, ...ontario].sort((a, b) => a.t.localeCompare(b.t));
mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(path.join(DATA_DIR, "catalog.json"), JSON.stringify(rows));
console.log(`catalog: ${federal.length} federal, ${ontario.length} Ontario`);
