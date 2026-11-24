// What a log line or a Sentry event may say about an unexpected error: its name, its Prisma code
// and its stack frames, never its message, which can quote a query's values (an email, content).

// The error's name, with its code when it has one: a Prisma error's (P2002) or a system error's
// (ECONNREFUSED).
function errorSummary(err) {
  const name = err?.name ?? 'Error';
  return typeof err?.code === 'string' ? `${name} ${err.code}` : name;
}

// The summary, then the stack's frame lines. The message lines at the top of err.stack are
// skipped, however many lines the message runs to.
function describeError(err) {
  const frames = String(err?.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line));
  return [errorSummary(err), ...frames].join('\n');
}

module.exports = { errorSummary, describeError };
