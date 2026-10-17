import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_CONDITIONS, WEATHER_ALERT_TYPES } from '@gladysassistant/integration-sdk';

import { buildWeather, buildDay, dateOf } from '../src/weather.js';
import {
  CONDITIONS,
  ICON_NAMES,
  readCondition,
  iconKey,
  iconNameFromUri,
  iconUrlFromKey,
} from '../src/conditions.js';
import { temperatureOf, speedOf, precipitationOf, distanceOf, compassOf } from '../src/units.js';
import { readAlerts } from '../src/alerts.js';
import { current, hourly, daily, alerts, NOW } from './helpers/fixtures.js';

const PIVOT = new Set(Object.values(WEATHER_CONDITIONS));

test('metric pivot payload: every current field, from the documented answer', () => {
  const weather = buildWeather(
    {
      current: current('fr'),
      hourly: hourly('fr'),
      daily: daily('fr'),
      alerts: readAlerts(alerts('fr').weatherAlerts, NOW),
    },
    { units: 'metric', language: 'fr', now: NOW },
  );
  assert.equal(weather.temperature, 14.2);
  assert.equal(weather.weather, WEATHER_CONDITIONS.PARTLY_CLOUDY);
  assert.equal(weather.is_day, true);
  assert.equal(weather.apparent_temperature, 12.9);
  assert.equal(weather.humidity, 72);
  assert.equal(weather.dew_point, 9.1);
  assert.equal(weather.pressure, 1016.4);
  assert.equal(weather.wind_speed, 3.9, '14 km/h in m/s');
  assert.equal(weather.wind_gust, 8.1);
  assert.equal(weather.wind_direction, 225);
  assert.equal(weather.visibility, 16);
  assert.equal(weather.cloud_cover, 45);
  assert.equal(weather.uv_index, 2);
  assert.equal(weather.sunrise, '2026-10-17T06:22:00Z');
  assert.equal(weather.sunset, '2026-10-17T16:56:00Z');
  assert.equal(weather.hours.length, 24);
  assert.equal(weather.days.length, 8, 'Gladys keeps 8 days');
  assert.equal(weather.alerts.length, 2);
  for (const hour of weather.hours) {
    assert.ok(PIVOT.has(hour.weather), hour.weather);
    assert.equal(typeof hour.is_day, 'boolean');
  }
  const [first] = weather.hours;
  assert.equal(first.datetime, '2026-10-17T08:00:00Z');
  assert.equal(first.precipitation_probability, 10);
  const [today] = weather.days;
  assert.equal(today.datetime, '2026-10-17T05:00:00Z', 'the start of the local forecast day');
  assert.equal(today.temperature_max, 16.8);
  assert.equal(today.temperature_min, 8.9);
  assert.equal(today.precipitation_probability, 70, 'max of day and night');
  assert.equal(today.precipitation, 7.5, 'day + night');
  assert.equal(today.weather, WEATHER_CONDITIONS.RAIN);
  const [storm] = weather.alerts;
  assert.deepEqual(
    { severity: storm.severity, event: storm.event, type: storm.type },
    {
      severity: 'severe',
      event: 'Vigilance orange orages',
      type: WEATHER_ALERT_TYPES.THUNDERSTORM,
    },
  );
  assert.match(storm.description, /Unplug/);
});

test('US units: °F, mph, inches, miles', () => {
  const weather = buildWeather(
    { current: current(), hourly: hourly(), daily: daily() },
    { units: 'us', now: NOW },
  );
  assert.equal(weather.temperature, 57.6);
  assert.equal(weather.wind_speed, 8.7);
  assert.equal(weather.visibility, 9.9);
  assert.equal(weather.days[0].precipitation, 0.29);
  assert.equal(temperatureOf({ degrees: 68, unit: 'FAHRENHEIT' }, 'metric'), 20);
  assert.equal(speedOf({ value: 10, unit: 'MILES_PER_HOUR' }, 'us'), 10);
  assert.equal(precipitationOf({ quantity: 1, unit: 'INCHES' }, 'metric'), 25.4);
  assert.equal(distanceOf({ distance: 10, unit: 'MILES' }, 'metric'), 16.1);
});

