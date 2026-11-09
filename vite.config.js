import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:4280' } }
})
