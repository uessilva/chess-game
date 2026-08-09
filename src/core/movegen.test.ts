import { describe, expect, it } from 'vitest';

import { algebraicOf, squareFromAlgebraic } from './board';
import { parseFen, toFen } from './fen';
import { generatePseudoLegalMoves } from './index';
import { makeMove, unmakeMove } from './move';
import type { BoardState } from './state';
import type { Move } from './types';
import { MoveFlags, PIECES } from './types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE_FEN =
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

/** Every generated move as an algebraic `from->to` key with its flags. */
function moveMap(state: BoardState): Map<string, number> {
  const moves = generatePseudoLegalMoves(state)
    .map((m) => ({
      from: algebraicOf(m.from),
      to: algebraicOf(m.to),
      flags: m.flags,
    }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return new Map(moves.map((m) => [`${m.from}->${m.to}`, m.flags]));
}

/** Moves of the piece on `from`, keyed `from->to` → flags. */
function movesFrom(state: BoardState, from: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, flags] of moveMap(state)) {
    if (key.startsWith(`${from}->`)) {
      out.set(key, flags);
    }
  }
  return out;
}

/**
 * All generated moves with the given from/to pair. `moveMap` keys by
 * `from->to`, so the four promotion variants collide on one key — inspect
 * the Move objects directly via this helper instead.
 */
function movesTo(state: BoardState, from: string, to: string): Move[] {
  return generatePseudoLegalMoves(state).filter(
    (m) => algebraicOf(m.from) === from && algebraicOf(m.to) === to,
  );
}

/** Assert the exact pseudo-legal move set of a position. */
function expectExactMoves(state: BoardState, expected: string[]): void {
  expect([...moveMap(state).keys()].sort()).toEqual([...expected].sort());
}

describe('generatePseudoLegalMoves', () => {
  it('is exported from src/core', () => {
    expect(generatePseudoLegalMoves).toBeTypeOf('function');
  });
});

describe('sliders', () => {
  it('stops bishop rays before friendlies and on the first capture', () => {
    const state = parseFen('k7/8/5r2/2P5/3B4/8/8/4K3 w - - 0 1');
    expectExactMoves(state, [
      'c5->c6',
      'd4->a1',
      'd4->b2',
      'd4->c3',
      'd4->e3',
      'd4->e5',
      'd4->f2',
      'd4->f6',
      'd4->g1',
      'e1->d1',
      'e1->d2',
      'e1->e2',
      'e1->f1',
      'e1->f2',
    ]);
    expect(moveMap(state).get('d4->f6')).toBe(MoveFlags.CAPTURE);
    expect(generatePseudoLegalMoves(state)).toHaveLength(14);
  });

  it('walks a corner rook along the file to the first capture and the rank to the friendly king', () => {
    const state = parseFen('7k/8/8/n7/8/8/8/R6K w - - 0 1');
    expectExactMoves(state, [
      'a1->a2',
      'a1->a3',
      'a1->a4',
      'a1->a5',
      'a1->b1',
      'a1->c1',
      'a1->d1',
      'a1->e1',
      'a1->f1',
      'a1->g1',
      'h1->g1',
      'h1->g2',
      'h1->h2',
    ]);
    expect(moveMap(state).get('a1->a5')).toBe(MoveFlags.CAPTURE);
    expect(generatePseudoLegalMoves(state)).toHaveLength(13);
  });

  it('combines rook and bishop rays for the queen, capturing the first enemy on the diagonal', () => {
    const state = parseFen('7k/8/8/7b/8/8/8/K2Q4 w - - 0 1');
    expectExactMoves(state, [
      'a1->a2',
      'a1->b1',
      'a1->b2',
      'd1->a4',
      'd1->b1',
      'd1->b3',
      'd1->c1',
      'd1->c2',
      'd1->d2',
      'd1->d3',
      'd1->d4',
      'd1->d5',
      'd1->d6',
      'd1->d7',
      'd1->d8',
      'd1->e1',
      'd1->e2',
      'd1->f1',
      'd1->f3',
      'd1->g1',
      'd1->g4',
      'd1->h1',
      'd1->h5',
    ]);
    expect(moveMap(state).get('d1->h5')).toBe(MoveFlags.CAPTURE);
    expect(generatePseudoLegalMoves(state)).toHaveLength(23);
  });
});

