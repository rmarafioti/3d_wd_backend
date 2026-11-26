// Zod schemas for the contact forms: the landing page's (POST /api/contact) with its honeypot
// check, which the route runs first, and a client website's (POST /api/public/contact).
const { z } = require('zod');
const { blankToUndefined } = require('./validate');
const { requiredText, optionalText, email } = require('./fields');

const GOAL_MAX = 2000;
const EXTRAS_MAX = 10;
const IMAGES_MAX = 3;
const IMAGE_MAX_BYTES = 1024 * 1024;
const IMAGE_TYPE_MESSAGE = 'Each image must be a JPG, PNG or WebP.';
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const contactSchema = z.object({
  name: requiredText('Name', 100),
  business: requiredText('Business name', 100),
  email,
  startingPoint: z.enum(['has_website', 'unfinished_website', 'no_website'], {
    error: "Choose where you're starting from.",
  }),
  // The form's question is "What do you want your site to do?", so its messages answer it rather
  // than name a field. Line breaks are kept.
  goal: z.preprocess(
    blankToUndefined,
    z
      .string({ error: 'Tell me what you want your site to do.' })
      .max(GOAL_MAX, `Your answer must be ${GOAL_MAX} characters or fewer.`),
  ),
});

// True when the hidden contactCode field holds anything: only a bot fills it (docs/endpoints.md →
// Contact form). Any value counts, a string or not.
function hasHoneypot(body) {
  return blankToUndefined(body?.contactCode) !== undefined;
}

// The image's type from its first bytes, never from a name or a declared type, or null when it is
// not a JPG, PNG or WebP.
function toImageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  const isWebp =
    bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP';
  return isWebp ? 'webp' : null;
}

// An attached photo's base64 data, checked by its decoded bytes: a JPG, PNG or WebP of at most
// 1 MB. Becomes { type, content }, content re-encoded from the bytes so it is clean base64.
const imageContent = z.string({ error: IMAGE_TYPE_MESSAGE }).transform((value, ctx) => {
  const text = value.replace(/\s/g, '');
  if (text.length % 4 !== 0 || !BASE64.test(text)) {
    ctx.addIssue({ code: 'custom', message: IMAGE_TYPE_MESSAGE });
    return z.NEVER;
  }
  const bytes = Buffer.from(text, 'base64');
  const type = toImageType(bytes);
  if (!type) {
    ctx.addIssue({ code: 'custom', message: IMAGE_TYPE_MESSAGE });
    return z.NEVER;
  }
  if (bytes.length > IMAGE_MAX_BYTES) {
    ctx.addIssue({ code: 'custom', message: 'Each image must be 1 MB or smaller.' });
    return z.NEVER;
  }
  return { type, content: bytes.toString('base64') };
});

// A client website's contact form. Each client's form is its own: name and email are always
// there (the email is the Reply-To), and a form may add a message, its own extra questions and up
// to 3 photos. An extra the visitor left blank is dropped. Each photo is named here, from its
// type, never from anything the request sent.
const websiteContactSchema = z.object({
  name: requiredText('Name', 100),
  email,
  message: optionalText('Message', 5000),
  extras: z
    .array(
      z.object(
        { label: requiredText('Label', 60), value: optionalText('Value', 1000) },
        { error: 'Each extra field needs a label and a value.' },
      ),
      { error: 'Extras must be a list.' },
    )
    .max(EXTRAS_MAX, `A form can send at most ${EXTRAS_MAX} extra fields.`)
    .optional()
    .transform((extras = []) => extras.filter((extra) => extra.value !== null)),
  images: z
    .array(z.object({ content: imageContent }, { error: 'Image is required.' }), {
      error: 'Images must be a list.',
    })
    .max(IMAGES_MAX, `A message can have at most ${IMAGES_MAX} images.`)
    .optional()
    .transform((images = []) =>
      images.map(({ content }, index) => ({
        filename: `photo-${index + 1}.${content.type}`,
        content: content.content,
      })),
    ),
});

module.exports = { contactSchema, hasHoneypot, websiteContactSchema };
