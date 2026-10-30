/**
 * Central source of truth for all game constants and parameters.
 * See .kiro/specs/flappy-kiro/design.md (Config section).
 *
 * This module exposes the deeply frozen `DEFAULT_CONFIG` baseline and the pure
 * `validateConfig` range/type checker. No DOM, canvas, or localStorage access.
 */

/**
 * @typedef {Object} PhysicsConfig
 * @property {number} gravity        Downward acceleration (px/s^2), range [800, 1500].
 * @property {number} maxFallSpeed   Terminal fall velocity (px/s); design baseline 600.
 * @property {number} flapVelocity   Upward flap velocity magnitude (px/s), range [300, 500].
 */

/**
 * @typedef {Object} PipesConfig
 * @property {number} speed      Scroll speed (px/s), range [100, 300].
 * @property {number} spacing    Left-edge-to-left-edge spacing (px), range [150, 400].
 * @property {number} gapHeight  Vertical gap height (px); must be >= 1.5 * visuals.ghostHeight.
 * @property {number} width      Pipe width (px).
 * @property {number} margin     Minimum gap margin from ceiling/ground (px); baseline 20.
 */

/**
 * @typedef {Object} CloudsConfig
 * @property {number} count     Number of clouds; must be >= 2.
 * @property {number} minSpeed  Minimum drift speed (px/s); must be < pipes.speed.
 * @property {number} maxSpeed  Maximum drift speed (px/s); must be < pipes.speed and != minSpeed.
 * @property {number} minAlpha  Minimum opacity, range [0.3, 0.7].
 * @property {number} maxAlpha  Maximum opacity, range [0.3, 0.7].
 */

/**
 * @typedef {Object} ScoringConfig
 * @property {number} increment  Points added per passed pipe.
 */

/**
 * @typedef {Object} TimingConfig
 * @property {number} fixedDt   Fixed physics timestep (s).
 * @property {number} graceMs   Game-over restart grace period (ms); must equal 500.
 */

/**
 * @typedef {Object} VisualsConfig
 * @property {string} skyColor
 * @property {string} pipeColor
 * @property {string} ghostColor
 * @property {string} borderColor
 * @property {string} scoreBarColor
 * @property {number} ghostWidth
 * @property {number} ghostHeight
 * @property {number} borderRadius
 * @property {number} scoreBarHeight
 */

/**
 * @typedef {Object} StorageConfig
 * @property {string} highScoreKey  Non-empty localStorage key.
 */

/**
 * @typedef {Object} WorldConfig
 * @property {number} width             Play-area width (px); must be > 0.
 * @property {number} height            Play-area height (px); must be > 0.
 * @property {number} ceilingY          Ceiling y (px); must be < groundY.
 * @property {number} groundY           Ground y (px).
 * @property {number} ghostStartXRatio  Ghost start x as a ratio of width; range [0, 1].
 * @property {number} rngSeed           Default seed for the reproducible RNG.
 */

/**
 * @typedef {Object} RenderConfig
 * @property {string[]} layerOrder  Non-empty back-to-front draw order.
 */

/**
 * @typedef {Object} Config
 * @property {PhysicsConfig} physics
 * @property {PipesConfig} pipes
 * @property {CloudsConfig} clouds
 * @property {ScoringConfig} scoring
 * @property {TimingConfig} timing
 * @property {VisualsConfig} visuals
 * @property {StorageConfig} storage
 * @property {WorldConfig} world
 * @property {RenderConfig} render
 */

/**
 * Baseline configuration. Every value sits inside its required range.
 * Deeply frozen: each namespace object and the layerOrder array are frozen,
 * so nothing can be mutated at runtime.
 * @type {Config}
 */
export const DEFAULT_CONFIG = Object.freeze({
  physics: Object.freeze({ gravity: 1200, maxFallSpeed: 600, flapVelocity: 340 }),
  pipes: Object.freeze({ speed: 180, spacing: 260, gapHeight: 180, width: 70, margin: 20 }),
  clouds: Object.freeze({ count: 4, minSpeed: 20, maxSpeed: 80, minAlpha: 0.3, maxAlpha: 0.7 }),
  scoring: Object.freeze({ increment: 1 }),
  timing: Object.freeze({ fixedDt: 1 / 120, graceMs: 500 }),
  visuals: Object.freeze({
    skyColor: '#8ecae6',
    pipeColor: '#2e8b57',
    ghostColor: '#ffffff',
    borderColor: '#1d1f21',
    scoreBarColor: '#1d1f21',
    ghostWidth: 48,
    ghostHeight: 48,
    borderRadius: 24,
    scoreBarHeight: 56,
  }),
  storage: Object.freeze({ highScoreKey: 'flappyKiro.highScore' }),
  world: Object.freeze({
    width: 480,
    height: 640,
    ceilingY: 0,
    groundY: 584,
    ghostStartXRatio: 0.25,
    rngSeed: 0x1234abcd,
  }),
  render: Object.freeze({
    layerOrder: Object.freeze(['sky', 'clouds', 'pipes', 'ghost', 'border', 'scoreBar', 'overlays']),
  }),
});

/**
 * Assert a value is a finite number; throws a descriptive error otherwise.
 * @param {*} value
 * @param {string} key  Dotted key path for the error message.
 * @returns {number}
 */
