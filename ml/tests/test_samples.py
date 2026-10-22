import io

import chess
import chess.pgn
import numpy as np

from chess_ml.encoding import action_index
from chess_ml.oracle import oracle_positions
from chess_ml.samples import (
    COLUMNS,
    RESULT_VALUES,
    game_rows,
    meta_value,
    speed_of,
    split_for_game,
)

PGN = """[Event "Unit"]
[Site "?"]
[Date "2025.11.01"]
[Round "1"]
[White "White"]
[Black "Black"]
[Result "1-0"]
[TimeControl "180+2"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6
8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. c4 c6 12. cxb5 axb5 13. Nc3 Bb7 1-0
"""


def read_game(pgn: str = PGN) -> chess.pgn.Game:
    game = chess.pgn.read_game(io.StringIO(pgn))
    assert game is not None
    return game


def test_result_values() -> None:
    assert RESULT_VALUES == {"1-0": 1, "0-1": -1, "1/2-1/2": 0}
    assert COLUMNS == {
        "white_pieces": "uint64",
        "black_pieces": "uint64",
        "meta": "uint16",
        "move": "uint16",
        "result": "int8",
        "game": "uint32",
        "ply": "uint16",
        "split": "uint8",
    }


def test_split_is_deterministic_and_game_level() -> None:
    assert split_for_game(0) == split_for_game(0)
    values = [split_for_game(index) for index in range(20_000)]
    assert set(values) == {0, 1, 2}
    # Roughly 98/1/1, never per-position.
    for split in (1, 2):
        assert 100 <= values.count(split) <= 300


def test_speed_buckets() -> None:
    assert speed_of("30+0") == "bullet"
    assert speed_of("60+0") == "bullet"
    assert speed_of("180+2") == "blitz"
    assert speed_of("600+0") == "rapid"
    assert speed_of("1800+30") == "classical"
    assert speed_of("-") == "correspondence"
    assert speed_of("40/7200:3600") == "correspondence"
    assert speed_of("") == "unknown"


def test_meta_bits() -> None:
    start = chess.Board()
    # Side 0, castling KQkq in bits 1-4, "no ep" = 15 in bits 5-8.
    assert meta_value(start) == 0b111111110

    board = chess.Board("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2")
    assert meta_value(board) & 0xF == 0
    assert (meta_value(board) >> 5) & 0xF == 3  # d-file

    board = chess.Board("4k3/8/8/8/1pP5/8/8/4K3 b - c3 0 1")
    assert (meta_value(board) >> 5) & 0xF == 2
    assert meta_value(board) & 0b1 == 1


def test_game_rows_schema_and_values() -> None:
    game = read_game()
    rows = game_rows(game, game_index=7, ply_cap=80)

    assert rows is not None
    assert rows["white_pieces"].shape == (rows["move"].shape[0], 6)
    assert rows["black_pieces"].shape == (rows["move"].shape[0], 6)
    assert rows["white_pieces"].dtype == np.uint64
    assert rows["black_pieces"].dtype == np.uint64
    assert rows["meta"].dtype == np.uint16
    assert rows["move"].dtype == np.uint16
    assert rows["result"].dtype == np.int8
    assert rows["game"].dtype == np.uint32
    assert rows["ply"].dtype == np.uint16
    assert rows["split"].dtype == np.uint8

    plies = rows["move"].shape[0]
    assert plies == len(list(game.mainline_moves()))
    assert list(rows["ply"]) == list(range(plies))
    assert set(rows["result"]) == {1}
    assert set(rows["game"]) == {7}
    assert set(rows["split"]) == {split_for_game(7)}

    # Every row is the position *before* the move in `move`.
    board = game.board()
    for index, move in enumerate(game.mainline_moves()):
        assert rows["move"][index] == action_index(move)
        assert int(rows["white_pieces"][index][0]) == _bb(
            board, chess.PAWN, chess.WHITE
        )
        board.push(move)


def test_ply_cap_truncates_positions() -> None:
    rows = game_rows(read_game(), game_index=0, ply_cap=10)
    assert rows is not None
    assert rows["move"].shape[0] == 10
    assert list(rows["ply"]) == list(range(10))


def test_oracle_positions_emit_fens_and_legal_moves() -> None:
    positions = oracle_positions(read_game(), ply_cap=3)
    assert len(positions) == 3
    assert positions[0].fen.startswith("rnbqkbnr/pppppppp/")
    assert "e2e4" in positions[0].moves
    assert list(positions[0].moves) == sorted(positions[0].moves)
    assert len(positions[0].moves) == 20


def test_empty_game_returns_none() -> None:
    game = chess.pgn.Game()
    assert game_rows(game, game_index=0, ply_cap=80) is None


def _bb(board: chess.Board, piece_type: int, color: bool) -> int:
    total = 0
    for square in board.pieces(piece_type, color):
        total |= 1 << square
    return total
