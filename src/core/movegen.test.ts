import { describe, expect, it } from 'vitest';

import { algebraicOf } from './board';
import { parseFen } from './fen';
import { generatePseudoLegalMoves } from './index';
import { makeMove, unmakeMove } from './move';
import type { BoardState } from './state';
import { MoveFlags } from './types';

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

/** Assert the exact pseudo-legal move set of a position. */
function expectExactMoves(state: BoardState, expected: string[]): void {
  expect([...moveMap(state).keys()].sort()).toEqual([...expected].sort());
}

/** Recursive perft node counter over pseudo-legal moves. */
function perft(state: BoardState, depth: number): number {
  if (depth === 0) {
    return 1;
  }
  let nodes = 0;
  for (const move of generatePseudoLegalMoves(state)) {
    makeMove(state, move);
    nodes += perft(state, depth - 1);
    unmakeMove(state);
  }
  return nodes;
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

  it('pushes a 7th-rank pawn to the back rank without promotion expansion', () => {
    const state = parseFen('7k/P7/8/8/8/8/8/K7 w - - 0 1');
    const pawn = movesFrom(state, 'a7');
    expect([...pawn.keys()]).toEqual(['a7->a8']);
    expect(pawn.get('a7->a8')).toBe(0);
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

describe('perft (pseudo-legal oracle)', () => {
  it('initial position depth 1 = 20', () => {
    expect(perft(parseFen(START_FEN), 1)).toBe(20);
  });

  it('initial position depth 2 = 400', () => {
    expect(perft(parseFen(START_FEN), 2)).toBe(400);
  });

  it('initial position depth 3 = 8902', () => {
    expect(perft(parseFen(START_FEN), 3)).toBe(8902);
  });

  it('Kiwipete depth 1 = 46 (published 48 minus both castles)', () => {
    expect(perft(parseFen(KIWIPETE_FEN), 1)).toBe(46);
  });

  it('make/unmake round-trips every generated move, keeping perft sound', () => {
    const state = parseFen(START_FEN);
    const snapshot = structuredClone(state);
    for (const move of generatePseudoLegalMoves(state)) {
      makeMove(state, move);
      unmakeMove(state);
    }
    expect(state).toEqual(snapshot);
  });
});
