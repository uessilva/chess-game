import { describe, expect, it } from 'vitest';

import {
  algebraicOf,
  emptyBoard,
  isOnBoard,
  squareFromAlgebraic,
} from '../core/board';
import { parseFen, START_FEN, toFen } from '../core/fen';
import type { BoardState } from '../core/state';
import type { Color, PieceType, Square } from '../core/types';
import { PIECES } from '../core/types';
import {
  evaluate,
  materialScore,
  pieceSquareScore,
  PIECE_SQUARE_TABLES,
} from './eval';

const e1 = squareFromAlgebraic('e1');
const e8 = squareFromAlgebraic('e8');
const d1 = squareFromAlgebraic('d1');

const PIECE_TYPES: readonly PieceType[] = [
  'pawn',
  'knight',
  'bishop',
  'rook',
  'queen',
  'king',
];

/** A bare White-to-move state with exactly the given pieces on the board. */
function stateWithPieces(
  pieces: ReadonlyArray<{ color: Color; type: PieceType; sq: Square }>,
): BoardState {
  const board = emptyBoard();
  for (const { color, type, sq } of pieces) {
    board[sq] = PIECES[color][type];
  }
  return {
    board,
    turn: 'white',
    castling: {
      whiteKingside: false,
      whiteQueenside: false,
      blackKingside: false,
      blackQueenside: false,
    },
    enPassant: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    history: [],
    positionHashes: [],
  };
}

/** The same position with the side to move flipped (shallow copy suffices: eval reads board + turn). */
function withFlippedTurn(state: BoardState): BoardState {
  return { ...state, turn: state.turn === 'white' ? 'black' : 'white' };
}

describe('evaluate', () => {
  it('scores the initial position exactly 0 (symmetry)', () => {
    expect(evaluate(parseFen(START_FEN))).toBe(0);
  });

  /**
   * The six chessprogrammingwiki perft fixture positions (same FENs the
   * core perft suite runs) plus START_FEN. Evaluation must be
   * side-to-move relative: flipping the turn negates the score, so the
   * negamax search can negate at each ply without colour special-casing.
   */
  const PERFT_FIXTURE_FENS: readonly string[] = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
  ];
  const SIDE_TO_MOVE_FENS: readonly string[] = [
    START_FEN,
    ...PERFT_FIXTURE_FENS,
  ];

  it.each(SIDE_TO_MOVE_FENS)(
    'is side-to-move relative: flipping the turn negates the score (%s)',
    (fen) => {
      const state = parseFen(fen);
      expect(evaluate(withFlippedTurn(state))).toBe(-evaluate(state));
    },
  );

  it('decomposes into material + PST for a spread of White-to-move positions', () => {
    const FENS = [
      START_FEN,
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      '4k3/8/8/8/8/8/8/3QK3 w - - 0 1',
      '4k3/1n6/8/8/8/8/1N6/4K3 w - - 0 1',
      'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    ];
    for (const fen of FENS) {
      const state = parseFen(fen);
      expect(evaluate(state)).toBe(
        materialScore(state) + pieceSquareScore(state),
      );
    }
  });

  it('is invariant to castling rights (rights scoring is out of scope for 3.1)', () => {
    const withRights = parseFen(
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    );
    const withoutRights: BoardState = {
      ...withRights,
      castling: {
        whiteKingside: false,
        whiteQueenside: false,
        blackKingside: false,
        blackQueenside: false,
      },
    };
    expect(evaluate(withoutRights)).toBe(evaluate(withRights));
  });

  it('is pure and side-effect free: repeated calls agree and the state is not mutated', () => {
    const state = parseFen(
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    );
    const snapshot = {
      fen: toFen(state),
      historyLength: state.history.length,
      hashLength: state.positionHashes.length,
      board: state.board.slice(),
    };
    const first = evaluate(state);
    const second = evaluate(state);
    expect(second).toBe(first);
    expect(toFen(state)).toBe(snapshot.fen);
    expect(state.history.length).toBe(snapshot.historyLength);
    expect(state.positionHashes.length).toBe(snapshot.hashLength);
    expect(state.board).toEqual(snapshot.board);
  });
});

