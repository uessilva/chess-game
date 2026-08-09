import { BOARD_SIZE, fileOf, isOnBoard, rankOf, square } from './board';
import type { BoardState } from './state';
import type { Color, Move, Piece, PieceType, Square } from './types';
import { MoveFlags, PIECES } from './types';

/**
 * Pseudo-legal move generation (task 1.5, extended by task 1.7).
 *
 * "Pseudo-legal" means piece movement rules only, no king-safety
 * filtering: pinned pieces keep their moves, the king may step onto
 * attacked squares or capture defended pieces. Task 1.6 filters those
 * out. Task 1.7 adds castling, en-passant captures, and promotion
 * variants (Q/R/B/N with PROMOTION): castling is emitted on movement and
 * occupancy grounds alone — its king-safety rules (out of / through
 * check) live in the legality layer, which also rejects the pinned
 * en-passant capture via the generic make/unmake + king-safety filter.
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

/** Castling ranks: white castles on rank 1 (index 0), black on rank 8 (7). */
const HOME_RANK: Record<Color, number> = { white: 0, black: 7 };

/** The back rank where a pawn push or capture promotes. */
const PROMOTION_RANK: Record<Color, number> = { white: 7, black: 0 };
const PROMOTION_PIECES = ['queen', 'rook', 'bishop', 'knight'] as const;

/**
 * En-passant capture geometry: the mover's pawn stands on rank 5 (white)
 * / rank 4 (black) and captures to the recorded square on rank 6 / rank 3.
 */
const EP_PAWN_RANK: Record<Color, number> = { white: 4, black: 3 };
const EP_TARGET_RANK: Record<Color, number> = { white: 5, black: 2 };

function addMove(
  moves: Move[],
  from: Square,
  to: Square,
  piece: PieceType,
  flags = 0,
): void {
  moves.push({ from, to, piece, flags });
}

/** The four promotion variants of a pawn push or capture onto the back rank. */
function addPromotionMoves(
  moves: Move[],
  from: Square,
  to: Square,
  flags = 0,
): void {
  for (const promotion of PROMOTION_PIECES) {
    moves.push({
      from,
      to,
      piece: 'pawn',
      flags: MoveFlags.PROMOTION | flags,
      promotion,
    });
  }
}

/**
 * Castling, movement conditions only: the right is held, the king stands
 * on its e-file home square, its own rook is on the home rook square
 * (parseFen does not validate rook presence), and the squares between
 * them are empty (f1/g1 kingside, b1/c1/d1 queenside). Attack checks —
 * out of, through, and into check — belong to the legality layer; movegen
 * stays attack-blind and never imports it.
 */
function generateCastlingMoves(
  moves: Move[],
  state: BoardState,
  from: Square,
): void {
  const { board, castling, turn } = state;
  const rank = rankOf(from);
  if (rank !== HOME_RANK[turn] || fileOf(from) !== 4) {
    return;
  }
  const canKingside =
    turn === 'white' ? castling.whiteKingside : castling.blackKingside;
  if (
    canKingside &&
    board[square(7, rank)] === PIECES[turn].rook &&
    board[square(5, rank)] === null &&
    board[square(6, rank)] === null
  ) {
    addMove(moves, from, square(6, rank), 'king', MoveFlags.CASTLE_KING);
  }
  const canQueenside =
    turn === 'white' ? castling.whiteQueenside : castling.blackQueenside;
  if (
    canQueenside &&
    board[square(0, rank)] === PIECES[turn].rook &&
    board[square(1, rank)] === null &&
    board[square(2, rank)] === null &&
    board[square(3, rank)] === null
  ) {
    addMove(moves, from, square(2, rank), 'king', MoveFlags.CASTLE_QUEEN);
  }
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
 * target from the flag), diagonal captures onto enemy-occupied squares,
 * and an EN_PASSANT capture to the recorded square when this pawn stands
 * one file over it on the capture rank. A push or capture landing on the
 * opponent's back rank expands into the four PROMOTION variants. The
 * isOnBoard guards only matter for a pawn stranded on the back rank by a
 * crafted FEN — a plain push there would index off the board.
 */
function generatePawnMoves(
  moves: Move[],
  board: (Piece | null)[],
  turn: Color,
  from: Square,
  enPassant: Square | null,
): void {
  const { forward, captureSteps, startRank } = PAWN_GEOMETRY[turn];
  const one = from + forward;
  if (isOnBoard(one) && board[one] === null) {
    if (rankOf(one) === PROMOTION_RANK[turn]) {
      addPromotionMoves(moves, from, one);
    } else {
      addMove(moves, from, one, 'pawn');
      const two = from + 2 * forward;
      if (rankOf(from) === startRank && board[two] === null) {
        addMove(moves, from, two, 'pawn', MoveFlags.DOUBLE_PUSH);
      }
    }
  }
  for (const step of captureSteps) {
    const to = from + step;
    if (!isOnBoard(to)) {
      continue;
    }
    const target = board[to];
    if (target !== null && target.color !== turn) {
      if (rankOf(to) === PROMOTION_RANK[turn]) {
        addPromotionMoves(moves, from, to, MoveFlags.CAPTURE);
      } else {
        addMove(moves, from, to, 'pawn', MoveFlags.CAPTURE);
      }
    }
  }
  if (enPassant !== null) {
    if (
      rankOf(from) === EP_PAWN_RANK[turn] &&
      rankOf(enPassant) === EP_TARGET_RANK[turn] &&
      Math.abs(fileOf(from) - fileOf(enPassant)) === 1
    ) {
      addMove(
        moves,
        from,
        enPassant,
        'pawn',
        MoveFlags.CAPTURE | MoveFlags.EN_PASSANT,
      );
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
        generatePawnMoves(moves, board, turn, from, state.enPassant);
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
        generateCastlingMoves(moves, state, from);
        break;
    }
  }
  return moves;
}
