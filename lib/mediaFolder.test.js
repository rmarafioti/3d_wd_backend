// Tests for the media_folder rule (lib/mediaFolder.js): every case in docs/setup.md → Image
// Hosting → media_folder, and the -2, -3… suffix when a folder is taken.
require('../testing/setup');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../prisma');
const { toMediaFolder, findFreeMediaFolder } = require('./mediaFolder');
const { resetDatabase, disconnect, createWebsite } = require('../testing/helpers');

describe('toMediaFolder', () => {
  const cases = [
    ['https://www.steviethedog.com', 'steviethedog'],
    ['https://steviethedog.com', 'steviethedog'],
    ['https://shop.example.co.uk', 'shop-example-co'],
    ['https://example.org/blog', 'example'],
    ['https://localhost:3001', 'localhost'],
    ['https://www.example.com:8443', 'example'],
  ];

  for (const [url, folder] of cases) {
    it(`turns ${url} into ${folder}`, () => {
      assert.equal(toMediaFolder(url), folder);
    });
  }
});

describe('findFreeMediaFolder', () => {
  beforeEach(resetDatabase);
  after(disconnect);

  it('returns the base name when no website has it', async () => {
    await createWebsite({ mediaFolder: 'examples' });

    assert.equal(await findFreeMediaFolder(prisma, 'https://example.org'), 'example');
  });

  it('adds the first free number when the base name is taken', async () => {
    await createWebsite({ mediaFolder: 'example' });
    await createWebsite({ mediaFolder: 'example-3' });

    assert.equal(await findFreeMediaFolder(prisma, 'https://example.org'), 'example-2');
  });
});
