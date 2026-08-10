import {
  isInCheck,
  MoveFlags,
  opposite,
  PIECES,
  rankOf,
  square,
} from '../core';
import type { BoardState, Move, Piece, Square } from '../core';
import {
  advanceTween,
  createTween,
  isTweenComplete,
  tweenPosition,
} from './animation';
import type { Tween } from './animation';
import { squareToPixel } from './boardGeometry';
import type { BoardOrientation, Point } from './boardGeometry';
import type { SoundPlayer } from './sounds';

/**
 * Piece-animation overlay (task 2.5): one or more pieces gliding from their
 * origin squares to their destinations while core `BoardState` is already
 * committed. Pure UI state — no DOM, canvas, or I/O — so this module unit
 * tests in Vitest's default node environment, following the `controller.ts`
 * / `drag.ts` patterns.
 *
 * Behavior contract:
 * - `commitMove(move, snap)` starts the visual for a just-committed move:
 *   a plain move tweens the mover; castling tweens the king and rook in the
 *   same tween (both land simultaneously); en passant tweens only the
 *   capturing pawn (core already removed the captured pawn from its own
 *   square); promotion tweens the pawn and lets the renderer swap the
 *   sprite when the flight clears. A `snap` commit (drag-dropped move, #12)
 *   starts no tween — the piece is already under the pointer.
 * - `update(deltaMs)` advances every flight's tween, drops completed
 *   flights, and re-derives the check glow from core's `isInCheck` — no
 *   check logic re-implemented here.
 * - `lastMove` remembers the most recent from/to pair for the last-move
 *   highlight until the next commit; `checkSquare` is the king square of
 *   the side to move when that side is in check, else null.
 * - Sounds fire only on committed moves: `move()` for a plain move,
 *   `capture()` when the move carries the CAPTURE or EN_PASSANT flag.
 */

/** One piece in flight, at its current interpolated pixel position. */
export interface Flight {
  /** The moving piece (the mover; a pawn during a promotion glide). */
  readonly piece: Piece;
  /** Origin square — the board pass skips it while the flight is active. */
  readonly from: Square;
  /** Destination square — skipped too (core already places the piece there). */
  readonly to: Square;
  /** Top-left pixel position to draw the piece at this frame. */
  readonly position: Point;
}

interface ActiveFlight {
  readonly piece: Piece;
  readonly from: Square;
  readonly to: Square;
  readonly tween: Tween;
}

export interface MoveAnimator {
  /** Active flights; empty when nothing is animating. */
  readonly flights: readonly Flight[];
  /** True while at least one flight is in flight — move input is locked. */
  readonly isAnimating: boolean;
  /** Most recently committed move's from/to pair, or null after reset. */
  readonly lastMove: { readonly from: Square; readonly to: Square } | null;
  /** King square of the side to move when in check, else null. */
  readonly checkSquare: Square | null;
  /**
   * Record a just-committed move's visual. `snap` (a drag-dropped move)
   * skips the tween; highlights and sounds still apply.
   */
  commitMove(move: Move, snap: boolean): void;
  /** Advance all active flights by delta ms and refresh the check glow. */
  update(deltaMs: number): void;
  /** Clear every piece of animation/highlight state (New game). */
  reset(): void;
}

export interface MoveAnimatorOptions {
  /** The core state the animation overlays (read-only; core stays committed). */
  readonly state: BoardState;
  readonly squareSize?: number;
  readonly orientation?: BoardOrientation;
  /** Injectable sound player; defaults to silent no-ops. */
  readonly sound?: SoundPlayer;
}

/** The silent sound player used when none is injected. */
const SILENT_SOUND: SoundPlayer = { move(): void {}, capture(): void {} };

export function createMoveAnimator(options: MoveAnimatorOptions): MoveAnimator {
  const { state } = options;
  const squareSize = options.squareSize ?? 64;
  const orientation = options.orientation ?? 'white';
  const sound = options.sound ?? SILENT_SOUND;

  let active: ActiveFlight[] = [];
  let lastMove: { from: Square; to: Square } | null = null;
  let checkSquare: Square | null = null;

  /** Pixel top-left corner of a square, in the animator's geometry. */
  function pixelOf(sq: Square): Point {
    return squareToPixel(sq, squareSize, orientation);
  }

  /** The king square of `color` on the current board, or null. */
  function kingSquareOf(color: 'white' | 'black'): Square | null {
    for (let sq = 0; sq < state.board.length; sq++) {
      const piece = state.board[sq];
      if (piece !== null && piece.color === color && piece.type === 'king') {
        return sq;
      }
    }
    return null;
  }

  /** Re-derive the glow from core: king of the side to move, when in check. */
  function refreshCheckGlow(): void {
    const king = kingSquareOf(state.turn);
    checkSquare = king !== null && isInCheck(state, state.turn) ? king : null;
  }

  function flight(piece: Piece, from: Square, to: Square): ActiveFlight {
    return { piece, from, to, tween: createTween(pixelOf(from), pixelOf(to)) };
  }

  return {
    get flights(): readonly Flight[] {
      return active.map((f) => ({
        piece: f.piece,
        from: f.from,
        to: f.to,
        position: tweenPosition(f.tween),
      }));
    },
    get isAnimating(): boolean {
      return active.length > 0;
    },
    get lastMove(): { from: Square; to: Square } | null {
      return lastMove;
    },
    get checkSquare(): Square | null {
      return checkSquare;
    },

    commitMove(move: Move, snap: boolean): void {
      // The move was just applied, so state.turn flipped to the opponent;
      // the mover is therefore the opposite color.
      const mover = opposite(state.turn);
      const piece = PIECES[mover][move.piece];

      lastMove = { from: move.from, to: move.to };
      if ((move.flags & (MoveFlags.CAPTURE | MoveFlags.EN_PASSANT)) !== 0) {
        sound.capture();
      } else {
        sound.move();
      }

      if (snap) {
        // Drag-committed: the piece is already under the pointer — snap into
        // place, no tween replayed from its origin (#12).
        return;
      }

      active = [flight(piece, move.from, move.to)];

      if (move.flags & MoveFlags.CASTLE_KING) {
        const rank = rankOf(move.from);
        active = [
          ...active,
          flight(PIECES[mover].rook, square(7, rank), square(5, rank)),
        ];
      } else if (move.flags & MoveFlags.CASTLE_QUEEN) {
        const rank = rankOf(move.from);
        active = [
          ...active,
          flight(PIECES[mover].rook, square(0, rank), square(3, rank)),
        ];
      }
    },

    update(deltaMs: number): void {
      if (active.length > 0) {
        active = active
          .map((f) => ({
            piece: f.piece,
            from: f.from,
            to: f.to,
            tween: advanceTween(f.tween, deltaMs),
          }))
          .filter((f) => !isTweenComplete(f.tween));
      }
      refreshCheckGlow();
    },

    reset(): void {
      active = [];
      lastMove = null;
      refreshCheckGlow();
    },
  };
}
