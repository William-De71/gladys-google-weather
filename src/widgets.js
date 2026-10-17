// -----------------------------------------------------------------------------
// Dashboard widgets of the Google Weather integration.
//
// The core weather widget already shows what this provider answers (current
// conditions, hours, days, alert badges). The widgets add what that generic
// card cannot show:
//
//   - `alerts`  the official alerts in force, with their title, area,
//               instructions and source in the detail panel; refreshed by the
//               alert watcher, so a new red alert reaches a wall tablet
//               within one check;
//   - `daily`   up to 10 days (the core card stops at 8), with Google's
//               icons and localized descriptions, day and night details;
//   - `hourly`  the next 12 or 24 hours as a curve: temperature and feels
//               like, chance of rain, or wind and gusts.
//
// The content is built per user language and unit system (the core caches it
// per variant). Icons are image keys ("gw-drizzle") served by the image
// handler (see conditions.js): the browser never contacts Google.
// -----------------------------------------------------------------------------

import { describe, iconKey } from './conditions.js';
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  alertName,
  countBySeverity,
  localize,
} from './alerts.js';
import { buildDay, buildHour, dateOf, upcomingHours } from './weather.js';
import { addDays, formatDayTime, formatTime, localDate, weekdayName } from './time.js';
import { compassOf, displaySpeed, isNumber, speedOf, unitLabels } from './units.js';
import { formatPercent } from './i18n.js';

const WIDGETS = {
  ALERTS: 'alerts',
  DAILY: 'daily',
  HOURLY: 'hourly',
};

const TTL_SECONDS = {
  [WIDGETS.ALERTS]: 300,
  [WIDGETS.DAILY]: 1800,
  [WIDGETS.HOURLY]: 900,
};

const HOURLY_METRICS = ['temperature', 'precipitation', 'wind'];
const HOURLY_SPANS = ['12', '24'];
const DAILY_SPANS = ['5', '7', '10'];
// Card-list capacity of the front: 8 in a list, 12 in a grid.
const MAX_LIST_ITEMS = 8;
const MAX_ALERT_ITEMS = MAX_LIST_ITEMS;
const MAX_DESCRIPTION = 2000;
const RAIN_CHANCE_THRESHOLD = 30;

