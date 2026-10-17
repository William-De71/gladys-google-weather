// -----------------------------------------------------------------------------
// Google public weather alerts: reading, classifying, and mapping to the
// Gladys pivot format.
//
// Google relays the official alerts of national services (MeteoAlarm for most
// of Europe — Météo-France vigilance included —, the DWD, NOAA, the JMA…) as
// `PublicAlerts` records: a localized title, a type among ~60 `eventType`
// codes, a CAP severity / urgency / certainty, start and expiration times,
// the area and the publisher. Alerts are not available everywhere (see the
// coverage table): an empty list is the normal answer outside the covered
// countries, never an error.
//
// Added here:
//   - a CATEGORY grouping the event types (15 instead of ~60), for the scene
//     trigger filter and the widget; the pivot `type` (wind, rain, flood…) is
//     derived from it;
//   - the CAP severity lower-cased. MeteoAlarm colors map onto it: yellow =
//     moderate, orange = severe, red = extreme.
// -----------------------------------------------------------------------------

import { WEATHER_ALERT_TYPES as T } from '@gladysassistant/integration-sdk';

const SEVERITIES = ['extreme', 'severe', 'moderate', 'minor', 'unknown'];
const SEVERITY_RANK = { unknown: 0, minor: 1, moderate: 2, severe: 3, extreme: 4 };

const MAX_PIVOT_ALERTS = 10;
const MAX_PIVOT_DESCRIPTION = 5000;
const MAX_PIVOT_EVENT = 100;

// Category -> [pivot type (undefined: none), Google event types].
const CATEGORY_TYPES = {
  thunderstorm: [
    T.THUNDERSTORM,
    ['THUNDER', 'THUNDERSTORM', 'SEVERE_THUNDERSTORM_WARNING', 'HAIL'],
  ],
  tornado: [T.WIND, ['TORNADO', 'TORNADO_WARNING']],
  tropical: [
    T.WIND,
    [
      'CYCLONE',
      'EXTRATROPICAL_CYCLONE',
      'HURRICANE',
      'TROPICAL_CYCLONE',
      'TROPICAL_CYCLONE_WARNINGS_AND_WATCHES',
      'TROPICAL_DISTURBANCE',
      'TROPICAL_STORM',
      'TYPHOON',
      'MONSOON',
    ],
  ],
  wind: [T.WIND, ['WIND', 'GALE', 'STORM', 'OUTFLOW']],
  rain: [T.RAIN, ['RAIN_EVENT']],
  flood: [T.FLOOD, ['FLOOD', 'FLASH_FLOOD', 'RIVER_FLOODING', 'MUDDY_FLOOD']],
  snow_ice: [
    T.SNOW,
    [
      'SNOW_EVENT',
      'BLIZZARD',
      'BLOWING_SNOW',
      'LAKE_EFFECT_SNOW',
      'SNOWSQUALL',
      'WINTER_STORM',
      'ICE_STORM',
      'FREEZING_DRIZZLE',
      'FREEZING_RAIN_EVENT',
      'GLAZE',
      'AVALANCHE',
    ],
  ],
  cold: [T.COLD, ['COLD', 'FREEZING', 'FREEZING_AIR_TEMPERATURE', 'FROST', 'WIND_CHILL']],
  heat: [T.HEAT, ['HEAT', 'HUMIDITY']],
  fire: [undefined, ['BUSHFIRE', 'FIRE', 'FIRE_WEATHER', 'WILDFIRE', 'INDUSTRIAL_FIRE', 'DROUGHT']],
  fog: [T.FOG, ['FOG']],
  coastal: [
    T.COASTAL,
    ['COASTAL_FLOOD', 'COASTAL_HAZARD', 'HAZARDOUS_SEAS', 'STORM_SURGE', 'WIND_WAVE', 'TSUNAMI'],
  ],
  geological: [
    undefined,
    ['EARTHQUAKE', 'AFTERSHOCK', 'VOLCANIC_ASH', 'VOLCANIC_ERUPTION', 'LANDSLIDE'],
  ],
  air: [undefined, ['ACID_RAIN', 'DUST_STORM', 'RADIATION']],
  other: [undefined, []],
};

const CATEGORIES = Object.keys(CATEGORY_TYPES);

// Google event type -> category.
const EVENT_CATEGORY = Object.fromEntries(
  Object.entries(CATEGORY_TYPES).flatMap(([category, [, types]]) =>
    types.map((type) => [type, category]),
  ),
);

