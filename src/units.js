// -----------------------------------------------------------------------------
// Units: from what Google answers to what Gladys asks for.
//
// Every Google quantity carries its unit (Temperature.unit, WindSpeed.unit,
// QuantitativePrecipitationForecast.unit, Visibility.unit): it is read rather
// than assumed, even though the integration always asks for METRIC.
//
// Gladys asks for one of two systems (contract B.18): `metric` (°C, m/s, hPa,
// mm, km) or `us` (°F, mph, hPa, in, mi). Pressure stays in hPa (= millibars)
// in both.
// -----------------------------------------------------------------------------

/**
 * @description Round to a number of decimals.
 * @param {number} value - The value.
 * @param {number} [decimals] - Decimals (1).
 * @returns {number} The rounded value.
 * @example
 * round(1.26); // -> 1.3
 */
function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * @description Whether a value is a finite number.
 * @param {unknown} value - The value.
 * @returns {boolean} True for a finite number.
 * @example
 * isNumber(NaN); // -> false
 */
function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @description A Google Temperature in the requested system.
 * @param {object|undefined} temperature - { degrees, unit }.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number|undefined} °C or °F.
 * @example
 * temperatureOf({ degrees: 20, unit: 'CELSIUS' }, 'us'); // -> 68
 */
function temperatureOf(temperature, units) {
  const degrees = temperature?.degrees;
  if (!isNumber(degrees)) {
    return undefined;
  }
  const celsius = temperature.unit === 'FAHRENHEIT' ? ((degrees - 32) * 5) / 9 : degrees;
  return units === 'us' ? round((celsius * 9) / 5 + 32) : round(celsius);
}

/**
 * @description A Google WindSpeed in the requested system.
 * @param {object|undefined} speed - { value, unit }.
 * @param {string} units - 'metric' (m/s) or 'us' (mph).
 * @returns {number|undefined} The speed.
 * @example
 * speedOf({ value: 36, unit: 'KILOMETERS_PER_HOUR' }, 'metric'); // -> 10
 */
function speedOf(speed, units) {
  const value = speed?.value;
  if (!isNumber(value)) {
    return undefined;
  }
  const kmh = speed.unit === 'MILES_PER_HOUR' ? value * 1.609344 : value;
  return units === 'us' ? round(kmh / 1.609344) : round(kmh / 3.6);
}

/**
 * @description A Google QuantitativePrecipitationForecast in the requested system.
 * @param {object|undefined} qpf - { quantity, unit }.
 * @param {string} units - 'metric' (mm) or 'us' (in).
 * @returns {number|undefined} The amount.
 * @example
 * precipitationOf({ quantity: 2.54, unit: 'MILLIMETERS' }, 'us'); // -> 0.1
 */
function precipitationOf(qpf, units) {
  const quantity = qpf?.quantity;
  if (!isNumber(quantity)) {
    return undefined;
  }
  const mm = qpf.unit === 'INCHES' ? quantity * 25.4 : quantity;
  return units === 'us' ? round(mm / 25.4, 2) : round(mm, 1);
}

/**
 * @description A Google Visibility in the requested system.
 * @param {object|undefined} visibility - { distance, unit }.
 * @param {string} units - 'metric' (km) or 'us' (mi).
 * @returns {number|undefined} The distance.
 * @example
 * distanceOf({ distance: 16, unit: 'KILOMETERS' }, 'us'); // -> 9.9
 */
function distanceOf(visibility, units) {
  const distance = visibility?.distance;
  if (!isNumber(distance)) {
    return undefined;
  }
  const km = visibility.unit === 'MILES' ? distance * 1.609344 : distance;
  return units === 'us' ? round(km / 1.609344) : round(km);
}

/**
 * @description Clamp a percentage to 0-100, rounded.
 * @param {unknown} value - The percentage.
 * @returns {number|undefined} The clamped value.
 * @example
 * percent(101); // -> 100
 */
function percent(value) {
  return isNumber(value) ? Math.min(100, Math.max(0, Math.round(value))) : undefined;
}

// The 16 compass points, from 0° clockwise.
const COMPASS_POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

/**
 * @description The compass point of a direction, with the letters of each
 * language (O for Ouest / Oeste, E stays E).
 * @param {number|undefined} degrees - The direction.
 * @param {string} [language] - The language.
 * @returns {string|undefined} "SW", "SO"…
 * @example
 * compassOf(225, 'fr'); // -> 'SO'
 */
function compassOf(degrees, language = 'en') {
  if (!isNumber(degrees)) {
    return undefined;
  }
  const point = COMPASS_POINTS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
  return language === 'fr' || language === 'es' ? point.replaceAll('W', 'O') : point;
}

/**
 * @description The unit labels shown in widgets and sentences.
 * @param {string} units - 'metric' or 'us'.
 * @returns {{ temperature: string, speed: string, precipitation: string, distance: string }}
 * The labels (wind shown in km/h in metric, as weather services do).
 * @example
 * unitLabels('us').speed; // -> 'mph'
 */
function unitLabels(units) {
  return units === 'us'
    ? { temperature: '°F', speed: 'mph', precipitation: 'in', distance: 'mi' }
    : { temperature: '°C', speed: 'km/h', precipitation: 'mm', distance: 'km' };
}

/**
 * @description A pivot wind speed (m/s or mph) as displayed (km/h or mph).
 * @param {number|undefined} speed - The pivot speed.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number|undefined} The displayed speed, rounded.
 * @example
 * displaySpeed(10, 'metric'); // -> 36
 */
function displaySpeed(speed, units) {
  if (!isNumber(speed)) {
    return undefined;
  }
  return units === 'us' ? Math.round(speed) : Math.round(speed * 3.6);
}

export {
  round,
  isNumber,
  temperatureOf,
  speedOf,
  precipitationOf,
  distanceOf,
  percent,
  compassOf,
  unitLabels,
  displaySpeed,
};
