import { fileOf, rankOf, square } from './board';
import type { BoardState, CastlingRights, UndoInfo } from './state';
import type { Color, Move } from './types';
import { MoveFlags, opposite, PIECES } from './types';

// Rook home squares, used to revoke castling rights.
const A1 = square(0, 0);
const H1 = square(7, 0);
const A8 = square(0, 7);
const H8 = square(7, 7);

/**
 * Revoke the castling rights a move touches: the mover's king or rook
 * leaving its home square, or a rook being captured on its home square.
 * Clearing an already-lost right is a harmless no-op, which keeps this
 * branch-light.
 */
function updateCastlingRights(
  castling: CastlingRights,
  move: Move,
  mover: Color,
): void {
  if (move.piece === 'king') {
    if (mover === 'white') {
      castling.whiteKingside = false;
      castling.whiteQueenside = false;
    } else {
      castling.blackKingside = false;
      castling.blackQueenside = false;
    }
  }
  switch (move.from) {
    case A1:
      castling.whiteQueenside = false;
      break;
    case H1:
      castling.whiteKingside = false;
      break;
    case A8:
      castling.blackQueenside = false;
      break;
    case H8:
      castling.blackKingside = false;
      break;
  }
  switch (move.to) {
    case A1:
      castling.whiteQueenside = false;
      break;
    case H1:
      castling.whiteKingside = false;
      break;
    case A8:
      castling.blackQueenside = false;
      break;
    case H8:
      castling.blackKingside = false;
      break;
  }
}

/**
 * Apply a pseudo-legal move, pushing undo info so unmakeMove can restore
 * the exact prior state. No legality checks here — the move must be
 * consistent with the position (move generation, task 1.5+, guarantees
 * that). All mechanics are driven by the move's flags.
 */
export function makeMove(state: BoardState, move: Move): void {
  const mover = state.turn;

  // En passant removes the pawn beside the mover, not on the target square.
  const captureSq =
    move.flags & MoveFlags.EN_PASSANT
      ? square(fileOf(move.to), rankOf(move.from))
      : move.to;
  const captured =
    move.flags & (MoveFlags.CAPTURE | MoveFlags.EN_PASSANT)
      ? state.board[captureSq]
      : null;

  const undo: UndoInfo = {
    move,
    captured,
    prevCastling: { ...state.castling },
    prevEnPassant: state.enPassant,
    prevHalfmove: state.halfmoveClock,
  };

  state.board[move.from] = null;
  if (captured !== null) {
    state.board[captureSq] = null;
  }
  state.board[move.to] =
    move.promotion !== undefined
      ? PIECES[mover][move.promotion]
      : PIECES[mover][move.piece];

  // Castling moves the king two squares; shuffle the rook alongside it.
  if (move.flags & MoveFlags.CASTLE_KING) {
    const rank = rankOf(move.from);
    state.board[square(5, rank)] = state.board[square(7, rank)];
    state.board[square(7, rank)] = null;
  } else if (move.flags & MoveFlags.CASTLE_QUEEN) {
    const rank = rankOf(move.from);
    state.board[square(3, rank)] = state.board[square(0, rank)];
    state.board[square(0, rank)] = null;
  }

  // A double push exposes the square it passed over as an en-passant
  // target. In 0x88 that square is the arithmetic midpoint of from/to.
  state.enPassant =
    move.flags & MoveFlags.DOUBLE_PUSH ? (move.from + move.to) >> 1 : null;

  updateCastlingRights(state.castling, move, mover);

  state.halfmoveClock =
    move.piece === 'pawn' || captured !== null ? 0 : state.halfmoveClock + 1;
  if (mover === 'black') {
    state.fullmoveNumber++;
  }
  state.turn = opposite(mover);
  state.history.push(undo);
}

/**
 * Reverse the most recent makeMove, restoring the board, clocks, castling
 * rights, and en-passant square exactly. Returns the undone move.
 */
export function unmakeMove(state: BoardState): Move {
  const undo = state.history.pop();
  if (undo === undefined) {
    throw new Error('unmakeMove called with empty history');
  }
  const { move } = undo;

  // Flip back to the mover first: everything below is from their side.
  state.turn = opposite(state.turn);
  if (state.turn === 'black') {
    state.fullmoveNumber--;
  }

  state.board[move.from] = PIECES[state.turn][move.piece];
  state.board[move.to] = null;
  if (undo.captured !== null) {
    const captureSq =
      move.flags & MoveFlags.EN_PASSANT
        ? square(fileOf(move.to), rankOf(move.from))
        : move.to;
    state.board[captureSq] = undo.captured;
  }

  if (move.flags & MoveFlags.CASTLE_KING) {
    const rank = rankOf(move.from);
    state.board[square(7, rank)] = state.board[square(5, rank)];
    state.board[square(5, rank)] = null;
  } else if (move.flags & MoveFlags.CASTLE_QUEEN) {
    const rank = rankOf(move.from);
    state.board[square(0, rank)] = state.board[square(3, rank)];
    state.board[square(3, rank)] = null;
  }

  state.castling = undo.prevCastling;
  state.enPassant = undo.prevEnPassant;
  state.halfmoveClock = undo.prevHalfmove;

  return move;
}
