# chess-ml

Offline data pipeline for the ML track (Phase 4).

> **License note:** this package depends on [`python-chess`](https://github.com/niklasf/python-chess),
> which is GPL-3.0. `ml/` is therefore effectively GPL-3.0 if distributed.

## Setup

Requires [uv](https://docs.astral.sh/uv/) (the Node gate assumes it too).

```sh
cd ml
uv sync                 # Python 3.12 + pipeline + dev tools + torch (CPU)
uv sync --no-group train  # CI: skip the torch download
```

`uv` installs the interpreter and manages `.venv`; neither the venv nor
`data/` is committed.

## CLI

```sh
uv run ml-download --month 2025-11
uv run ml-build    --month 2025-11 --max-games 20000 --ply-cap 80 --jobs 8
uv run ml-build    --pgn path/to/file.pgn
uv run ml-stats    --dataset elite-2025-11-dev-v1
```

`ml-build --month` downloads on demand (and reuses a verified cached zip).
`--max-games 0` removes the game limit; every dev default is a flag.

## Output

- `data/raw/` — cached zip plus its `.sha256` sidecar (gitignored)
- `data/datasets/<id>/shard-NNNNN.npz` + `index.json` (gitignored)
- `data/manifests/<id>.json` — deterministic manifest (committed)
- `data/manifests/<id>.timings.json` — wall-clock fields kept out of the
  manifest hash (committed)

Rebuilding the same inputs with the same `tool.git_commit` produces
byte-identical shards and manifest; only the timings file changes.

## Sample schema (one row per ply)

| column                         | dtype           | meaning                                                                                                 |
| ------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------- |
| `white_pieces`, `black_pieces` | `(N, 6) uint64` | bitboards in white's frame, order `pawn, knight, bishop, rook, queen, king`, square `a1=0 … h8=63`      |
| `meta`                         | `uint16`        | bit 0 side to move (0=white); bits 1–4 castling `WK,WQ,BK,BQ`; bits 5–8 ep file `0–7`, or `15` for none |
| `move`                         | `uint16`        | policy action index                                                                                     |
| `result`                       | `int8`          | White's perspective (−1/0/+1)                                                                           |
| `game`                         | `uint32`        | game index within the dataset                                                                           |
| `ply`                          | `uint16`        | 0-based ply within the game                                                                             |
| `split`                        | `uint8`         | 0 train / 1 val / 2 test                                                                                |

En passant is stored only when a **pseudo-legal** ep capture exists,
matching `meaningfulEnPassant` in `src/core/zobrist.ts` (a pinned ep still
counts, as in `python-chess` and common engine practice). Splits are
game-level 98/1/1, derived from a SHA-256 hash of the game index.

## Policy action space

`((from * 64) + to) * 5 + promo`, with `promo` ∈ {none, N, B, R, Q}:
20,480 logits mapping 1:1 to the core `Move`.

## Input encoding (contract for 4.2 / 4.3)

18 planes of 8×8, implemented in `src/chess_ml/encoding.py` and
cross-checked from TypeScript in `src/ml/oracle.test.ts`:

| planes | content                                                                |
| ------ | ---------------------------------------------------------------------- |
| 0–5    | side-to-move pawn, knight, bishop, rook, queen, king                   |
| 6–11   | opponent's pieces, same order                                          |
| 12     | side-to-move (all ones)                                                |
| 13–16  | castling: side-to-move kingside/queenside, opponent kingside/queenside |
| 17     | en-passant file (full column, meaningful ep only)                      |

The board is flipped vertically when Black is to move, so the side to move
always advances up the array. The ep file is unchanged by that flip.

## Verification

- `uv run pytest`: builds the real pipeline from the committed 3-game
  fixture, checks the deterministic rebuild, and validates the committed
  FEN oracle.
- `src/ml/oracle.test.ts` replays those FENs through `src/core` and asserts
  identical positions and legal move lists.
- `npm run check:ml` runs ruff, ruff-format, mypy, and pytest; it is wired
  into `npm run check`.

## Lichess Elite stats

Built from `lichess_elite_2025-11.zip` (sha256
`1ffa577aa0a1352fa04c9a890a6706049a3a79edc52810b136758d1e2a1a2eab`) with the
committed dev defaults (`--max-games 20000 --ply-cap 80 --min-plies 20`,
8 workers). The manifest is committed at
`data/manifests/elite-2025-11-dev-v1.json`; shards stay gitignored.

| metric                    | value                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| Games                     | 20,000                                                              |
| Positions (plies)         | 1,389,146                                                           |
| Shards                    | 2 (1,000,000 + 389,146 rows)                                        |
| Split — games             | train 19,615 / val 192 / test 193                                   |
| Split — positions         | train 1,362,592 / val 13,053 / test 13,501                          |
| Speed                     | blitz 18,572 / rapid 1,320 / classical 108                          |
| Most common time controls | 180+0: 13,097 · 180+2: 4,358 · 600+0: 522 · 180+1: 376 · 300+0: 246 |
| Skipped                   | too short 137 · unfinished 0 · illegal 0                            |
| Throughput                | 14,843 positions/s (93.6 s, 8 jobs)                                 |
| Manifest sha256           | `b02afdd0b34414c47fd51b2f922257438fd49786fb7565598bbf28353f5b7949`  |

A full-month run is `uv run ml-build --month 2025-11 --max-games 0 --jobs 8`.
The manifest records `tool.git_commit` = `ef48e02` (the pipeline commit), so
rebuilding that commit with the same source and limits reproduces the hash.
