/**
 * Pure CloudSystem: parallax drift, recycle, stationary in Start.
 *
 * Clouds are a purely decorative parallax layer. This module creates the
 * initial set of clouds and advances them each step. It is pure: it operates
 * only on plain data and the injected `Config`, never touches the canvas, DOM,
 * `localStorage`, `Date.now`, `Math.random`, or `requestAnimationFrame`, and
 * returns new values rather than mutating its inputs. All randomness flows
 * through the seedable RNG threaded in and returned advanced.
 *
 * See .kiro/specs/flappy-kiro/design.md (CloudSystem, Cloud data model).
 */

import { next } from './rng.js';

/**
 * A single decorative background cloud. Plain serializable data, no methods.
 * @typedef {Object} Cloud
 * @property {number} x       Left edge (px).
 * @property {number} y       Top edge (px).
 * @property {number} width   Width (px).
 * @property {number} height  Height (px).
 * @property {number} speed   Drift speed (px/s); strictly less than pipes.speed.
 * @property {number} alpha   Opacity in [config.clouds.minAlpha, config.clouds.maxAlpha] (0.3-0.7).
 */

/**
 * The rectangular play area the clouds live in. Plain data.
 * @typedef {Object} PlayArea
 * @property {number} width     Play-area width (px).
 * @property {number} height    Play-area height (px).
 * @property {number} ceilingY  Ceiling y (px).
 * @property {number} groundY   Ground y (px).
 */

/**
 * Map a float in [0, 1) onto the inclusive range [min, max].
 * @param {number} t    Value in [0, 1).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function lerp(t, min, max) {
  return min + t * (max - min);
}

/**
 * Create the initial set of clouds for a new game.
 *
 * Produces `config.clouds.count` clouds (which the config guarantees is >= 2),
 * each with:
 * - an opacity in `[config.clouds.minAlpha, config.clouds.maxAlpha]` (0.3-0.7),
 * - a drift speed in `[config.clouds.minSpeed, config.clouds.maxSpeed]`, every
 *   value strictly less than `config.pipes.speed`, and
 * - at least two distinct drift speeds for parallax: the first cloud is pinned
 *   to `minSpeed` and the second to `maxSpeed` (which the config guarantees
 *   differ), so distinctness holds regardless of the RNG draws.
 *
 * Placement and per-cloud variation use the seeded RNG, which is threaded
 * through and returned advanced. Pure: does not mutate its inputs.
 *
 * @param {import('./config.js').Config} config  Injected configuration.
 * @param {PlayArea} playArea                    Play area geometry.
 * @param {import('./rng.js').RngState} rng       Current RNG state (not mutated).
 * @returns {{ clouds: Cloud[], rng: import('./rng.js').RngState }}
 */
export function initClouds(config, playArea, rng) {
  const { count, minSpeed, maxSpeed, minAlpha, maxAlpha } = config.clouds;

  // Clouds drift within the sky above the ground. Keep their footprint a
  // modest fraction of the play area so several can coexist without filling it.
  const cloudWidth = playArea.width * 0.28;
  const cloudHeight = playArea.height * 0.12;
  const bandTop = playArea.ceilingY;
  const bandBottom = Math.max(playArea.ceilingY, playArea.groundY - cloudHeight);

  const clouds = [];
  let currentRng = rng;

  for (let i = 0; i < count; i += 1) {
    // Horizontal placement spread across (and a little past) the play area so
    // the field looks populated from the first frame.
    const xDraw = next(currentRng);
    currentRng = xDraw.rng;
    const x = lerp(xDraw.value, 0, playArea.width);

    // Vertical placement within the sky band.
    const yDraw = next(currentRng);
    currentRng = yDraw.rng;
    const y = lerp(yDraw.value, bandTop, bandBottom);

    // Opacity within the configured alpha range.
    const alphaDraw = next(currentRng);
    currentRng = alphaDraw.rng;
    const alpha = lerp(alphaDraw.value, minAlpha, maxAlpha);

    // Drift speed. Pin the first two clouds to the extremes to guarantee at
    // least two distinct speeds; vary the rest within the range.
    let speed;
    if (i === 0) {
      speed = minSpeed;
    } else if (i === 1) {
      speed = maxSpeed;
    } else {
      const speedDraw = next(currentRng);
      currentRng = speedDraw.rng;
      speed = lerp(speedDraw.value, minSpeed, maxSpeed);
    }

    clouds.push({ x, y, width: cloudWidth, height: cloudHeight, speed, alpha });
  }

  return { clouds, rng: currentRng };
}

/**
 * Advance the clouds by one step.
 *
 * When `moving` is true (Playing phase), each cloud drifts left by
 * `speed * dt`. A cloud whose right edge has moved fully past the left edge of
 * the play area is recycled to the right edge (its left edge placed at the play
 * area's right edge), preserving the cloud count so clouds are always present.
 * When `moving` is false (Start phase, or a frozen Game Over), positions are
 * left unchanged.
 *
 * Pure: returns a new clouds array (and new cloud objects for moved clouds)
 * without mutating the inputs. The RNG is threaded through and returned; it is
 * currently advanced only if future recycling needs randomness, so callers must
 * always use the returned `rng`.
 *
 * @param {Cloud[]} clouds                        Current clouds (not mutated).
 * @param {number} dt                             Elapsed time for this step (s).
 * @param {boolean} moving                        Whether clouds should drift.
 * @param {PlayArea} playArea                     Play area geometry.
 * @param {import('./rng.js').RngState} rng       Current RNG state (not mutated).
 * @returns {{ clouds: Cloud[], rng: import('./rng.js').RngState }}
 */
export function stepClouds(clouds, dt, moving, playArea, rng) {
  // Stationary phases leave positions untouched; return the inputs as-is.
  if (!moving) {
    return { clouds, rng };
  }

  const leftEdge = 0;
  const stepped = new Array(clouds.length);
  for (let i = 0; i < clouds.length; i += 1) {
    const cloud = clouds[i];
    let x = cloud.x - cloud.speed * dt;

    // Recycle once the cloud is fully past the left edge: re-enter at the right
    // edge, preserving the cloud count so clouds are always present.
    if (x + cloud.width < leftEdge) {
      x = playArea.width;
    }

    stepped[i] = { ...cloud, x };
  }

  return { clouds: stepped, rng };
}
