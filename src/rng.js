/**
 * Seedable, pure RNG for reproducible randomness.
 *
 * All game randomness flows through this module so that, given the same seed,
 * the same sequence of values is produced on every run. Uses the well-known
 * mulberry32 algorithm: a 32-bit state PRNG that carries a single unsigned
 * 32-bit integer of state.
 *
 * Pure: no Math.random, no Date.now, no DOM/canvas/localStorage access. The
 * RngState is a plain serializable object so GameState stays serializable, and
 * `next` never mutates its input — it returns the advanced state.
 */

/**
 * Opaque, serializable RNG state carrying a single 32-bit unsigned integer.
 * @typedef {Object} RngState
 * @property {number} state  Current 32-bit unsigned integer state.
 */

/**
 * Create an RngState from a numeric seed.
 *
 * The seed is coerced to a 32-bit unsigned integer so that the resulting state
 * is well-defined for any finite numeric input.
 *
 * @param {number} seed  Numeric seed; coerced to a 32-bit unsigned integer.
 * @returns {RngState} A fresh, serializable RNG state.
 */
export function createRng(seed) {
  const numericSeed = Number.isFinite(seed) ? seed : 0;
  // >>> 0 coerces to an unsigned 32-bit integer.
  return { state: numericSeed >>> 0 };
}

/**
 * Produce the next pseudo-random value and the advanced RNG state.
 *
 * Does not mutate the passed `rng`; the advanced state is returned in the
 * result. Implements mulberry32.
 *
 * @param {RngState} rng  Current RNG state (not mutated).
 * @returns {{ value: number, rng: RngState }} A float in [0, 1) and the advanced state.
 */
export function next(rng) {
  // Advance the state by a fixed increment, then scramble it.
  let t = (rng.state + 0x6d2b79f5) >>> 0;
  let z = t;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  const value = ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  return { value, rng: { state: t } };
}
