import { fileURLToPath } from 'node:url'
import stylex from '@stylexjs/unplugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: projectRoot,
  plugins: [stylex.vite({ useCSSLayers: true }), react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
