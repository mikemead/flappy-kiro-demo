/**
 * InputHandler adapter: normalizes raw DOM input events (mouse click, touch
 * tap, and Spacebar key press) into a single flap intent.
 *
 * This is a side-effecting adapter at the edge of the architecture. Its sole
 * job is normalization — it converts every supported input into one
 * `onFlap(nowMs)` call and does NOT interpret that intent. All phase gating and
 * the 500 ms game-over grace period live in the controller, keeping those
 * timing-sensitive rules in pure, testable code.
 *
 * Because it is an adapter (not pure logic), it is allowed to read the clock at
 * the edge: `nowMs` is sampled from `performance.now()` when an event fires and
 * passed into `onFlap`, honoring the design's "intents carry a timestamp" rule.
 *
 * See .kiro/specs/flappy-kiro/design.md (InputHandler adapter section).
 * Requirements: 3.5, 3.6, 3.7.
 */

/** The `KeyboardEvent.code` value for the Spacebar. */
const SPACE_CODE = 'Space';
/** Legacy `KeyboardEvent.key` value for the Spacebar (older browsers). */
const SPACE_KEY = ' ';

export class InputHandler {
  /**
   * @param {EventTarget} target The element/window to listen on (canvas or window).
   * @param {(nowMs: number) => void} onFlap Callback invoked once per normalized flap.
   */
  constructor(target, onFlap) {
    /** @type {EventTarget} */
    this.target = target;
    /** @type {(nowMs: number) => void} */
    this.onFlap = onFlap;

    /**
     * Tracks whether the Spacebar is currently held down. Set on the first
     * `keydown` of a press and cleared on `keyup`, so OS auto-repeat `keydown`
     * events while the key is held emit no additional flap (Req 3.7).
     * @type {boolean}
     */
    this.spaceHeld = false;

    /**
     * Whether listeners are currently registered. Guards against
     * double-attach and detach-without-attach.
     * @type {boolean}
     */
    this.attached = false;

    // Bind handlers once so the same references can be added and removed.
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
  }

  /**
   * Register DOM listeners for mouse, touch, and keyboard input. Idempotent:
   * calling `attach()` when already attached does nothing.
   * @returns {void}
   */
  attach() {
    if (this.attached) {
      return;
    }
    this.target.addEventListener('mousedown', this.handleMouseDown);
    // `passive: false` so `preventDefault()` in the handler is honored.
    this.target.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.target.addEventListener('keydown', this.handleKeyDown);
    this.target.addEventListener('keyup', this.handleKeyUp);
    this.attached = true;
  }

  /**
   * Remove all DOM listeners registered by {@link InputHandler#attach} and
   * reset the held-key flag. Idempotent: calling `detach()` when not attached
   * does nothing.
   * @returns {void}
   */
  detach() {
    if (!this.attached) {
      return;
    }
    this.target.removeEventListener('mousedown', this.handleMouseDown);
    this.target.removeEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.target.removeEventListener('keyup', this.handleKeyUp);
    this.spaceHeld = false;
    this.attached = false;
  }

  /**
   * Emit a single normalized flap, sampling the clock at the edge.
   * @returns {void}
   */
  emitFlap() {
    this.onFlap(performance.now());
  }

  /**
   * Mouse click → one flap (Req 3.5).
   * @param {MouseEvent} _event
   * @returns {void}
   */
  handleMouseDown(_event) {
    this.emitFlap();
  }

  /**
   * Touch tap → one flap (Req 3.6). Calls `preventDefault()` so the browser
   * does not also synthesize a `mousedown`, which would double-fire the flap.
   * @param {TouchEvent} event
   * @returns {void}
   */
  handleTouchStart(event) {
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    this.emitFlap();
  }

  /**
   * Spacebar `keydown` → exactly one flap per discrete press (Req 3.7).
   *
   * OS key auto-repeat is suppressed two ways: `event.repeat` is a fast path
   * for browsers that set it, and the `spaceHeld` flag catches the general
   * case — once a press is registered, further `keydown` events are ignored
   * until the matching `keyup` clears the flag.
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  handleKeyDown(event) {
    if (!this.isSpace(event)) {
      return;
    }
    if (event.repeat === true || this.spaceHeld) {
      return;
    }
    this.spaceHeld = true;
    this.emitFlap();
  }

  /**
   * Spacebar `keyup` clears the held flag so the next press flaps again.
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  handleKeyUp(event) {
    if (!this.isSpace(event)) {
      return;
    }
    this.spaceHeld = false;
  }

  /**
   * Whether a keyboard event is the Spacebar, accepting both the modern
   * `code` and the legacy `key` values.
   * @param {KeyboardEvent} event
   * @returns {boolean}
   */
  isSpace(event) {
    return event.code === SPACE_CODE || event.key === SPACE_KEY;
  }
}
