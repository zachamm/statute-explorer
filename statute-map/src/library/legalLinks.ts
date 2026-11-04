/** McGill-style citations and CanLII links for a section of a statute. */

export interface CitableStatute {
  title: string;
  citation?: string | null;
  jurisdiction?: string;
}

const CHARTER_SOURCE = "Part I of the Constitution Act, 1982, being Schedule B to the Canada Act 1982 (UK), 1982, c 11";

/** "R.S.C., 1985, c. C-46" -> "RSC 1985, c C-46". McGill drops the periods
 *  and the comma after the volume, and abbreviates "Sched." to "Sch". */
export function mcgillSource(citation: string): string {
  return citation
    .replace(/\bR\.S\.C\.,?/g, "RSC")
    .replace(/\bR\.S\.O\.,?/g, "RSO")
    .replace(/\bS\.C\.,?/g, "SC")
    .replace(/\bS\.O\.,?/g, "SO")
    .replace(/\bC\.R\.C\./g, "CRC")
    .replace(/\bc\.\s*/g, "c ")
    .replace(/\bSched\.\s*/g, "Sch ")
    .replace(/\((\w+) Supp\.\)/g, "($1 Supp)")
    .trim();
}

export function buildCitation(statute: CitableStatute, sectionNumber: string | null): { title: string; rest: string } {
  const pinpoint = sectionNumber ? `s ${sectionNumber}` : "";
  if (statute.citation?.includes("Constitution Act, 1982")) {
    return { title: statute.title, rest: [pinpoint, CHARTER_SOURCE].filter(Boolean).join(", ") };
  }
  const source = statute.citation ? mcgillSource(statute.citation) : "";
  return { title: statute.title, rest: [source, pinpoint].filter(Boolean).join(", ") };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Copies with the title in italics where the destination supports it, like a
 *  word processor, and as plain text everywhere else. */
export async function copyCitation(statute: CitableStatute, sectionNumber: string | null): Promise<void> {
  const { title, rest } = buildCitation(statute, sectionNumber);
  const plain = `${title}${rest ? `, ${rest}` : ""}`;
  const html = `<i>${escapeHtml(title)}</i>${rest ? `, ${escapeHtml(rest)}` : ""}`;
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plain], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Falls through to plain text, which more browsers allow.
    }
  }
  await navigator.clipboard.writeText(plain);
}

/** A CanLII search for decisions mentioning this section of this statute. */
export function casesUrl(title: string, sectionNumber: string | null): string {
  const act = title.replace(/,\s*\d{4}$/, "");
  const query = sectionNumber ? `"${act}" /p ("s. ${sectionNumber}" OR "section ${sectionNumber}")` : `"${act}"`;
  return `https://www.canlii.org/en/#search/type=decision&text=${encodeURIComponent(query)}`;
}
