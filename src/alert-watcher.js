// -----------------------------------------------------------------------------
// Alert watcher: checks the official alerts of every located house and
// publishes the scene triggers `alert_issued` and `alert_ended`.
//
// Why a watcher of our own when the core has a generic weather-alert trigger:
//   - the core checks every 30 minutes and its filter only knows the pivot
//     types; this trigger filters on the 15 categories (tornado, cyclone,
//     fire, earthquake… have no pivot type) and on the CAP severity, and its
//     variables carry the official title, area, instructions and source;
//   - on every change it nudges the core (`requestWeatherRefresh`) and the
//     alerts widget, so both are up to date at once.
//
// Following an alert. Each Google alert has an `alertId`. An alert that
// leaves the list while another of the SAME event type and severity appears
// in the same check is an update re-issued under a new id: the episode goes
// on, no event. Same event type with another severity (yellow -> orange) is
// an upgrade: `alert_ended` for the old, `alert_issued` for the new, so a
// scene filtered on `severity = severe` runs at the upgrade.
// An alert that disappears without a replacement has ENDED once its
// expiration time has passed, or once it has been missing for two checks in
// a row: one empty answer must not end a storm warning.
// The first check of a house after a start is a BASELINE (no event): a
// restart in the middle of a storm must not re-fire every scene — the rule of
// the core weather-alert trigger.
// -----------------------------------------------------------------------------

import { CATEGORY_LABELS, SEVERITY_LABELS, alertName, localize } from './alerts.js';
import { formatDayTime } from './time.js';
import { inSentence } from './i18n.js';

const SCENE_TRIGGERS = {
  ALERT_ISSUED: 'alert_issued',
  ALERT_ENDED: 'alert_ended',
};

const MISSING_CHECKS_TO_END = 2;
// Scene event strings are capped at 1000 characters by the core.
const MAX_EVENT_STRING = 1000;

const truncate = (text) =>
  typeof text === 'string' && text.length > MAX_EVENT_STRING
    ? `${text.slice(0, MAX_EVENT_STRING - 1)}…`
    : (text ?? null);

// The `summary` sentences, per language (English for any other).
const SUMMARIES = {
  en: {
    ended: ({ name, house }) => `The alert "${name}" for ${house} has ended.`,
    issued: ({ name, house, severity, until }) =>
      `Weather alert for ${house}: ${name} (${severity})${until ? ` until ${until}` : ''}.`,
  },
  fr: {
    ended: ({ name, house }) => `Fin de l'alerte « ${name} » pour ${house}.`,
    issued: ({ name, house, severity, until }) =>
      `Alerte météo pour ${house} : ${name} (${severity})${until ? ` jusqu'à ${until}` : ''}.`,
  },
  de: {
    ended: ({ name, house }) => `Die Warnung „${name}“ für ${house} ist beendet.`,
    issued: ({ name, house, severity, until }) =>
      `Wetterwarnung für ${house}: ${name} (${severity})${until ? ` bis ${until}` : ''}.`,
  },
  es: {
    ended: ({ name, house }) => `Fin de la alerta «${name}» para ${house}.`,
    issued: ({ name, house, severity, until }) =>
      `Alerta meteorológica para ${house}: ${name} (${severity})${until ? ` hasta ${until}` : ''}.`,
  },
};

/**
 * @description Write the one-sentence summary of an issued or ended alert.
 * @param {object} alert - The readAlerts() alert.
 * @param {object} options - { house, ended, language, timeZone }.
 * @returns {string} The sentence.
 * @example
 * alertSummary(alert, { house: 'Home', ended: false, language: 'en', timeZone: 'Europe/Paris' });
 */
function alertSummary(alert, { house, ended, language, timeZone }) {
  const say = SUMMARIES[language] ?? SUMMARIES.en;
  const name = alertName(alert, language);
  if (ended) {
    return say.ended({ name, house });
  }
  return say.issued({
    name,
    house,
    severity: inSentence(localize(SEVERITY_LABELS, alert.severity, language), language),
    until: alert.end ? formatDayTime(alert.end, timeZone, language) : null,
  });
}

