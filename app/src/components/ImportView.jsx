import { useState } from "react";
import { importByUrl, importByFile } from "../lib/importApi";

const STATUS = { idle: "idle", loading: "loading", success: "success", error: "error" };

const QUICK_PICKS = [
  { label: "Criminal Code", url: "https://laws-lois.justice.gc.ca/eng/acts/C-46/" },
  { label: "Access to Information Act", url: "https://laws-lois.justice.gc.ca/eng/acts/A-1/" },
  { label: "Interpretation Act", url: "https://laws-lois.justice.gc.ca/eng/acts/I-21/" },
  { label: "Highway Traffic Act (Ontario)", url: "https://www.ontario.ca/laws/statute/90h08" },
  { label: "Employment Standards Act, 2000 (Ontario)", url: "https://www.ontario.ca/laws/statute/00e41" },
];

export default function ImportView({ onImported, onOpenDocs }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState(STATUS.idle);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const runImport = async (fn) => {
    setStatus(STATUS.loading);
    setError(null);
    setResult(null);
    try {
      const body = await fn();
      setResult(body);
      setStatus(STATUS.success);
    } catch (err) {
      setError(err.message);
      setStatus(STATUS.error);
    }
  };

  const handleUrlSubmit = (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    runImport(() => importByUrl(url.trim()));
  };

  const handleFile = (file) => {
    if (!file) return;
    file.text().then((content) => {
      runImport(() => importByFile(file.name, content));
    });
  };

  const handleQuickPick = (pick) => {
    setUrl(pick.url);
    runImport(() => importByUrl(pick.url));
  };

  return (
    <div className="import-view">
      <div className="import-intro">
        <h2>Add a statute</h2>
        <p>
          Paste a link to the statute on its government source, or upload a
          file you already have. Not sure what's accepted?{" "}
          <button type="button" className="link-button" onClick={onOpenDocs}>
            See the Docs tab
          </button>{" "}
          for the URL formats and file types that work.
        </p>
      </div>

      <form className="import-url-form" onSubmit={handleUrlSubmit}>
        <label htmlFor="import-url">Statute URL</label>
        <div className="import-url-row">
          <input
            id="import-url"
            type="url"
            placeholder="https://laws-lois.justice.gc.ca/eng/acts/C-46/ or https://www.ontario.ca/laws/statute/90h08"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" disabled={status === STATUS.loading || !url.trim()}>
            Import
          </button>
        </div>
      </form>

      <div className="import-quick-picks">
        <span className="import-quick-picks-label">Or try one of these:</span>
        <div className="import-quick-picks-list">
          {QUICK_PICKS.map((pick) => (
            <button
              key={pick.url}
              type="button"
              disabled={status === STATUS.loading}
              onClick={() => handleQuickPick(pick)}
            >
              {pick.label}
            </button>
          ))}
        </div>
      </div>

      <div className="import-divider">
        <span>or</span>
      </div>

      <label
        className={`import-dropzone${dragOver ? " is-drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files[0]);
        }}
      >
        <input
          type="file"
          accept=".xml,.json"
          onChange={(e) => handleFile(e.target.files[0])}
          hidden
        />
        <span className="import-dropzone-title">Upload a file</span>
        <span className="import-dropzone-hint">
          A Justice Laws XML file, or an Ontario e-Laws JSON export — drag one
          here or click to browse
        </span>
      </label>

      {status === STATUS.loading && (
        <div className="import-status import-status-loading">Fetching and parsing…</div>
      )}

      {status === STATUS.error && (
        <div className="import-status import-status-error">
          {error}
        </div>
      )}

      {status === STATUS.success && result && (
        <div className="import-status import-status-success">
          <div className="import-result-title">
            {result.title} <span className="import-result-id">({result.id})</span>
          </div>
          <div className="import-result-meta">
            {result.jurisdiction === "federal" ? "Federal" : "Ontario"} ·{" "}
            {result.citation} · {result.partCount} parts, {result.sectionCount}{" "}
            sections
          </div>
          <button
            type="button"
            className="import-open-button"
            onClick={() => onImported(result.slug)}
          >
            Open it →
          </button>
        </div>
      )}
    </div>
  );
}
