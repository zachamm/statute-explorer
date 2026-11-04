/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { statuteDevApiPlugin } from "./parser/dev-server-plugin.js";

export default defineConfig({
  plugins: [react(), statuteDevApiPlugin()],
  server: {
    port: Number(process.env.PORT) || 5173
  },
  // The parse worker lazily imports the Ontario parser, which needs ES workers.
  worker: {
    format: "es"
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"]
  }
});
