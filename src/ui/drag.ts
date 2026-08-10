import { generateLegalMoves, makeMove } from '../core';
import type { BoardState, Move, Piece, Square } from '../core';
import type { Point } from './boardGeometry';

/**
 * Pointer-travel distance (canvas px) that separates a #11 click from a drag:
 * a pointerup closer to the pointerdown than this is a click, anything beyond
 * it is a drag. Mirrors the issue's ≈4px threshold.
 */
export const DRAG_THRESHOLD_PX = 4;

/** The lifted-piece drag state: which piece, where the pointer is, gesture kind. */
export interface Drag {
  /** Square the piece was lifted from (its home square). */
  readonly from: Square;
  readonly piece: Piece;
  /** Latest pointer position in canvas pixels; the render centers the piece here. */
  readonly position: Point;
  /**
   * True once the gesture crossed `DRAG_THRESHOLD_PX` and is a real drag.
   * While false the piece is merely "armed" — it stays on its square, so a
   * quick click never accidentally lifts a piece.
   */
  readonly dragging: boolean;
}

/** How a completed pointer gesture resolved. */
export type GestureResolution =
  | { readonly kind: 'click'; readonly square: Square }
  | { readonly kind: 'drag-move' }
  | { readonly kind: 'drag-revert' }
  /**
   * A drop onto a square whose only legal variants promote: the move is NOT
   * applied — the caller holds it in UI state and opens the promotion
   * picker (#13), superseding #12's silent no-op.
   */
  | { readonly kind: 'promotion'; readonly from: Square; readonly to: Square };

/**
 * Click/drag interaction state machine. Owns the lift gesture state strictly
 * separate from core `BoardState` — core changes only when a drop resolves to
 * a legal move, applied via the same `makeMove` path the click controller
 * uses. Pure: no DOM, no canvas, no I/O, so it unit-tests in Vitest's default
 * node environment. Inputs are injected: tests call the pointer methods
 * directly and supply a fake hit test; production wiring in `main.ts`
 * translates real pointer events and a `pixelToSquare`-based hit test.
 *
 * Behavior contract:
 * - `pointerDown` on a piece of `state.turn` arms a lift; on an empty square,
 *   an opponent piece, or a piece of the side not to move it arms a plain
 *   click fallthrough (resolved by the caller via the #11 controller). Points
 *   that hit-test to no square start nothing. Extra pointers while a gesture
 *   is active are ignored.
 * - Moving beyond `DRAG_THRESHOLD_PX` turns an armed lift into a real drag;
 *   `pointerUp` then hit-tests the release point and, if it is a legal
 *   destination, executes the move. A promotion drop resolves to a
 *   `{ kind: 'promotion' }` resolution instead — the caller holds the move
 *   in UI state and opens the picker (#13). Anything else reverts: piece
 *   back on its origin square, turn unchanged.
 * - A `pointerUp` within the threshold resolves as a click on the release
 *   square, delegated to the caller so #11's selection/execution still runs.
 * - `pointerCancel` (or capture loss) aborts the gesture and reverts.
 */
export interface DragMachine {
  /** The active lift gesture, or null when nothing is lifted/armed. */
  readonly drag: Drag | null;
  /**
   * Feed a pointerdown in canvas pixels. Returns true when a gesture starts
   * (the caller may grab pointer capture); false when the point is off-board
   * or another gesture is already active.
   */
  pointerDown(x: number, y: number): boolean;
  /** Feed pointer movement in canvas pixels. */
  pointerMove(x: number, y: number): void;
  /**
   * Feed a pointerup in canvas pixels and resolve the gesture: a click for
   * the caller to feed the #11 controller, a completed drag move, or a
   * revert. Returns null when no gesture was active.
   */
  pointerUp(x: number, y: number): GestureResolution | null;
  /** Abort the active gesture (pointercancel / capture loss). True if one was aborted. */
  pointerCancel(): boolean;
}

