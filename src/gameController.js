/**
 * GameController: owns the rAF loop, fixed-timestep accumulator, and the
 * state machine. Wires the side-effecting adapters (Renderer, InputHandler,
 * HighScoreStore) to the pure logic core.
 *
 * This is the only layer that knows about both the adapters and the pure
 * logic. It receives an already-loaded, validated `Config` via dependency
 * injection and never imports global config or browser singletons into the
 * pure logic. The controller holds the single source-of-truth `GameState`.
 *
 * Task 15.1 builds the initial GameState; task 15.2 adds the pure `update`
 * simulation step and the `routeFlap` state-machine transitions (module-level
 * exports below) plus the controller's `step`/`handleFlap` wrappers that layer
 * the centralized transition side effects (high-score persistence, store
 * refresh) over the pure logic. Task 15.10 adds the rAF loop: `start()`,
 * the fixed-timestep `tick(timestampMs)` accumulator, and `stop()`.
 *
 * See .kiro/specs/flappy-kiro/design.md (GameController, GameState/Ghost data
 * models, Config namespaces).
 */

import { createRng } from './rng.js';
import { initClouds, stepClouds } from './clouds.js';
import { stepGhost, applyFlap } from './physics.js';
import { stepPipes } from './pipes.js';
import { detectCollision } from './collision.js';
import { updateScore } from './scoring.js';

/**
 * @typedef {import('./config.js').Config} Config
 * @typedef {import('./physics.js').Ghost} Ghost
 * @typedef {import('./clouds.js').Cloud} Cloud
 * @typedef {import('./rng.js').RngState} RngState
 */

/**
 * Maximum per-frame delta (seconds) fed into the accumulator. A backgrounded
 * tab produces a huge `timestamp - lastTimestamp` gap; clamping it here caps the
 * number of catch-up fixed steps a single frame can run and avoids the
 * "spiral of death" where the simulation can never catch up. See design
 * (Game Loop and Timestep) and canvas-and-rendering steering.
 * @type {number}
 */
const MAX_FRAME_TIME = 0.25;

/**
 * Resolve a `requestAnimationFrame`-compatible scheduler, guarded so this
 * module imports cleanly under Node (where `requestAnimationFrame` is absent).
 * Adapters defer browser-API access to method-call time rather than module
 * load, so tests can import and unit-check the controller headless.
 * @returns {((cb: (ts: number) => void) => number)|null}
 */
function getRequestAnimationFrame() {
  return typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
}

/**
 * Resolve a `cancelAnimationFrame`-compatible canceller, guarded for Node.
 * @returns {((handle: number) => void)|null}
 */
function getCancelAnimationFrame() {
  return typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null;
}

/**
 * The rectangular play area the simulation runs in. Plain serializable data,
 * built from `config.world`.
 * @typedef {Object} PlayArea
 * @property {number} width     Play-area width (px).
 * @property {number} height    Play-area height (px).
 * @property {number} ceilingY  Ceiling y (px).
 * @property {number} groundY   Ground y (px).
 */

/**
 * The game lifecycle phase.
 * @typedef {'start'|'playing'|'gameover'} Phase
 */

/**
 * The single source of truth for the whole simulated world. A plain,
 * serializable object: no methods and no canvas/DOM references, so the whole
 * simulation can run headless under tests.
 * @typedef {Object} GameState
 * @property {Phase} phase            Current lifecycle phase.
 * @property {Ghost} ghost            The player ghost.
 * @property {Pipe[]} pipes           Active pipes (empty on a fresh state).
 * @property {Cloud[]} clouds         Decorative parallax clouds.
 * @property {number} score           Current run score.
 * @property {number} highScore       Persisted best score loaded from storage.
 * @property {boolean} saveFailed     True when a high-score write failed.
 * @property {number} gameOverAtMs    Timestamp Game Over was entered (grace period); 0 when not in Game Over.
 * @property {RngState} rng           Seedable RNG state carried for reproducibility.
 * @property {PlayArea} playArea      Play-area geometry derived from config.world.
 */

