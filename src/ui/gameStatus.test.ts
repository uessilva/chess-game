import { describe, expect, it } from 'vitest';

import { makeMove, parseFen, squareFromAlgebraic, zobristHash } from '../core';
import type { BoardState, Move, PieceType } from '../core';
import {
  deriveGameStatus,
  gameOverLabel,
  isTerminal,
  statusLineLabel,
} from './gameStatus';

const sq = squareFromAlgebraic;

function mv(from: string, to: string, piece: PieceType, flags = 0): Move {
  return {
    from: sq(from),
    to: sq(to),
    piece,
    flags,
  };
}

/** Force a position's history to three occurrences of its own hash. */
function repeatThreeTimes(state: BoardState): void {
  const hash = zobristHash(state);
  state.positionHashes = [hash, hash, hash];
}

describe('deriveGameStatus', () => {
  it('reports playing from the starting position', () => {
    expect(
      deriveGameStatus(
        parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'),
      ),
    ).toEqual({
      kind: 'playing',
    });
  });

  it('reports check when the side to move is in check but has legal moves', () => {
    const state = parseFen('4r1k1/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(deriveGameStatus(state)).toEqual({ kind: 'check' });
  });

  it('reports checkmate with the winner when no legal evasion exists', () => {
    // Back-rank mate: the black king g8 is in check from the e8 rook.
    const state = parseFen('4R1k1/5ppp/8/8/8/8/8/6K1 b - - 0 1');
    expect(deriveGameStatus(state)).toEqual({
      kind: 'checkmate',
      winner: 'white',
    });
  });

  it('reports stalemate when the side to move is not in check and has no legal moves', () => {
    const state = parseFen('k7/8/1Q6/8/8/8/8/K7 b - - 0 1');
    expect(deriveGameStatus(state)).toEqual({ kind: 'stalemate' });
  });

  it('reports threefold repetition once a position repeats for the third time', () => {
    // Knight shuffle: 1.Nf3 Nf6 2.Ng1 Ng8 3.Nf3 Nf6 4.Ng1 Ng8 — the
    // starting position appears for the third time.
    const state = parseFen(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    );
    const shuffle = [
      mv('g1', 'f3', 'knight'),
      mv('g8', 'f6', 'knight'),
      mv('f3', 'g1', 'knight'),
      mv('f6', 'g8', 'knight'),
      mv('g1', 'f3', 'knight'),
      mv('g8', 'f6', 'knight'),
      mv('f3', 'g1', 'knight'),
      mv('f6', 'g8', 'knight'),
    ];
    for (const move of shuffle) {
      makeMove(state, move);
    }
    expect(deriveGameStatus(state)).toEqual({ kind: 'threefold-repetition' });
  });

  it('reports fifty-move draw when the halfmove clock reaches 100', () => {
    const state = parseFen('4k3/8/8/8/8/8/8/4K3 w - - 100 75');
    expect(deriveGameStatus(state)).toEqual({ kind: 'fifty-move' });
  });

  it('reports insufficient material for K vs K', () => {
    const state = parseFen('4k3/8/8/8/8/8/8/4K3 b - - 0 1');
    expect(deriveGameStatus(state)).toEqual({ kind: 'insufficient-material' });
  });

  it('wraps the core predicates only — a live low-clock position plays on', () => {
    const state = parseFen(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 99 50',
    );
    expect(deriveGameStatus(state)).toEqual({ kind: 'playing' });
  });
});

describe('deriveGameStatus: deterministic priority', () => {
  it('checkmate wins over threefold repetition when both match', () => {
    const state = parseFen('4R1k1/5ppp/8/8/8/8/8/6K1 b - - 0 1');
    repeatThreeTimes(state);
    expect(deriveGameStatus(state)).toEqual({
      kind: 'checkmate',
      winner: 'white',
    });
  });

  it('stalemate wins over threefold repetition when both match', () => {
    const state = parseFen('k7/8/1Q6/8/8/8/8/K7 b - - 0 1');
    repeatThreeTimes(state);
    expect(deriveGameStatus(state)).toEqual({ kind: 'stalemate' });
  });

  it('threefold repetition wins over the fifty-move rule when both match', () => {
    const state = parseFen('4k3/8/8/8/8/8/8/4K3 w - - 100 75');
    repeatThreeTimes(state);
    expect(deriveGameStatus(state)).toEqual({ kind: 'threefold-repetition' });
  });

  it('the fifty-move rule wins over insufficient material when both match', () => {
    // K vs K is also insufficient material; the fifty-move threshold reports
    // the fifty-move reason per the spec priority.
    const state = parseFen('4k3/8/8/8/8/8/8/4K3 b - - 100 75');
    expect(deriveGameStatus(state)).toEqual({ kind: 'fifty-move' });
  });
});

describe('isTerminal', () => {
  it('treats every game-over status as terminal', () => {
    const terminal: ReturnType<typeof deriveGameStatus>[] = [
      deriveGameStatus(parseFen('4R1k1/5ppp/8/8/8/8/8/6K1 b - - 0 1')),
      deriveGameStatus(parseFen('k7/8/1Q6/8/8/8/8/K7 b - - 0 1')),
      deriveGameStatus(parseFen('4k3/8/8/8/8/8/8/4K3 b - - 100 75')),
      deriveGameStatus(parseFen('4k3/8/8/8/8/8/8/4K3 b - - 0 1')),
      { kind: 'threefold-repetition' },
    ];
    for (const status of terminal) {
      expect(isTerminal(status)).toBe(true);
    }
  });

  it('treats playing and check as live', () => {
    expect(isTerminal({ kind: 'playing' })).toBe(false);
    expect(
      isTerminal(deriveGameStatus(parseFen('4r1k1/8/8/8/8/8/8/4K3 w - - 0 1'))),
    ).toBe(false);
  });
});

describe('gameOverLabel', () => {
  it('renders the spec copy for every terminal status', () => {
    expect(gameOverLabel({ kind: 'checkmate', winner: 'white' })).toBe(
      'Checkmate — White wins',
    );
    expect(gameOverLabel({ kind: 'checkmate', winner: 'black' })).toBe(
      'Checkmate — Black wins',
    );
    expect(gameOverLabel({ kind: 'stalemate' })).toBe('Stalemate — draw');
    expect(gameOverLabel({ kind: 'threefold-repetition' })).toBe(
      'Draw by threefold repetition',
    );
    expect(gameOverLabel({ kind: 'fifty-move' })).toBe(
      'Draw by fifty-move rule',
    );
    expect(gameOverLabel({ kind: 'insufficient-material' })).toBe(
      'Draw by insufficient material',
    );
  });

  it('is null while the game continues', () => {
    expect(gameOverLabel({ kind: 'playing' })).toBeNull();
    expect(gameOverLabel({ kind: 'check' })).toBeNull();
  });
});

describe('statusLineLabel', () => {
  it('shows the side to move', () => {
    expect(statusLineLabel({ kind: 'playing' }, 'white')).toBe('White to move');
    expect(statusLineLabel({ kind: 'playing' }, 'black')).toBe('Black to move');
  });

  it('appends the Check! indicator when the side to move is in check', () => {
    expect(statusLineLabel({ kind: 'check' }, 'white')).toBe(
      'White to move — Check!',
    );
    expect(statusLineLabel({ kind: 'check' }, 'black')).toBe(
      'Black to move — Check!',
    );
  });
});
