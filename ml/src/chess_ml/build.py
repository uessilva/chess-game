"""Deterministic, manifest-backed dataset builder for one PGN source."""

from __future__ import annotations

import io
import re
import time
import zipfile
from collections import Counter
from collections.abc import Iterator, Mapping
from concurrent.futures import ProcessPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TextIO

import chess.pgn
import numpy as np

from chess_ml.samples import (
    COLUMNS,
    SCHEMA_VERSION,
    SPLIT_TEST,
    SPLIT_TRAIN,
    SPLIT_VAL,
    game_rows,
    speed_of,
    split_for_game,
)
from chess_ml.storage import ShardWriter, sha256_file, write_json

DEFAULT_SHARD_SIZE = 1_000_000
_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_SPLIT_NAMES = {SPLIT_TRAIN: "train", SPLIT_VAL: "val", SPLIT_TEST: "test"}


@dataclass(frozen=True)
class BuildConfig:
    data_dir: Path
    dataset_id: str
    pgn: Path
    max_games: int | None = 20_000
    ply_cap: int = 80
    min_plies: int = 20
    jobs: int = 1
    shard_size: int = DEFAULT_SHARD_SIZE
    git_commit: str = "unknown"
    source: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class BuildResult:
    dataset_dir: Path
    manifest_path: Path
    timings_path: Path
    manifest: Mapping[str, Any]
    manifest_sha256: str


def _read_games(path: Path) -> Iterator[chess.pgn.Game]:
    with _pgn_stream(path) as handle:
        while (game := chess.pgn.read_game(handle)) is not None:
            yield game


@contextmanager
def _pgn_stream(path: Path) -> Iterator[TextIO]:
    """Open a PGN file, or the first PGN member of a ZIP archive."""
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            members = [
                info
                for info in archive.infolist()
                if not info.is_dir() and info.filename.lower().endswith(".pgn")
            ]
            if not members:
                raise ValueError(f"no .pgn member in archive: {path}")
            with (
                archive.open(members[0]) as raw,
                io.TextIOWrapper(
                    raw, encoding="utf-8", errors="replace"
                ) as text,
            ):
                yield text
        return
    with path.open(encoding="utf-8", errors="replace") as handle:
        yield handle


def _filter_games(
    pgn: Path,
    *,
    max_games: int | None,
    min_plies: int,
) -> tuple[list[str], Counter[str], Counter[str], Counter[str]]:
    """Select games and serialize them for worker processes.

    Returns (game PGNs in dataset order, time controls, speed buckets,
    skipped counters).
    """
    kept: list[str] = []
    time_controls: Counter[str] = Counter()
    speeds: Counter[str] = Counter()
    skipped: Counter[str] = Counter()

    for game in _read_games(pgn):
        if max_games is not None and len(kept) >= max_games:
            break
        if game.errors:
            skipped["illegal"] += 1
            continue
        if game.headers.get("Result", "*") not in {"1-0", "0-1", "1/2-1/2"}:
            skipped["unfinished"] += 1
            continue
        if len(list(game.mainline_moves())) < min_plies:
            skipped["too_short"] += 1
            continue
        kept.append(str(game))
        control = game.headers.get("TimeControl") or "unknown"
        time_controls[control] += 1
        speeds[speed_of(control)] += 1

    skipped.setdefault("illegal", 0)
    skipped.setdefault("unfinished", 0)
    skipped.setdefault("too_short", 0)
    return kept, time_controls, speeds, skipped


def _process_chunk(
    payload: tuple[list[str], int, int],
) -> list[dict[str, np.ndarray]]:
    texts, base_index, ply_cap = payload
    rows: list[dict[str, np.ndarray]] = []
    for offset, text in enumerate(texts):
        game = chess.pgn.read_game(io.StringIO(text))
        if game is None:
            raise ValueError(f"could not re-parse game {base_index + offset}")
        sample = game_rows(
            game, game_index=base_index + offset, ply_cap=ply_cap
        )
        if sample is None:
            raise ValueError(f"game {base_index + offset} has no mainline")
        rows.append(sample)
    return rows


