// Builds a heading outline (for the docs sidebar's "on this page" nav) from
// raw markdown source. Ids are generated with the same slugger rehype-slug
// uses on the rendered output, so a link here and the actual heading id in
// the DOM always match — get this wrong and every outline link 404s
// against its own page.
import GithubSlugger from "github-slugger";

function stripInlineMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

/** @returns {{ id: string, text: string, depth: 2 | 3 }[]} */
export function extractHeadings(markdown) {
  const slugger = new GithubSlugger();
  const headings = [];
  let inCodeBlock = false;
  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const m = line.match(/^(#{2,3})\s+(.*)$/);
    if (!m) continue;
    const text = stripInlineMarkdown(m[2]);
    headings.push({ id: slugger.slug(text), text, depth: m[1].length });
  }
  return headings;
}
