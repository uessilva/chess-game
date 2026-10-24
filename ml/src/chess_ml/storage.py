"""Deterministic file output: hashing, JSON, and shard archives."""

from __future__ import annotations

import hashlib
import io
import json
import os
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    os.replace(temporary, path)


def save_npz(path: Path, arrays: Mapping[str, np.ndarray]) -> None:
    """Write a deterministic .npz (sorted names, fixed timestamps)."""
    temporary = path.with_suffix(".npz.tmp")
    with zipfile.ZipFile(
        temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for column in sorted(arrays):
            buffer = io.BytesIO()
            np.save(buffer, arrays[column], allow_pickle=False)
            info = zipfile.ZipInfo(
                f"{column}.npy", date_time=(1980, 1, 1, 0, 0, 0)
            )
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, buffer.getvalue())
    os.replace(temporary, path)


@dataclass
class ShardWriter:
    """Accumulate rows and flush exact-size shards in source order."""

    directory: Path
    shard_size: int
    columns: Sequence[str]
    shards: list[dict[str, Any]] = field(default_factory=list)
    buffers: dict[str, list[np.ndarray]] = field(init=False)
    rows: int = 0

    def __post_init__(self) -> None:
        self.buffers = {column: [] for column in self.columns}

    def add(self, rows: Mapping[str, np.ndarray]) -> None:
        total = int(rows["move"].shape[0])
        start = 0
        while start < total:
            take = min(self.shard_size - self.rows, total - start)
            for column in self.columns:
                self.buffers[column].append(rows[column][start : start + take])
            self.rows += take
            start += take
            if self.rows == self.shard_size:
                self.flush()

    def flush(self) -> None:
        if self.rows == 0:
            return
        arrays = {
            column: np.concatenate(chunks)
            for column, chunks in self.buffers.items()
        }
        filename = f"shard-{len(self.shards):05d}.npz"
        path = self.directory / filename
        save_npz(path, arrays)
        self.shards.append(
            {
                "file": filename,
                "rows": self.rows,
                "sha256": sha256_file(path),
            }
        )
        self.buffers = {column: [] for column in self.columns}
        self.rows = 0
