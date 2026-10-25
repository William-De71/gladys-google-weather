import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import { SCENE_TRIGGERS } from '../src/alert-watcher.js';
import { SCENE_ACTIONS, MAX_DAY_OFFSET, RAIN_SPANS, RAIN_THRESHOLD } from '../src/scene-actions.js';
import { ACTIONS } from '../src/app.js';
import { WIDGETS, HOURLY_METRICS, HOURLY_SPANS, DAILY_SPANS } from '../src/widgets.js';
import {
  CURRENT_MINUTES,
  FORECAST_MINUTES,
  ALERT_MINUTES,
  MONTHLY_BUDGET,
  monthlyEstimate,
  normalizeConfig,
} from '../src/config.js';
import { CATEGORIES, SEVERITIES } from '../src/alerts.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('a weather integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'weather');
  assert.equal(manifest.name, 'Google Weather');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-google-weather:${pkg.version}`);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/William-De71/gladys-google-weather/main/cover.jpg',
  );
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-google-weather');
});

test('cloud transport only, the house coordinates as only permission, Gladys 5.3.0', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.doesNotMatch(source('../src/app.js'), /GLADYS_PREFER_LOCAL|publishTransports/);
  assert.equal(manifest.location, true, 'the alert watcher reads the houses');
  assert.match(source('../src/app.js'), /getHouses\(\)/);
  for (const key of ['network_wake', 'containers', 'network_discovery', 'webhooks']) {
    assert.equal(manifest[key], undefined, key);
  }
  assert.doesNotMatch(source('../src/widgets.js'), /fields:/, 'no button form: 5.1 is enough');
  assert.equal(manifest.gladys_version, '>=5.3.0');
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((x) => x.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(
    manifest.scene_actions.map((x) => x.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((x) => x.key).sort(), Object.values(WIDGETS).sort());
  assert.deepEqual(
    manifest.actions.map((x) => x.key),
    Object.values(ACTIONS),
  );
  const app = source('../src/app.js');
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(WIDGETS\\.${key}`), key);
  }
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(SCENE_ACTIONS\\.${key}`), key);
  }
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(ACTIONS\\.${key}`), key);
  }
  assert.match(app, /onWeatherGet\(/);
  assert.match(app, /onWidgetGetImage\(/);
});

test('mirrors the bounds and values of the code', () => {
  const config = byKey(manifest.config_schema);
  for (const [key, bounds] of [
    ['current_minutes', CURRENT_MINUTES],
    ['forecast_minutes', FORECAST_MINUTES],
    ['alert_minutes', ALERT_MINUTES],
    ['monthly_budget', MONTHLY_BUDGET],
  ]) {
    for (const bound of ['min', 'max', 'default']) {
      assert.equal(config.get(key)[bound], bounds[bound], `${key}.${bound}`);
    }
  }
  assert.equal(config.get('api_key').type, 'secret');
  assert.equal(config.get('api_key').required, true);
  assert.equal(config.get('alerts_enabled').default, true);
  for (const trigger of manifest.scene_triggers) {
    const fields = byKey(trigger.fields);
    assert.deepEqual(values(fields.get('category')), CATEGORIES, trigger.key);
    assert.deepEqual(values(fields.get('severity')), SEVERITIES, trigger.key);
    assert.equal(fields.get('house').type, 'string', 'source "houses" is in no release yet');
  }
  const actions = byKey(manifest.scene_actions);
  const day = byKey(actions.get('get_forecast').fields).get('day');
  assert.equal(values(day).length, MAX_DAY_OFFSET + 1);
  const rain = byKey(actions.get('get_rain').fields);
  assert.deepEqual(values(rain.get('hours')), RAIN_SPANS);
  for (const bound of ['min', 'max', 'default']) {
    assert.equal(rain.get('threshold')[bound], RAIN_THRESHOLD[bound], bound);
  }
  const widgets = byKey(manifest.widgets);
  const hourly = byKey(widgets.get('hourly').settings);
  assert.deepEqual(values(hourly.get('metric')), HOURLY_METRICS);
  assert.deepEqual(values(hourly.get('hours')), HOURLY_SPANS);
  assert.deepEqual(values(byKey(widgets.get('daily').settings).get('days')), DAILY_SPANS);
});

test('the default refresh stays well within the 10,000 free requests a month', () => {
  const estimate = monthlyEstimate(normalizeConfig({}));
  assert.equal(estimate, 3968);
  assert.ok(estimate * 2 < MONTHLY_BUDGET.default, 'two houses still fit under the cap');
  assert.ok(MONTHLY_BUDGET.default < 10000);
  const cost = byKey(manifest.config_schema).get('cost');
  assert.match(cost.description.en, /10,000/);
  assert.match(cost.description.en, /4,000/);
  // The per-field figures of the form.
  assert.match(byKey(manifest.config_schema).get('current_minutes').description.en, /1,488/);
  assert.match(byKey(manifest.config_schema).get('forecast_minutes').description.en, /992/);
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20);
  assert.ok(manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
    assert.ok((action.outputs ?? []).length <= 20, action.key);
    assert.ok((action.fields ?? []).length <= 10, action.key);
  }
  for (const widget of manifest.widgets) {
    assert.ok((widget.settings ?? []).length <= 10);
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('no host other than the documented ones in the code', () => {
  const hosts = new Set();
  for (const file of ['google-api.js', 'conditions.js', 'app.js', 'widgets.js', 'alerts.js']) {
    for (const [, host] of source(`../src/${file}`).matchAll(/https:\/\/([a-z0-9.-]+)/g)) {
      hosts.add(host);
    }
  }
  assert.deepEqual([...hosts].sort(), [
    // the documentation, in comments
    'developers.google.com',
    'maps.gstatic.com',
    // an example in a comment
    'vigilance.meteofrance.fr',
    'weather.googleapis.com',
  ]);
});

test('catalog keywords and countries of Gladys 5.3.0', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  const keywords = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.ok(keywords.length >= 1 && keywords.length <= 10, 'one to ten keywords');
  keywords.forEach((keyword) => assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword));
  assert.equal(new Set(keywords).size, keywords.length, 'unique once trimmed and lowercased');
  // Usable everywhere: no `countries`, the catalog shows it in every country.
  assert.equal(manifest.countries, undefined);
});
