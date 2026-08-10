import { describe, expect, it } from 'vitest';

import {
  algebraicOf,
  parseFen,
  PIECES,
  START_FEN,
  squareFromAlgebraic,
  toFen,
} from '../core';
import type { Square } from '../core';
import { createController, turnLabel } from './controller';
import type { Selection } from './controller';

const sq = squareFromAlgebraic;

/** Target squares in algebraic order, so assertions never depend on movegen order. */
function targets(selection: Selection | null): Square[] {
  if (selection === null) {
    return [];
  }
  return [...selection.targets].sort((a, b) =>
    algebraicOf(a) < algebraicOf(b) ? -1 : 1,
  );
}

describe('createController: selection', () => {
  it('selects a piece of the side to move and shows exactly its legal targets', () => {
    const controller = createController(parseFen(START_FEN));

    controller.handleSquareClick(sq('b1'));

    expect(controller.selection?.from).toBe(sq('b1'));
    expect(targets(controller.selection)).toEqual([sq('a3'), sq('c3')]);
  });

  it('shows no dot on a square the piece cannot reach (b2, the pawn square)', () => {
    const controller = createController(parseFen(START_FEN));
    controller.handleSquareClick(sq('b1'));

    expect(targets(controller.selection)).not.toContain(sq('b2'));
  });

  it('re-selects when a different piece of the side to move is clicked', () => {
    const controller = createController(parseFen(START_FEN));
    controller.handleSquareClick(sq('e2'));
    expect(targets(controller.selection)).toEqual([sq('e3'), sq('e4')]);

    controller.handleSquareClick(sq('g1'));
    expect(controller.selection?.from).toBe(sq('g1'));
    expect(targets(controller.selection)).toEqual([sq('f3'), sq('h3')]);
  });

  it('never selects a piece of the side not to move', () => {
    const controller = createController(parseFen(START_FEN));

    controller.handleSquareClick(sq('b8'));

    expect(controller.selection).toBeNull();
  });
});

describe('createController: executing moves', () => {
  it('moves a pawn to a dotted target, clears the selection, and flips the turn', () => {
    const controller = createController(parseFen(START_FEN));

    controller.handleSquareClick(sq('e2'));
    controller.handleSquareClick(sq('e4'));

    expect(controller.selection).toBeNull();
    expect(controller.state.board[sq('e4')]).toBe(PIECES.white.pawn);
    expect(controller.state.board[sq('e2')]).toBeNull();
    expect(controller.state.turn).toBe('black');
    expect(toFen(controller.state)).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
  });

  it('clears the selection on an empty square without executing a move', () => {
    const controller = createController(parseFen(START_FEN));
    const before = toFen(controller.state);

    controller.handleSquareClick(sq('e2'));
    expect(controller.selection).not.toBeNull();
    controller.handleSquareClick(sq('e5'));

    expect(controller.selection).toBeNull();
    expect(toFen(controller.state)).toBe(before);
    expect(controller.state.turn).toBe('white');
  });

  it('does nothing when the wrong side clicks a pawn (frozen after the turn flips)', () => {
    const controller = createController(parseFen(START_FEN));
    controller.handleSquareClick(sq('e2'));
    controller.handleSquareClick(sq('e4'));
    // Black's turn: e7 selects, e4 (White) must not.
    controller.handleSquareClick(sq('e7'));
    expect(controller.selection?.from).toBe(sq('e7'));
    expect(targets(controller.selection)).toEqual([sq('e5'), sq('e6')]);

    controller.handleSquareClick(sq('e4'));

    expect(controller.selection).toBeNull();
    expect(controller.state.board[sq('e4')]).toBe(PIECES.white.pawn);
    expect(controller.state.turn).toBe('black');
  });

  it('captures with a pawn: the captured piece is removed and the turn flips', () => {
    const controller = createController(
      parseFen('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1'),
    );

    controller.handleSquareClick(sq('e4'));
    expect(targets(controller.selection)).toEqual([sq('d5'), sq('e5')]);

    controller.handleSquareClick(sq('d5'));

    expect(controller.state.board[sq('d5')]).toBe(PIECES.white.pawn);
    expect(controller.state.turn).toBe('black');
  });

  it('only offers moves that resolve a check', () => {
    // Black rook e8 checking the White king e1; the black king sits on g8
    // so parseFen's one-king-per-side rule is satisfied (the issue's bare
    // `4r3/.../4K3` FEN omits the black king and cannot be parsed).
    const controller = createController(
      parseFen('4r1k1/8/8/8/8/8/8/4K3 w - - 0 1'),
    );

    controller.handleSquareClick(sq('e1'));

    expect(targets(controller.selection)).toEqual([
      sq('d1'),
      sq('d2'),
      sq('f1'),
      sq('f2'),
    ]);
    controller.handleSquareClick(sq('f1'));

    expect(controller.state.board[sq('f1')]).toBe(PIECES.white.king);
    expect(controller.state.board[sq('e8')]).toBe(PIECES.black.rook);
    expect(controller.state.turn).toBe('black');
  });

  it('castles kingside as a single move: king to g1 and rook to f1', () => {
    const controller = createController(
      parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'),
    );

    controller.handleSquareClick(sq('e1'));
    expect(targets(controller.selection)).toContain(sq('g1'));

    controller.handleSquareClick(sq('g1'));

    expect(controller.state.board[sq('g1')]).toBe(PIECES.white.king);
    expect(controller.state.board[sq('f1')]).toBe(PIECES.white.rook);
    expect(controller.state.board[sq('h1')]).toBeNull();
    expect(controller.state.turn).toBe('black');
  });

  it('holds a promotion pending instead of executing when the back-rank target is clicked', () => {
    // Pawn on a7 (second FEN field is rank 7); the issue's `4k3/8/P7/...`
    // FEN puts the pawn on a6 and never reaches the last rank.
    const controller = createController(
      parseFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'),
    );

    controller.handleSquareClick(sq('a7'));
    // The four Q/R/B/N variants collapse into one dot on a8.
    expect(targets(controller.selection)).toEqual([sq('a8')]);

    controller.handleSquareClick(sq('a8'));

    // Supersedes #11's default-queen: the move is held, never applied.
    expect(controller.pendingPromotion).toEqual({
      from: sq('a7'),
      to: sq('a8'),
      color: 'white',
    });
    expect(controller.state.board[sq('a8')]).toBeNull();
    expect(controller.state.board[sq('a7')]).toBe(PIECES.white.pawn);
    expect(controller.state.turn).toBe('white');
  });
});

