/**
 * Pure collision detection via axis-aligned bounding boxes (AABB).
 *
 * All functions are pure: they read only plain data, treat inputs as
 * immutable, and perform no canvas, DOM, localStorage, Math.random, or
 * Date.now access. Every game body is a rectangle, so collision is exact
 * rectangle overlap — no circle or polygon math needed.
 */

/**
 * Axis-aligned rectangle, with edges in screen coordinates (y grows down).
 * @typedef {Object} Box
 * @property {number} left    Left edge (px).
 * @property {number} top     Top edge (px).
 * @property {number} right   Right edge (px).
 * @property {number} bottom  Bottom edge (px).
 */

/**
 * The play area's fixed boundaries.
 * @typedef {Object} PlayArea
 * @property {number} ceilingY  Top boundary y (px).
 * @property {number} groundY   Bottom boundary y (px).
 */

/**
 * Axis-aligned bounding-box overlap test. Uses strict inequalities so merely
 * touching edges (shared boundary, zero-area intersection) is not an overlap.
 *
 * @param {Box} a First rectangle.
 * @param {Box} b Second rectangle.
 * @returns {boolean} True when the rectangles share interior area.
 */
export function aabbOverlap(a, b) {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

/**
 * Detect whether the ghost collides with a boundary or any pipe segment.
 *
 * Checks are ordered cheapest-first and short-circuit on the first hit:
 *   1. Boundaries: the ghost reaching the ceiling (`top <= ceilingY`) or the
 *      ground (`bottom >= groundY`) is a collision (inclusive `<=` / `>=`).
 *   2. Pipes: the ghost box overlapping either the upper or lower segment of
 *      any pipe (strict `<` / `>` via {@link aabbOverlap}).
 *
 * Boxes are derived from plain fields on demand rather than stored. An index
 * for-loop walks the pipes array (hot path); a broad-phase guard skips any
 * pipe whose x span cannot overlap the ghost's x span before the full test.
 *
 * @param {import('./physics.js').Ghost} ghost  Current ghost (not mutated).
 * @param {import('./pipes.js').Pipe[]} pipes    Active pipes (not mutated).
 * @param {PlayArea} playArea                    Play-area boundaries.
 * @returns {boolean} True on the first collision found, otherwise false.
 */
export function detectCollision(ghost, pipes, playArea) {
  const ghostTop = ghost.y;
  const ghostBottom = ghost.y + ghost.height;

  // 1. Boundaries (cheapest): reaching ceiling or ground is a collision.
  if (ghostTop <= playArea.ceilingY || ghostBottom >= playArea.groundY) {
    return true;
  }

  // 2. Pipes: derive ghost box once, test each pipe's two segments.
  const ghostLeft = ghost.x;
  const ghostRight = ghost.x + ghost.width;
  const groundY = playArea.groundY;

  for (let i = 0; i < pipes.length; i++) {
    const pipe = pipes[i];
    const pipeLeft = pipe.x;
    const pipeRight = pipe.x + pipe.width;

    // Broad-phase: skip pipes whose x span cannot overlap the ghost's.
    if (pipeLeft >= ghostRight || pipeRight <= ghostLeft) {
      continue;
    }

    // Upper segment: ceiling (y = 0) down to the top of the gap.
    const upperBottom = pipe.gapTop;
    if (
      ghostLeft < pipeRight &&
      ghostRight > pipeLeft &&
      ghostTop < upperBottom &&
      ghostBottom > 0
    ) {
      return true;
    }

    // Lower segment: bottom of the gap down to the ground.
    const lowerTop = pipe.gapTop + pipe.gapHeight;
    if (
      ghostLeft < pipeRight &&
      ghostRight > pipeLeft &&
      ghostTop < groundY &&
      ghostBottom > lowerTop
    ) {
      return true;
    }
  }

  return false;
}
