import { describe, expect, it, vi } from 'vitest';

import { generateLegalMoves, initialState, makeMove, parseFen } from '../core';
import type { BoardState, Move, PieceType } from '../core';
import { MoveFlags, PIECES } from '../core';
import { squareFromAlgebraic } from '../core';
import { createMoveAnimator } from './moveAnimator';
import type { MoveAnimator } from './moveAnimator';

/** A stub sound player recording which sounds fired. */
function createStubSound() {
  const move = vi.fn();
  const capture = vi.fn();
  return { move, capture };
}

interface Harness {
  readonly state: BoardState;
  readonly animator: MoveAnimator;
  readonly sound: ReturnType<typeof createStubSound>;
}

/** A committed game: parse a FEN, apply the from/to move through core, then hand it to the animator. */
function setup(fen: string): Harness {
  const state = parseFen(fen);
  const sound = createStubSound();
  const animator = createMoveAnimator({ state, sound });
  return { state, animator, sound };
}

/**
 * Apply the legal move from/to (with `promotion` when the move promotes)
 * through core's makeMove, then commit it to the animator the way main.ts
 * does after a click commit.
 */
function play(
  h: Harness,
  from: string,
  to: string,
  options: { snap?: boolean; promotion?: PieceType } = {},
): Move {
  const fromSq = squareFromAlgebraic(from);
  const toSq = squareFromAlgebraic(to);
  const move = generateLegalMoves(h.state).find(
    (m) =>
      m.from === fromSq &&
      m.to === toSq &&
      (options.promotion === undefined
        ? m.promotion === undefined
        : m.promotion === options.promotion),
  );
  if (move === undefined) {
    throw new Error(`no legal move ${from}-${to}`);
  }
  makeMove(h.state, move);
  h.animator.commitMove(move, options.snap ?? false);
  return move;
}

