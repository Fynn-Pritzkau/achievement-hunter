/**
 * Short chime for earned milestones (the app's own achievements), synthesized
 * with Web Audio so no sound file ships. The context lives only while it plays.
 */
export function playMilestoneSound(volume = 0.25) {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  const out = ctx.createGain();
  out.gain.value = volume;
  out.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.02;
  // Rising fifth plus octave (E6, B6, E7): bright, short, unlike the Windows toast sound.
  const notes: [freq: number, at: number, len: number][] = [
    [1318.5, 0, 0.18],
    [1975.5, 0.08, 0.22],
    [2637, 0.16, 0.38],
  ];
  for (const [freq, at, len] of notes) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, t0 + at);
    env.gain.linearRampToValueAtTime(1, t0 + at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + at + len);
    osc.connect(env).connect(out);
    osc.start(t0 + at);
    osc.stop(t0 + at + len + 0.02);
  }
  setTimeout(() => void ctx.close(), 800);
}