describe('materialScore', () => {
  const MATERIAL_CASES: ReadonlyArray<readonly [PieceType, number]> = [
    ['pawn', 100],
    ['knight', 320],
    ['bishop', 330],
    ['rook', 500],
    ['queen', 900],
  ];

  it.each(MATERIAL_CASES)(
    'scores a white %s as %d centipawns',
    (type, value) => {
      const state = stateWithPieces([
        { color: 'white', type, sq: d1 },
        { color: 'white', type: 'king', sq: e1 },
        { color: 'black', type: 'king', sq: e8 },
      ]);
      expect(materialScore(state)).toBe(value);
    },
  );

  it('scores the king as 0 (kings-only position)', () => {
    const state = stateWithPieces([
      { color: 'white', type: 'king', sq: e1 },
      { color: 'black', type: 'king', sq: e8 },
    ]);
    expect(materialScore(state)).toBe(0);
  });
});

describe('pieceSquareScore', () => {
  /**
   * The golden tables from the chessprogrammingwiki "Simplified
   * Evaluation Function" article (Tomasz Michniewski), in the printed
   * order rank 8 → rank 1, file a → h — copied verbatim, matching the
   * mandated data exactly (all 6 piece types × 64 squares).
   */
  const GOLDEN: Record<PieceType, readonly number[]> = {
    pawn: [
      0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30,
      30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5,
      -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0,
      0, 0, 0,
    ],
    knight: [
      -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0,
      15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5,
      0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
    ],
    bishop: [
      -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10,
      0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10,
      10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20,
    ],
    rook: [
      0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0,
      0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0,
      0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
    ],
    queen: [
      -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0,
      5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5,
      -5, -10, -10, -20,
    ],
    king: [
      -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40,
      -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40,
      -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20,
      -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
    ],
  };

  it('matches the published tables exactly (all 6 piece types × 64 squares)', () => {
    expect(PIECE_SQUARE_TABLES).toEqual(GOLDEN);
  });

  it('scores black pieces on the rank mirror of the white tables (sq ^ 0x70)', () => {
    for (const type of PIECE_TYPES) {
      for (let sq = 0; sq < 128; sq++) {
        if (!isOnBoard(sq)) {
          continue;
        }
        const black = pieceSquareScore(
          stateWithPieces([{ color: 'black', type, sq }]),
        );
        const whiteAtMirror = pieceSquareScore(
          stateWithPieces([{ color: 'white', type, sq: sq ^ 0x70 }]),
        );
        // `===` (not `toBe`/Object.is) so that a zero-valued square passes
        // regardless of its +0/-0 sign.
        expect(black === -whiteAtMirror, `${type} on ${algebraicOf(sq)}`).toBe(
          true,
        );
      }
    }
  });
});

describe('evaluate scenarios (from the issue test scenarios)', () => {
  /**
   * "A material advantage shows up in the score". NOTE: the issue states
   * this scores +900 "because the queen PST on d1 is 0", but the mandated
   * CPW queen table actually scores d1 as -5 (row 7, column d). With the
   * verbatim tables — pinned by the golden-table test above — the material
   * advantage of 900 shows up as 900 - 5 = 895. Flagged to the PM; the
   * verbatim tables win over the issue's parenthetical, since editing the
   * tables to force d1 = 0 would break the golden-table equality.
   */
  it('scores an extra white queen on d1 as +895 with White to move and -895 with Black to move', () => {
    const fen = '4k3/8/8/8/8/8/8/3QK3 w - - 0 1';
    const whiteToMove = parseFen(fen);
    const blackToMove = withFlippedTurn(whiteToMove);
    expect(evaluate(whiteToMove)).toBe(895);
    expect(evaluate(blackToMove)).toBe(-895);
  });

  it('scores white knight b1 + black knight b8 as exactly 0 (mirrored PSTs cancel)', () => {
    const fen = '4k3/1n6/8/8/8/8/1N6/4K3 w - - 0 1';
    expect(evaluate(parseFen(fen))).toBe(0);
  });

  it('scores a white pawn on e7 strictly above the same pawn on e2 (advancement rewarded)', () => {
    const onE2 = parseFen('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    const onE7 = parseFen('4k3/4P3/8/8/8/8/8/4K3 w - - 0 1');
    const e2Score = evaluate(onE2);
    const e7Score = evaluate(onE7);
    expect(e7Score).toBeGreaterThan(e2Score);
    // The mandated pawn table: e7 = 50, e2 = -20; kings on e1/e8 are 0.
    expect(e7Score).toBe(150);
    expect(e2Score).toBe(80);
  });
});
