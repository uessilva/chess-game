import { describe, expect, it } from 'vitest';

import {
  fileOf,
  parseFen,
  PIECES,
  rankOf,
  squareFromAlgebraic,
  toFen,
} from '../core';
import type { BoardState, Square } from '../core';
import { pixelToSquare } from './boardGeometry';
import type { Point } from './boardGeometry';
import { createDragMachine } from './drag';
import type { DragMachine } from './drag';

const sq = squareFromAlgebraic;

/** Canvas-pixel center of a square under the default 'white' orientation. */
function center(algebraic: string): Point {
  const s = sq(algebraic);
  return { x: fileOf(s) * 64 + 32, y: (7 - rankOf(s)) * 64 + 32 };
}

function createMachine(fen: string): {
  machine: DragMachine;
  state: BoardState;
} {
  const state = parseFen(fen);
  const machine = createDragMachine({
    state,
    hitTest: (x: number, y: number): Square | null =>
      pixelToSquare(x, y, 64, 'white'),
  });
  return { machine, state };
}

/** Knight on g1, bare kings. */
const KNIGHT_G1 = '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1';

describe('createDragMachine: lift', () => {
  it('arms a drag when pointerdown hits a piece of the side to move', () => {
    const { machine } = createMachine(KNIGHT_G1);

    expect(machine.pointerDown(center('g1').x, center('g1').y)).toBe(true);
    expect(machine.drag).not.toBeNull();
    expect(machine.drag?.from).toBe(sq('g1'));
    expect(machine.drag?.piece).toBe(PIECES.white.knight);
    expect(machine.drag?.dragging).toBe(false);
  });

  it('does not lift on an empty square; the gesture falls through to a click', () => {
    const { machine } = createMachine(KNIGHT_G1);

    expect(machine.pointerDown(center('e5').x, center('e5').y)).toBe(true);
    expect(machine.drag).toBeNull();
    expect(machine.pointerUp(center('e5').x, center('e5').y)).toEqual({
      kind: 'click',
      square: sq('e5'),
    });
  });

  it('does not lift on an opponent piece; the gesture falls through to a click', () => {
    // Black knight on f3.
    const { machine } = createMachine('4k3/8/8/8/8/5n2/8/4K3 w - - 0 1');

    expect(machine.pointerDown(center('f3').x, center('f3').y)).toBe(true);
    expect(machine.drag).toBeNull();
    expect(machine.pointerUp(center('f3').x, center('f3').y)).toEqual({
      kind: 'click',
      square: sq('f3'),
    });
  });

  it('does not lift on a piece of the side not to move', () => {
    // Black to move with a White pawn on e4.
    const { machine } = createMachine('4k3/8/8/8/4P3/8/8/4K3 b - - 0 1');

    expect(machine.pointerDown(center('e4').x, center('e4').y)).toBe(true);
    expect(machine.drag).toBeNull();
  });

  it('starts nothing for an off-board press and resolves nothing on release', () => {
    const { machine } = createMachine(KNIGHT_G1);

    expect(machine.pointerDown(-10, 100)).toBe(false);
    expect(machine.drag).toBeNull();
    expect(machine.pointerUp(-10, 100)).toBeNull();
  });

  it('ignores additional pointers while a gesture is active', () => {
    const { machine } = createMachine(KNIGHT_G1);

    expect(machine.pointerDown(center('g1').x, center('g1').y)).toBe(true);
    expect(machine.pointerDown(center('e2').x, center('e2').y)).toBe(false);
    expect(machine.drag?.from).toBe(sq('g1'));
  });
});

describe('createDragMachine: click vs drag threshold', () => {
  it('stays armed (not lifted) until the pointer crosses the threshold', () => {
    const { machine } = createMachine(KNIGHT_G1);
    const start = center('g1');

    machine.pointerDown(start.x, start.y);
    expect(machine.drag?.dragging).toBe(false);

    machine.pointerMove(start.x + 2, start.y);
    expect(machine.drag?.dragging).toBe(false);

    machine.pointerMove(start.x + 5, start.y);
    expect(machine.drag?.dragging).toBe(true);
    expect(machine.drag?.position).toEqual({ x: start.x + 5, y: start.y });
  });

  it('resolves an armed gesture released within the threshold as a click, no move', () => {
    const { machine, state } = createMachine(KNIGHT_G1);
    const before = toFen(state);

    machine.pointerDown(center('g1').x, center('g1').y);
    const release = { x: center('g1').x + 2, y: center('g1').y };
    machine.pointerMove(release.x, release.y);

    expect(machine.pointerUp(release.x, release.y)).toEqual({
      kind: 'click',
      square: sq('g1'),
    });
    expect(machine.drag).toBeNull();
    expect(toFen(state)).toBe(before);
  });

  it('a plain press that travels beyond the threshold resolves to nothing', () => {
    const { machine } = createMachine(KNIGHT_G1);

    machine.pointerDown(center('e5').x, center('e5').y);
    machine.pointerMove(center('g8').x, center('g8').y);

    expect(machine.pointerUp(center('g8').x, center('g8').y)).toBeNull();
  });

  it('a fast flick straight to pointerup is classified as a drag', () => {
    const { machine, state } = createMachine(KNIGHT_G1);

    machine.pointerDown(center('g1').x, center('g1').y);

    expect(machine.pointerUp(center('e2').x, center('e2').y)).toEqual({
      kind: 'drag-move',
    });
    expect(toFen(state)).toBe('4k3/8/8/8/8/8/4N3/4K3 b - - 1 1');
  });
});

