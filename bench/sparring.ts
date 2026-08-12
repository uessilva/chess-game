/**
 * Sparring harness (task 3.7, #22 — optional part, owner-approved): our
 * engine plays a short match against Stockfish WASM at a limited
 * strength (fixed shallow depth) from the start position, alternating
 * colors, and the result — wins/draws/losses, score percentage, a rough
 * Elo estimate, and sample move lists — is printed for the PR.
 *
 * Move selection: our engine runs the same fixed-depth search the bench
 * measures (`search` with a transposition table, no quiescence — the
 * worker's configuration), one table shared across the game's moves the
 * way the worker shares its table across requests. Stockfish is driven
 * over UCI at `sfDepth`. Both sides are deterministic, so the whole
 * match is reproducible run-to-run.
 *
 * Game termination uses core's rules: checkmate/stalemate (no legal
 * moves + in-check), fifty-move, threefold repetition, and insufficient
 * material are all auto-drawn — the harness never plays a move out of a
 * dead position. A 300-ply game that somehow survives every rule is a
 * harness bug and fails loudly rather than polluting the stats.
 */
import {
  generateLegalMoves,
  isFiftyMoveDraw,
  isInCheck,
  isInsufficientMaterial,
  isThreefoldRepetition,
  makeMove,
  parseFen,
  START_FEN,
} from '../src/core';
import type { BoardState } from '../src/core/state';
import type { Color } from '../src/core/types';
import { opposite } from '../src/core/types';
import { search } from '../src/engine/search';
import { TranspositionTable } from '../src/engine/transpositionTable';
import { StockfishClient } from './stockfish';
import { moveToUci, uciToMove } from './uci';

export const DEFAULT_GAMES = 20;
export const DEFAULT_OUR_DEPTH = 4;
export const DEFAULT_SF_DEPTH = 3;
/** Stockfish UCI Skill Level: 20 = full strength, lower = weaker. */
export const DEFAULT_SF_SKILL = 1;
export const SAMPLE_GAMES = 3;
export const MAX_PLY = 300;

export type GameOutcome = 'win' | 'draw' | 'loss';
export type GameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'fifty-move'
  | 'threefold'
  | 'insufficient-material';

/** One completed game from our engine's perspective. */
export interface GameResult {
  readonly gameNumber: number;
  /** Our engine's color in this game (colors alternate). */
  readonly ourColor: Color;
  /** The full move list in UCI long algebraic. */
  readonly moves: readonly string[];
  readonly outcome: GameOutcome;
  readonly reason: GameEndReason;
  readonly ply: number;
  readonly ourDepth: number;
  readonly sfDepth: number;
}

/** Aggregate match statistics. */
export interface MatchResult {
  readonly games: readonly GameResult[];
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  /** `(wins + 0.5 * draws) / games * 100`. */
  readonly scorePercent: number;
  /**
   * Rough Elo of our engine relative to Stockfish from the match score:
   * `400 * log10(S / (1 - S))`, clamped to ±800 for a perfect score
   * (where the log diverges). A negative number means Stockfish is
   * stronger — the expected direction at these depths.
   */
  readonly eloEstimate: number;
  readonly ourDepth: number;
  readonly sfDepth: number;
  /** Stockfish UCI Skill Level used (20 = full strength). */
  readonly sfSkill: number;
}

/** The game-ending state check, run after every move. */
function terminalStatus(state: BoardState): {
  over: boolean;
  outcome: GameOutcome;
  reason: GameEndReason;
} {
  if (generateLegalMoves(state).length === 0) {
    if (isInCheck(state, state.turn)) {
      return {
        over: true,
        outcome: opposite(state.turn) === 'white' ? 'win' : 'loss',
        reason: 'checkmate',
      };
    }
    return { over: true, outcome: 'draw', reason: 'stalemate' };
  }
  if (isFiftyMoveDraw(state)) {
    return { over: true, outcome: 'draw', reason: 'fifty-move' };
  }
  if (isThreefoldRepetition(state)) {
    return { over: true, outcome: 'draw', reason: 'threefold' };
  }
  if (isInsufficientMaterial(state)) {
    return { over: true, outcome: 'draw', reason: 'insufficient-material' };
  }
  return { over: false, outcome: 'draw', reason: 'checkmate' };
}

/** The game-end result mapped to our engine's perspective. */
function outcomeFor(
  terminal: ReturnType<typeof terminalStatus>,
  ourColor: Color,
): { outcome: GameOutcome; reason: GameEndReason } {
  if (terminal.reason !== 'checkmate' || terminal.outcome === 'draw') {
    return { outcome: 'draw', reason: terminal.reason };
  }
  // terminal.outcome is already "white wins"/"black wins".
  const winner: Color = terminal.outcome === 'win' ? 'white' : 'black';
  return {
    outcome: winner === ourColor ? 'win' : 'loss',
    reason: 'checkmate',
  };
}

