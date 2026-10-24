import json
from pathlib import Path

import chess.pgn

from chess_ml.oracle import oracle_jsonl, oracle_positions

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
FIXTURE_PGN = FIXTURES / "fixture.pgn"
FIXTURE_ORACLE = FIXTURES / "fixture-oracle.jsonl"


def read_games(path: Path) -> list[chess.pgn.Game]:
    games = []
    with path.open() as handle:
        while (game := chess.pgn.read_game(handle)) is not None:
            games.append(game)
    return games


def test_committed_oracle_is_generated_by_the_pipeline() -> None:
    games = read_games(FIXTURE_PGN)
    positions = []
    for game_index, game in enumerate(games):
        positions.extend(
            oracle_positions(game, ply_cap=80, game_index=game_index)
        )
    expected = oracle_jsonl(positions)
    assert FIXTURE_ORACLE.read_text() == expected


def test_oracle_lines_have_contract_fields() -> None:
    lines = FIXTURE_ORACLE.read_text().splitlines()
    assert len(lines) > 60
    first = json.loads(lines[0])
    assert set(first) == {"fen", "game", "ply", "moves"}
    assert first["fen"].startswith("rnbqkbnr/pppppppp/")
    assert first["moves"] == sorted(first["moves"])
    # UCI only: promotions use the q/r/b/n suffix, castling keeps the king
    # move, en passant has no marker.
    for line in lines:
        payload = json.loads(line)
        assert payload["fen"].count(" ") == 5
        for move in payload["moves"]:
            assert len(move) in (4, 5)
            assert move.islower() or move[4:].islower()
