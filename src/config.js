// -----------------------------------------------------------------------------
// Configuration of the Google Weather integration.
//
// One required field, the API key of the user's own Google Cloud project
// (Weather API enabled, billing account attached: Google requires one even
// for the free monthly usage). The rest tunes how often each product is
// fetched, which is what decides the monthly bill:
//
//   - `current_minutes`   current conditions        (default 30 min)
//   - `forecast_minutes`  hourly forecast            (default 60 min)
//                         the daily forecast is fetched 3 times less often
//   - `alert_minutes`     official alerts            (default 30 min)
//   - `alerts_enabled`    switch the alerts off where none are published
//   - `monthly_budget`    hard cap on the calls of a calendar month
//
// With the defaults, one house costs (48 + 24 + 8 + 48) calls a day, about
// 4,000 a month, well under the 10,000 free billable events of the "Weather
// Usage" SKU (see docs and README for the full computation).
//
// Two internal keys, outside the config_schema (never shown in the UI): the
// language and unit system of the last request, for the alert triggers and
// the scene actions, which receive no language (see readPreferences()).
// -----------------------------------------------------------------------------

// Bounds and defaults, mirrored from the manifest `config_schema`.
const CURRENT_MINUTES = { min: 10, max: 180, default: 30 };
const FORECAST_MINUTES = { min: 30, max: 360, default: 60 };
const ALERT_MINUTES = { min: 10, max: 180, default: 30 };
const MONTHLY_BUDGET = { min: 100, max: 1000000, default: 9000 };
// The daily forecast changes slowly: it is fetched this many times less often
// than the hourly one.
const DAILY_FACTOR = 3;

const PREFERENCE_KEYS = { language: 'last_language', units: 'last_units' };
const UNIT_SYSTEMS = ['metric', 'us'];

/**
 * @description Read a bounded number field, falling back to its default.
 * @param {unknown} raw - The raw value (the form can send numbers as strings).
 * @param {{ min: number, max: number, default: number }} bounds - The bounds.
 * @returns {number} The value, rounded to an integer.
 * @example
 * readNumber('45', CURRENT_MINUTES); // -> 45
 */
function readNumber(raw, bounds) {
  const value = Number(raw ?? bounds.default);
  if (raw === '' || !Number.isFinite(value)) {
    return bounds.default;
  }
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, value)));
}

/**
 * @description Read a boolean field (the form may send "true"/"false").
 * @param {unknown} raw - The raw value.
 * @param {boolean} fallback - The default.
 * @returns {boolean} The value.
 * @example
 * readBoolean('false', true); // -> false
 */
function readBoolean(raw, fallback) {
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') {
    return true;
  }
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') {
    return false;
  }
  return fallback;
}

/**
 * @description Read the API key: printable ASCII only, spaces trimmed (a key
 * pasted with a line break would break the HTTP header).
 * @param {unknown} raw - The raw value.
 * @returns {string} The key, '' when absent.
 * @example
 * readApiKey(' AIzaSyExample \n'); // -> 'AIzaSyExample'
 */
function readApiKey(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.replace(/[^\x21-\x7e]/g, '');
}

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config_schema values.
 * @returns {object} `{ apiKey, currentMinutes, forecastMinutes, dailyMinutes,
 * alertMinutes, alertsEnabled, monthlyBudget }`.
 * @example
 * normalizeConfig({ api_key: 'AIza…' });
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  const forecastMinutes = readNumber(config.forecast_minutes, FORECAST_MINUTES);
  return {
    apiKey: readApiKey(config.api_key),
    currentMinutes: readNumber(config.current_minutes, CURRENT_MINUTES),
    forecastMinutes,
    dailyMinutes: forecastMinutes * DAILY_FACTOR,
    alertMinutes: readNumber(config.alert_minutes, ALERT_MINUTES),
    alertsEnabled: readBoolean(config.alerts_enabled, true),
    monthlyBudget: readNumber(config.monthly_budget, MONTHLY_BUDGET),
  };
}

/**
 * @description Estimate the calls of one house over a 31-day month, when the
 * weather is read continuously (the core checks it every 30 minutes anyway).
 * @param {object} config - The normalizeConfig() result.
 * @returns {number} The estimated calls.
 * @example
 * monthlyEstimate(normalizeConfig({})); // -> 3968
 */
function monthlyEstimate(config) {
  const perDay = (minutes) => Math.ceil((24 * 60) / minutes);
  const daily =
    perDay(config.currentMinutes) +
    perDay(config.forecastMinutes) +
    perDay(config.dailyMinutes) +
    (config.alertsEnabled ? perDay(config.alertMinutes) : 0);
  return daily * 31;
}

/**
 * @description Read the stored language and unit system of the last request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {{ language: string, units: string }} fallback - The values to keep
 * when nothing valid is stored.
 * @returns {{ language: string, units: string }} The preferences.
 * @example
 * readPreferences({ last_language: 'fr', last_units: 'metric' }, { language: 'en', units: 'metric' });
 */
function readPreferences(rawConfig, fallback) {
  const config = rawConfig ?? {};
  const language = config[PREFERENCE_KEYS.language];
  const units = config[PREFERENCE_KEYS.units];
  return {
    language:
      typeof language === 'string' && /^[a-z]{2}$/.test(language) ? language : fallback.language,
    units: UNIT_SYSTEMS.includes(units) ? units : fallback.units,
  };
}

export {
  CURRENT_MINUTES,
  FORECAST_MINUTES,
  ALERT_MINUTES,
  MONTHLY_BUDGET,
  DAILY_FACTOR,
  PREFERENCE_KEYS,
  normalizeConfig,
  readApiKey,
  readBoolean,
  monthlyEstimate,
  readPreferences,
};
