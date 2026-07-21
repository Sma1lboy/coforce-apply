// Hunt harness check: mock source table → parse, dedup vs tracker,
// never-apply filter, --track write, idempotency on second run.
// Run: node harness/check-hunt.mjs

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const apps = join(outDir, 'hunt-apps.json');
copyFileSync(join(here, 'fixtures/applications.json'), apps);

const run = () =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '.claude/skills/start/scripts/hunt.mjs',
        '--track',
        '--source-file', 'harness/fixtures/source-jobs.md',
        '--apps', apps,
        '--instructions', 'harness/fixtures/instructions.md',
      ],
      { cwd: root, encoding: 'utf8' }
    )
  );

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
const tracked = JSON.parse(readFileSync(apps, 'utf8'));
const stripe = tracked.find(a => a.url === 'https://stripe.example/jobs/swe-new-grad-123');
assert.ok(stripe, 'new job tracked');
assert.equal(stripe.status, 'pending');
assert.equal(stripe.title, 'Software Engineer, New Grad — Stripe');
assert.ok(stripe.history[0].event.includes('discovered from'), 'discovery event');

// second run: everything already tracked → nothing new (no duplicate applies)
const second = run();
assert.equal(second.new.length, 0, 'idempotent — no re-track');
assert.equal(second.skipped.blocked, 1, 'blocklist still applied');

console.log('hunt: parse + dedup + never-apply + track + idempotency ✓');
console.log('harness: hunt check passed');
