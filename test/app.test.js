// The whole integration against the fake Gladys of the SDK and a fake Google.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS } from '../src/app.js';
import { SCENE_ACTIONS } from '../src/scene-actions.js';
import { SCENE_TRIGGERS } from '../src/alert-watcher.js';
import { WIDGETS } from '../src/widgets.js';
import { MESSAGES } from '../src/i18n.js';
import { API_KEY, fakeGoogle, googleError, silent } from './helpers/fakes.js';
import { LATITUDE, LONGITUDE, NOW, alert } from './helpers/fixtures.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const HOUSES = [
  { id: 'h1', name: 'Maison', selector: 'maison', latitude: LATITUDE, longitude: LONGITUDE },
  { id: 'h2', name: 'Chalet', selector: 'chalet', latitude: 45.9237, longitude: 6.8694 },
];
const MINUTE = 60 * 1000;

/**
 * @description The integration on a fake Gladys and a fake Google.
 * @param {object} [options] - { config, google, clock, houses, usagePath }.
 * @returns {Promise<object>} { gladys, app, google, clock }.
 */
async function startApp({
  config = { api_key: API_KEY },
  google = fakeGoogle(),
  clock = { now: NOW },
  houses = HOUSES,
  usagePath = null,
} = {}) {
  const gladys = createFakeGladys({ config: { ...config }, houses });
  const app = createApp(gladys, {
    fetchImpl: google,
    now: () => clock.now,
    logger: silent,
    usagePath,
  });
  await gladys.connect();
  await app.idle();
  return { gladys, app, google, clock };
}

const widgetOf = async (gladys, key, settings = {}, language = 'en', units = 'metric') => {
  const ack = await gladys.fake.widgetGet(key, { settings, language, units });
  return { ...ack, data: ack.data?.content };
};

const outputsOf = async (gladys, key, fields) => {
  const ack = await gladys.fake.sceneAction(key, fields);
  return { ...ack, data: ack.data?.outputs };
};

const weatherOf = async (gladys, options = {}) => {
  const ack = await gladys.fake.weatherGet({
    latitude: LATITUDE,
    longitude: LONGITUDE,
    language: 'fr',
    units: 'metric',
    ...options,
  });
  return { ...ack, data: ack.data?.weather };
};

test('without a key: says what to do, calls nobody, the core falls through', async (t) => {
  const { gladys, google } = await startApp({ config: {} });
  t.after(() => gladys.fake.shutdown());
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /clé API/);
  const ack = await weatherOf(gladys);
  assert.equal(ack.success, false);
  assert.equal(google.calls.length, 0);
  const widget = await widgetOf(gladys, WIDGETS.DAILY, {}, 'de');
  assert.match(widget.data.components[0].text, /API-Schlüssel/);
});

test('weather: pivot payload, then served from the cache', async (t) => {
  const { gladys, google, clock, app } = await startApp();
  t.after(() => gladys.fake.shutdown());
  // The baseline of the alert watcher: one alert request per house.
  assert.equal(google.count('publicAlerts:lookup'), 2);
  const ack = await weatherOf(gladys);
  assert.equal(ack.success, true, ack.error);
  const weather = ack.data;
  assert.equal(weather.temperature, 14.2);
  assert.equal(weather.hours.length, 24);
  assert.equal(weather.days.length, 8);
  assert.equal(weather.alerts[0].event, 'Vigilance orange orages');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const calls = google.calls.length;
  clock.now += 20 * MINUTE;
  await weatherOf(gladys);
  await weatherOf(gladys, { units: 'us' });
  assert.equal(google.calls.length, calls, 'nothing asked again within the durations');
  clock.now += 15 * MINUTE;
  await weatherOf(gladys);
  assert.equal(google.count('currentConditions:lookup'), 2, 'current: 30 min');
  assert.equal(google.count('forecast/hours:lookup'), 1, 'hourly: 60 min');
  assert.equal(app.usage.used(), google.calls.length);
  assert.deepEqual(gladys.fake.config.last_language, 'fr');
});

test('outside the coverage: the request fails so that Gladys uses the next provider', async (t) => {
  const google = fakeGoogle({
    failures: {
      'currentConditions:lookup': {
        status: 404,
        body: googleError(404, 'NOT_FOUND', 'Information is not supported for this location.'),
      },
    },
  });
  const { gladys } = await startApp({ google });
  t.after(() => gladys.fake.shutdown());
  const ack = await weatherOf(gladys, { latitude: 35.68, longitude: 139.69 });
  assert.equal(ack.success, false);
  assert.match(ack.error, /no data/);
  google.failures['forecast/hours:lookup'] = google.failures['currentConditions:lookup'];
  const widget = await widgetOf(gladys, WIDGETS.HOURLY, {}, 'fr');
  assert.equal(
    widget.data.components[0].text,
    'Google Weather ne fournit pas de données pour la position de cette maison.',
  );
});

