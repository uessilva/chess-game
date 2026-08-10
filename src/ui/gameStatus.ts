import {
  isCheckmate,
  isFiftyMoveDraw,
  isInCheck,
  isInsufficientMaterial,
  isStalemate,
  isThreefoldRepetition,
} from '../core';
import type { BoardState, Color } from '../core';
import { opposite } from '../core';

/**
 * Game-flow status derived from a core BoardState (task 2.4). Pure — no
 * DOM, canvas, or Image references — so this module runs in Vitest's
 * default node environment, following the `boardGeometry.ts` pattern.
 *
 * `deriveGameStatus` only wraps core predicates; it never re-implements
 * rule logic. Priority when several predicates match is deterministic:
 * **checkmate → stalemate → threefold repetition → fifty-move →
 * insufficient material**, so the UI always reports one stable reason.
 * Checkmate/stalemate are terminal (no legal moves); among the draw
 * predicates the fixed order guarantees a single, stable banner reason.
 *
 * Auto-end decision: this local two-player build auto-ends on any draw
 * predicate (no claim/accept dialog). FIDE's optional-claim nuance and
 * the automatic 75-move rule (FIDE 9.6.2) are deliberately out of scope.
 */
export type GameStatus =
  | { readonly kind: 'playing' }
  /** Side to move is in check but has legal moves — the game continues. */
  | { readonly kind: 'check' }
  | { readonly kind: 'checkmate'; readonly winner: Color }
  | { readonly kind: 'stalemate' }
  | { readonly kind: 'threefold-repetition' }
  | { readonly kind: 'fifty-move' }
  | { readonly kind: 'insufficient-material' };

/**
 * Derive the game status from a position. Wraps the core predicates in the
 * spec's fixed priority order; `check` is the fallback when the side to
 * move is in check but playable, and `playing` covers everything else.
 */
export function deriveGameStatus(state: BoardState): GameStatus {
  if (isCheckmate(state)) {
    return { kind: 'checkmate', winner: opposite(state.turn) };
  }
  if (isStalemate(state)) {
    return { kind: 'stalemate' };
  }
  if (isThreefoldRepetition(state)) {
    return { kind: 'threefold-repetition' };
  }
  if (isFiftyMoveDraw(state)) {
    return { kind: 'fifty-move' };
  }
  if (isInsufficientMaterial(state)) {
    return { kind: 'insufficient-material' };
  }
  if (isInCheck(state, state.turn)) {
    return { kind: 'check' };
  }
  return { kind: 'playing' };
}

/** True when the game is over: any terminal status that freezes the board. */
export function isTerminal(status: GameStatus): boolean {
  return status.kind !== 'playing' && status.kind !== 'check';
}

/**
 * The game-over banner copy for a terminal status, or null while the game
 * continues. This is the spec's copy, in player language.
 */
export function gameOverLabel(status: GameStatus): string | null {
  switch (status.kind) {
    case 'checkmate':
      return `Checkmate — ${status.winner === 'white' ? 'White' : 'Black'} wins`;
    case 'stalemate':
      return 'Stalemate — draw';
    case 'threefold-repetition':
      return 'Draw by threefold repetition';
    case 'fifty-move':
      return 'Draw by fifty-move rule';
    case 'insufficient-material':
      return 'Draw by insufficient material';
    default:
      return null;
  }
}

/**
 * The status-line label for a non-terminal status: the side to move, with
 * the "Check!" indicator appended when the side to move is in check.
 */
export function statusLineLabel(status: GameStatus, turn: Color): string {
  const side = turn === 'white' ? 'White' : 'Black';
  return status.kind === 'check'
    ? `${side} to move — Check!`
    : `${side} to move`;
}
