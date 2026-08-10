import { square } from '../core';
import type { BoardState } from '../core';
import { DEFAULT_SQUARE_SIZE, squareToPixel } from './boardGeometry';
import type { BoardOrientation } from './boardGeometry';
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

export interface RenderOptions {
  readonly squareSize?: number;
  readonly orientation?: BoardOrientation;
}

/**
 * Draw a full board position onto a Canvas 2D context: the 8x8 grid of
 * alternating light/dark squares first, then each occupied square's piece
 * sprite scaled to fit the square. Sprites whose key is absent from the
 * SpriteMap (not loaded yet) draw nothing rather than blocking the frame.
 */
export function renderBoard(
  ctx: CanvasRenderingContext2D,
  state: BoardState,
  sprites: SpriteMap,
  options: RenderOptions = {},
): void {
  const squareSize = options.squareSize ?? DEFAULT_SQUARE_SIZE;
  const orientation = options.orientation ?? 'white';

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

  for (const { square: sq, piece } of pieceLayout(state)) {
    const sprite = sprites[spriteKeyFor(piece)];
    if (sprite === undefined) {
      continue;
    }
    const { x, y } = squareToPixel(sq, squareSize, orientation);
    ctx.drawImage(sprite, x, y, squareSize, squareSize);
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
