import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// A new id every build. It's baked into the page and written to
// /version.json, so an open page can tell a newer build is out (src/version.ts).
const buildID = Date.now().toString(36)

export default defineConfig({
  plugins: [react(), {
    name: 'version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildID }) })
    },
  }],
  define: { __BUILD_ID__: JSON.stringify(buildID) },
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:8080' }, // the Go server, during development
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
})