export interface DragMachineOptions {
  readonly state: BoardState;
  /**
   * Canvas-pixel → square hit test. Injected because production maps page
   * coordinates through the canvas bounding rect and orientation before
   * calling `pixelToSquare`; tests supply a plain mapping. Returns null for
   * off-board points.
   */
  readonly hitTest: (x: number, y: number) => Square | null;
}

interface GestureState {
  readonly from: Square;
  /** The liftable piece, or null for a plain click fallthrough gesture. */
  readonly piece: Piece | null;
  readonly start: Point;
  current: Point;
  dragging: boolean;
}

export function createDragMachine(options: DragMachineOptions): DragMachine {
  const { state, hitTest } = options;
  let gesture: GestureState | null = null;

  function movedBeyondThreshold(g: GestureState): boolean {
    const dx = g.current.x - g.start.x;
    const dy = g.current.y - g.start.y;
    return dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
  }

  /**
   * The single legal move matching a from/to pair, or `null` (no such move),
   * or `'promotion'` when the only matches are promotion variants — a drop
   * that resolves to a promotion move must not apply silently (picker is
   * #13). A plain (non-promotion) move is unique per from/to pair, so a
   * `promotion === undefined` match is the one true move.
   */
  function findDrop(from: Square, to: Square): Move | 'promotion' | null {
    const matches = generateLegalMoves(state).filter(
      (move) => move.from === from && move.to === to,
    );
    if (matches.length === 0) {
      return null;
    }
    const plain = matches.find((move) => move.promotion === undefined);
    return plain === undefined ? 'promotion' : plain;
  }

  return {
    get drag(): Drag | null {
      if (gesture === null || gesture.piece === null) {
        return null;
      }
      return {
        from: gesture.from,
        piece: gesture.piece,
        position: gesture.current,
        dragging: gesture.dragging,
      };
    },

    pointerDown(x: number, y: number): boolean {
      if (gesture !== null) {
        return false; // only one active gesture; ignore additional pointers
      }
      const sq = hitTest(x, y);
      if (sq === null) {
        return false;
      }
      const piece = state.board[sq];
      const liftable = piece !== null && piece.color === state.turn;
      gesture = {
        from: sq,
        piece: liftable ? piece : null,
        start: { x, y },
        current: { x, y },
        dragging: false,
      };
      return true;
    },

    pointerMove(x: number, y: number): void {
      if (gesture === null) {
        return;
      }
      gesture.current = { x, y };
      // Only a liftable piece can become a drag; a plain click-candidate that
      // travels far is simply no click at all (resolved on pointerup).
      if (
        gesture.piece !== null &&
        !gesture.dragging &&
        movedBeyondThreshold(gesture)
      ) {
        gesture.dragging = true;
      }
    },

    pointerUp(x: number, y: number): GestureResolution | null {
      if (gesture === null) {
        return null;
      }
      const g = gesture;
      gesture = null;
      g.current = { x, y };

      // A fast flick can jump straight to pointerup with no intermediate
      // pointermove, so classify against the threshold here as well.
      const crossed = movedBeyondThreshold(g);
      if (g.dragging || (g.piece !== null && crossed)) {
        const to = hitTest(x, y);
        if (to !== null) {
          const drop = findDrop(g.from, to);
          if (drop !== null && drop !== 'promotion') {
            makeMove(state, drop);
            return { kind: 'drag-move' };
          }
          if (drop === 'promotion') {
            // Hold the promotion in UI state (the picker is #13); the move
            // is not applied and the pawn stays on its origin square.
            return { kind: 'promotion', from: g.from, to };
          }
        }
        return { kind: 'drag-revert' };
      }

      // Not a drag. A plain click gesture that travelled beyond the threshold
      // is nothing (it was never a drag either). Everything else is a #11
      // click on the release square — falling back to the press square when
      // the release lands off-board.
      if (g.piece === null && crossed) {
        return null;
      }
      const sq = hitTest(x, y);
      return { kind: 'click', square: sq === null ? g.from : sq };
    },

    pointerCancel(): boolean {
      if (gesture === null) {
        return false;
      }
      gesture = null; // revert: piece back on its origin, no move applied
      return true;
    },
  };
}