describe('createController: promotion picker', () => {
  it('applies exactly the chosen promotion piece via makeMove', () => {
    const controller = createController(
      parseFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'),
    );
    controller.handleSquareClick(sq('a7'));
    controller.handleSquareClick(sq('a8'));

    controller.choosePromotion('knight');

    expect(controller.state.board[sq('a8')]).toBe(PIECES.white.knight);
    expect(controller.state.board[sq('a7')]).toBeNull();
    expect(controller.state.turn).toBe('black');
    expect(controller.pendingPromotion).toBeNull();
    expect(controller.selection).toBeNull();
  });

  it('supports holding a promotion from a drag drop (holdPromotion)', () => {
    const controller = createController(
      parseFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'),
    );

    controller.holdPromotion(sq('a7'), sq('a8'));

    expect(controller.pendingPromotion).toEqual({
      from: sq('a7'),
      to: sq('a8'),
      color: 'white',
    });
    expect(controller.state.board[sq('a7')]).toBe(PIECES.white.pawn);
    expect(controller.state.turn).toBe('white');

    controller.choosePromotion('rook');
    expect(controller.state.board[sq('a8')]).toBe(PIECES.white.rook);
    expect(controller.state.turn).toBe('black');
  });

  it('ignores holdPromotion for a pair with no legal promotion variants', () => {
    const controller = createController(parseFen(START_FEN));

    controller.holdPromotion(sq('e2'), sq('e4'));

    expect(controller.pendingPromotion).toBeNull();
  });

  it('cancels the pending promotion without applying a move and play resumes', () => {
    const controller = createController(
      parseFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'),
    );
    const before = toFen(controller.state);

    controller.handleSquareClick(sq('a7'));
    controller.handleSquareClick(sq('a8'));
    controller.cancelPromotion();

    expect(controller.pendingPromotion).toBeNull();
    expect(controller.selection).toBeNull();
    expect(controller.state.board[sq('a7')]).toBe(PIECES.white.pawn);
    expect(controller.state.turn).toBe('white');
    expect(toFen(controller.state)).toBe(before);

    // Play continues: the pawn can be re-selected and promoted later.
    controller.handleSquareClick(sq('a7'));
    expect(controller.selection?.from).toBe(sq('a7'));
    expect(targets(controller.selection)).toEqual([sq('a8')]);
  });

  it('freezes board clicks while the picker is open', () => {
    const controller = createController(
      parseFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'),
    );
    const before = toFen(controller.state);
    controller.handleSquareClick(sq('a7'));
    controller.handleSquareClick(sq('a8'));
    expect(controller.pendingPromotion).not.toBeNull();

    // Own piece, empty square: nothing moves and selection never changes.
    controller.handleSquareClick(sq('a7'));
    controller.handleSquareClick(sq('e5'));
    controller.handleSquareClick(sq('e1'));

    expect(controller.selection).toBeNull();
    expect(controller.pendingPromotion).not.toBeNull();
    expect(toFen(controller.state)).toBe(before);
  });

  it('is a no-op when choosing a piece with no pending promotion', () => {
    const controller = createController(
      parseFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'),
    );
    const before = toFen(controller.state);

    controller.choosePromotion('queen');

    expect(toFen(controller.state)).toBe(before);
    expect(controller.state.turn).toBe('white');
  });
});

