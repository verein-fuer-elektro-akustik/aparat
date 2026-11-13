// Small DSP helpers shared by modules. Not modules themselves.

// Trapezoidal state variable filter. g = tan(pi * f / sr), k = damping
// (2 = no resonance, near 0 = self-oscillation). Results in s.lp, s.bp, s.hp.
export const svf = () => ({ ic1: 0, ic2: 0, lp: 0, bp: 0, hp: 0 });

export function svfTick(s, x, g, k) {
  const a1 = 1 / (1 + g * (g + k));
  const a2 = g * a1;
  const a3 = g * a2;
  const v3 = x - s.ic2;
  const v1 = a1 * s.ic1 + a2 * v3;
  const v2 = s.ic2 + a2 * s.ic1 + a3 * v3;
  s.ic1 = 2 * v1 - s.ic1;
  s.ic2 = 2 * v2 - s.ic2;
  if (s.ic1 < 1e-20 && s.ic1 > -1e-20) s.ic1 = 0;
  if (s.ic2 < 1e-20 && s.ic2 > -1e-20) s.ic2 = 0;
  s.lp = v2;
  s.bp = v1;
  s.hp = x - k * v1 - v2;
}

export const tanG = (f, sr) => Math.tan((Math.PI * Math.min(f, sr * 0.45)) / sr);

// xorshift white noise in -1..1, state is an object with a seed field x
export const seed = () => (Math.random() * 0x7fffffff) | 1;

export function white(s) {
  s.x ^= s.x << 13;
  s.x ^= s.x >>> 17;
  s.x ^= s.x << 5;
  return (s.x | 0) / 2147483648;
}

// one-pole coefficient for a time constant in seconds
export const pole = (t, sr) => 1 - Math.exp(-1 / (t * sr));