describe('knight', () => {
  it('jumps a crowded ring, skipping only friendly or off-board targets', () => {
    const state = parseFen('7k/8/2p1p3/2ppp3/2pNp3/2ppp3/2P1P3/K7 w - - 0 1');
    expectExactMoves(state, [
      'a1->a2',
      'a1->b1',
      'a1->b2',
      'c2->d3',
      'd4->b3',
      'd4->b5',
      'd4->c6',
      'd4->e6',
      'd4->f3',
      'd4->f5',
      'e2->d3',
    ]);
    expect(moveMap(state).get('d4->c6')).toBe(MoveFlags.CAPTURE);
    expect(moveMap(state).get('d4->e6')).toBe(MoveFlags.CAPTURE);
    expect(moveMap(state).get('d4->b3')).toBe(0);
    expect(generatePseudoLegalMoves(state)).toHaveLength(11);
  });
});

describe('king', () => {
  it('moves to all adjacent squares with no king-safety filtering', () => {
    const state = parseFen('8/8/4k3/8/4K3/8/8/8 w - - 0 1');
    expectExactMoves(state, [
      'e4->d3',
      'e4->d4',
      'e4->d5',
      'e4->e3',
      'e4->e5',
      'e4->f3',
      'e4->f4',
      'e4->f5',
    ]);
    expect(generatePseudoLegalMoves(state)).toHaveLength(8);
  });
});

describe('pawns', () => {
  it('pushes once, double-pushes from the start rank, and captures diagonally (white)', () => {
    const state = parseFen('7k/8/8/8/8/3n4/4P3/K7 w - - 0 1');
    const pawn = movesFrom(state, 'e2');
    expect([...pawn.keys()].sort()).toEqual(['e2->d3', 'e2->e3', 'e2->e4']);
    expect(pawn.get('e2->e4')).toBe(MoveFlags.DOUBLE_PUSH);
    expect(pawn.get('e2->d3')).toBe(MoveFlags.CAPTURE);
    expect(pawn.get('e2->e3')).toBe(0);
  });

  it('pushes down the board for black, double-pushing from its start rank', () => {
    const state = parseFen('k7/3p4/4B3/8/8/8/8/7K b - - 0 1');
    const pawn = movesFrom(state, 'd7');
    expect([...pawn.keys()].sort()).toEqual(['d7->d5', 'd7->d6', 'd7->e6']);
    expect(pawn.get('d7->d5')).toBe(MoveFlags.DOUBLE_PUSH);
    expect(pawn.get('d7->e6')).toBe(MoveFlags.CAPTURE);
    expect(pawn.get('d7->d6')).toBe(0);
  });

  it('expands a 7th-rank pawn push into four promotion variants', () => {
    const state = parseFen('7k/P7/8/8/8/8/8/K7 w - - 0 1');
    const promotions = movesTo(state, 'a7', 'a8');
    expect(promotions).toHaveLength(4);
    for (const move of promotions) {
      expect(move.piece).toBe('pawn');
      expect(move.flags).toBe(MoveFlags.PROMOTION);
    }
    expect(promotions.map((m) => m.promotion).sort()).toEqual([
      'bishop',
      'knight',
      'queen',
      'rook',
    ]);
  });

  it('never pushes (or double-pushes) onto an occupied square', () => {
    const state = parseFen('7k/8/8/8/4n3/4n3/4P3/K7 w - - 0 1');
    expect([...movesFrom(state, 'e2').keys()]).toEqual([]);
  });

  it('skips the double push when the destination square is occupied', () => {
    const state = parseFen('7k/8/8/8/4n3/8/4P3/K7 w - - 0 1');
    expect([...movesFrom(state, 'e2').keys()]).toEqual(['e2->e3']);
  });

  it('does not capture diagonally onto a friendly piece', () => {
    const state = parseFen('7k/8/8/8/8/5N2/4P3/K7 w - - 0 1');
    const pawn = movesFrom(state, 'e2');
    expect([...pawn.keys()].sort()).toEqual(['e2->e3', 'e2->e4']);
    expect(pawn.get('e2->e4')).toBe(MoveFlags.DOUBLE_PUSH);
  });

  it('generates no push for a pawn stranded on the back rank', () => {
    const state = parseFen('P6k/8/8/8/8/8/8/K7 w - - 0 1');
    expect([...movesFrom(state, 'a8').keys()]).toEqual([]);
  });
});