def _chunks(games: list[str], jobs: int) -> list[tuple[list[str], int]]:
    if not games:
        return []
    chunk_size = max(1, (len(games) + jobs - 1) // jobs)
    return [
        (games[start : start + chunk_size], start)
        for start in range(0, len(games), chunk_size)
    ]


def _iter_rows(
    games: list[str], *, jobs: int, ply_cap: int
) -> Iterator[dict[str, np.ndarray]]:
    chunks = [(texts, base, ply_cap) for texts, base in _chunks(games, jobs)]
    if jobs <= 1 or len(chunks) <= 1:
        for chunk in chunks:
            yield from _process_chunk(chunk)
        return
    with ProcessPoolExecutor(max_workers=jobs) as executor:
        for result in executor.map(_process_chunk, chunks):
            yield from result


def _source_info(config: BuildConfig) -> dict[str, Any]:
    source = dict(config.source or {})
    source.setdefault("kind", "pgn")
    source.setdefault("name", config.pgn.name)
    source["sha256"] = sha256_file(config.pgn)
    source["bytes"] = config.pgn.stat().st_size
    return source


def _collect_rows(
    config: BuildConfig, games: list[str]
) -> tuple[ShardWriter, int, Counter[int], Counter[int]]:
    dataset_dir = config.data_dir / "datasets" / config.dataset_id
    dataset_dir.mkdir(parents=True, exist_ok=True)
    # A rebuild owns the dataset directory: drop shards from a previous,
    # possibly longer, run so index.json never points past stale files.
    for stale in dataset_dir.glob("shard-*.npz"):
        stale.unlink()

    writer = ShardWriter(dataset_dir, config.shard_size, tuple(COLUMNS))
    positions = 0
    split_positions: Counter[int] = Counter()
    split_games: Counter[int] = Counter()

    for game_index, rows in enumerate(
        _iter_rows(games, jobs=config.jobs, ply_cap=config.ply_cap)
    ):
        writer.add(rows)
        count = int(rows["move"].shape[0])
        positions += count
        split = int(rows["split"][0])
        split_positions[split] += count
        split_games[split] += 1
        if split != split_for_game(game_index):
            raise AssertionError("split assignment drift")
    writer.flush()
    return writer, positions, split_positions, split_games


def build_dataset(config: BuildConfig) -> BuildResult:
    """Build one dataset: shards, index.json, manifest, and timings."""
    if not _ID_PATTERN.fullmatch(config.dataset_id):
        raise ValueError(f"invalid dataset id: {config.dataset_id}")
    if config.ply_cap < 1:
        raise ValueError("ply_cap must be at least 1")
    if config.min_plies < 1:
        raise ValueError("min_plies must be at least 1")
    if config.jobs < 1:
        raise ValueError("jobs must be at least 1")
    if config.shard_size < 1:
        raise ValueError("shard_size must be at least 1")

    started = time.perf_counter()
    source = _source_info(config)
    games, time_controls, speeds, skipped = _filter_games(
        config.pgn,
        max_games=config.max_games,
        min_plies=config.min_plies,
    )
    writer, positions, split_positions, split_games = _collect_rows(
        config, games
    )
    dataset_dir = config.data_dir / "datasets" / config.dataset_id

    index = {
        "schema_version": SCHEMA_VERSION,
        "dataset_id": config.dataset_id,
        "columns": COLUMNS,
        "shards": [
            {
                "file": shard["file"],
                "rows": shard["rows"],
                "sha256": shard["sha256"],
            }
            for shard in writer.shards
        ],
        "counts": {
            "games": len(games),
            "positions": positions,
        },
    }
    write_json(dataset_dir / "index.json", index)

    manifest: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "dataset_id": config.dataset_id,
        "encoding": {"planes": 18, "actions": 20_480},
        "source": source,
        "filters": {
            "max_games": config.max_games,
            "ply_cap": config.ply_cap,
            "min_plies": config.min_plies,
            "drop_unfinished": True,
        },
        "counts": {
            "games": len(games),
            "positions": positions,
            "plies": positions,
            "shards": len(writer.shards),
        },
        "splits": {
            _SPLIT_NAMES[split]: split_games[split]
            for split in (SPLIT_TRAIN, SPLIT_VAL, SPLIT_TEST)
        },
        "split_positions": {
            _SPLIT_NAMES[split]: split_positions[split]
            for split in (SPLIT_TRAIN, SPLIT_VAL, SPLIT_TEST)
        },
        "time_controls": dict(sorted(time_controls.items())),
        "speeds": dict(sorted(speeds.items())),
        "skipped": dict(sorted(skipped.items())),
        "shards": writer.shards,
        "tool": {
            "name": "chess-ml",
            "schema_version": SCHEMA_VERSION,
            "git_commit": config.git_commit,
        },
    }

    manifests_dir = config.data_dir / "manifests"
    manifest_path = manifests_dir / f"{config.dataset_id}.json"
    write_json(manifest_path, manifest)
    manifest_sha = sha256_file(manifest_path)

    elapsed = time.perf_counter() - started
    timings = {
        "dataset_id": config.dataset_id,
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "build_seconds": round(elapsed, 3),
        "positions_per_second": round(positions / elapsed, 1)
        if elapsed > 0
        else 0.0,
        "jobs": config.jobs,
        "shard_size": config.shard_size,
        "manifest_sha256": manifest_sha,
    }
    timings_path = manifests_dir / f"{config.dataset_id}.timings.json"
    write_json(timings_path, timings)

    return BuildResult(
        dataset_dir=dataset_dir,
        manifest_path=manifest_path,
        timings_path=timings_path,
        manifest=manifest,
        manifest_sha256=manifest_sha,
    )