const CATEGORY_LABELS = {
  thunderstorm: { en: 'Thunderstorm', fr: 'Orages', de: 'Gewitter', es: 'Tormentas' },
  tornado: { en: 'Tornado', fr: 'Tornade', de: 'Tornado', es: 'Tornado' },
  tropical: {
    en: 'Cyclone / hurricane',
    fr: 'Cyclone / ouragan',
    de: 'Zyklon / Hurrikan',
    es: 'Ciclón / huracán',
  },
  wind: { en: 'Wind', fr: 'Vent violent', de: 'Wind', es: 'Viento' },
  rain: { en: 'Heavy rain', fr: 'Pluie-inondation', de: 'Starkregen', es: 'Lluvias' },
  flood: { en: 'Flood', fr: 'Crues', de: 'Hochwasser', es: 'Inundaciones' },
  snow_ice: { en: 'Snow / ice', fr: 'Neige-verglas', de: 'Schnee / Glätte', es: 'Nieve / hielo' },
  cold: { en: 'Cold', fr: 'Grand froid', de: 'Kälte', es: 'Frío' },
  heat: { en: 'Heat', fr: 'Canicule', de: 'Hitze', es: 'Calor' },
  fire: {
    en: 'Fire / drought',
    fr: 'Feux / sécheresse',
    de: 'Brand / Dürre',
    es: 'Incendios / sequía',
  },
  fog: { en: 'Fog', fr: 'Brouillard', de: 'Nebel', es: 'Niebla' },
  coastal: {
    en: 'Coast / sea',
    fr: 'Vagues-submersion',
    de: 'Küste / Meer',
    es: 'Costa / mar',
  },
  geological: {
    en: 'Earthquake / volcano',
    fr: 'Séisme / volcan',
    de: 'Erdbeben / Vulkan',
    es: 'Sismo / volcán',
  },
  air: {
    en: 'Air / radiation',
    fr: 'Air / radiation',
    de: 'Luft / Strahlung',
    es: 'Aire / radiación',
  },
  other: { en: 'Other', fr: 'Autre', de: 'Sonstiges', es: 'Otro' },
};

const SEVERITY_LABELS = {
  extreme: { en: 'Extreme', fr: 'Extrême', de: 'Extrem', es: 'Extrema' },
  severe: { en: 'Severe', fr: 'Sévère', de: 'Schwer', es: 'Grave' },
  moderate: { en: 'Moderate', fr: 'Modérée', de: 'Mäßig', es: 'Moderada' },
  minor: { en: 'Minor', fr: 'Mineure', de: 'Gering', es: 'Menor' },
  unknown: { en: 'Unknown', fr: 'Inconnue', de: 'Unbekannt', es: 'Desconocida' },
};

/**
 * @description A label in the user's language (English fallback).
 * @param {object} labels - Labels keyed by value.
 * @param {string} key - The value.
 * @param {string} language - The language.
 * @returns {string} The label.
 * @example
 * localize(SEVERITY_LABELS, 'severe', 'fr'); // -> 'Sévère'
 */
function localize(labels, key, language) {
  const entry = labels[key] ?? labels.other ?? labels.unknown;
  return entry[language] ?? entry.en;
}

/**
 * @description The category of a Google event type.
 * @param {string} eventType - The WeatherEventType.
 * @returns {{ category: string, pivot: string|undefined }} The category and pivot type.
 * @example
 * classifyEvent('FLASH_FLOOD'); // -> { category: 'flood', pivot: 'flood' }
 */
function classifyEvent(eventType) {
  const category = EVENT_CATEGORY[eventType] ?? 'other';
  const pivot = eventType === 'AVALANCHE' ? T.AVALANCHE : CATEGORY_TYPES[category][0];
  return { category, pivot };
}

/**
 * @description The CAP severity, lower-cased ('unknown' outside the scale).
 * @param {string} severity - The Severity enum.
 * @returns {string} The severity.
 * @example
 * readSeverity('SEVERE'); // -> 'severe'
 */
function readSeverity(severity) {
  const value = String(severity ?? '').toLowerCase();
  return SEVERITY_RANK[value] !== undefined && value !== 'unknown' ? value : 'unknown';
}

/**
 * @description A CAP enum lower-cased, null when unknown or unspecified.
 * @param {string} value - URGENCY_UNKNOWN, IMMEDIATE…
 * @returns {string|null} 'immediate', 'likely'…
 * @example
 * readEnum('VERY_LIKELY'); // -> 'very_likely'
 */
