// Website URL normalization. Every website URL goes through normalizeUrl before it is
// compared or saved: https, lowercase host, no trailing slash (query string and hash dropped).
//
// urlVariants supports the duplicate check: www.example.com and example.com count as the same
// website, but the URL is stored exactly as normalized. The stored URL is also the revalidation
// target, so it must stay the host the site really runs on (a redirect between www and the bare
// domain would drop the Authorization header on the revalidation call).

// Expects a URL already validated as https:// by the zod schema.
function normalizeUrl(input) {
  const url = new URL(input.trim());
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
