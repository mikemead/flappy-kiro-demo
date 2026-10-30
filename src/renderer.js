/**
 * Renderer adapter: reads a GameState and draws the Canvas 2D layers.
 *
 * The renderer is a pure projection of state onto the canvas: `render(state)`
 * reads a GameState and draws it. It holds no game logic, mutates no state, and
 * never decides phase transitions. Each frame it clears the canvas once and
 * draws back-to-front by iterating `config.render.layerOrder` (never a
 * hardcoded sequence). All colors and sizes come from `config.visuals`; there
 * are no literal hex colors or pixel sizes in the draw code. Context state
 * changes are batched per layer, and `save()`/`restore()` scope every transform
 * and alpha change so later layers are unaffected.
 *
 * See .kiro/specs/flappy-kiro/design.md (Renderer, Rendering Approach and
 * Visual Styling).
 */

/**
 * @typedef {import('./config.js').Config} Config
 * @typedef {import('./physics.js').Ghost} Ghost
 * @typedef {import('./pipes.js').Pipe} Pipe
 * @typedef {import('./clouds.js').Cloud} Cloud
 * @typedef {import('./clouds.js').PlayArea} PlayArea
 */

/**
 * Side-effecting adapter that draws a GameState to a Canvas 2D context.
 */
export class Renderer {
  /**
   * @param {CanvasRenderingContext2D} ctx  The 2D drawing context.
   * @param {Config} config                 Injected, validated configuration.
   */
  constructor(ctx, config) {
    /** @type {CanvasRenderingContext2D} */
    this.ctx = ctx;
    /** @type {Config} */
    this.config = config;

    const { world } = config;
    // Logical dimensions are fixed; scaling to the device pixel ratio is handled
    // once at setup/resize by the caller, not per frame.
    /** @type {number} */
    this.width = world.width;
    /** @type {number} */
    this.height = world.height;

    // A single consistent font family/sizing scheme for all text, derived from
    // the score bar height so text scales with the bar rather than using magic
    // pixel literals.
    const barHeight = config.visuals.scoreBarHeight;
    /** @type {string} */
    this.labelFont = `${Math.round(barHeight * 0.28)}px monospace`;
    /** @type {string} */
    this.valueFont = `bold ${Math.round(barHeight * 0.42)}px monospace`;
    /** @type {string} */
    this.indicatorFont = `${Math.round(barHeight * 0.22)}px monospace`;
    /** @type {string} */
    this.overlayTitleFont = `bold ${Math.round(barHeight * 0.64)}px monospace`;
    /** @type {string} */
    this.overlayBodyFont = `${Math.round(barHeight * 0.32)}px monospace`;
  }

  /**
   * Draw a full frame: clear once, then draw each layer back-to-front in the
   * order given by `config.render.layerOrder`. Unknown layer names are skipped
   * so an extended layer order never throws.
   *
   * @param {*} state  The GameState to draw (read-only; never mutated).
   */
  render(state) {
    const { ctx } = this;

    // Clear the whole canvas once per frame before drawing any layer.
    ctx.clearRect(0, 0, this.width, this.height);

    const layerOrder = this.config.render.layerOrder;
    for (let i = 0; i < layerOrder.length; i += 1) {
      this._drawLayer(layerOrder[i], state);
    }
  }

  /**
   * Dispatch a single named layer to its draw routine. Centralizes the
   * layer-name → method mapping so `render` stays a plain config-driven loop.
   *
   * @param {string} layer  Layer name from `config.render.layerOrder`.
   * @param {*} state        The GameState.
   */
  _drawLayer(layer, state) {
    switch (layer) {
      case 'sky':
        this._drawSky();
        break;
      case 'clouds':
        this._drawClouds(state.clouds);
        break;
      case 'pipes':
        this._drawPipes(state.pipes, state.playArea);
        break;
      case 'ghost':
        this._drawGhost(state.ghost);
        break;
      case 'border':
        this._drawBorder();
        break;
      case 'scoreBar':
        this._drawScoreBar(state);
        break;
      case 'overlays':
        this._drawOverlays(state);
        break;
      default:
        // Unknown layer names are ignored rather than throwing, so the layer
        // order can be extended without touching this adapter.
        break;
    }
  }

