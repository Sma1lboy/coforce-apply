// config.json contract check. Run: node harness/check-config.mjs
//
// Covers the lazy migration off the old preferences.json + apply-config.json
// pair, the merge-never-replace rule that keeps a two-key console save from
// deleting the user's visa status, and the onboarding probe.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIG_VERSION,
  intentOf,
  loadConfig,
  saveConfig,
} from '../.agents/lib/config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const home = join(here, 'out', 'config-home');
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });

const write = (name, value) =>
  writeFileSync(join(home, name), `${JSON.stringify(value, null, 2)}\n`);
const read = name => JSON.parse(readFileSync(join(home, name), 'utf8'));

// --- a data home that was never set up writes nothing and reads as empty ---
assert.deepEqual(loadConfig(home), {}, 'empty data home → {}');
assert.equal(
  existsSync(join(home, 'config.json')),
  false,
  'loadConfig must NOT create a file for a data home that was never set up — '
    + 'the skills use its absence to detect that onboarding never ran'
);
assert.equal(intentOf(loadConfig(home)), null, 'no intent → wizard trigger');

// --- legacy pair folds into config.json on first read ---
write('apply-config.json', {
  agent: 'codex',                 // dead: Claude is the only runtime
  email: 'ats@example.com',
  headlessApply: true,
  needsSponsorship: false,        // stale copy — preferences wins
  requireResumeReview: false,
  sources: [{ name: 'seed', url: 'https://example.com/README.md' }],
});
write('preferences.json', {
  version: 1,
  level: 'internship',
  directions: ['backend', 'general'],
  needsSponsorship: true,
  workAuthorization: 'F-1 OPT',
  workDays: 'no weekends',        // dead: zero readers anywhere
});

const migrated = loadConfig(home);
assert.equal(migrated.version, CONFIG_VERSION, 'stamped with the new version');
assert.equal(migrated.email, 'ats@example.com', 'apply-config keys carried over');
assert.equal(migrated.level, 'internship', 'preferences keys carried over');
assert.equal(
  migrated.needsSponsorship,
  true,
  'preferences wins the needsSponsorship tie — it was the canonical file'
);
assert.equal(migrated.workAuthorization, 'F-1 OPT', 'visa answer survives');
assert.equal(migrated.requireResumeReview, false, 'consents survive');
assert.equal('workDays' in migrated, false, 'dead key dropped');
assert.equal('agent' in migrated, false, 'dead runtime selector dropped');
assert.deepEqual(read('config.json'), migrated, 'migration is persisted once');
assert.ok(
  existsSync(join(home, 'preferences.json')) && existsSync(join(home, 'apply-config.json')),
  'the old files are left on disk — migration never deletes user data'
);

// a second read must not re-migrate on top of later edits
saveConfig(home, { level: 'newgrad' });
assert.equal(loadConfig(home).level, 'newgrad', 'config.json wins once it exists');

// --- merge, never replace: a two-key console save keeps everything else ---
const merged = saveConfig(home, { level: 'any', directions: [] });
assert.equal(merged.level, 'any', 'patch applied');
assert.deepEqual(merged.directions, [], 'patch applied to arrays too');
assert.equal(
  merged.needsSponsorship,
  true,
  'a "Reset filters" click must not delete the visa status'
);
assert.equal(merged.email, 'ats@example.com', 'runtime config untouched by an intent save');
assert.equal(merged.version, CONFIG_VERSION, 're-stamped on every save');
assert.throws(() => saveConfig(home, [1, 2]), 'a non-object patch is rejected');

// --- the intent slice is exactly the intent keys ---
const intent = intentOf(merged);
assert.deepEqual(
  Object.keys(intent).sort(),
  ['directions', 'level', 'needsSponsorship', 'workAuthorization'],
  'intent slice carries intent keys only — no consents, no email'
);

console.log('config: migration + merge-never-replace + onboarding probe ✓');
console.log('harness: config check passed');
