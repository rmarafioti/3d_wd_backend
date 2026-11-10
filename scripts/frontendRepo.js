// The frontend repo's folder (../3d_wd, or FRONTEND_DIR) and the check that it really is that repo,
// shared by the scripts that read it (release.js, checkSync.js).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const FRONTEND_REPO = 'rmarafioti/3d_wd';
const FRONTEND_DIR = path.resolve(process.env.FRONTEND_DIR ?? path.join(__dirname, '../../3d_wd'));
const NOT_FRONTEND_REPO = `${FRONTEND_DIR} isn't the ${FRONTEND_REPO} repo. Set FRONTEND_DIR.`;

// Whether FRONTEND_DIR's origin is the frontend repo on GitHub, over SSH or HTTPS.
function isFrontendRepo() {
  const origin = execFileSync('git', ['-C', FRONTEND_DIR, 'remote', 'get-url', 'origin'], {
    encoding: 'utf8',
  }).trim();
  return /[:/]rmarafioti\/3d_wd(\.git)?$/.test(origin);
}

module.exports = { FRONTEND_REPO, FRONTEND_DIR, NOT_FRONTEND_REPO, isFrontendRepo };
