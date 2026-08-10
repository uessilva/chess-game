import { describe, expect, it } from 'vitest';

import { isOnBoard, parseFen, PIECES, squareFromAlgebraic } from '../core';
import { pieceLayout } from './pieceLayout';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE =
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

describe('pieceLayout', () => {
  it('converts START_FEN into a 32-piece layout', () => {
    const layout = pieceLayout(parseFen(START_FEN));
    expect(layout).toHaveLength(32);
  });

  it('places the correct pieces on the correct starting squares', () => {
    const layout = pieceLayout(parseFen(START_FEN));
    expect(layout).toContainEqual({
      square: squareFromAlgebraic('a1'),
      piece: PIECES.white.rook,
    });
    expect(layout).toContainEqual({
      square: squareFromAlgebraic('e1'),
      piece: PIECES.white.king,
    });
    expect(layout).toContainEqual({
      square: squareFromAlgebraic('d8'),
      piece: PIECES.black.queen,
    });
    expect(layout).toContainEqual({
      square: squareFromAlgebraic('a8'),
      piece: PIECES.black.rook,
    });
    expect(layout).toContainEqual({
      square: squareFromAlgebraic('e8'),
      piece: PIECES.black.king,
    });
  });

  it('omits empty squares and never leaks off-board cells', () => {
    const layout = pieceLayout(parseFen(START_FEN));
    const empty = squareFromAlgebraic('e4');
    expect(layout.some((placed) => placed.square === empty)).toBe(false);
    for (const placed of layout) {
      expect(isOnBoard(placed.square)).toBe(true);
    }
  });

  it('produces the expected Kiwipete layout with no phantom pieces', () => {
    const layout = pieceLayout(parseFen(KIWIPETE));
    expect(layout).toHaveLength(32);

    expect(layout).toContainEqual({
      square: squareFromAlgebraic('a1'),
      piece: PIECES.white.rook,
    });
    expect(layout).toContainEqual({
      square: squareFromAlgebraic('e1'),
      piece: PIECES.white.king,
    });
    expect(layout).toContainEqual({
      square: squareFromAlgebraic('e5'),
      piece: PIECES.white.knight,
    });
    expect(layout).toContainEqual({
      square: squareFromAlgebraic('a8'),
      piece: PIECES.black.rook,
    });
    expect(layout).toContainEqual({
      square: squareFromAlgebraic('e8'),
      piece: PIECES.black.king,
    });
    expect(layout).toContainEqual({
      square: squareFromAlgebraic('e7'),
      piece: PIECES.black.queen,
    });
    expect(layout).toContainEqual({
      square: squareFromAlgebraic('g7'),
      piece: PIECES.black.bishop,
    });

    for (const empty of ['h6', 'a5', 'd4']) {
      const sq = squareFromAlgebraic(empty);
      expect(layout.some((placed) => placed.square === sq)).toBe(false);
    }
  });
});
