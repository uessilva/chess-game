import { defineConfig } from '@playwright/test';

/**
 * Visual regression gate (task 2.6). Serves the production build through
 * `vite preview` — closer to what ships than the dev server — and runs
 * Chromium only this phase. Committed baselines in
 * `tests/visual/*.spec.ts-snapshots/` are the source of truth: any rendering
 * drift fails the suite with a pixel-diff artifact in `test-results/`.
 * Regenerate intentionally changed captures with
 * `npx playwright test --update-snapshots`.
 */
export default defineConfig({
  testDir: './tests/visual',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      // Absorbs font-antialiasing variance of the unstyled DOM text (status
      // line, game-over banner) between Ubuntu builds — observed ~0.4% of
      // pixels on a cross-machine run while the canvas is pixel-identical.
      // Any real board-level rendering change (a recolored square, a moved
      // sprite, a dropped highlight) shifts far more than 1% of pixels, so
      // the gate still fails loudly on genuine drift.
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL: 'http://localhost:4173',
    browserName: 'chromium',
    viewport: { width: 900, height: 1000 },
    colorScheme: 'light',
    // The board's move glide is rAF/canvas-driven, not CSS, so this cannot
    // stop it — the tests wait out the glide (MOVE_DURATION_MS + margin)
    // before capturing. The option still disables any CSS animation that
    // could land mid-tween at capture time.
    animations: 'disabled',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
