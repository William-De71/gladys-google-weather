// -----------------------------------------------------------------------------
// Scene actions of the Google Weather integration.
//
// Read-only cards of the scene editor, each targeting a house (the first
// located one when the "House" field is empty), each returning scalars for the
// following actions of the scene — a `summary` sentence ready to send in a
// message among them:
//   - get_alerts:   the official alerts in force, the most serious first;
//   - get_forecast: the forecast of a day (today to 9 days ahead);
//   - get_current:  the current conditions;
//   - get_rain:     is rain expected in the next hours, from when, how much.
// They read through the same cache as the weather: a scene that runs every
// morning costs no extra call while the cache is fresh.
// Wind speeds are given as displayed (km/h or mph), not in m/s.
// -----------------------------------------------------------------------------

import { readCondition, describe } from './conditions.js';
import { CATEGORY_LABELS, SEVERITY_LABELS, alertName, localize } from './alerts.js';
import { buildCurrent, buildDay, buildHour, dateOf, upcomingHours } from './weather.js';
import { addDays, formatDayTime, formatTime, localDate, weekdayName } from './time.js';
import { compassOf, displaySpeed, isNumber, round, unitLabels } from './units.js';
import { inSentence } from './i18n.js';

const SCENE_ACTIONS = {
  GET_ALERTS: 'get_alerts',
  GET_FORECAST: 'get_forecast',
  GET_CURRENT: 'get_current',
  GET_RAIN: 'get_rain',
};

const MAX_DAY_OFFSET = 9;
const RAIN_SPANS = ['3', '6', '12', '24'];
const RAIN_THRESHOLD = { min: 10, max: 100, default: 50 };

// The `summary` sentences, per language (English for any other).
const SENTENCES = {
  en: {
    noAlert: ({ house }) => `No weather alert in force for ${house}.`,
    alerts: ({ count, house, top, severity, until }) =>
      `${count} weather alert(s) for ${house}. Most serious: ${top} (${severity})${until ? ` until ${until}` : ''}.`,
    today: 'today',
    tomorrow: 'tomorrow',
    forecast: ({ name, house, sky, max, min }) =>
      `Weather ${name} in ${house}: ${sky}, ${min} to ${max}`,
    rain: (value) => `${value}% chance of rain`,
    current: ({ house, temperature, sky }) => `In ${house}: ${temperature}, ${sky}`,
    feels: (value) => `feels like ${value}`,
    humidity: (value) => `humidity ${value}%`,
    wind: (value) => `wind ${value}`,
    rainYes: ({ house, time, chance, hours }) =>
      `Rain expected in ${house} from ${time} (${chance}% chance) in the next ${hours} hours.`,
    rainNo: ({ house, hours, chance }) =>
      `No rain expected in ${house} in the next ${hours} hours (max ${chance}% chance).`,
  },
  fr: {
    noAlert: ({ house }) => `Aucune alerte météo en cours pour ${house}.`,
    alerts: ({ count, house, top, severity, until }) =>
      `${count} alerte(s) météo pour ${house}. La plus grave : ${top} (${severity})${until ? ` jusqu'à ${until}` : ''}.`,
    today: "aujourd'hui",
    tomorrow: 'demain',
    forecast: ({ name, house, sky, max, min }) =>
      `Météo ${name} à ${house} : ${sky}, de ${min} à ${max}`,
    rain: (value) => `${value} % de risque de pluie`,
    current: ({ house, temperature, sky }) => `À ${house} : ${temperature}, ${sky}`,
    feels: (value) => `ressenti ${value}`,
    humidity: (value) => `humidité ${value} %`,
    wind: (value) => `vent ${value}`,
    rainYes: ({ house, time, chance, hours }) =>
      `Pluie attendue à ${house} à partir de ${time} (${chance} % de risque) dans les ${hours} prochaines heures.`,
    rainNo: ({ house, hours, chance }) =>
      `Pas de pluie attendue à ${house} dans les ${hours} prochaines heures (risque max ${chance} %).`,
  },
  de: {
    noAlert: ({ house }) => `Keine Wetterwarnung für ${house}.`,
    alerts: ({ count, house, top, severity, until }) =>
      `${count} Wetterwarnung(en) für ${house}. Schwerste: ${top} (${severity})${until ? ` bis ${until}` : ''}.`,
    today: 'heute',
    tomorrow: 'morgen',
    forecast: ({ name, house, sky, max, min }) =>
      `Wetter ${name} in ${house}: ${sky}, ${min} bis ${max}`,
    rain: (value) => `Regenrisiko ${value} %`,
    current: ({ house, temperature, sky }) => `In ${house}: ${temperature}, ${sky}`,
    feels: (value) => `gefühlt ${value}`,
    humidity: (value) => `Luftfeuchtigkeit ${value} %`,
    wind: (value) => `Wind ${value}`,
    rainYes: ({ house, time, chance, hours }) =>
      `Regen in ${house} ab ${time} erwartet (Risiko ${chance} %) in den nächsten ${hours} Stunden.`,
    rainNo: ({ house, hours, chance }) =>
      `Kein Regen in ${house} in den nächsten ${hours} Stunden erwartet (max. Risiko ${chance} %).`,
  },
  es: {
    noAlert: ({ house }) => `Ninguna alerta meteorológica en vigor para ${house}.`,
    alerts: ({ count, house, top, severity, until }) =>
      `${count} alerta(s) meteorológica(s) para ${house}. La más grave: ${top} (${severity})${until ? ` hasta ${until}` : ''}.`,
    today: 'hoy',
    tomorrow: 'mañana',
    forecast: ({ name, house, sky, max, min }) =>
      `Tiempo ${name} en ${house}: ${sky}, de ${min} a ${max}`,
    rain: (value) => `${value} % de probabilidad de lluvia`,
    current: ({ house, temperature, sky }) => `En ${house}: ${temperature}, ${sky}`,
    feels: (value) => `sensación ${value}`,
    humidity: (value) => `humedad ${value} %`,
    wind: (value) => `viento ${value}`,
    rainYes: ({ house, time, chance, hours }) =>
      `Lluvia prevista en ${house} a partir de las ${time} (${chance} % de probabilidad) en las próximas ${hours} horas.`,
    rainNo: ({ house, hours, chance }) =>
      `No se prevé lluvia en ${house} en las próximas ${hours} horas (probabilidad máx. ${chance} %).`,
  },
};

