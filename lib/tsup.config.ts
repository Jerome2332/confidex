import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/encryption.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
});
