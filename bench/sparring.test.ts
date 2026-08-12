import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GAMES,
  DEFAULT_OUR_DEPTH,
  DEFAULT_SF_DEPTH,
  DEFAULT_SF_SKILL,
  formatMatchReport,
  playMatch,
} from './sparring';
import { StockfishClient } from './stockfish';

/**
 * The Stockfish WASM sparring match (task 3.7, #22 — optional part).
 * Runs via `npm run spar` (Vitest with `vitest.sparring.config.ts`),
 * kept out of the default gates like the bench: it loads a ~560 KB wasm
 * engine and plays a full match, so it is opt-in by design.
 *
 * Defaults: 20 games from the start position, our engine alternating
 * colors at fixed depth 4 vs Stockfish at fixed depth 3 and UCI Skill
 * Level 1 — a "limited strength" opponent: shallow enough to be a
 * plausible yardstick, weak enough that the much simpler engine can
 * score. All knobs are overridable with env vars: SPAR_GAMES,
 * SPAR_OUR_DEPTH, SPAR_SF_DEPTH, SPAR_SF_SKILL, and SPAR_REPORT (a
 * file path to also write the report to).
 */
describe('sparring vs Stockfish WASM', () => {
  // A 20-game fixed-depth match takes several minutes; allow an hour so
  // slow machines cannot flake the run.
  it('plays a documented match and reports score, Elo and sample games', async () => {
    const gameCount = Number(process.env.SPAR_GAMES ?? String(DEFAULT_GAMES));
    const ourDepth = Number(
      process.env.SPAR_OUR_DEPTH ?? String(DEFAULT_OUR_DEPTH),
    );
    const sfDepth = Number(
      process.env.SPAR_SF_DEPTH ?? String(DEFAULT_SF_DEPTH),
    );
    const sfSkill = Number(
      process.env.SPAR_SF_SKILL ?? String(DEFAULT_SF_SKILL),
    );

    const stockfish = new StockfishClient();
    await stockfish.init();

    const match = await playMatch(
      stockfish,
      gameCount,
      ourDepth,
      sfDepth,
      sfSkill,
    );

    const report = formatMatchReport(match);
    process.stdout.write(`\n${report}\n\n`);

    const reportFile = process.env.SPAR_REPORT;
    if (reportFile !== undefined) {
      writeFileSync(reportFile, `${report}\n`, 'utf8');
      process.stdout.write(`Report written to ${reportFile}\n`);
    }

    // Acceptance: ≥ 20 games, alternating colors, every game recorded
    // with a move list and a result. (SPAR_GAMES below 20 — a dev smoke
    // run — fails this loudly rather than quietly shipping a short match.)
    expect(gameCount).toBeGreaterThanOrEqual(20);
    expect(match.games.length).toBe(gameCount);
    expect(
      match.games.filter((g) => g.ourColor === 'white').length,
    ).toBeGreaterThanOrEqual(Math.floor(match.games.length / 2));
    expect(
      match.games.filter((g) => g.ourColor === 'black').length,
    ).toBeGreaterThanOrEqual(Math.floor(match.games.length / 2));
    for (const game of match.games) {
      expect(game.moves.length).toBeGreaterThan(0);
      expect(['win', 'draw', 'loss']).toContain(game.outcome);
    }
    expect(match.wins + match.draws + match.losses).toBe(match.games.length);
    expect(match.scorePercent).toBeGreaterThanOrEqual(0);
    expect(match.scorePercent).toBeLessThanOrEqual(100);
    expect(match.eloEstimate).toBeGreaterThanOrEqual(-800);
    expect(match.eloEstimate).toBeLessThanOrEqual(800);
  }, 3_600_000);
});