const TEXTS = {
  noAlertBody: {
    en: 'No official weather alert is in force for this location.',
    fr: 'Aucune alerte météo officielle n’est en cours pour ce lieu.',
    de: 'Für diesen Ort gilt keine offizielle Wetterwarnung.',
    es: 'No hay ninguna alerta meteorológica oficial en vigor para este lugar.',
  },
  alertsOff: {
    en: 'Alerts are switched off in the integration configuration.',
    fr: 'Les alertes sont désactivées dans la configuration de l’intégration.',
    de: 'Die Warnungen sind in der Konfiguration der Integration deaktiviert.',
    es: 'Las alertas están desactivadas en la configuración de la integración.',
  },
  active: {
    en: 'Active alerts',
    fr: 'Alertes en cours',
    de: 'Aktive Warnungen',
    es: 'Alertas activas',
  },
  severeTile: { en: 'Severe', fr: 'Sévères', de: 'Schwer', es: 'Graves' },
  moderateTile: { en: 'Moderate', fr: 'Modérées', de: 'Mäßig', es: 'Moderadas' },
  minorTile: { en: 'Minor', fr: 'Mineures', de: 'Gering', es: 'Menores' },
  from: { en: 'from', fr: 'dès', de: 'ab', es: 'desde' },
  until: { en: 'until', fr: 'jusqu’à', de: 'bis', es: 'hasta' },
  source: { en: 'Source', fr: 'Source', de: 'Quelle', es: 'Fuente' },
  area: { en: 'Area', fr: 'Zone', de: 'Gebiet', es: 'Zona' },
  noHouse: {
    en: 'No house of Gladys has a location: set it in the house settings.',
    fr: 'Aucune maison de Gladys n’est localisée : renseignez sa position dans ses réglages.',
    de: 'Kein Zuhause in Gladys hat einen Standort: Lege ihn in den Einstellungen des Zuhauses fest.',
    es: 'Ninguna casa de Gladys tiene ubicación: defínala en los ajustes de la casa.',
  },
  unknownHouse: {
    en: 'No located house is named "{name}" (the name is case-sensitive).',
    fr: 'Aucune maison localisée ne s’appelle « {name} » (majuscules comprises).',
    de: 'Kein Zuhause mit Standort heißt „{name}“ (Groß-/Kleinschreibung beachten).',
    es: 'Ninguna casa con ubicación se llama «{name}» (distingue mayúsculas).',
  },
  noKey: {
    en: 'Enter your Google Weather API key in the integration configuration.',
    fr: 'Saisissez votre clé API Google Weather dans la configuration de l’intégration.',
    de: 'Gib deinen Google-Weather-API-Schlüssel in der Konfiguration der Integration ein.',
    es: 'Introduzca su clave API de Google Weather en la configuración de la integración.',
  },
  outOfCoverage: {
    en: 'Google Weather has no data for this house’s location.',
    fr: 'Google Weather ne fournit pas de données pour la position de cette maison.',
    de: 'Google Weather hat keine Daten für den Standort dieses Zuhauses.',
    es: 'Google Weather no tiene datos para la ubicación de esta casa.',
  },
  noForecast: {
    en: 'Google Weather has no forecast to come for this house right now.',
    fr: 'Google Weather ne fournit pas de prévision à venir pour cette maison en ce moment.',
    de: 'Google Weather hat für dieses Zuhause gerade keine kommende Vorhersage.',
    es: 'Google Weather no tiene ahora mismo previsión para esta casa.',
  },
  unavailable: {
    en: 'Google Weather is unavailable right now: {reason}',
    fr: 'Google Weather est indisponible pour le moment : {reason}',
    de: 'Google Weather ist gerade nicht verfügbar: {reason}',
    es: 'Google Weather no está disponible en este momento: {reason}',
  },
  high: { en: 'High', fr: 'Max', de: 'Max.', es: 'Máx.' },
  low: { en: 'Low', fr: 'Min', de: 'Min.', es: 'Mín.' },
  now: { en: 'Now', fr: 'Actuel', de: 'Jetzt', es: 'Ahora' },
  temperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  feelsLike: { en: 'Feels like', fr: 'Ressenti', de: 'Gefühlt', es: 'Sensación' },
  rainChance: {
    en: 'Chance of rain',
    fr: 'Risque de pluie',
    de: 'Regenrisiko',
    es: 'Prob. de lluvia',
  },
  maxChance: { en: 'Max chance', fr: 'Risque max', de: 'Max. Risiko', es: 'Prob. máx.' },
  total: { en: 'Total', fr: 'Cumul', de: 'Summe', es: 'Total' },
  firstRain: { en: 'First rain', fr: '1re pluie', de: 'Erster Regen', es: '1.ª lluvia' },
  none: { en: 'None', fr: 'Aucune', de: 'Keiner', es: 'Ninguna' },
  wind: { en: 'Wind', fr: 'Vent', de: 'Wind', es: 'Viento' },
  gusts: { en: 'Gusts', fr: 'Rafales', de: 'Böen', es: 'Rachas' },
  maxWind: { en: 'Max wind', fr: 'Vent max', de: 'Max. Wind', es: 'Viento máx.' },
  maxGust: { en: 'Max gust', fr: 'Rafale max', de: 'Max. Böe', es: 'Racha máx.' },
  direction: { en: 'Direction', fr: 'Direction', de: 'Richtung', es: 'Dirección' },
  nextHours: {
    en: 'Next {n} hours',
    fr: '{n} prochaines heures',
    de: 'Nächste {n} Stunden',
    es: 'Próximas {n} horas',
  },
  today: { en: 'Today', fr: 'Aujourd’hui', de: 'Heute', es: 'Hoy' },
  tomorrow: { en: 'Tomorrow', fr: 'Demain', de: 'Morgen', es: 'Mañana' },
  day: { en: 'Day', fr: 'Jour', de: 'Tag', es: 'Día' },
  night: { en: 'Night', fr: 'Nuit', de: 'Nacht', es: 'Noche' },
  uv: { en: 'UV index', fr: 'Indice UV', de: 'UV-Index', es: 'Índice UV' },
  humidity: { en: 'Humidity', fr: 'Humidité', de: 'Luftfeuchtigkeit', es: 'Humedad' },
  sun: {
    en: 'Sunrise / sunset',
    fr: 'Lever / coucher',
    de: 'Sonnenauf-/untergang',
    es: 'Salida / puesta',
  },
};

/**
 * @description Pick a text in the user's language (English fallback).
 * @param {string} key - The TEXTS key.
 * @param {string} language - The language.
 * @param {object} [values] - `{name}` substitutions.
 * @returns {string} The text.
 * @example
 * text('nextHours', 'fr', { n: 24 }); // -> '24 prochaines heures'
 */
