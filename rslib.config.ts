import { defineConfig } from '@rslib/core'

export default defineConfig({
  source: {
    entry: {
      index: './src/index.ts',
    },
    tsconfigPath: './tsconfig.build.json',
  },
  output: {
    cleanDistPath: true,
    distPath: {
      root: './dist',
    },
    sourceMap: {
      js: 'source-map',
    },
    target: 'web',
  },
  lib: [
    {
      autoExternal: {
        dependencies: true,
        optionalDependencies: true,
        peerDependencies: true,
      },
      bundle: true,
      dts: {
        bundle: false,
      },
      format: 'esm',
      redirect: {
        dts: {
          extension: true,
          path: true,
        },
      },
      syntax: 'es2022',
    },
  ],
})