describe('castling generation', () => {
  it('emits both white castles on Kiwipete with the right flags', () => {
    const state = parseFen(KIWIPETE_FEN);
    expect(movesFrom(state, 'e1').get('e1->g1')).toBe(MoveFlags.CASTLE_KING);
    expect(movesFrom(state, 'e1').get('e1->c1')).toBe(MoveFlags.CASTLE_QUEEN);
  });

  it('emits both black castles from a symmetric black-to-move position', () => {
    const state = parseFen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
    expect(movesFrom(state, 'e8').get('e8->g8')).toBe(MoveFlags.CASTLE_KING);
    expect(movesFrom(state, 'e8').get('e8->c8')).toBe(MoveFlags.CASTLE_QUEEN);
  });

  it('does not castle when the right is not held', () => {
    const state = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1');
    expect(movesFrom(state, 'e1').has('e1->g1')).toBe(false);
    expect(movesFrom(state, 'e1').has('e1->c1')).toBe(false);
  });

  it('does not castle when the rook is missing despite the right', () => {
    const state = parseFen('4k3/8/8/8/8/8/8/4K3 w KQ - 0 1');
    expect(movesFrom(state, 'e1').has('e1->g1')).toBe(false);
    expect(movesFrom(state, 'e1').has('e1->c1')).toBe(false);
  });

  it('castles only the side whose rook is on its home square', () => {
    const onlyKingside = parseFen('4k3/8/8/8/8/8/8/4K2R w KQ - 0 1');
    expect(movesFrom(onlyKingside, 'e1').get('e1->g1')).toBe(
      MoveFlags.CASTLE_KING,
    );
    expect(movesFrom(onlyKingside, 'e1').has('e1->c1')).toBe(false);

    const onlyQueenside = parseFen('4k3/8/8/8/8/8/8/R3K3 w KQ - 0 1');
    expect(movesFrom(onlyQueenside, 'e1').get('e1->c1')).toBe(
      MoveFlags.CASTLE_QUEEN,
    );
    expect(movesFrom(onlyQueenside, 'e1').has('e1->g1')).toBe(false);
  });

  it('does not castle when the king is not on its home square', () => {
    const state = parseFen('4k3/8/8/8/8/8/8/5K1R w K - 0 1');
    const toG1 = movesTo(state, 'f1', 'g1');
    expect(toG1).toHaveLength(1);
    expect(toG1[0].flags).toBe(0); // a plain king step, not CASTLE_KING
  });

  it('does not castle through an occupied square between king and rook', () => {
    const cases = [
      ['4k3/8/8/8/8/8/8/4KB1R w K - 0 1', 'e1->g1'], // f1 blocked
      ['4k3/8/8/8/8/8/8/4K1BR w K - 0 1', 'e1->g1'], // g1 blocked
      ['4k3/8/8/8/8/8/8/1B2K2R w Q - 0 1', 'e1->c1'], // b1 blocked
      ['4k3/8/8/8/8/8/8/2B1K2R w Q - 0 1', 'e1->c1'], // c1 blocked
      ['4k3/8/8/8/8/8/8/3BK2R w Q - 0 1', 'e1->c1'], // d1 blocked
    ] as const;
    for (const [fen, castle] of cases) {
      expect(moveMap(parseFen(fen)).has(castle)).toBe(false);
    }
  });

  it('make/unmake round-trips a castle and toFen reflects the surviving rights', () => {
    const state = parseFen(KIWIPETE_FEN);
    makeMove(state, movesTo(state, 'e1', 'g1')[0]);
    expect(state.board[squareFromAlgebraic('g1')]).toBe(PIECES.white.king);
    expect(state.board[squareFromAlgebraic('f1')]).toBe(PIECES.white.rook);
    expect(state.board[squareFromAlgebraic('h1')]).toBeNull();
    expect(toFen(state).split(' ')[2]).toBe('kq');
    unmakeMove(state);
    expect(state.board[squareFromAlgebraic('e1')]).toBe(PIECES.white.king);
    expect(state.board[squareFromAlgebraic('h1')]).toBe(PIECES.white.rook);
    expect(state.board[squareFromAlgebraic('g1')]).toBeNull();
    expect(toFen(state).split(' ')[2]).toBe('KQkq');
  });
});