test('only the current conditions are required; the hours already past are left out', () => {
  const weather = buildWeather({ current: current() }, { units: 'metric', now: NOW });
  assert.equal(weather.hours, undefined);
  assert.equal(weather.days, undefined);
  assert.equal(weather.alerts, undefined);
  const later = buildWeather(
    { current: current(), hourly: hourly() },
    { units: 'metric', now: NOW + 5.5 * 3600 * 1000 },
  );
  assert.equal(later.hours.length, 19);
  assert.throws(() => buildWeather({ current: {} }, { units: 'metric', now: NOW }), /temperature/);
});

test('every documented condition type maps to a pivot condition and two documented icons', () => {
  assert.equal(Object.keys(CONDITIONS).length, 40);
  for (const [type, [pivot, day, night]] of Object.entries(CONDITIONS)) {
    assert.ok(PIVOT.has(pivot), type);
    assert.ok(ICON_NAMES.has(day) && ICON_NAMES.has(night), type);
    assert.equal(readCondition({ type }), pivot);
  }
  assert.equal(readCondition({ type: 'SOMETHING_NEW' }), WEATHER_CONDITIONS.UNKNOWN);
  assert.equal(readCondition(undefined), WEATHER_CONDITIONS.UNKNOWN);
  assert.equal(
    readCondition({ type: 'LIGHT_RAIN' }, { probability: { type: 'FREEZING_RAIN', percent: 80 } }),
    WEATHER_CONDITIONS.FREEZING_RAIN,
  );
  assert.equal(readCondition({ type: 'SNOWSTORM' }), WEATHER_CONDITIONS.SNOW_THUNDERSTORM);
});

test('icons: only documented names on maps.gstatic.com, nothing else can be fetched', () => {
  assert.equal(iconNameFromUri('https://maps.gstatic.com/weather/v1/drizzle'), 'drizzle');
  for (const uri of [
    'http://maps.gstatic.com/weather/v1/drizzle',
    'https://maps.gstatic.com.evil.example/weather/v1/drizzle',
    'https://evil.example/weather/v1/drizzle',
    'https://maps.gstatic.com/weather/v1/../../secret',
    'https://maps.gstatic.com/weather/v1/drizzle?x=1',
    'https://user@maps.gstatic.com/weather/v1/drizzle',
    'https://maps.gstatic.com:8443/weather/v1/drizzle',
    'https://maps.gstatic.com/weather/v1/unknown_icon',
    'https://maps.gstatic.com/weather/v2/drizzle',
    42,
  ]) {
    assert.equal(iconNameFromUri(uri), null, String(uri));
  }
  // A foreign iconBaseUri falls back on the documented table.
  assert.equal(
    iconKey({ type: 'CLEAR', iconBaseUri: 'https://evil.example/x' }, false),
    'gw-clear',
  );
  assert.equal(iconKey({ type: 'CLEAR' }, true), 'gw-sunny');
  assert.equal(iconKey({ type: 'NOPE' }), null);
  assert.equal(iconUrlFromKey('gw-sunny'), 'https://maps.gstatic.com/weather/v1/sunny.png');
  assert.equal(
    iconUrlFromKey('gw-mostly-cloudy-night'),
    'https://maps.gstatic.com/weather/v1/mostly_cloudy_night.png',
  );
  assert.equal(iconKey({ type: 'MOSTLY_CLOUDY' }, false), 'gw-mostly-cloudy-night');
  for (const key of [
    'gw-../x',
    'gw-sunny.png',
    'gw-SUNNY',
    'nws-sunny',
    'gw-unknown',
    'gw-sunny/x',
    'gw-mostly_sunny',
    '',
  ]) {
    assert.equal(iconUrlFromKey(key), null, key);
  }
});

test('helpers: dates and compass', () => {
  assert.equal(dateOf({ year: 2026, month: 1, day: 5 }), '2026-01-05');
  assert.equal(dateOf({ year: 2026 }), null);
  assert.equal(compassOf(225, 'fr'), 'SO');
  assert.equal(compassOf(270, 'de'), 'W');
  assert.equal(compassOf(359, 'en'), 'N');
  const day = buildDay(
    {
      displayDate: { year: 2026, month: 10, day: 20 },
      maxTemperature: { degrees: 1 },
      minTemperature: { degrees: 0 },
    },
    'metric',
  );
  assert.equal(day.datetime, '2026-10-20T12:00:00Z');
});
