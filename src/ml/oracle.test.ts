import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { algebraicOf, generateLegalMoves, parseFen, toFen } from '../core';
import type { Move, PieceType } from '../core';

/**
 * Cross-language oracle for the ML pipeline (task 4.1).
 *
 * `ml/fixtures/fixture-oracle.jsonl` is emitted by the Python pipeline:
 * one line per position with a canonical FEN and the sorted UCI legal
 * moves. Replaying it through `src/core` proves the Python and
 * TypeScript rules agree on every fixture position, the same
 * known-good-oracle pattern used by the perft fixtures.
 */
interface OracleLine {
  readonly fen: string;
  readonly game: number;
  readonly ply: number;
  readonly moves: string[];
}

const PROMOTION_CHAR: Record<PieceType, string> = {
  pawn: '',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: '',
};

function uci(move: Move): string {
  return (
    algebraicOf(move.from) +
    algebraicOf(move.to) +
    (move.promotion === undefined ? '' : PROMOTION_CHAR[move.promotion])
  );
}

const oracle = readFileSync(
  new URL('../../ml/fixtures/fixture-oracle.jsonl', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => JSON.parse(line) as OracleLine);

describe('ML fixture oracle', () => {
  it('covers all three fixture games', () => {
    expect(new Set(oracle.map((position) => position.game))).toEqual(
      new Set([0, 1, 2]),
    );
    expect(oracle.length).toBeGreaterThan(60);
  });

  it('parses every FEN and round-trips it canonically', () => {
    for (const position of oracle) {
      const state = parseFen(position.fen);
      expect(toFen(state), label(position)).toBe(position.fen);
    }
  });

  it('generates the same legal moves as python-chess', () => {
    for (const position of oracle) {
      const state = parseFen(position.fen);
      const moves = generateLegalMoves(state).map(uci).sort();
      expect(moves, label(position)).toEqual(position.moves);
    }
  });
});

function label(position: OracleLine): string {
  return `game ${position.game} ply ${position.ply} (${position.fen})`;
}
