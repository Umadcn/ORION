import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The backend source uses ESM-style `.js` import specifiers that actually point
 * at `.ts` files (standard for NodeNext). Vite/Vitest does not resolve that by
 * default, so this small plugin maps `./foo.js` → `./foo.ts` when the .ts exists.
 */
export default defineConfig({
  plugins: [
    {
      name: 'orion-js-to-ts',
      enforce: 'pre',
      resolveId(source, importer) {
        // Treat the newer node:sqlite builtin as external (Vite's bundled
        // builtin list may not know it yet).
        if (source === 'node:sqlite') return { id: 'node:sqlite', external: true };
        if (importer && source.startsWith('.') && source.endsWith('.js')) {
          const candidate = path.resolve(path.dirname(importer), source.replace(/\.js$/, '.ts'));
          if (fs.existsSync(candidate)) return candidate;
        }
        return null;
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    server: {
      // Load node:sqlite via the native Node loader instead of bundling it.
      deps: { external: [/node:sqlite/, /^sqlite$/] },
    },
    env: {
      ORION_DB_FILE: ':memory:',
      ORION_INTEGRATION_MODE: 'OFFLINE_FIXTURE',
    },
  },
});