describe('createMoveAnimator: plain move', () => {
  it('starts one flight for the mover and locks input while it runs', () => {
    const h = setup('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    play(h, 'e2', 'e4');

    expect(h.animator.isAnimating).toBe(true);
    expect(h.animator.flights).toHaveLength(1);
    const flight = h.animator.flights[0];
    expect(flight.piece).toBe(PIECES.white.pawn);
    expect(flight.from).toBe(squareFromAlgebraic('e2'));
    expect(flight.to).toBe(squareFromAlgebraic('e4'));
    // t=0: still at the origin square's pixel.
    expect(flight.position).toEqual({ x: 256, y: 384 });
  });

  it('advances the glide by delta time and clears it once complete', () => {
    const h = setup('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    play(h, 'e2', 'e4');

    h.animator.update(0);
    expect(h.animator.flights[0].position).toEqual({ x: 256, y: 384 });

    // t=125 of 250: eased midpoint — e2 top-left (256,384) to e4 (256,256).
    h.animator.update(125);
    expect(h.animator.flights[0].position).toEqual({ x: 256, y: 320 });

    h.animator.update(125);
    expect(h.animator.isAnimating).toBe(false);
    expect(h.animator.flights).toHaveLength(0);
  });

  it('keeps the last-move highlight until the next commit', () => {
    const h = setup('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    play(h, 'e2', 'e4');
    expect(h.animator.lastMove).toEqual({
      from: squareFromAlgebraic('e2'),
      to: squareFromAlgebraic('e4'),
    });

    h.animator.update(250); // animation done, highlight persists
    expect(h.animator.lastMove).toEqual({
      from: squareFromAlgebraic('e2'),
      to: squareFromAlgebraic('e4'),
    });

    play(h, 'd7', 'd5');
    expect(h.animator.lastMove).toEqual({
      from: squareFromAlgebraic('d7'),
      to: squareFromAlgebraic('d5'),
    });
  });
});

describe('createMoveAnimator: castling', () => {
  it('tweens king and rook in one flight, arriving simultaneously at g1/f1', () => {
    const h = setup('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
    play(h, 'e1', 'g1');

    expect(h.animator.flights).toHaveLength(2);
    const king = h.animator.flights.find((f) => f.piece === PIECES.white.king);
    const rook = h.animator.flights.find((f) => f.piece === PIECES.white.rook);
    expect(king?.from).toBe(squareFromAlgebraic('e1'));
    expect(king?.to).toBe(squareFromAlgebraic('g1'));
    expect(rook?.from).toBe(squareFromAlgebraic('h1'));
    expect(rook?.to).toBe(squareFromAlgebraic('f1'));

    // Midpoint: king halfway e1→g1, rook halfway h1→f1.
    h.animator.update(125);
    expect(h.animator.flights[0].position).toEqual({ x: 320, y: 448 });
    expect(h.animator.flights[1].position).toEqual({ x: 384, y: 448 });

    // Both land on the same update — no stragglers.
    h.animator.update(125);
    expect(h.animator.isAnimating).toBe(false);
  });

  it('tweens queenside castle to c1/d1', () => {
    const h = setup('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1');
    play(h, 'e1', 'c1');

    const king = h.animator.flights.find((f) => f.piece === PIECES.white.king);
    const rook = h.animator.flights.find((f) => f.piece === PIECES.white.rook);
    expect(king?.to).toBe(squareFromAlgebraic('c1'));
    expect(rook?.from).toBe(squareFromAlgebraic('a1'));
    expect(rook?.to).toBe(squareFromAlgebraic('d1'));
  });
});

describe('createMoveAnimator: en passant', () => {
  it('glides only the capturing pawn; the captured pawn is already gone from its own square', () => {
    const h = setup('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1');
    play(h, 'd7', 'd5'); // double push (Black)
    h.animator.update(250);

    play(h, 'e5', 'd6'); // exd6 e.p. (White)

    expect(h.animator.flights).toHaveLength(1);
    expect(h.animator.flights[0].piece).toBe(PIECES.white.pawn);
    expect(h.animator.flights[0].from).toBe(squareFromAlgebraic('e5'));
    expect(h.animator.flights[0].to).toBe(squareFromAlgebraic('d6'));
    // Core removed the black pawn from d5 — its own square, not d6 — at commit.
    expect(h.state.board[squareFromAlgebraic('d5')]).toBeNull();
    expect(h.state.board[squareFromAlgebraic('d6')]).toBe(PIECES.white.pawn);
  });
});

describe('createMoveAnimator: promotion', () => {
  it('glides the pawn and lets the promoted piece appear when the flight clears', () => {
    const h = setup('3k4/4P3/8/8/8/8/8/4K3 w - - 0 1');
    play(h, 'e7', 'e8', { promotion: 'queen' });

    // During the glide the pawn sprite is the mover.
    expect(h.animator.flights).toHaveLength(1);
    expect(h.animator.flights[0].piece).toBe(PIECES.white.pawn);

    h.animator.update(250);
    expect(h.animator.isAnimating).toBe(false);
    // Core committed the promotion at commit time; the sprite swap is the
    // renderer drawing the promoted piece once the flight clears.
    expect(h.state.board[squareFromAlgebraic('e8')]).toBe(PIECES.white.queen);
  });
});

describe('createMoveAnimator: drag snap', () => {
  it('commits no tween for a snap (drag-dropped) move but keeps highlight and sound', () => {
    const h = setup('4k3/7p/8/8/8/8/8/4K1N1 w - - 0 1');
    play(h, 'g1', 'e2', { snap: true });

    expect(h.animator.isAnimating).toBe(false);
    expect(h.animator.flights).toHaveLength(0);
    expect(h.animator.lastMove).toEqual({
      from: squareFromAlgebraic('g1'),
      to: squareFromAlgebraic('e2'),
    });
    expect(h.sound.move).toHaveBeenCalledTimes(1);
  });
});

describe('createMoveAnimator: check glow', () => {
  it('glows the king of the side to move when core reports check', () => {
    const h = setup('4k3/8/8/8/8/8/8/5RK1 w - - 0 1');
    h.animator.update(0);
    expect(h.animator.checkSquare).toBeNull();

    // Rf1-e1+ delivers check along the e-file: Black's king e8 must glow.
    play(h, 'f1', 'e1');
    h.animator.update(0);
    expect(h.animator.checkSquare).toBe(squareFromAlgebraic('e8'));

    // Black evades e8-d8: the glow clears.
    play(h, 'e8', 'd8');
    h.animator.update(0);
    expect(h.animator.checkSquare).toBeNull();
  });

  it('shows the glow immediately when mounting into a check position', () => {
    const h = setup('4r1k1/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(h.animator.checkSquare).toBeNull(); // no update yet
    h.animator.update(0);
    expect(h.animator.checkSquare).toBe(squareFromAlgebraic('e1'));
  });
});

describe('createMoveAnimator: sounds', () => {
  it('plays the move sound on a non-capture commit only', () => {
    const h = setup('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    play(h, 'e2', 'e4');
    expect(h.sound.move).toHaveBeenCalledTimes(1);
    expect(h.sound.capture).not.toHaveBeenCalled();
  });

  it('plays the capture sound when the move carries the CAPTURE flag', () => {
    const h = setup('4k3/8/8/8/8/3p4/4P3/4K3 w - - 0 1');
    play(h, 'e2', 'd3');
    expect(h.sound.capture).toHaveBeenCalledTimes(1);
    expect(h.sound.move).not.toHaveBeenCalled();
  });

  it('plays the capture sound for an en passant capture', () => {
    const h = setup('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1');
    play(h, 'd7', 'd5'); // plain double push: move sound, then cleared
    h.animator.update(250);
    h.sound.move.mockClear();

    const ep = play(h, 'e5', 'd6');
    expect(ep.flags & MoveFlags.EN_PASSANT).not.toBe(0);
    expect(h.sound.capture).toHaveBeenCalledTimes(1);
    expect(h.sound.move).not.toHaveBeenCalled();
  });

  it('never plays sounds outside a commit (update/reset are silent)', () => {
    const h = setup('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    h.animator.update(16);
    h.animator.reset();
    expect(h.sound.move).not.toHaveBeenCalled();
    expect(h.sound.capture).not.toHaveBeenCalled();
  });
});

describe('createMoveAnimator: reset', () => {
  it('clears flights, the last-move highlight, and the check glow on New game', () => {
    const h = setup('4k3/8/8/8/8/8/8/5RK1 w - - 0 1');
    play(h, 'f1', 'e1');
    h.animator.update(0);
    expect(h.animator.isAnimating).toBe(true);
    expect(h.animator.lastMove).not.toBeNull();
    expect(h.animator.checkSquare).toBe(squareFromAlgebraic('e8'));

    // New game (main.ts): controller.reset() restores the start position
    // before animator.reset() clears the overlay state.
    const fresh = initialState();
    h.state.board = fresh.board;
    h.state.turn = fresh.turn;
    h.state.castling = fresh.castling;
    h.state.enPassant = fresh.enPassant;
    h.state.halfmoveClock = fresh.halfmoveClock;
    h.state.fullmoveNumber = fresh.fullmoveNumber;
    h.state.history = fresh.history;
    h.state.positionHashes = fresh.positionHashes;

    h.animator.reset();
    expect(h.animator.isAnimating).toBe(false);
    expect(h.animator.flights).toHaveLength(0);
    expect(h.animator.lastMove).toBeNull();
    // The start position is not in check for the side to move.
    expect(h.animator.checkSquare).toBeNull();
  });
});

describe('createMoveAnimator: geometry', () => {
  it('interpolates in the black orientation too', () => {
    const state = parseFen(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    );
    const sound = createStubSound();
    const animator = createMoveAnimator({ state, orientation: 'black', sound });
    const move = generateLegalMoves(state).find(
      (m) =>
        m.from === squareFromAlgebraic('e2') &&
        m.to === squareFromAlgebraic('e4'),
    );
    if (move === undefined) {
      throw new Error('e2-e4 not legal');
    }
    makeMove(state, move);
    animator.commitMove(move, false);

    // Black orientation: e2 is at (192, 64), e4 at (192, 192).
    animator.update(125);
    expect(animator.flights[0].position).toEqual({ x: 192, y: 128 });
  });
});
