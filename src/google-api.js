// -----------------------------------------------------------------------------
// Client of the Google Maps Platform Weather API (v1).
//
// Documented endpoints only (https://developers.google.com/maps/documentation/weather):
//   GET /v1/currentConditions:lookup   current conditions
//   GET /v1/forecast/hours:lookup      up to 240 hours, pages of 1-24 (default 24)
//   GET /v1/forecast/days:lookup       up to 10 days, pages of 1-10 (default 5!)
//   GET /v1/publicAlerts:lookup        official alerts intersecting the location
// The location is a LatLng object passed as `location.latitude` and
// `location.longitude`; `languageCode` (BCP-47) localizes the descriptions,
// `unitsSystem` defaults to METRIC (asked explicitly anyway). The conversion
// to the unit system of the user is done here, so one cached answer serves
// both systems.
//
// The key travels in the `X-Goog-Api-Key` header, never in the URL: URLs end
// up in logs and error messages. Every successful request is billable (SKU
// "Weather Usage"): each one is counted (usage.js), and a page beyond the
// first is a request of its own — hence `pageSize` set to the maximum.
// -----------------------------------------------------------------------------

const API_BASE = 'https://weather.googleapis.com/v1';
const TIMEOUT_MS = 10 * 1000;
const HOURS = 24;
const DAYS = 10;
// Alerts are rarely more than a handful; a cap keeps a misbehaving
// pagination from burning the budget.
const MAX_ALERT_PAGES = 2;

/** @description Any failure of the Weather API. */
class GoogleWeatherError extends Error {
  /**
   * @param {string} message - The message (never contains the key).
   * @param {number|null} status - The HTTP status (null: network).
   * @param {string|null} [reason] - The google.rpc.ErrorInfo reason.
   */
  constructor(message, status, reason = null) {
    super(message);
    this.name = 'GoogleWeatherError';
    this.status = status;
    this.reason = reason;
  }
}

/**
 * @description The key is missing, invalid, restricted, or the project
 * cannot use the API (not enabled, no billing). Retrying will not help until
 * the user acts: `reason` says what to fix.
 */
class ApiKeyError extends GoogleWeatherError {
  constructor(message, status, reason) {
    super(message, status, reason);
    this.name = 'ApiKeyError';
  }
}

/** @description Google refused for quota (429 RESOURCE_EXHAUSTED). */
class QuotaError extends GoogleWeatherError {
  constructor(message, status, reason) {
    super(message, status, reason);
    this.name = 'QuotaError';
  }
}

/**
 * @description The location has no weather data (China, Japan, South Korea,
 * Vietnam, Iran… per the coverage table). Thrown so that the provider loop of
 * the core falls through to the next weather provider.
 */
class OutOfCoverageError extends GoogleWeatherError {
  constructor(latitude, longitude) {
    super(`Google Weather has no data for (${latitude}, ${longitude})`, 404, 'OUT_OF_COVERAGE');
    this.name = 'OutOfCoverageError';
  }
}

/** @description The monthly budget of the integration is spent. */
class BudgetExceededError extends GoogleWeatherError {
  constructor(budget) {
    super(`Monthly budget of ${budget} Weather API calls reached`, null, 'BUDGET_EXCEEDED');
    this.name = 'BudgetExceededError';
  }
}

// ErrorInfo reasons that point at the key or the Cloud project.
const KEY_REASONS = new Set([
  'API_KEY_INVALID',
  'API_KEY_EXPIRED',
  'API_KEY_SERVICE_BLOCKED',
  'API_KEY_IP_ADDRESS_BLOCKED',
  'API_KEY_HTTP_REFERRER_BLOCKED',
  'API_KEY_ANDROID_APP_BLOCKED',
  'API_KEY_IOS_APP_BLOCKED',
  'SERVICE_DISABLED',
  'BILLING_DISABLED',
  'CONSUMER_INVALID',
  'PERMISSION_DENIED',
]);

/**
 * @description Read a Google error body ({ error: { code, message, status, details } }).
 * @param {object|null} body - The parsed body.
 * @returns {{ message: string, status: string|null, reason: string|null }} The error.
 * @example
 * readError({ error: { message: 'API key not valid.', status: 'INVALID_ARGUMENT',
 *   details: [{ reason: 'API_KEY_INVALID' }] } });
 */
function readError(body) {
  const error = body?.error ?? {};
  const details = Array.isArray(error.details) ? error.details : [];
  const info = details.find((detail) => typeof detail?.reason === 'string');
  return {
    message: typeof error.message === 'string' ? error.message.slice(0, 300) : '',
    status: typeof error.status === 'string' ? error.status : null,
    reason: info?.reason ?? null,
  };
}

/**
 * @description Turn an HTTP failure into the right error class.
 * @param {number} httpStatus - The HTTP status.
 * @param {object|null} body - The parsed body.
 * @param {object} location - { latitude, longitude }.
 * @returns {GoogleWeatherError} The error.
 * @example
 * classifyError(403, body, { latitude: 48.85, longitude: 2.35 });
 */
