// Claude Code PreToolUse hook: the enforced half of CLAUDE.md → Version Control. Registered in
// .claude/settings.json for the Bash, Read and Grep tools. It reads the tool call as JSON on stdin
// and answers "deny" (never allowed) or "ask" (only with Rich's approval at the permission prompt),
// with the reason Claude is shown. Any other call gets no output, so the normal permissions apply.
// It reads the whole command text, so it catches what a deny rule's prefix match misses: a command
// after `cd x &&`, inside a subshell, or behind `git -C <dir>`. It is a guard against mistakes, not
// a sandbox: a script that does the same thing from inside a file isn't seen. The same file is
// copied unchanged into the frontend repo.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);
const PROTECTED_BRANCHES = new Set(['main', 'production']);
const RELEASE_TAGS_RULE = 'release tags are pushed only by npm run release (CLAUDE.md → Releases).';
const ENV_FILE = /(^|[\s/'"=<>(,:])\.env(\.[\w-]+)?(?=$|[\s'")<>,;|&])/g;
// Backticks aren't counted as quotes: Markdown wraps `.env` in them, and code opens a path in ' or ".
const QUOTED_ENV_PATH = /['"](?:[^'"\s]*\/)?\.env(?!\.example)(\.[\w-]+)?['"]/;
// Commands that can print or copy a file's contents (a node or python one-liner too).
const FILE_READERS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'grep',
  'egrep',
  'rg',
  'sed',
  'awk',
  'source',
  '.',
  'bat',
  'strings',
  'xxd',
  'od',
  'nl',
  'cp',
  'mv',
  'base64',
  'sort',
  'diff',
  'node',
  'python',
  'python3',
]);
const SKIP_CI = /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]|skip-checks:\s*true/i;
const DESTRUCTIVE_SQL = /\b(DROP\s+(DATABASE|TABLE|SCHEMA)|TRUNCATE|DELETE\s+FROM)\b/i;
const DATABASE_CLIENTS = new Set(['psql', 'pg_dump', 'pg_restore', 'dropdb', 'createdb']);
const CLOUD_STORAGE = /api\.cloudinary\.com|r2\.cloudflarestorage\.com/;
const HTTP_DELETE = /(-X\s*|--request[\s=]+|method:\s*)['"]?DELETE\b/i;

function deny(rule) {
  return {
    decision: 'deny',
    reason: `Blocked by the guard hook (CLAUDE.md → Version Control): ${rule}`,
  };
}

function ask(rule) {
  return {
    decision: 'ask',
    reason: `Needs Rich's approval (CLAUDE.md → Version Control): ${rule}`,
  };
}

// Splits a command into its simple commands (at &&, ||, ;, |, &, newlines, subshells and command
// substitutions), each as a list of words with their quotes removed. Rough by design: a quoted
// argument that holds a separator is split too, which can only make a check see more, not less.
function toSegments(command) {
  return command
    .split(/&&|\|\||\$\(|[;|&\n()`]/)
    .map((segment) =>
      segment
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.replace(/^['"]+|['"]+$/g, '')),
    )
    .filter((words) => words.length);
}

// A short-flag cluster such as -fu or -df contains `letter`.
function hasShortFlag(args, letter) {
  return args.some((arg) => /^-[a-zA-Z]+$/.test(arg) && arg.includes(letter));
}

function hasFlag(args, ...flags) {
  return args.some((arg) => flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));
}

// The git subcommand and its arguments, skipping git's own options (-C <dir>, -c <key=value>,
// --git-dir=…, --no-pager), or null when the segment isn't a git command.
function readGit(words) {
  const start = words.findIndex((word) => word === 'git' || word.endsWith('/git'));
  if (start === -1) return null;
  let i = start + 1;
  while (i < words.length && words[i].startsWith('-')) {
    i += words[i] === '-C' || words[i] === '-c' ? 2 : 1;
  }
  if (i >= words.length) return null;
  return { sub: words[i], args: words.slice(i + 1) };
}

function checkPush(args) {
  const forceFlags = [
    '--force',
    '--force-with-lease',
    '--force-if-includes',
    '--mirror',
    '--prune',
  ];
  if (hasFlag(args, ...forceFlags) || hasShortFlag(args, 'f')) {
    return deny('no force pushes, and no history rewrites on a pushed branch.');
  }
  if (hasFlag(args, '--delete') || hasShortFlag(args, 'd')) {
    return deny("no deleting branches or tags on GitHub; GitHub deletes a merged PR's branch.");
  }
  if (hasFlag(args, '--no-verify')) return deny('never --no-verify.');
  if (hasFlag(args, '--tags', '--follow-tags')) return deny(RELEASE_TAGS_RULE);

  // The first word that isn't an option is the remote; the rest are refspecs.
  const refspecs = args.filter((arg) => !arg.startsWith('-')).slice(1);
  for (const refspec of refspecs) {
    if (refspec.startsWith('+')) return deny('no force pushes (a + refspec).');
    if (refspec.startsWith(':')) return deny('no deleting branches or tags on GitHub.');
    if (/(^|\/)release-/.test(refspec)) return deny(RELEASE_TAGS_RULE);
    const target = (refspec.includes(':') ? refspec.split(':')[1] : refspec).replace(
      /^refs\/heads\//,
      '',
    );
    if (PROTECTED_BRANCHES.has(target)) {
      return deny(`never push to ${target}: changes reach it through a PR or npm run release.`);
    }
  }
  return null;
}

function checkGit({ sub, args }) {
  switch (sub) {
    case 'push':
      return checkPush(args);
    case 'branch':
      if (
        hasShortFlag(args, 'D') ||
        ((hasFlag(args, '--delete') || hasShortFlag(args, 'd')) &&
          (hasFlag(args, '--force') || hasShortFlag(args, 'f')))
      ) {
        return deny('delete a branch with git branch -d, which refuses one that is not merged.');
      }
      return null;
    case 'commit':
      if (hasFlag(args, '--no-verify') || hasShortFlag(args, 'n'))
        return deny('never --no-verify.');
      return null;
    case 'reset':
      return hasFlag(args, '--hard') ? ask('git reset --hard discards uncommitted work.') : null;
    case 'clean':
      return hasFlag(args, '--force') || hasShortFlag(args, 'f')
        ? ask('git clean -f deletes untracked files.')
        : null;
    case 'checkout':
      return args.includes('--') || args.includes('.') || hasFlag(args, '--force')
        ? ask('this checkout overwrites uncommitted changes.')
        : null;
    case 'switch':
      return hasFlag(args, '--discard-changes', '--force') || hasShortFlag(args, 'f')
        ? ask('this switch discards uncommitted changes.')
        : null;
    case 'restore': {
      const stagedOnly =
        (hasFlag(args, '--staged') || hasShortFlag(args, 'S')) &&
        !(hasFlag(args, '--worktree') || hasShortFlag(args, 'W'));
      return stagedOnly ? null : ask('git restore discards uncommitted changes.');
    }
    case 'stash':
      return args[0] === 'drop' || args[0] === 'clear' ? ask('this deletes stashed work.') : null;
    default:
      return null;
  }
}

// The hosts a database command connects to: from postgres:// URLs and -h / --host options.
function databaseHosts(words) {
  const hosts = [];
  words.forEach((word, i) => {
    const url = word.match(/postgres(?:ql)?:\/\/(?:[^@/\s]*@)?(\[[^\]]*\]|[^:/?\s]*)/);
    if (url) hosts.push(url[1].replace(/^\[|\]$/g, ''));
    if (word === '-h' || word === '--host') hosts.push(words[i + 1] ?? '');
    if (word.startsWith('--host=')) hosts.push(word.slice('--host='.length));
  });
  return hosts;
}

function mentionsEnvFile(text) {
  return [...text.matchAll(ENV_FILE)].some((match) => match[2] !== '.example');
}

// A segment that runs SQL: a database client, prisma db execute, or a node one-liner with raw SQL.
function runsSql(words) {
  const text = words.join(' ');
  return (
    words[0] === 'psql' ||
    words[0] === 'pg_restore' ||
    /\bprisma\s+db\s+execute\b/.test(text) ||
    (words[0] === 'node' && /\b(execute|query)Raw/.test(text))
  );
}

function checkSegment(words) {
  const git = readGit(words);
  if (git) {
    const result = checkGit(git);
    if (result) return result;
  }

  const text = words.join(' ');
  const reader = words[0].split('/').pop();
  if (
    (FILE_READERS.has(reader) && mentionsEnvFile(words.slice(1).join(' '))) ||
    /<\s*\S*\.env\b(?!\.example)/.test(text)
  ) {
    return deny('never read or print .env; scripts load it themselves.');
  }
  const isDatabaseClient = DATABASE_CLIENTS.has(words[0]) || /\bprisma\s+db\s+execute\b/.test(text);
  if (isDatabaseClient && databaseHosts(words).some((host) => !LOCAL_HOSTS.has(host))) {
    return deny('never run anything against staging or production; Rich uses the Render Shell.');
  }
  if (words[0] === 'dropdb') return ask('dropdb deletes a database.');
  if (/\bprisma\s+migrate\s+reset\b/.test(text))
    return ask('prisma migrate reset clears the database.');
  if (/\bprisma\s+db\s+push\b/.test(text) && /--(force-reset|accept-data-loss)\b/.test(text)) {
    return ask('this prisma db push can delete data.');
  }
  if (/\bdocker[\s-]compose\b.*\bdown\b/.test(text) && /(\s-v\b|--volumes)/.test(text)) {
    return ask('docker compose down -v deletes the local Postgres volume.');
  }
  if (/\bdocker\s+volume\s+(rm|prune)\b/.test(text)) return ask('this deletes a Docker volume.');
  return null;
}

function checkCommand(command) {
  const findings = [];

  if (/\bgit\b.*\bcommit\b/.test(command) && SKIP_CI.test(command)) {
    findings.push(deny('never skip CI in a commit message.'));
  }
  const segments = toSegments(command);
  // A one-liner's code is split at its parentheses, so it is read whole. Code opens .env by a
  // quoted path ('.env', "config/.env"); .env merely named in a comment or text passes.
  const runsScript = segments.some((words) => ['node', 'python', 'python3'].includes(words[0]));
  if (runsScript && QUOTED_ENV_PATH.test(command)) {
    findings.push(deny('never read or print .env; scripts load it themselves.'));
  }
  for (const words of segments) {
    const result = checkSegment(words);
    if (result) findings.push(result);
  }
  // SQL can sit in a heredoc on its own lines, so once something runs SQL, the whole command is
  // read for it. A commit message that only mentions SQL runs nothing, so it passes.
  if (segments.some(runsSql) && DESTRUCTIVE_SQL.test(command)) {
    findings.push(ask('DROP, TRUNCATE and DELETE need approval: list the rows first.'));
  }
  if (
    segments.some((words) => ['curl', 'wget', 'node'].includes(words[0])) &&
    CLOUD_STORAGE.test(command) &&
    HTTP_DELETE.test(command)
  ) {
    findings.push(
      ask('deletes in Cloudinary or R2 happen only through npm run sweep:uploads. Never 3dwd/.'),
    );
  }

  return findings.find((f) => f.decision === 'deny') ?? findings[0] ?? null;
}

function isEnvFile(filePath) {
  const name = (filePath ?? '').split('/').pop();
  return /^\.env(\.[\w-]+)?$/.test(name) && name !== '.env.example';
}

// The decision for one tool call, or null to leave it to the normal permissions.
function checkToolCall({ tool_name: toolName, tool_input: toolInput = {} }) {
  if (toolName === 'Bash') return checkCommand(toolInput.command ?? '');
  if (toolName === 'Read' && isEnvFile(toolInput.file_path)) {
    return deny('never read or print .env; scripts load it themselves.');
  }
  if (toolName === 'Grep' && isEnvFile(toolInput.path)) {
    return deny('never read or print .env; scripts load it themselves.');
  }
  return null;
}

// Reads the tool call from stdin and prints the decision. Input it can't read fails closed:
// exit 2 blocks the call and shows the message.
function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => {
    let result;
    try {
      result = checkToolCall(JSON.parse(raw));
    } catch (err) {
      process.stderr.write(`Guard hook couldn't read the tool call: ${err.message}\n`);
      process.exit(2);
    }
    if (!result) return;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: result.decision,
          permissionDecisionReason: result.reason,
        },
      }),
    );
  });
}

if (require.main === module) main();

module.exports = { checkToolCall };
