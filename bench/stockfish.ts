/**
 * Stockfish WASM UCI client for the sparring harness (task 3.7, #22).
 *
 * Wraps the `stockfish.js` npm package (owner-approved for this task) as
 * a minimal UCI driver: `uci` handshake, `position`, `go depth N`, and a
 * promise that resolves with the `bestmove` line. Everything else
 * (`isready`, `ucinewgame`) is internal.
 *
 * Loading stockfish.js in Node needs two shims, both applied before the
 * module is required:
 *
 * 1. The 2019 Emscripten build locates its wasm with a relative URL and
 *    calls `fetch` (Node 18+ has a global fetch that rejects relative
 *    URLs). We intercept fetch for `.wasm` and serve the file bytes from
 *    disk with the `application/wasm` content type that
 *    `WebAssembly.instantiateStreaming` requires.
 * 2. The build reports engine output through a global `postMessage`
 *    (browser-worker style), which does not exist on the Node main
 *    thread. We install a shim that feeds the client's line buffer.
 *
 * Both shims are global and installed once per process — the harness
 * creates exactly one client. `module` is typed loosely: the emscripten
 * surface is generated code and not worth modeling precisely.
 *
 * The engine output is line-delimited (`uciok`, `readyok`, `info ...`,
 * `bestmove e2e4 ponder e7e5`). `send` pushes a command; `waitFor` is
 * registered BEFORE the command that will produce the line, so no reply
 * can slip between the send and the waiter.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

interface EmscriptenModule {
  ccall(
    name: 'uci_command',
    returnType: 'number',
    argTypes: ['string'],
    args: [string],
  ): number;
  onRuntimeInitialized: (() => void) | null;
}

/** One pending reply waiter. */
interface Waiter {
  readonly predicate: (line: string) => boolean;
  readonly resolve: (line: string) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_MOVE_TIMEOUT_MS = 120_000;

export class StockfishClient {
  private readonly module: EmscriptenModule;
  private readonly waiters: Waiter[] = [];

  /** Load the WASM engine (applies the fetch + postMessage shims). */
  constructor() {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('stockfish.js/stockfish.wasm');
    const realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      if (typeof input === 'string' && input.endsWith('.wasm')) {
        return Promise.resolve(
          new Response(readFileSync(wasmPath), {
            headers: { 'Content-Type': 'application/wasm' },
          }),
        );
      }
      return realFetch(input, init);
    };
    globalThis.postMessage = (line: unknown): void => {
      this.onLine(String(line));
    };
    this.module = require('stockfish.js') as EmscriptenModule;
  }

  /**
   * Perform the UCI handshake and set up a new game. Resolves once the
   * engine is ready for `position`/`go` commands.
   *
   * Every reply waiter is registered BEFORE the command that produces it:
   * the engine emits synchronously during the `ccall`, so a waiter
   * registered after `send` would miss the reply.
   */
  async init(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.module.onRuntimeInitialized = () => resolve();
    });
    const uciok = this.waitFor('uciok');
    this.send('uci');
    await uciok;
    const readyok = this.waitFor('readyok');
    this.send('isready');
    await readyok;
    this.send('ucinewgame');
  }

  /** Push one UCI command into the engine. */
  send(command: string): void {
    this.module.ccall('uci_command', 'number', ['string'], [command]);
  }

  /**
   * Cap Stockfish's playing strength (UCI `Skill Level`, 0–20; 20 = full
   * strength). Skill levels below 20 make it deliberately pick weaker
   * moves, which is how the sparring match keeps the opponent a fair
   * yardstick for a much simpler engine.
   */
  setSkillLevel(level: number): void {
    this.send(`setoption name Skill Level value ${level}`);
  }

  /**
   * Ask the engine for a move at a fixed depth from the current game
   * history. Returns the best move in UCI long algebraic, or null when
   * the engine reports no move (`bestmove (none)`).
   */
  async bestMove(
    startFen: string,
    history: readonly string[],
    depth: number,
  ): Promise<string | null> {
    const position =
      history.length === 0
        ? `position fen ${startFen}`
        : `position fen ${startFen} moves ${history.join(' ')}`;
    const waiter = this.registerWaiter(
      (line) => line.startsWith('bestmove'),
      `bestmove (go depth ${depth})`,
      DEFAULT_MOVE_TIMEOUT_MS,
    );
    this.send(position);
    this.send(`go depth ${depth}`);
    const line = await waiter;
    const move = line.split(/\s+/)[1];
    if (move === undefined || move === '(none)' || move === '0000') {
      return null;
    }
    return move;
  }

  /** Register a line waiter; rejects after `timeoutMs`. */
  private waitFor(
    marker: string,
    timeoutMs: number = DEFAULT_MOVE_TIMEOUT_MS,
  ): Promise<string> {
    return this.registerWaiter(
      (line) => line.startsWith(marker),
      marker,
      timeoutMs,
    );
  }

  /**
   * Register a line waiter. Must be called BEFORE the command that will
   * produce the reply: JS is single-threaded, so once the waiter is
   * registered no reply can slip past `onLine` (there is deliberately no
   * look-back over already-buffered lines — a stale `bestmove` from an
   * earlier `go` would otherwise be served for the current one).
   */
  private registerWaiter(
    predicate: (line: string) => boolean,
    what: string,
    timeoutMs: number,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve: (line) => {
          clearTimeout(waiter.timeout);
          resolve(line);
        },
        reject: (error) => {
          clearTimeout(waiter.timeout);
          reject(error);
        },
        timeout: setTimeout(() => {
          reject(new Error(`StockfishClient: timed out waiting for ${what}`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  /** Route one engine output line to the matching waiter. */
  private onLine(line: string): void {
    if (!line.trim()) {
      return;
    }
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i];
      if (waiter.predicate(line)) {
        this.waiters.splice(i, 1);
        waiter.resolve(line);
      }
    }
  }
}
