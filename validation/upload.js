// Zod schema for Sign an Upload: the website the images are uploaded for. Every signed parameter
// is built by the backend (lib/cloudinary.js), so the website is the only input.
const { z } = require('zod');
const { websiteId } = require('./fields');

const signUploadSchema = z.object({ websiteId });

module.exports = { signUploadSchema };
