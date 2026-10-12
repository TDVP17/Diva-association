/**
 * Professional sound effects synthesizer using the Web Audio API.
 * - Zero external assets or network latency.
 * - Designed to feel subtle, tactile, and premium (like iOS / Stripe / Apple Pay).
 * - Safe across SSR, browsers with autoplay restrictions, and muted settings.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * 1. Subtle tactile UI click / haptic tap sound.
 * Soft mechanical impulse with gentle low-pass rolloff. Feels like an iPhone physical tap.
 */
export function playUiTapSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(320, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.018);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.022);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.025);
  } catch {
    // Silently ignore audio playback failures
  }
}

/**
 * 2. Soft bubble pop notification chime.
 * Gentle rising two-tone chime for floating toast and notification delivery.
 */
export function playNotificationPopSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(540, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(840, ctx.currentTime + 0.06);

    gain.gain.setValueAtTime(0.09, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.13);
  } catch {
    // Silently ignore audio playback failures
  }
}

/**
 * 3. Warm, joyful payment confirmation chord.
 * Elegant major triad (C5, E5, G5) with smooth organic decay.
 * Reminiscent of successful Apple Pay / Stripe checkout confirmations.
 */
export function playSuccessChimeSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    const delays = [0, 0.04, 0.08];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delays[idx]);

      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime + delays[idx]);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delays[idx] + 0.55);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + delays[idx]);
      osc.stop(ctx.currentTime + delays[idx] + 0.6);
    });
  } catch {
    // Silently ignore audio playback failures
  }
}

/**
 * 4. Festive celebration shimmer sound.
 * Uplifting sparkle chime for "Ton tour" and milestone moments.
 */
export function playCelebrationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const notes = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      const startTime = ctx.currentTime + idx * 0.05;
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.5);
    });
  } catch {
    // Silently ignore audio playback failures
  }
}
