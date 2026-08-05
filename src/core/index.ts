export type Color = 'white' | 'black';

export function opposite(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

export const START_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
