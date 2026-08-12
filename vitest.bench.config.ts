import { defineConfig } from 'vitest/config';

/**
 * Bench-only Vitest invocation (`npm run bench`). The nodes/sec bench is
 * opt-in by design: it measures wall time and runs fixed-depth searches
 * for minutes, so it must never execute under `npm test`, `npm run
 * check`, or CI. The default config (vite.config.ts) excludes `bench/**`
 * entirely; this config is the only way the bench tests are discovered.
 */
export default defineConfig({
  test: {
    include: ['bench/bench.test.ts', 'bench/bench.unit.test.ts'],
  },
});
