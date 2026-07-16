import { fileURLToPath } from 'node:url'
import stylex from '@stylexjs/unplugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const collaborationServer =
  process.env.COLLABORATION_SERVER_URL ?? 'http://127.0.0.1:4313'
const collaborationProxy = {
  '/collaboration': {
    target: collaborationServer,
    ws: true,
  },
}

export default defineConfig({
  root: projectRoot,
  plugins: [stylex.vite({ useCSSLayers: true }), react()],
  optimizeDeps: {
    exclude: ['loro-crdt'],
  },
  server: {
    proxy: collaborationProxy,
  },
  preview: {
    proxy: collaborationProxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
