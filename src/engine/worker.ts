import { parseFen } from '../core';
import type { PieceType } from '../core';
import { searchWithTime } from './iterativeDeepening';
import { TranspositionTable } from './transpositionTable';

/**
 * Web Worker protocol shell (task 3.2, extended by 3.4/3.5): a thin,
 * serializable boundary around the pure search. FEN is the wire contract —
 * matching core's plain-data, side-effect-free principle — so the worker
 * parses the position itself and the main thread never sends a live
 * BoardState.
 *
 * Request:  `{ type: 'search', requestId, fen, timeMs, depth }`
 * Response: `{ type: 'search-result', requestId, move, score, depth,
 *             nodes, elapsedMs }`
 *
 * The request carries the thinking budget (`timeMs`); `depth` is the
 * maximum-depth cap the UI's engine-depth knob provides. The reply carries
 * the full task-3.4 result: move, score, the deepest completed depth, the
 * node count, and the elapsed time.
 *
 * The worker owns one transposition table (task 3.5) that persists across
 * requests: positions re-searched in later requests (transpositions,
 * repeated lines) are hit from the cache, and the stored best moves feed
 * ordering. Entries are keyed by the full 64-bit Zobrist hash and
 * full-key verified on probe, so reuse is always correct — the TT only
 * ever changes how fast a search finishes, never the move or score it
 * reports.
 *
 * The handler is exported as a pure function (`handleSearchRequest`) so
 * tests drive it directly in Node; the top-level wiring below attaches it
 * to the dedicated-worker scope only when one exists. The receiver (the
 * UI) is responsible for the stale guard: replies carry the requestId of
 * the request they answer, and the UI drops any reply whose requestId does
 * not match its latest request.
 */

/** The worker's transposition table, shared across search requests. */
const transpositionTable = new TranspositionTable();

export interface SearchRequestMessage {
  readonly type: 'search';
  readonly requestId: number;
  readonly fen: string;
  /** The thinking budget in milliseconds. */
  readonly timeMs: number;
  /** Maximum-depth cap for iterative deepening. */
  readonly depth: number;
}

export interface SearchResultMessage {
  readonly type: 'search-result';
  readonly requestId: number;
  readonly move: {
    readonly from: number;
    readonly to: number;
    readonly promotion?: PieceType;
  } | null;
  readonly score: number;
  /** Deepest fully completed iteration. */
  readonly depth: number;
  /** Total nodes searched across all iterations. */
  readonly nodes: number;
  /** Elapsed milliseconds. */
  readonly elapsedMs: number;
}

/**
 * Answer one protocol message. Non-search messages are ignored (the worker
 * may receive control traffic later; it never replies to what it does not
 * understand). The reply echoes the requestId so the receiver can drop
 * stale results, and carries the search's root score alongside the move.
 */
export function handleSearchRequest(
  message: SearchRequestMessage,
  post: (message: SearchResultMessage) => void,
): void {
  if (message.type !== 'search') {
    return;
  }
  const state = parseFen(message.fen);
  const result = searchWithTime(state, {
    timeMs: message.timeMs,
    maxDepth: message.depth,
    tt: transpositionTable,
  });
  post({
    type: 'search-result',
    requestId: message.requestId,
    move:
      result.move === null
        ? null
        : {
            from: result.move.from,
            to: result.move.to,
            promotion: result.move.promotion,
          },
    score: result.score,
    depth: result.depth,
    nodes: result.nodes,
    elapsedMs: result.elapsedMs,
  });
}

// Wire the handler to the dedicated worker scope. `self` exists in the
// worker (and in Node worker_threads); in plain Node/Vitest main-thread
// test runs it does not, so the guard keeps importing this module safe.
if (typeof self !== 'undefined') {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<SearchRequestMessage>) => void) | null;
    postMessage: (message: SearchResultMessage) => void;
  };
  scope.onmessage = (event: MessageEvent<SearchRequestMessage>): void => {
    handleSearchRequest(event.data, (message) => scope.postMessage(message));
  };
}