/** Play one game from the start position; colors alternate per game. */
export async function playGame(
  stockfish: StockfishClient,
  gameNumber: number,
  ourDepth: number,
  sfDepth: number,
): Promise<GameResult> {
  const ourColor: Color = gameNumber % 2 === 0 ? 'white' : 'black';
  const state = parseFen(START_FEN);
  const tt = new TranspositionTable();
  const moves: string[] = [];

  stockfish.send('ucinewgame');

  for (let ply = 0; ply < MAX_PLY; ply++) {
    const terminal = terminalStatus(state);
    if (terminal.over) {
      const { outcome, reason } = outcomeFor(terminal, ourColor);
      return {
        gameNumber,
        ourColor,
        moves,
        outcome,
        reason,
        ply,
        ourDepth,
        sfDepth,
      };
    }

    if (state.turn === ourColor) {
      const result = search(state, ourDepth, undefined, { tt });
      if (result.move === null) {
        // Defensive: the terminal check above should have caught this.
        return {
          gameNumber,
          ourColor,
          moves,
          outcome: 'draw',
          reason: 'stalemate',
          ply,
          ourDepth,
          sfDepth,
        };
      }
      const uci = moveToUci(result.move);
      makeMove(state, result.move);
      moves.push(uci);
    } else {
      const uci = await stockfish.bestMove(START_FEN, moves, sfDepth);
      if (uci === null) {
        throw new Error(
          `sparring: Stockfish returned no move on game ${gameNumber} ply ${ply} ` +
            `(position ${moves.join(' ')})`,
        );
      }
      const move = uciToMove(state, uci);
      if (move === null) {
        throw new Error(
          `sparring: Stockfish's move "${uci}" is not legal in ` +
            `game ${gameNumber} ply ${ply} (position ${moves.join(' ')})`,
        );
      }
      makeMove(state, move);
      moves.push(uci);
    }
  }

  throw new Error(
    `sparring: game ${gameNumber} exceeded ${MAX_PLY} plies without a draw ` +
      `rule or mate — a harness bug, the game was not counted`,
  );
}

/**
 * Play a full match: `gameCount` games from the start position, our
 * engine alternating white/black, both sides at fixed shallow depth,
 * Stockfish further handicapped with `sfSkill` (UCI Skill Level; 20 =
 * full strength).
 */
export async function playMatch(
  stockfish: StockfishClient,
  gameCount: number = DEFAULT_GAMES,
  ourDepth: number = DEFAULT_OUR_DEPTH,
  sfDepth: number = DEFAULT_SF_DEPTH,
  sfSkill: number = DEFAULT_SF_SKILL,
): Promise<MatchResult> {
  stockfish.setSkillLevel(sfSkill);
  const games: GameResult[] = [];
  for (let game = 1; game <= gameCount; game++) {
    games.push(await playGame(stockfish, game, ourDepth, sfDepth));
  }
  const wins = games.filter((g) => g.outcome === 'win').length;
  const draws = games.filter((g) => g.outcome === 'draw').length;
  const losses = games.filter((g) => g.outcome === 'loss').length;
  const scoreRatio = (wins + 0.5 * draws) / games.length;
  const scorePercent = scoreRatio * 100;
  const eloEstimate = estimateElo(scoreRatio);
  return {
    games,
    wins,
    draws,
    losses,
    scorePercent,
    eloEstimate,
    ourDepth,
    sfDepth,
    sfSkill,
  };
}

/**
 * Simple Elo estimate from a score ratio (0..1): the rating difference
 * implied by the match score via the logistic curve. A perfect score has
 * no finite estimate, so it is clamped to the documented ±800 band.
 */
export function estimateElo(scoreRatio: number): number {
  if (scoreRatio <= 0) {
    return -800;
  }
  if (scoreRatio >= 1) {
    return 800;
  }
  return Math.round(400 * Math.log10(scoreRatio / (1 - scoreRatio)));
}

/** Format one game's move list as numbered white/black pairs. */
export function formatGame(game: GameResult): string {
  const parts: string[] = [];
  for (let i = 0; i < game.moves.length; i += 2) {
    const white = game.moves[i] ?? '';
    const black = game.moves[i + 1] ?? '';
    parts.push(`${Math.floor(i / 2) + 1}. ${white} ${black}`.trim());
  }
  return parts.join('  ');
}

/** The full printable match report (summary + sample games). */
export function formatMatchReport(result: MatchResult): string {
  const lines: string[] = [];
  const header =
    `Sparring match: our engine (fixed depth ${result.ourDepth}) vs ` +
    `Stockfish WASM (fixed depth ${result.sfDepth}, Skill Level ${result.sfSkill})`;
  lines.push('='.repeat(header.length));
  lines.push(header);
  lines.push('='.repeat(header.length));
  lines.push(
    `Games: ${result.games.length} from the start position, ` +
      `alternating colors (our engine played White in ` +
      `${result.games.filter((g) => g.ourColor === 'white').length}, Black in ` +
      `${result.games.filter((g) => g.ourColor === 'black').length})`,
  );
  lines.push(
    `Result: ${result.wins} win(s) / ${result.draws} draw(s) / ${result.losses} loss(es)`,
  );
  lines.push(`Score: ${result.scorePercent.toFixed(1)}%`);
  lines.push(
    `Rough Elo estimate: ${result.eloEstimate >= 0 ? '+' : ''}${result.eloEstimate} ` +
      `(our engine relative to Stockfish; simple Elo formula on the score)`,
  );
  lines.push('');
  const sample = result.games.slice(0, SAMPLE_GAMES);
  for (const game of sample) {
    lines.push(
      `Game ${game.gameNumber} (our ${game.ourColor}): ${formatGame(game)}  ` +
        `[${game.outcome} — ${game.reason}]`,
    );
  }
  return lines.join('\n');
}
