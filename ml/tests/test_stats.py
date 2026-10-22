import json
from pathlib import Path

import pytest

from chess_ml.build import BuildConfig, build_dataset
from chess_ml.stats import format_stats, load_stats

FIXTURE_PGN = Path(__file__).resolve().parents[1] / "fixtures" / "fixture.pgn"


@pytest.fixture()
def data_dir(tmp_path: Path) -> Path:
    build_dataset(
        BuildConfig(
            data_dir=tmp_path,
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
    return tmp_path


def test_load_stats(data_dir: Path) -> None:
    stats = load_stats(data_dir, "elite-fixture-dev-v1")
    assert stats["dataset_id"] == "elite-fixture-dev-v1"
    assert stats["games"] == 3
    assert stats["positions"] > 60
    assert stats["shards"] == len(stats["manifest"]["shards"])
    assert stats["manifest_sha256"] == stats["timings"]["manifest_sha256"]
    assert stats["throughput"] > 0
    assert stats["source"]["kind"] == "pgn"


def test_format_stats_is_human_readable(data_dir: Path) -> None:
    text = format_stats(load_stats(data_dir, "elite-fixture-dev-v1"))
    assert "elite-fixture-dev-v1" in text
    assert "Games" in text
    assert "Positions" in text
    assert "Splits" in text
    assert "Speed" in text
    assert "Throughput" in text


def test_missing_dataset_raises(data_dir: Path) -> None:
    with pytest.raises(FileNotFoundError, match="elite-nope"):
        load_stats(data_dir, "elite-nope")


def test_stats_json_round_trip(data_dir: Path, capsys) -> None:
    from chess_ml.cli import main

    assert (
        main(
            [
                "stats",
                "--dataset",
                "elite-fixture-dev-v1",
                "--data-dir",
                str(data_dir),
                "--json",
            ]
        )
        == 0
    )
    payload = json.loads(capsys.readouterr().out)
    assert payload["dataset_id"] == "elite-fixture-dev-v1"
    assert payload["games"] == 3