function classifyError(httpStatus, body, { latitude, longitude }) {
  const { message, status, reason } = readError(body);
  const text = `Weather API ${httpStatus}${status ? ` ${status}` : ''}${message ? `: ${message}` : ''}`;
  if (reason !== null && KEY_REASONS.has(reason)) {
    return new ApiKeyError(text, httpStatus, reason);
  }
  if (httpStatus === 401 || httpStatus === 403 || /api key/i.test(message)) {
    return new ApiKeyError(text, httpStatus, reason ?? status ?? 'PERMISSION_DENIED');
  }
  if (httpStatus === 429) {
    return new QuotaError(text, httpStatus, reason ?? status);
  }
  // A location the API does not cover. The documentation does not spell out
  // the answer: a NOT_FOUND, or an INVALID_ARGUMENT about the location.
  if (
    httpStatus === 404 ||
    (httpStatus === 400 && /location|region|not supported|unsupported|coverage/i.test(message))
  ) {
    return new OutOfCoverageError(latitude, longitude);
  }
  return new GoogleWeatherError(text, httpStatus, reason ?? status);
}

/**
 * @description The BCP-47 code sent as `languageCode`.
 * @param {string} language - The Gladys language ('en', 'fr', 'de', 'es'…).
 * @returns {string} The code ('en' for anything unexpected).
 * @example
 * languageCode('fr'); // -> 'fr'
 */
function languageCode(language) {
  return typeof language === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)
    ? language
    : 'en';
}

/**
 * @description Round a coordinate (4 decimals, about 11 m): the cache key and
 * the request use the same value.
 * @param {number} value - Latitude or longitude.
 * @returns {number} The rounded value.
 * @example
 * roundCoordinate(48.858370123); // -> 48.8584
 */
function roundCoordinate(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

/**
 * @description Create the Weather API client.
 * @param {object} options - Options.
 * @param {Function} options.getApiKey - `() => string`.
 * @param {object} options.usage - The usage counter (usage.js).
 * @param {Function} [options.fetchImpl] - `fetch` (injected by the tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} `{ current, hours, days, alerts }`, each
 * `(latitude, longitude, language) => Promise<object>`.
 * @example
 * const api = createWeatherApi({ getApiKey: () => key, usage });
 */
function createWeatherApi({ getApiKey, usage, fetchImpl = fetch, logger = console }) {
  /**
   * @description One GET request.
   * @param {string} path - The method path ("currentConditions:lookup").
   * @param {object} location - { latitude, longitude }.
   * @param {object} params - Extra query parameters.
   * @returns {Promise<object>} The parsed body.
   * @example
   * await get('forecast/days:lookup', location, { days: 10 });
   */
  async function get(path, location, params) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new ApiKeyError('No API key configured', null, 'API_KEY_MISSING');
    }
    if (usage.exhausted()) {
      throw new BudgetExceededError(usage.used());
    }
    const query = new URLSearchParams({
      'location.latitude': String(location.latitude),
      'location.longitude': String(location.longitude),
      ...Object.fromEntries(
        Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
      ),
    });
    let response;
    try {
      response = await fetchImpl(`${API_BASE}/${path}?${query}`, {
        headers: { 'X-Goog-Api-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new GoogleWeatherError(`Weather API unreachable: ${err.message}`, null);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      throw classifyError(response.status, body, location);
    }
    usage.record();
    logger.debug?.(`Weather API ${path} OK (${usage.used()} call(s) this month)`);
    return body ?? {};
  }

  const at = (latitude, longitude) => ({
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
  });

  return {
    async current(latitude, longitude, language) {
      const location = at(latitude, longitude);
      const body = await get('currentConditions:lookup', location, {
        unitsSystem: 'METRIC',
        languageCode: languageCode(language),
      });
      // An answer without a temperature is no weather at all.
      if (typeof body.temperature?.degrees !== 'number') {
        throw new OutOfCoverageError(location.latitude, location.longitude);
      }
      return body;
    },

    async hours(latitude, longitude, language) {
      const location = at(latitude, longitude);
      return get('forecast/hours:lookup', location, {
        unitsSystem: 'METRIC',
        languageCode: languageCode(language),
        hours: HOURS,
        pageSize: HOURS,
      });
    },

    async days(latitude, longitude, language) {
      const location = at(latitude, longitude);
      return get('forecast/days:lookup', location, {
        unitsSystem: 'METRIC',
        languageCode: languageCode(language),
        days: DAYS,
        // The default page holds 5 days: 10 in one billable request.
        pageSize: DAYS,
      });
    },

    async alerts(latitude, longitude, language) {
      const location = at(latitude, longitude);
      const weatherAlerts = [];
      let regionCode = null;
      let pageToken;
      for (let page = 0; page < MAX_ALERT_PAGES; page += 1) {
        const body = await get('publicAlerts:lookup', location, {
          languageCode: languageCode(language),
          pageToken,
        });
        if (Array.isArray(body.weatherAlerts)) {
          weatherAlerts.push(...body.weatherAlerts);
        }
        regionCode = body.regionCode ?? regionCode;
        pageToken = body.nextPageToken;
        if (!pageToken) {
          break;
        }
      }
      return { weatherAlerts, regionCode };
    },
  };
}

export {
  API_BASE,
  HOURS,
  DAYS,
  GoogleWeatherError,
  ApiKeyError,
  QuotaError,
  OutOfCoverageError,
  BudgetExceededError,
  readError,
  classifyError,
  languageCode,
  roundCoordinate,
  createWeatherApi,
};
