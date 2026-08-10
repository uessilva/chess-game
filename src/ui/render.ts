import { square } from '../core';
import type { BoardState, Piece, Square } from '../core';
import { DEFAULT_SQUARE_SIZE, squareToPixel } from './boardGeometry';
import type { BoardOrientation, Point } from './boardGeometry';
import type { Selection } from './controller';
import { pieceLayout } from './pieceLayout';
import { spriteKeyFor } from './sprites';
import type { SpriteMap } from './sprites';

/** Lichess-style board colors. a1 is a dark square. */
export const LIGHT_SQUARE_COLOR = '#f0d9b5';
export const DARK_SQUARE_COLOR = '#b58863';

/** Translucent green tint drawn over the selected square. */
export const SELECTION_COLOR = 'rgba(20, 85, 30, 0.5)';
/** Translucent accent fill for the legal-move dots. */
export const MOVE_DOT_COLOR = 'rgba(20, 85, 30, 0.5)';
/** Legal-move dot radius as a fraction of the square size. */
export const MOVE_DOT_RADIUS_FACTOR = 0.16;

/** Translucent yellow overlay for the last committed move's from/to squares. */
export const LAST_MOVE_COLOR = 'rgba(255, 213, 0, 0.4)';
/** Check glow: radial red centered on the king's square, fading to clear. */
export const CHECK_GLOW_CENTER_COLOR = 'rgba(255, 60, 60, 0.85)';
export const CHECK_GLOW_EDGE_COLOR = 'rgba(255, 60, 60, 0)';
/** Check glow radius as a fraction of the square size. */
export const CHECK_GLOW_RADIUS_FACTOR = 0.95;

/**
 * Where a lifted piece is drawn: the pointer position the piece follows,
 * offset so the cursor tip doesn't cover the piece (the lift reads as
 * "hovering above" the board). Centering happens at draw time.
 */
export const LIFT_OFFSET: Readonly<Point> = { x: 0, y: -12 };

/** A piece lifted off its home square during a drag. */
export interface LiftRender {
  /** Home square of the lifted piece — skipped by the board pass. */
  readonly from: Square;
  /** Pointer position in canvas pixels; the piece is centered here + LIFT_OFFSET. */
  readonly position: Point;
}

/** One in-flight piece drawn at its interpolated position instead of a square. */
export interface MovingPieceRender {
  /** The moving piece (the mover; a pawn during a promotion glide). */
  readonly piece: Piece;
  /** Origin square — skipped by the board pass while the flight is active. */
  readonly from: Square;
  /** Destination square — skipped too (core already places the piece there). */
  readonly to: Square;
  /** Top-left pixel position to draw the piece at this frame. */
  readonly position: Point;
}

/** Square overlays drawn beneath the pieces (task 2.5). */
export interface SquareHighlights {
  /** The last committed move's from/to squares, or null/absent for none. */
  readonly lastMove?: { readonly from: Square; readonly to: Square } | null;
  /** King square to glow red, or null/absent for none. */
  readonly checkSquare?: Square | null;
}

export interface RenderOptions {
  readonly squareSize?: number;
  readonly orientation?: BoardOrientation;
  /** When set, the piece at `from` is drawn lifted at `position` instead of its square. */
  readonly lifted?: LiftRender;
  /** Overlays beneath the pieces: last-move highlight and check glow. */
  readonly highlights?: SquareHighlights;
  /** In-flight pieces drawn at interpolated positions, on top of the board. */
  readonly movingPieces?: readonly MovingPieceRender[];
}

/**
 * Draw a full board position onto a Canvas 2D context: the 8x8 grid of
 * alternating light/dark squares first, then the square overlays (last-move
 * highlight and check glow), then each occupied square's piece sprite scaled
 * to fit the square. Squares held by a lifted or in-flight piece are skipped
 * by the board pass; in-flight pieces are drawn afterwards at their
 * interpolated positions, on top of everything else. Sprites whose key is
 * absent from the SpriteMap (not loaded yet) draw nothing rather than
 * blocking the frame.
 */