test('a rejected key and a spent budget show in the connection status', async (t) => {
  const { gladys } = await startApp({ config: { api_key: 'AIzaWrong' } });
  t.after(() => gladys.fake.shutdown());
  await weatherOf(gladys);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /API_KEY_INVALID/);

  const second = await startApp({
    config: { api_key: API_KEY, monthly_budget: 100, alerts_enabled: false },
  });
  t.after(() => second.gladys.fake.shutdown());
  for (let index = 0; index < 100; index += 1) {
    await second.app.store.get('current', HOUSES[0], 'fr', { maxAgeMs: 0 });
  }
  const ack = await weatherOf(second.gladys);
  assert.equal(ack.success, true, 'the cached weather is still served');
  assert.equal(second.gladys.fake.connectionStatus.connected, false);
  assert.match(second.gladys.fake.connectionStatus.message.fr, /Budget mensuel atteint \(100\/100/);
});

test('the usage counter survives a restart (/data/usage.json)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const usagePath = join(dir, 'usage.json');
  const first = await startApp({ usagePath, config: { api_key: API_KEY, alerts_enabled: false } });
  await weatherOf(first.gladys);
  await first.gladys.fake.shutdown();
  assert.deepEqual(JSON.parse(readFileSync(usagePath, 'utf8')), { month: '2026-10', calls: 3 });
  const second = await startApp({ usagePath, config: { api_key: API_KEY, alerts_enabled: false } });
  t.after(() => second.gladys.fake.shutdown());
  assert.equal(second.app.usage.used(), 3);
});

test('alert triggers: baseline at start, then issued and ended, with the core nudged', async (t) => {
  let records = [];
  const google = fakeGoogle({ alerts: () => ({ weatherAlerts: records, regionCode: 'FR' }) });
  const { gladys, app, clock } = await startApp({ google });
  t.after(() => gladys.fake.shutdown());
  records = [alert({}, 'en')];
  clock.now += 30 * MINUTE;
  await app.watcher.check();
  const issued = gladys.fake.sceneEvents.filter(
    (event) => event.key === SCENE_TRIGGERS.ALERT_ISSUED,
  );
  assert.equal(issued.length, 2, 'both houses');
  assert.equal(issued[0].data.house, 'Maison');
  assert.equal(issued[0].data.severity, 'severe');
  assert.equal(gladys.fake.weatherRefreshes >= 1, true);
  assert.ok(gladys.fake.widgetRefreshes.includes(WIDGETS.ALERTS));
  const trigger = manifest.scene_triggers.find(
    (entry) => entry.key === SCENE_TRIGGERS.ALERT_ISSUED,
  );
  assert.deepEqual(
    Object.keys(issued[0].data).sort(),
    trigger.variables.map((variable) => variable.key).sort(),
  );
  records = [];
  for (const step of [1, 2]) {
    clock.now += 30 * MINUTE * step;
    await app.watcher.check();
  }
  const ended = gladys.fake.sceneEvents.filter((event) => event.key === SCENE_TRIGGERS.ALERT_ENDED);
  assert.equal(ended.length, 2);
  const endedTrigger = manifest.scene_triggers.find(
    (entry) => entry.key === SCENE_TRIGGERS.ALERT_ENDED,
  );
  assert.deepEqual(
    Object.keys(ended[0].data).sort(),
    endedTrigger.variables.map((variable) => variable.key).sort(),
  );
});

test('alerts switched off: no alert request, the widget says so', async (t) => {
  const { gladys, google } = await startApp({
    config: { api_key: API_KEY, alerts_enabled: false },
  });
  t.after(() => gladys.fake.shutdown());
  await weatherOf(gladys);
  assert.equal(google.count('publicAlerts:lookup'), 0);
  const widget = await widgetOf(gladys, WIDGETS.ALERTS, {}, 'es');
  assert.match(widget.data.components[1].text, /desactivadas/);
  await gladys.fake.configUpdated({ api_key: API_KEY, alerts_enabled: true });
  assert.equal(google.count('publicAlerts:lookup'), 2, 'switched on: a new baseline');
});

