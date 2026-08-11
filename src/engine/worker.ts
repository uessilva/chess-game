import { parseFen } from '../core';
import type { PieceType } from '../core';
import { search } from './search';

/**
 * Web Worker protocol shell (task 3.2): a thin, serializable boundary
 * around the pure search. FEN is the wire contract — matching core's
 * plain-data, side-effect-free principle — so the worker parses the
 * position itself and the main thread never sends a live BoardState.
 *
 * Request:  `{ type: 'search', requestId, fen, depth }`
 * Response: `{ type: 'search-result', requestId, move, score }`
 *
 * The handler is exported as a pure function (`handleSearchRequest`) so
 * tests drive it directly in Node; the top-level wiring below attaches it
 * to the dedicated-worker scope only when one exists. The receiver (the
 * UI) is responsible for the stale guard: replies carry the requestId of
 * the request they answer, and the UI drops any reply whose requestId does
 * not match its latest request.
 */

export interface SearchRequestMessage {
  readonly type: 'search';
  readonly requestId: number;
  readonly fen: string;
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
  const result = search(state, message.depth);
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
