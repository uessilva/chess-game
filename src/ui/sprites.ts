import type { Color, Piece, PieceType } from '../core';

/**
 * Asset key for the 12 cburnett piece sprites, named after the vendor'd
 * files in public/pieces/ (wK.svg .. bP.svg).
 */
export type SpriteKey =
  | 'wK'
  | 'wQ'
  | 'wR'
  | 'wB'
  | 'wN'
  | 'wP'
  | 'bK'
  | 'bQ'
  | 'bR'
  | 'bB'
  | 'bN'
  | 'bP';

export const SPRITE_KEYS: readonly SpriteKey[] = [
  'wK',
  'wQ',
  'wR',
  'wB',
  'wN',
  'wP',
  'bK',
  'bQ',
  'bR',
  'bB',
  'bN',
  'bP',
];

/** Public URL of each sprite asset (served from the project's public/ dir). */
export const SPRITE_SOURCES: Record<SpriteKey, string> = {
  wK: '/pieces/wK.svg',
  wQ: '/pieces/wQ.svg',
  wR: '/pieces/wR.svg',
  wB: '/pieces/wB.svg',
  wN: '/pieces/wN.svg',
  wP: '/pieces/wP.svg',
  bK: '/pieces/bK.svg',
  bQ: '/pieces/bQ.svg',
  bR: '/pieces/bR.svg',
  bB: '/pieces/bB.svg',
  bN: '/pieces/bN.svg',
  bP: '/pieces/bP.svg',
};

/** The 12 { color, type } -> asset key manifest. */
export const SPRITE_KEY_BY_PIECE: Record<
  Color,
  Record<PieceType, SpriteKey>
> = {
  white: {
    pawn: 'wP',
    knight: 'wN',
    bishop: 'wB',
    rook: 'wR',
    queen: 'wQ',
    king: 'wK',
  },
  black: {
    pawn: 'bP',
    knight: 'bN',
    bishop: 'bB',
    rook: 'bR',
    queen: 'bQ',
    king: 'bK',
  },
};

/** Map a core Piece singleton to its sprite asset key. */
export function spriteKeyFor(piece: Piece): SpriteKey {
  return SPRITE_KEY_BY_PIECE[piece.color][piece.type];
}

/**
 * The loaded sprite images keyed by asset. A key missing from the map means
 * that sprite is not loaded yet; renderBoard draws nothing for it.
 */
export type SpriteMap = Partial<Record<SpriteKey, HTMLImageElement>>;

/**
 * Load every sprite via the browser Image API. `createImage` is injectable so
 * tests can stub image loading without a DOM; it defaults to `new Image()`.
 * Resolves with a full SpriteMap once all 12 sprites are ready, and rejects
 * with an error naming the failing asset when any one fails to decode.
 */
export function preloadSprites(
  createImage: () => HTMLImageElement = () => new Image(),
): Promise<SpriteMap> {
  return Promise.all(
    SPRITE_KEYS.map((key) => loadSprite(createImage, key, SPRITE_SOURCES[key])),
  ).then((entries) => {
    const map: SpriteMap = {};
    for (const [key, img] of entries) {
      map[key] = img;
    }
    return map;
  });
}

async function loadSprite(
  createImage: () => HTMLImageElement,
  key: SpriteKey,
  src: string,
): Promise<[SpriteKey, HTMLImageElement]> {
  const img = createImage();
  img.src = src;
  try {
    await img.decode();
  } catch {
    throw new Error(`failed to load sprite "${key}" (${src})`);
  }
  return [key, img];
}
