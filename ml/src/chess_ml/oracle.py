"""Cross-language oracle: canonical FENs plus legal UCI moves."""

from __future__ import annotations

import json
from dataclasses import dataclass

import chess
import chess.pgn

from chess_ml.encoding import meaningful_ep_square


def canonical_fen(board: chess.Board) -> str:
    """FEN with the same meaningful-ep semantics as ``src/core``."""
    ep = meaningful_ep_square(board)
    ep_field = "-" if ep is None else chess.square_name(ep)
    return " ".join(
        (
            board.board_fen(),
            "w" if board.turn == chess.WHITE else "b",
            board.castling_xfen(),
            ep_field,
            str(board.halfmove_clock),
            str(board.fullmove_number),
        )
    )


@dataclass(frozen=True)
class OraclePosition:
    fen: str
    game: int
    ply: int
    moves: tuple[str, ...]


def oracle_positions(
    game: chess.pgn.Game, *, ply_cap: int, game_index: int = 0
) -> list[OraclePosition]:
    """Positions of a game with their sorted legal UCI moves."""
    board = game.board()
    positions: list[OraclePosition] = []
    for ply, move in enumerate(game.mainline_moves()):
        if ply >= ply_cap:
            break
        positions.append(
            OraclePosition(
                fen=canonical_fen(board),
                game=game_index,
                ply=ply,
                moves=tuple(sorted(move.uci() for move in board.legal_moves)),
            )
        )
        board.push(move)
    return positions


def oracle_jsonl(positions: list[OraclePosition]) -> str:
    lines = [
        json.dumps(
            {
                "fen": position.fen,
                "game": position.game,
                "ply": position.ply,
                "moves": list(position.moves),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        for position in positions
    ]
    return "\n".join(lines) + ("\n" if lines else "")
