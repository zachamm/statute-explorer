// Polyfills global `indexedDB`/`IDBKeyRange` for the test environment.
// jsdom itself doesn't implement IndexedDB — this is a standard,
// dev-only test polyfill, not a runtime dependency of the app.
import "fake-indexeddb/auto";