/**
 * Build the ghost at its centered Start position with no gravity/velocity.
 *
 * Pure derivation of plain data from config + play area. The ghost's x is fixed
 * on the left portion of the play area at `ghostStartXRatio * width`; its box is
 * centered vertically within the playable region (ceiling to ground); `vy` is 0
 * (Req 1.2). Shared by initial-state construction and the restart path so the
 * ghost always returns to the exact same start position (Req 8.6).
 *
 * @param {Config} config     Injected config; reads `world` and `visuals`.
 * @param {PlayArea} playArea Play-area geometry.
 * @returns {Ghost} A new ghost positioned for the Start state.
 */
export function makeStartGhost(config, playArea) {
  const { ghostStartXRatio } = config.world;
  const { ghostWidth, ghostHeight } = config.visuals;

  const x = ghostStartXRatio * playArea.width;
  // Center the ghost box vertically within the playable region.
  const y = playArea.ceilingY + (playArea.groundY - playArea.ceilingY - ghostHeight) / 2;

  return { x, y, width: ghostWidth, height: ghostHeight, vy: 0 };
}

/**
 * Advance the whole simulation by one fixed timestep. PURE: given the same
 * state, dt, and inputs (including the seeded RNG carried in state) it returns
 * the same next state. It reads no clocks, no DOM, and no `Math.random`; time
 * arrives via `dt` and `inputs.nowMs`, and all randomness flows through
 * `state.rng`. Inputs are treated as immutable — a new state object is returned.
 *
 * Phase gates behavior (design State Machine):
 * - **Outside `playing`** (`start` / `gameover`) the simulation is frozen: the
 *   ghost's position/velocity and every pipe's x are left unchanged (Property 1,
 *   Req 1.2, 6.4, 6.5). Clouds are stationary in `start` and frozen in
 *   `gameover`, so `stepClouds` is called with `moving=false` and positions do
 *   not change (Req 9.8). The RNG returned by `stepClouds` is threaded back.
 * - **In `playing`** gravity integrates the ghost, pipes scroll/spawn/despawn,
 *   clouds drift (`moving=true`), then collision is tested and scoring applied.
 *   The RNG advanced by pipes and clouds is stored back on the returned state.
 *
 * High-score reconciliation on entering Game Over is kept pure here: the
 * returned `highScore` is `max(score, highScore)` (the running maximum, Req 7.1,
 * 7.2 / Property 15). Persisting that value to storage is a side effect and is
 * deliberately NOT performed in `update`; the controller's `step` wrapper
 * detects the `playing -> gameover` entry and calls `HighScoreStore.save`,
 * setting `saveFailed` from the result. This keeps `update` a pure function of
 * data while centralizing the transition side effect in the controller
 * (design: "Transition side effects are centralized").
 *
 * @param {GameState} state   Current world state (not mutated).
 * @param {number} dt         Fixed timestep in seconds (non-negative).
 * @param {{ nowMs: number, config: Config }} inputs  Frame inputs: the current
 *   timestamp (used to stamp `gameOverAtMs`) and the injected config.
 * @returns {GameState} The next world state.
 */
