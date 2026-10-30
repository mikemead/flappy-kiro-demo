/**
 * Pure scoring: once-per-pipe increment via the `scored` flag.
 *
 * Scoring is a position comparison, not a collision/overlap test: a pipe is
 * counted when the ghost's leading (left) x has advanced past the pipe's
 * trailing (right) edge. A per-pipe `scored` boolean guarantees each pipe is
 * counted exactly once regardless of later movement.
 */

/**
 * Increment the score once for each pipe the ghost has newly passed and not
 * yet counted. Returns a new score and a new pipes array; pipes that are newly
 * counted are returned as new objects marked `scored: true`. Inputs are never
 * mutated.
 *
 * @param {number} score current score
 * @param {import('./pipes.js').Ghost | { x: number }} ghost ghost whose left
 *   edge is `ghost.x`
 * @param {Array<{ x: number, width: number, scored: boolean }>} pipes pipes to
 *   evaluate
 * @returns {{ score: number, pipes: Array<{ x: number, width: number, scored: boolean }> }}
 *   next score and pipes with newly-passed pipes flagged `scored`
 */
export function updateScore(score, ghost, pipes) {
  const ghostLeft = ghost.x;
  let nextScore = score;
  const nextPipes = new Array(pipes.length);

  for (let i = 0; i < pipes.length; i += 1) {
    const pipe = pipes[i];
    const trailingEdge = pipe.x + pipe.width;

    if (!pipe.scored && ghostLeft > trailingEdge) {
      nextScore += 1;
      nextPipes[i] = { ...pipe, scored: true };
    } else {
      nextPipes[i] = pipe;
    }
  }

  return { score: nextScore, pipes: nextPipes };
}
