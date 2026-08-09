import { describe, expect, it } from 'vitest';

import { algebraicOf, squareFromAlgebraic } from './board';
import { parseFen } from './fen';
import {
  generateLegalMoves,
  generatePseudoLegalMoves,
  isCheckmate,
  isInCheck,
  isSquareAttacked,
  isStalemate,
  perft,
  START_FEN,
} from './index';
import { makeMove, unmakeMove } from './move';
import type { BoardState } from './state';
import type { Move } from './types';
import { MoveFlags } from './types';

/** Every legal move as an algebraic `from->to` key with its flags. */
function moveMap(state: BoardState): Map<string, number> {
  const moves = generateLegalMoves(state)
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

/** All legal moves with the given from/to pair (promotion variants collide on from->to keys). */
function movesTo(state: BoardState, from: string, to: string): Move[] {
  return generateLegalMoves(state).filter(
    (m) => algebraicOf(m.from) === from && algebraicOf(m.to) === to,
  );
}

/** Assert the exact legal move set of a position. */
function expectExactMoves(state: BoardState, expected: string[]): void {
  expect([...moveMap(state).keys()].sort()).toEqual([...expected].sort());
}

describe('src/core exports', () => {
  it('exposes the legality layer', () => {
    expect(isSquareAttacked).toBeTypeOf('function');
    expect(isInCheck).toBeTypeOf('function');
    expect(generateLegalMoves).toBeTypeOf('function');
    expect(isCheckmate).toBeTypeOf('function');
    expect(isStalemate).toBeTypeOf('function');
  });
});

describe('isSquareAttacked', () => {
  it('returns true when a pinned piece attacks through the empty squares (FIDE 3.1.3)', () => {
    const state = parseFen('k6r/8/8/4K3/8/8/8/b7 w - - 0 1');
    // The a1 black bishop shares the a1–e5 diagonal with the white king.
    expect(isSquareAttacked(state, squareFromAlgebraic('e5'), 'black')).toBe(
      true,
    );
    expect(isSquareAttacked(state, squareFromAlgebraic('f5'), 'black')).toBe(
      false,
    );
  });

  it('detects a knight attacking an adjacent-square target', () => {
    const state = parseFen('7k/5n2/8/8/8/8/8/K7 w - - 0 1');
    // The f7 knight attacks h8 (and d8/d6/h6/g5/e5), but not e8.
    expect(isSquareAttacked(state, squareFromAlgebraic('h8'), 'black')).toBe(
      true,
    );
    expect(isSquareAttacked(state, squareFromAlgebraic('e8'), 'black')).toBe(
      false,
    );
  });

  it('detects a king attacking an adjacent square', () => {
    const state = parseFen('7k/8/6K1/8/8/8/8/8 w - - 0 1');
    expect(isSquareAttacked(state, squareFromAlgebraic('h7'), 'white')).toBe(
      true,
    );
    expect(isSquareAttacked(state, squareFromAlgebraic('g8'), 'white')).toBe(
      false,
    );
  });

  it('detects pawn capture diagonals for both colors', () => {
    const state = parseFen('k7/8/8/3P4/8/2p5/8/K7 w - - 0 1');
    // White pawn d5 attacks c6/e6; black pawn c3 attacks b2/d2.
    expect(isSquareAttacked(state, squareFromAlgebraic('c6'), 'white')).toBe(
      true,
    );
    expect(isSquareAttacked(state, squareFromAlgebraic('e6'), 'white')).toBe(
      true,
    );
    expect(isSquareAttacked(state, squareFromAlgebraic('c4'), 'white')).toBe(
      false,
    );
    expect(isSquareAttacked(state, squareFromAlgebraic('b2'), 'black')).toBe(
      true,
    );
    expect(isSquareAttacked(state, squareFromAlgebraic('d2'), 'black')).toBe(
      true,
    );
    expect(isSquareAttacked(state, squareFromAlgebraic('e2'), 'black')).toBe(
      false,
    );
  });
});

describe('isInCheck', () => {
  it('is true when the h4 queen attacks e1 along an open diagonal', () => {
    const state = parseFen(
      'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
    );
    expect(isInCheck(state, 'white')).toBe(true);
  });

  it('is false in the starting position', () => {
    expect(isInCheck(parseFen(START_FEN), 'white')).toBe(false);
  });
});

describe('generateLegalMoves', () => {
  it('gives a pinned knight no moves and the king exactly the four escape squares', () => {
    const state = parseFen('k7/8/8/8/8/2b5/3N4/4K3 w - - 0 1');
    // Every d2 knight move would open the c3–e1 diagonal onto the king.
    expectExactMoves(state, ['e1->d1', 'e1->e2', 'e1->f1', 'e1->f2']);
    expect([...movesFrom(state, 'd2').keys()]).toEqual([]);
    expect(generateLegalMoves(state)).toHaveLength(4);
  });

  it('has exactly 21 moves and every knight move delivers a discovered check', () => {
    const state = parseFen('8/3k4/8/8/8/8/3N1K2/3R4 w - - 0 1');
    const moves = generateLegalMoves(state);
    expectExactMoves(state, [
      'd1->a1',
      'd1->b1',
      'd1->c1',
      'd1->e1',
      'd1->f1',
      'd1->g1',
      'd1->h1',
      'd2->b1',
      'd2->b3',
      'd2->c4',
      'd2->e4',
      'd2->f1',
      'd2->f3',
      'f2->e1',
      'f2->e2',
      'f2->e3',
      'f2->f1',
      'f2->f3',
      'f2->g1',
      'f2->g2',
      'f2->g3',
    ]);
    expect(moves).toHaveLength(21);
    for (const move of moves) {
      if (move.piece !== 'knight') {
        continue;
      }
      makeMove(state, move);
      expect(isInCheck(state, 'black')).toBe(true);
      unmakeMove(state);
    }
  });

  it('returns the 20 opening moves from the starting position', () => {
    expect(generateLegalMoves(parseFen(START_FEN))).toHaveLength(20);
  });

  it('leaves the position untouched (make/unmake round-trip)', () => {
    const state = parseFen(START_FEN);
    const snapshot = structuredClone(state);
    generateLegalMoves(state);
    expect(state).toEqual(snapshot);
  });

  it('make/unmake round-trips every legal move, keeping perft sound', () => {
    const state = parseFen(START_FEN);
    const snapshot = structuredClone(state);
    for (const move of generateLegalMoves(state)) {
      makeMove(state, move);
      unmakeMove(state);
    }
    expect(state).toEqual(snapshot);
  });
});

describe('isCheckmate', () => {
  it("is true in the fool's-mate position, with an empty legal move list", () => {
    const state = parseFen(
      'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
    );
    expect(isInCheck(state, 'white')).toBe(true);
    expect(isCheckmate(state)).toBe(true);
    expect(isStalemate(state)).toBe(false);
    expect(generateLegalMoves(state)).toEqual([]);
  });

  it("is true in the scholar's-mate position; the defended queen is not capturable", () => {
    const state = parseFen(
      'r1bqkbnr/pppp1Qpp/2n5/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4',
    );
    expect(isInCheck(state, 'black')).toBe(true);
    expect(isCheckmate(state)).toBe(true);
    // The f7 queen is defended by the c4 bishop, so e8xf7 is not legal.
    expect(moveMap(state).has('e8->f7')).toBe(false);
    expect(generateLegalMoves(state)).toEqual([]);
  });

  it('is false when the side to move is in check but has a legal response', () => {
    const state = parseFen('k7/4r3/8/8/8/8/8/4K3 w - - 0 1');
    expect(isInCheck(state, 'white')).toBe(true);
    expect(isCheckmate(state)).toBe(false);
    expect(isStalemate(state)).toBe(false);
    expect(generateLegalMoves(state)).toHaveLength(4);
  });
});

describe('isStalemate', () => {
  it('is true when the side to move is not in check but has no legal moves', () => {
    const state = parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(isInCheck(state, 'black')).toBe(false);
    expect(isStalemate(state)).toBe(true);
    expect(isCheckmate(state)).toBe(false);
    expect(generateLegalMoves(state)).toEqual([]);
  });
});

describe('normal play', () => {
  it('is neither check, checkmate, nor stalemate at the starting position', () => {
    const state = parseFen(START_FEN);
    expect(isInCheck(state, 'white')).toBe(false);
    expect(isCheckmate(state)).toBe(false);
    expect(isStalemate(state)).toBe(false);
    expect(generateLegalMoves(state)).toHaveLength(20);
  });
});

describe('castling legality', () => {
  it('rejects castling out of check', () => {
    // The e8 rook checks e1 along the e-file; the king may only step to
    // d1, d2, f2, f1 — never castle away from the check.
    const state = parseFen('k3r3/8/8/8/8/8/8/4K2R w K - 0 1');
    expectExactMoves(state, ['e1->d1', 'e1->d2', 'e1->f2', 'e1->f1']);
  });

  it('rejects kingside castling through an attacked f1', () => {
    // The a6 bishop attacks f1 along b5-c4-d3-e2; e1 and g1 are safe.
    // (The issue body says "bishop a6" but pairs it with FEN `.../b7/...`
    // on rank 5, which would put the bishop on a5 — the FEN below places
    // it on a6 as described.)
    const state = parseFen('k7/8/b7/8/8/8/8/4K2R w K - 0 1');
    expect(isSquareAttacked(state, squareFromAlgebraic('f1'), 'black')).toBe(
      true,
    );
    expect(isSquareAttacked(state, squareFromAlgebraic('e1'), 'black')).toBe(
      false,
    );
    expect(moveMap(state).has('e1->g1')).toBe(false);
  });

  it('rejects queenside castling through an attacked d1', () => {
    const state = parseFen('3r3k/8/8/8/8/8/8/R3K3 w Q - 0 1');
    expect(isSquareAttacked(state, squareFromAlgebraic('d1'), 'black')).toBe(
      true,
    );
    expect(moveMap(state).has('e1->c1')).toBe(false);
  });

  it('rejects castling onto an attacked destination via the post-make filter', () => {
    // The g8 rook attacks g1; e1 and f1 are safe, so only the generic
    // king-safety test can reject the castle.
    const state = parseFen('k5r1/8/8/8/8/8/8/4K2R w K - 0 1');
    expect(moveMap(state).has('e1->g1')).toBe(false);
  });

  it('allows queenside castling when only the rook square b1 is attacked', () => {
    // The b8 rook attacks b1; the king crosses e1 and d1, never b1.
    const state = parseFen('1r5k/8/8/8/8/8/8/R3K3 w Q - 0 1');
    expect(isSquareAttacked(state, squareFromAlgebraic('b1'), 'black')).toBe(
      true,
    );
    expect(moveMap(state).get('e1->c1')).toBe(MoveFlags.CASTLE_QUEEN);
  });

  it('allows both white castles in the Kiwipete position', () => {
    const state = parseFen(
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    );
    expect(moveMap(state).get('e1->g1')).toBe(MoveFlags.CASTLE_KING);
    expect(moveMap(state).get('e1->c1')).toBe(MoveFlags.CASTLE_QUEEN);
  });

  it('rejects black castling out of check', () => {
    const state = parseFen('4k2r/8/8/8/8/8/8/K3R3 b k - 0 1');
    expect(moveMap(state).has('e8->g8')).toBe(false);
  });

  it('rejects black castling through an attacked f8 or d8', () => {
    const throughF8 = parseFen('4k2r/5R2/8/8/8/8/8/K7 b k - 0 1');
    expect(moveMap(throughF8).has('e8->g8')).toBe(false);

    const throughD8 = parseFen('r3k3/3R4/8/8/8/8/8/K7 b q - 0 1');
    expect(moveMap(throughD8).has('e8->c8')).toBe(false);
  });
});

describe('en passant legality', () => {
  it('allows the capture the ply after a double push', () => {
    const state = parseFen('7k/3p4/8/4P3/8/8/8/K7 b - - 0 1');
    makeMove(state, movesTo(state, 'd7', 'd5')[0]);
    expect(moveMap(state).get('e5->d6')).toBe(
      MoveFlags.CAPTURE | MoveFlags.EN_PASSANT,
    );
  });

  it('excludes the pinned en-passant capture from the legal list', () => {
    // White b5 pawn is pinned by the h5 rook along rank 5. After bxc6 ep
    // both pawns leave the rank and the a5 king hangs — pseudo-legal yes,
    // legal no (the generic make/unmake + king-safety filter rejects it).
    const state = parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 b - - 0 1');
    makeMove(state, movesTo(state, 'c7', 'c5')[0]);
    expect(
      generatePseudoLegalMoves(state).some(
        (m) => algebraicOf(m.from) === 'b5' && algebraicOf(m.to) === 'c6',
      ),
    ).toBe(true);
    expect(moveMap(state).has('b5->c6')).toBe(false);
  });
});

describe('perft (additional regression fixtures)', () => {
  it('pin-heavy pawnless position depths 1-4 = 24, 667, 13970, 353663', () => {
    // python-chess 1.11-verified fixture (not a chessprogrammingwiki
    // position): white Ra1/Ne3/Kg1 vs black Be5/Kg8, rich in pins. The
    // six CPW oracle positions live in perft.fixtures.test.ts.
    const state = parseFen('r5k1/8/8/4b3/8/4N3/8/R5K1 w - - 0 1');
    expect(perft(state, 1)).toBe(24);
    expect(perft(state, 2)).toBe(667);
    expect(perft(state, 3)).toBe(13970);
    expect(perft(state, 4)).toBe(353663);
  }, 30_000);
});
