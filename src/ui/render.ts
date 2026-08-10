import { square } from '../core';
import type { BoardState } from '../core';
import { DEFAULT_SQUARE_SIZE, squareToPixel } from './boardGeometry';
import type { BoardOrientation } from './boardGeometry';
import { pieceLayout } from './pieceLayout';
import { spriteKeyFor } from './sprites';
import type { SpriteMap } from './sprites';

/** Lichess-style board colors. a1 is a dark square. */
export const LIGHT_SQUARE_COLOR = '#f0d9b5';
export const DARK_SQUARE_COLOR = '#b58863';

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