export function update(state, dt, inputs) {
  const { config, nowMs } = inputs;

  // Non-playing phases freeze the ghost and pipes. Clouds are stationary in
  // `start` and frozen in `gameover`; passing moving=false leaves their x
  // unchanged while still threading the RNG for determinism.
  if (state.phase !== 'playing') {
    const { clouds, rng } = stepClouds(state.clouds, dt, false, state.playArea, state.rng);
    return { ...state, clouds, rng };
  }

  // Playing: integrate physics, then advance the world.
  const ghost = stepGhost(state.ghost, dt, config);

  const pipeStep = stepPipes(state.pipes, dt, config, state.rng, state.playArea);
  const cloudStep = stepClouds(state.clouds, dt, true, state.playArea, pipeStep.rng);

  // Collision ends the run this same step (Req 6.1-6.3). On entering Game Over,
  // gravity/scrolling stop by virtue of the phase gate above on the next step.
  if (detectCollision(ghost, pipeStep.pipes, state.playArea)) {
    const newHigh = Math.max(state.score, state.highScore);
    return {
      ...state,
      // Record the ghost's final fallen position and the advanced world, but
      // freeze further motion by switching phase.
      ghost,
      pipes: pipeStep.pipes,
      clouds: cloudStep.clouds,
      rng: cloudStep.rng,
      phase: 'gameover',
      gameOverAtMs: nowMs,
      // Running maximum; the controller performs the actual store.save side
      // effect when it detects this playing -> gameover entry.
      highScore: newHigh,
    };
  }

  // No collision: apply scoring over the scrolled pipes.
  const { score, pipes } = updateScore(state.score, ghost, pipeStep.pipes);

  return {
    ...state,
    ghost,
    pipes,
    clouds: cloudStep.clouds,
    rng: cloudStep.rng,
    score,
  };
}

/**
 * Route a flap intent into the state machine, returning the next state. PURE:
 * no clocks, DOM, or storage access — `nowMs` and the freshly-loaded
 * `storedHighScore` are supplied by the controller so grace-period timing and
 * the high-score refresh stay deterministic and testable. Inputs are treated as
 * immutable.
 *
 * Per-phase rules (design State Machine):
 * - **`start`**: a flap begins play — transition to `playing` and apply the
 *   upward flap velocity (Req 2.1, 2.3). Only a Start-state flap begins play
 *   (Req 2.2 / Property 6); flaps routed in other phases follow those phases'
 *   rules and never spuriously move `start -> playing`.
 * - **`playing`**: a flap sets the fixed upward velocity via `applyFlap`
 *   (Req 3.3). No phase change.
 * - **`gameover`**: gated by the grace period. If fewer than
 *   `config.timing.graceMs` ms have elapsed since `gameOverAtMs`, the flap is
 *   ignored and the state is returned unchanged (Req 6.6, 8.3). Once the grace
 *   has elapsed the flap performs a full restart (Req 5.4, 8.4-8.8): score 0,
 *   no pipes, the ghost returned to its initial centered position, the displayed
 *   high score refreshed from the stored value, phase `playing`, and the flap's
 *   upward velocity applied so play resumes immediately. `saveFailed` and
 *   `gameOverAtMs` are cleared on restart.
 *
 * A flap outside a phase that consumes it (i.e. the ignored grace case) leaves
 * the ghost's velocity unchanged (Req 3.4 / Property 4).
 *
 * @param {GameState} state            Current world state (not mutated).
 * @param {number} nowMs               Timestamp of the flap (ms), supplied by the controller.
 * @param {Config} config             Injected config; reads `timing.graceMs` and physics.
 * @param {number} storedHighScore     Freshly-loaded stored high score for the restart refresh.
 * @returns {GameState} The next world state.
 */
export function routeFlap(state, nowMs, config, storedHighScore) {
  switch (state.phase) {
    case 'start':
      // Begin play: enter Playing and apply the upward flap velocity.
      return {
        ...state,
        phase: 'playing',
        ghost: applyFlap(state.ghost, config),
      };

    case 'playing':
      // Active play: a flap just sets the upward velocity.
      return {
        ...state,
        ghost: applyFlap(state.ghost, config),
      };

    case 'gameover': {
      // Grace gate: ignore flaps within graceMs of entering Game Over.
      if (nowMs - state.gameOverAtMs < config.timing.graceMs) {
        return state;
      }

      // Full restart: reset score/pipes, reposition the ghost, refresh the
      // displayed high score from storage, re-enter Playing, and apply the flap.
      const ghost = makeStartGhost(config, state.playArea);
      return {
        ...state,
        phase: 'playing',
        ghost: applyFlap(ghost, config),
        pipes: [],
        score: 0,
        highScore: storedHighScore,
        saveFailed: false,
        gameOverAtMs: 0,
      };
    }

    default:
      return state;
  }
}

