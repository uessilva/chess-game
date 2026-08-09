import { BOARD_SIZE, fileOf, isOnBoard, rankOf, square } from './board';
import type { BoardState } from './state';
import type { Color, PieceType, Square } from './types';
import { PIECES } from './types';

/**
 * Zobrist hashing (task 1.8): a single 64-bit hash identifying a chess
 * position for threefold-repetition detection (FIDE article 9.2).
 *
 * Position identity — two positions are the same iff this hash matches:
 * same piece placement, same side to move, same castling rights, and the
 * same set of possible moves. Per FIDE 9.2.2:
 *  - Castling rights are permanent: a rook leaving h1 and returning does
 *    not restore the lost right, so the position is not identical.
 *  - The en-passant target square matters ONLY when a legal en-passant
 *    capture actually exists. A double push that leaves a meaningless ep
 *    target (no enemy pawn can capture) hashes identically to the same
 *    position with no ep square. We use the same rank/file adjacency
 *    condition as movegen.ts (pseudo-legal availability), treating the
 *    pinned-ep corner case as "possible" — this matches common engine
 *    practice (python-chess) and keeps position identity independent of
 *    the legality filter.
 * The halfmove clock and fullmove number are NOT part of identity.
 *
 * The table is generated once at module load from a fixed-seed PRNG
 * (mulberry32), so hashes are deterministic within a run. Incremental
 * XOR updating is a Phase 3 optimization (#20) — a full recompute per
 * position is fine now (correctness before optimization).
 */

/** En-passant capture geometry, mirroring movegen.ts exactly. */
const EP_PAWN_RANK: Record<Color, number> = { white: 4, black: 3 };
const EP_TARGET_RANK: Record<Color, number> = { white: 5, black: 2 };

/** One index per distinct (color, type) piece, in PIECES row-major order. */
const PIECE_INDEX: Record<Color, Record<PieceType, number>> = {
  white: { pawn: 0, knight: 1, bishop: 2, rook: 3, queen: 4, king: 5 },
  black: { pawn: 6, knight: 7, bishop: 8, rook: 9, queen: 10, king: 11 },
};

/** Fixed seed so the table (and therefore every hash) is stable. */
const ZOBRIST_SEED = 0x9e3779b9;

/** Small, fast, deterministic PRNG; the project's hash tables use it. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One pseudorandom 64-bit value as a bigint. */
function rand64(rand: () => number): bigint {
  const hi = (rand() * 0x100000000) >>> 0;
  const lo = (rand() * 0x100000000) >>> 0;
  return (BigInt(hi) << 32n) | BigInt(lo);
}

interface ZobristTable {
  /** One value per (square, piece index); off-board squares are unused. */
  pieces: bigint[][];
  /** XORed when black is to move. */
  sideToMove: bigint;
  castling: Record<
    'whiteKingside' | 'whiteQueenside' | 'blackKingside' | 'blackQueenside',
    bigint
  >;
  /** One value per en-passant file, used only when a capture is available. */
  epFile: bigint[];
}

function generateTable(): ZobristTable {
  const rand = mulberry32(ZOBRIST_SEED);
  const pieces: bigint[][] = [];
  for (let sq = 0; sq < BOARD_SIZE; sq++) {
    pieces.push(Array.from({ length: 12 }, () => rand64(rand)));
  }
  return {
    pieces,
    sideToMove: rand64(rand),
    castling: {
      whiteKingside: rand64(rand),
      whiteQueenside: rand64(rand),
      blackKingside: rand64(rand),
      blackQueenside: rand64(rand),
    },
    epFile: Array.from({ length: 8 }, () => rand64(rand)),
  };
}

const TABLE = generateTable();

/**
 * The recorded en-passant square when a capture is pseudo-legally
 * available for the side to move (the movegen.ts adjacency condition:
 * a pawn of the mover stands one file over the target on the capture
 * rank), else null. A meaningless ep square hashes like no ep square.
 */
function meaningfulEnPassant(state: BoardState): Square | null {
  const { board, enPassant, turn } = state;
  if (enPassant === null) {
    return null;
  }
  if (rankOf(enPassant) !== EP_TARGET_RANK[turn]) {
    return null;
  }
  const file = fileOf(enPassant);
  for (const df of [-1, 1] as const) {
    const sq = square(file + df, EP_PAWN_RANK[turn]);
    if (isOnBoard(sq) && board[sq] === PIECES[turn].pawn) {
      return enPassant;
    }
  }
  return null;
}

/**
 * A 64-bit hash of the position's identity: piece placement, side to
 * move, castling rights, and (only when meaningful) the en-passant file.
 * Equal hashes mean identical positions for repetition purposes.
 */
export function zobristHash(state: BoardState): bigint {
  let hash = 0n;
  for (let sq = 0; sq < BOARD_SIZE; sq++) {
    const piece = state.board[sq];
    if (piece !== null) {
      hash ^= TABLE.pieces[sq][PIECE_INDEX[piece.color][piece.type]];
    }
  }
  if (state.turn === 'black') {
    hash ^= TABLE.sideToMove;
  }
  if (state.castling.whiteKingside) {
    hash ^= TABLE.castling.whiteKingside;
  }
  if (state.castling.whiteQueenside) {
    hash ^= TABLE.castling.whiteQueenside;
  }
  if (state.castling.blackKingside) {
    hash ^= TABLE.castling.blackKingside;
  }
  if (state.castling.blackQueenside) {
    hash ^= TABLE.castling.blackQueenside;
  }
  const ep = meaningfulEnPassant(state);
  if (ep !== null) {
    hash ^= TABLE.epFile[fileOf(ep)];
  }
  return hash;
}
