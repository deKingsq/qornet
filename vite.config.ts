import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/qornet/' : '/',
  plugins: [react()],
  build: { rollupOptions: { input: { project: page('./index.html'), demo: page('./demo/index.html'), app: page('./app/index.html') } } },
  server: { proxy: { '/api': 'http://127.0.0.1:4174' } },
}))
