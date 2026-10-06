// Zod schema for the login body. The credential is the Google ID token from the frontend's
// Google sign-in button; Google's own verification checks the rest.
const { z } = require('zod');

const loginSchema = z.object({
  credential: z.string().trim().min(1),
});

module.exports = { loginSchema };
