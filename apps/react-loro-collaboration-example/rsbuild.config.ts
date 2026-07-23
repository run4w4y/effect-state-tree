import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import stylex from 'unplugin-stylex/rspack'

const collaborationServer =
  process.env.COLLABORATION_SERVER_URL ?? 'http://127.0.0.1:4313'

export default defineConfig({
  html: {
    tags:
      process.env.NODE_ENV === 'production'
        ? [
            {
              attrs: {
                href: '/stylex.css',
                rel: 'stylesheet',
              },
              head: true,
              tag: 'link',
            },
          ]
        : [],
    template: './index.html',
  },
  output: {
    cleanDistPath: true,
    distPath: {
      root: './dist',
    },
    sourceMap: {
      js: 'source-map',
    },
  },
  plugins: [pluginReact()],
  server: {
    proxy: {
      '/collaboration': {
        target: collaborationServer,
        ws: true,
      },
    },
  },
  source: {
    entry: {
      index: './src/main.tsx',
    },
    tsconfigPath: './tsconfig.json',
  },
  tools: {
    rspack: {
      plugins: [
        stylex({
          stylex: {
            useCSSLayers: true,
          },
        }),
      ],
    },
  },
})
