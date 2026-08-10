/**
 * Injectable move/capture sounds (task 2.5). Synthesizes short tones with the
 * Web Audio API — no audio assets, no new dependencies. `createSoundPlayer`
 * takes an injectable AudioContext factory so Vitest runs with a stub and
 * never a real AudioContext; when audio is unavailable (unsupported API,
 * autoplay policy, context creation failure) every call degrades to a silent
 * no-op and never throws.
 */

export interface SoundPlayer {
  /** Short "piece moves" blip, played on a non-capture committed move. */
  move(): void;
  /** Lower "capture" thud, played when the committed move captures. */
  capture(): void;
}

type AudioContextFactory = () => AudioContext | null;

function defaultCreateContext(): AudioContext | null {
  return typeof AudioContext !== 'undefined' ? new AudioContext() : null;
}

/**
 * A sound player that lazily creates its AudioContext on the first play —
 * by the time a move commits there has been a pointer gesture, so autoplay
 * policy is satisfied. Any failure path (context creation, oscillator
 * setup) disables the player and turns every later call into a no-op.
 */
export function createSoundPlayer(
  createContext: AudioContextFactory = defaultCreateContext,
): SoundPlayer {
  let context: AudioContext | null = null;
  let enabled = true;

  function ensureContext(): AudioContext | null {
    if (!enabled) {
      return null;
    }
    if (context === null) {
      try {
        context = createContext();
      } catch {
        enabled = false;
        return null;
      }
      if (context === null) {
        enabled = false;
        return null;
      }
    }
    return context;
  }

  /** One oscillator + gain-envelope tone, fully guarded against throwing. */
  function playTone(
    ctx: AudioContext,
    frequency: number,
    durationMs: number,
    volume: number,
    type: OscillatorType,
  ): void {
    try {
      const now = ctx.currentTime;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now);
      oscillator.stop(now + durationMs / 1000);
    } catch {
      enabled = false;
    }
  }

  return {
    move(): void {
      const ctx = ensureContext();
      if (ctx !== null) {
        playTone(ctx, 264, 70, 0.16, 'sine');
      }
    },
    capture(): void {
      const ctx = ensureContext();
      if (ctx !== null) {
        playTone(ctx, 150, 110, 0.22, 'triangle');
      }
    },
  };
}
