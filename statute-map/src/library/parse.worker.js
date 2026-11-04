// Parsing the Income Tax Act takes long enough to freeze a tab, so downloaded
// statutes are parsed here, off the main thread.
import { parseContent } from "../../parser/lib/import-logic.js";

self.onmessage = async ({ data: { content, code, sourceUrl } }) => {
  try {
    self.postMessage({ ok: true, ...(await parseContent(content, { code, sourceUrl })) });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
