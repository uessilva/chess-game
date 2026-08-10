import { isOnBoard } from '../core';
import type { BoardState, Piece, Square } from '../core';

/** One occupied square in a drawable layout. */
export interface PlacedPiece {
  readonly square: Square;
  readonly piece: Piece;
}

/**
 * Convert a core BoardState into a per-square draw list: one entry for every
 * occupied square, empty squares omitted. Iterates the 0x88 board array and
 * skips off-board cells with isOnBoard, so no phantom pieces can leak in.
 */
export function pieceLayout(state: BoardState): PlacedPiece[] {
  const placed: PlacedPiece[] = [];
  for (let sq = 0; sq < state.board.length; sq++) {
    if (!isOnBoard(sq)) {
      continue;
    }
    const piece = state.board[sq];
    if (piece !== null) {
      placed.push({ square: sq, piece });
    }
  }
  return placed;
}