test('scene actions return only their declared outputs, as scalars', async (t) => {
  const { gladys } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await weatherOf(gladys);
  const declared = new Map(
    manifest.scene_actions.map((action) => [
      action.key,
      action.outputs.map((output) => output.key),
    ]),
  );
  const runs = [
    [SCENE_ACTIONS.GET_ALERTS, {}],
    [SCENE_ACTIONS.GET_FORECAST, { house: 'Chalet', day: '1' }],
    [SCENE_ACTIONS.GET_CURRENT, { house: '' }],
    [SCENE_ACTIONS.GET_RAIN, { hours: '12', threshold: 50 }],
  ];
  for (const [key, fields] of runs) {
    const ack = await gladys.fake.sceneAction(key, fields);
    ack.data = ack.data?.outputs;
    assert.equal(ack.success, true, `${key}: ${ack.error}`);
    assert.deepEqual(Object.keys(ack.data).sort(), [...declared.get(key)].sort(), key);
    for (const [name, value] of Object.entries(ack.data)) {
      assert.ok(
        value === null || ['string', 'number', 'boolean'].includes(typeof value),
        `${key}.${name}`,
      );
      assert.ok(typeof value !== 'string' || value.length <= 10000);
    }
  }
  const rain = await outputsOf(gladys, SCENE_ACTIONS.GET_RAIN, { hours: '12', threshold: 50 });
  assert.equal(rain.data.rain_expected, true);
  assert.equal(rain.data.first_time, '15:00');
  assert.match(rain.data.summary, /^Pluie attendue à Maison à partir de 15:00/);
  const forecast = await outputsOf(gladys, SCENE_ACTIONS.GET_FORECAST, { day: '1' });
  assert.equal(forecast.data.date, '2026-10-18');
  assert.equal(
    forecast.data.summary,
    'Météo demain à Maison : partiellement nuageux, de 7°C à 15°C.',
  );
  const current = await outputsOf(gladys, SCENE_ACTIONS.GET_CURRENT, {});
  assert.equal(current.data.wind_direction, 'SO');
  const widget = await widgetOf(gladys, WIDGETS.DAILY, { house: 'maison' }, 'fr');
  assert.match(widget.data.components[0].text, /« maison »/);
  const unknown = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_CURRENT, { house: 'maison' });
  assert.equal(unknown.success, false, 'house names are case-sensitive, like the trigger filter');
});

test('widgets: valid content in every language and both unit systems', async (t) => {
  const { gladys } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const settingsOf = {
    [WIDGETS.ALERTS]: [{}],
    [WIDGETS.DAILY]: [{}, { days: '10', show_icons: false }, { house: 'Chalet', days: '5' }],
    [WIDGETS.HOURLY]: [{}, { metric: 'precipitation' }, { metric: 'wind', hours: '12' }],
  };
  for (const [key, list] of Object.entries(settingsOf)) {
    for (const settings of list) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        for (const units of ['metric', 'us']) {
          const ack = await widgetOf(gladys, key, settings, language, units);
          assert.equal(ack.success, true, `${key} ${language}: ${ack.error}`);
          assert.deepEqual(validateWidgetContent(ack.data), [], `${key} ${language} ${units}`);
          assert.ok(ack.data.components.length > 1, `${key}: more than a message`);
        }
      }
    }
  }
});

test('widget images: documented icons only, as valid PNG', async (t) => {
  const { gladys, google } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const daily = await widgetOf(gladys, WIDGETS.DAILY, {}, 'fr');
  const keys = daily.data.components[1].items.map((item) => item.image);
  assert.ok(
    keys.every((key) => /^gw-[a-z-]+$/.test(key)),
    keys.join(),
  );
  const ack = await gladys.fake.widgetGetImage(keys[0]);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetImage(ack.data.image), []);
  const icon = google.calls.at(-1).url;
  assert.equal(icon.href, 'https://maps.gstatic.com/weather/v1/showers.png');
  const calls = google.calls.length;
  const rejected = await gladys.fake.widgetGetImage('gw-../../etc/passwd');
  assert.equal(rejected.success, false);
  assert.equal(google.calls.length, calls, 'nothing fetched for an unknown key');
});

test('test action: one fresh call, the usage and the estimate', async (t) => {
  const { gladys, google } = await startApp({ config: { api_key: API_KEY } });
  t.after(() => gladys.fake.shutdown());
  const before = google.count('currentConditions:lookup');
  const ack = await gladys.fake.action(ACTIONS.TEST_API_KEY);
  ack.data = ack.data?.message;
  assert.equal(ack.success, true, ack.error);
  assert.equal(google.count('currentConditions:lookup'), before + 1);
  assert.match(ack.data.fr, /^Clé API valide pour « Maison » : 14°C/);
  assert.match(ack.data.en, /about 3,968 a month/);
  const broken = await startApp({ config: { api_key: 'AIzaWrong' } });
  t.after(() => broken.gladys.fake.shutdown());
  const failed = await broken.gladys.fake.action(ACTIONS.TEST_API_KEY);
  failed.data = failed.data?.message;
  assert.match(failed.data.de, /API_KEY_INVALID/);
});

test('runtime messages fit the 200-character limit in every language', () => {
  const sample = { reason: 'API_KEY_SERVICE_BLOCKED', used: 9000, budget: 9000, month: '2026-10' };
  for (const [key, message] of Object.entries(MESSAGES)) {
    for (const [language, template] of Object.entries(message)) {
      const filled = template.replace(/\{(\w+)\}/g, (_, name) =>
        String(sample[name] ?? 'x'.repeat(12)),
      );
      if (!['testOk', 'testFailed', 'outOfCoverage', 'noHouse'].includes(key)) {
        assert.ok(filled.length <= 200, `${key}.${language}: ${filled.length}`);
      }
    }
  }
});
