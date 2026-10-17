// Fixtures for the tests and the widget illustrations: Google Weather API
// answers shaped exactly like the documented resources (currentConditions,
// forecast/hours, forecast/days, publicAlerts), for Paris on Saturday
// 17 October 2026, 10:00 local time. Deterministic: no clock, no randomness.

const NOW = Date.parse('2026-10-17T08:00:00Z');
const LATITUDE = 48.8566;
const LONGITUDE = 2.3522;
const TIME_ZONE = 'Europe/Paris';
const HOUR = 3600 * 1000;
const ICON = 'https://maps.gstatic.com/weather/v1/';

const DESCRIPTIONS = {
  CLEAR: { en: 'Clear', fr: 'Ciel dégagé', de: 'Klar', es: 'Despejado' },
  MOSTLY_CLEAR: {
    en: 'Mostly clear',
    fr: 'Plutôt dégagé',
    de: 'Überwiegend klar',
    es: 'Mayormente despejado',
  },
  PARTLY_CLOUDY: {
    en: 'Partly cloudy',
    fr: 'Partiellement nuageux',
    de: 'Teilweise bewölkt',
    es: 'Parcialmente nublado',
  },
  MOSTLY_CLOUDY: {
    en: 'Mostly cloudy',
    fr: 'Plutôt nuageux',
    de: 'Überwiegend bewölkt',
    es: 'Mayormente nublado',
  },
  CLOUDY: { en: 'Cloudy', fr: 'Nuageux', de: 'Bewölkt', es: 'Nublado' },
  LIGHT_RAIN: { en: 'Light rain', fr: 'Pluie légère', de: 'Leichter Regen', es: 'Lluvia ligera' },
  RAIN_SHOWERS: { en: 'Rain showers', fr: 'Averses', de: 'Regenschauer', es: 'Chubascos' },
  SCATTERED_THUNDERSTORMS: {
    en: 'Scattered thunderstorms',
    fr: 'Orages épars',
    de: 'Vereinzelte Gewitter',
    es: 'Tormentas dispersas',
  },
  WINDY: { en: 'Windy', fr: 'Venteux', de: 'Windig', es: 'Ventoso' },
};

const ICONS = {
  CLEAR: ['sunny', 'clear'],
  MOSTLY_CLEAR: ['mostly_sunny', 'mostly_clear'],
  PARTLY_CLOUDY: ['partly_cloudy', 'partly_clear'],
  MOSTLY_CLOUDY: ['mostly_cloudy', 'mostly_cloudy_night'],
  CLOUDY: ['cloudy', 'cloudy'],
  LIGHT_RAIN: ['drizzle', 'drizzle'],
  RAIN_SHOWERS: ['showers', 'showers'],
  SCATTERED_THUNDERSTORMS: ['isolated_tstorms', 'isolated_tstorms'],
  WINDY: ['windy_breezy', 'clear'],
};

const condition = (type, language, isDay = true) => ({
  iconBaseUri: `${ICON}${ICONS[type][isDay ? 0 : 1]}`,
  description: {
    text: DESCRIPTIONS[type][language] ?? DESCRIPTIONS[type].en,
    languageCode: language,
  },
  type,
});
const temperature = (degrees) => ({ degrees, unit: 'CELSIUS' });
const speed = (value) => ({ value, unit: 'KILOMETERS_PER_HOUR' });
const precipitation = (percent, quantity, type = 'RAIN') => ({
  probability: { percent, type: percent > 0 ? type : 'NONE' },
  snowQpf: { quantity: 0, unit: 'MILLIMETERS' },
  qpf: { quantity, unit: 'MILLIMETERS' },
});
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

/**
 * @description currentConditions:lookup.
 * @param {string} [language] - The languageCode.
 * @returns {object} The answer.
 */
