// -----------------------------------------------------------------------------
// Monthly counter of the billable Weather API calls.
//
// Google bills every SUCCESSFUL request to the Weather API under one SKU,
// "Weather Usage", with 10,000 free billable events per month. This counter
// is the integration's own safety net: once `monthly_budget` calls are
// reached in a calendar month, no more call goes out until the next month
// (the cached data keeps being served, see weather-store.js).
//
// The count lives in /data/usage.json so that a restart does not reset it.
// It is an estimate on our side: the month is the UTC calendar month and
// Google's own count (Cloud console → Google Maps Platform → Metrics) is the
// reference — hence a default budget kept below the free tier.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @description The UTC calendar month of an instant.
 * @param {number} instant - The instant in ms.
 * @returns {string} "YYYY-MM".
 * @example
 * monthOf(Date.parse('2026-10-17T08:00:00Z')); // -> '2026-10'
 */
function monthOf(instant) {
  return new Date(instant).toISOString().slice(0, 7);
}

/**
 * @description Create the usage counter.
 * @param {object} options - Options.
 * @param {string|null} options.path - The JSON file (null: memory only).
 * @param {Function} options.getBudget - `() => number`, read on every check.
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {object} [options.logger] - Logger.
 * @returns {object} `{ count, used, remaining, exhausted, month, record }`.
 * @example
 * const usage = createUsage({ path: '/data/usage.json', getBudget: () => 9000 });
 */
function createUsage({ path, getBudget, now = () => Date.now(), logger = console }) {
  let state = { month: monthOf(now()), calls: 0 };
  if (path) {
    try {
      const stored = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof stored?.month === 'string' && Number.isInteger(stored?.calls)) {
        state = { month: stored.month, calls: Math.max(0, stored.calls) };
      }
    } catch {
      // No file yet (first start) or unreadable: start from zero.
    }
  }

  const rollOver = () => {
    const month = monthOf(now());
    if (month !== state.month) {
      state = { month, calls: 0 };
    }
  };

  const save = () => {
    if (!path) {
      return;
    }
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(state));
    } catch (err) {
      logger.warn(`Unable to store the API usage counter: ${err.message}`);
    }
  };

  return {
    /** @returns {number} The calls of the current month. */
    used() {
      rollOver();
      return state.calls;
    },
    /** @returns {number} The calls left before the budget. */
    remaining() {
      rollOver();
      return Math.max(0, getBudget() - state.calls);
    },
    /** @returns {boolean} Whether the monthly budget is spent. */
    exhausted() {
      rollOver();
      return state.calls >= getBudget();
    },
    /** @returns {string} The current month, "YYYY-MM". */
    month() {
      rollOver();
      return state.month;
    },
    /** Count one successful (billable) call. */
    record() {
      rollOver();
      state.calls += 1;
      save();
    },
  };
}

export { monthOf, createUsage };
