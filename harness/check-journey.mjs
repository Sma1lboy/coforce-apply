// One student, one timeline: the seams BETWEEN stages, which is where a job
// hunt actually fails. Every other check verifies a stage in isolation; this
// one advances a clock over a single ~/.coforce and asserts what the product
// owes the user at each point.
//
// The student: CS senior, F-1, needs sponsorship, hunting SWE internships.
// Run: node harness/check-journey.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attentionFor, attentionQueue, daysQuiet, daysUntilDeadline, followUpCount } from '../.agents/lib/attention.mjs';
import { seedSandbox } from './sandbox.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const home = join(here, 'out', 'journey');
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
seedSandbox(home);

const appsPath = join(home, 'applications.json');
const readApps = () => JSON.parse(readFileSync(appsPath, 'utf8'));
const writeApps = apps => writeFileSync(appsPath, `${JSON.stringify(apps, null, 2)}\n`);

// A fixed "today" so the assertions below describe calendar distances, not
// whenever CI happens to run.
const DAY = 86_400_000;
const T0 = Date.parse('2026-09-01T12:00:00.000Z');
const at = days => T0 + days * DAY;
const iso = days => new Date(at(days)).toISOString();

// -- Day 0: discovery ------------------------------------------------------
// The student runs /start for the first time. Nothing is tracked yet.
const hunt = JSON.parse(
  execFileSync(
    process.execPath,
    [
      '.agents/skills/start/scripts/hunt.mjs',
      '--track',
      '--source-file', 'harness/fixtures/source-jobs.md',
      '--apps', appsPath,
      '--instructions', 'harness/fixtures/instructions.md',
    ],
    { cwd: root, encoding: 'utf8' }
  )
);
assert.ok(hunt.new.length > 0, 'day 0: discovery found something to apply to');
const tracked = readApps();
assert.ok(tracked.every(a => a.status === 'pending'), 'day 0: everything starts pending — nothing is sent by discovery');
console.log(`journey day 0: ${hunt.new.length} postings discovered, all pending ✓`);

// -- Day 0: nothing is urgent yet ------------------------------------------
assert.equal(attentionQueue(tracked, at(0)).length, 0, 'day 0: a fresh board asks nothing of the user');

// -- The seam this product keeps failing at --------------------------------
// A posting with a real deadline sits in `pending`. A resume was rendered for
// it. Nobody submitted it. This is finished work quietly expiring, and it is
// the one case where `pending` DOES want attention.
const apps = readApps();
const withDeadline = apps[0];
withDeadline.deadline = new Date(at(5)).toISOString().slice(0, 10);
writeApps(apps);

assert.equal(daysUntilDeadline(withDeadline.deadline, at(0)), 5, 'deadline math is in calendar days');
const soon = attentionFor(withDeadline, at(0));
assert.equal(soon[0].kind, 'deadline-soon', 'day 0: a deadline 5d out is already worth naming');
assert.match(soon[0].reason, /still unsent/, '↳ the reason says what is wrong, not just that a date exists');

// A deadline is a DAY, not an instant. On the deadline itself the student can
// still apply — the most common moment they actually do.
assert.equal(daysUntilDeadline(withDeadline.deadline, at(5)), 0, 'the deadline day is not yet passed');
assert.equal(attentionFor(withDeadline, at(5))[0].kind, 'deadline-soon', '↳ still actionable on the day');
// And the morning after, it is gone.
assert.equal(attentionFor(withDeadline, at(6))[0].kind, 'deadline-passed', 'the day after, the window is shut');
console.log('journey: deadline is a calendar day — actionable through the deadline, dead the morning after ✓');

// A deadline on an entry the student already SENT is not a nudge. The clock
// that matters after submitting is silence, not the window.
const sent = { ...withDeadline, id: 'sent-1', status: 'applied', history: [{ date: iso(1), event: 'applied' }] };
assert.equal(
  attentionFor(sent, at(6)).filter(f => f.kind.startsWith('deadline')).length,
  0,
  'a passed deadline on an already-submitted application is noise'
);

