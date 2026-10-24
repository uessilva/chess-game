"""Canonical input encoding and policy action space shared by 4.2/4.3.

Tensor contract (18 planes, 8x8):

  planes 0-5   side-to-move's pawn, knight, bishop, rook, queen, king
  planes 6-11  opponent's pieces, same order
  plane 12     side-to-move (all ones)
  planes 13-16 castling rights: side-to-move kingside, side-to-move
               queenside, opponent kingside, opponent queenside
  plane 17     en-passant file (a full file, only when a pseudo-legal ep
               capture exists)

Rank 0 is the side-to-move's back rank: the board is flipped vertically
when Black is to move, so the side to move always advances up the array.
The ep file is unchanged by a vertical flip.
"""

from __future__ import annotations

import chess
import numpy as np

NUM_PLANES = 18
NUM_ACTIONS = 64 * 64 * 5

PIECE_ORDER = (
    chess.PAWN,
    chess.KNIGHT,
    chess.BISHOP,
    chess.ROOK,
    chess.QUEEN,
    chess.KING,
)

PROMOTION_TO_INDEX = {
    None: 0,
    chess.KNIGHT: 1,
    chess.BISHOP: 2,
    chess.ROOK: 3,
    chess.QUEEN: 4,
}
INDEX_TO_PROMOTION = {
    index: piece for piece, index in PROMOTION_TO_INDEX.items()
}

_EP_PAWN_RANK = {chess.WHITE: 4, chess.BLACK: 3}
_EP_TARGET_RANK = {chess.WHITE: 5, chess.BLACK: 2}


def bitboards(board: chess.Board) -> tuple[np.ndarray, np.ndarray]:
    """White/black bitboards in white's frame, ordered pawn..king.

    Square 0 is a1 and bit 63 is h8, exactly like ``python-chess``.
    """
    white = [
        _bitboard(board, color=chess.WHITE, piece_type=piece_type)
        for piece_type in PIECE_ORDER
    ]
    black = [
        _bitboard(board, color=chess.BLACK, piece_type=piece_type)
        for piece_type in PIECE_ORDER
    ]
    return (
        np.array(white, dtype=np.uint64),
        np.array(black, dtype=np.uint64),
    )


def _bitboard(board: chess.Board, color: chess.Color, piece_type: int) -> int:
    total = 0
    for square in board.pieces(piece_type, color):
        total |= 1 << square
    return total


def meaningful_ep_square(board: chess.Board) -> int | None:
    """The ep square when a pseudo-legal ep capture exists, else None.

    This mirrors ``meaningfulEnPassant`` in ``src/core/zobrist.ts``: the
    target must sit on the capture rank and an adjacent pawn of the side
    to move must exist. Pinned pawns count as available, matching the
    core's position-identity rule.
    """
    ep = board.ep_square
    if ep is None:
        return None
    if chess.square_rank(ep) != _EP_TARGET_RANK[board.turn]:
        return None
    file = chess.square_file(ep)
    rank = _EP_PAWN_RANK[board.turn]
    for df in (-1, 1):
        candidate_file = file + df
        if 0 <= candidate_file < 8:
            candidate = chess.square(candidate_file, rank)
            if board.piece_at(candidate) == chess.Piece(chess.PAWN, board.turn):
                return ep
    return None


def encode_board(board: chess.Board) -> np.ndarray:
    """Encode a position as a float32 tensor of shape (18, 8, 8)."""
    planes = np.zeros((NUM_PLANES, 8, 8), dtype=np.float32)
    perspective = board.turn

    for square, piece in board.piece_map().items():
        file = chess.square_file(square)
        rank = chess.square_rank(square)
        if perspective == chess.BLACK:
            rank = 7 - rank
        plane = PIECE_ORDER.index(piece.piece_type)
        if piece.color != perspective:
            plane += 6
        planes[plane, rank, file] = 1.0

    planes[12, :, :] = 1.0

    opponent = not perspective
    for plane, (color, kingside) in enumerate(
        (
            (perspective, True),
            (perspective, False),
            (opponent, True),
            (opponent, False),
        ),
        start=13,
    ):
        if board.has_kingside_castling_rights(color) and kingside:
            planes[plane, :, :] = 1.0
        elif board.has_queenside_castling_rights(color) and not kingside:
            planes[plane, :, :] = 1.0

    ep = meaningful_ep_square(board)
    if ep is not None:
        planes[17, :, chess.square_file(ep)] = 1.0

    return planes


def action_index(move: chess.Move) -> int:
    """Map a move to its policy logit index: ((from*64)+to)*5 + promo."""
    try:
        promotion = PROMOTION_TO_INDEX[move.promotion]
    except KeyError as error:
        raise ValueError(f"invalid promotion: {move.promotion}") from error
    return ((move.from_square * 64) + move.to_square) * 5 + promotion


def action_to_move(index: int) -> chess.Move:
    """Inverse of :func:`action_index`; rejects out-of-range indices."""
    if not 0 <= index < NUM_ACTIONS:
        raise ValueError(f"action index out of range: {index}")
    promotion = index % 5
    square = index // 5
    move = chess.Move(
        from_square=square // 64,
        to_square=square % 64,
        promotion=INDEX_TO_PROMOTION[promotion],
    )
    return move
