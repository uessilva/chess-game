import { describe, expect, it, vi } from 'vitest';

import {
  fileOf,
  parseFen,
  rankOf,
  START_FEN,
  squareFromAlgebraic,
} from '../core';
import { pieceLayout } from './pieceLayout';
import {
  DARK_SQUARE_COLOR,
  LIGHT_SQUARE_COLOR,
  MOVE_DOT_COLOR,
  MOVE_DOT_RADIUS_FACTOR,
  renderBoard,
  renderSelection,
  SELECTION_COLOR,
} from './render';
import { SPRITE_KEYS } from './sprites';
import type { SpriteMap } from './sprites';

const KIWIPETE =
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

/** Minimal CanvasRenderingContext2D fake recording every drawing call. */
function createFakeCtx(): {
  ctx: CanvasRenderingContext2D;
  fillStyleSeq: string[];
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
} {
  const fillStyleSeq: string[] = [];
  let currentFillStyle = '';
  const fillRect = vi.fn();
  const drawImage = vi.fn();
  const ctx = {
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(value: string) {
      currentFillStyle = value;
      fillStyleSeq.push(value);
    },
    fillRect,
    drawImage,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fillStyleSeq, fillRect, drawImage };
}

function fullSpriteMap(): SpriteMap {
  const map: SpriteMap = {};
  for (const key of SPRITE_KEYS) {
    map[key] = { key } as unknown as HTMLImageElement;
  }
  return map;
}

describe('renderBoard squares', () => {
  it('draws 64 alternating light/dark squares in board colors', () => {
    const { ctx, fillStyleSeq, fillRect } = createFakeCtx();
    renderBoard(ctx, parseFen(START_FEN), {}, { squareSize: 64 });

    expect(fillStyleSeq).toHaveLength(64);
    expect(fillRect).toHaveBeenCalledTimes(64);

    const expected: string[] = [];
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        expected.push(
          (file + rank) % 2 === 0 ? DARK_SQUARE_COLOR : LIGHT_SQUARE_COLOR,
        );
      }
    }
    expect(fillStyleSeq).toEqual(expected);
    // a1 is a dark square, h1 is a light square
    expect(fillStyleSeq[0]).toBe(DARK_SQUARE_COLOR);
    expect(fillStyleSeq[7]).toBe(LIGHT_SQUARE_COLOR);
  });

  it('fills the full board area from a1 bottom-left to h8 top-right', () => {
    const { ctx, fillRect } = createFakeCtx();
    renderBoard(ctx, parseFen(START_FEN), {}, { squareSize: 64 });
    expect(fillRect).toHaveBeenCalledWith(0, 448, 64, 64); // a1
    expect(fillRect).toHaveBeenCalledWith(448, 448, 64, 64); // h1
    expect(fillRect).toHaveBeenCalledWith(0, 0, 64, 64); // a8
    expect(fillRect).toHaveBeenCalledWith(448, 0, 64, 64); // h8
  });
});

describe('renderBoard pieces', () => {
  it('draws nothing for pieces when no sprite is loaded', () => {
    const { ctx, drawImage } = createFakeCtx();
    renderBoard(ctx, parseFen(START_FEN), {}, { squareSize: 64 });
    expect(drawImage).toHaveBeenCalledTimes(0);
  });

  it('draws only the pieces whose sprite is loaded (partial map)', () => {
    const { ctx, drawImage } = createFakeCtx();
    const sprites: SpriteMap = {
      wK: { key: 'wK' } as unknown as HTMLImageElement,
    };
    renderBoard(ctx, parseFen(START_FEN), sprites, { squareSize: 64 });
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(sprites.wK, 256, 448, 64, 64); // e1
  });

  it('draws all 32 starting pieces centered on their squares', () => {
    const { ctx, drawImage } = createFakeCtx();
    const sprites = fullSpriteMap();
    renderBoard(ctx, parseFen(START_FEN), sprites, { squareSize: 64 });

    expect(drawImage).toHaveBeenCalledTimes(32);
    expect(drawImage).toHaveBeenCalledWith(sprites.wR, 0, 448, 64, 64); // a1 white rook
    expect(drawImage).toHaveBeenCalledWith(sprites.wK, 256, 448, 64, 64); // e1 white king
    expect(drawImage).toHaveBeenCalledWith(sprites.wP, 0, 384, 64, 64); // a2 white pawn
    expect(drawImage).toHaveBeenCalledWith(sprites.bQ, 192, 0, 64, 64); // d8 black queen
    expect(drawImage).toHaveBeenCalledWith(sprites.bK, 256, 0, 64, 64); // e8 black king
    expect(drawImage).toHaveBeenCalledWith(sprites.bR, 0, 0, 64, 64); // a8 black rook
  });

  it('mirrors piece placement for the black orientation', () => {
    const { ctx, drawImage } = createFakeCtx();
    const sprites = fullSpriteMap();
    renderBoard(ctx, parseFen(START_FEN), sprites, {
      squareSize: 64,
      orientation: 'black',
    });

    expect(drawImage).toHaveBeenCalledWith(sprites.wR, 448, 0, 64, 64); // a1 top-right
    expect(drawImage).toHaveBeenCalledWith(sprites.bR, 448, 448, 64, 64); // a8 bottom-right
  });
});

