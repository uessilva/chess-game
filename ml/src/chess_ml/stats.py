"""Human-readable dataset statistics from the committed manifest."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _read_json(path: Path) -> Any:
    with path.open() as handle:
        return json.load(handle)


def load_stats(data_dir: Path, dataset_id: str) -> dict[str, Any]:
    manifest_path = data_dir / "manifests" / f"{dataset_id}.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"dataset not found: {dataset_id}")
    manifest = _read_json(manifest_path)
    timings_path = data_dir / "manifests" / f"{dataset_id}.timings.json"
    timings = _read_json(timings_path) if timings_path.exists() else {}
    counts = manifest["counts"]
    return {
        "dataset_id": dataset_id,
        "manifest": manifest,
        "timings": timings,
        "source": manifest["source"],
        "filters": manifest["filters"],
        "games": counts["games"],
        "positions": counts["positions"],
        "plies": counts["plies"],
        "shards": counts["shards"],
        "splits": manifest["splits"],
        "split_positions": manifest["split_positions"],
        "time_controls": manifest["time_controls"],
        "speeds": manifest["speeds"],
        "manifest_sha256": timings.get("manifest_sha256", ""),
        "throughput": timings.get("positions_per_second", 0.0),
    }


def _format_counts(counts: dict[str, int]) -> str:
    return ", ".join(f"{name}={count:,}" for name, count in counts.items())


def format_stats(stats: dict[str, Any]) -> str:
    manifest = stats["manifest"]
    source = stats["source"]
    filters = stats["filters"]
    timings = stats["timings"]
    lines = [
        f"Dataset:     {stats['dataset_id']}",
        f"Source:      {source.get('kind')} "
        f"({source.get('month') or source.get('name')})",
        f"Source sha:  {source.get('sha256', '-')}",
        f"Games:       {stats['games']:,}",
        f"Positions:   {stats['positions']:,}",
        f"Plies:       {stats['plies']:,}",
        f"Shards:      {stats['shards']:,}",
        f"Filters:     max_games={filters['max_games']}, "
        f"ply_cap={filters['ply_cap']}, min_plies={filters['min_plies']}, "
        f"drop_unfinished={filters['drop_unfinished']}",
        "Splits (games):     " + _format_counts(stats["splits"]),
        "Splits (positions): " + _format_counts(stats["split_positions"]),
        "Speed:       " + _format_counts(stats["speeds"]),
        "Time controls:",
    ]
    for control, count in sorted(
        stats["time_controls"].items(), key=lambda item: (-item[1], item[0])
    ):
        lines.append(f"  {control:<16} {count:,}")
    lines.append(
        f"Throughput:  {stats['throughput']:,.1f} positions/s "
        f"({timings.get('build_seconds', 0)} s, "
        f"{timings.get('jobs', 0)} jobs)"
    )
    lines.append(f"Manifest:    {stats['manifest_sha256']}")
    lines.append(f"Schema:      v{manifest['schema_version']}")
    return "\n".join(lines)
