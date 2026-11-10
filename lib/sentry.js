// Sentry error reporting, the one place the app talks to Sentry. Production only: with SENTRY_DSN
// empty, Sentry stays off and nothing is sent.
const Sentry = require('@sentry/node');

// Read when an event is scrubbed, so a value set after start-up is still redacted.
const SECRET_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'SECRET_ENCRYPTION_KEY',
  'CLOUDINARY_API_SECRET',
  'R2_SECRET_ACCESS_KEY',
  'RESEND_API_KEY',
];
// Any Postgres connection string, in case one other than DATABASE_URL reaches an error message.
const POSTGRES_URL = /postgres(?:ql)?:\/\/\S+/g;
const REDACTED = '[redacted]';

function redact(text) {
  if (typeof text !== 'string') return text;
  let clean = text;
  for (const name of SECRET_ENV) {
    const value = process.env[name];
    if (value) clean = clean.split(value).join(REDACTED);
  }
  return clean.replace(POSTGRES_URL, REDACTED);
}

// The last layer before an event leaves: keeps the request's method and path only, drops anything
// a user sent or the SDK gathered around the error, and redacts secrets from the messages.
function scrubEvent(event) {
  if (event.request) {
    event.request = {
      method: event.request.method,
      url: event.request.url && event.request.url.split('?')[0],
    };
  }
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  if (event.contexts) {
    delete event.contexts.request;
    delete event.contexts.response;
  }
  event.message = redact(event.message);
  for (const exception of event.exception?.values ?? []) {
    exception.value = redact(exception.value);
  }
  return event;
}

// `overrides` is for tests only (a transport that records events instead of sending them).
function initSentry(overrides = {}) {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: 'production',
    release: process.env.RENDER_GIT_COMMIT,
    // Two layers keep what a user sent out of an event: dataCollection stops the SDK collecting
    // it, and scrubEvent (beforeSend) removes it again. No tracing and no breadcrumbs, so the free
    // plan's quota goes to errors.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    includeLocalVariables: false,
    // Report a fetch error's hostname to Sentry without changing the error the app sees.
    enhanceFetchErrorMessages: 'report-only',
    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
    ...overrides,
  });
}

// Reports an unexpected error. Does nothing while Sentry is off.
function reportError(err) {
  if (Sentry.isInitialized()) Sentry.captureException(err);
}

// Reports a failure the app handles itself but Rich should still hear about, as a warning. Events
// with the same `group` (for example ['revalidation', websiteId]) become one Sentry issue, so one
// broken client website raises one alert, not one per save. Does nothing while Sentry is off.
function reportWarning(message, group) {
  if (!Sentry.isInitialized()) return;
  Sentry.captureMessage(message, { level: 'warning', fingerprint: group });
}

// Waits up to 2 seconds for queued events to send, so a script can exit without losing its event.
// Resolves false when something was left unsent, or when Sentry is off.
function flushSentry() {
  return Sentry.isInitialized() ? Sentry.flush(2000) : Promise.resolve(false);
}

// Ends a cron job's script on a failure: logs the message (never an error object, which could hold
// the database URL), reports it, and exits 1 once Sentry has sent it.
async function exitWithError(message) {
  console.error(message);
  reportError(new Error(message));
  await flushSentry();
  process.exit(1);
}

// scrubEvent is exported for its test: no secret or request detail reaches Sentry.
module.exports = { initSentry, scrubEvent, reportError, reportWarning, flushSentry, exitWithError };
