"""Command-line entry points: ml-download, ml-build, ml-stats."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

from chess_ml.build import BuildConfig, build_dataset
from chess_ml.download import DEFAULT_MONTH, download_month
from chess_ml.stats import format_stats, load_stats

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def _default_jobs() -> int:
    return min(8, os.cpu_count() or 1)


def _add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DEFAULT_DATA_DIR,
        help=f"dataset root (default: {DEFAULT_DATA_DIR})",
    )


def _git_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _download_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ml-download",
        description="Download and cache one month of the Lichess Elite DB.",
    )
    parser.add_argument("--month", default=DEFAULT_MONTH)
    parser.add_argument("--url", default=None, help="override the source URL")
    _add_common(parser)
    return parser


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ml-build",
        description="Build a manifest-backed position dataset from a PGN.",
    )
    parser.add_argument("--month", default=None)
    parser.add_argument("--pgn", type=Path, default=None)
    parser.add_argument("--dataset-id", default=None)
    parser.add_argument("--profile", default="dev")
    parser.add_argument("--version", type=int, default=1)
    parser.add_argument(
        "--max-games",
        type=int,
        default=20_000,
        help="stop after N games (0 = unlimited)",
    )
    parser.add_argument("--ply-cap", type=int, default=80)
    parser.add_argument("--min-plies", type=int, default=20)
    parser.add_argument("--jobs", type=int, default=_default_jobs())
    parser.add_argument("--shard-size", type=int, default=1_000_000)
    _add_common(parser)
    return parser


def _stats_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ml-stats", description="Report statistics for a built dataset."
    )
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--json", action="store_true")
    _add_common(parser)
    return parser


def download_main(argv: Sequence[str] | None = None) -> int:
    args = _download_parser().parse_args(argv)
    result = download_month(
        args.month, raw_dir=args.data_dir / "raw", url=args.url
    )
    print(
        json.dumps(
            {
                "month": result.month,
                "url": result.url,
                "path": str(result.path),
                "sha256": result.sha256,
                "bytes": result.bytes,
                "cached": result.cached,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


def build_main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    max_games = None if args.max_games == 0 else args.max_games

    if args.pgn is not None:
        pgn = args.pgn
        month = args.month or "local"
        source = {"kind": "pgn"}
    else:
        month = args.month or DEFAULT_MONTH
        downloaded = download_month(month, raw_dir=args.data_dir / "raw")
        pgn = downloaded.path
        source = {
            "kind": "lichess-elite",
            "month": month,
            "url": downloaded.url,
        }
        if not downloaded.cached:
            print(f"downloaded {downloaded.path}")

    dataset_id = args.dataset_id or (
        f"elite-{month}-{args.profile}-v{args.version}"
    )
    result = build_dataset(
        BuildConfig(
            data_dir=args.data_dir,
            dataset_id=dataset_id,
            pgn=pgn,
            max_games=max_games,
            ply_cap=args.ply_cap,
            min_plies=args.min_plies,
            jobs=args.jobs,
            shard_size=args.shard_size,
            git_commit=_git_commit(),
            source=source,
        )
    )
    print(
        json.dumps(
            {
                "dataset_id": dataset_id,
                "dataset_dir": str(result.dataset_dir),
                "manifest": str(result.manifest_path),
                "manifest_sha256": result.manifest_sha256,
                "games": result.manifest["counts"]["games"],
                "positions": result.manifest["counts"]["positions"],
                "shards": result.manifest["counts"]["shards"],
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


def stats_main(argv: Sequence[str] | None = None) -> int:
    args = _stats_parser().parse_args(argv)
    stats = load_stats(args.data_dir, args.dataset)
    if args.json:
        print(json.dumps(stats, indent=2, sort_keys=True))
    else:
        print(format_stats(stats))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Dispatcher used by tests; the installed scripts call the *_main."""
    commands = {
        "download": download_main,
        "build": build_main,
        "stats": stats_main,
    }
    arguments = list(sys.argv[1:] if argv is None else argv)
    if not arguments or arguments[0] not in commands:
        print(f"usage: ml <{'|'.join(commands)}> [options]", file=sys.stderr)
        return 2
    return commands[arguments[0]](arguments[1:])
