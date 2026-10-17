// -----------------------------------------------------------------------------
// Google weather conditions -> the pivot condition enum of Gladys, and the
// Google icons shown by the widgets.
//
// Google describes the sky with a `WeatherCondition`: a `type` from a fixed
// list of ~40 codes (CLEAR, LIGHT_RAIN_SHOWERS, SNOWSTORM…), a localized
// `description` and an `iconBaseUri` ("https://maps.gstatic.com/weather/v1/
// drizzle"). The type is mapped here; the description is shown as is, it is
// already in the user's language.
//
// Icons. Widget images are served by the integration itself
// (onWidgetGetImage), never by a URL pointing outside: an image key is
// "gw-<icon name>" (underscores written as dashes: image keys accept
// [a-z0-9-] only), and the image handler only fetches
// `https://maps.gstatic.com/weather/v1/<icon name>.png` for a name of the
// documented list below — whatever the key or the API answer contains, no
// other URL can be fetched (no SSRF). An `iconBaseUri` outside this host,
// path or list is ignored and the icon is picked from the condition table of
// the documentation instead.
// -----------------------------------------------------------------------------

import { WEATHER_CONDITIONS as C } from '@gladysassistant/integration-sdk';

// Google condition type -> [pivot condition, day icon, night icon], from the
// "Weather condition icons" table of the documentation.
const CONDITIONS = {
  CLEAR: [C.CLEAR, 'sunny', 'clear'],
  MOSTLY_CLEAR: [C.CLEAR, 'mostly_sunny', 'mostly_clear'],
  PARTLY_CLOUDY: [C.PARTLY_CLOUDY, 'partly_cloudy', 'partly_clear'],
  MOSTLY_CLOUDY: [C.CLOUD, 'mostly_cloudy', 'mostly_cloudy_night'],
  CLOUDY: [C.CLOUD, 'cloudy', 'cloudy'],
  WINDY: [C.WIND, 'windy_breezy', 'clear'],
  WIND_AND_RAIN: [C.RAIN, 'showers', 'showers'],
  LIGHT_RAIN_SHOWERS: [C.DRIZZLE, 'drizzle', 'drizzle'],
  CHANCE_OF_SHOWERS: [C.DRIZZLE, 'drizzle', 'drizzle'],
  SCATTERED_SHOWERS: [C.RAIN, 'scattered_showers', 'scattered_showers'],
  RAIN_SHOWERS: [C.RAIN, 'showers', 'showers'],
  HEAVY_RAIN_SHOWERS: [C.POURING, 'heavy', 'heavy'],
  LIGHT_TO_MODERATE_RAIN: [C.RAIN, 'showers', 'showers'],
  MODERATE_TO_HEAVY_RAIN: [C.POURING, 'heavy', 'heavy'],
  RAIN: [C.RAIN, 'showers', 'showers'],
  LIGHT_RAIN: [C.DRIZZLE, 'drizzle', 'drizzle'],
  HEAVY_RAIN: [C.POURING, 'heavy', 'heavy'],
  RAIN_PERIODICALLY_HEAVY: [C.POURING, 'heavy', 'heavy'],
  LIGHT_SNOW_SHOWERS: [C.SNOW, 'flurries', 'flurries'],
  CHANCE_OF_SNOW_SHOWERS: [C.SNOW, 'snow_showers', 'snow_showers'],
  SCATTERED_SNOW_SHOWERS: [C.SNOW, 'scattered_snow', 'scattered_snow'],
  SNOW_SHOWERS: [C.SNOW, 'scattered_snow', 'scattered_snow'],
  HEAVY_SNOW_SHOWERS: [C.SNOW, 'heavy_snow', 'heavy_snow'],
  LIGHT_TO_MODERATE_SNOW: [C.SNOW, 'snow_showers', 'snow_showers'],
  MODERATE_TO_HEAVY_SNOW: [C.SNOW, 'heavy_snow', 'heavy_snow'],
  SNOW: [C.SNOW, 'snow_showers', 'snow_showers'],
  LIGHT_SNOW: [C.SNOW, 'flurries', 'flurries'],
  HEAVY_SNOW: [C.SNOW, 'heavy_snow', 'heavy_snow'],
  SNOWSTORM: [C.SNOW_THUNDERSTORM, 'snow_showers', 'snow_showers'],
  SNOW_PERIODICALLY_HEAVY: [C.SNOW, 'heavy_snow', 'heavy_snow'],
  HEAVY_SNOW_STORM: [C.SNOW_THUNDERSTORM, 'heavy_snow', 'heavy_snow'],
  BLOWING_SNOW: [C.SNOW, 'blowing_snow', 'blowing_snow'],
  RAIN_AND_SNOW: [C.SLEET, 'wintry_mix', 'wintry_mix'],
  HAIL: [C.HAIL, 'sleet_hail', 'sleet_hail'],
  HAIL_SHOWERS: [C.HAIL, 'wintry_mix', 'wintry_mix'],
  THUNDERSTORM: [C.THUNDERSTORM, 'strong_tstorms', 'strong_tstorms'],
  THUNDERSHOWER: [C.THUNDERSTORM, 'strong_tstorms', 'strong_tstorms'],
  LIGHT_THUNDERSTORM_RAIN: [C.THUNDERSTORM, 'strong_tstorms', 'strong_tstorms'],
  SCATTERED_THUNDERSTORMS: [C.THUNDERSTORM, 'isolated_tstorms', 'isolated_tstorms'],
  HEAVY_THUNDERSTORM: [C.THUNDERSTORM, 'strong_tstorms', 'strong_tstorms'],
};

