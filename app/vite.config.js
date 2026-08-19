import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { statuteDevApiPlugin } from '../parser/dev-server-plugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), statuteDevApiPlugin()],
})