/**
 * @description The fields shared by both events.
 * @param {object} alert - The readAlerts() alert.
 * @param {object} options - { house, language }.
 * @returns {object} The flat data.
 * @example
 * commonData(alert, { house: 'Home', language: 'fr' });
 */
function commonData(alert, { house, language }) {
  return {
    house,
    title: truncate(alertName(alert, language)),
    event_type: alert.eventType,
    category: alert.category,
    category_label: localize(CATEGORY_LABELS, alert.category, language),
    severity: alert.severity,
    severity_label: localize(SEVERITY_LABELS, alert.severity, language),
    area: truncate(alert.area),
  };
}

/**
 * @description Build the data of an `alert_issued` event.
 * @param {object} alert - The readAlerts() alert.
 * @param {object} options - { house, language, timeZone }.
 * @returns {object} The flat event data.
 * @example
 * buildIssuedData(alert, { house: 'Home', language: 'en', timeZone: 'Europe/Paris' });
 */
function buildIssuedData(alert, { house, language, timeZone }) {
  return {
    ...commonData(alert, { house, language }),
    urgency: alert.urgency,
    certainty: alert.certainty,
    starts: alert.start ? formatDayTime(alert.start, timeZone, language) : null,
    ends: alert.end ? formatDayTime(alert.end, timeZone, language) : null,
    description: truncate(alert.description),
    instruction: truncate(alert.instruction),
    source: truncate(alert.source),
    summary: truncate(alertSummary(alert, { house, ended: false, language, timeZone })),
  };
}

/**
 * @description Build the data of an `alert_ended` event.
 * @param {object} alert - The readAlerts() alert.
 * @param {object} options - { house, language, timeZone }.
 * @returns {object} The flat event data.
 * @example
 * buildEndedData(alert, { house: 'Home', language: 'en', timeZone: null });
 */
function buildEndedData(alert, { house, language, timeZone }) {
  return {
    ...commonData(alert, { house, language }),
    summary: truncate(alertSummary(alert, { house, ended: true, language, timeZone })),
  };
}

/**
 * @description Create the alert watcher.
 * @param {object} options - Options.
 * @param {object} options.houses - The house registry (houses.js).
 * @param {Function} options.loadAlerts - `(house) => Promise<{ alerts, timeZone }>`:
 * the readAlerts() alerts of the house and its time zone.
 * @param {Function} options.publish - `(key, data) => Promise`, the SDK publishSceneEvent.
 * @param {Function} options.onChange - `(house) => void`: the alerts of a house changed.
 * @param {Function} options.getLanguage - `() => string`.
 * @param {Function} options.getIntervalMs - `() => number`, read before every round.
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @param {Function} [options.now] - `() => number` in ms (for the tests).
 * @returns {object} The watcher ({ check, start, stop, running }).
 * @example
 * const watcher = createAlertWatcher({ houses, loadAlerts, publish, onChange, getLanguage, getIntervalMs });
 */
