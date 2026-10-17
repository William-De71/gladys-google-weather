import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_ALERT_TYPES } from '@gladysassistant/integration-sdk';

import {
  CATEGORIES,
  CATEGORY_TYPES,
  EVENT_CATEGORY,
  classifyEvent,
  readAlerts,
  toPivotAlerts,
  countBySeverity,
  httpsUrl,
} from '../src/alerts.js';
import { createAlertWatcher, buildIssuedData, SCENE_TRIGGERS } from '../src/alert-watcher.js';
import { alert, alerts, NOW, TIME_ZONE } from './helpers/fixtures.js';
import { silent } from './helpers/fakes.js';

// Every WeatherEventType of the reference, but WEATHER_EVENT_TYPE_UNSPECIFIED.
const DOCUMENTED_EVENT_TYPES =
  `ACID_RAIN AFTERSHOCK AVALANCHE BLIZZARD BLOWING_SNOW BUSHFIRE COASTAL_FLOOD
COASTAL_HAZARD COLD CYCLONE DROUGHT DUST_STORM EARTHQUAKE EXTRATROPICAL_CYCLONE FIRE FIRE_WEATHER
FLASH_FLOOD FLOOD FOG FREEZING FREEZING_AIR_TEMPERATURE FREEZING_DRIZZLE FREEZING_RAIN_EVENT FROST GALE
GLAZE HAIL HAZARDOUS_SEAS HEAT HUMIDITY HURRICANE ICE_STORM INDUSTRIAL_FIRE LAKE_EFFECT_SNOW LANDSLIDE
MONSOON MUDDY_FLOOD OUTFLOW RADIATION RAIN_EVENT RIVER_FLOODING SEVERE_THUNDERSTORM_WARNING SNOWSQUALL
SNOW_EVENT STORM STORM_SURGE THUNDER THUNDERSTORM TORNADO TORNADO_WARNING TROPICAL_CYCLONE
TROPICAL_CYCLONE_WARNINGS_AND_WATCHES TROPICAL_DISTURBANCE TROPICAL_STORM TSUNAMI TYPHOON VOLCANIC_ASH
VOLCANIC_ERUPTION WILDFIRE WIND WIND_CHILL WIND_WAVE WINTER_STORM`.split(/\s+/);

test('every documented event type has exactly one category, and a valid pivot type', () => {
  assert.deepEqual(Object.keys(EVENT_CATEGORY).sort(), [...DOCUMENTED_EVENT_TYPES].sort());
  const pivots = new Set(Object.values(WEATHER_ALERT_TYPES));
  for (const type of DOCUMENTED_EVENT_TYPES) {
    const { category, pivot } = classifyEvent(type);
    assert.ok(CATEGORIES.includes(category), type);
    assert.ok(pivot === undefined || pivots.has(pivot), `${type}: ${pivot}`);
  }
  assert.equal(classifyEvent('AVALANCHE').pivot, WEATHER_ALERT_TYPES.AVALANCHE);
  assert.deepEqual(classifyEvent('NEW_TYPE'), { category: 'other', pivot: undefined });
  assert.equal(CATEGORY_TYPES.other[1].length, 0);
});

test('reading: localized title, severity order, past and expired alerts dropped', () => {
  const records = [
    ...alerts('fr').weatherAlerts,
    alert({ alertId: 'old', expirationTime: '2026-10-17T07:00:00Z' }),
    alert({ alertId: 'past', urgency: 'PAST' }),
    { eventType: 'WIND' },
  ];
  const read = readAlerts(records, NOW);
  assert.deepEqual(
    read.map((item) => [item.title, item.severity, item.category]),
    [
      ['Vigilance orange orages', 'severe', 'thunderstorm'],
      ['Vigilance jaune vent violent', 'moderate', 'wind'],
    ],
  );
  const [storm] = read;
  assert.equal(storm.urgency, 'future');
  assert.equal(storm.certainty, 'likely');
  assert.equal(storm.source, 'Météo-France');
  assert.equal(storm.url, 'https://vigilance.meteofrance.fr/');
  assert.match(storm.instruction, /Unplug sensitive/);
  assert.match(storm.instruction, /Shelter indoors — Away from trees/);
  assert.deepEqual(countBySeverity(read), {
    extreme: 0,
    severe: 1,
    moderate: 1,
    minor: 0,
    unknown: 0,
  });
  assert.equal(httpsUrl('javascript:alert(1)'), null);
  assert.equal(httpsUrl('http://example.com'), null);
});

