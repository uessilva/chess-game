import { describe, expect, it, vi } from 'vitest';

import { createSoundPlayer } from './sounds';
import type { SoundPlayer } from './sounds';

/** A fake Web Audio graph recording every oscillator/gain call. */
function createFakeAudioContext(): {
  ctx: AudioContext;
  frequencies: number[];
  starts: { count: number };
} {
  const frequencies: number[] = [];
  const starts = { count: 0 };
  const oscillator = {
    set type(value: string) {
      void value;
    },
    frequency: {
      setValueAtTime(value: number) {
        frequencies.push(value);
      },
    },
    connect: vi.fn(),
    start: vi.fn(() => {
      starts.count++;
    }),
    stop: vi.fn(),
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
  const ctx = {
    currentTime: 1,
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
    destination: {},
  } as unknown as AudioContext;
  return { ctx, frequencies, starts };
}

describe('createSoundPlayer', () => {
  it('synthesizes a distinct tone for move and capture on a real-ish graph', () => {
    const { ctx, frequencies, starts } = createFakeAudioContext();
    const player = createSoundPlayer(() => ctx);

    player.move();
    player.capture();

    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    expect(ctx.createGain).toHaveBeenCalledTimes(2);
    expect(starts.count).toBe(2);
    // The two sounds are distinct (different frequencies).
    expect(frequencies).toHaveLength(2);
    expect(frequencies[0]).not.toBe(frequencies[1]);
  });

  it('plays the same tone twice without re-creating the context', () => {
    const { ctx } = createFakeAudioContext();
    const createContext = vi.fn(() => ctx);
    const player = createSoundPlayer(createContext);

    player.move();
    player.move();
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('degrades to silent no-ops when the context factory returns null', () => {
    const player = createSoundPlayer(() => null);
    expect(() => {
      player.move();
      player.capture();
      player.move();
    }).not.toThrow();
  });

  it('degrades to silent no-ops when the context factory throws', () => {
    const player = createSoundPlayer(() => {
      throw new Error('AudioContext unavailable');
    });
    expect(() => {
      player.capture();
      player.move();
    }).not.toThrow();
  });

  it('disables after a bad first context so later calls stay silent', () => {
    const createContext = vi
      .fn<() => AudioContext | null>()
      .mockImplementation(() => {
        throw new Error('boom');
      });
    const player = createSoundPlayer(createContext);

    player.move();
    player.move();
    player.capture();
    expect(createContext).toHaveBeenCalledTimes(1); // no retry storm
  });

  it('keeps every player call a silent no-op when a play throws mid-tone', () => {
    const bad = {
      currentTime: 1,
      createOscillator: vi.fn(() => {
        throw new Error('oscillator failed');
      }),
      createGain: vi.fn(),
      destination: {},
    } as unknown as AudioContext;
    const player: SoundPlayer = createSoundPlayer(() => bad);
    expect(() => player.move()).not.toThrow();
    expect(() => player.capture()).not.toThrow();
  });
});
