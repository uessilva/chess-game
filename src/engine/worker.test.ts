import { describe, expect, it } from 'vitest';

import { generateLegalMoves, parseFen } from '../core';
import { MATE_SCORE } from './search';
import { handleSearchRequest } from './worker';
import type { SearchResultMessage } from './worker';

/** The mate-in-1 fixture: at depth 1 the worker reports Qb7 with a mate score. */
const MATE_IN_ONE_FEN = 'k7/8/K7/8/8/8/8/1Q6 w - - 0 1';

/** Scholar's mate final position: Black is checkmated (no legal moves). */
const SCHOLARS_MATE_FEN =
  'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';

/** Stalemate: Black to move, no legal moves, not in check. */
const STALEMATE_FEN = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';

/** Capture every reply the handler posts. */
function collect(
  message: Parameters<typeof handleSearchRequest>[0],
): SearchResultMessage[] {
  const posts: SearchResultMessage[] = [];
  handleSearchRequest(message, (post) => posts.push(post));
  return posts;
}

describe('handleSearchRequest', () => {
  it('replies with a matching requestId, a legal move, the score, and the task-3.4 result fields', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const posts = collect({
      type: 'search',
      requestId: 42,
      fen,
      depth: 2,
      timeMs: 1000,
    });
    expect(posts).toHaveLength(1);
    const reply = posts[0];
    expect(reply.type).toBe('search-result');
    expect(reply.requestId).toBe(42);
    expect(reply.move).not.toBeNull();
    const legal = generateLegalMoves(parseFen(fen));
    expect(
      legal.some(
        (m) =>
          m.from === reply.move?.from &&
          m.to === reply.move?.to &&
          m.promotion === reply.move.promotion,
      ),
    ).toBe(true);
    // The score is the root search's score for the chosen move — a number,
    // positive here because White is heavily favoured at depth 2.
    expect(typeof reply.score).toBe('number');
    // The reply carries the full iterative-deepening result: the deepest
    // completed iteration (capped at the request's depth), the node count,
    // and the elapsed time.
    expect(reply.depth).toBeGreaterThanOrEqual(1);
    expect(reply.depth).toBeLessThanOrEqual(2);
    expect(reply.nodes).toBeGreaterThan(0);
    expect(reply.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a mate score for a forced mate at depth 1', () => {
    // An exhausted budget still completes depth 1 (floor guarantee).
    const posts = collect({
      type: 'search',
      requestId: 7,
      fen: MATE_IN_ONE_FEN,
      depth: 1,
      timeMs: 0,
    });
    expect(posts).toHaveLength(1);
    const reply = posts[0];
    expect(reply.move).toEqual({ from: 1, to: 97 }); // b1->b7, Qb7#
    expect(reply.score).toBe(MATE_SCORE - 1);
    expect(reply.depth).toBe(1);
  });

  it('replies with move null for a checkmated position', () => {
    const posts = collect({
      type: 'search',
      requestId: 3,
      fen: SCHOLARS_MATE_FEN,
      depth: 2,
      timeMs: 1000,
    });
    expect(posts).toHaveLength(1);
    expect(posts[0].move).toBeNull();
    expect(posts[0].score).toBe(-MATE_SCORE);
    expect(posts[0].depth).toBe(0);
  });

  it('replies with move null and score 0 for a stalemate — a draw, never a mate', () => {
    const posts = collect({
      type: 'search',
      requestId: 9,
      fen: STALEMATE_FEN,
      depth: 2,
      timeMs: 1000,
    });
    expect(posts).toHaveLength(1);
    expect(posts[0].move).toBeNull();
    expect(posts[0].score).toBe(0);
    expect(posts[0].depth).toBe(0);
  });

  it('carries the promotion piece through the wire format when the search promotes', () => {
    // White can promote on a8; at depth 2 the search picks a promotion.
    const posts = collect({
      type: 'search',
      requestId: 5,
      fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1',
      depth: 2,
      timeMs: 1000,
    });
    expect(posts).toHaveLength(1);
    const move = posts[0].move;
    expect(move).not.toBeNull();
    expect(move?.from).toBe(96); // a7
    expect(move?.to).toBe(112); // a8
    expect(['queen', 'rook', 'bishop', 'knight']).toContain(move?.promotion);
  });

  it('ignores messages that are not search requests', () => {
    const posts: SearchResultMessage[] = [];
    handleSearchRequest(
      { type: 'ping' } as unknown as Parameters<typeof handleSearchRequest>[0],
      (post) => posts.push(post),
    );
    expect(posts).toHaveLength(0);
  });
});
