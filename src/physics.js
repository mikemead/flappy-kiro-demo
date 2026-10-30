/**
 * Pure ghost physics: gravity integration, terminal velocity, flap velocity.
 *
 * All functions are pure: they read every constant from the injected `Config`,
 * treat the incoming ghost as immutable, and return a new ghost object. No
 * canvas, DOM, localStorage, Math.random, or Date.now access. Up is negative y
 * in screen coordinates.
 */

/**
 * Plain, serializable ghost data. No methods, no canvas references.
 * @typedef {Object} Ghost
 * @property {number} x       Left edge (px); fixed during play.
 * @property {number} y       Top edge (px).
 * @property {number} width   Width (px).
 * @property {number} height  Height (px).
 * @property {number} vy      Vertical velocity (px/s); up is negative.
 */

/**
 * Advance the ghost by one timestep: apply gravity, clamp to terminal fall
 * speed, then integrate position. Returns a new ghost; does not mutate input.
 *
 * The vertical velocity becomes `min(vy + gravity * dt, maxFallSpeed)` and the
 * top edge is integrated with the clamped velocity (`y + vy * dt`).
 *
 * @param {Ghost} ghost    Current ghost (not mutated).
 * @param {number} dt      Timestep in seconds (non-negative).
 * @param {import('./config.js').Config} config  Injected config.
 * @returns {Ghost} A new ghost with updated velocity and position.
 */
export function stepGhost(ghost, dt, config) {
  const { gravity, maxFallSpeed } = config.physics;
  const vy = Math.min(ghost.vy + gravity * dt, maxFallSpeed);
  return {
    ...ghost,
    vy,
    y: ghost.y + vy * dt,
  };
}

/**
 * Apply a flap: set the vertical velocity to the fixed upward value
 * `-flapVelocity`, regardless of the ghost's prior velocity. Returns a new
 * ghost; does not mutate input.
 *
 * @param {Ghost} ghost    Current ghost (not mutated).
 * @param {import('./config.js').Config} config  Injected config.
 * @returns {Ghost} A new ghost with the upward flap velocity applied.
 */
export function applyFlap(ghost, config) {
  return {
    ...ghost,
    vy: -config.physics.flapVelocity,
  };
}
