import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createWeatherApi,
  classifyError,
  languageCode,
  roundCoordinate,
  DAYS,
  HOURS,
} from '../src/google-api.js';
import { createUsage } from '../src/usage.js';
import { createWeatherStore, STALE_MAX_MS } from '../src/weather-store.js';
import { API_KEY, fakeGoogle, googleError, silent } from './helpers/fakes.js';
import { LATITUDE, LONGITUDE, NOW } from './helpers/fixtures.js';

const PARIS = { latitude: LATITUDE, longitude: LONGITUDE };

const setup = ({
  key = API_KEY,
  budget = 9000,
  google = fakeGoogle(),
  clock = { now: NOW },
} = {}) => {
  const usage = createUsage({ path: null, getBudget: () => budget, now: () => clock.now });
  const api = createWeatherApi({ getApiKey: () => key, usage, fetchImpl: google, logger: silent });
  return { api, usage, google, clock };
};

test('documented requests: location object, METRIC, languageCode, key in the header only', async () => {
  const { api, google } = setup();
  await api.current(48.858370123, 2.29448, 'fr');
  const [{ url, headers }] = google.calls;
  assert.equal(
    `${url.origin}${url.pathname}`,
    'https://weather.googleapis.com/v1/currentConditions:lookup',
  );
  assert.equal(url.searchParams.get('location.latitude'), '48.8584');
  assert.equal(url.searchParams.get('location.longitude'), '2.2945');
  assert.equal(url.searchParams.get('unitsSystem'), 'METRIC');
  assert.equal(url.searchParams.get('languageCode'), 'fr');
  assert.equal(headers['X-Goog-Api-Key'], API_KEY);
  assert.ok(!url.href.includes(API_KEY));
});

test('one request per product: 24 hours and 10 days in a single page each', async () => {
  const { api, google, usage } = setup();
  const hours = await api.hours(LATITUDE, LONGITUDE, 'en');
  const days = await api.days(LATITUDE, LONGITUDE, 'en');
  assert.equal(hours.forecastHours.length, 24);
  assert.equal(days.forecastDays.length, 10);
  const [hourCall, dayCall] = google.calls;
  assert.equal(hourCall.url.searchParams.get('hours'), String(HOURS));
  assert.equal(hourCall.url.searchParams.get('pageSize'), String(HOURS));
  assert.equal(dayCall.url.searchParams.get('days'), String(DAYS));
  assert.equal(
    dayCall.url.searchParams.get('pageSize'),
    String(DAYS),
    'the default page is 5 days',
  );
  assert.equal(usage.used(), 2);
});

test('alerts follow at most two pages and need no units', async () => {
  let page = 0;
  const google = fakeGoogle({
    alerts: (language, url) => {
      page += 1;
      assert.equal(url.searchParams.get('unitsSystem'), null);
      return page === 1
        ? { weatherAlerts: [{ alertId: 'a' }], regionCode: 'FR', nextPageToken: 'next' }
        : { weatherAlerts: [{ alertId: 'b' }], nextPageToken: 'again' };
    },
  });
  const { api, usage } = setup({ google });
  const answer = await api.alerts(LATITUDE, LONGITUDE, 'fr');
  assert.deepEqual(
    answer.weatherAlerts.map((alert) => alert.alertId),
    ['a', 'b'],
  );
  assert.equal(answer.regionCode, 'FR');
  assert.equal(google.calls[1].url.searchParams.get('pageToken'), 'next');
  assert.equal(usage.used(), 2, 'each page is a billable request');
});

test('errors: invalid key, API disabled, quota, outside the coverage, server error', async () => {
  const at = { latitude: 35.68, longitude: 139.69 };
  const cases = [
    [
      400,
      googleError(400, 'INVALID_ARGUMENT', 'API key not valid.', 'API_KEY_INVALID'),
      'ApiKeyError',
      'API_KEY_INVALID',
    ],
    [
      403,
      googleError(403, 'PERMISSION_DENIED', 'Weather API has not been used…', 'SERVICE_DISABLED'),
      'ApiKeyError',
      'SERVICE_DISABLED',
    ],
    [
      403,
      googleError(403, 'PERMISSION_DENIED', 'Billing must be enabled.', 'BILLING_DISABLED'),
      'ApiKeyError',
      'BILLING_DISABLED',
    ],
    [
      429,
      googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded.'),
      'QuotaError',
      'RESOURCE_EXHAUSTED',
    ],
    [
      404,
      googleError(404, 'NOT_FOUND', 'Information is not supported for this location.'),
      'OutOfCoverageError',
      'OUT_OF_COVERAGE',
    ],
    [
      400,
      googleError(400, 'INVALID_ARGUMENT', 'Location is not supported.'),
      'OutOfCoverageError',
      'OUT_OF_COVERAGE',
    ],
    [503, googleError(503, 'UNAVAILABLE', 'Try again.'), 'GoogleWeatherError', 'UNAVAILABLE'],
  ];
  for (const [status, body, name, reason] of cases) {
    const err = classifyError(status, body, at);
    assert.equal(err.name, name, `${status} ${reason}`);
    assert.equal(err.reason, reason);
  }
  const google = fakeGoogle({ failures: { '*': { status: 503, body: null } } });
  const { api, usage } = setup({ google });
  await assert.rejects(api.current(LATITUDE, LONGITUDE, 'en'), {
    name: 'GoogleWeatherError',
    status: 503,
  });
  assert.equal(usage.used(), 0, 'a failed request is not billed');
});