function text(key, language, values = {}) {
  const entry = TEXTS[key];
  const template = entry[language] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

// French puts a (non-breaking) space before a colon.
const colon = (language) => (language === 'fr' ? '\u00a0:' : ':');

const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound in characters.
 * @returns {string} The text.
 * @example
 * truncate('abcdef', 4); // -> 'abc…'
 */
function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * @description A content made of a single explanatory text.
 * @param {string} message - The text.
 * @param {number} ttl - The TTL in seconds.
 * @returns {object} The content.
 * @example
 * messageContent('No house', 60);
 */
function messageContent(message, ttl) {
  return {
    version: 1,
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: message }],
  };
}

const caption = (parts) => ({
  type: 'text',
  variant: 'caption',
  text: truncate(parts.filter(Boolean).join(' · '), 80),
});

// --- Alerts widget ------------------------------------------------------------

const SEVERITY_COLORS = {
  extreme: 'danger',
  severe: 'danger',
  moderate: 'warning',
  minor: 'info',
  unknown: 'info',
};

/**
 * @description Build the content of the `alerts` widget.
 * @param {object} options - Options.
 * @param {Array<object>} options.alerts - The readAlerts() alerts.
 * @param {object} options.house - The house ({ name }).
 * @param {string|null} options.timeZone - The time zone of the house.
 * @param {string} options.language - The user language.
 * @param {boolean} [options.enabled] - false: alerts switched off.
 * @param {number} [options.now] - Current time in ms.
 * @returns {object} The widget content.
 * @example
 * buildAlertsWidget({ alerts, house, timeZone: 'Europe/Paris', language: 'fr' });
 */
