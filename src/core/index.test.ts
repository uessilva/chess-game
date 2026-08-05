import { describe, expect, it } from 'vitest';

import { opposite, START_FEN } from './index';

describe('core placeholder', () => {
  it('flips the color', () => {
    expect(opposite('white')).toBe('black');
    expect(opposite('black')).toBe('white');
  });

  it('exposes the standard initial FEN', () => {
    expect(START_FEN).toContain(' w KQkq - 0 1');
  });
});
