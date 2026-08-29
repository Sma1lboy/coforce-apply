// Hunt harness check: mock source table → parse, dedup vs tracker and vs the
// screening ledger, never-apply filter, --track write, idempotency on second
// run, screen/unscreen round-trip, and the legacy "filtered: rejected" repair.
// Run: node harness/check-hunt.mjs

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const apps = join(outDir, 'hunt-apps.json');
// screened.json is a sibling of the apps file, so a harness run never reaches
// a real data home — assert that, since the whole point is two ledgers
const screened = join(outDir, 'screened.json');
copyFileSync(join(here, 'fixtures/applications.json'), apps);
rmSync(screened, { force: true });

const hunt = (...extra) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '.agents/skills/start/scripts/hunt.mjs',
        ...extra,
        '--apps', apps,
        '--instructions', 'harness/fixtures/instructions.md',
      ],
      { cwd: root, encoding: 'utf8' }
    )
  );

const run = () =>
  hunt('--track', '--source-file', 'harness/fixtures/source-jobs.md');
const readApps = () => JSON.parse(readFileSync(apps, 'utf8'));
const readScreened = () => JSON.parse(readFileSync(screened, 'utf8'));
const STRIPE_NEWGRAD = 'https://stripe.example/jobs/swe-new-grad-123';

const first = run();

// 5 rows parsed; Acme dup by URL, Initech dup by company+role,
// MegaEvil blocked by never-apply, both Stripe roles are new
assert.equal(first.sources[0].listings, 5, 'parsed all table rows');
assert.equal(first.new.length, 2, `expected 2 new, got ${JSON.stringify(first.new)}`);
assert.deepEqual(
  first.new.map(j => j.company),
  ['Stripe', 'Stripe'],
  '↳ continuation row inherits company'
);
assert.equal(
  first.new[0].homepage,
  'https://stripe.com',
  'company homepage captured for logos'
);
assert.equal(first.skipped.tracked, 2, 'url + company/role dedup');
assert.equal(first.skipped.blocked, 1, 'never-apply respected');

// --track wrote them as pending with a discovery history event
const tracked = readApps();
const stripe = tracked.find(a => a.url === STRIPE_NEWGRAD);
assert.ok(stripe, 'new job tracked');
assert.equal(stripe.status, 'pending');
assert.equal(stripe.title, 'Software Engineer, New Grad — Stripe');
assert.ok(stripe.history[0].event.includes('discovered from'), 'discovery event');

// second run: everything already tracked → nothing new (no duplicate applies)
const second = run();
assert.equal(second.new.length, 0, 'idempotent — no re-track');
assert.equal(second.skipped.blocked, 1, 'blocklist still applied');

// --- screen: a job filtered for fit LEAVES the pipeline ---------------------
// It was never applied to, so it must not occupy a board column — least of
// all `rejected`, which means a company turned the user down.
const screenOut = hunt('screen', STRIPE_NEWGRAD, '--reason', 'onsite-only, workMode=remote');
assert.equal(screenOut.removedFromTracker, true, 'screened job leaves applications.json');
assert.equal(screenOut.alreadyScreened, false);
assert.ok(
  !readApps().some(a => a.url === STRIPE_NEWGRAD),
  'screened job is gone from the tracker — no pipeline status of any kind'
);
const ledger = readScreened();
assert.equal(ledger.version, 1, 'screening ledger carries a schema version');
const entry = ledger.entries.find(e => e.url === STRIPE_NEWGRAD);
assert.ok(entry, 'screened job recorded in the ledger');
assert.equal(entry.reason, 'onsite-only, workMode=remote', 'reason is auditable');
assert.equal(entry.by, 'start-filter');
assert.equal(entry.company, 'Stripe', 'company/role carried over for pair dedup');
assert.ok(entry.screenedAt, 'screenedAt recorded');

// a screen without a reason is refused — an unexplained screen-out is unauditable
assert.throws(
  () =>
    execFileSync(
      process.execPath,
      ['.agents/skills/start/scripts/hunt.mjs', 'screen', 'https://example.com/whatever', '--apps', apps],
      { cwd: root, encoding: 'utf8', stdio: 'pipe' }
    ),
  'screen requires --reason'
);

