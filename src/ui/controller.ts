import { generateLegalMoves, makeMove } from '../core';
import type { BoardState, Color, Move, Square } from '../core';

/**
 * UI selection state: the chosen square plus the legal target squares derived
 * from `generateLegalMoves`. Kept strictly separate from core `BoardState` —
 * the architecture rule that UI state never leaks into core.
 */
export interface Selection {
  readonly from: Square;
  /**
   * Legal destination squares of `from`, deduplicated so the four promotion
   * variants of one pawn push collapse into a single dot.
   */
  readonly targets: readonly Square[];
}

/**
 * Click-to-move interaction controller. Owns the selection state and drives a
 * core `BoardState`, consuming it exactly as exported: targets come from
 * `generateLegalMoves(state)` and moves execute only through
 * `makeMove(state, move)` with a move taken from that same legal list — the UI
 * never constructs moves from raw square pairs, so "only legal moves execute"
 * holds by construction. Pure: no DOM, no canvas, no I/O, so this module unit
 * tests in Vitest's default node environment.
 *
 * Behavior contract:
 * - Click a piece of `state.turn` → select it; dots on every legal target.
 * - Click a different piece of `state.turn` → re-select and refresh the dots.
 * - Click a dotted target → execute the matching move via `makeMove`, clear.
 * - Click anything else → clear the selection; no move; core unchanged.
 * - When the side to move has no legal moves, nothing ever selects.
 */
export interface Controller {
  readonly state: BoardState;
  readonly selection: Selection | null;
  /** Apply one click on an on-board square (`sq` must be on the 0x88 board). */
  handleSquareClick(sq: Square): void;
  /**
   * Drop the current selection without touching core state. Used when a drag
   * gesture supersedes the click UI (a drop or cancel leaves any stale
   * selection from an earlier click obsolete).
   */
  clearSelection(): void;
}

export function createController(state: BoardState): Controller {
  let selectedFrom: Square | null = null;
  let targets: readonly Square[] = [];

  function clearSelection(): void {
    selectedFrom = null;
    targets = [];
  }

  function selectFrom(sq: Square, moves: Move[]): void {
    selectedFrom = sq;
    targets = [
      ...new Set(
        moves.filter((move) => move.from === sq).map((move) => move.to),
      ),
    ];
  }

  return {
    get state() {
      return state;
    },
    get selection(): Selection | null {
      return selectedFrom === null ? null : { from: selectedFrom, targets };
    },
    clearSelection(): void {
      clearSelection();
    },
    handleSquareClick(sq: Square): void {
      const moves = generateLegalMoves(state);
      if (moves.length === 0) {
        // Checkmate/stalemate: the position is frozen — nothing selects.
        clearSelection();
        return;
      }

      const piece = state.board[sq];
      if (piece !== null && piece.color === state.turn) {
        selectFrom(sq, moves);
        return;
      }

      if (selectedFrom !== null && targets.includes(sq)) {
        // The legal list holds one move per from/to pair, except a promotion,
        // which carries four Q/R/B/N variants — execute the queen by default
        // (the piece picker is #13).
        const move = moves.find(
          (m) =>
            m.from === selectedFrom &&
            m.to === sq &&
            (m.promotion === undefined || m.promotion === 'queen'),
        );
        if (move !== undefined) {
          makeMove(state, move);
        }
        clearSelection();
        return;
      }

      // Empty square, enemy piece, or a non-target: clear, never move.
      clearSelection();
    },
  };
}

/** Status-line label for a side, e.g. "White to move". */
export function turnLabel(turn: Color): string {
  return `${turn === 'white' ? 'White' : 'Black'} to move`;
}
