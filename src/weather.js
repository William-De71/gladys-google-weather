// -----------------------------------------------------------------------------
// Google Weather answers -> the Gladys pivot weather format (contract B.18).
//
// Four products, each for what it does:
//   - currentConditions: the current fields (temperature, feels-like,
//     humidity, dew point, pressure, wind and gusts, visibility, cloud cover,
//     UV index, day/night);
//   - forecast/hours: the `hours` (24, from the current hour);
//   - forecast/days: the `days` (Gladys keeps 8 of the 10), and today's
//     sunrise and sunset for the current fields;
//   - publicAlerts: the `alerts` (alerts.js).
// Google gives the day/night flag itself (`isDaytime`, between local sunrise
// and sunset): no astronomy needed here. Only the current conditions are
// required: without forecasts the payload simply has fewer parts.
// -----------------------------------------------------------------------------

import { readCondition } from './conditions.js';
import {
  isNumber,
  temperatureOf,
  speedOf,
  precipitationOf,
  distanceOf,
  percent,
  round,
} from './units.js';
import { toPivotAlerts } from './alerts.js';
import { localDate } from './time.js';

const MAX_HOURS = 24;
const MAX_DAYS = 8;

/**
 * @description Drop the undefined and null fields of an object.
 * @param {object} object - The object.
 * @returns {object} The same object without empty fields.
 * @example
 * compact({ a: 1, b: undefined }); // -> { a: 1 }
 */
function compact(object) {
  Object.keys(object).forEach((key) => {
    if (object[key] === undefined || object[key] === null) {
      delete object[key];
    }
  });
  return object;
}

const integerOrUndefined = (value) => (isNumber(value) ? Math.round(value) : undefined);
const degreesOf = (wind) => {
  const degrees = wind?.direction?.degrees;
  return isNumber(degrees) ? ((degrees % 360) + 360) % 360 : undefined;
};

/**
 * @description The YYYY-MM-DD of a Google Date ({ year, month, day }).
 * @param {object|undefined} date - The Date.
 * @returns {string|null} The date.
 * @example
 * dateOf({ year: 2026, month: 10, day: 17 }); // -> '2026-10-17'
 */
