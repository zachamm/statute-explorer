export function slugify(s: string): string;
export function detectFromUrl(url: string): { jurisdiction: "federal" | "ontario"; identifier: string } | null;
export function detectFromContent(content: string): "federal" | "ontario" | "charter" | null;
export function parseContent(content: string, options?: { code?: string; sourceUrl?: string }): Promise<{ slug: string; statuteDocument: any }>;
