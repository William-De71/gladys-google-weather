// -----------------------------------------------------------------------------
// Cache in front of the Weather API: what keeps the bill at zero.
//
// Gladys asks for the weather far more often than it changes: the core checks
// every 30 minutes for its alert trigger, each dashboard display asks too,
// and so do the widgets and the scene actions. Each product is therefore
// kept for its own duration (config.js), per rounded location and language,
// and two simultaneous asks of the same product share one request.
//
// When a refresh fails (network, Google down, monthly budget spent), the last
// answer is served again for up to STALE_MAX_MS rather than failing: a weather
// card a little old beats an empty one. A location outside the coverage is
// never served stale: it must fall through to the next provider.
// -----------------------------------------------------------------------------

import { roundCoordinate } from './google-api.js';

const MINUTE = 60 * 1000;
const STALE_MAX_MS = 12 * 60 * MINUTE;
const PRODUCTS = ['current', 'hours', 'days', 'alerts'];

/**
 * @description Create the store.
 * @param {object} options - Options.
 * @param {object} options.api - The google-api.js client.
 * @param {Function} options.getTtlMinutes - `(product) => number`.
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {object} [options.logger] - Logger.
 * @returns {object} `{ get, clear }`.
 * @example
 * const store = createWeatherStore({ api, getTtlMinutes: (p) => 30 });
 */
function createWeatherStore({ api, getTtlMinutes, now = () => Date.now(), logger = console }) {
  // key -> { value, at }
  const entries = new Map();
  // key -> Promise (single flight)
  const pending = new Map();

  const keyOf = (product, latitude, longitude, language) =>
    [product, roundCoordinate(latitude), roundCoordinate(longitude), language].join('|');

  /**
   * @description Get a product, from the cache when fresh enough.
   * @param {string} product - 'current' | 'hours' | 'days' | 'alerts'.
   * @param {object} location - { latitude, longitude }.
   * @param {string} language - The language.
   * @param {object} [options] - { maxAgeMs }: a fresher bound than the TTL
   * (the alert watcher asks for answers younger than its own interval).
   * @returns {Promise<object>} The API answer.
   * @example
   * await store.get('current', house, 'fr');
   */
  async function get(product, { latitude, longitude }, language, { maxAgeMs } = {}) {
    if (!PRODUCTS.includes(product)) {
      throw new Error(`Unknown product ${product}`);
    }
    const key = keyOf(product, latitude, longitude, language);
    const ttl = Math.min(getTtlMinutes(product) * MINUTE, maxAgeMs ?? Infinity);
    const entry = entries.get(key);
    if (entry !== undefined && now() - entry.at < ttl) {
      return entry.value;
    }
    if (pending.has(key)) {
      return pending.get(key);
    }
    const request = api[product](latitude, longitude, language)
      .then((value) => {
        entries.set(key, { value, at: now() });
        return value;
      })
      .catch((err) => {
        if (
          err.name !== 'OutOfCoverageError' &&
          entry !== undefined &&
          now() - entry.at < STALE_MAX_MS
        ) {
          logger.warn(`Weather API ${product} failed (${err.message}): previous answer served`);
          return entry.value;
        }
        throw err;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  /** Forget everything (new key, shorter durations). */
  function clear() {
    entries.clear();
  }

  return { get, clear };
}

export { STALE_MAX_MS, PRODUCTS, createWeatherStore };
