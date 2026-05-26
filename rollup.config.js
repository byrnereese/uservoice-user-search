import { nodeResolve } from '@rollup/plugin-node-resolve';

const input = 'src/index.js';

const external = []; // no runtime deps — bundle is self-contained

/** @type {import('rollup').RollupOptions[]} */
export default [
  // ESM build
  {
    input,
    external,
    plugins: [nodeResolve()],
    output: {
      file: 'dist/index.mjs',
      format: 'esm',
      sourcemap: true,
      exports: 'named',
    },
  },
  // CommonJS build
  {
    input,
    external,
    plugins: [nodeResolve()],
    output: {
      file: 'dist/index.cjs',
      format: 'cjs',
      sourcemap: true,
      exports: 'named',
    },
  },
];
