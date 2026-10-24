import hashlib
import io
import json
import zipfile
from pathlib import Path

import numpy as np
import pytest

from chess_ml.build import BuildConfig, build_dataset
from chess_ml.samples import COLUMNS

FIXTURE_PGN = Path(__file__).resolve().parents[1] / "fixtures" / "fixture.pgn"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture()
def built(tmp_path: Path):
    config = BuildConfig(
        data_dir=tmp_path,
        dataset_id="elite-fixture-dev-v1",
        pgn=FIXTURE_PGN,
        max_games=None,
        ply_cap=80,
        min_plies=20,
        jobs=2,
        shard_size=50,
        git_commit="test-commit",
    )
    return build_dataset(config)


def test_build_emits_index_manifest_timings_and_shards(built) -> None:
    result = built
    assert result.dataset_dir.is_dir()
    assert result.manifest_path == (
        result.dataset_dir.parent.parent
        / "manifests"
        / "elite-fixture-dev-v1.json"
    )
    assert result.timings_path.exists()
    assert result.manifest_sha256 == sha256_file(result.manifest_path)

    index = json.loads((result.dataset_dir / "index.json").read_text())
    assert index["schema_version"] == 1
    assert index["dataset_id"] == "elite-fixture-dev-v1"
    assert index["columns"] == COLUMNS
    assert index["shards"]
    assert (
        sum(shard["rows"] for shard in index["shards"])
        == (result.manifest["counts"]["positions"])
    )

    for shard in index["shards"]:
        path = result.dataset_dir / shard["file"]
        assert path.exists()
        assert sha256_file(path) == shard["sha256"]
        with np.load(path) as data:
            assert int(data["move"].shape[0]) == shard["rows"]
            for column in COLUMNS:
                assert data[column].dtype == np.dtype(COLUMNS[column])


def test_manifest_contents(built) -> None:
    manifest = built.manifest
    assert manifest["schema_version"] == 1
    assert manifest["dataset_id"] == "elite-fixture-dev-v1"
    assert manifest["source"]["kind"] == "pgn"
    assert manifest["source"]["sha256"] == sha256_file(FIXTURE_PGN)
    assert manifest["filters"] == {
        "max_games": None,
        "ply_cap": 80,
        "min_plies": 20,
        "drop_unfinished": True,
    }
    counts = manifest["counts"]
    assert counts["games"] == 3
    assert counts["positions"] == counts["plies"]
    assert counts["positions"] > 3 * 20
    assert counts["shards"] == len(manifest["shards"])
    assert sum(manifest["splits"].values()) == counts["games"]
    assert sum(manifest["time_controls"].values()) == counts["games"]
    assert sum(manifest["speeds"].values()) == counts["games"]
    assert manifest["tool"]["git_commit"] == "test-commit"
    assert manifest["tool"]["name"] == "chess-ml"
    assert manifest["tool"]["schema_version"] == 1


def test_positions_are_one_row_per_ply_and_splits_are_game_level(built) -> None:
    arrays = {}
    for shard in built.manifest["shards"]:
        with np.load(built.dataset_dir / shard["file"]) as data:
            for column in COLUMNS:
                arrays.setdefault(column, []).append(data[column].copy())
    merged = {
        column: np.concatenate(chunks) for column, chunks in arrays.items()
    }

    assert merged["ply"].shape[0] == built.manifest["counts"]["positions"]
    assert set(merged["result"].tolist()) <= {-1, 0, 1}
    for game in np.unique(merged["game"]):
        mask = merged["game"] == game
        assert len(set(merged["split"][mask].tolist())) == 1
        assert merged["ply"][mask].tolist() == list(range(int(mask.sum())))


def test_rebuild_is_byte_identical(built, tmp_path: Path) -> None:
    other = build_dataset(
        BuildConfig(
            data_dir=tmp_path / "second",
            dataset_id="elite-fixture-dev-v1",
            pgn=FIXTURE_PGN,
            max_games=None,
            ply_cap=80,
            min_plies=20,
            jobs=3,
            shard_size=50,
            git_commit="test-commit",
        )
    )

    assert built.manifest_sha256 == other.manifest_sha256
    assert built.manifest == other.manifest
    assert [shard["sha256"] for shard in built.manifest["shards"]] == [
        shard["sha256"] for shard in other.manifest["shards"]
    ]
    assert (built.dataset_dir / "index.json").read_bytes() == (
        other.dataset_dir / "index.json"
    ).read_bytes()


