/**
 * HighScoreStore adapter: wraps `localStorage` for reading and writing the
 * persisted high score. It is a side-effecting adapter at the edge of the
 * architecture and therefore NEVER throws — every storage interaction is
 * guarded and failures are reported through result objects so the pure logic
 * and controller can degrade gracefully.
 *
 * See .kiro/specs/flappy-kiro/design.md (HighScoreStore adapter section).
 * Requirements: 1.5, 1.6, 1.7, 7.2, 7.4, 7.5, 7.6.
 */

import { DEFAULT_CONFIG } from './config.js';

/**
 * Result of a {@link HighScoreStore#load} call.
 * @typedef {Object} LoadResult
 * @property {number} value  The loaded high score, or 0 when missing/invalid/unavailable.
 * @property {boolean} ok     True when storage was read without throwing; false when storage threw.
 */

/**
 * Result of a {@link HighScoreStore#save} call.
 * @typedef {Object} SaveResult
 * @property {boolean} ok  True when the value was written; false when the write failed.
 */

export class HighScoreStore {
  /**
   * @param {Storage} [storage] A `localStorage`-like store. Defaults to
   *   `window.localStorage` when available, otherwise `undefined` (treated as
   *   unavailable storage so reads/writes degrade gracefully).
   * @param {string} [key] The storage key. Defaults to
   *   `DEFAULT_CONFIG.storage.highScoreKey`, keeping the key defined in exactly
   *   one place.
   */
  constructor(
    storage = typeof window !== 'undefined' ? window.localStorage : undefined,
    key = DEFAULT_CONFIG.storage.highScoreKey,
  ) {
    /** @type {Storage|undefined} */
    this.storage = storage;
    /** @type {string} */
    this.key = key;
  }

  /**
   * Read and parse the stored high score. Never throws.
   *
   * Returns `value: 0` when the key is absent, when the stored text does not
   * parse to a valid (finite, non-negative, integer) score, or when the storage
   * read throws (e.g. storage disabled). `ok` is true whenever the read itself
   * did not throw — a missing or invalid value still leaves the game able to
   * show 0 and remain in the Start state (Req 1.6, 1.7).
   *
   * @returns {LoadResult}
   */
  load() {
    if (!this.storage) {
      return { value: 0, ok: false };
    }

    let raw;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      // Storage unavailable/disabled: degrade to 0 and report the failure.
      return { value: 0, ok: false };
    }

    if (raw === null || raw === undefined) {
      // No stored high score yet (Req 1.6, 7.5).
      return { value: 0, ok: true };
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
      // Invalid stored value (Req 1.7): show 0 but the read did not throw.
      return { value: 0, ok: true };
    }

    return { value: parsed, ok: true };
  }

  /**
   * Persist the high score. Never throws.
   *
   * Wraps `setItem` in a try/catch; on any failure (e.g. quota exceeded or
   * storage disabled) it returns `{ ok: false }` so the controller can keep the
   * in-memory high score and surface a save-failed indicator (Req 7.6).
   *
   * @param {number} score The high score to store.
   * @returns {SaveResult}
   */
  save(score) {
    if (!this.storage) {
      return { ok: false };
    }

    try {
      this.storage.setItem(this.key, String(score));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
}
