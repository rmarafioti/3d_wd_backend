// Tests for the release script's tag naming and tag messages (scripts/release.js). Only the pure
// helpers are tested: nothing here pushes, tags or calls GitHub.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  nextReleaseTag,
  latestReleaseTag,
  releaseNotesHeader,
  pullRequestLines,
  releaseTagMessage,
} = require('./release');

const OCT_31 = new Date('2026-10-31T15:00:00Z');

describe('nextReleaseTag', () => {
  it('names the first release of the day by its UTC date', () => {
    assert.equal(nextReleaseTag(OCT_31, ['release-2026-10-30']), 'release-2026-10-31');
  });

  it('uses the UTC date, not the local one', () => {
    const lateEvening = new Date('2026-10-31T23:30:00-04:00');

    assert.equal(nextReleaseTag(lateEvening, []), 'release-2026-11-01');
  });

  it('adds -2 for a second release the same day', () => {
    assert.equal(nextReleaseTag(OCT_31, ['release-2026-10-31']), 'release-2026-10-31-2');
  });

  it('skips a name either repo already has', () => {
    const tags = ['release-2026-10-31', 'release-2026-10-31-2', 'release-2026-10-31-3'];

    assert.equal(nextReleaseTag(OCT_31, tags), 'release-2026-10-31-4');
  });
});

describe('latestReleaseTag', () => {
  it('returns null before the first release', () => {
    assert.equal(latestReleaseTag([]), null);
  });

  it('orders by date, then by suffix as a number', () => {
    const tags = [
      'release-2026-10-31-10',
      'release-2026-10-30-2',
      'release-2026-10-31',
      'release-2026-10-31-9',
    ];

    assert.equal(latestReleaseTag(tags), 'release-2026-10-31-10');
  });

  it('ignores tags that are not release tags', () => {
    assert.equal(latestReleaseTag(['release-2026-10-30', 'v9.0.0']), 'release-2026-10-30');
  });
});

describe('releaseNotesHeader', () => {
  const tag = 'release-2026-10-31';

  it('pairs a backend release with the frontend released in the same run', () => {
    const header = releaseNotesHeader({
      tag,
      other: { name: 'Frontend', outcome: 'released', previousTag: 'release-2026-10-30' },
      migrations: [],
    });

    assert.equal(
      header,
      'Frontend: released in this run as release-2026-10-31.\n\nMigrations: none.',
    );
  });

  it("names the other repo's live release when it was unchanged", () => {
    const header = releaseNotesHeader({
      tag,
      other: { name: 'Backend', outcome: 'unchanged', previousTag: 'release-2026-10-30-2' },
    });

    assert.equal(header, 'Backend: unchanged, still release-2026-10-30-2.');
  });

  it('records a stopped release of the other repo with what production still runs', () => {
    const header = releaseNotesHeader({
      tag,
      other: { name: 'Frontend', outcome: 'stopped', previousTag: null },
      migrations: [],
    });

    assert.match(header, /^Frontend: its release stopped; production still runs untagged\./);
  });

  it('lists the migrations a backend release carries', () => {
    const header = releaseNotesHeader({
      tag,
      other: { name: 'Frontend', outcome: 'unchanged', previousTag: 'release-2026-10-30' },
      migrations: ['prisma/migrations/20261101_drop_post_active/migration.sql'],
    });

    assert.match(
      header,
      /Migrations:\n- prisma\/migrations\/20261101_drop_post_active\/migration\.sql$/,
    );
  });
});

describe('pullRequestLines', () => {
  it('lists each merged PR with its branch, oldest first', () => {
    const subjects = [
      'Merge pull request #47 from rmarafioti/feat/post-status',
      'Merge pull request #45 from rmarafioti/feat/delete-post',
    ];

    assert.deepEqual(pullRequestLines(subjects), [
      '- #45 feat/delete-post',
      '- #47 feat/post-status',
    ]);
  });

  it('skips merges that are not pull requests, and empty output', () => {
    assert.deepEqual(pullRequestLines(["Merge branch 'main' into feat/x", '']), []);
  });
});

describe('releaseTagMessage', () => {
  it('puts the tag, the header and the pull requests in that order', () => {
    const message = releaseTagMessage({
      tag: 'release-2026-10-31',
      header: 'Frontend: unchanged, still release-2026-10-30.\n\nMigrations: none.',
      pullRequests: ['- #49 chore/version-control'],
    });

    assert.equal(
      message,
      'release-2026-10-31\n\nFrontend: unchanged, still release-2026-10-30.\n\nMigrations: none.\n\nPull requests:\n- #49 chore/version-control',
    );
  });

  it('says none when a release carries no pull request', () => {
    const message = releaseTagMessage({ tag: 'release-2026-10-31', header: 'x', pullRequests: [] });

    assert.match(message, /Pull requests:\n- none$/);
  });
});
