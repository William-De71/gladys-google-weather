// A fake Google (Weather API v1 + the icon host) behind a `fetch`, following
// the documented requests. Tests never touch the network.

import * as fixtures from './fixtures.js';

const API_KEY = 'AIzaSyTest-0123456789abcdefghijklmnopq';
// A valid 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const silent = { info() {}, warn() {}, error() {}, debug() {} };

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  arrayBuffer: async () => new ArrayBuffer(0),
});

/**
 * @description A Google error body.
 * @param {number} code - HTTP status.
 * @param {string} status - The RPC status.
 * @param {string} message - The message.
 * @param {string} [reason] - The ErrorInfo reason.
 * @returns {object} The body.
 */
function googleError(code, status, message, reason) {
  const details = reason
    ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'googleapis.com' }]
    : [];
  return { error: { code, message, status, details } };
}

/**
 * @description The fake Google, as a `fetch`.
 * @param {object} [options] - { failures: { [path]: { status, body } }, alerts: () => answer }.
 * @returns {Function} The fetch, with `calls` and `failures`.
 */
function fakeGoogle({ failures = {}, alerts } = {}) {
  const calls = [];
  const impl = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, headers: init.headers ?? {} });
    if (url.hostname === 'maps.gstatic.com') {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length),
      };
    }
    assert(url.hostname === 'weather.googleapis.com', `unexpected host ${url.hostname}`);
    assert(!url.searchParams.has('key'), 'the key never goes in the URL');
    const path = url.pathname.replace('/v1/', '');
    const failure = impl.failures[path] ?? impl.failures['*'];
    if (failure) {
      return json(failure.status, failure.body);
    }
    if (init.headers?.['X-Goog-Api-Key'] !== API_KEY) {
      return json(
        400,
        googleError(
          400,
          'INVALID_ARGUMENT',
          'API key not valid. Please pass a valid API key.',
          'API_KEY_INVALID',
        ),
      );
    }
    const language = url.searchParams.get('languageCode') ?? 'en';
    switch (path) {
      case 'currentConditions:lookup':
        return json(200, fixtures.current(language));
      case 'forecast/hours:lookup':
        return json(200, fixtures.hourly(language));
      case 'forecast/days:lookup':
        return json(200, fixtures.daily(language));
      case 'publicAlerts:lookup':
        return json(200, (impl.alerts ?? fixtures.alerts)(language, url));
      default:
        return json(404, googleError(404, 'NOT_FOUND', 'Method not found.'));
    }
  };
  impl.calls = calls;
  impl.failures = { ...failures };
  impl.alerts = alerts;
  impl.count = (path) => calls.filter((call) => call.url.pathname === `/v1/${path}`).length;
  return impl;
}

/**
 * @description Throw when a condition is false (no assert import in helpers).
 * @param {boolean} condition - The condition.
 * @param {string} message - The message.
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export { API_KEY, PNG, silent, googleError, fakeGoogle, fixtures };
