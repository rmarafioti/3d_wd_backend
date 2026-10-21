// Everything that talks to or about 3DWD's Cloudinary account (docs/setup.md → Image Hosting):
// signing an upload for a website's folder, checking that an image src is in that folder, and the
// two Admin API calls the upload cleanup makes. The only place CLOUDINARY_API_SECRET is read.
// Never log the secret, a signature's input string or the Admin API's Authorization header.
const crypto = require('crypto');

// Signed into every upload (docs/endpoints.md → Sign an Upload). The transformation scales an
// image down to fit 2500 × 2500 as Cloudinary stores it, never up.
const ALLOWED_FORMATS = 'jpg,jpeg,png,webp';
const UPLOAD_TRANSFORMATION = 'c_limit,w_2500,h_2500';

// The Admin API's page size for listing, and its limit on ids per delete call.
const LIST_PAGE_SIZE = 500;
const DELETE_BATCH_SIZE = 100;

// Read on every call, not at load time, so the values from .env (or testing/setup.js) are used.
function config() {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    rootFolder: process.env.CLOUDINARY_FOLDER,
  };
}

// The website's folder under the environment's root: 3dwd/steviethedog in production.
function uploadFolder(mediaFolder) {
  return `${config().rootFolder}/${mediaFolder}`;
}

// Cloudinary's signed-upload rule: the parameters sorted by name, joined as key=value with &,
// the secret appended, then the SHA-1 hex digest.
function sign(params, apiSecret) {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto
    .createHash('sha1')
    .update(toSign + apiSecret)
    .digest('hex');
}

// The contract's UploadSignature for one website. Every signed parameter is built here; none
// comes from the request. fields keeps Cloudinary's own names, since the frontend posts it as-is.
function signUpload(mediaFolder) {
  const { cloudName, apiKey, apiSecret } = config();
  const params = {
    allowed_formats: ALLOWED_FORMATS,
    folder: uploadFolder(mediaFolder),
    timestamp: Math.floor(Date.now() / 1000),
    transformation: UPLOAD_TRANSFORMATION,
  };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    fields: { ...params, signature: sign(params, apiSecret), api_key: apiKey },
  };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// True only for a Cloudinary secure_url directly inside the website's folder:
// https://res.cloudinary.com/<cloud name>/image/upload/v<version>/<folder>/<file name>.
// The src must already be in URL's canonical form (no "..", no query or hash), and the file name
// can't hold another "/", so a sibling folder (steviethedog-2) or a nested path never passes.
function isInFolder(src, mediaFolder) {
  let url;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  const isCanonical = url.href === src && !url.search && !url.hash;
  if (!isCanonical || url.protocol !== 'https:' || url.host !== 'res.cloudinary.com') {
    return false;
  }
  const path = new RegExp(
    `^/${escapeRegExp(config().cloudName)}/image/upload/v\\d+/${escapeRegExp(uploadFolder(mediaFolder))}/[\\w-]+\\.[a-z0-9]+$`,
  );
  return path.test(url.pathname);
}

// A stored src → the Cloudinary public id it points at (3dwd/steviethedog/abc123): the path after
// the version, without the file extension. The cleanup compares uploads to images by public id.
function publicIdFromSrc(src) {
  const match = new URL(src).pathname.match(/\/image\/upload\/v\d+\/(.+)\.[^./]+$/);
  return match ? match[1] : null;
}

// The Admin API endpoint for uploaded images, with the Basic auth header it needs.
function adminRequest(query) {
  const { cloudName, apiKey, apiSecret } = config();
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?${query}`;
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  return { url, headers: { Authorization: `Basic ${auth}` } };
}

// Throws with the status only, so nothing about the request (its Authorization header) is logged.
async function readAdminResponse(response, action) {
  if (!response.ok) throw new Error(`Cloudinary ${action} failed: HTTP ${response.status}`);
  return response.json();
}

// Every uploaded image whose public id starts with `prefix`, as { publicId, createdAt }.
async function listUploads(prefix) {
  const uploads = [];
  let cursor;
  do {
    const query = new URLSearchParams({ prefix, max_results: String(LIST_PAGE_SIZE) });
    if (cursor) query.set('next_cursor', cursor);
    const { url, headers } = adminRequest(query);
    const page = await readAdminResponse(await fetch(url, { headers }), 'list');
    for (const resource of page.resources) {
      uploads.push({ publicId: resource.public_id, createdAt: new Date(resource.created_at) });
    }
    cursor = page.next_cursor;
  } while (cursor);
  return uploads;
}

// Deletes the uploaded images with these public ids, in batches of the Admin API's limit.
async function deleteUploads(publicIds) {
  for (let start = 0; start < publicIds.length; start += DELETE_BATCH_SIZE) {
    const query = new URLSearchParams();
    for (const id of publicIds.slice(start, start + DELETE_BATCH_SIZE)) {
      query.append('public_ids[]', id);
    }
    const { url, headers } = adminRequest(query);
    await readAdminResponse(await fetch(url, { method: 'DELETE', headers }), 'delete');
  }
}

module.exports = {
  uploadFolder,
  signUpload,
  isInFolder,
  publicIdFromSrc,
  listUploads,
  deleteUploads,
};