function current(language = 'en') {
  return {
    currentTime: '2026-10-17T07:58:12.401Z',
    timeZone: { id: TIME_ZONE },
    isDaytime: true,
    weatherCondition: condition('PARTLY_CLOUDY', language),
    temperature: temperature(14.2),
    feelsLikeTemperature: temperature(12.9),
    dewPoint: temperature(9.1),
    heatIndex: temperature(14.2),
    windChill: temperature(12.9),
    relativeHumidity: 72,
    uvIndex: 2,
    precipitation: precipitation(10, 0),
    thunderstormProbability: 0,
    airPressure: { meanSeaLevelMillibars: 1016.4 },
    wind: {
      direction: { degrees: 225, cardinal: 'SOUTHWEST' },
      speed: speed(14),
      gust: speed(29),
    },
    visibility: { distance: 16, unit: 'KILOMETERS' },
    cloudCover: 45,
    currentConditionsHistory: {
      temperatureChange: temperature(1.5),
      maxTemperature: temperature(15.8),
      minTemperature: temperature(8.4),
      qpf: { quantity: 1.2, unit: 'MILLIMETERS' },
    },
  };
}

// Hour by hour from 10:00 local: a mild day, showers then a stormy evening.
const HOURLY_TYPES = [
  'PARTLY_CLOUDY',
  'PARTLY_CLOUDY',
  'MOSTLY_CLOUDY',
  'MOSTLY_CLOUDY',
  'CLOUDY',
  'LIGHT_RAIN',
  'RAIN_SHOWERS',
  'RAIN_SHOWERS',
  'SCATTERED_THUNDERSTORMS',
  'SCATTERED_THUNDERSTORMS',
  'RAIN_SHOWERS',
  'CLOUDY',
  'MOSTLY_CLOUDY',
  'MOSTLY_CLOUDY',
  'PARTLY_CLOUDY',
  'MOSTLY_CLEAR',
  'MOSTLY_CLEAR',
  'CLEAR',
  'CLEAR',
  'CLEAR',
  'MOSTLY_CLEAR',
  'PARTLY_CLOUDY',
  'PARTLY_CLOUDY',
  'PARTLY_CLOUDY',
];
const HOURLY_TEMPERATURES = [
  14.2, 15.1, 15.9, 16.6, 16.8, 16.1, 15.2, 14.6, 14.1, 13.4, 12.8, 12.1, 11.6, 11.2, 10.8, 10.3,
  9.9, 9.5, 9.2, 9.0, 9.4, 10.6, 11.9, 13.2,
];
const HOURLY_RAIN = [
  10, 10, 15, 20, 35, 55, 70, 75, 85, 80, 60, 30, 20, 15, 10, 5, 5, 0, 0, 0, 0, 5, 5, 10,
];
const HOURLY_QPF = [
  0, 0, 0, 0, 0.1, 0.4, 1.2, 1.6, 2.8, 2.2, 0.9, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
const HOURLY_WIND = [
  14, 16, 18, 21, 24, 27, 31, 34, 38, 36, 30, 25, 21, 18, 15, 12, 10, 9, 8, 8, 9, 11, 13, 15,
];

/**
 * @description forecast/hours:lookup (24 hours from the current hour).
 * @param {string} [language] - The languageCode.
 * @returns {object} The answer.
 */
function hourly(language = 'en') {
  return {
    forecastHours: HOURLY_TYPES.map((type, index) => {
      const start = NOW + index * HOUR;
      const localHour = (10 + index) % 24;
      const isDay = localHour >= 8 && localHour < 19;
      return {
        interval: { startTime: iso(start), endTime: iso(start + HOUR) },
        displayDateTime: {
          year: 2026,
          month: 10,
          day: 17 + Math.floor((10 + index) / 24),
          hours: localHour,
          utcOffset: '7200s',
        },
        isDaytime: isDay,
        weatherCondition: condition(type, language, isDay),
        temperature: temperature(HOURLY_TEMPERATURES[index]),
        feelsLikeTemperature: temperature(Math.round((HOURLY_TEMPERATURES[index] - 1.4) * 10) / 10),
        dewPoint: temperature(9),
        relativeHumidity: 70 + (index % 5) * 4,
        uvIndex: isDay ? 2 : 0,
        precipitation: precipitation(HOURLY_RAIN[index], HOURLY_QPF[index]),
        thunderstormProbability: type === 'SCATTERED_THUNDERSTORMS' ? 40 : 0,
        airPressure: { meanSeaLevelMillibars: 1016 - index * 0.3 },
        wind: {
          direction: { degrees: 225 + index * 2, cardinal: 'SOUTHWEST' },
          speed: speed(HOURLY_WIND[index]),
          gust: speed(Math.round(HOURLY_WIND[index] * 1.9)),
        },
        visibility: { distance: 16, unit: 'KILOMETERS' },
        cloudCover: 40 + (index % 6) * 10,
      };
    }),
    timeZone: { id: TIME_ZONE },
  };
}

const DAILY = [
  // type, max, min, rain day, rain night, qpf day, qpf night, wind, uv
  ['RAIN_SHOWERS', 16.8, 8.9, 70, 40, 6.4, 1.1, 34, 2],
  ['PARTLY_CLOUDY', 15.4, 7.2, 10, 5, 0, 0, 18, 3],
  ['CLEAR', 17.1, 6.5, 0, 0, 0, 0, 12, 3],
  ['MOSTLY_CLOUDY', 15.9, 9.8, 20, 35, 0.2, 0.8, 21, 2],
  ['LIGHT_RAIN', 13.8, 9.1, 65, 60, 3.1, 2.4, 28, 1],
  ['WINDY', 12.6, 7.7, 30, 20, 0.6, 0.3, 46, 2],
  ['PARTLY_CLOUDY', 13.2, 5.9, 10, 10, 0, 0, 16, 2],
  ['MOSTLY_CLEAR', 14.0, 5.1, 5, 5, 0, 0, 11, 3],
  ['CLOUDY', 13.5, 7.9, 25, 30, 0.3, 0.5, 19, 1],
  ['SCATTERED_THUNDERSTORMS', 15.3, 10.2, 60, 45, 4.8, 1.7, 33, 2],
];

/**
 * @description forecast/days:lookup (10 days from today).
 * @param {string} [language] - The languageCode.
 * @returns {object} The answer.
 */
function daily(language = 'en') {
  return {
    forecastDays: DAILY.map(
      ([type, max, min, rainDay, rainNight, qpfDay, qpfNight, wind, uv], index) => {
        // A forecast day runs 07:00 to 07:00 local time (05:00 UTC in October).
        const start = Date.parse('2026-10-17T05:00:00Z') + index * 24 * HOUR;
        const date = new Date(Date.UTC(2026, 9, 17 + index));
        const part = (from, isDay, rain, qpf) => ({
          interval: { startTime: iso(from), endTime: iso(from + 12 * HOUR) },
          weatherCondition: condition(isDay ? type : 'PARTLY_CLOUDY', language, isDay),
          relativeHumidity: isDay ? 68 : 84,
          uvIndex: isDay ? uv : 0,
          precipitation: precipitation(rain, qpf),
          thunderstormProbability: type === 'SCATTERED_THUNDERSTORMS' ? 30 : 0,
          wind: {
            direction: { degrees: isDay ? 230 : 250, cardinal: 'SOUTHWEST' },
            speed: speed(isDay ? wind : Math.round(wind * 0.7)),
            gust: speed(Math.round(wind * (isDay ? 1.8 : 1.4))),
          },
          cloudCover: isDay ? 55 : 40,
          iceThickness: { thickness: 0, unit: 'MILLIMETERS' },
        });
        return {
          interval: { startTime: iso(start), endTime: iso(start + 24 * HOUR) },
          displayDate: {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
          },
          daytimeForecast: part(start, true, rainDay, qpfDay),
          nighttimeForecast: part(start + 12 * HOUR, false, rainNight, qpfNight),
          maxTemperature: temperature(max),
          minTemperature: temperature(min),
          feelsLikeMaxTemperature: temperature(max - 1),
          feelsLikeMinTemperature: temperature(min - 2),
          maxHeatIndex: temperature(max),
          sunEvents: {
            sunriseTime: iso(
              Date.parse('2026-10-17T06:22:00Z') + index * 24 * HOUR + index * 90000,
            ),
            sunsetTime: iso(
              Date.parse('2026-10-17T16:56:00Z') + index * 24 * HOUR - index * 120000,
            ),
          },
          moonEvents: { moonPhase: 'WAXING_CRESCENT', moonriseTimes: [], moonsetTimes: [] },
        };
      },
    ),
    timeZone: { id: TIME_ZONE },
  };
}

const ALERT_TEXTS = {
  storm: {
    en: 'Orange warning: thunderstorms',
    fr: 'Vigilance orange orages',
    de: 'Warnung Orange: Gewitter',
    es: 'Aviso naranja: tormentas',
  },
  wind: {
    en: 'Yellow warning: wind',
    fr: 'Vigilance jaune vent violent',
    de: 'Warnung Gelb: Wind',
    es: 'Aviso amarillo: viento',
  },
};

/**
 * @description One PublicAlerts record.
 * @param {object} [overrides] - Fields to override.
 * @param {string} [language] - The languageCode.
 * @returns {object} The record.
 */
function alert(overrides = {}, language = 'en') {
  return {
    alertId: 'urn:oid:2.49.0.1.250.0.FR.20261017060000.storm-75',
    alertTitle: {
      text: ALERT_TEXTS.storm[language] ?? ALERT_TEXTS.storm.en,
      languageCode: language,
    },
    eventType: 'THUNDERSTORM',
    areaName: 'Paris',
    instruction: ['Avoid travel during the storms.', 'Unplug sensitive electrical appliances.'],
    safetyRecommendations: [{ directive: 'Shelter indoors', subtext: 'Away from trees' }],
    timezoneOffset: '7200s',
    startTime: '2026-10-17T14:00:00Z',
    expirationTime: '2026-10-18T04:00:00Z',
    dataSource: {
      publisher: 'METEO_ALARM_FR',
      name: 'Météo-France',
      authorityUri: 'https://vigilance.meteofrance.fr/',
    },
    polygon: '{"type":"Polygon","coordinates":[[[2.2,48.8],[2.5,48.8],[2.5,48.9],[2.2,48.8]]]}',
    description:
      'Thunderstorms expected in the afternoon and evening, locally strong, with hail and gusts up to 90 km/h.',
    severity: 'SEVERE',
    certainty: 'LIKELY',
    urgency: 'FUTURE',
    ...overrides,
  };
}

/**
 * @description publicAlerts:lookup.
 * @param {string} [language] - The languageCode.
 * @returns {object} The answer.
 */
function alerts(language = 'en') {
  return {
    weatherAlerts: [
      alert({}, language),
      alert(
        {
          alertId: 'urn:oid:2.49.0.1.250.0.FR.20261017060000.wind-75',
          alertTitle: {
            text: ALERT_TEXTS.wind[language] ?? ALERT_TEXTS.wind.en,
            languageCode: language,
          },
          eventType: 'WIND',
          severity: 'MODERATE',
          certainty: 'LIKELY',
          urgency: 'EXPECTED',
          startTime: '2026-10-17T08:00:00Z',
          expirationTime: '2026-10-17T22:00:00Z',
          description: 'Strong gusts up to 80 km/h in the afternoon.',
          instruction: [],
          safetyRecommendations: [],
        },
        language,
      ),
    ],
    regionCode: 'FR',
  };
}

export { NOW, LATITUDE, LONGITUDE, TIME_ZONE, HOUR, current, hourly, daily, alert, alerts };
