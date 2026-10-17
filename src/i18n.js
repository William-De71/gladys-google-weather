// -----------------------------------------------------------------------------
// The languages of the integration.
//
// Gladys runs in English, French, German or Spanish: every text this
// integration writes exists in the four (test/i18n.test.js), any other
// language falls back to English. Google's own texts (condition descriptions,
// alert titles and bodies) come localized through `languageCode`.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * @description A label inside a sentence: lower-cased, except in German, where
 * nouns keep their capital ("Regen", not "regen").
 * @param {string} label - The label ("Rain", "Regen").
 * @param {string} language - The language.
 * @returns {string} The label to put in a sentence.
 * @example
 * inSentence('Heavy rain', 'en'); // -> 'heavy rain'
 */
function inSentence(label, language) {
  return language === 'de' ? label : label.toLowerCase();
}

/**
 * @description A percentage: "40%" in English, "40 %" in the other languages.
 * @param {number} value - The value.
 * @param {string} language - The language.
 * @returns {string} The percentage.
 * @example
 * formatPercent(40, 'fr'); // -> '40 %'
 */
function formatPercent(value, language) {
  return language === 'en' || !LANGUAGES.includes(language) ? `${value}%` : `${value} %`;
}

// Runtime messages: connection status and configuration action results.
const MESSAGES = {
  noKey: {
    en: 'Enter the API key of your Google Cloud project (Weather API enabled) in the configuration.',
    fr: 'Saisissez la clé API de votre projet Google Cloud (Weather API activée) dans la configuration.',
    de: 'Gib in der Konfiguration den API-Schlüssel deines Google-Cloud-Projekts (Weather API aktiviert) ein.',
    es: 'Introduzca en la configuración la clave API de su proyecto de Google Cloud (Weather API activada).',
  },
  keyInvalid: {
    en: 'Google rejected the API key ({reason}). Check the key, that the Weather API is enabled, that billing is active and the key restrictions.',
    fr: 'Google a refusé la clé API ({reason}). Vérifiez la clé, que la Weather API est activée, que la facturation est active et les restrictions de la clé.',
    de: 'Google hat den API-Schlüssel abgelehnt ({reason}). Prüfe den Schlüssel, ob die Weather API aktiviert und die Abrechnung aktiv ist, sowie die Schlüsseleinschränkungen.',
    es: 'Google rechazó la clave API ({reason}). Compruebe la clave, que la Weather API está activada, que la facturación está activa y las restricciones de la clave.',
  },
  quota: {
    en: 'Google refused the request for quota reasons (429). The cached weather is served meanwhile.',
    fr: 'Google a refusé la requête pour raison de quota (429). La météo en cache est servie en attendant.',
    de: 'Google hat die Anfrage wegen des Kontingents abgelehnt (429). Bis dahin wird das zwischengespeicherte Wetter geliefert.',
    es: 'Google rechazó la solicitud por cuota (429). Mientras tanto se sirve la meteorología en caché.',
  },
  budget: {
    en: 'Monthly budget reached ({used}/{budget} calls in {month}): no call to Google until next month, the cached weather is served.',
    fr: 'Budget mensuel atteint ({used}/{budget} appels en {month}) : plus aucun appel à Google avant le mois prochain, la météo en cache est servie.',
    de: 'Monatsbudget erreicht ({used}/{budget} Aufrufe im {month}): bis zum nächsten Monat kein Aufruf an Google, das zwischengespeicherte Wetter wird geliefert.',
    es: 'Presupuesto mensual alcanzado ({used}/{budget} llamadas en {month}): ninguna llamada a Google hasta el mes próximo, se sirve la meteorología en caché.',
  },
  testOk: {
    en: 'API key OK for "{house}": {temperature}, {sky}. Calls this month: {used} of {budget} (about {estimate} a month per house with these settings).',
    fr: 'Clé API valide pour « {house} » : {temperature}, {sky}. Appels ce mois-ci : {used} sur {budget} (environ {estimate} par mois et par maison avec ces réglages).',
    de: 'API-Schlüssel gültig für „{house}“: {temperature}, {sky}. Aufrufe in diesem Monat: {used} von {budget} (etwa {estimate} pro Monat und Zuhause mit diesen Einstellungen).',
    es: 'Clave API válida para «{house}»: {temperature}, {sky}. Llamadas este mes: {used} de {budget} (unas {estimate} al mes por casa con estos ajustes).',
  },
  testFailed: {
    en: 'Test failed: {reason}',
    fr: 'Échec du test : {reason}',
    de: 'Test fehlgeschlagen: {reason}',
    es: 'La prueba falló: {reason}',
  },
  noHouse: {
    en: 'No house of Gladys has a location: set it in the house settings.',
    fr: 'Aucune maison de Gladys n’est localisée : renseignez sa position dans ses réglages.',
    de: 'Kein Zuhause in Gladys hat einen Standort: Lege ihn in den Einstellungen des Zuhauses fest.',
    es: 'Ninguna casa de Gladys tiene ubicación: defínala en los ajustes de la casa.',
  },
  outOfCoverage: {
    en: 'Google Weather has no data for this location: Gladys uses the next weather provider.',
    fr: 'Google Weather ne fournit pas de données pour ce lieu : Gladys passe au fournisseur météo suivant.',
    de: 'Google Weather hat keine Daten für diesen Ort: Gladys nutzt den nächsten Wetteranbieter.',
    es: 'Google Weather no tiene datos para este lugar: Gladys usa el siguiente proveedor meteorológico.',
  },
};

/**
 * @description One runtime message in a language, with `{name}` substitutions.
 * @param {string} key - The MESSAGES key.
 * @param {string} language - The language (English fallback).
 * @param {object} [values] - Substitutions.
 * @returns {string} The message (≤ 200 characters is the caller's concern).
 * @example
 * t('testFailed', 'fr', { reason: 'timeout' }); // -> 'Échec du test : timeout'
 */
function t(key, language, values = {}) {
  const entry = MESSAGES[key];
  const template = entry[language] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

/**
 * @description A runtime message in the four languages.
 * @param {string} key - The MESSAGES key.
 * @param {object|Function} [values] - Substitutions, or `(language) => values`.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 * @example
 * all('noKey');
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

export { LANGUAGES, MESSAGES, inSentence, formatPercent, t, all };
