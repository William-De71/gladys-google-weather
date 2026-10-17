// -----------------------------------------------------------------------------
// The Google Weather integration, wired to a Gladys client.
//
// `createApp(gladys)` registers every handler on the client it receives:
// `new GladysIntegration()` in production (index.js), the fake Gladys of the
// SDK in the tests. Nothing here connects: the caller does, once the
// handlers are registered.
//
// A WEATHER integration (manifest `type: "weather"`, contract B.18): Gladys
// asks for the weather of a location, we answer in the pivot format, and the
// core feeds its dashboard card, the chat assistant and its weather-alert
// trigger with it. On top of that:
//   - scene triggers "alert issued" / "alert ended" (alert-watcher.js), which
//     need the houses on their own: `location: true` and getHouses();
//   - scene actions get_alerts / get_forecast / get_current / get_rain;
//   - widgets alerts / daily / hourly, with Google's icons served by the
//     image handler;
//   - a "Test the API key" configuration action.
// Every Google call goes through the cache (weather-store.js) and the monthly
// counter (usage.js): the bill is the first design constraint.
// -----------------------------------------------------------------------------

import { join } from 'node:path';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, readPreferences, monthlyEstimate, PREFERENCE_KEYS } from './config.js';
import { createUsage } from './usage.js';
import { createWeatherApi, ApiKeyError, roundCoordinate } from './google-api.js';
import { createWeatherStore } from './weather-store.js';
import { createHouseRegistry } from './houses.js';
import { readAlerts } from './alerts.js';
import { createAlertWatcher } from './alert-watcher.js';
import { buildWeather, timeZoneOf } from './weather.js';
import { describe, iconUrlFromKey } from './conditions.js';
import { temperatureOf, unitLabels } from './units.js';
import {
  SCENE_ACTIONS,
  buildAlertsOutputs,
  buildForecastOutputs,
  buildCurrentOutputs,
  buildRainOutputs,
} from './scene-actions.js';
import {
  WIDGETS,
  TTL_SECONDS,
  text,
  messageContent,
  buildAlertsWidget,
  buildDailyWidget,
  buildHourlyWidget,
} from './widgets.js';
import { all } from './i18n.js';

const ACTIONS = { TEST_API_KEY: 'test_api_key' };
const MINUTE = 60 * 1000;
const MAX_ICON_BYTES = 300 * 1024;
const ICON_TIMEOUT_MS = 10 * 1000;
const DATA_DIR = process.env.GLADYS_DATA_DIR || '/data';

/**
 * @description Register the handlers of the integration on a Gladys client.
 * @param {object} gladys - The SDK client (or the fake one).
 * @param {object} [options] - Injections for the tests.
 * @param {Function} [options.fetchImpl] - `fetch`.
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {object} [options.logger] - Logger.
 * @param {string|null} [options.usagePath] - The usage file (null: memory).
 * @returns {object} `{ idle, store, usage, watcher }` for the tests.
 * @example
 * createApp(new GladysIntegration());
 */
