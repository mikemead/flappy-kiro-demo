/**
 * Pure PipeManager: scroll, spawn with spacing, clamp gap, despawn off-screen.
 *
 * Pure functions over plain data: no canvas, DOM, localStorage, Date.now, or
 * Math.random access. All randomness flows through the seeded RNG carried in
 * game state (see rng.js); each function that consumes randomness threads the
 * RNG and returns the advanced state. Inputs are treated as immutable.
 */

import { next } from './rng.js';

/**
 * A single scrolling obstacle with a vertical gap the ghost flies through.
 * @typedef {Object} Pipe
 * @property {number} x          Left edge (px).
 * @property {number} width      Pipe width (px).
 * @property {number} gapTop     Y of the top of the gap (px).
 * @property {number} gapHeight  Gap height (px); >= 1.5 * ghost height.
 * @property {boolean} scored    Whether this pipe has incremented the score.
 */

/**
 * Produce one pipe at `xLeft` with a randomized, margin-clamped gap position.
 *
 * The gap height comes from `config.pipes.gapHeight` (Req 4.4). The gap's
 * vertical position (`gapTop`) is randomized via the seeded RNG and clamped to
 * the valid range `[ceilingY + margin, groundY - margin - gapHeight]` so the
 * entire gap keeps at least `config.pipes.margin` pixels of clearance from both
 * the ceiling and the ground (Req 4.3, 4.6). The clamp is sound (the returned
 * `gapTop` always satisfies the bounds) and idempotent (clamping an already
 * valid value leaves it unchanged). When the valid range is empty (the play
 * area cannot fit the gap plus both margins) the lower bound wins, so the
 * result is still deterministic.
 *
 * Pure: does not mutate `rng`; the advanced RNG state is returned alongside the
 * new pipe.
 *
 * @param {number} xLeft  Left edge of the new pipe (px).
 * @param {Config} config  Injected config; reads `pipes.width`, `pipes.gapHeight`, `pipes.margin`.
 * @param {import('./rng.js').RngState} rng  Current RNG state (not mutated).
 * @param {{ width: number, height: number, ceilingY: number, groundY: number }} playArea  Play-area bounds.
 * @returns {{ pipe: Pipe, rng: import('./rng.js').RngState }} The spawned pipe and the advanced RNG state.
 */
export function spawnPipe(xLeft, config, rng, playArea) {
  const { width, gapHeight, margin } = config.pipes;

  const minGapTop = playArea.ceilingY + margin;
  const maxGapTop = playArea.groundY - margin - gapHeight;

  const { value, rng: nextRng } = next(rng);

  // Scale the random value in [0, 1) across the valid range, then clamp. The
  // span may be negative if the gap plus margins cannot fit; the clamp below
  // keeps the result sound in that degenerate case.
  const span = maxGapTop - minGapTop;
  const rawGapTop = minGapTop + value * span;
  const gapTop = clamp(rawGapTop, minGapTop, maxGapTop);

  const pipe = { x: xLeft, width, gapTop, gapHeight, scored: false };
  return { pipe, rng: nextRng };
}

/**
 * Clamp `n` into the inclusive range [lo, hi]. Sound even when `lo > hi`: the
 * lower bound takes precedence so the result is always well-defined.
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(n, lo, hi) {
  if (n < lo) {
    return lo;
  }
  if (n > hi) {
    return hi;
  }
  return n;
}

/**
 * Advance the pipe field by one step: scroll, spawn, and despawn.
 *
 * Behavior (Req 2.4, 4.1, 4.2, 4.5):
 * - **Scroll:** every pipe's left edge moves left by `config.pipes.speed * dt`
 *   (Req 2.4, 4.1).
 * - **Spawn:** new pipes are added to keep a constant left-edge-to-left-edge
 *   spacing of `config.pipes.spacing` (Req 4.2). With an empty field an initial
 *   pipe is created at the play area's right edge. Otherwise a new pipe is
 *   spawned at `lastPipe.x + spacing` once the rightmost pipe has scrolled far
 *   enough left that this position lies within the play area. A `while` loop
 *   covers a large `dt` that opens room for more than one new pipe in a single
 *   step. `spawnPipe` is used for creation so gap randomization/clamping and
 *   RNG threading are reused, and the RNG is threaded through every spawn.
 * - **Despawn:** any pipe whose right edge (`x + width`) has passed the play
 *   area's left boundary is removed within this same step (Req 4.5).
 *
 * Pure: inputs are not mutated. A new pipes array is returned (new pipe objects
 * are produced for scrolled/spawned pipes; surviving originals are preserved by
 * value), together with the advanced RNG state.
 *
 * @param {Pipe[]} pipes  Current pipes (not mutated).
 * @param {number} dt  Elapsed time for this step (s); expected non-negative.
 * @param {Config} config  Injected config; reads `pipes.speed`, `pipes.spacing`, `pipes.width`.
 * @param {import('./rng.js').RngState} rng  Current RNG state (not mutated).
 * @param {{ width: number, height: number, ceilingY: number, groundY: number }} playArea  Play-area bounds.
 * @returns {{ pipes: Pipe[], rng: import('./rng.js').RngState }} The next pipes and the advanced RNG state.
 */
export function stepPipes(pipes, dt, config, rng, playArea) {
  const { speed, spacing } = config.pipes;
  const dx = speed * dt;
  const leftBoundary = playArea.ceilingY;

  // Scroll surviving pipes left, dropping any that are now fully off-screen
  // (right edge at/past the left boundary) within this same step.
  const next = [];
  for (let i = 0; i < pipes.length; i += 1) {
    const pipe = pipes[i];
    const x = pipe.x - dx;
    if (x + pipe.width <= leftBoundary) {
      continue;
    }
    next.push({
      x,
      width: pipe.width,
      gapTop: pipe.gapTop,
      gapHeight: pipe.gapHeight,
      scored: pipe.scored,
    });
  }

  let advancedRng = rng;

  if (next.length === 0) {
    // Empty field: seed an initial pipe at the play area's right edge.
    const spawned = spawnPipe(playArea.width, config, advancedRng, playArea);
    advancedRng = spawned.rng;
    next.push(spawned.pipe);
  }

  // Maintain spacing: spawn the next pipe at lastPipe.x + spacing once that
  // position has come within the play area. A loop handles a large dt.
  let last = next[next.length - 1];
  while (last.x + spacing <= playArea.width) {
    const spawned = spawnPipe(last.x + spacing, config, advancedRng, playArea);
    advancedRng = spawned.rng;
    next.push(spawned.pipe);
    last = spawned.pipe;
  }

  return { pipes: next, rng: advancedRng };
}
