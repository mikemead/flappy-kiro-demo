/**
 * Application entry point / composition root.
 *
 * This is the only module that reaches into browser globals (the DOM, the
 * canvas, `window`, `devicePixelRatio`) to assemble the game. It builds the
 * validated `Config` from URL overrides, sets up the canvas 2D context at the
 * fixed logical resolution (scaled once for the device pixel ratio), then wires
 * the side-effecting adapters (`Renderer`, `InputHandler`, `HighScoreStore`) to
 * the `GameController` via dependency injection and starts the loop.
 *
 * Per the architecture steering, composition lives here at the edge: adapters
 * depend on browser APIs, the controller depends on the adapters + validated
 * config, and the pure logic depends on neither. Nothing is imported as a
 * global singleton into logic.
 *
 * See .kiro/specs/flappy-kiro/design.md (Architecture, Renderer DPR note).
 * Requirements: 1.1, 3.5, 3.6.
 */

import { ConfigLoader } from './configLoader.js';
import { Renderer } from './renderer.js';
import { InputHandler } from './input.js';
import { HighScoreStore } from './highScoreStore.js';
import { GameController } from './gameController.js';

/** The DOM id of the <canvas> declared in index.html. */
const CANVAS_ID = 'game';

/**
 * Size the canvas backing store for the device pixel ratio and scale the 2D
 * context so all game drawing can use the fixed logical resolution from
 * `config.world` and still render crisply on high-DPI displays.
 *
 * Done once on setup and again on resize — never per frame. The CSS size is set
 * to the logical size (so layout is stable) while the backing-store
 * `width`/`height` attributes are the logical size times `devicePixelRatio`,
 * avoiding the blur you get from scaling only the CSS box. The context is reset
 * to an identity transform and then scaled by the ratio, so repeated calls on
 * resize do not compound the scale.
 *
 * @param {HTMLCanvasElement} canvas             The game canvas.
 * @param {CanvasRenderingContext2D} ctx         Its 2D context.
 * @param {number} logicalWidth                  Logical width in CSS pixels (config.world.width).
 * @param {number} logicalHeight                 Logical height in CSS pixels (config.world.height).
 * @returns {void}
 */
function setupCanvasForDpr(canvas, ctx, logicalWidth, logicalHeight) {
  const dpr = window.devicePixelRatio || 1;

  // Backing store in device pixels for crisp rendering.
  canvas.width = Math.round(logicalWidth * dpr);
  canvas.height = Math.round(logicalHeight * dpr);

  // CSS box stays at the logical size.
  canvas.style.width = `${logicalWidth}px`;
  canvas.style.height = `${logicalHeight}px`;

  // Reset to identity before scaling so resize calls do not compound.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
}

/**
 * Build the game, wire adapters to the controller, attach input, and start.
 * @returns {void}
 */
function main() {
  // 1. Build the validated config, merging URL query-param overrides over the
  //    defaults. ConfigLoader reads window.location.search by default.
  const config = new ConfigLoader(window.location.search).load();

  // 2. Resolve the canvas and its 2D context.
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById(CANVAS_ID));
  if (canvas === null) {
    throw new Error(`Canvas element #${CANVAS_ID} not found`);
  }
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2D canvas context unavailable');
  }

  // 3. Handle the device pixel ratio once on setup, then re-apply on resize so
  //    the backing store always matches the display without per-frame work.
  const { width: logicalWidth, height: logicalHeight } = config.world;
  setupCanvasForDpr(canvas, ctx, logicalWidth, logicalHeight);
  window.addEventListener('resize', () => {
    setupCanvasForDpr(canvas, ctx, logicalWidth, logicalHeight);
  });

  // 4. Construct the adapters. Renderer draws a GameState to the scaled context;
  //    HighScoreStore defaults to window.localStorage + the configured key.
  const renderer = new Renderer(ctx, config);
  const highScoreStore = new HighScoreStore(window.localStorage, config.storage.highScoreKey);

  // 5. Resolve the controller <-> input handler ordering. The controller needs
  //    the input handler, and the handler's onFlap needs the controller. The
  //    handler only stores onFlap (it is not invoked during construction) and
  //    the controller only stores the handler reference, so we create the
  //    handler first with a closure that forwards to `controller`, which is
  //    assigned immediately after. By the time any event fires, `controller`
  //    is set.
  let controller;
  const inputHandler = new InputHandler(window, (nowMs) => controller.handleFlap(nowMs));
  controller = new GameController(renderer, inputHandler, highScoreStore, config);

  // 6. Attach input listeners and start the game loop. Input is bound to
  //    `window` so Spacebar keydown is received (the canvas is not focusable by
  //    default); mouse/touch on the window still cover clicks/taps over the
  //    play area.
  inputHandler.attach();
  controller.start();
}

main();
