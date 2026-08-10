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
      // The pixel comparison covers the board canvas only (512x512 = 262,144
      // px); text is asserted semantically via `toHaveText`, so there is no
      // font-AA variance to absorb. A tiny 0.1% allowance (262 px) stays as a
      // safety net against rare canvas sub-pixel jitter while keeping the gate
      // sharp: a single recolored 64x64 square = 4,096 px = 1.56% of the
      // frame, ~15.6x over the threshold, so the spec's canonical "wrong
      // square color" break fails loudly with a pixel-diff artifact.
      maxDiffPixelRatio: 0.001,
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
