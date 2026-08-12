import { defineConfig } from 'vitest/config';

/**
 * Sparring-only Vitest invocation (`npm run spar`). Loads Stockfish WASM
 * (~560 KB) and plays a full multi-game match — minutes of wall time and
 * a real dependency, so it is opt-in like the bench and excluded from
 * the default gates via vite.config.ts.
 */
export default defineConfig({
  test: {
    include: ['bench/sparring.test.ts'],
  },
});