// re-screening is idempotent: no duplicate entry, original timestamp kept
const again = hunt('screen', STRIPE_NEWGRAD, '--reason', 'different words');
assert.equal(again.alreadyScreened, true, 're-screen is idempotent');
assert.equal(readScreened().entries.filter(e => e.url === STRIPE_NEWGRAD).length, 1);
assert.equal(readScreened().entries.find(e => e.url === STRIPE_NEWGRAD).reason,
  'onsite-only, workMode=remote', 'first reason wins');

// --- dedup reads BOTH ledgers ---------------------------------------------
const third = run();
assert.equal(third.new.length, 0, 'a screened job is never re-offered');
assert.equal(third.skipped.screened, 1, 'counted as screened, not as tracked');
assert.equal(third.skipped.tracked, 3, 'the other three still dedup on the tracker');
assert.ok(
  !readApps().some(a => a.url === STRIPE_NEWGRAD),
  'and never silently re-tracked'
);

// --- unscreen: the decision is reversible ----------------------------------
assert.equal(hunt('unscreen', STRIPE_NEWGRAD).unscreened, true);
assert.equal(hunt('unscreen', STRIPE_NEWGRAD).unscreened, false, 'unscreen is idempotent');
const fourth = run();
assert.equal(fourth.new.length, 1, 'unscreened job resurfaces');
assert.equal(fourth.new[0].url, STRIPE_NEWGRAD);

// --- migration: repair boards that were filled with fake rejections --------
const legacyApps = join(outDir, 'hunt-legacy-apps.json');
const legacyScreened = join(outDir, 'hunt-legacy-screened.json');
rmSync(legacyScreened, { force: true });
writeFileSync(legacyApps, JSON.stringify([
  {
    id: '1', url: 'https://jobs.example.com/onsite-co/swe', company: 'Onsite Co',
    position: 'SWE', status: 'rejected', updatedAt: '2026-08-01T09:00:00.000Z',
    history: [
      { date: '2026-08-01T09:00:00.000Z', event: 'discovered from src' },
      { date: '2026-08-01T09:01:00.000Z', event: 'filtered: onsite-only, workMode=remote' },
    ],
  },
  {
    id: '2', url: 'https://jobs.example.com/umbrella/fullstack', company: 'Umbrella',
    status: 'rejected', updatedAt: '2026-07-12T09:00:00.000Z',
  },
], null, 2));

const migrateRun = JSON.parse(execFileSync(process.execPath, [
  '.agents/skills/start/scripts/hunt.mjs',
  '--source-file', 'harness/fixtures/source-jobs.md',
  '--apps', legacyApps,
  '--screened', legacyScreened,
  '--instructions', 'harness/fixtures/instructions.md',
], { cwd: root, encoding: 'utf8' }));

assert.equal(migrateRun.migrated, 1, 'the fit-filtered fake rejection was migrated');
const afterMigration = JSON.parse(readFileSync(legacyApps, 'utf8'));
assert.deepEqual(
  afterMigration.map(a => a.company),
  ['Umbrella'],
  'a real rejection — no "filtered:" event — is left exactly where it is'
);
const migratedEntry = JSON.parse(readFileSync(legacyScreened, 'utf8')).entries[0];
assert.equal(migratedEntry.company, 'Onsite Co');
assert.equal(migratedEntry.reason, 'onsite-only, workMode=remote', 'reason recovered from history');
assert.equal(migratedEntry.screenedAt, '2026-08-01T09:01:00.000Z', 'original date kept');
assert.equal(
  JSON.parse(execFileSync(process.execPath, [
    '.agents/skills/start/scripts/hunt.mjs',
    '--source-file', 'harness/fixtures/source-jobs.md',
    '--apps', legacyApps, '--screened', legacyScreened,
    '--instructions', 'harness/fixtures/instructions.md',
  ], { cwd: root, encoding: 'utf8' })).migrated,
  0,
  'migration is one-time — a second run finds nothing to repair'
);

console.log('hunt: parse + dedup + never-apply + track + idempotency ✓');
console.log('hunt: screen / unscreen / two-ledger dedup / legacy repair ✓');
console.log('harness: hunt check passed');