export class GameController {
  /**
   * @param {import('./renderer.js').Renderer} renderer         Draws a GameState to the canvas.
   * @param {import('./input.js').InputHandler} inputHandler    Normalizes input events into flap intents.
   * @param {import('./highScoreStore.js').HighScoreStore} highScoreStore  Persists/loads the high score; never throws.
   * @param {Config} config                                     Already-validated configuration (injected).
   * @param {RngState} [rng]                                    Optional RNG state override (for tests); defaults to a seed from config.world.rngSeed.
   */
  constructor(renderer, inputHandler, highScoreStore, config, rng) {
    /** @type {import('./renderer.js').Renderer} */
    this.renderer = renderer;
    /** @type {import('./input.js').InputHandler} */
    this.inputHandler = inputHandler;
    /** @type {import('./highScoreStore.js').HighScoreStore} */
    this.highScoreStore = highScoreStore;
    /** @type {Config} */
    this.config = config;
    /**
     * Optional injected RNG state. When provided it seeds the initial state
     * instead of `config.world.rngSeed`, which keeps tests reproducible.
     * @type {RngState|undefined}
     */
    this.injectedRng = rng;

    /**
     * The current world state. Initialized from the injected config so the
     * controller is ready to render the Start screen immediately.
     * @type {GameState}
     */
    this.state = this.createInitialState();

    /**
     * Fixed-timestep accumulator (seconds). Carries leftover sub-step time
     * between frames so physics advances in whole {@link Config} `timing.fixedDt`
     * steps regardless of the variable rAF cadence.
     * @type {number}
     */
    this.accumulator = 0;

    /**
     * Timestamp (ms) of the previous {@link GameController#tick}, or `null`
     * before the first frame. Used to compute the per-frame delta.
     * @type {number|null}
     */
    this.lastTimestampMs = null;

    /**
     * The handle returned by `requestAnimationFrame` for the scheduled next
     * frame, or `null` when the loop is not running. Stored so {@link
     * GameController#stop} can cancel it for clean teardown.
     * @type {number|null}
     */
    this.rafHandle = null;

    // Bind the rAF callback once so `this` is correct when the browser invokes
    // it and so the same reference can be scheduled/cancelled across frames.
    this.tick = this.tick.bind(this);
  }

  /**
   * Build the play-area geometry from `config.world`. Pure derivation of plain
   * data; no mutation and no I/O.
   * @returns {PlayArea}
   */
  createPlayArea() {
    const { width, height, ceilingY, groundY } = this.config.world;
    return { width, height, ceilingY, groundY };
  }

  /**
   * Build the ghost at its centered Start position with no gravity/velocity.
   *
   * The ghost's x is fixed on the left portion of the play area at
   * `ghostStartXRatio * width`; its box is centered vertically within the
   * playable region (ceiling to ground); `vy` is 0 (Req 1.2).
   *
   * @param {PlayArea} playArea  Play-area geometry.
   * @returns {Ghost} A new ghost positioned for the Start state.
   */
  createStartGhost(playArea) {
    return makeStartGhost(this.config, playArea);
  }