describe('en passant generation', () => {
  it('captures to the recorded square the ply after a double push', () => {
    const state = parseFen('7k/3p4/8/4P3/8/8/8/K7 b - - 0 1');
    makeMove(state, movesTo(state, 'd7', 'd5')[0]);
    expect(state.enPassant).toBe(squareFromAlgebraic('d6'));
    const ep = movesTo(state, 'e5', 'd6');
    expect(ep).toHaveLength(1);
    expect(ep[0].flags).toBe(MoveFlags.CAPTURE | MoveFlags.EN_PASSANT);
  });

  it('captures for black, one file over the recorded square', () => {
    const state = parseFen('k7/8/8/8/3pP3/8/8/K7 b - e3 0 1');
    const ep = movesTo(state, 'd4', 'e3');
    expect(ep).toHaveLength(1);
    expect(ep[0].flags).toBe(MoveFlags.CAPTURE | MoveFlags.EN_PASSANT);
  });

  it('includes the pinned en-passant capture in the pseudo-legal list', () => {
    const state = parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 b - - 0 1');
    makeMove(state, movesTo(state, 'c7', 'c5')[0]);
    expect(state.enPassant).toBe(squareFromAlgebraic('c6'));
    expect(moveMap(state).get('b5->c6')).toBe(
      MoveFlags.CAPTURE | MoveFlags.EN_PASSANT,
    );
  });

  it('generates no ep capture without a recorded en-passant square', () => {
    const state = parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
    expect(moveMap(state).has('b5->c6')).toBe(false);
  });

  it('generates no ep capture when the pawn is on the wrong rank or file', () => {
    const hasEp = (state: BoardState): boolean =>
      [...moveMap(state).values()].some(
        (flags) => (flags & MoveFlags.EN_PASSANT) !== 0,
      );
    // Wrong pawn rank: e3 is not on rank 5.
    expect(hasEp(parseFen('7k/8/8/8/8/4P3/8/K7 w - d6 0 1'))).toBe(false);
    // Wrong ep rank: d3 is not on rank 6 for a white capture.
    expect(hasEp(parseFen('7k/8/8/4P3/8/8/8/K7 w - d3 0 1'))).toBe(false);
    // Same file as the recorded square: not an adjacent-file pawn.
    expect(hasEp(parseFen('7k/8/8/3P4/8/8/8/K7 w - d6 0 1'))).toBe(false);
  });

  it('make/unmake round-trips the generated capture, removing the passed pawn', () => {
    const state = parseFen('7k/3p4/8/4P3/8/8/8/K7 b - - 0 1');
    makeMove(state, movesTo(state, 'd7', 'd5')[0]);
    makeMove(state, movesTo(state, 'e5', 'd6')[0]);
    expect(state.board[squareFromAlgebraic('d6')]).toBe(PIECES.white.pawn);
    expect(state.board[squareFromAlgebraic('d5')]).toBeNull();
    expect(state.board[squareFromAlgebraic('e5')]).toBeNull();
    unmakeMove(state);
    expect(state.board[squareFromAlgebraic('e5')]).toBe(PIECES.white.pawn);
    expect(state.board[squareFromAlgebraic('d5')]).toBe(PIECES.black.pawn);
    expect(state.board[squareFromAlgebraic('d6')]).toBeNull();
    unmakeMove(state);
    expect(state.board[squareFromAlgebraic('d7')]).toBe(PIECES.black.pawn);
    expect(state.enPassant).toBeNull();
  });

  it('the en-passant window lasts exactly one move', () => {
    const state = parseFen('7k/3p4/8/4P3/8/8/8/K7 b - - 0 1');
    makeMove(state, movesTo(state, 'd7', 'd5')[0]);
    expect(state.enPassant).toBe(squareFromAlgebraic('d6'));
    makeMove(state, movesTo(state, 'a1', 'a2')[0]);
    expect(state.enPassant).toBeNull();
    makeMove(state, movesTo(state, 'h8', 'h7')[0]);
    expect(moveMap(state).has('e5->d6')).toBe(false);
  });
});