const sentences = (language) => SENTENCES[language] ?? SENTENCES.en;

/**
 * @description Read the "day" field: 0 today … 9.
 * @param {unknown} value - The field value.
 * @returns {number} The offset.
 * @example
 * readDayOffset('1'); // -> 1
 */
function readDayOffset(value) {
  const offset = Number(value ?? 0);
  return Number.isInteger(offset) && offset >= 0 && offset <= MAX_DAY_OFFSET ? offset : 0;
}

/**
 * @description Read the fields of get_rain.
 * @param {object} fields - { hours, threshold }.
 * @returns {{ hours: number, threshold: number }} The span and threshold.
 * @example
 * readRainFields({ hours: '6', threshold: 40 }); // -> { hours: 6, threshold: 40 }
 */
function readRainFields(fields = {}) {
  const hours = RAIN_SPANS.includes(String(fields.hours)) ? Number(fields.hours) : 12;
  const raw = Number(fields.threshold);
  const threshold =
    fields.threshold === undefined || fields.threshold === null || !Number.isFinite(raw)
      ? RAIN_THRESHOLD.default
      : Math.min(RAIN_THRESHOLD.max, Math.max(RAIN_THRESHOLD.min, Math.round(raw)));
  return { hours, threshold };
}

/**
 * @description Outputs of get_alerts.
 * @param {object} options - { alerts, house, timeZone, language }.
 * @returns {object} The outputs.
 * @example
 * buildAlertsOutputs({ alerts, house: 'Home', timeZone: 'Europe/Paris', language: 'fr' });
 */
function buildAlertsOutputs({ alerts, house, timeZone, language }) {
  const say = sentences(language);
  const top = alerts[0] ?? null;
  const until = top?.end ? formatDayTime(top.end, timeZone, language) : '';
  const severityLabel = top ? localize(SEVERITY_LABELS, top.severity, language) : '';
  return {
    count: alerts.length,
    has_alert: alerts.length > 0,
    titles: [...new Set(alerts.map((alert) => alertName(alert, language)))].join(', '),
    top_title: top ? alertName(top, language) : '',
    top_category: top ? top.category : '',
    top_category_label: top ? localize(CATEGORY_LABELS, top.category, language) : '',
    top_severity: top ? top.severity : '',
    top_severity_label: severityLabel,
    top_ends: until,
    top_description: top?.description?.slice(0, 10000) ?? '',
    top_instruction: top?.instruction?.slice(0, 10000) ?? '',
    summary:
      top === null
        ? say.noAlert({ house })
        : say.alerts({
            count: alerts.length,
            house,
            top: alertName(top, language),
            severity: inSentence(severityLabel, language),
            until,
          }),
  };
}

/**
 * @description Outputs of get_forecast.
 * @param {object} options - { daily, house, language, units, day, now }.
 * @returns {object} The outputs.
 * @throws {Error} When the forecast has no such day.
 * @example
 * buildForecastOutputs({ daily, house: 'Home', language: 'en', units: 'metric', day: 1 });
 */