  /**
   * Construct the initial `GameState` for the Start phase from the injected,
   * already-validated `Config`.
   *
   * - phase: `'start'` (shown on load, Req 1.1).
   * - score: 0 (Req 1.4).
   * - ghost: centered with no gravity/velocity (Req 1.2).
   * - highScore / saveFailed: loaded via the injected HighScoreStore; a
   *   missing/invalid value loads as 0 and a storage read that threw is
   *   reflected in `saveFailed` while the game still shows 0 and stays in Start
   *   (Req 1.5, 1.6, 1.7).
   * - rng: the injected RNG state when provided, otherwise seeded from
   *   `config.world.rngSeed` (reproducible randomness).
   * - playArea: derived from `config.world`.
   * - pipes: empty; clouds: initialized via `initClouds`; gameOverAtMs: 0.
   *
   * Returns a plain serializable object with no methods or canvas/DOM refs.
   *
   * @returns {GameState}
   */
  createInitialState() {
    const playArea = this.createPlayArea();
    const ghost = this.createStartGhost(playArea);

    // Load the persisted high score. The store never throws and reports
    // whether the read succeeded via `ok`.
    const { value: highScore, ok } = this.highScoreStore.load();

    // Seed the RNG from config unless a state was injected (tests).
    const seededRng = this.injectedRng ?? createRng(this.config.world.rngSeed);

    // Initialize the decorative parallax clouds, threading the RNG through.
    const { clouds, rng } = initClouds(this.config, playArea, seededRng);

    return {
      phase: 'start',
      ghost,
      pipes: [],
      clouds,
      score: 0,
      highScore,
      // A failed storage read (ok === false) is surfaced so the UI can show it;
      // a successful read (including an absent/invalid value) is not a failure.
      saveFailed: !ok,
      gameOverAtMs: 0,
      rng,
      playArea,
    };
  }

  /**
   * Advance the simulation by one fixed step and perform any transition side
   * effect centralized in the controller.
   *
   * The pure {@link update} computes the next state (including the running-max
   * high-score reconciliation). This wrapper detects the `playing -> gameover`
   * entry and, only when the run's score exceeds the previous high score,
   * persists the new high score via the injected store — the single side effect
   * of entering Game Over (design: "Transition side effects are centralized").
   * A failed write is non-disruptive: the in-memory high score is kept and
   * `saveFailed` is set so the UI can indicate it (Req 7.6). `update` itself
   * stays pure; this method is the only place storage is written during a step.
   *
   * @param {GameState} state  Current state (not mutated).
   * @param {number} dt        Fixed timestep (s).
   * @param {number} nowMs     Current timestamp (ms) for stamping Game Over.
   * @returns {GameState} The next state.
   */
  step(state, dt, nowMs) {
    const next = update(state, dt, { config: this.config, nowMs });

    // Detect entering Game Over this step and reconcile/persist the high score.
    if (state.phase === 'playing' && next.phase === 'gameover') {
      if (state.score > state.highScore) {
        const { ok } = this.highScoreStore.save(next.highScore);
        if (!ok) {
          return { ...next, saveFailed: true };
        }
      }
    }

    return next;
  }

  /**
   * Begin the game: refresh the persisted high score into the current state,
   * ensure the Start phase, reset the loop's timing bookkeeping, and start the
   * rAF loop.
   *
   * The high score is re-read from the injected store here (the store never
   * throws and degrades to 0 on failure) so the Start screen reflects the
   * latest persisted best even if the store changed since construction; a
   * failed read is surfaced via `saveFailed` while the game still shows 0 and
   * stays in Start (Req 1.5-1.7). The initial `GameState` built in the
   * constructor is reused — only the high-score fields and phase are
   * reconciled — so the ghost's centered start position and seeded RNG are
   * preserved.
   *
   * The rAF handle is stored so {@link GameController#stop} can cancel the loop
   * for clean teardown. When `requestAnimationFrame` is unavailable (e.g. under
   * Node) the loop simply does not schedule, leaving the state ready for a
   * manual `tick` in tests.
   *
   * Requirements: 1.5, 1.6, 1.7, 2.1, 8.1.
   * @returns {void}
   */
  start() {
    // Refresh the displayed high score from storage; the store never throws.
    const { value: highScore, ok } = this.highScoreStore.load();
    this.state = {
      ...this.state,
      phase: 'start',
      highScore,
      saveFailed: !ok,
    };

    // Reset loop timing so the first tick establishes the baseline timestamp
    // rather than producing a huge first delta.
    this.accumulator = 0;
    this.lastTimestampMs = null;

    const raf = getRequestAnimationFrame();
    if (raf !== null) {
      this.rafHandle = raf(this.tick);
    }
  }

