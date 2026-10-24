import chess
import numpy as np
import pytest

from chess_ml.encoding import (
    NUM_ACTIONS,
    NUM_PLANES,
    action_index,
    action_to_move,
    bitboards,
    encode_board,
    meaningful_ep_square,
)


def plane_ones(planes: np.ndarray, index: int) -> set[int]:
    """Square indices (a1=0) set in one 8x8 plane."""
    return {int(sq) for sq in np.flatnonzero(planes[index])}


def test_encoding_has_eighteen_planes() -> None:
    assert NUM_PLANES == 18
    planes = encode_board(chess.Board())
    assert planes.shape == (18, 8, 8)
    assert planes.dtype == np.float32


def test_starting_position_planes() -> None:
    planes = encode_board(chess.Board())

    # White pawns on rank 2, knights on b1/g1, queen on d1, king on e1.
    assert plane_ones(planes, 0) == set(range(8, 16))
    assert plane_ones(planes, 1) == {1, 6}
    assert plane_ones(planes, 4) == {3}
    assert plane_ones(planes, 5) == {4}
    # The opponent's pieces occupy planes 6-11 on rank 7.
    assert plane_ones(planes, 6) == set(range(48, 56))
    assert plane_ones(planes, 9) == {56, 63}
    assert plane_ones(planes, 11) == {60}

    # Side-to-move plane, all four castling rights, no en passant.
    assert plane_ones(planes, 12) == set(range(64))
    for index in range(13, 17):
        assert plane_ones(planes, index) == set(range(64))
    assert plane_ones(planes, 17) == set()


def test_black_perspective_flips_board_and_piece_planes() -> None:
    board = chess.Board(
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"
    )
    planes = encode_board(board)

    # The side-to-move's pawns are now the first plane, and the board is
    # flipped vertically: black's a7 pawn lands on a2 (square index 8).
    assert plane_ones(planes, 0) == set(range(8, 16))
    # White's pawns are the opponent plane, mirrored onto rank 7.
    assert plane_ones(planes, 6) == set(range(48, 56))
    assert plane_ones(planes, 5) == {4}  # black king e8 -> e1
    assert plane_ones(planes, 11) == {60}  # white king e1 -> e8
    assert plane_ones(planes, 12) == set(range(64))


def test_castling_planes_are_from_the_side_to_moves_perspective() -> None:
    # Black to move, only White retains the kingside right.
    board = chess.Board("4k3/8/8/8/8/8/8/4K2R b K - 0 1")
    planes = encode_board(board)

    # 13/14: side-to-move (Black) kingside/queenside (both absent).
    assert plane_ones(planes, 13) == set()
    assert plane_ones(planes, 14) == set()
    # 15/16: opponent (White) kingside/queenside.
    assert plane_ones(planes, 15) == set(range(64))
    assert plane_ones(planes, 16) == set()


def test_meaningful_en_passant_fills_the_file() -> None:
    board = chess.Board("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2")
    planes = encode_board(board)

    assert meaningful_ep_square(board) == chess.D6
    # d-file in canonical orientation; White is not flipped.
    assert plane_ones(planes, 17) == {3, 11, 19, 27, 35, 43, 51, 59}


def test_meaningless_en_passant_is_ignored() -> None:
    # The ep target d6 survives in the FEN but no White pawn can take it.
    board = chess.Board("4k3/8/8/8/4P3/8/8/4K3 w - d6 0 2")
    assert meaningful_ep_square(board) is None
    assert plane_ones(encode_board(board), 17) == set()


def test_meaningful_en_passant_uses_pseudo_legal_adjacency() -> None:
    # Both pawns are pinned, so no *legal* ep capture exists -- matching
    # src/core/zobrist.ts, which treats a pinned ep as meaningful.
    board = chess.Board("8/8/8/2k5/3Pp3/8/8/4K3 b - d3 0 1")
    assert meaningful_ep_square(board) == chess.D3
    assert plane_ones(encode_board(board), 17) == {
        3,
        11,
        19,
        27,
        35,
        43,
        51,
        59,
    }


def test_ep_file_plane_is_mirrored_for_black() -> None:
    board = chess.Board("4k3/8/8/8/1pP5/8/8/4K3 b - c3 0 1")
    # b4 black pawn is adjacent to c3; file c is unchanged by the flip.
    assert meaningful_ep_square(board) == chess.C3
    assert plane_ones(encode_board(board), 17) == {
        2,
        10,
        18,
        26,
        34,
        42,
        50,
        58,
    }


def test_bitboards_are_white_frame_in_type_order() -> None:
    board = chess.Board()
    white, black = bitboards(board)

    assert white.shape == black.shape == (6,)
    assert white.dtype == black.dtype == np.uint64
    assert [int(white[i]) for i in range(6)] == [
        0x000000000000FF00,  # pawns
        0x0000000000000042,  # knights
        0x0000000000000024,  # bishops
        0x0000000000000081,  # rooks
        0x0000000000000008,  # queens
        0x0000000000000010,  # kings
    ]
    assert [int(black[i]) for i in range(6)] == [
        0x00FF000000000000,
        0x4200000000000000,
        0x2400000000000000,
        0x8100000000000000,
        0x0800000000000000,
        0x1000000000000000,
    ]


def test_action_space_is_20480_and_round_trips() -> None:
    assert NUM_ACTIONS == 64 * 64 * 5
    for uci in ["e2e4", "e7e8q", "a1h8", "b7b8n", "b7b8b", "b7b8r"]:
        move = chess.Move.from_uci(uci)
        index = action_index(move)
        assert 0 <= index < NUM_ACTIONS
        assert action_to_move(index) == move


def test_all_legal_move_actions_are_distinct() -> None:
    board = chess.Board()
    indices = [action_index(move) for move in board.legal_moves]
    assert len(indices) == len(set(indices))
    assert min(indices) >= 0
    assert max(indices) < NUM_ACTIONS


def test_action_to_move_rejects_out_of_range() -> None:
    with pytest.raises(ValueError):
        action_to_move(NUM_ACTIONS)
    with pytest.raises(ValueError):
        action_to_move(-1)