describe('createController: game-over freeze', () => {
  it('selects nothing in a game ended by the fifty-move rule', () => {
    const controller = createController(
      parseFen('4k3/8/8/8/8/8/8/4K3 b - - 100 75'),
    );
    const before = toFen(controller.state);

    controller.handleSquareClick(sq('e8'));
    controller.handleSquareClick(sq('e7'));

    expect(controller.selection).toBeNull();
    expect(toFen(controller.state)).toBe(before);
    expect(controller.state.turn).toBe('black');
  });

  it('selects nothing in a game ended by insufficient material', () => {
    const controller = createController(
      parseFen('4k3/8/8/8/8/8/8/4K3 b - - 0 1'),
    );
    const before = toFen(controller.state);

    controller.handleSquareClick(sq('e8'));

    expect(controller.selection).toBeNull();
    expect(toFen(controller.state)).toBe(before);
  });
});

describe('createController: reset (New game)', () => {
  it('resets the shared state object to the starting position and clears UI state', () => {
    const state = parseFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const controller = createController(state);
    controller.handleSquareClick(sq('a7'));
    controller.handleSquareClick(sq('a8'));
    expect(controller.pendingPromotion).not.toBeNull();

    controller.reset();

    expect(controller.state).toBe(state); // same object the drag machine holds
    expect(controller.pendingPromotion).toBeNull();
    expect(controller.selection).toBeNull();
    expect(controller.state.turn).toBe('white');
    expect(toFen(controller.state)).toBe(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    );
  });

  it('resets a mid-game position and lets play continue from the start', () => {
    const controller = createController(parseFen(START_FEN));
    controller.handleSquareClick(sq('e2'));
    controller.handleSquareClick(sq('e4'));
    expect(controller.state.turn).toBe('black');

    controller.reset();

    expect(controller.state.turn).toBe('white');
    controller.handleSquareClick(sq('e2'));
    expect(targets(controller.selection)).toEqual([sq('e3'), sq('e4')]);
  });
});

describe('createController: clearSelection', () => {
  it('drops the selection without touching core state', () => {
    const controller = createController(parseFen(START_FEN));
    controller.handleSquareClick(sq('e2'));
    expect(controller.selection).not.toBeNull();
    const before = toFen(controller.state);

    controller.clearSelection();

    expect(controller.selection).toBeNull();
    expect(toFen(controller.state)).toBe(before);
  });

  it('is a no-op when nothing is selected', () => {
    const controller = createController(parseFen(START_FEN));
    const before = toFen(controller.state);

    controller.clearSelection();

    expect(controller.selection).toBeNull();
    expect(toFen(controller.state)).toBe(before);
  });
});

describe('createController: frozen positions', () => {
  it('selects nothing in a checkmated position', () => {
    const controller = createController(
      parseFen('4R1k1/5ppp/8/8/8/8/8/6K1 b - - 0 1'),
    );
    const before = toFen(controller.state);

    controller.handleSquareClick(sq('g8'));
    expect(controller.selection).toBeNull();
    controller.handleSquareClick(sq('f7'));
    expect(controller.selection).toBeNull();

    expect(toFen(controller.state)).toBe(before);
  });

  it('selects nothing in a stalemated position', () => {
    const controller = createController(
      parseFen('k7/8/1Q6/8/8/8/8/K7 b - - 0 1'),
    );
    const before = toFen(controller.state);

    controller.handleSquareClick(sq('a8'));

    expect(controller.selection).toBeNull();
    expect(toFen(controller.state)).toBe(before);
  });
});

describe('turnLabel', () => {
  it('describes whose turn it is', () => {
    expect(turnLabel('white')).toBe('White to move');
    expect(turnLabel('black')).toBe('Black to move');
  });
});