function readEnum(value) {
  if (typeof value !== 'string' || /UNKNOWN|UNSPECIFIED/.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

const textOrNull = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * @description An https URL, or null (the authority link goes into a widget).
 * @param {unknown} value - The URL.
 * @returns {string|null} The URL.
 * @example
 * httpsUrl('https://vigilance.meteofrance.fr'); // -> 'https://vigilance.meteofrance.fr/'
 */
function httpsUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * @description Normalize the `weatherAlerts` of publicAlerts:lookup: alerts
 * expired or no longer requiring action (urgency PAST) dropped, sorted the
 * most serious first.
 * @param {Array<object>} records - The PublicAlerts records.
 * @param {number} [now] - Current time in ms.
 * @returns {Array<object>} The alerts.
 * @example
 * const alerts = readAlerts(body.weatherAlerts);
 */
function readAlerts(records, now = Date.now()) {
  const alerts = (Array.isArray(records) ? records : [])
    .filter((record) => record && typeof record.alertId === 'string' && record.alertId !== '')
    .map((record) => {
      const eventType = typeof record.eventType === 'string' ? record.eventType : 'UNSPECIFIED';
      const { category, pivot } = classifyEvent(eventType);
      const instructions = (Array.isArray(record.instruction) ? record.instruction : [])
        .map(textOrNull)
        .filter(Boolean);
      const safety = (
        Array.isArray(record.safetyRecommendations) ? record.safetyRecommendations : []
      )
        .map((item) =>
          [textOrNull(item?.directive), textOrNull(item?.subtext)].filter(Boolean).join(' — '),
        )
        .filter((line) => line !== '');
      return {
        id: record.alertId,
        title: textOrNull(record.alertTitle?.text),
        eventType,
        category,
        pivotType: pivot,
        severity: readSeverity(record.severity),
        urgency: readEnum(record.urgency),
        certainty: readEnum(record.certainty),
        area: textOrNull(record.areaName),
        description: textOrNull(record.description),
        instruction: [...instructions, ...safety].join('\n') || null,
        source: textOrNull(record.dataSource?.name),
        publisher: readEnum(record.dataSource?.publisher),
        url: httpsUrl(record.dataSource?.authorityUri),
        start: textOrNull(record.startTime),
        end: textOrNull(record.expirationTime),
      };
    })
    .filter((alert) => alert.urgency !== 'past')
    .filter((alert) => alert.end === null || !(Date.parse(alert.end) <= now));

  return alerts.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      String(a.start).localeCompare(String(b.start)) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * @description The name of an alert: its localized title, else its category.
 * @param {object} alert - A readAlerts() alert.
 * @param {string} language - The language.
 * @returns {string} The name.
 * @example
 * alertName(alert, 'fr'); // -> 'Vigilance orange orages'
 */
function alertName(alert, language) {
  return alert.title ?? localize(CATEGORY_LABELS, alert.category, language);
}

/**
 * @description Map the alerts to the pivot format of Gladys (≤ 10, the most
 * serious first). An unknown severity is sent as 'minor': CAP has no lower
 * step, and dropping the alert would hide it.
 * @param {Array<object>} alerts - The readAlerts() alerts.
 * @param {string} language - The language of the event names.
 * @returns {Array<object>} The pivot alerts.
 * @example
 * weather.alerts = toPivotAlerts(alerts, 'fr');
 */
function toPivotAlerts(alerts, language) {
  return alerts.slice(0, MAX_PIVOT_ALERTS).map((alert) => {
    const pivot = {
      severity: alert.severity === 'unknown' ? 'minor' : alert.severity,
      event: alertName(alert, language).slice(0, MAX_PIVOT_EVENT),
    };
    const description = [alert.description, alert.instruction].filter(Boolean).join('\n\n');
    if (description) {
      pivot.description = description.slice(0, MAX_PIVOT_DESCRIPTION);
    }
    if (alert.pivotType) {
      pivot.type = alert.pivotType;
    }
    if (alert.start) {
      pivot.start = alert.start;
    }
    if (alert.end) {
      pivot.end = alert.end;
    }
    return pivot;
  });
}

/**
 * @description Count the alerts by severity.
 * @param {Array<object>} alerts - The readAlerts() alerts.
 * @returns {object} `{ extreme, severe, moderate, minor, unknown }`.
 * @example
 * countBySeverity(alerts).severe;
 */
function countBySeverity(alerts) {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  alerts.forEach((alert) => {
    counts[alert.severity] += 1;
  });
  return counts;
}

export {
  SEVERITIES,
  SEVERITY_RANK,
  CATEGORIES,
  CATEGORY_TYPES,
  EVENT_CATEGORY,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  localize,
  classifyEvent,
  readSeverity,
  readEnum,
  httpsUrl,
  readAlerts,
  alertName,
  toPivotAlerts,
  countBySeverity,
};
