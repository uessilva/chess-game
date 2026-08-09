import {
  algebraicOf,
  emptyBoard,
  rankOf,
  square,
  squareFromAlgebraic,
} from './board';
import type { BoardState, CastlingRights } from './state';
import type { Color, Piece, PieceType, Square } from './types';
import { PIECES } from './types';

/** FEN of the standard starting position. */
export const START_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const TYPES_BY_CHAR: Partial<Record<string, PieceType>> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

const CHARS_BY_TYPE: Record<PieceType, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

const CASTLING_KEYS: Partial<Record<string, keyof CastlingRights>> = {
  K: 'whiteKingside',
  Q: 'whiteQueenside',
  k: 'blackKingside',
  q: 'blackQueenside',
};

/**
 * Parse the piece-placement field. FEN lists rank 8 first; our 0x88 rank
 * index 0 is rank 1, so the row order flips. Cells reference the shared
 * PIECES singletons, keeping identity comparisons (and make/unmake) valid
 * for parsed positions. A rank whose width is not exactly 8 is rejected;
 * kings are counted here so positions missing a king — useless to the
 * legality checks in 1.6 — fail fast with a clear message.
 */
function parsePlacement(field: string): (Piece | null)[] {
  const rows = field.split('/');
  if (rows.length !== 8) {
    throw new Error(
      `invalid FEN: piece placement must have 8 ranks, got ${rows.length}`,
    );
  }

  const board = emptyBoard();
  const kings: Record<Color, number> = { white: 0, black: 0 };
  for (let row = 0; row < 8; row++) {
    const rank = 7 - row;
    let file = 0;
    for (const char of rows[row]) {
      if (char >= '1' && char <= '8') {
        file += char.charCodeAt(0) - '0'.charCodeAt(0);
        continue;
      }
      const type = TYPES_BY_CHAR[char.toLowerCase()];
      if (type === undefined) {
        throw new Error(
          `invalid FEN: unexpected character "${char}" in piece placement`,
        );
      }
      const color: Color = char === char.toLowerCase() ? 'black' : 'white';
      board[square(file, rank)] = PIECES[color][type];
      if (type === 'king') {
        kings[color]++;
      }
      file++;
    }
    if (file !== 8) {
      throw new Error(
        `invalid FEN: rank ${rank + 1} has ${file} squares, expected 8`,
      );
    }
  }
  if (kings.white !== 1 || kings.black !== 1) {
    throw new Error(
      `invalid FEN: expected exactly one king per side, ` +
        `got ${kings.white} white and ${kings.black} black`,
    );
  }
  return board;
}

function parseTurn(field: string): Color {
  if (field === 'w') {
    return 'white';
  }
  if (field === 'b') {
    return 'black';
  }
  throw new Error(
    `invalid FEN: side to move must be "w" or "b", got "${field}"`,
  );
}

/** Any order of KQkq is accepted; serialization always emits KQkq order. */
function parseCastling(field: string): CastlingRights {
  const rights: CastlingRights = {
    whiteKingside: false,
    whiteQueenside: false,
    blackKingside: false,
    blackQueenside: false,
  };
  if (field === '-') {
    return rights;
  }
  for (const char of field) {
    const key = CASTLING_KEYS[char];
    if (key === undefined) {
      throw new Error(
        `invalid FEN: unexpected character "${char}" in castling rights`,
      );
    }
    if (rights[key]) {
      throw new Error(`invalid FEN: duplicate "${char}" in castling rights`);
    }
    rights[key] = true;
  }
  return rights;
}

/**
 * The en-passant target is the square a just-double-pushed pawn passed
 * over, so only ranks 3 and 6 are meaningful.
 */
function parseEnPassant(field: string): Square | null {
  if (field === '-') {
    return null;
  }
  let sq: Square;
  try {
    sq = squareFromAlgebraic(field);
  } catch {
    throw new Error(`invalid FEN: malformed en-passant square "${field}"`);
  }
  const rank = rankOf(sq);
  if (rank !== 2 && rank !== 5) {
    throw new Error(
      `invalid FEN: en-passant square "${field}" must be on rank 3 or 6`,
    );
  }
  return sq;
}

function parseCounter(field: string, name: string, min: number): number {
  if (!/^\d+$/.test(field)) {
    throw new Error(
      `invalid FEN: ${name} must be a whole number, got "${field}"`,
    );
  }
  const value = Number(field);
  if (value < min) {
    throw new Error(
      `invalid FEN: ${name} must be at least ${min}, got ${value}`,
    );
  }
  return value;
}

/**
 * Parse a FEN string into a fresh BoardState (empty history). Validation
 * is structural — field counts, rank widths, character sets, number
 * ranges — plus requiring exactly one king per side. Deeper legality
 * (pawn counts, pinned kings, etc.) is deliberately out of scope: FENs
 * here are fixtures for move generation, which never sees illegal input.
 * All failures throw an Error prefixed "invalid FEN:".
 */
export function parseFen(fen: string): BoardState {
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6) {
    throw new Error(`invalid FEN: expected 6 fields, got ${fields.length}`);
  }
  return {
    board: parsePlacement(fields[0]),
    turn: parseTurn(fields[1]),
    castling: parseCastling(fields[2]),
    enPassant: parseEnPassant(fields[3]),
    halfmoveClock: parseCounter(fields[4], 'halfmove clock', 0),
    fullmoveNumber: parseCounter(fields[5], 'fullmove number', 1),
    history: [],
  };
}

function placementToFen(state: BoardState): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = state.board[square(file, rank)];
      if (piece === null) {
        empty++;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      const char = CHARS_BY_TYPE[piece.type];
      row += piece.color === 'white' ? char.toUpperCase() : char;
    }
    if (empty > 0) {
      row += String(empty);
    }
    rows.push(row);
  }
  return rows.join('/');
}

function castlingToFen(castling: CastlingRights): string {
  let field = '';
  if (castling.whiteKingside) {
    field += 'K';
  }
  if (castling.whiteQueenside) {
    field += 'Q';
  }
  if (castling.blackKingside) {
    field += 'k';
  }
  if (castling.blackQueenside) {
    field += 'q';
  }
  return field === '' ? '-' : field;
}

/**
 * Serialize a BoardState to canonical FEN: castling rights in KQkq order,
 * "-" for empty fields. The undo stack is position-irrelevant and omitted,
 * so toFen(parseFen(f)) === f for any valid FEN f.
 */
export function toFen(state: BoardState): string {
  return [
    placementToFen(state),
    state.turn === 'white' ? 'w' : 'b',
    castlingToFen(state.castling),
    state.enPassant === null ? '-' : algebraicOf(state.enPassant),
    String(state.halfmoveClock),
    String(state.fullmoveNumber),
  ].join(' ');
}