test('pivot alerts: unknown severity as minor, event bounded, at most 10', () => {
  const many = Array.from({ length: 12 }, (_, index) =>
    alert({
      alertId: `a${index}`,
      severity: 'SEVERITY_UNKNOWN',
      alertTitle: { text: 'x'.repeat(150) },
    }),
  );
  const pivot = toPivotAlerts(readAlerts(many, NOW), 'en');
  assert.equal(pivot.length, 10);
  assert.equal(pivot[0].severity, 'minor');
  assert.equal(pivot[0].event.length, 100);
  const untitled = toPivotAlerts(
    readAlerts([alert({ alertTitle: undefined, eventType: 'EARTHQUAKE' })], NOW),
    'de',
  );
  assert.equal(untitled[0].event, 'Erdbeben / Vulkan');
  assert.equal(untitled[0].type, undefined);
});

test('event data: flat scalars, strings ≤ 1000, ≤ 30 keys', () => {
  const [storm] = readAlerts([alert({ description: 'd'.repeat(3000) })], NOW);
  const data = buildIssuedData(storm, { house: 'Maison', language: 'fr', timeZone: TIME_ZONE });
  assert.ok(Object.keys(data).length <= 30);
  for (const [key, value] of Object.entries(data)) {
    assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value), key);
    assert.ok(typeof value !== 'string' || value.length <= 1000, key);
  }
  assert.equal(data.ends, 'dim. 06:00');
  assert.equal(
    data.summary,
    "Alerte météo pour Maison : Orange warning: thunderstorms (sévère) jusqu'à dim. 06:00.",
  );
});

/**
 * @description A watcher on a scripted list of answers.
 * @returns {object} { watcher, events, set, changes, clock }.
 */
function scripted() {
  const clock = { now: NOW };
  let records = [];
  const events = [];
  let changes = 0;
  const house = { id: 'h1', name: 'Maison', latitude: 48.85, longitude: 2.35 };
  const watcher = createAlertWatcher({
    houses: { refresh: async () => [house] },
    loadAlerts: async () => ({ alerts: readAlerts(records, clock.now), timeZone: TIME_ZONE }),
    publish: async (key, data) => events.push({ key, data }),
    onChange: () => {
      changes += 1;
    },
    getLanguage: () => 'fr',
    getIntervalMs: () => 60000,
    logger: silent,
    now: () => clock.now,
  });
  return {
    watcher,
    events,
    clock,
    set: (next) => {
      records = next;
    },
    changes: () => changes,
  };
}

test('watcher: baseline, issued, update under a new id, upgrade, ended after two absences', async () => {
  const { watcher, events, set, changes } = scripted();
  const yellow = alert({ alertId: 'w1', eventType: 'WIND', severity: 'MODERATE' });
  set([alert({ alertId: 's1' })]);
  await watcher.check();
  assert.equal(events.length, 0, 'the first check is a baseline');

  set([alert({ alertId: 's1' }), yellow]);
  await watcher.check();
  assert.deepEqual(
    events.map((event) => [event.key, event.data.category, event.data.severity]),
    [[SCENE_TRIGGERS.ALERT_ISSUED, 'wind', 'moderate']],
  );

  // Re-issued under a new id, same type and severity: the same episode.
  set([alert({ alertId: 's2' }), yellow]);
  await watcher.check();
  assert.equal(events.length, 1);

  // Yellow wind becomes orange: ended + issued.
  set([alert({ alertId: 's2' }), alert({ alertId: 'w2', eventType: 'WIND', severity: 'SEVERE' })]);
  await watcher.check();
  assert.deepEqual(
    events.slice(1).map((event) => [event.key, event.data.severity]),
    [
      [SCENE_TRIGGERS.ALERT_ENDED, 'moderate'],
      [SCENE_TRIGGERS.ALERT_ISSUED, 'severe'],
    ],
  );

  // One empty answer is not an end; two are.
  set([alert({ alertId: 'w2', eventType: 'WIND', severity: 'SEVERE' })]);
  await watcher.check();
  assert.equal(events.length, 3);
  await watcher.check();
  assert.deepEqual(events.at(-1).data.event_type, 'THUNDERSTORM');
  assert.equal(events.at(-1).key, SCENE_TRIGGERS.ALERT_ENDED);
  assert.ok(changes() >= 4);
});

test('watcher: an expired alert ends at once; a stopped watcher starts a new baseline', async () => {
  const { watcher, events, set, clock } = scripted();
  const short = alert({ alertId: 'x', expirationTime: '2026-10-17T09:00:00Z' });
  set([]);
  await watcher.check();
  set([short]);
  await watcher.check();
  assert.equal(events.length, 1);
  clock.now = Date.parse('2026-10-17T09:30:00Z');
  await watcher.check();
  assert.equal(events.at(-1).key, SCENE_TRIGGERS.ALERT_ENDED);
  set([alert({ alertId: 'y' })]);
  watcher.stop();
  await watcher.check();
  assert.equal(events.length, 2, 'after a stop, the next check is a baseline again');
});