function assertFiniteNumber(value, key) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Config error: ${key}=${String(value)} is not a finite number`);
  }
  return value;
}

/**
 * Assert a numeric value lies within an inclusive range.
 * @param {*} value
 * @param {string} key   Dotted key path for the error message.
 * @param {number} min
 * @param {number} max
 */
function assertInRange(value, key, min, max) {
  assertFiniteNumber(value, key);
  if (value < min || value > max) {
    throw new Error(`Config error: ${key}=${value} out of range [${min},${max}]`);
  }
}

/**
 * Assert a numeric value equals an expected constant.
 * @param {*} value
 * @param {string} key  Dotted key path for the error message.
 * @param {number} expected
 */
function assertEquals(value, key, expected) {
  assertFiniteNumber(value, key);
  if (value !== expected) {
    throw new Error(`Config error: ${key}=${value} must equal ${expected}`);
  }
}

/**
 * Validate a config object against its allowed ranges and types. Pure: it does
 * not mutate the input and performs no I/O. Throws a descriptive Error naming
 * the offending key on the first violation.
 * @param {Config} config
 * @returns {Config} the same (unchanged) config on success.
 */
export function validateConfig(config) {
  if (config === null || typeof config !== 'object') {
    throw new Error(`Config error: config=${String(config)} is not an object`);
  }

  const { physics, pipes, clouds, timing, visuals, storage, world, render } = config;

  if (physics === null || typeof physics !== 'object') {
    throw new Error('Config error: physics namespace is missing');
  }
  if (pipes === null || typeof pipes !== 'object') {
    throw new Error('Config error: pipes namespace is missing');
  }
  if (clouds === null || typeof clouds !== 'object') {
    throw new Error('Config error: clouds namespace is missing');
  }
  if (timing === null || typeof timing !== 'object') {
    throw new Error('Config error: timing namespace is missing');
  }
  if (visuals === null || typeof visuals !== 'object') {
    throw new Error('Config error: visuals namespace is missing');
  }
  if (storage === null || typeof storage !== 'object') {
    throw new Error('Config error: storage namespace is missing');
  }
  if (world === null || typeof world !== 'object') {
    throw new Error('Config error: world namespace is missing');
  }
  if (render === null || typeof render !== 'object') {
    throw new Error('Config error: render namespace is missing');
  }

  // physics
  assertInRange(physics.gravity, 'physics.gravity', 800, 1500);
  assertInRange(physics.flapVelocity, 'physics.flapVelocity', 300, 500);
  assertEquals(physics.maxFallSpeed, 'physics.maxFallSpeed', 600);

  // pipes
  assertInRange(pipes.speed, 'pipes.speed', 100, 300);
  assertInRange(pipes.spacing, 'pipes.spacing', 150, 400);
  assertEquals(pipes.margin, 'pipes.margin', 20);

  // gapHeight must be >= 1.5 * visuals.ghostHeight
  assertFiniteNumber(visuals.ghostHeight, 'visuals.ghostHeight');
  assertFiniteNumber(pipes.gapHeight, 'pipes.gapHeight');
  const minGapHeight = 1.5 * visuals.ghostHeight;
  if (pipes.gapHeight < minGapHeight) {
    throw new Error(
      `Config error: pipes.gapHeight=${pipes.gapHeight} must be >= 1.5 * visuals.ghostHeight (${minGapHeight})`,
    );
  }

  // clouds: alpha range
  assertInRange(clouds.minAlpha, 'clouds.minAlpha', 0.3, 0.7);
  assertInRange(clouds.maxAlpha, 'clouds.maxAlpha', 0.3, 0.7);

  // clouds: count and parallax (>=2 clouds, >=2 distinct speeds, all speeds < pipes.speed)
  assertFiniteNumber(clouds.count, 'clouds.count');
  if (clouds.count < 2) {
    throw new Error(`Config error: clouds.count=${clouds.count} must be >= 2`);
  }
  assertFiniteNumber(clouds.minSpeed, 'clouds.minSpeed');
  assertFiniteNumber(clouds.maxSpeed, 'clouds.maxSpeed');
  if (clouds.minSpeed >= pipes.speed) {
    throw new Error(
      `Config error: clouds.minSpeed=${clouds.minSpeed} must be < pipes.speed (${pipes.speed})`,
    );
  }
  if (clouds.maxSpeed >= pipes.speed) {
    throw new Error(
      `Config error: clouds.maxSpeed=${clouds.maxSpeed} must be < pipes.speed (${pipes.speed})`,
    );
  }
  if (clouds.minSpeed === clouds.maxSpeed) {
    throw new Error(
      `Config error: clouds.minSpeed and clouds.maxSpeed must differ to provide >= 2 distinct drift speeds (both ${clouds.minSpeed})`,
    );
  }

  // timing
  assertEquals(timing.graceMs, 'timing.graceMs', 500);

  // world
  if (!(world.width > 0)) {
    throw new Error(`Config error: world.width=${world.width} must be > 0`);
  }
  if (!(world.height > 0)) {
    throw new Error(`Config error: world.height=${world.height} must be > 0`);
  }
  assertFiniteNumber(world.ceilingY, 'world.ceilingY');
  assertFiniteNumber(world.groundY, 'world.groundY');
  if (!(world.ceilingY < world.groundY)) {
    throw new Error(
      `Config error: world.ceilingY=${world.ceilingY} must be < world.groundY (${world.groundY})`,
    );
  }
  assertInRange(world.ghostStartXRatio, 'world.ghostStartXRatio', 0, 1);

  // storage
  if (typeof storage.highScoreKey !== 'string' || storage.highScoreKey.length === 0) {
    throw new Error(
      `Config error: storage.highScoreKey=${String(storage.highScoreKey)} must be a non-empty string`,
    );
  }

  // render
  if (!Array.isArray(render.layerOrder) || render.layerOrder.length === 0) {
    throw new Error('Config error: render.layerOrder must be a non-empty array');
  }

  return config;
}
