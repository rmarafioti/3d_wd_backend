// Website URL normalization (https, lowercase host, no trailing slash) before any URL is compared
// or saved, and the www / bare-domain variants the duplicate check counts as one website.

// Expects a URL already validated as https:// by the zod schema.
function normalizeUrl(input) {
  const url = new URL(input);
  const path = url.pathname.replace(/\/+$/, '');
  return `https://${url.host.toLowerCase()}${path}`;
}

// Given a normalized URL, returns it plus the same URL with a leading "www." added or removed.
// Only an exact leading "www." is touched; other subdomains (blog., shop.) are left alone.
function urlVariants(normalized) {
  const { host } = new URL(normalized);
  const path = normalized.slice(`https://${host}`.length);
  const otherHost = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  return [normalized, `https://${otherHost}${path}`];
}

module.exports = { normalizeUrl, urlVariants };
