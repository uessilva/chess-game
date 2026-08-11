import { fileOf, rankOf, square } from './board';
import {
  castlingZobrist,
  epFileZobrist,
  meaningfulEnPassant,
  pieceZobrist,
  SIDE_TO_MOVE_ZOBRIST,
} from './zobrist';
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
 *
 * The maintained `state.zobristKey` is XOR-updated incrementally to stay
 * equal to `zobristHash(state)` (the reference implementation; the
 * invariant is test-enforced). The outgoing meaningful en-passant square
 * must be read before the board is mutated; the incoming one after, so
 * both probes see the position the hash they replace/install belongs to.
 */
export function makeMove(state: BoardState, move: Move): void {
  const mover = state.turn;

  // The outgoing ep contribution belongs to the pre-move position — read
  // it before any mutation (O(1): rank check + adjacent-pawn probe).
  const outgoingEp = meaningfulEnPassant(state);

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
    prevZobristKey: state.zobristKey,
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

  // Maintain the key incrementally, mirroring zobristHash's identity
  // rules exactly: the moved/captured pieces, the side-to-move bit, the
  // changed castling rights, and the outgoing/incoming meaningful ep
  // file. XOR is commutative, so the order below only needs to be
  // internally consistent — the incoming ep probe reads the mutated state.
  let key = state.zobristKey;
  key ^= SIDE_TO_MOVE_ZOBRIST; // the side-to-move bit always flips
  key ^= pieceZobrist(move.from, PIECES[mover][move.piece]); // mover leaves
  if (captured !== null) {
    key ^= pieceZobrist(captureSq, captured); // captured leaves
  }
  key ^= pieceZobrist(
    move.to,
    PIECES[mover][move.promotion ?? move.piece], // mover arrives
  );
  if (move.flags & MoveFlags.CASTLE_KING) {
    const rank = rankOf(move.from);
    key ^=
      pieceZobrist(square(7, rank), PIECES[mover].rook) ^
      pieceZobrist(square(5, rank), PIECES[mover].rook);
  } else if (move.flags & MoveFlags.CASTLE_QUEEN) {
    const rank = rankOf(move.from);
    key ^=
      pieceZobrist(square(0, rank), PIECES[mover].rook) ^
      pieceZobrist(square(3, rank), PIECES[mover].rook);
  }
  // Rights are permanent: only the revoked ones differ between the two sets.
  key ^= castlingZobrist(undo.prevCastling) ^ castlingZobrist(state.castling);
  const incomingEp = meaningfulEnPassant(state);
  if (outgoingEp !== null) {
    key ^= epFileZobrist(fileOf(outgoingEp));
  }
  if (incomingEp !== null) {
    key ^= epFileZobrist(fileOf(incomingEp));
  }
  state.zobristKey = key;

  state.history.push(undo);
  state.positionHashes.push(state.zobristKey);
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
  state.zobristKey = undo.prevZobristKey;
  state.positionHashes.pop();

  return move;
}