test('a wrong key is reported as such; no key means no request', async () => {
  const wrong = setup({ key: 'AIzaWrong' });
  await assert.rejects(wrong.api.current(LATITUDE, LONGITUDE, 'en'), {
    name: 'ApiKeyError',
    reason: 'API_KEY_INVALID',
  });
  const none = setup({ key: '' });
  await assert.rejects(none.api.current(LATITUDE, LONGITUDE, 'en'), {
    name: 'ApiKeyError',
    reason: 'API_KEY_MISSING',
  });
  assert.equal(none.google.calls.length, 0);
});

test('an answer without temperature is out of coverage', async () => {
  const google = fakeGoogle();
  const original = google;
  const wrapped = async (input, init) => {
    const response = await original(input, init);
    return { ...response, json: async () => ({ timeZone: { id: 'Asia/Tokyo' } }) };
  };
  wrapped.calls = google.calls;
  const { api } = setup({ google: wrapped });
  await assert.rejects(api.current(35.68, 139.69, 'en'), { name: 'OutOfCoverageError' });
});

test('the monthly budget stops every call, and resets with the month', async () => {
  const clock = { now: NOW };
  const { api, usage, google } = setup({ budget: 2, clock });
  await api.current(LATITUDE, LONGITUDE, 'en');
  await api.days(LATITUDE, LONGITUDE, 'en');
  await assert.rejects(api.hours(LATITUDE, LONGITUDE, 'en'), { name: 'BudgetExceededError' });
  assert.equal(google.calls.length, 2);
  assert.equal(usage.exhausted(), true);
  clock.now = Date.parse('2026-11-01T00:00:01Z');
  assert.equal(usage.used(), 0);
  await api.hours(LATITUDE, LONGITUDE, 'en');
  assert.equal(usage.month(), '2026-11');
});

test('helpers: language codes and rounding', () => {
  assert.equal(languageCode('fr'), 'fr');
  assert.equal(languageCode('pt-BR'), 'pt-BR');
  assert.equal(languageCode('fr\r\nX: y'), 'en');
  assert.equal(languageCode(undefined), 'en');
  assert.equal(roundCoordinate(-0.123456), -0.1235);
});

test('store: cache per product, shared in-flight requests, stale answer on failure', async () => {
  const clock = { now: NOW };
  const google = fakeGoogle();
  const { api } = setup({ google, clock });
  const store = createWeatherStore({
    api,
    getTtlMinutes: () => 30,
    now: () => clock.now,
    logger: silent,
  });
  await Promise.all([store.get('current', PARIS, 'fr'), store.get('current', PARIS, 'fr')]);
  assert.equal(google.count('currentConditions:lookup'), 1, 'single flight');
  clock.now += 29 * 60 * 1000;
  await store.get('current', { latitude: 48.85661, longitude: 2.35219 }, 'fr');
  assert.equal(google.count('currentConditions:lookup'), 1, 'same rounded place, still fresh');
  await store.get('current', PARIS, 'de');
  assert.equal(google.count('currentConditions:lookup'), 2, 'another language is another answer');
  clock.now += 2 * 60 * 1000;
  google.failures['*'] = { status: 503, body: null };
  const stale = await store.get('current', PARIS, 'fr');
  assert.equal(stale.temperature.degrees, 14.2, 'previous answer served');
  clock.now += STALE_MAX_MS;
  await assert.rejects(store.get('current', PARIS, 'fr'), { status: 503 });
  delete google.failures['*'];
  await store.get('current', PARIS, 'fr', { maxAgeMs: 0 });
  assert.equal(google.count('currentConditions:lookup'), 5);
});
