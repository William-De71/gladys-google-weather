# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - unreleased

### Added

- Weather provider for Gladys built on the official Weather API of Google Maps Platform: current conditions (temperature, feels like, humidity, dew point, pressure, wind and gusts, visibility, cloud cover, UV index, day or night), 24 hourly and 8 daily forecasts with sunrise and sunset, in metric or US units, descriptions in the language of Gladys.
- Official public alerts (MeteoAlarm, DWD, NOAA and the other publishers Google relays) in the weather of Gladys, and the scene triggers "Weather alert issued" and "Weather alert ended", filtered by house, kind of alert (15 groups) and severity.
- Scene actions: get the alerts, the forecast of a day (today to 9 days ahead), the current weather, and whether rain is expected in the next hours.
- Dashboard widgets: the alerts in force with their full text, a 5- to 10-day forecast with Google's icons, and a curve of the next 12 or 24 hours (temperature, chance of rain or wind).
- Designed to stay within Google's free monthly usage: every answer cached and shared, configurable refresh intervals (about 4,000 requests a month per house by default), a monthly request cap kept across restarts, and a "Test the API key" action showing the requests used.
- A location without Google weather data makes Gladys fall through to the next weather provider.
- English, French, German and Spanish everywhere: settings, widgets, scenes and documentation.

[0.1.0]: https://github.com/William-De71/gladys-google-weather/releases/tag/v0.1.0
