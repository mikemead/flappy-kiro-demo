/**
 * ConfigLoader adapter: reads URL query-param overrides, maps known keys to
 * their namespaced config fields, deep-merges them over `DEFAULT_CONFIG`, then
 * runs `validateConfig` on the merged result so overrides stay range-checked.
 *
 * This is the only impure part of the config subsystem: it reads
 * `window.location.search` (by default). The merge + validate logic operates
 * over plain data and stays testable by injecting a `search` string.
 *
 * See .kiro/specs/flappy-kiro/design.md (Config (pure) and ConfigLoader section).
 */

import { DEFAULT_CONFIG, validateConfig } from './config.js';

/**
 * @typedef {Object} ParamMapping
 * @property {string} namespace  Config namespace (e.g. 'physics').
 * @property {string} field      Field within the namespace (e.g. 'gravity').
 */

/**
 * Explicit, easy-to-extend mapping from known URL query-param names to their
 * namespaced `Config` fields. Params not listed here are ignored. To support a
 * new override, add one entry — no other code changes needed.
 * @type {Readonly<Record<string, ParamMapping>>}
 */
export const PARAM_MAP = Object.freeze({
  gravity: { namespace: 'physics', field: 'gravity' },
  maxFallSpeed: { namespace: 'physics', field: 'maxFallSpeed' },
  flap: { namespace: 'physics', field: 'flapVelocity' },
  pipeSpeed: { namespace: 'pipes', field: 'speed' },
  spacing: { namespace: 'pipes', field: 'spacing' },
  gapHeight: { namespace: 'pipes', field: 'gapHeight' },
  margin: { namespace: 'pipes', field: 'margin' },
  graceMs: { namespace: 'timing', field: 'graceMs' },
});

/**
 * Adapter that produces a validated `Config` from URL query parameters merged
 * over the baseline defaults.
 */
export class ConfigLoader {
  /**
   * @param {string} [search] A `location.search` style string, e.g.
   *   `'?gravity=1000&pipeSpeed=200'`. Defaults to the live browser value when
   *   available, otherwise an empty string (no overrides).
   */
  constructor(search = typeof window !== 'undefined' ? window.location.search : '') {
    /** @type {string} */
    this.search = search;
  }

  /**
   * Parse the known query params, deep-merge them over `DEFAULT_CONFIG`, and
   * validate the result.
   *
   * Unknown params are ignored. Values that fail to parse as finite numbers are
   * skipped (treated as absent). Out-of-range values are NOT clamped — they are
   * passed through so `validateConfig` rejects them loudly.
   *
   * @returns {import('./config.js').Config} The merged, validated config.
   * @throws {Error} If an applied override is invalid (via `validateConfig`).
   */
  load() {
    const params = new URLSearchParams(this.search);
    const merged = deepMergeDefaults(DEFAULT_CONFIG);

    for (const [param, mapping] of Object.entries(PARAM_MAP)) {
      if (!params.has(param)) {
        continue;
      }
      const raw = params.get(param);
      const value = Number(raw);
      // Skip values that are not finite numbers (e.g. empty or non-numeric);
      // out-of-range-but-finite values are intentionally kept so validation
      // fails loudly rather than silently ignoring them.
      if (!Number.isFinite(value)) {
        continue;
      }
      merged[mapping.namespace][mapping.field] = value;
    }

    return validateConfig(merged);
  }
}

/**
 * Build a new, fully mutable copy of the config so overrides can be applied
 * without touching the deeply frozen `DEFAULT_CONFIG`. Each namespace object is
 * shallow-copied, and the `render.layerOrder` array is copied too.
 * @param {import('./config.js').Config} defaults
 * @returns {import('./config.js').Config}
 */
function deepMergeDefaults(defaults) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [namespace, values] of Object.entries(defaults)) {
    if (Array.isArray(values)) {
      out[namespace] = values.slice();
    } else if (values !== null && typeof values === 'object') {
      const nsCopy = {};
      for (const [field, fieldValue] of Object.entries(values)) {
        nsCopy[field] = Array.isArray(fieldValue) ? fieldValue.slice() : fieldValue;
      }
      out[namespace] = nsCopy;
    } else {
      out[namespace] = values;
    }
  }
  return /** @type {import('./config.js').Config} */ (out);
}