// Every icon name of the documentation (light theme), the only ones the
// image handler can fetch. `dust` is the example of the WeatherCondition page.
const ICON_NAMES = new Set([
  ...Object.values(CONDITIONS).flatMap(([, day, night]) => [day, night]),
  'dust',
]);

const ICON_HOST = 'maps.gstatic.com';
const ICON_PATH = /^\/weather\/v1\/([a-z_]{1,40})$/;
// Image keys allow [a-z0-9-] only: the underscores of the names become dashes.
const ICON_KEY = /^gw-([a-z-]{1,40})$/;

// Rain conditions turned into freezing rain when Google types the
// precipitation as such (PrecipitationProbability.type).
const RAINY = new Set([C.DRIZZLE, C.RAIN, C.POURING]);

/**
 * @description The pivot condition of a Google WeatherCondition.
 * @param {object|undefined} condition - The WeatherCondition.
 * @param {object} [precipitation] - The Precipitation of the same period.
 * @returns {string} The pivot condition ('unknown' for an unknown type).
 * @example
 * readCondition({ type: 'LIGHT_RAIN' }); // -> 'drizzle'
 */
function readCondition(condition, precipitation) {
  const entry = CONDITIONS[condition?.type];
  if (entry === undefined) {
    return C.UNKNOWN;
  }
  const pivot = entry[0];
  if (RAINY.has(pivot) && precipitation?.probability?.type === 'FREEZING_RAIN') {
    return C.FREEZING_RAIN;
  }
  return pivot;
}

/**
 * @description The localized description of a condition, or null.
 * @param {object|undefined} condition - The WeatherCondition.
 * @returns {string|null} "Partiellement nuageux".
 * @example
 * describe({ description: { text: 'Pluie légère' } }); // -> 'Pluie légère'
 */
function describe(condition) {
  const text = condition?.description?.text;
  return typeof text === 'string' && text.trim() !== '' ? text.trim() : null;
}

/**
 * @description The icon name of an `iconBaseUri`, when it is a documented
 * Google icon on the documented host; null otherwise.
 * @param {unknown} uri - The iconBaseUri.
 * @returns {string|null} The icon name.
 * @example
 * iconNameFromUri('https://maps.gstatic.com/weather/v1/drizzle'); // -> 'drizzle'
 */
function iconNameFromUri(uri) {
  if (typeof uri !== 'string') {
    return null;
  }
  let url;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== ICON_HOST || url.port !== '') {
    return null;
  }
  if (url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    return null;
  }
  const match = ICON_PATH.exec(url.pathname);
  return match !== null && ICON_NAMES.has(match[1]) ? match[1] : null;
}

/**
 * @description The image key of a condition: its own icon when the API gave
 * a valid one, the icon of the documentation table otherwise.
 * @param {object|undefined} condition - The WeatherCondition.
 * @param {boolean} [isDay] - Day or night variant for the table (day by default).
 * @returns {string|null} "gw-drizzle", or null for an unknown condition.
 * @example
 * iconKey({ type: 'CLEAR', iconBaseUri: 'https://maps.gstatic.com/weather/v1/sunny' }); // -> 'gw-sunny'
 */
function iconKey(condition, isDay = true) {
  const fromUri = iconNameFromUri(condition?.iconBaseUri);
  if (fromUri !== null) {
    return `gw-${fromUri.replaceAll('_', '-')}`;
  }
  const entry = CONDITIONS[condition?.type];
  if (entry === undefined) {
    return null;
  }
  return `gw-${(isDay === false ? entry[2] : entry[1]).replaceAll('_', '-')}`;
}

/**
 * @description The PNG URL of an image key, or null when the key is not a
 * documented icon. The ONLY way a URL reaches the image fetcher.
 * @param {unknown} key - The image key.
 * @returns {string|null} "https://maps.gstatic.com/weather/v1/drizzle.png".
 * @example
 * iconUrlFromKey('gw-drizzle'); // -> 'https://maps.gstatic.com/weather/v1/drizzle.png'
 */
function iconUrlFromKey(key) {
  const match = ICON_KEY.exec(String(key));
  const name = match === null ? null : match[1].replaceAll('-', '_');
  if (name === null || !ICON_NAMES.has(name)) {
    return null;
  }
  return `https://${ICON_HOST}/weather/v1/${name}.png`;
}

export {
  CONDITIONS,
  ICON_NAMES,
  ICON_HOST,
  readCondition,
  describe,
  iconNameFromUri,
  iconKey,
  iconUrlFromKey,
};
