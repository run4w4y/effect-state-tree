import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import stylex from 'unplugin-stylex/rspack'

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