function createApp(
  gladys,
  {
    fetchImpl = fetch,
    now = () => Date.now(),
    logger = sdkLogger,
    usagePath = join(DATA_DIR, 'usage.json'),
  } = {},
) {
  let config = normalizeConfig();
  // Language and unit system of the last request: the alert triggers and the
  // scene actions get none. Stored in the integration config (internal keys)
  // so the first alert after a restart is in the right language.
  let preferences = { language: 'en', units: 'metric' };
  let lastStatus = null;
  // Rounded location -> IANA time zone, learned from the answers.
  const timeZones = new Map();
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;

  const usage = createUsage({
    path: usagePath,
    getBudget: () => config.monthlyBudget,
    now,
    logger,
  });
  const api = createWeatherApi({ getApiKey: () => config.apiKey, usage, fetchImpl, logger });
  const store = createWeatherStore({
    api,
    now,
    logger,
    getTtlMinutes: (product) =>
      ({
        current: config.currentMinutes,
        hours: config.forecastMinutes,
        days: config.dailyMinutes,
        alerts: config.alertMinutes,
      })[product],
  });
  const houses = createHouseRegistry({ fetchHouses: () => gladys.getHouses(), logger });

  const zoneKey = ({ latitude, longitude }) =>
    `${roundCoordinate(latitude)},${roundCoordinate(longitude)}`;
  const learnZone = (location, ...answers) => {
    const zone = timeZoneOf(...answers);
    if (zone) {
      timeZones.set(zoneKey(location), zone);
    }
  };
  const zoneOf = (location) => timeZones.get(zoneKey(location)) ?? localZone;

  // --- Connection status ---------------------------------------------------------

  /**
   * @description Report the connection status, only when it changes.
   * @param {boolean} connected - Connected or not.
   * @param {object} [message] - Multilingual message.
   * @example
   * await setStatus(false, all('noKey'));
   */
  async function setStatus(connected, message) {
    const signature = JSON.stringify([connected, message?.en ?? null]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.warn(`Unable to report the connection status: ${err.message}`);
    }
  }

  /**
   * @description Reflect an API failure in the connection status: the key or
   * the budget need the user; a network hiccup does not.
   * @param {Error} err - The failure.
   * @example
   * await reportError(err);
   */
  async function reportError(err) {
    if (err.name === 'ApiKeyError') {
      await setStatus(
        false,
        err.reason === 'API_KEY_MISSING' ? all('noKey') : all('keyInvalid', { reason: err.reason }),
      );
    } else if (err.name === 'BudgetExceededError') {
      await setStatus(
        false,
        all('budget', { used: usage.used(), budget: config.monthlyBudget, month: usage.month() }),
      );
    } else if (err.name === 'QuotaError') {
      await setStatus(false, all('quota'));
    }
  }

  /**
   * @description Get a product through the cache, reporting the status.
   * @param {string} product - 'current' | 'hours' | 'days' | 'alerts'.
   * @param {object} location - { latitude, longitude }.
   * @param {string} language - The language.
   * @param {object} [options] - Passed to store.get().
   * @returns {Promise<object>} The answer.
   * @example
   * await fetchProduct('current', house, 'fr');
   */
  async function fetchProduct(product, location, language, options) {
    try {
      const answer = await store.get(product, location, language, options);
      learnZone(location, answer);
      if (!usage.exhausted()) {
        await setStatus(true);
      }
      return answer;
    } catch (err) {
      await reportError(err);
      throw err;
    }
  }

  /**
   * @description An optional product: its failure costs detail, never the answer.
   * @param {string} product - The product.
   * @param {object} location - The location.
   * @param {string} language - The language.
   * @param {any} fallback - The value on failure.
   * @returns {Promise<any>} The answer or the fallback.
   * @example
   * await optional('hours', house, 'fr', null);
   */
  async function optional(product, location, language, fallback) {
    try {
      return await fetchProduct(product, location, language);
    } catch (err) {
      logger.warn(`Google Weather ${product} unavailable: ${err.message}`);
      return fallback;
    }
  }

  /**
   * @description The alerts of a location ([] when switched off).
   * @param {object} location - The location.
   * @param {string} language - The language.
   * @param {object} [options] - Passed to store.get().
   * @returns {Promise<Array<object>>} The readAlerts() alerts.
   * @example
   * await alertsOf(house, 'fr');
   */
  async function alertsOf(location, language, options) {
    if (!config.alertsEnabled) {
      return [];
    }
    const answer = await fetchProduct('alerts', location, language, options);
    return readAlerts(answer.weatherAlerts, now());
  }

  /**
   * @description Remember the language and units of the last request, and
   * store them when they changed.
   * @param {object} options - { language, units }.
   * @example
   * rememberPreferences({ language: 'fr', units: 'metric' });
   */
  function rememberPreferences({ language, units }) {
    const next = {
      language: typeof language === 'string' && language ? language : preferences.language,
      units: units === 'us' || units === 'metric' ? units : preferences.units,
    };
    if (next.language === preferences.language && next.units === preferences.units) {
      return;
    }
    preferences = next;
    Promise.resolve()
      .then(() =>
        gladys.setConfig({
          [PREFERENCE_KEYS.language]: next.language,
          [PREFERENCE_KEYS.units]: next.units,
        }),
      )
      .catch((err) => logger.warn(`Unable to store the language and units: ${err.message}`));
  }

  // --- Weather provider ------------------------------------------------------------

  gladys.onWeatherGet(async ({ latitude, longitude, language, units }) => {
    rememberPreferences({ language, units });
    const location = { latitude, longitude };
    const lang = language || preferences.language;
    // The current conditions are required: their failure (outside the
    // coverage, no key, budget spent with nothing cached) fails the request
    // and the core falls through to the next provider.
    const current = await fetchProduct('current', location, lang);
    const [hourly, daily, alerts] = await Promise.all([
      optional('hours', location, lang, null),
      optional('days', location, lang, null),
      alertsOf(location, lang).catch((err) => {
        logger.warn(`Google Weather alerts unavailable: ${err.message}`);
        return [];
      }),
    ]);
    return buildWeather(
      { current, hourly, daily, alerts },
      { units: units === 'us' ? 'us' : 'metric', language: lang, now: now() },
    );
  });

  // --- Alert watcher ---------------------------------------------------------------

  const watcher = createAlertWatcher({
    houses,
    loadAlerts: async (house) => {
      // Younger than the watcher interval: each round asks Google once.
      const alerts = await alertsOf(house, preferences.language, {
        maxAgeMs: config.alertMinutes * MINUTE - 5000,
      });
      return { alerts, timeZone: zoneOf(house) };
    },
    publish: (key, data) => gladys.publishSceneEvent(key, data),
    onChange: (house) => {
      logger.info(`Alerts of house "${house.name}" changed: nudging Gladys`);
      // The fresh alerts are in the cache: the re-pull lands on them.
      gladys.requestWeatherRefresh();
      gladys.requestWidgetRefresh(WIDGETS.ALERTS);
    },
    getLanguage: () => preferences.language,
    getIntervalMs: () => config.alertMinutes * MINUTE,
    logger,
    now,
  });

  /**
   * @description Start or stop the watcher to match the configuration.
   * @returns {Promise<void>} Resolved after the baseline round, if started.
   * @example
   * await syncWatcher();
   */
  async function syncWatcher() {
    const wanted = Boolean(config.apiKey) && config.alertsEnabled;
    if (!wanted) {
      watcher.stop();
      return;
    }
    if (!watcher.running()) {
      await watcher.start();
    }
  }

  // --- Scene actions ---------------------------------------------------------------

  /**
   * @description Find the house a scene action or widget targets.
   * @param {string|null|undefined} name - The "House" field.
   * @returns {Promise<object>} The house.
   * @example
   * const house = await resolveHouse('Home');
   */
  async function resolveHouse(name) {
    if (houses.list().length === 0) {
      await houses.refresh();
    }
    return houses.resolve(name);
  }

  gladys.onSceneAction(SCENE_ACTIONS.GET_ALERTS, async (fields) => {
    const house = await resolveHouse(fields.house);
    const alerts = await alertsOf(house, preferences.language);
    return buildAlertsOutputs({
      alerts,
      house: house.name,
      timeZone: zoneOf(house),
      language: preferences.language,
    });
  });

  gladys.onSceneAction(SCENE_ACTIONS.GET_FORECAST, async (fields) => {
    const house = await resolveHouse(fields.house);
    const daily = await fetchProduct('days', house, preferences.language);
    return buildForecastOutputs({
      daily,
      house: house.name,
      language: preferences.language,
      units: preferences.units,
      day: fields.day,
      now: now(),
    });
  });

  gladys.onSceneAction(SCENE_ACTIONS.GET_CURRENT, async (fields) => {
    const house = await resolveHouse(fields.house);
    const current = await fetchProduct('current', house, preferences.language);
    return buildCurrentOutputs({
      current,
      house: house.name,
      language: preferences.language,
      units: preferences.units,
    });
  });

  gladys.onSceneAction(SCENE_ACTIONS.GET_RAIN, async (fields) => {
    const house = await resolveHouse(fields.house);
    const hourly = await fetchProduct('hours', house, preferences.language);
    return buildRainOutputs({
      hourly,
      house: house.name,
      language: preferences.language,
      units: preferences.units,
      fields,
      now: now(),
    });
  });

  // --- Dashboard widgets -----------------------------------------------------------

  /**
   * @description Build a widget, or the content explaining why there is none.
   * @param {string} key - The widget key.
   * @param {object} request - { settings, language, units }.
   * @param {Function} build - `(house, language, units) => Promise<object>`.
   * @returns {Promise<object>} The content.
   * @example
   * await widget('daily', request, async (house) => buildDailyWidget({...}));
   */
  async function widget(key, { settings = {}, language, units }, build) {
    rememberPreferences({ language, units });
    const lang = language || preferences.language;
    const ttl = TTL_SECONDS[key];
    if (!config.apiKey) {
      return messageContent(text('noKey', lang), ttl);
    }
    if (houses.list().length === 0) {
      await houses.refresh();
    }
    if (houses.list().length === 0) {
      return messageContent(text('noHouse', lang), ttl);
    }
    let house;
    try {
      house = houses.resolve(settings.house);
    } catch {
      return messageContent(text('unknownHouse', lang, { name: settings.house }), ttl);
    }
    try {
      return await build(house, lang, units === 'us' ? 'us' : 'metric', settings);
    } catch (err) {
      if (err.name === 'OutOfCoverageError') {
        return messageContent(text('outOfCoverage', lang), ttl);
      }
      logger.warn(`Widget ${key} failed: ${err.message}`);
      return messageContent(text('unavailable', lang, { reason: err.message.slice(0, 150) }), 60);
    }
  }

  gladys.onWidgetGet(WIDGETS.ALERTS, (request) =>
    widget(WIDGETS.ALERTS, request, async (house, language) =>
      buildAlertsWidget({
        alerts: await alertsOf(house, language),
        house,
        timeZone: zoneOf(house),
        language,
        enabled: config.alertsEnabled,
        now: now(),
      }),
    ),
  );

  gladys.onWidgetGet(WIDGETS.DAILY, (request) =>
    widget(WIDGETS.DAILY, request, async (house, language, units, settings) =>
      buildDailyWidget({
        daily: await fetchProduct('days', house, language),
        house,
        language,
        units,
        settings,
        now: now(),
      }),
    ),
  );

  gladys.onWidgetGet(WIDGETS.HOURLY, (request) =>
    widget(WIDGETS.HOURLY, request, async (house, language, units, settings) =>
      buildHourlyWidget({
        hourly: await fetchProduct('hours', house, language),
        house,
        language,
        units,
        settings,
        now: now(),
      }),
    ),
  );

  // Image keys name a documented Google icon (see conditions.js): the URL is
  // rebuilt from a fixed host and a known name, so nothing else can be fetched.
  gladys.onWidgetGetImage(async (imageKey) => {
    const url = iconUrlFromKey(imageKey);
    if (url === null) {
      throw new Error(`Unknown Google Weather icon key: ${imageKey}`);
    }
    const response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(ICON_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Icon ${imageKey}: HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) {
      throw new Error(`Icon ${imageKey}: unexpected size ${bytes.length}`);
    }
    return bytes.toString('base64');
  });

  // --- Configuration action ----------------------------------------------------

  gladys.onAction(ACTIONS.TEST_API_KEY, async () => {
    if (!config.apiKey) {
      return all('noKey');
    }
    await houses.refresh();
    if (houses.list().length === 0) {
      return all('noHouse');
    }
    const house = houses.list()[0];
    try {
      // Fresh on purpose: the point is to test the key now (one billable call).
      const current = await fetchProduct('current', house, preferences.language, {
        maxAgeMs: 0,
      });
      const estimate = monthlyEstimate(config);
      return all('testOk', (language) => ({
        house: house.name,
        temperature: `${Math.round(temperatureOf(current.temperature, preferences.units))}${unitLabels(preferences.units).temperature}`,
        sky: describe(current.weatherCondition) ?? '?',
        used: usage.used(),
        budget: config.monthlyBudget,
        estimate: estimate.toLocaleString(
          language === 'en' ? 'en-US' : `${language}-${language.toUpperCase()}`,
        ),
      }));
    } catch (err) {
      if (err.name === 'OutOfCoverageError') {
        return all('outOfCoverage');
      }
      if (err instanceof ApiKeyError) {
        return all('keyInvalid', { reason: err.reason });
      }
      return all('testFailed', { reason: err.message.slice(0, 120) });
    }
  });

  // --- Configuration ---------------------------------------------------------------

  /**
   * @description Apply a new configuration.
   * @param {object} rawConfig - The raw config.
   * @returns {Promise<void>} Resolved once applied.
   * @example
   * await applyConfig(await gladys.getConfig());
   */
  async function applyConfig(rawConfig) {
    const previousKey = config.apiKey;
    config = normalizeConfig(rawConfig);
    // A new key or shorter durations must take effect now.
    store.clear();
    if (config.apiKey !== previousKey) {
      lastStatus = null;
    }
    if (!config.apiKey) {
      await setStatus(false, all('noKey'));
    } else if (usage.exhausted()) {
      await reportError({ name: 'BudgetExceededError' });
    } else if (lastStatus === null) {
      await setStatus(true);
    }
    logger.info(
      `Configuration: current ${config.currentMinutes} min, hourly ${config.forecastMinutes} min, ` +
        `daily ${config.dailyMinutes} min, alerts ${config.alertsEnabled ? `${config.alertMinutes} min` : 'off'}, ` +
        `budget ${config.monthlyBudget}/month (about ${monthlyEstimate(config)} calls a month per house; ` +
        `${usage.used()} used in ${usage.month()})`,
    );
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    await applyConfig(rawConfig);
    await syncWatcher();
  });

  // --- Connection lifecycle ------------------------------------------------------
  // Each step on its own: a failing one must not keep the watcher from starting.
  let ready = Promise.resolve();
  gladys.on('connected', () => {
    ready = (async () => {
      try {
        const rawConfig = await gladys.getConfig();
        preferences = readPreferences(rawConfig, preferences);
        await applyConfig(rawConfig);
      } catch (err) {
        logger.error(`Unable to read the configuration: ${err.message}`);
      }
      await houses.refresh();
      await syncWatcher();
    })();
    return ready;
  });

  gladys.handleShutdown((signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    watcher.stop();
  });

  return {
    idle: () => ready,
    store,
    usage,
    watcher,
    preferences: () => preferences,
  };
}

export { ACTIONS, createApp };