function createAlertWatcher({
  houses,
  loadAlerts,
  publish,
  onChange,
  getLanguage,
  getIntervalMs,
  logger = console,
  now = () => Date.now(),
}) {
  // house id -> Map<alert id, { alert, missing }>
  const states = new Map();
  let timer = null;
  let started = false;
  let checking = false;

  /**
   * @description Publish an event, never throwing out of a check.
   * @param {string} key - The trigger key.
   * @param {object} data - The event data.
   * @example
   * await safePublish('alert_issued', data);
   */
  async function safePublish(key, data) {
    try {
      await publish(key, data);
      logger.info(`Scene event ${key}: ${data.summary}`);
    } catch (err) {
      logger.warn(`Unable to publish the scene event ${key}: ${err.message}`);
    }
  }

  /**
   * @description Check the alerts of one house and fire what changed.
   * @param {object} house - The house.
   * @example
   * await checkHouse(house);
   */
  async function checkHouse(house) {
    let loaded;
    try {
      loaded = await loadAlerts(house);
    } catch (err) {
      logger.warn(`Unable to check the alerts of house "${house.name}": ${err.message}`);
      return;
    }
    const { alerts, timeZone = null } = loaded;
    const tracked = states.get(house.id);
    if (tracked === undefined) {
      states.set(house.id, new Map(alerts.map((alert) => [alert.id, { alert, missing: 0 }])));
      logger.debug?.(`Alert baseline of house "${house.name}": ${alerts.length} alert(s)`);
      return;
    }

    const context = { house: house.name, language: getLanguage(), timeZone };
    const instant = now();
    const current = new Map(alerts.map((alert) => [alert.id, alert]));
    const sameEpisode = (a, b) => a.eventType === b.eventType && a.severity === b.severity;
    let changed = false;

    // New ids: an update of a tracked alert that just left the list, or new.
    const fresh = alerts.filter((alert) => !tracked.has(alert.id));
    const leaving = [...tracked.values()].filter(({ alert }) => !current.has(alert.id));
    for (const alert of fresh) {
      const replaced = leaving.find((entry) => !entry.taken && sameEpisode(entry.alert, alert));
      if (replaced !== undefined) {
        replaced.taken = true;
        tracked.delete(replaced.alert.id);
        tracked.set(alert.id, { alert, missing: 0 });
        changed = true;
      }
    }

    // Alerts that left the list without a replacement: ended? Replaced by
    // the same event type at another severity (upgrade, downgrade): at once.
    for (const entry of leaving.filter((item) => !item.taken)) {
      entry.missing += 1;
      const expired = entry.alert.end !== null && Date.parse(entry.alert.end) <= instant;
      const regraded = fresh.some((alert) => alert.eventType === entry.alert.eventType);
      if (expired || regraded || entry.missing >= MISSING_CHECKS_TO_END) {
        tracked.delete(entry.alert.id);
        changed = true;
        await safePublish(SCENE_TRIGGERS.ALERT_ENDED, buildEndedData(entry.alert, context));
      }
    }

    // Alerts in the list: known (refreshed) or issued now.
    for (const alert of alerts) {
      const entry = tracked.get(alert.id);
      if (entry !== undefined) {
        entry.alert = alert;
        entry.missing = 0;
        continue;
      }
      tracked.set(alert.id, { alert, missing: 0 });
      changed = true;
      await safePublish(SCENE_TRIGGERS.ALERT_ISSUED, buildIssuedData(alert, context));
    }

    if (changed) {
      onChange(house);
    }
  }

  /**
   * @description One round: every located house, one after the other.
   * @example
   * await watcher.check();
   */
  async function check() {
    if (checking) {
      return;
    }
    checking = true;
    try {
      const list = await houses.refresh();
      for (const house of list) {
        await checkHouse(house);
      }
      // Forget the houses that were removed or unlocated.
      const ids = new Set(list.map((house) => house.id));
      [...states.keys()].filter((id) => !ids.has(id)).forEach((id) => states.delete(id));
    } finally {
      checking = false;
    }
  }

  /**
   * @description Schedule the next round.
   * @example
   * schedule();
   */
  function schedule() {
    timer = setTimeout(async () => {
      try {
        await check();
      } catch (err) {
        logger.warn(`Alert check failed: ${err.message}`);
      }
      if (started) {
        schedule();
      }
    }, getIntervalMs());
    timer.unref?.();
  }

  /**
   * @description Start the watcher: a baseline round now, then every interval.
   * @returns {Promise<void>} Resolved once the baseline round is done.
   * @example
   * await watcher.start();
   */
  function start() {
    stop();
    started = true;
    return check()
      .catch((err) => logger.warn(`Alert baseline failed: ${err.message}`))
      .finally(() => {
        if (started) {
          schedule();
        }
      });
  }

  /**
   * @description Stop the watcher. The known alerts are forgotten: the next
   * start makes a new baseline (alerts switched off then on must not fire
   * every alert in force at once).
   * @example
   * watcher.stop();
   */
  function stop() {
    started = false;
    states.clear();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { check, start, stop, running: () => started };
}

export {
  SCENE_TRIGGERS,
  SUMMARIES,
  MISSING_CHECKS_TO_END,
  alertSummary,
  buildIssuedData,
  buildEndedData,
  createAlertWatcher,
};
