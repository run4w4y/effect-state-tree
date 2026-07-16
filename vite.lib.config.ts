import { isAbsolute } from 'node:path'
import { defineConfig } from 'vite'

const external = (id: string) =>
  id.startsWith('\0') || (!id.startsWith('.') && !isAbsolute(id))

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
    },
    rollupOptions: {
      external,
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: 'index.js',
      },
    },
    sourcemap: true,
  },
  publicDir: false,
})