describe('promotion generation', () => {
  it('expands a 7th-rank push into four promotion variants, both colors', () => {
    for (const [fen, from, to] of [
      ['7k/P7/8/8/8/8/8/K7 w - - 0 1', 'a7', 'a8'],
      ['k7/8/8/8/8/8/4p3/K7 b - - 0 1', 'e2', 'e1'],
    ] as const) {
      const promotions = movesTo(parseFen(fen), from, to);
      expect(promotions).toHaveLength(4);
      for (const move of promotions) {
        expect(move.piece).toBe('pawn');
        expect(move.flags).toBe(MoveFlags.PROMOTION);
        expect(move.promotion).toBeDefined();
      }
      expect(promotions.map((m) => m.promotion).sort()).toEqual([
        'bishop',
        'knight',
        'queen',
        'rook',
      ]);
    }
  });

  it('expands a capturing push into four capture-promotion variants, both colors', () => {
    for (const [fen, from, to] of [
      // Note: the issue body pairs FEN `k1n5` (knight on c8) with the
      // "knight on b8" scenario; b8 is empty there, so the knight must be
      // on b8 to make a7xb8 a capture: `kn6`.
      ['kn6/P7/8/8/8/8/8/K7 w - - 0 1', 'a7', 'b8'],
      ['8/8/8/8/8/8/1p6/R3K2k b - - 0 1', 'b2', 'a1'],
    ] as const) {
      const promotions = movesTo(parseFen(fen), from, to);
      expect(promotions).toHaveLength(4);
      for (const move of promotions) {
        expect(move.flags).toBe(MoveFlags.CAPTURE | MoveFlags.PROMOTION);
      }
    }
  });

  it('does not promote to a push when the promotion square is occupied', () => {
    const state = parseFen('kn6/P7/8/8/8/8/8/K7 w - - 0 1');
    expect(movesTo(state, 'a7', 'a8')).toEqual([]);
  });

  it('places the chosen piece on the destination square when each variant is played', () => {
    const state = parseFen('7k/P7/8/8/8/8/8/K7 w - - 0 1');
    for (const promotion of ['queen', 'rook', 'bishop', 'knight'] as const) {
      const [move] = movesTo(state, 'a7', 'a8').filter(
        (m) => m.promotion === promotion,
      );
      makeMove(state, move);
      expect(state.board[squareFromAlgebraic('a8')]).toBe(
        PIECES.white[promotion],
      );
      unmakeMove(state);
    }
  });
});

describe('make/unmake round-trip', () => {
  it('round-trips every generated move, keeping perft sound', () => {
    const state = parseFen(START_FEN);
    const snapshot = structuredClone(state);
    for (const move of generatePseudoLegalMoves(state)) {
      makeMove(state, move);
      unmakeMove(state);
    }
    expect(state).toEqual(snapshot);
  });
});
