# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** of type `weather` built on the
official [Weather API of Google Maps Platform](https://developers.google.com/maps/documentation/weather):
it answers the weather requests of Gladys in the pivot format, watches the
official alerts of every located house for two scene triggers, and adds four
scene actions and three dashboard widgets. A Node.js service (Node 22+, ESM,
no build step) in its own sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Only dependency: the SDK (`fetch` is native). Transport: cloud only. The user
brings the API key of their own Google Cloud project (billing required).

## Commands

```bash
npm install
npm test                                  # node --test, never touches the network
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js              SDK wiring only (new GladysIntegration + createApp)
src/app.js            every handler, registered before connect(): weather, alert
                      watcher, scene actions, widgets, icon images, test action,
                      configuration, connection status
src/google-api.js     Weather API v1 client: documented endpoints, key in the
                      X-Goog-Api-Key header, error classes, budget check
src/weather-store.js  cache per product / rounded place / language, single flight,
                      stale answer on failure (never outside the coverage)
src/usage.js          monthly counter of billable calls, /data/usage.json
src/weather.js        Google answers -> the pivot weather of Gladys
src/conditions.js     condition types -> pivot conditions, icon keys and URLs
src/units.js          Google quantities (unit read, never assumed) -> metric / US
src/alerts.js         PublicAlerts: categories, severity, pivot alerts
src/alert-watcher.js  the scene triggers alert_issued / alert_ended
src/scene-actions.js  outputs of get_alerts, get_forecast, get_current, get_rain
src/widgets.js        alerts, daily and hourly widgets (pure builders)
src/houses.js / time.js / config.js / i18n.js   houses, local times, config, texts
```

## Google facts (from the documentation, to re-check when in doubt)

- Endpoints: `GET https://weather.googleapis.com/v1/currentConditions:lookup`,
  `forecast/hours:lookup` (pageSize 1-24, default 24; hours ≤ 240),
  `forecast/days:lookup` (pageSize 1-10, **default 5**; days ≤ 10),
  `publicAlerts:lookup`. Query `location.latitude` / `location.longitude`,
  `unitsSystem` (METRIC default), `languageCode` (BCP-47, closest match).
- Billing: one SKU "Weather Usage" for every endpoint; a **successful** request
  is a billable event (each page too). 10,000 free events a month, then USD 0.15
  per 1,000 (2026-10-17). A billing account is mandatory.
- Coverage: weather in most countries, not in CN, JP, KR, VN, IR, KP, CU, SY…;
  alerts in most of Europe (MeteoAlarm, DWD), US, AU, BR, JP… but not CA, IN,
  RU. The answer for an uncovered place is not documented: 404, or 400 about
  the location, or no temperature -> `OutOfCoverageError` (the core then falls
  through to the next provider).
- Icons: `iconBaseUri` + `.png` / `.svg`, on `maps.gstatic.com/weather/v1/`.
  Only the documented names are ever fetched (no SSRF); image keys accept
  `[a-z0-9-]` only, so `mostly_cloudy` is keyed `gw-mostly-cloudy`.
- Never tested with a real key: the error reasons come from the standard
  `google.rpc.ErrorInfo` (API_KEY_INVALID, SERVICE_DISABLED, BILLING_DISABLED…).

## Rules

- **Keys are forever**: `config_schema`, actions, widgets and their settings and
  option values, scene triggers (fields, option values, variables), scene actions
  (fields, option values, outputs), the scene event data keys and the icon image
  keys. `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json` (0.1.0): never update the baseline
  without a documented migration.
- **Cost first**: every Google call goes through the store (cache) and the
  usage counter. A new call path must say how many requests a month it adds,
  and the docs' cost table must stay right (`test/manifest.test.js` checks the
  default estimate).
- **Scenes**: events on transitions only; the first check after a start (or
  after the alerts are switched back on) is a baseline. Never fire a scene
  event as a consequence of a scene action.
- **Secrets**: the API key is a `secret` field, sent in a header, never logged,
  never in a URL or an error message.
- **The container rootfs is read-only**: only `/data/usage.json` is written.
- **Four languages** everywhere (manifest, `src/i18n.js`, widget texts, scene
  sentences, docs, README); `test/i18n.test.js` checks it.
- **Widget images**: after any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
- **Changelog**: Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