  /**
   * Stroke a rounded rectangle path, using the native `roundRect` when the
   * context provides it and falling back to an arc-cornered path otherwise.
   * Leaves the path open so the caller decides whether to fill or stroke.
   *
   * @param {number} x       Left edge (px).
   * @param {number} y       Top edge (px).
   * @param {number} w       Width (px).
   * @param {number} h       Height (px).
   * @param {number} radius  Corner radius (px).
   */
  _roundRectPath(x, y, w, h, radius) {
    const ctx = this.ctx;
    // Clamp the radius so it can never exceed half the smaller side.
    const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));

    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
      return;
    }

    // Fallback for contexts without roundRect: build the path from arcs.
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /**
   * Layer 1 - Sky: fill the whole play area with the configured light-blue sky
   * color behind every other element.
   */
  _drawSky() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = this.config.visuals.skyColor;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  /**
   * Layer 2 - Clouds: draw each cloud as a cluster of overlapping white puffs
   * at its own `globalAlpha` (semi-transparent, 0.3-0.7) so the sky shows
   * through. All clouds share one fill style; alpha is set per cloud and reset
   * to 1 afterward via `restore`.
   *
   * @param {Cloud[]} clouds  The clouds to draw.
   */
  _drawClouds(clouds) {
    if (!clouds || clouds.length === 0) {
      return;
    }
    const ctx = this.ctx;
    ctx.save();
    // Batch: a single fill style for every cloud; only globalAlpha changes.
    ctx.fillStyle = this.config.visuals.ghostColor; // clouds are white, as is the ghost

    for (let i = 0; i < clouds.length; i += 1) {
      const cloud = clouds[i];
      ctx.globalAlpha = cloud.alpha;
      this._drawCloudShape(cloud);
    }

    ctx.restore(); // restores globalAlpha to 1 and the prior fill style
  }

  /**
   * Draw one puffy cloud: a cluster of overlapping circles filling the cloud's
   * bounding box. The current fill style and alpha are set by the caller.
   *
   * @param {Cloud} cloud  The cloud whose shape to draw.
   */
  _drawCloudShape(cloud) {
    const ctx = this.ctx;
    const cx = cloud.x + cloud.width / 2;
    const cy = cloud.y + cloud.height / 2;
    const rBig = cloud.height / 2;
    const rSmall = cloud.height * 0.38;

    // Central large puff plus smaller puffs spread along the width for a
    // lumpy, overlapping silhouette.
    ctx.beginPath();
    ctx.arc(cx, cy, rBig, 0, Math.PI * 2);
    ctx.arc(cloud.x + cloud.width * 0.25, cy + rSmall * 0.2, rSmall, 0, Math.PI * 2);
    ctx.arc(cloud.x + cloud.width * 0.75, cy + rSmall * 0.2, rSmall, 0, Math.PI * 2);
    ctx.arc(cx, cy - rBig * 0.35, rSmall, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Layer 3 - Pipes: draw the upper and lower green segments of every pipe,
   * with a slightly darker lip near the gap for a retro look. Segment bounds
   * are derived from the pipe's plain fields and the play area's ground.
   *
   * @param {Pipe[]} pipes        The pipes to draw.
   * @param {PlayArea} playArea   Play-area geometry (provides ground/ceiling).
   */
  _drawPipes(pipes, playArea) {
    if (!pipes || pipes.length === 0) {
      return;
    }
    const ctx = this.ctx;
    const visuals = this.config.visuals;
    const ceilingY = playArea.ceilingY;
    const groundY = playArea.groundY;
    // Lip dimensions derived from pipe width so there are no magic pixels.
    const lipOverhang = this.config.pipes.width * 0.12;
    const lipHeight = this.config.pipes.width * 0.22;

    ctx.save();

    // Batch all green bodies first with one fill style.
    ctx.fillStyle = visuals.pipeColor;
    for (let i = 0; i < pipes.length; i += 1) {
      const pipe = pipes[i];
      const x = Math.round(pipe.x);
      const w = Math.round(pipe.width);
      const gapTop = pipe.gapTop;
      const gapBottom = pipe.gapTop + pipe.gapHeight;

      // Upper segment: ceiling down to the top of the gap.
      const upperHeight = gapTop - ceilingY;
      if (upperHeight > 0) {
        ctx.fillRect(x, ceilingY, w, upperHeight);
      }
      // Lower segment: bottom of the gap down to the ground.
      const lowerHeight = groundY - gapBottom;
      if (lowerHeight > 0) {
        ctx.fillRect(x, gapBottom, w, lowerHeight);
      }
    }

    // Batch all darker lips with a second fill style (a darkened pipe color).
    ctx.fillStyle = this._darken(visuals.pipeColor, 0.7);
    for (let i = 0; i < pipes.length; i += 1) {
      const pipe = pipes[i];
      const x = Math.round(pipe.x);
      const w = Math.round(pipe.width);
      const gapTop = pipe.gapTop;
      const gapBottom = pipe.gapTop + pipe.gapHeight;
      const lipX = x - lipOverhang;
      const lipW = w + lipOverhang * 2;

      // Lip on the lower edge of the upper segment (just above the gap).
      if (gapTop - ceilingY > 0) {
        ctx.fillRect(lipX, gapTop - lipHeight, lipW, lipHeight);
      }
      // Lip on the upper edge of the lower segment (just below the gap).
      if (groundY - gapBottom > 0) {
        ctx.fillRect(lipX, gapBottom, lipW, lipHeight);
      }
    }

    ctx.restore();
  }

  /**
   * Layer 4 - Ghost: a white rounded body with a scalloped bottom and exactly
   * two dark circular eyes, sized from `config.visuals.ghostWidth/ghostHeight`.
   *
   * @param {Ghost} ghost  The ghost to draw.
   */
  _drawGhost(ghost) {
    if (!ghost) {
      return;
    }
    const ctx = this.ctx;
    const visuals = this.config.visuals;
    const x = ghost.x;
    const y = ghost.y;
    const w = ghost.width;
    const h = ghost.height;
    const radius = Math.min(w, h) / 2;

    ctx.save();

    // Body: rounded-top rectangle with a scalloped (wavy) bottom.
    ctx.fillStyle = visuals.ghostColor;
    const scallopCount = 4;
    const scallopW = w / scallopCount;
    const scallopR = scallopW / 2;
    const bodyBottom = y + h - scallopR;

    ctx.beginPath();
    ctx.moveTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, bodyBottom);
    // Scalloped bottom edge: a row of downward bumps, right to left.
    for (let s = 0; s < scallopCount; s += 1) {
      const bumpCenterX = x + w - scallopW * (s + 0.5);
      const anticlockwise = s % 2 === 1;
      ctx.arc(bumpCenterX, bodyBottom, scallopR, 0, Math.PI, anticlockwise);
    }
    ctx.lineTo(x, y + radius);
    ctx.closePath();
    ctx.fill();

    // Eyes: exactly two dark circles in the upper half of the body.
    ctx.fillStyle = visuals.borderColor;
    const eyeR = Math.max(1, h * 0.1);
    const eyeY = y + h * 0.38;
    const eyeLeftX = x + w * 0.35;
    const eyeRightX = x + w * 0.65;

    ctx.beginPath();
    ctx.arc(eyeLeftX, eyeY, eyeR, 0, Math.PI * 2);
    ctx.arc(eyeRightX, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Layer 5 - Border: a thick dark rounded stroke enclosing the play area on
   * all four sides. The stroke is inset by half its width so the full outline
   * stays inside the canvas rather than being clipped at the edges.
   */
  _drawBorder() {
    const ctx = this.ctx;
    const visuals = this.config.visuals;
    // Border thickness derived from the radius so sizing stays config-driven.
    const lineWidth = Math.max(2, Math.round(visuals.borderRadius * 0.33));
    const half = lineWidth / 2;

    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = visuals.borderColor;
    this._roundRectPath(
      Math.round(half),
      Math.round(half),
      Math.round(this.width - lineWidth),
      Math.round(this.height - lineWidth),
      visuals.borderRadius,
    );
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Layer 6 - Score bar: a dark, full-width bar at the bottom of the play area
   * showing the current SCORE and the BEST/high score. When `state.saveFailed`
   * is set, a small "save failed" indicator is shown in the bar.
   *
   * @param {*} state  The GameState (reads `score`, `highScore`, `saveFailed`).
   */
  _drawScoreBar(state) {
    const ctx = this.ctx;
    const visuals = this.config.visuals;
    const barHeight = visuals.scoreBarHeight;
    const barTop = Math.round(this.height - barHeight);
    const padX = Math.round(barHeight * 0.3);

    ctx.save();

    // Dark full-width bar spanning the bottom edge.
    ctx.fillStyle = visuals.scoreBarColor;
    ctx.fillRect(0, barTop, this.width, Math.ceil(barHeight));

    // All text is light (the ghost color) against the dark bar. Consistent font
    // set per text run; label above value.
    ctx.fillStyle = visuals.ghostColor;
    const labelY = barTop + Math.round(barHeight * 0.34);
    const valueY = barTop + Math.round(barHeight * 0.72);

    // SCORE on the left.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = this.labelFont;
    ctx.fillText('SCORE', padX, labelY);
    ctx.font = this.valueFont;
    ctx.fillText(String(state.score ?? 0), padX, valueY);

    // BEST on the right.
    ctx.textAlign = 'right';
    const rightX = this.width - padX;
    ctx.font = this.labelFont;
    ctx.fillText('BEST', rightX, labelY);
    ctx.font = this.valueFont;
    ctx.fillText(String(state.highScore ?? 0), rightX, valueY);

    // Save-failed indicator: a small centered note when a high-score write
    // failed, so the player knows persistence is unavailable.
    if (state.saveFailed) {
      ctx.textAlign = 'center';
      ctx.font = this.indicatorFont;
      ctx.fillText('save failed', Math.round(this.width / 2), barTop + Math.round(barHeight * 0.5));
    }

    ctx.restore();
  }

  /**
   * Layer 7 - Overlays: phase-dependent prompts drawn on top of everything.
   * Start shows a flap-to-begin prompt; Game Over shows a panel with the final
   * score, the high score, and a restart prompt. Other phases draw nothing.
   *
   * @param {*} state  The GameState (reads `phase`, `score`, `highScore`).
   */
  _drawOverlays(state) {
    if (state.phase === 'start') {
      this._drawStartOverlay();
    } else if (state.phase === 'gameover') {
      this._drawGameOverOverlay(state);
    }
  }

  /**
   * Draw the Start-state prompt instructing the player to flap to begin.
   */
  _drawStartOverlay() {
    const ctx = this.ctx;
    const visuals = this.config.visuals;
    const centerX = Math.round(this.width / 2);
    const centerY = Math.round(this.height * 0.4);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = visuals.borderColor;
    ctx.font = this.overlayTitleFont;
    ctx.fillText('FLAPPY KIRO', centerX, centerY);

    ctx.font = this.overlayBodyFont;
    ctx.fillText('Flap to begin', centerX, centerY + Math.round(visuals.scoreBarHeight * 0.9));

    ctx.restore();
  }

  /**
   * Draw the Game Over panel: a dark rounded panel with the final score, the
   * high score, and a restart prompt.
   *
   * @param {*} state  The GameState (reads `score`, `highScore`).
   */
  _drawGameOverOverlay(state) {
    const ctx = this.ctx;
    const visuals = this.config.visuals;
    const centerX = Math.round(this.width / 2);
    const panelW = Math.round(this.width * 0.7);
    const panelH = Math.round(this.height * 0.4);
    const panelX = Math.round((this.width - panelW) / 2);
    const panelY = Math.round((this.height - panelH) / 2);
    const lineGap = Math.round(visuals.scoreBarHeight * 0.7);

    ctx.save();

    // Dim the scene behind the panel using a translucent dark wash.
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = visuals.borderColor;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalAlpha = 1;

    // Panel background (dark, rounded).
    ctx.fillStyle = visuals.scoreBarColor;
    this._roundRectPath(panelX, panelY, panelW, panelH, visuals.borderRadius);
    ctx.fill();

    // Panel text (light).
    ctx.fillStyle = visuals.ghostColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let textY = panelY + lineGap;
    ctx.font = this.overlayTitleFont;
    ctx.fillText('GAME OVER', centerX, textY);

    ctx.font = this.overlayBodyFont;
    textY += lineGap;
    ctx.fillText(`Score  ${state.score ?? 0}`, centerX, textY);
    textY += lineGap;
    ctx.fillText(`Best  ${state.highScore ?? 0}`, centerX, textY);
    textY += lineGap;
    ctx.fillText('Flap to restart', centerX, textY);

    ctx.restore();
  }

  /**
   * Darken a hex color (`#rgb` or `#rrggbb`) by a multiplicative factor. Used to
   * derive the pipe lip shade from the configured pipe color so the renderer
   * still pulls its base color from `config.visuals` rather than a second
   * literal. Non-hex inputs are returned unchanged.
   *
   * @param {string} hex     Source color, e.g. '#2e8b57'.
   * @param {number} factor  Multiplier in [0, 1]; lower is darker.
   * @returns {string} A darkened '#rrggbb' string, or the input if unparsable.
   */
  _darken(hex, factor) {
    if (typeof hex !== 'string' || hex[0] !== '#') {
      return hex;
    }
    let r;
    let g;
    let b;
    if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    } else {
      return hex;
    }
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return hex;
    }
    const clampChannel = (c) => Math.max(0, Math.min(255, Math.round(c * factor)));
    const toHex = (c) => clampChannel(c).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
}