  /**
   * The `requestAnimationFrame` callback: advance the simulation on a fixed
   * timestep decoupled from the variable frame cadence, render the latest
   * state, then schedule the next frame.
   *
   * Steps (design Game Loop and Timestep / canvas-and-rendering steering):
   * 1. Compute `frameTime = timestampMs - lastTimestampMs` and convert ms to
   *    seconds. On the first frame (`lastTimestampMs === null`) the delta is 0.
   * 2. Clamp `frameTime` to `[0, MAX_FRAME_TIME]` BEFORE accumulating so a
   *    backgrounded tab cannot trigger a catch-up spiral.
   * 3. Add to the accumulator and consume whole `config.timing.fixedDt` steps,
   *    calling {@link GameController#step} (which delegates to the pure
   *    {@link update} with `dt = fixedDt`) for each; leftover time stays in the
   *    accumulator for the next frame. This keeps physics frame-rate
   *    independent — motion is never scaled by the raw rAF delta.
   * 4. Render the resulting state once per frame.
   * 5. Schedule the next frame and store its handle.
   *
   * `timestampMs` (the rAF timestamp) is passed through as `nowMs` into the
   * step so grace-period/Game-Over stamping stays deterministic; it is kept out
   * of the pure {@link update}, which receives it only via `inputs.nowMs`.
   *
   * Requirements: 2.1, 3.3, 5.2, 8.1, 8.8.
   * @param {number} timestampMs The rAF timestamp in milliseconds.
   * @returns {void}
   */
  tick(timestampMs) {
    const fixedDt = this.config.timing.fixedDt;

    // Per-frame delta in seconds; 0 on the very first frame.
    const rawFrameTime =
      this.lastTimestampMs === null ? 0 : (timestampMs - this.lastTimestampMs) / 1000;
    this.lastTimestampMs = timestampMs;

    // Clamp before accumulating to avoid the spiral of death.
    const frameTime = Math.min(Math.max(rawFrameTime, 0), MAX_FRAME_TIME);
    this.accumulator += frameTime;

    // Consume whole fixed steps; leftover remains for the next frame.
    while (this.accumulator >= fixedDt) {
      this.state = this.step(this.state, fixedDt, timestampMs);
      this.accumulator -= fixedDt;
    }

    // Render the latest simulated state once per frame.
    this.renderer.render(this.state);

    // Schedule the next frame.
    const raf = getRequestAnimationFrame();
    if (raf !== null) {
      this.rafHandle = raf(this.tick);
    }
  }

  /**
   * Stop the rAF loop and clear the stored handle, for clean teardown and
   * deterministic tests. Safe to call when the loop is not running. Does not
   * detach input listeners (that is the InputHandler's lifecycle) or reset the
   * current state.
   * @returns {void}
   */
  stop() {
    if (this.rafHandle !== null) {
      const cancel = getCancelAnimationFrame();
      if (cancel !== null) {
        cancel(this.rafHandle);
      }
      this.rafHandle = null;
    }
  }

  /**
   * Route a flap into the state machine. Reads the freshly-stored high score
   * from the injected store (so a restart shows the latest persisted best) and
   * delegates the actual transition to the pure {@link routeFlap}, which keeps
   * grace-period timing and the reset deterministic. The store read is the only
   * side effect; the transition logic stays pure.
   *
   * @param {number} nowMs  Timestamp of the flap (ms), supplied by the loop.
   */
  handleFlap(nowMs) {
    // Refresh the displayed high score from storage for the restart path; the
    // store never throws and degrades to 0 on failure.
    const { value: storedHighScore } = this.highScoreStore.load();
    this.state = routeFlap(this.state, nowMs, this.config, storedHighScore);
  }
}
