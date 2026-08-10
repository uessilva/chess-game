import { generateLegalMoves, initialState, makeMove } from '../core';
import type { BoardState, Color, Move, PieceType, Square } from '../core';
import { MoveFlags } from '../core';
import { deriveGameStatus, isTerminal } from './gameStatus';

/**
 * UI selection state: the chosen square plus the legal target squares derived
 * from `generateLegalMoves`. Kept strictly separate from core `BoardState` —
 * the architecture rule that UI state never leaks into core.
 */
export interface Selection {
  readonly from: Square;
  /**
   * Legal destination squares of `from`, deduplicated so the four promotion
   * variants of one pawn push collapse into a single dot.
   */
  readonly targets: readonly Square[];
}

/**
 * A promotion commit held in UI state: the pawn's from/to pair and the
 * mover's color (the color the picker offers). The move is NOT applied to
 * core until the player chooses a piece (`choosePromotion`) — the picker
 * supersedes #11's default-queen and #12's silent no-op behaviors.
 */
export interface PendingPromotion {
  readonly from: Square;
  readonly to: Square;
  readonly color: Color;
}

/**
 * Click-to-move interaction controller. Owns the selection state and drives a
 * core `BoardState`, consuming it exactly as exported: targets come from
 * `generateLegalMoves(state)` and moves execute only through
 * `makeMove(state, move)` with a move taken from that same legal list — the UI
 * never constructs moves from raw square pairs, so "only legal moves execute"
 * holds by construction. Pure: no DOM, no canvas, no I/O, so this module unit
 * tests in Vitest's default node environment.
 *
 * Behavior contract:
 * - Click a piece of `state.turn` → select it; dots on every legal target.
 * - Click a different piece of `state.turn` → re-select and refresh the dots.
 * - Click a dotted target → execute the matching move via `makeMove`, clear.
 * - Click a dotted back-rank target whose legal variants all promote → the
 *   move is held as `pendingPromotion` (picker opens), never applied.
 * - Click anything else → clear the selection; no move; core unchanged.
 * - When the game is over (mate, stalemate, or an auto-ended draw) or the
 *   promotion picker is open, no click selects or moves anything.
 */
export interface Controller {
  readonly state: BoardState;
  readonly selection: Selection | null;
  /**
   * A promotion commit awaiting a piece choice, or null. Lives in UI state
   * only — core `BoardState` changes exclusively through `makeMove`.
   */
  readonly pendingPromotion: PendingPromotion | null;
  /** Apply one click on an on-board square (`sq` must be on the 0x88 board). */
  handleSquareClick(sq: Square): void;
  /**
   * Hold a from/to pair that only resolves to promotion variants as the
   * pending promotion (the picker path used by drag-and-drop). No move is
   * applied; the picker's piece choices call `choosePromotion`.
   */
  holdPromotion(from: Square, to: Square): void;
  /**
   * Apply the pending promotion with exactly the chosen piece via
   * `makeMove`: the pawn is replaced and the turn passes.
   */
  choosePromotion(pieceType: PieceType): void;
  /**
   * Discard the pending promotion without applying any move: the pawn stays
   * on its origin square and the selection clears.
   */
  cancelPromotion(): void;
  /**
   * Drop the current selection without touching core state. Used when a drag
   * gesture supersedes the click UI (a drop or cancel leaves any stale
   * selection from an earlier click obsolete).
   */
  clearSelection(): void;
  /**
   * Reset core to the starting position in place (the same object the drag
   * machine and render loop hold) and clear every piece of UI state:
   * selection, pending promotion. Game-over banner/check indicator live in
   * the caller and are re-derived from the reset state.
   */
  reset(): void;
}

export function createController(initial: BoardState): Controller {
  const state = initial;
  let selectedFrom: Square | null = null;
  let targets: readonly Square[] = [];
  let pending: PendingPromotion | null = null;

  function clearSelection(): void {
    selectedFrom = null;
    targets = [];
  }

  function selectFrom(sq: Square, moves: Move[]): void {
    selectedFrom = sq;
    targets = [
      ...new Set(
        moves.filter((move) => move.from === sq).map((move) => move.to),
      ),
    ];
  }

  function holdPromotion(from: Square, to: Square): void {
    const matches = generateLegalMoves(state).filter(
      (move) =>
        move.from === from &&
        move.to === to &&
        (move.flags & MoveFlags.PROMOTION) !== 0,
    );
    if (matches.length === 0) {
      return;
    }
    pending = { from, to, color: state.turn };
    clearSelection();
  }

  function choosePromotion(pieceType: PieceType): void {
    if (pending === null) {
      return;
    }
    const { from, to } = pending;
    const move = generateLegalMoves(state).find(
      (m) => m.from === from && m.to === to && m.promotion === pieceType,
    );
    if (move !== undefined) {
      makeMove(state, move);
    }
    pending = null;
    clearSelection();
  }

  function cancelPromotion(): void {
    pending = null;
    clearSelection();
  }

  function reset(): void {
    const fresh = initialState();
    // Copy the fresh state's fields onto the existing object so the shared
    // reference held by the drag machine and the render loop stays valid.
    state.board = fresh.board;
    state.turn = fresh.turn;
    state.castling = fresh.castling;
    state.enPassant = fresh.enPassant;
    state.halfmoveClock = fresh.halfmoveClock;
    state.fullmoveNumber = fresh.fullmoveNumber;
    state.history = fresh.history;
    state.positionHashes = fresh.positionHashes;
    pending = null;
    clearSelection();
  }

  return {
    get state() {
      return state;
    },
    get selection(): Selection | null {
      return selectedFrom === null ? null : { from: selectedFrom, targets };
    },
    get pendingPromotion(): PendingPromotion | null {
      return pending;
    },
    clearSelection(): void {
      clearSelection();
    },
    holdPromotion(from: Square, to: Square): void {
      holdPromotion(from, to);
    },
    choosePromotion(pieceType: PieceType): void {
      choosePromotion(pieceType);
    },
    cancelPromotion(): void {
      cancelPromotion();
    },
    reset(): void {
      reset();
    },
    handleSquareClick(sq: Square): void {
      // While the picker is open the only allowed paths are choosing a piece
      // or canceling; board clicks never move pieces or change selection.
      if (pending !== null) {
        return;
      }
      // Game over: mate, stalemate, or an auto-ended draw — the board is
      // frozen, nothing selects (the only control is New game).
      if (isTerminal(deriveGameStatus(state))) {
        clearSelection();
        return;
      }

      const moves = generateLegalMoves(state);

      const piece = state.board[sq];
      if (piece !== null && piece.color === state.turn) {
        selectFrom(sq, moves);
        return;
      }

      if (selectedFrom !== null && targets.includes(sq)) {
        // The legal list holds one move per from/to pair, except a promotion,
        // which carries four Q/R/B/N variants — hold those for the picker.
        const matches = moves.filter(
          (m) => m.from === selectedFrom && m.to === sq,
        );
        if (matches.some((m) => (m.flags & MoveFlags.PROMOTION) !== 0)) {
          holdPromotion(selectedFrom, sq);
          return;
        }
        const move = matches.find((m) => m.promotion === undefined);
        if (move !== undefined) {
          makeMove(state, move);
        }
        clearSelection();
        return;
      }

      // Empty square, enemy piece, or a non-target: clear, never move.
      clearSelection();
    },
  };
}

/** Status-line label for a side, e.g. "White to move". */
export function turnLabel(turn: Color): string {
  return `${turn === 'white' ? 'White' : 'Black'} to move`;
}
