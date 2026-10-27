/** xorshift32-v1, with FNV-1a over UTF-16 code units for named stream derivation.
 * Algorithm/version/seed are part of replay identity, not a security mechanism. */
export const RNG_VERSION = 'xorshift32-fnv1a-utf16-v1';
const SPACE = 0x100000000;
const SAMPLE_SPACE = SPACE - 1; // xorshift32 visits every NONZERO uint32 exactly once.
export function normalizeSeed(seed: number): number {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed >= SPACE) throw new Error('Seed must be uint32');
  return seed === 0 ? 0x6d2b79f5 : seed >>> 0;
}
export function deriveSeed(seed: number, namespace: string): number {
  let hash = (2166136261 ^ normalizeSeed(seed)) >>> 0;
  for (let i = 0; i < namespace.length; i++) hash = Math.imul(hash ^ namespace.charCodeAt(i), 16777619) >>> 0;
  return normalizeSeed(hash);
}
export function nextUint32(state: number): { state: number; value: number } {
  let x = normalizeSeed(state);
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  x >>>= 0;
  return { state: x, value: x };
}
export function randomInt(state: number, maxExclusive: number): { state: number; value: number } {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > SAMPLE_SPACE) throw new Error('Invalid sampling range');
  const limit = SAMPLE_SPACE - (SAMPLE_SPACE % maxExclusive);
  let draw;
  do { draw = nextUint32(state); state = draw.state; } while (draw.value - 1 >= limit);
  return { state, value: (draw.value - 1) % maxExclusive };
}
export function weightedIndex(state: number, weights: readonly number[]): { state: number; value: number } {
  if (weights.length === 0 || weights.some(w => !Number.isSafeInteger(w) || w < 0)) throw new Error('Invalid weights');
  const total = weights.reduce((a, b) => a + b, 0);
  if (total < 1 || total > SAMPLE_SPACE) throw new Error('Invalid weight total');
  const draw = randomInt(state, total);
  let value = draw.value;
  for (let i = 0; i < weights.length; i++) { if (value < weights[i]) return { state: draw.state, value: i }; value -= weights[i]; }
  throw new Error('Unreachable weighted sample');
}