export function renderBoard(
  ctx: CanvasRenderingContext2D,
  state: BoardState,
  sprites: SpriteMap,
  options: RenderOptions = {},
): void {
  const squareSize = options.squareSize ?? DEFAULT_SQUARE_SIZE;
  const orientation = options.orientation ?? 'white';
  const lifted = options.lifted;
  const highlights = options.highlights;
  const movingPieces = options.movingPieces ?? [];

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const { x, y } = squareToPixel(
        square(file, rank),
        squareSize,
        orientation,
      );
      ctx.fillStyle =
        (file + rank) % 2 === 0 ? DARK_SQUARE_COLOR : LIGHT_SQUARE_COLOR;
      ctx.fillRect(x, y, squareSize, squareSize);
    }
  }

  // Overlays beneath the pieces: the last committed move stays highlighted
  // until the next commit, and a king in check glows red.
  if (highlights?.lastMove !== undefined && highlights.lastMove !== null) {
    ctx.fillStyle = LAST_MOVE_COLOR;
    for (const sq of [highlights.lastMove.from, highlights.lastMove.to]) {
      const { x, y } = squareToPixel(sq, squareSize, orientation);
      ctx.fillRect(x, y, squareSize, squareSize);
    }
  }
  if (
    highlights?.checkSquare !== undefined &&
    highlights.checkSquare !== null
  ) {
    const { x, y } = squareToPixel(
      highlights.checkSquare,
      squareSize,
      orientation,
    );
    const cx = x + squareSize / 2;
    const cy = y + squareSize / 2;
    const radius = squareSize * CHECK_GLOW_RADIUS_FACTOR;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, CHECK_GLOW_CENTER_COLOR);
    gradient.addColorStop(1, CHECK_GLOW_EDGE_COLOR);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, squareSize, squareSize);
  }

  const skipped = new Set<Square>();
  if (lifted !== undefined) {
    skipped.add(lifted.from);
  }
  for (const moving of movingPieces) {
    skipped.add(moving.from);
    skipped.add(moving.to);
  }

  for (const { square: sq, piece } of pieceLayout(state)) {
    if (skipped.has(sq)) {
      continue;
    }
    const sprite = sprites[spriteKeyFor(piece)];
    if (sprite === undefined) {
      continue;
    }
    const { x, y } = squareToPixel(sq, squareSize, orientation);
    ctx.drawImage(sprite, x, y, squareSize, squareSize);
  }

  // In-flight pieces glide on top of the board at their interpolated
  // positions (a promotion glide still draws the pawn sprite; the promoted
  // piece appears from core state the moment the flight clears).
  for (const moving of movingPieces) {
    const sprite = sprites[spriteKeyFor(moving.piece)];
    if (sprite === undefined) {
      continue;
    }
    ctx.drawImage(
      sprite,
      moving.position.x,
      moving.position.y,
      squareSize,
      squareSize,
    );
  }

  // Draw the lifted piece at the pointer-following position, centered under
  // the cursor with the small lift offset, scaled to the square size.
  if (lifted !== undefined) {
    const piece = state.board[lifted.from];
    if (piece !== null) {
      const sprite = sprites[spriteKeyFor(piece)];
      if (sprite !== undefined) {
        ctx.drawImage(
          sprite,
          lifted.position.x - squareSize / 2 + LIFT_OFFSET.x,
          lifted.position.y - squareSize / 2 + LIFT_OFFSET.y,
          squareSize,
          squareSize,
        );
      }
    }
  }
}

/**
 * Draw the selection overlay: a translucent tint over the selected square and
 * a filled dot centered on every legal target square. Pure canvas drawing in
 * the same style as renderBoard — square↔pixel mapping reuses squareToPixel,
 * and a null selection draws nothing. Dots are disjoint circles in one path
 * (moveTo jumps each arc's subpath so no connecting lines are drawn).
 */
export function renderSelection(
  ctx: CanvasRenderingContext2D,
  selection: Selection | null,
  options: RenderOptions = {},
): void {
  if (selection === null) {
    return;
  }
  const squareSize = options.squareSize ?? DEFAULT_SQUARE_SIZE;
  const orientation = options.orientation ?? 'white';

  const { x, y } = squareToPixel(selection.from, squareSize, orientation);
  ctx.fillStyle = SELECTION_COLOR;
  ctx.fillRect(x, y, squareSize, squareSize);

  ctx.fillStyle = MOVE_DOT_COLOR;
  const radius = squareSize * MOVE_DOT_RADIUS_FACTOR;
  ctx.beginPath();
  for (const target of selection.targets) {
    const { x: tx, y: ty } = squareToPixel(target, squareSize, orientation);
    const cx = tx + squareSize / 2;
    const cy = ty + squareSize / 2;
    ctx.moveTo(cx + radius, cy);
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  }
  ctx.fill();
}
