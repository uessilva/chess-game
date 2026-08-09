/** The two sides. */
export type Color = 'white' | 'black';

export function opposite(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

export type PieceType =
  'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

export interface Piece {
  readonly color: Color;
  readonly type: PieceType;
}

/**
 * The 12 distinct pieces as shared frozen singletons. Board cells hold
 * references to these, so make/unmake never allocates piece objects.
 */
export const PIECES: Record<Color, Record<PieceType, Piece>> = {
  white: {
    pawn: Object.freeze({ color: 'white', type: 'pawn' }),
    knight: Object.freeze({ color: 'white', type: 'knight' }),
    bishop: Object.freeze({ color: 'white', type: 'bishop' }),
    rook: Object.freeze({ color: 'white', type: 'rook' }),
    queen: Object.freeze({ color: 'white', type: 'queen' }),
    king: Object.freeze({ color: 'white', type: 'king' }),
  },
  black: {
    pawn: Object.freeze({ color: 'black', type: 'pawn' }),
    knight: Object.freeze({ color: 'black', type: 'knight' }),
    bishop: Object.freeze({ color: 'black', type: 'bishop' }),
    rook: Object.freeze({ color: 'black', type: 'rook' }),
    queen: Object.freeze({ color: 'black', type: 'queen' }),
    king: Object.freeze({ color: 'black', type: 'king' }),
  },
};

/**
 * Index into the 0x88 board (0–127). A square is on the board iff
 * `(sq & 0x88) === 0`; see board.ts.
 */
export type Square = number;

/**
 * Bitflags describing the mechanics of a move. Move generation (task 1.5+)
 * sets these; make/unmake are purely driven by them.
 */
export const MoveFlags = {
  CAPTURE: 1 << 0,
  DOUBLE_PUSH: 1 << 1,
  EN_PASSANT: 1 << 2,
  CASTLE_KING: 1 << 3,
  CASTLE_QUEEN: 1 << 4,
  PROMOTION: 1 << 5,
} as const;

export interface Move {
  readonly from: Square;
  readonly to: Square;
  /** Type of the moving piece; also what unmake restores on `from`. */
  readonly piece: PieceType;
  /** Target piece type when PROMOTION is set. */
  readonly promotion?: PieceType;
  readonly flags: number;
}