// -- Day 12: silence after applying ----------------------------------------
const applied = {
  id: 'applied-1',
  company: 'Stripe',
  status: 'applied',
  updatedAt: iso(0),
  history: [{ date: iso(0), event: 'applied' }],
};
assert.equal(daysQuiet(applied, at(12)), 12, 'quiet days count from the newest history event');
const quiet = attentionFor(applied, at(12));
assert.equal(quiet[0].kind, 'follow-up', 'day 12: 12d of silence earns one follow-up');

// Never chase a `pending` entry — nothing was sent, nobody is late.
const neverSent = { ...applied, id: 'pending-1', status: 'pending' };
assert.equal(attentionFor(neverSent, at(60)).length, 0, 'a pending entry is never "overdue for a reply"');
console.log('journey day 12: silence after applying is chased; silence before applying is not ✓');

// -- Follow-ups are capped -------------------------------------------------
// Two nudges is persistence. Three is the product teaching a student to
// pester a recruiter, which costs them the thing they are asking us for.
const chased = {
  ...applied,
  history: [
    { date: iso(0), event: 'applied' },
    { date: iso(10), event: 'followed up 2026-09-11' },
    { date: iso(20), event: 'followed up 2026-09-21' },
  ],
};
assert.equal(followUpCount(chased), 2, 'follow-ups are counted from history, not guessed');
assert.equal(
  attentionFor(chased, at(32)).filter(f => f.kind === 'follow-up').length,
  0,
  'after two follow-ups the product stops asking the student to chase'
);

// -- Day 21+: silence IS the outcome ---------------------------------------
// Most student applications are never formally rejected. If the loop only
// learns from explicit rejections it learns from almost nothing.
const ghosted = { ...applied, history: [{ date: iso(0), event: 'applied' }] };
const late = attentionFor(ghosted, at(25));
assert.equal(late[0].kind, 'silent-rejection', 'day 25: silence becomes a countable outcome');
assert.equal(
  late.filter(f => f.kind === 'follow-up').length,
  0,
  '↳ and it stops asking for a follow-up that is no longer worth sending'
);
console.log('journey day 25: a ghosted application counts as an outcome, not an open thread ✓');

// -- The whole board, ordered by what wants a human ------------------------
const board = [
  { id: 'a', company: 'Acme', status: 'applied', history: [{ date: iso(0), event: 'applied' }] },
  { id: 'b', company: 'Globex', status: 'pending', deadline: new Date(at(-2)).toISOString().slice(0, 10) },
  { id: 'c', company: 'Initech', status: 'applied', history: [{ date: iso(20), event: 'applied' }] },
  { id: 'd', company: 'Umbrella', status: 'offer', history: [{ date: iso(25), event: 'offer' }] },
];
const queue = attentionQueue(board, at(30));
assert.deepEqual(
  queue.map(f => [f.company, f.kind]),
  [
    ['Globex', 'deadline-passed'],
    ['Acme', 'silent-rejection'],
    ['Initech', 'follow-up'],
  ],
  'the queue leads with the thing that already went wrong, and leaves a live offer alone'
);
console.log('journey: attention queue ordered by what needs a human ✓');
// -- The prose and the code must agree ------------------------------------
// Every number below started life as a sentence in tracker/SKILL.md, and a
// sentence cannot go red when the code drifts from it. An agent reads the
// SKILL.md; the console runs attention.mjs. If those two ever disagree the
// student gets one answer on screen and a different one from the assistant,
// which is worse than having neither.
const skill = readFileSync(join(root, '.agents/skills/tracker/SKILL.md'), 'utf8');
for (const [n, what] of [[7, 'deadline horizon'], [10, 'follow-up threshold'], [21, 'silent-rejection threshold']]) {
  assert.ok(
    new RegExp(`\\b${n}\\b`).test(skill),
    `tracker/SKILL.md no longer states the ${what} (${n}) that attention.mjs enforces`
  );
}
assert.match(skill, /[Nn]ever chase a `?pending/, 'SKILL.md must keep stating the pending rule the code enforces');
console.log('journey: SKILL.md prose and attention.mjs agree on every threshold ✓');
console.log('harness: journey check passed');