describe('renderBoard Kiwipete', () => {
  it('renders exactly the squares the FEN describes with no stray sprites', () => {
    const { ctx, drawImage } = createFakeCtx();
    const sprites = fullSpriteMap();
    const state = parseFen(KIWIPETE);
    renderBoard(ctx, state, sprites, { squareSize: 64 });

    expect(drawImage).toHaveBeenCalledTimes(pieceLayout(state).length);
    expect(drawImage).toHaveBeenCalledWith(sprites.wR, 0, 448, 64, 64); // a1 white rook
    expect(drawImage).toHaveBeenCalledWith(sprites.wK, 256, 448, 64, 64); // e1 white king
    expect(drawImage).toHaveBeenCalledWith(sprites.wN, 256, 192, 64, 64); // e5 white knight
    expect(drawImage).toHaveBeenCalledWith(sprites.bR, 0, 0, 64, 64); // a8 black rook
    expect(drawImage).toHaveBeenCalledWith(sprites.bK, 256, 0, 64, 64); // e8 black king
    expect(drawImage).toHaveBeenCalledWith(sprites.bQ, 256, 64, 64, 64); // e7 black queen
    expect(drawImage).toHaveBeenCalledWith(sprites.bB, 384, 64, 64, 64); // g7 black bishop

    // Empty squares must draw nothing
    const drawnPositions = drawImage.mock.calls.map((args) => [
      args[1],
      args[2],
    ]);
    for (const empty of ['h6', 'a5', 'd4']) {
      const { x, y } = squareTopLeft(empty);
      expect(drawnPositions).not.toContainEqual([x, y]);
    }
  });
});

/** Top-left pixel of a square's cell (white orientation, 64px squares). */
function squareTopLeft(algebraic: string): { x: number; y: number } {
  const sq = squareFromAlgebraic(algebraic);
  return { x: fileOf(sq) * 64, y: (7 - rankOf(sq)) * 64 };
}

/** Canvas fake extended with the path API renderSelection uses. */
function createOverlayFakeCtx(): {
  ctx: CanvasRenderingContext2D;
  fillStyleSeq: string[];
  fillRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
} {
  const fillStyleSeq: string[] = [];
  let currentFillStyle = '';
  const fillRect = vi.fn();
  const beginPath = vi.fn();
  const moveTo = vi.fn();
  const arc = vi.fn();
  const fill = vi.fn();
  const ctx = {
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(value: string) {
      currentFillStyle = value;
      fillStyleSeq.push(value);
    },
    fillRect,
    beginPath,
    moveTo,
    arc,
    fill,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fillStyleSeq, fillRect, beginPath, moveTo, arc, fill };
}

describe('renderSelection', () => {
  it('draws nothing for a null selection', () => {
    const { ctx, fillRect, beginPath, fill } = createOverlayFakeCtx();
    renderSelection(ctx, null, { squareSize: 64 });
    expect(fillRect).not.toHaveBeenCalled();
    expect(beginPath).not.toHaveBeenCalled();
    expect(fill).not.toHaveBeenCalled();
  });

  it('tints the selected square and draws one dot per target', () => {
    const { ctx, fillStyleSeq, fillRect, beginPath, moveTo, arc, fill } =
      createOverlayFakeCtx();
    const selection = {
      from: squareFromAlgebraic('e2'),
      targets: [squareFromAlgebraic('e3'), squareFromAlgebraic('e4')],
    };

    renderSelection(ctx, selection, { squareSize: 64 });

    // Selection tint over e2 (256, 384).
    expect(fillStyleSeq).toEqual([SELECTION_COLOR, MOVE_DOT_COLOR]);
    expect(fillRect).toHaveBeenCalledTimes(1);
    expect(fillRect).toHaveBeenCalledWith(256, 384, 64, 64);

    // One dot per target, centered on the square.
    const radius = 64 * MOVE_DOT_RADIUS_FACTOR;
    expect(beginPath).toHaveBeenCalledTimes(1);
    expect(arc).toHaveBeenCalledTimes(2);
    expect(arc).toHaveBeenCalledWith(288, 352, radius, 0, Math.PI * 2); // e3
    expect(arc).toHaveBeenCalledWith(288, 288, radius, 0, Math.PI * 2); // e4
    expect(fill).toHaveBeenCalledTimes(1);
    // moveTo hops each circle's start point so arcs stay disjoint.
    expect(moveTo).toHaveBeenCalledWith(288 + radius, 352);
    expect(moveTo).toHaveBeenCalledWith(288 + radius, 288);
  });

  it('mirrors the overlay for the black orientation', () => {
    const { ctx, fillRect, arc } = createOverlayFakeCtx();
    const selection = {
      from: squareFromAlgebraic('e2'),
      targets: [squareFromAlgebraic('e3')],
    };

    renderSelection(ctx, selection, { squareSize: 64, orientation: 'black' });

    // e2 maps to the mirrored position (3, 1) -> x=(7-4)*64=192, y=1*64=64.
    expect(fillRect).toHaveBeenCalledWith(192, 64, 64, 64);
    // e3 target center mirrors to x=(7-4)*64+32=224, y=2*64+32=160.
    expect(arc).toHaveBeenCalledWith(
      224,
      160,
      64 * MOVE_DOT_RADIUS_FACTOR,
      0,
      Math.PI * 2,
    );
  });

  it('draws nothing for a selection with no targets (only the tint)', () => {
    const { ctx, fillRect, arc } = createOverlayFakeCtx();
    renderSelection(
      ctx,
      { from: squareFromAlgebraic('a1'), targets: [] },
      { squareSize: 64 },
    );
    expect(fillRect).toHaveBeenCalledTimes(1);
    expect(arc).not.toHaveBeenCalled();
  });
});