function buildAlertsWidget({
  alerts,
  house,
  timeZone,
  language,
  enabled = true,
  now = Date.now(),
}) {
  const ttl = TTL_SECONDS[WIDGETS.ALERTS];
  const components = [caption([house.name])];
  if (!enabled) {
    components.push({ type: 'text', variant: 'body', text: text('alertsOff', language) });
    return { version: 1, ttl_seconds: ttl, components };
  }
  if (alerts.length === 0) {
    components.push(
      {
        type: 'value',
        value: 0,
        label: text('active', language),
        icon: 'check-circle',
        color: 'success',
      },
      { type: 'text', variant: 'body', text: text('noAlertBody', language) },
    );
    return { version: 1, ttl_seconds: ttl, components };
  }
  const counts = countBySeverity(alerts);
  const severe = counts.extreme + counts.severe;
  components.push(
    {
      type: 'value',
      value: severe,
      label: text('severeTile', language),
      icon: 'alert-octagon',
      color: severe > 0 ? 'danger' : 'neutral',
    },
    {
      type: 'value',
      value: counts.moderate,
      label: text('moderateTile', language),
      icon: 'alert-triangle',
      color: counts.moderate > 0 ? 'warning' : 'neutral',
    },
    {
      type: 'value',
      value: counts.minor + counts.unknown,
      label: text('minorTile', language),
      icon: 'info',
      color: 'info',
    },
    {
      type: 'card-list',
      display: 'list',
      items: alerts.slice(0, MAX_ALERT_ITEMS).map((alert) => {
        const until = alert.end ? formatDayTime(alert.end, timeZone, language) : null;
        // An alert announced for later: its start is worth the room then.
        const from =
          alert.start && Date.parse(alert.start) > now
            ? formatDayTime(alert.start, timeZone, language)
            : null;
        const subtitle = [
          localize(CATEGORY_LABELS, alert.category, language),
          from ? `${text('from', language)} ${from}` : null,
          until ? `${text('until', language)} ${until}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const body = [
          alert.description,
          alert.instruction,
          alert.area ? `${text('area', language)}${colon(language)} ${alert.area}` : null,
          alert.source ? `${text('source', language)}${colon(language)} ${alert.source}` : null,
        ]
          .filter(Boolean)
          .join('\n\n');
        const item = {
          title: truncate(alertName(alert, language), 60),
          subtitle: truncate(subtitle, 60),
          badge: {
            text: localize(SEVERITY_LABELS, alert.severity, language),
            color: SEVERITY_COLORS[alert.severity],
          },
        };
        if (body) {
          item.description = truncate(body, MAX_DESCRIPTION);
        }
        if (alert.url) {
          item.links = [{ url: alert.url, label: alert.source ?? new URL(alert.url).hostname }];
        }
        return item;
      }),
    },
  );
  return { version: 1, ttl_seconds: ttl, components };
}

// --- Daily widget -------------------------------------------------------------

/**
 * @description Read the daily settings.
 * @param {object} settings - The widget settings.
 * @returns {{ days: number, showIcons: boolean }} The span and icon switch.
 * @example
 * readDailySettings({ days: '7' }); // -> { days: 7, showIcons: true }
 */
function readDailySettings(settings = {}) {
  return {
    days: DAILY_SPANS.includes(String(settings.days)) ? Number(settings.days) : 7,
    showIcons: settings.show_icons !== false && settings.show_icons !== 'false',
  };
}

/**
 * @description The title of a forecast day.
 * @param {string} date - YYYY-MM-DD.
 * @param {string} today - The local date of today.
 * @param {string} language - The language.
 * @returns {string} "Today", "Tomorrow", "Monday".
 * @example
 * dayTitle('2026-10-19', '2026-10-17', 'fr'); // -> 'Lundi'
 */
function dayTitle(date, today, language) {
  if (date === today) {
    return text('today', language);
  }
  if (date === addDays(today, 1)) {
    return text('tomorrow', language);
  }
  return capitalize(weekdayName(date, language));
}

/**
 * @description Build the content of the `daily` widget.
 * @param {object} options - Options.
 * @param {object} options.daily - The forecast/days:lookup answer.
 * @param {object} options.house - The house.
 * @param {string} options.language - The user language.
 * @param {string} options.units - 'metric' or 'us'.
 * @param {object} options.settings - The widget settings.
 * @param {number} [options.now] - Current time in ms.
 * @returns {object} The widget content.
 * @example
 * buildDailyWidget({ daily, house, language: 'fr', units: 'metric', settings: {} });
 */
function buildDailyWidget({ daily, house, language, units, settings, now = Date.now() }) {
  const { days: span, showIcons } = readDailySettings(settings);
  const ttl = TTL_SECONDS[WIDGETS.DAILY];
  const timeZone = daily?.timeZone?.id ?? null;
  const today = localDate(now, timeZone);
  const labels = unitLabels(units);
  const records = (Array.isArray(daily?.forecastDays) ? daily.forecastDays : [])
    .filter((record) => {
      const date = dateOf(record.displayDate);
      return date !== null && date >= today;
    })
    .slice(0, span);
  if (records.length === 0) {
    return messageContent(text('noForecast', language), ttl);
  }
  const degrees = (value) => (isNumber(value) ? `${Math.round(value)}°` : '–');
  const items = records.map((record) => {
    const date = dateOf(record.displayDate);
    const pivot = buildDay(record, units);
    const dayPart = record.daytimeForecast ?? {};
    const nightPart = record.nighttimeForecast ?? {};
    const sky = describe(dayPart.weatherCondition) ?? '';
    const item = {
      title: dayTitle(date, today, language),
      subtitle: truncate(
        [`${degrees(pivot.temperature_max)} / ${degrees(pivot.temperature_min)}`, sky]
          .filter(Boolean)
          .join(' · '),
        60,
      ),
    };
    if (isNumber(pivot.precipitation_probability) && pivot.precipitation_probability >= 20) {
      item.badge = {
        text: formatPercent(pivot.precipitation_probability, language),
        color: pivot.precipitation_probability >= 60 ? 'primary' : 'info',
      };
    }
    const wind = (part) => {
      const speed = displaySpeed(speedOf(part.wind?.speed, units), units);
      const direction = compassOf(part.wind?.direction?.degrees, language);
      return isNumber(speed)
        ? `${text('wind', language)} ${[direction, `${speed} ${labels.speed}`].filter(Boolean).join(' ')}`
        : null;
    };
    const line = (label, part) =>
      [
        `${label}${colon(language)} ${describe(part.weatherCondition) ?? '–'}`,
        isNumber(part.precipitation?.probability?.percent)
          ? `${text('rainChance', language)} ${formatPercent(part.precipitation.probability.percent, language)}`
          : null,
        wind(part),
      ]
        .filter(Boolean)
        .join(' · ');
    const details = [
      line(text('day', language), dayPart),
      line(text('night', language), nightPart),
    ];
    if (isNumber(pivot.uv_index)) {
      details.push(`${text('uv', language)} ${pivot.uv_index}`);
    }
    if (pivot.sunrise && pivot.sunset) {
      details.push(
        `${text('sun', language)} ${formatTime(pivot.sunrise, timeZone, language)} / ${formatTime(pivot.sunset, timeZone, language)}`,
      );
    }
    item.description = truncate(details.join('\n'), MAX_DESCRIPTION);
    if (showIcons) {
      const key = iconKey(dayPart.weatherCondition, true);
      if (key !== null) {
        item.image = key;
      }
    }
    return item;
  });
  return {
    version: 1,
    ttl_seconds: ttl,
    // A list holds 8 cards at most: 10 days go in the grid layout (12).
    components: [
      caption([house.name]),
      { type: 'card-list', display: items.length > MAX_LIST_ITEMS ? 'grid' : 'list', items },
    ],
  };
}

// --- Hourly widget ------------------------------------------------------------

/**
 * @description Read the hourly settings.
 * @param {object} settings - The widget settings.
 * @returns {{ metric: string, hours: number }} The metric and span.
 * @example
 * readHourlySettings({ metric: 'wind', hours: '12' }); // -> { metric: 'wind', hours: 12 }
 */
function readHourlySettings(settings = {}) {
  const metric = HOURLY_METRICS.includes(settings.metric) ? settings.metric : 'temperature';
  const hours = HOURLY_SPANS.includes(String(settings.hours)) ? Number(settings.hours) : 24;
  return { metric, hours };
}

/**
 * @description The entry with the highest (or lowest) value of a field.
 * @param {Array<object>} entries - Entries.
 * @param {string} field - The field.
 * @param {number} sign - 1 for the maximum, -1 for the minimum.
 * @returns {object|null} The entry.
 * @example
 * extreme(hours, 'temperature', 1);
 */
function extreme(entries, field, sign) {
  return entries.reduce((best, entry) => {
    if (typeof entry[field] !== 'number') {
      return best;
    }
    return best === null || sign * entry[field] > sign * best[field] ? entry : best;
  }, null);
}

const iso = (value) => new Date(value).toISOString();

/**
 * @description Build the content of the `hourly` widget.
 * @param {object} options - Options.
 * @param {object} options.hourly - The forecast/hours:lookup answer.
 * @param {object} options.house - The house.
 * @param {string} options.language - The user language.
 * @param {string} options.units - 'metric' or 'us'.
 * @param {object} options.settings - The widget settings.
 * @param {number} [options.now] - Current time in ms.
 * @returns {object} The widget content.
 * @example
 * buildHourlyWidget({ hourly, house, language: 'en', units: 'metric', settings: {} });
 */
function buildHourlyWidget({ hourly, house, language, units, settings, now = Date.now() }) {
  const { metric, hours: span } = readHourlySettings(settings);
  const ttl = TTL_SECONDS[WIDGETS.HOURLY];
  const timeZone = hourly?.timeZone?.id ?? null;
  const hours = upcomingHours(hourly, now)
    .slice(0, span)
    .map((record) => buildHour(record, units))
    .filter((hour) => hour.datetime);
  if (hours.length === 0) {
    return messageContent(text('noForecast', language), ttl);
  }
  const labels = unitLabels(units);
  const title = text('nextHours', language, { n: hours.length });
  const time = (entry) => formatTime(entry.datetime, timeZone, language);
  const components = [caption([house.name])];

  if (metric === 'temperature') {
    const temperatures = hours.filter((h) => typeof h.temperature === 'number');
    if (temperatures.length === 0) {
      return messageContent(text('noForecast', language), ttl);
    }
    const max = extreme(temperatures, 'temperature', 1);
    const min = extreme(temperatures, 'temperature', -1);
    const series = [
      {
        name: text('temperature', language),
        points: temperatures.map((h) => ({ t: iso(h.datetime), v: h.temperature })),
      },
    ];
    const feels = temperatures.filter((h) => typeof h.apparent_temperature === 'number');
    if (
      feels.length === temperatures.length &&
      feels.some((h) => Math.abs(h.apparent_temperature - h.temperature) >= 1)
    ) {
      series.push({
        name: text('feelsLike', language),
        points: feels.map((h) => ({ t: iso(h.datetime), v: h.apparent_temperature })),
      });
    }
    components.push(
      {
        type: 'value',
        value: Math.round(temperatures[0].temperature),
        unit: labels.temperature,
        label: text('now', language),
        icon: 'thermometer',
      },
      {
        type: 'value',
        value: Math.round(max.temperature),
        unit: labels.temperature,
        label: `${text('high', language)} ${time(max)}`,
        color: 'danger',
      },
      {
        type: 'value',
        value: Math.round(min.temperature),
        unit: labels.temperature,
        label: `${text('low', language)} ${time(min)}`,
        color: 'info',
      },
      {
        type: 'chart',
        chart_type: 'line',
        title,
        unit: labels.temperature,
        series,
        now_marker: true,
        annotations: [
          {
            t: iso(max.datetime),
            value: max.temperature,
            label: `${Math.round(max.temperature)}°`,
            color: 'danger',
          },
          {
            t: iso(min.datetime),
            value: min.temperature,
            label: `${Math.round(min.temperature)}°`,
            color: 'info',
          },
        ],
      },
    );
  } else if (metric === 'precipitation') {
    const chances = hours.map((h) => h.precipitation_probability ?? 0);
    const maxChance = Math.max(...chances);
    const first =
      hours.find((h) => (h.precipitation_probability ?? 0) >= RAIN_CHANCE_THRESHOLD) ?? null;
    const amounts = hours.map((h) => h.precipitation).filter(isNumber);
    const total = amounts.reduce((sum, value) => sum + value, 0);
    components.push(
      {
        type: 'value',
        value: maxChance,
        unit: '%',
        label: text('maxChance', language),
        icon: 'umbrella',
        color: maxChance >= 60 ? 'primary' : 'neutral',
      },
      {
        type: 'value',
        value: first ? time(first) : text('none', language),
        label: text('firstRain', language),
        icon: 'clock',
      },
    );
    if (amounts.length > 0) {
      components.push({
        type: 'value',
        value: units === 'us' ? Math.round(total * 100) / 100 : Math.round(total * 10) / 10,
        unit: labels.precipitation,
        label: text('total', language),
        icon: 'droplet',
      });
    }
    const chart = {
      type: 'chart',
      chart_type: 'bar',
      title: `${text('rainChance', language)} · ${title}`,
      unit: '%',
      series: [
        {
          name: text('rainChance', language),
          points: hours.map((h, index) => ({ t: iso(h.datetime), v: chances[index] })),
        },
      ],
      now_marker: true,
    };
    if (first) {
      chart.annotations = [{ t: iso(first.datetime), label: time(first), color: 'primary' }];
    }
    components.push(chart);
  } else {
    const speeds = hours.map((h) => displaySpeed(h.wind_speed, units) ?? 0);
    const gusts = hours.map((h) => displaySpeed(h.wind_gust, units));
    const hasGusts = gusts.every(isNumber);
    const maxSpeed = Math.max(...speeds);
    const maxGustValue = hasGusts ? Math.max(...gusts) : null;
    const gustIndex = hasGusts ? gusts.indexOf(maxGustValue) : -1;
    components.push({
      type: 'value',
      value: maxSpeed,
      unit: labels.speed,
      label: text('maxWind', language),
      icon: 'wind',
    });
    if (hasGusts) {
      components.push({
        type: 'value',
        value: maxGustValue,
        unit: labels.speed,
        label: `${text('maxGust', language)} ${time(hours[gustIndex])}`,
        color: maxGustValue >= (units === 'us' ? 40 : 60) ? 'warning' : 'neutral',
      });
    }
    const direction = compassOf(hours[0].wind_direction, language);
    if (direction) {
      components.push({
        type: 'value',
        value: direction,
        label: text('direction', language),
        icon: 'navigation',
      });
    }
    const series = [
      {
        name: text('wind', language),
        points: hours.map((h, index) => ({ t: iso(h.datetime), v: speeds[index] })),
      },
    ];
    if (hasGusts) {
      series.push({
        name: text('gusts', language),
        points: hours.map((h, index) => ({ t: iso(h.datetime), v: gusts[index] })),
      });
    }
    const chart = {
      type: 'chart',
      chart_type: 'line',
      title,
      unit: labels.speed,
      series,
      now_marker: true,
    };
    if (hasGusts) {
      chart.annotations = [
        {
          t: iso(hours[gustIndex].datetime),
          value: maxGustValue,
          label: `${maxGustValue}`,
          color: 'warning',
        },
      ];
    }
    components.push(chart);
  }
  return { version: 1, ttl_seconds: ttl, components };
}

export {
  WIDGETS,
  TEXTS,
  TTL_SECONDS,
  HOURLY_METRICS,
  HOURLY_SPANS,
  DAILY_SPANS,
  text,
  truncate,
  messageContent,
  buildAlertsWidget,
  readDailySettings,
  dayTitle,
  buildDailyWidget,
  readHourlySettings,
  buildHourlyWidget,
};