function dateOf(date) {
  if (!date || !isNumber(date.year) || !isNumber(date.month) || !isNumber(date.day)) {
    return null;
  }
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/**
 * @description Build the current fields of the pivot payload.
 * @param {object} current - The currentConditions:lookup answer.
 * @param {string} units - 'metric' or 'us'.
 * @returns {object} The current fields.
 * @example
 * buildCurrent(current, 'metric');
 */
function buildCurrent(current, units) {
  return compact({
    datetime: current.currentTime ?? new Date().toISOString(),
    temperature: temperatureOf(current.temperature, units),
    weather: readCondition(current.weatherCondition, current.precipitation),
    is_day: typeof current.isDaytime === 'boolean' ? current.isDaytime : undefined,
    apparent_temperature: temperatureOf(current.feelsLikeTemperature, units),
    humidity: percent(current.relativeHumidity),
    dew_point: temperatureOf(current.dewPoint, units),
    pressure: isNumber(current.airPressure?.meanSeaLevelMillibars)
      ? round(current.airPressure.meanSeaLevelMillibars)
      : undefined,
    wind_speed: speedOf(current.wind?.speed, units),
    wind_direction: degreesOf(current.wind),
    wind_gust: speedOf(current.wind?.gust, units),
    visibility: distanceOf(current.visibility, units),
    cloud_cover: percent(current.cloudCover),
    uv_index: integerOrUndefined(current.uvIndex),
  });
}

/**
 * @description The forecast hours still to come (the running one included).
 * @param {object|null} hourly - The forecast/hours:lookup answer.
 * @param {number} now - Current time in ms.
 * @returns {Array<object>} The ForecastHour records.
 * @example
 * upcomingHours(hourly, Date.now());
 */
function upcomingHours(hourly, now) {
  const records = Array.isArray(hourly?.forecastHours) ? hourly.forecastHours : [];
  return records.filter((record) => {
    const end = Date.parse(record?.interval?.endTime);
    return Number.isNaN(end) ? Boolean(record?.interval?.startTime) : end > now;
  });
}

/**
 * @description Build one pivot hour.
 * @param {object} record - A ForecastHour.
 * @param {string} units - 'metric' or 'us'.
 * @returns {object} The pivot hour.
 * @example
 * buildHour(record, 'metric');
 */
function buildHour(record, units) {
  return compact({
    datetime: record.interval?.startTime,
    temperature: temperatureOf(record.temperature, units),
    weather: readCondition(record.weatherCondition, record.precipitation),
    is_day: typeof record.isDaytime === 'boolean' ? record.isDaytime : undefined,
    apparent_temperature: temperatureOf(record.feelsLikeTemperature, units),
    humidity: percent(record.relativeHumidity),
    pressure: isNumber(record.airPressure?.meanSeaLevelMillibars)
      ? round(record.airPressure.meanSeaLevelMillibars)
      : undefined,
    wind_speed: speedOf(record.wind?.speed, units),
    wind_direction: degreesOf(record.wind),
    wind_gust: speedOf(record.wind?.gust, units),
    cloud_cover: percent(record.cloudCover),
    precipitation: precipitationOf(record.precipitation?.qpf, units),
    precipitation_probability: percent(record.precipitation?.probability?.percent),
    uv_index: integerOrUndefined(record.uvIndex),
  });
}

/**
 * @description The larger of two optional numbers.
 * @param {number|undefined} a - First.
 * @param {number|undefined} b - Second.
 * @returns {number|undefined} The maximum.
 * @example
 * maxOf(3, undefined); // -> 3
 */
function maxOf(a, b) {
  const values = [a, b].filter(isNumber);
  return values.length > 0 ? Math.max(...values) : undefined;
}

/**
 * @description Build one pivot day: the day part gives the sky, the wind and
 * the UV; the night part adds its rain and its gusts.
 * @param {object} record - A ForecastDay.
 * @param {string} units - 'metric' or 'us'.
 * @returns {object} The pivot day.
 * @example
 * buildDay(record, 'metric');
 */
function buildDay(record, units) {
  const day = record.daytimeForecast ?? {};
  const night = record.nighttimeForecast ?? {};
  const rain = [day, night]
    .map((part) => precipitationOf(part.precipitation?.qpf, units))
    .filter(isNumber);
  const date = dateOf(record.displayDate);
  return compact({
    // The start of the forecast day (7 AM local time), not a bare date: a
    // bare date reads as UTC midnight, the evening before west of Greenwich.
    datetime: record.interval?.startTime ?? (date ? `${date}T12:00:00Z` : undefined),
    temperature_max: temperatureOf(record.maxTemperature, units),
    temperature_min: temperatureOf(record.minTemperature, units),
    weather: readCondition(day.weatherCondition, day.precipitation),
    humidity: percent(day.relativeHumidity),
    wind_speed: maxOf(speedOf(day.wind?.speed, units), speedOf(night.wind?.speed, units)),
    wind_direction: degreesOf(day.wind),
    wind_gust: maxOf(speedOf(day.wind?.gust, units), speedOf(night.wind?.gust, units)),
    precipitation:
      rain.length > 0
        ? round(
            rain.reduce((sum, value) => sum + value, 0),
            2,
          )
        : undefined,
    precipitation_probability: maxOf(
      percent(day.precipitation?.probability?.percent),
      percent(night.precipitation?.probability?.percent),
    ),
    uv_index: integerOrUndefined(day.uvIndex),
    sunrise: record.sunEvents?.sunriseTime,
    sunset: record.sunEvents?.sunsetTime,
  });
}

/**
 * @description The forecast day of a local date (today by default).
 * @param {object|null} daily - The forecast/days:lookup answer.
 * @param {string} date - The local YYYY-MM-DD.
 * @returns {object|null} The ForecastDay.
 * @example
 * dayOf(daily, '2026-10-17');
 */
function dayOf(daily, date) {
  const records = Array.isArray(daily?.forecastDays) ? daily.forecastDays : [];
  return records.find((record) => dateOf(record.displayDate) === date) ?? null;
}

/**
 * @description The time zone of the answers (IANA id), or null.
 * @param {...object} answers - API answers.
 * @returns {string|null} "Europe/Paris".
 * @example
 * timeZoneOf(current, daily); // -> 'Europe/Paris'
 */
function timeZoneOf(...answers) {
  const found = answers.find((answer) => typeof answer?.timeZone?.id === 'string');
  return found ? found.timeZone.id : null;
}

/**
 * @description Build the pivot weather payload of a location.
 * @param {object} products - { current, hourly, daily, alerts }: the API
 * answers (`hourly` and `daily` null when unavailable) and the readAlerts()
 * alerts.
 * @param {object} options - { units, language, now }.
 * @returns {object} The pivot payload.
 * @throws {Error} When the current conditions have no temperature.
 * @example
 * const weather = buildWeather({ current, hourly, daily, alerts }, { units: 'metric', language: 'fr' });
 */
function buildWeather(
  { current, hourly = null, daily = null, alerts = [] },
  { units, language = 'en', now = Date.now() },
) {
  const weather = buildCurrent(current, units);
  if (!isNumber(weather.temperature)) {
    throw new Error('Google Weather returned no current temperature');
  }
  const timeZone = timeZoneOf(current, daily, hourly);
  const today = dayOf(daily, localDate(now, timeZone));
  if (today?.sunEvents?.sunriseTime) {
    weather.sunrise = today.sunEvents.sunriseTime;
  }
  if (today?.sunEvents?.sunsetTime) {
    weather.sunset = today.sunEvents.sunsetTime;
  }
  const hours = upcomingHours(hourly, now)
    .slice(0, MAX_HOURS)
    .map((record) => buildHour(record, units))
    .filter((hour) => hour.datetime && isNumber(hour.temperature));
  if (hours.length > 0) {
    weather.hours = hours;
  }
  const days = (Array.isArray(daily?.forecastDays) ? daily.forecastDays : [])
    .map((record) => buildDay(record, units))
    .filter((day) => day.datetime && isNumber(day.temperature_max) && isNumber(day.temperature_min))
    .slice(0, MAX_DAYS);
  if (days.length > 0) {
    weather.days = days;
  }
  const pivotAlerts = toPivotAlerts(alerts, language);
  if (pivotAlerts.length > 0) {
    weather.alerts = pivotAlerts;
  }
  return weather;
}

export {
  MAX_HOURS,
  MAX_DAYS,
  compact,
  dateOf,
  buildCurrent,
  upcomingHours,
  buildHour,
  buildDay,
  dayOf,
  timeZoneOf,
  buildWeather,
};
