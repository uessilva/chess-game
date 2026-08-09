import { BOARD_SIZE, isOnBoard, rankOf } from './board';
import type { BoardState } from './state';
import type { Color, Move, Piece, PieceType, Square } from './types';
import { MoveFlags } from './types';

/**
 * Pseudo-legal move generation (task 1.5).
 *
 * "Pseudo-legal" means piece movement rules only, no king-safety
 * filtering: pinned pieces keep their moves, the king may step onto
 * attacked squares or capture defended pieces. Task 1.6 filters those
 * out. Castling, en-passant captures, and promotion-variant expansion
 * (Q/R/B/N with PROMOTION) are task 1.7 and are NOT generated here; a
 * pawn reaching the back rank gets a single plain push or capture, which
 * makeMove/unmakeMove already handle.
 *
 * Everything keys off the 0x88 off-board test: adding a step offset to an
 * on-board square and ANDing with 0x88 (isOnBoard) rejects both edge
 * crossings and file wrap-around in one operation.
 */

/**
 * Step offsets in the 0x88 layout: one rank = ±16, one file = ±1, so
 * diagonals are ±15/±17 and knight leaps combine two ranks with one file
 * (±31/±33) or one rank with two files (±14/±18).
 */
const BISHOP_DIRECTIONS = [17, 15, -15, -17] as const;
const ROOK_DIRECTIONS = [16, -16, 1, -1] as const;
const QUEEN_DIRECTIONS = [...BISHOP_DIRECTIONS, ...ROOK_DIRECTIONS] as const;
const KNIGHT_STEPS = [33, 31, 18, 14, -14, -18, -31, -33] as const;
const KING_STEPS = [17, 16, 15, 1, -1, -15, -16, -17] as const;

/** Pawn geometry differs only by color: white climbs ranks, black descends. */
const PAWN_GEOMETRY: Record<
  Color,
  { forward: number; captureSteps: readonly number[]; startRank: number }
> = {
  white: { forward: 16, captureSteps: [15, 17], startRank: 1 },
  black: { forward: -16, captureSteps: [-17, -15], startRank: 6 },
};

function addMove(
  moves: Move[],
  from: Square,
  to: Square,
  piece: PieceType,
  flags = 0,
): void {
  moves.push({ from, to, piece, flags });
}

/**
 * Walk a ray until the board edge, emitting a quiet move per empty square
 * and one CAPTURE on the first enemy piece. A friendly piece ends the ray
 * without contributing a move.
 */
function generateSliderMoves(
  moves: Move[],
  board: (Piece | null)[],
  turn: Color,
  from: Square,
  piece: PieceType,
  directions: readonly number[],
): void {
  for (const direction of directions) {
    let to = from + direction;
    while (isOnBoard(to)) {
      const target = board[to];
      if (target === null) {
        addMove(moves, from, to, piece);
      } else {
        if (target.color !== turn) {
          addMove(moves, from, to, piece, MoveFlags.CAPTURE);
        }
        break;
      }
      to += direction;
    }
  }
}

/** Knights and kings: one step per offset, jumping anything in between. */
function generateStepMoves(
  moves: Move[],
  board: (Piece | null)[],
  turn: Color,
  from: Square,
  piece: PieceType,
  steps: readonly number[],
): void {
  for (const step of steps) {
    const to = from + step;
    if (!isOnBoard(to)) {
      continue;
    }
    const target = board[to];
    if (target === null) {
      addMove(moves, from, to, piece);
    } else if (target.color !== turn) {
      addMove(moves, from, to, piece, MoveFlags.CAPTURE);
    }
  }
}

/**
 * Pawns: a single push onto an empty square, a DOUBLE_PUSH from the
 * start rank when both squares are empty (makeMove derives the en-passant
 * target from the flag), and diagonal captures onto enemy-occupied
 * squares only. The isOnBoard guard on the push only matters for a pawn
 * stranded on the back rank by a crafted FEN — a plain push there would
 * index off the board.
 */
function generatePawnMoves(
  moves: Move[],
  board: (Piece | null)[],
  turn: Color,
  from: Square,
): void {
  const { forward, captureSteps, startRank } = PAWN_GEOMETRY[turn];
  const one = from + forward;
  if (isOnBoard(one) && board[one] === null) {
    addMove(moves, from, one, 'pawn');
    const two = from + 2 * forward;
    if (rankOf(from) === startRank && board[two] === null) {
      addMove(moves, from, two, 'pawn', MoveFlags.DOUBLE_PUSH);
    }
  }
  for (const step of captureSteps) {
    const to = from + step;
    if (!isOnBoard(to)) {
      continue;
    }
    const target = board[to];
    if (target !== null && target.color !== turn) {
      addMove(moves, from, to, 'pawn', MoveFlags.CAPTURE);
    }
  }
}

/**
 * Every pseudo-legal move for the side to move. Pure: reads the state,
 * allocates fresh Move values, and leaves the position untouched.
 */
export function generatePseudoLegalMoves(state: BoardState): Move[] {
  const moves: Move[] = [];
  const { board, turn } = state;
  for (let from = 0; from < BOARD_SIZE; from++) {
    if (!isOnBoard(from)) {
      continue;
    }
    const piece = board[from];
    if (piece === null || piece.color !== turn) {
      continue;
    }
    switch (piece.type) {
      case 'pawn':
        generatePawnMoves(moves, board, turn, from);
        break;
      case 'knight':
        generateStepMoves(moves, board, turn, from, 'knight', KNIGHT_STEPS);
        break;
      case 'bishop':
        generateSliderMoves(
          moves,
          board,
          turn,
          from,
          'bishop',
          BISHOP_DIRECTIONS,
        );
        break;
      case 'rook':
        generateSliderMoves(moves, board, turn, from, 'rook', ROOK_DIRECTIONS);
        break;
      case 'queen':
        generateSliderMoves(
          moves,
          board,
          turn,
          from,
          'queen',
          QUEEN_DIRECTIONS,
        );
        break;
      case 'king':
        generateStepMoves(moves, board, turn, from, 'king', KING_STEPS);
        break;
    }
  }
  return moves;
}
