import { describe, expect, it } from 'vitest';

import { squareFromAlgebraic } from './board';
import { parseFen, START_FEN, toFen } from './fen';
import { initialState } from './state';
import { PIECES } from './types';

describe('parseFen', () => {
  it('parses the initial position to the same state as initialState()', () => {
    expect(parseFen(START_FEN)).toEqual(initialState());
  });

  it('places the shared piece singletons', () => {
    const state = parseFen(START_FEN);
    expect(state.board[squareFromAlgebraic('e1')]).toBe(PIECES.white.king);
    expect(state.board[squareFromAlgebraic('d8')]).toBe(PIECES.black.queen);
  });

  it('parses every field into state', () => {
    const state = parseFen(
      'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2',
    );
    expect(state.turn).toBe('white');
    expect(state.castling).toEqual({
      whiteKingside: true,
      whiteQueenside: true,
      blackKingside: true,
      blackQueenside: true,
    });
    expect(state.enPassant).toBe(squareFromAlgebraic('d6'));
    expect(state.halfmoveClock).toBe(0);
    expect(state.fullmoveNumber).toBe(2);
    expect(state.history).toEqual([]);
  });

  it('accepts castling rights in any order', () => {
    const state = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w qkQK - 0 1');
    expect(state.castling).toEqual({
      whiteKingside: true,
      whiteQueenside: true,
      blackKingside: true,
      blackQueenside: true,
    });
  });

  it('tolerates extra whitespace around and between fields', () => {
    const padded = '  4k3/8/8/8/8/8/8/4K3   b   - -  12   34  ';
    expect(parseFen(padded)).toEqual(
      parseFen('4k3/8/8/8/8/8/8/4K3 b - - 12 34'),
    );
  });
});

describe('toFen', () => {
  it('serializes the initial position', () => {
    expect(toFen(initialState())).toBe(START_FEN);
  });

  it('emits castling rights in canonical KQkq order', () => {
    const state = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w qkQK - 0 1');
    expect(toFen(state)).toBe('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  });
});

describe('round-trip', () => {
  // Includes the standard perft fixture positions, reused as regression
  // fixtures when perft lands in task 1.9.
  const cases = [
    { name: 'initial position', fen: START_FEN },
    {
      name: 'after 1.e4 (en-passant target on rank 3)',
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    },
    {
      name: 'en-passant target on rank 6',
      fen: 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2',
    },
    {
      name: 'kiwipete',
      fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    },
    {
      name: 'perft position 3 (endgame, no rights)',
      fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    },
    {
      name: 'perft position 4 (promotions-heavy)',
      fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    },
    {
      name: 'perft position 5 (partial rights)',
      fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    },
    {
      name: 'perft position 6',
      fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    },
    {
      name: 'bare kings, large clocks',
      fen: '4k3/8/8/8/8/8/8/4K3 b - - 99 250',
    },
  ];

  it.each(cases)('$name', ({ fen }) => {
    expect(toFen(parseFen(fen))).toBe(fen);
  });
});

describe('parseFen rejects invalid input', () => {
  const cases = [
    {
      name: 'too few fields',
      fen: '4k3/8/8/8/8/8/8/4K3 w - - 0',
      message: /expected 6 fields, got 5/,
    },
    {
      name: 'too many fields',
      fen: `${START_FEN} extra`,
      message: /expected 6 fields, got 7/,
    },
    {
      name: 'too few ranks',
      fen: '8/8/8/4k3/8/8/4K3 w - - 0 1',
      message: /piece placement must have 8 ranks, got 7/,
    },
    {
      name: 'too many ranks',
      fen: '8/8/8/8/4k3/8/8/8/4K3 w - - 0 1',
      message: /piece placement must have 8 ranks, got 9/,
    },
    {
      name: 'rank too narrow',
      fen: '7/8/8/4k3/8/8/8/4K3 w - - 0 1',
      message: /rank 8 has 7 squares, expected 8/,
    },
    {
      name: 'rank too wide',
      fen: 'PPPPPPPPP/8/8/4k3/8/8/8/4K3 w - - 0 1',
      message: /rank 8 has 9 squares, expected 8/,
    },
    {
      name: 'unknown piece character',
      fen: '8/8/8/4x3/8/8/8/4K2k w - - 0 1',
      message: /unexpected character "x" in piece placement/,
    },
    {
      name: 'zero is not a valid empty run',
      fen: '10/8/8/4k3/8/8/8/4K3 w - - 0 1',
      message: /unexpected character "0" in piece placement/,
    },
    {
      name: 'missing white king',
      fen: '8/8/8/4k3/8/8/8/8 w - - 0 1',
      message: /exactly one king per side, got 0 white and 1 black/,
    },
    {
      name: 'missing black king',
      fen: '8/8/8/8/8/8/8/4K3 w - - 0 1',
      message: /exactly one king per side, got 1 white and 0 black/,
    },
    {
      name: 'two white kings',
      fen: '8/8/8/4k3/8/8/8/3KK3 w - - 0 1',
      message: /exactly one king per side, got 2 white and 1 black/,
    },
    {
      name: 'invalid side to move',
      fen: '4k3/8/8/8/8/8/8/4K3 x - - 0 1',
      message: /side to move must be "w" or "b", got "x"/,
    },
    {
      name: 'invalid castling character',
      fen: '4k3/8/8/8/8/8/8/4K3 w Kx - 0 1',
      message: /unexpected character "x" in castling rights/,
    },
    {
      name: 'duplicate castling right',
      fen: '4k3/8/8/8/8/8/8/4K3 w KK - 0 1',
      message: /duplicate "K" in castling rights/,
    },
    {
      name: 'malformed en-passant square',
      fen: '4k3/8/8/8/8/8/8/4K3 w - e9 0 1',
      message: /malformed en-passant square "e9"/,
    },
    {
      name: 'en-passant square on wrong rank',
      fen: '4k3/8/8/8/8/8/8/4K3 w - e4 0 1',
      message: /en-passant square "e4" must be on rank 3 or 6/,
    },
    {
      name: 'negative halfmove clock',
      fen: '4k3/8/8/8/8/8/8/4K3 w - - -1 1',
      message: /halfmove clock must be a whole number, got "-1"/,
    },
    {
      name: 'non-numeric halfmove clock',
      fen: '4k3/8/8/8/8/8/8/4K3 w - - x 1',
      message: /halfmove clock must be a whole number, got "x"/,
    },
    {
      name: 'zero fullmove number',
      fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 0',
      message: /fullmove number must be at least 1, got 0/,
    },
    {
      name: 'non-numeric fullmove number',
      fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 one',
      message: /fullmove number must be a whole number, got "one"/,
    },
  ];

  it.each(cases)('$name', ({ fen, message }) => {
    expect(() => parseFen(fen)).toThrow(message);
  });
});
