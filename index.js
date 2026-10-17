// -----------------------------------------------------------------------------
// Entry point of the Google Weather external integration.
//
// A weather provider for Gladys built on the official Weather API of Google
// Maps Platform: current conditions, 24-hour and 10-day forecasts, and the
// official public alerts (MeteoAlarm, DWD, NOAA…), with scene triggers and
// actions and three dashboard widgets. The user brings the API key of their
// own Google Cloud project.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the time zone of Gladys, the fallback for the local times)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Google Weather integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
