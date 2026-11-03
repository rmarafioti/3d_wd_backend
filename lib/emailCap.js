// The daily cap on the admin's request emails (services/requestEmail.js): at most DAILY_CAP per
// website in 24 hours, so a site owner editing a request message over and over can't flood the
// admin. Counted in memory per instance, like the rate limits (lib/rateLimit.js): a restart resets
// the count, and several instances would each count on their own (docs/scaling.md §7).
const DAILY_CAP = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// Website id → the times of its emails in the last 24 hours.
const sentTimes = new Map();

// Records a send and returns true, or returns false once the website has had DAILY_CAP today.
function withinEmailCap(websiteId) {
  const now = Date.now();
  const recent = (sentTimes.get(websiteId) ?? []).filter((time) => now - time < DAY_MS);
  if (recent.length >= DAILY_CAP) {
    sentTimes.set(websiteId, recent);
    return false;
  }
  sentTimes.set(websiteId, [...recent, now]);
  return true;
}

// For tests: every website starts with no emails sent.
function resetEmailCap() {
  sentTimes.clear();
}

module.exports = { withinEmailCap, resetEmailCap };