describe('createDragMachine: drop resolution', () => {
  it('applies a move dropped on a legal destination and flips the turn', () => {
    const { machine, state } = createMachine(KNIGHT_G1);

    machine.pointerDown(center('g1').x, center('g1').y);
    machine.pointerMove(center('e2').x, center('e2').y);

    expect(machine.pointerUp(center('e2').x, center('e2').y)).toEqual({
      kind: 'drag-move',
    });
    expect(machine.drag).toBeNull();
    expect(state.board[sq('e2')]).toBe(PIECES.white.knight);
    expect(state.board[sq('g1')]).toBeNull();
    expect(state.turn).toBe('black');
    expect(toFen(state)).toBe('4k3/8/8/8/8/8/4N3/4K3 b - - 1 1');
  });

  it('reverts on an illegal destination: piece back, turn unchanged', () => {
    // Black pawn on e5 — a knight on g1 can never land there legally.
    const { machine, state } = createMachine(
      '4k3/8/8/4p3/8/8/8/4K1N1 w - - 0 1',
    );
    const before = toFen(state);

    machine.pointerDown(center('g1').x, center('g1').y);
    machine.pointerMove(center('e5').x, center('e5').y);

    expect(machine.pointerUp(center('e5').x, center('e5').y)).toEqual({
      kind: 'drag-revert',
    });
    expect(machine.drag).toBeNull();
    expect(state.board[sq('g1')]).toBe(PIECES.white.knight);
    expect(state.turn).toBe('white');
    expect(toFen(state)).toBe(before);
  });

  it('reverts on a release outside the board', () => {
    const { machine, state } = createMachine('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    const before = toFen(state);

    machine.pointerDown(center('e2').x, center('e2').y);
    machine.pointerMove(600, 416); // beyond the right canvas edge

    expect(machine.pointerUp(600, 416)).toEqual({ kind: 'drag-revert' });
    expect(state.board[sq('e2')]).toBe(PIECES.white.pawn);
    expect(state.turn).toBe('white');
    expect(toFen(state)).toBe(before);
  });

  it('reverts when dropped onto an own piece', () => {
    // White pawn on e2 blocks the knight's g1-e2 landing square.
    const { machine, state } = createMachine(
      '4k3/8/8/8/8/8/4P3/4K1N1 w - - 0 1',
    );
    const before = toFen(state);

    machine.pointerDown(center('g1').x, center('g1').y);
    machine.pointerMove(center('e2').x, center('e2').y);

    expect(machine.pointerUp(center('e2').x, center('e2').y)).toEqual({
      kind: 'drag-revert',
    });
    expect(state.board[sq('e2')]).toBe(PIECES.white.pawn);
    expect(state.board[sq('g1')]).toBe(PIECES.white.knight);
    expect(toFen(state)).toBe(before);
  });

  it('resolves a last-rank drop as a promotion for the picker: no move applied', () => {
    const { machine, state } = createMachine('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const before = toFen(state);

    machine.pointerDown(center('a7').x, center('a7').y);
    machine.pointerMove(center('a8').x, center('a8').y);

    expect(machine.pointerUp(center('a8').x, center('a8').y)).toEqual({
      kind: 'promotion',
      from: sq('a7'),
      to: sq('a8'),
    });
    // The pawn stays on its origin square and the turn never passes — the
    // caller holds the move in UI state and opens the picker (#13).
    expect(machine.drag).toBeNull();
    expect(state.board[sq('a8')]).toBeNull();
    expect(state.board[sq('a7')]).toBe(PIECES.white.pawn);
    expect(state.turn).toBe('white');
    expect(toFen(state)).toBe(before);
  });

  it('applies a castling move dropped on the king target square', () => {
    const { machine, state } = createMachine(
      'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
    );

    machine.pointerDown(center('e1').x, center('e1').y);
    machine.pointerMove(center('g1').x, center('g1').y);

    expect(machine.pointerUp(center('g1').x, center('g1').y)).toEqual({
      kind: 'drag-move',
    });
    expect(state.board[sq('g1')]).toBe(PIECES.white.king);
    expect(state.board[sq('f1')]).toBe(PIECES.white.rook);
    expect(state.board[sq('h1')]).toBeNull();
    expect(state.turn).toBe('black');
  });
});

describe('createDragMachine: cancel', () => {
  it('aborts an in-progress drag, reverts the piece, and reports the abort', () => {
    const { machine, state } = createMachine(KNIGHT_G1);
    const before = toFen(state);

    machine.pointerDown(center('g1').x, center('g1').y);
    machine.pointerMove(center('e2').x, center('e2').y);

    expect(machine.pointerCancel()).toBe(true);
    expect(machine.drag).toBeNull();
    expect(state.board[sq('g1')]).toBe(PIECES.white.knight);
    expect(state.turn).toBe('white');
    expect(toFen(state)).toBe(before);
  });

  it('reports false when no gesture is active', () => {
    const { machine } = createMachine(KNIGHT_G1);

    expect(machine.pointerCancel()).toBe(false);
  });
});

describe('createDragMachine: hit-test orientation', () => {
  it('lifts the h1 rook when the hit test uses the black orientation', () => {
    const state = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const machine = createDragMachine({
      state,
      hitTest: (x: number, y: number): Square | null =>
        pixelToSquare(x, y, 64, 'black'),
    });

    // In the black orientation h1 renders at canvas (0, 0), so its center is
    // (32, 32) — a press there must lift the h1 rook, not the a1 rook.
    expect(machine.pointerDown(32, 32)).toBe(true);
    expect(machine.drag?.from).toBe(sq('h1'));
    expect(machine.drag?.piece).toBe(PIECES.white.rook);
  });
});
