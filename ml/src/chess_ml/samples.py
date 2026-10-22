"""Per-ply sample construction: schema and split assignment."""

from __future__ import annotations

import hashlib
import re

import chess
import chess.pgn
import numpy as np

from chess_ml.encoding import (
    action_index,
    bitboards,
    meaningful_ep_square,
)

SCHEMA_VERSION = 1

COLUMNS = {
    "white_pieces": "uint64",
    "black_pieces": "uint64",
    "meta": "uint16",
    "move": "uint16",
    "result": "int8",
    "game": "uint32",
    "ply": "uint16",
    "split": "uint8",
}

RESULT_VALUES = {"1-0": 1, "0-1": -1, "1/2-1/2": 0}

SPLIT_TRAIN = 0
SPLIT_VAL = 1
SPLIT_TEST = 2

# Game-level 98/1/1 split. Hashing the game index (not the position) keeps
# every ply of a game in the same split, including across shards.
_SPLIT_PREFIX = "chess-ml-split-v1:"

_TELEPORT = re.compile(r"^(\d+)\+(\d+)$")


def split_for_game(game_index: int) -> int:
    digest = hashlib.sha256(f"{_SPLIT_PREFIX}{game_index}".encode()).digest()
    bucket = int.from_bytes(digest[:4], "big") % 100
    if bucket == 98:
        return SPLIT_VAL
    if bucket == 99:
        return SPLIT_TEST
    return SPLIT_TRAIN


def speed_of(time_control: str) -> str:
    """Bucket a Lichess TimeControl header into a speed category."""
    value = time_control.strip()
    if value == "":
        return "unknown"
    if value == "-" or "/" in value:
        return "correspondence"
    match = _TELEPORT.match(value)
    if match is None:
        return "unknown"
    seconds = int(match.group(1)) + 40 * int(match.group(2))
    if seconds < 30:
        return "ultrabullet"
    if seconds < 180:
        return "bullet"
    if seconds < 480:
        return "blitz"
    if seconds < 1500:
        return "rapid"
    return "classical"


def meta_value(board: chess.Board) -> int:
    """Pack side to move, castling rights, and ep file into a uint16."""
    meta = 0
    if board.turn == chess.BLACK:
        meta |= 1
    if board.has_kingside_castling_rights(chess.WHITE):
        meta |= 1 << 1
    if board.has_queenside_castling_rights(chess.WHITE):
        meta |= 1 << 2
    if board.has_kingside_castling_rights(chess.BLACK):
        meta |= 1 << 3
    if board.has_queenside_castling_rights(chess.BLACK):
        meta |= 1 << 4
    ep = meaningful_ep_square(board)
    ep_file = 15 if ep is None else chess.square_file(ep)
    meta |= ep_file << 5
    return meta


def game_rows(
    game: chess.pgn.Game, *, game_index: int, ply_cap: int
) -> dict[str, np.ndarray] | None:
    """Build the sample columns for one game, one row per ply.

    Returns None when the game has no mainline. The caller owns filtering
    (result, minimum length, errors). Each row is the position *before*
    the move stored in ``move``.
    """
    moves = list(game.mainline_moves())
    if not moves:
        return None

    board = game.board()
    result = RESULT_VALUES.get(game.headers.get("Result", ""), 0)
    split = split_for_game(game_index)

    white: list[np.ndarray] = []
    black: list[np.ndarray] = []
    meta: list[int] = []
    actions: list[int] = []
    plies: list[int] = []

    for ply, move in enumerate(moves[:ply_cap]):
        wb, bb = bitboards(board)
        white.append(wb)
        black.append(bb)
        meta.append(meta_value(board))
        actions.append(action_index(move))
        plies.append(ply)
        board.push(move)

    count = len(actions)
    return {
        "white_pieces": np.stack(white).astype(np.uint64, copy=False),
        "black_pieces": np.stack(black).astype(np.uint64, copy=False),
        "meta": np.array(meta, dtype=np.uint16),
        "move": np.array(actions, dtype=np.uint16),
        "result": np.full(count, result, dtype=np.int8),
        "game": np.full(count, game_index, dtype=np.uint32),
        "ply": np.array(plies, dtype=np.uint16),
        "split": np.full(count, split, dtype=np.uint8),
    }
