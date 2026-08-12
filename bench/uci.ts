/**
 * UCI move-notation helpers for the sparring harness (task 3.7, #22).
 *
 * The search speaks `Move` objects (0x88 squares + promotion piece);
 * Stockfish speaks UCI long algebraic (`e2e4`, `e7e8q`). These two
 * converters bridge the wire format — `moveToUci` for moves we send,
 * `uciToMove` for the moves Stockfish returns (validated against the
 * legal move list, so a Stockfish reply that is not a legal move in the
 * current position is a loud harness failure, never a silent corrupt
 * game).
 */
import {
  algebraicOf,
  generateLegalMoves,
  squareFromAlgebraic,
} from '../src/core';
import type { BoardState } from '../src/core/state';
import type { Move, PieceType } from '../src/core/types';

const PROMOTION_CHARS: Record<PieceType, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

/** Serialize a Move as UCI long algebraic (`e2e4`, `e7e8q`, ...). */
export function moveToUci(move: Move): string {
  const promotion =
    move.promotion === undefined ? '' : PROMOTION_CHARS[move.promotion];
  return `${algebraicOf(move.from)}${algebraicOf(move.to)}${promotion}`;
}

/**
 * Parse a UCI move (`e2e4`, `e7e8q`) against the position's legal moves.
 * Returns the matching Move, or null when the UCI string is malformed or
 * is not a legal move in `state` (e.g. a captured-piece ambiguity or a
 * Stockfish null move `0000`).
 */
export function uciToMove(state: BoardState, uci: string): Move | null {
  if (uci.length < 4 || uci.length > 5) {
    return null;
  }
  let from: number;
  let to: number;
  try {
    from = squareFromAlgebraic(uci.slice(0, 2));
    to = squareFromAlgebraic(uci.slice(2, 4));
  } catch {
    return null;
  }
  const promotion =
    uci.length === 5
      ? (Object.keys(PROMOTION_CHARS).find(
          (type) => PROMOTION_CHARS[type as PieceType] === uci[4],
        ) as PieceType | undefined)
      : undefined;
  if (uci.length === 5 && promotion === undefined) {
    return null;
  }
  for (const move of generateLegalMoves(state)) {
    if (
      move.from === from &&
      move.to === to &&
      (move.promotion ?? undefined) === promotion
    ) {
      return move;
    }
  }
  return null;
}
