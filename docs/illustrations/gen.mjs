// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// The data are the test fixtures (test/helpers/fixtures.js): made-up but
// shaped exactly like the documented Weather API answers, for Paris on
// Saturday 17 October 2026 at 10:00 — a stormy afternoon with an orange
// thunderstorm alert and a yellow wind alert.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildAlertsWidget, buildDailyWidget, buildHourlyWidget } = await load('src/widgets.js');
const { iconUrlFromKey } = await load('src/conditions.js');
const { readAlerts } = await load('src/alerts.js');
const { LANGUAGES } = await load('src/i18n.js');
const fixtures = await load('test/helpers/fixtures.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

const HOUSES = { en: 'Home', fr: 'Maison', de: 'Zuhause', es: 'Casa' };
const { NOW, TIME_ZONE } = fixtures;

const contents = {};
for (const language of LANGUAGES) {
  const house = { name: HOUSES[language] };
  const units = language === 'en' ? 'us' : 'metric';
  contents[language] = {
    alerts: buildAlertsWidget({
      alerts: readAlerts(fixtures.alerts(language).weatherAlerts, NOW),
      house,
      timeZone: TIME_ZONE,
      language,
      now: NOW,
    }),
    daily: buildDailyWidget({
      daily: fixtures.daily(language),
      house,
      language,
      units,
      settings: { days: '7', show_icons: true },
      now: NOW,
    }),
    hourly: buildHourlyWidget({
      hourly: fixtures.hourly(language),
      house,
      language,
      units,
      settings: { metric: 'temperature', hours: '24' },
      now: NOW,
    }),
  };
}

// The Google icons the forecast shows, as the image handler fetches them.
const icons = {};
for (const content of Object.values(contents)) {
  for (const component of content.daily.components) {
    for (const item of component.items ?? []) {
      if (item.image) {
        icons[item.image] = iconUrlFromKey(item.image);
      }
    }
  }
}

const cards = Object.fromEntries(
  manifest.widgets.map((widget) => [widget.key, { label: widget.label, icon: widget.icon }]),
);
writeFileSync(out, JSON.stringify({ now: NOW, cards, icons, contents }));