def test_max_games_and_min_plies_filters(tmp_path: Path) -> None:
    limited = build_dataset(
        BuildConfig(
            data_dir=tmp_path,
            dataset_id="elite-fixture-dev-v1",
            pgn=FIXTURE_PGN,
            max_games=1,
            ply_cap=80,
            min_plies=20,
            jobs=1,
            shard_size=1_000_000,
            git_commit="test-commit",
        )
    )
    assert limited.manifest["counts"]["games"] == 1
    assert limited.manifest["skipped"]["too_short"] == 0

    empty = build_dataset(
        BuildConfig(
            data_dir=tmp_path / "empty",
            dataset_id="elite-empty-dev-v1",
            pgn=FIXTURE_PGN,
            max_games=None,
            ply_cap=80,
            min_plies=1000,
            jobs=1,
            shard_size=1_000_000,
            git_commit="test-commit",
        )
    )
    assert empty.manifest["counts"] == {
        "games": 0,
        "positions": 0,
        "plies": 0,
        "shards": 0,
    }
    assert empty.manifest["shards"] == []
    assert empty.manifest["skipped"]["too_short"] == 3


def test_unfinished_games_are_dropped(tmp_path: Path) -> None:
    pgn = FIXTURE_PGN.read_text()
    pgn = pgn.replace('[Result "1-0"]', '[Result "*"]', 1)
    pgn = pgn.replace("17. Rd8# 1-0", "17. Rd8# *", 1)
    path = tmp_path / "unfinished.pgn"
    path.write_text(pgn)

    result = build_dataset(
        BuildConfig(
            data_dir=tmp_path / "data",
            dataset_id="elite-unfinished-dev-v1",
            pgn=path,
            max_games=None,
            ply_cap=80,
            min_plies=20,
            jobs=1,
            shard_size=1_000_000,
            git_commit="test-commit",
        )
    )
    assert result.manifest["counts"]["games"] == 2
    assert result.manifest["skipped"]["unfinished"] == 1


def test_torch_is_not_imported_by_pipeline() -> None:
    # A guard for 4.2: the pipeline must stay torch-free (torch is an
    # environment dependency, not a pipeline one).
    source = "\n".join(
        path.read_text()
        for path in (Path(__file__).parents[1] / "src" / "chess_ml").glob(
            "*.py"
        )
    )
    assert "import torch" not in source
    assert "from torch" not in source


def test_build_reads_pgn_from_a_zip_archive(tmp_path: Path) -> None:
    archive = tmp_path / "elite.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.write(FIXTURE_PGN, arcname="lichess_elite_fixture.pgn")

    result = build_dataset(
        BuildConfig(
            data_dir=tmp_path / "data",
            dataset_id="elite-zip-dev-v1",
            pgn=archive,
            max_games=None,
            ply_cap=80,
            min_plies=20,
            jobs=1,
            shard_size=1_000_000,
            git_commit="test-commit",
            source={"kind": "lichess-elite", "month": "2025-11"},
        )
    )
    assert result.manifest["counts"]["games"] == 3
    assert result.manifest["source"]["sha256"] == sha256_file(archive)
    assert result.manifest["source"]["month"] == "2025-11"


def test_rebuild_removes_stale_shards(tmp_path: Path) -> None:
    data_dir = tmp_path
    first = build_dataset(
        BuildConfig(
            data_dir=data_dir,
            dataset_id="elite-fixture-dev-v1",
            pgn=FIXTURE_PGN,
            max_games=None,
            ply_cap=80,
            min_plies=20,
            jobs=1,
            shard_size=50,
            git_commit="test-commit",
        )
    )
    assert first.manifest["counts"]["shards"] > 1

    second = build_dataset(
        BuildConfig(
            data_dir=data_dir,
            dataset_id="elite-fixture-dev-v1",
            pgn=FIXTURE_PGN,
            max_games=None,
            ply_cap=80,
            min_plies=20,
            jobs=1,
            shard_size=1_000_000,
            git_commit="test-commit",
        )
    )
    assert second.manifest["counts"]["shards"] == 1
    files = sorted(path.name for path in first.dataset_dir.glob("shard-*.npz"))
    assert files == ["shard-00000.npz"]


def test_shards_are_valid_zip_with_fixed_timestamps(built) -> None:
    shard = built.dataset_dir / built.manifest["shards"][0]["file"]
    with zipfile.ZipFile(io.BytesIO(shard.read_bytes())) as archive:
        for info in archive.infolist():
            assert info.date_time == (1980, 1, 1, 0, 0, 0)