function buildForecastOutputs({ daily, house, language, units, day, now = Date.now() }) {
  const offset = readDayOffset(day);
  const timeZone = daily?.timeZone?.id ?? null;
  const date = addDays(localDate(now, timeZone), offset);
  const record = (daily?.forecastDays ?? []).find((item) => dateOf(item.displayDate) === date);
  if (record === undefined) {
    throw new Error(`No Google forecast for ${date}`);
  }
  const pivot = buildDay(record, units);
  const labels = unitLabels(units);
  const say = sentences(language);
  const condition = record.daytimeForecast?.weatherCondition;
  const description = describe(condition) ?? '';
  let name;
  if (offset === 0) {
    name = say.today;
  } else if (offset === 1) {
    name = say.tomorrow;
  } else {
    name = weekdayName(date, language);
  }
  const temperature = (value) =>
    isNumber(value) ? `${Math.round(value)}${labels.temperature}` : '?';
  let summary = say.forecast({
    name,
    house,
    sky: description ? inSentence(description, language) : '?',
    max: temperature(pivot.temperature_max),
    min: temperature(pivot.temperature_min),
  });
  if (isNumber(pivot.precipitation_probability) && pivot.precipitation_probability >= 20) {
    summary += `, ${say.rain(pivot.precipitation_probability)}`;
  }
  return {
    date,
    condition: readCondition(condition, record.daytimeForecast?.precipitation),
    description,
    temperature_max: pivot.temperature_max ?? null,
    temperature_min: pivot.temperature_min ?? null,
    precipitation_probability: pivot.precipitation_probability ?? null,
    precipitation: pivot.precipitation ?? null,
    wind_speed: displaySpeed(pivot.wind_speed, units) ?? null,
    wind_gust: displaySpeed(pivot.wind_gust, units) ?? null,
    uv_index: pivot.uv_index ?? null,
    sunrise: pivot.sunrise ? formatTime(pivot.sunrise, timeZone, language) : '',
    sunset: pivot.sunset ? formatTime(pivot.sunset, timeZone, language) : '',
    summary: `${summary}.`,
  };
}

/**
 * @description Outputs of get_current.
 * @param {object} options - { current, house, language, units }.
 * @returns {object} The outputs.
 * @example
 * buildCurrentOutputs({ current, house: 'Home', language: 'fr', units: 'metric' });
 */
function buildCurrentOutputs({ current, house, language, units }) {
  const pivot = buildCurrent(current, units);
  const labels = unitLabels(units);
  const say = sentences(language);
  const description = describe(current.weatherCondition) ?? '';
  const windSpeed = displaySpeed(pivot.wind_speed, units);
  let summary = say.current({
    house,
    temperature: `${Math.round(pivot.temperature)}${labels.temperature}`,
    sky: description ? inSentence(description, language) : '?',
  });
  if (
    isNumber(pivot.apparent_temperature) &&
    Math.abs(pivot.apparent_temperature - pivot.temperature) >= 2
  ) {
    summary += `, ${say.feels(`${Math.round(pivot.apparent_temperature)}${labels.temperature}`)}`;
  }
  if (isNumber(pivot.humidity)) {
    summary += `, ${say.humidity(pivot.humidity)}`;
  }
  if (isNumber(windSpeed)) {
    summary += `, ${say.wind(`${windSpeed} ${labels.speed}`)}`;
  }
  return {
    temperature: pivot.temperature,
    apparent_temperature: pivot.apparent_temperature ?? null,
    humidity: pivot.humidity ?? null,
    pressure: pivot.pressure ?? null,
    wind_speed: windSpeed ?? null,
    wind_gust: displaySpeed(pivot.wind_gust, units) ?? null,
    wind_direction: compassOf(pivot.wind_direction, language) ?? '',
    uv_index: pivot.uv_index ?? null,
    cloud_cover: pivot.cloud_cover ?? null,
    condition: pivot.weather,
    description,
    is_day: pivot.is_day ?? null,
    summary: `${summary}.`,
  };
}

/**
 * @description Outputs of get_rain.
 * @param {object} options - { hourly, house, language, units, fields, now }.
 * @returns {object} The outputs.
 * @example
 * buildRainOutputs({ hourly, house: 'Home', language: 'en', units: 'metric', fields: { hours: '6' } });
 */
function buildRainOutputs({ hourly, house, language, units, fields, now = Date.now() }) {
  const { hours: span, threshold } = readRainFields(fields);
  const timeZone = hourly?.timeZone?.id ?? null;
  const hours = upcomingHours(hourly, now)
    .slice(0, span)
    .map((record) => buildHour(record, units));
  const chances = hours.map((hour) => hour.precipitation_probability ?? 0);
  const maxChance = chances.length > 0 ? Math.max(...chances) : 0;
  const first = hours.find((hour) => (hour.precipitation_probability ?? 0) >= threshold) ?? null;
  const total = hours
    .map((hour) => hour.precipitation)
    .filter(isNumber)
    .reduce((sum, value) => sum + value, 0);
  const say = sentences(language);
  const time = first ? formatTime(first.datetime, timeZone, language) : '';
  return {
    rain_expected: first !== null,
    first_time: time,
    max_probability: maxChance,
    total_precipitation: units === 'us' ? round(total, 2) : round(total, 1),
    summary:
      first === null
        ? say.rainNo({ house, hours: span, chance: maxChance })
        : say.rainYes({ house, time, chance: first.precipitation_probability, hours: span }),
  };
}

export {
  SCENE_ACTIONS,
  SENTENCES,
  MAX_DAY_OFFSET,
  RAIN_SPANS,
  RAIN_THRESHOLD,
  readDayOffset,
  readRainFields,
  buildAlertsOutputs,
  buildForecastOutputs,
  buildCurrentOutputs,
  buildRainOutputs,
};
