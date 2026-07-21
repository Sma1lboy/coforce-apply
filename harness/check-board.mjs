// Tracker harness check: fixture applications → board HTML → assertions,
// plus escaping probe and serve-mode persistence smoke test.
// Run: node harness/check-board.mjs

import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

// --- 1. static render from fixtures ---
const out = join(outDir, 'board.html');
execFileSync(
  process.execPath,
  ['.claude/skills/tracker/scripts/board.mjs', 'harness/fixtures/applications.json', out],
  { cwd: root, stdio: 'inherit' }
);
const html = readFileSync(out, 'utf8');

for (const status of [
  'pending',
  'applied',
  'interviewing',
  'offer',
  'rejected',
]) {
  assert.ok(
    html.includes(`data-status="${status}"`),
    `missing column ${status}`
  );
}
assert.ok(!html.includes('data-status="fallback"'), 'fallback is not a column');
assert.ok(!html.includes('data-status="failed"'), 'failed is not a column');
assert.ok(html.includes('needs Claude fallback'), 'needsFallback flag rendered');
assert.ok(html.includes('5 tracked'), 'header count');
assert.ok(html.includes('Senior Full-Stack Engineer — Nimbus Analytics'));
assert.ok(html.includes('Referred by Sam; recruiter: r.lee@acme.example'));
assert.ok(html.includes('Onsite scheduled 2026-07-24'));
// detail-view data reaches the page (embedded payload for the dialog)
assert.ok(html.includes('real-time observability platform'), 'description in payload');
assert.ok(html.includes('recruiter email'), 'history in payload');
assert.ok(html.includes('draggable="true"'), 'cards draggable');
// template-literal escaping guard: client regex word boundaries must survive
assert.ok(html.includes('\\bintern'), 'client regex \\b not eaten by template literal');
// per-application + global archive files listed in the payload
assert.ok(html.includes('interview-prep.md'), 'per-app file listed');
assert.ok(html.includes('interview-cheatsheet.md'), 'global file listed');
console.log('board: static render + detail payload ✓');

// --- 2. escaping probe: hostile data must not become markup ---
const probe = join(outDir, 'probe.json');
writeFileSync(
  probe,
  JSON.stringify([
    {
      id: 'x1',
      url: 'https://example.com/"><img src=x>',
      title: '<script>alert(1)</script>',
      status: 'fallback', // legacy status — must normalize to pending
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      notes: '<img src=x onerror=alert(2)>',
    },
  ])
);
const probeOut = join(outDir, 'probe.html');
execFileSync(process.execPath, ['.claude/skills/tracker/scripts/board.mjs', probe, probeOut], {
  cwd: root,
  stdio: 'inherit',
});
const probeHtml = readFileSync(probeOut, 'utf8');
assert.ok(!probeHtml.includes('<script>alert(1)'), 'title script escaped');
assert.ok(!probeHtml.includes('<img src=x'), 'notes/url markup escaped');
assert.ok(probeHtml.includes('&lt;script&gt;alert(1)'), 'escaped title rendered');
// legacy status normalized: card renders with the fallback flag in To Apply
assert.ok(
  probeHtml.includes('needs Claude fallback'),
  'legacy fallback status normalized to pending + flag'
);
console.log('board: escaping probe + legacy migration ✓');

// --- 2.5 fresh workspace: missing applications.json renders an empty board ---
const freshOut = join(outDir, 'fresh.html');
execFileSync(
  process.execPath,
  ['.claude/skills/tracker/scripts/board.mjs', join(outDir, 'does-not-exist.json'), freshOut],
  { cwd: root, stdio: 'inherit' }
);
assert.ok(
  readFileSync(freshOut, 'utf8').includes('0 tracked'),
  'missing file renders empty board instead of crashing'
);
console.log('board: fresh workspace ✓');

// --- 3. serve mode: drag persistence writes back to the JSON file ---
const live = join(outDir, 'apps-live.json');
copyFileSync(join(here, 'fixtures/applications.json'), live);
// mirror the archive folder + profile + instructions next to the live JSON so
// the console's /files/ and profile/instructions panes are testable
cpSync(join(here, 'fixtures/applications'), join(outDir, 'applications'), {
  recursive: true,
});
copyFileSync(join(here, 'fixtures/profile.json'), join(outDir, 'profile.json'));
copyFileSync(
  join(here, 'fixtures/instructions.md'),
  join(outDir, 'instructions.md')
);
const server = spawn(process.execPath, ['.claude/skills/tracker/scripts/board.mjs', live, '--serve', '0'], {
  cwd: root,
  env: {
    ...process.env,
    COFORCE_CLAUDE_BIN: join(here, 'fixtures/claude-stub.sh'),
    COFORCE_SOURCE_FILE: join(here, 'fixtures/source-jobs.md'),
  },
});
try {
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    server.stdout.on('data', d => {
      buf += d;
      const m = buf.match(/localhost:(\d+)/);
      if (m) resolve(Number(m[1]));
    });
    server.on('exit', () => reject(new Error(`server exited: ${buf}`)));
    setTimeout(() => reject(new Error('server start timeout')), 5000);
  });

  const base = `http://localhost:${port}`;

  // React console served at / when web/dist is built; /api/state bootstrap
  const rootPage = await (await fetch(base)).text();
  assert.ok(
    rootPage.includes('id="root"') || rootPage.includes('id="view-board"'),
    'root serves React dist (or inline fallback when dist absent)'
  );
  const bootstrap = await (await fetch(`${base}/api/state`)).json();
  assert.equal(bootstrap.profile.name, 'John Doe', 'state bootstrap profile');
  assert.equal(bootstrap.apps.length, 5, 'state bootstrap apps');
  assert.ok(Array.isArray(bootstrap.globalFiles), 'state bootstrap files');

  const page = await (await fetch(`${base}/legacy`)).text();
  assert.ok(page.includes('id="view-board"'), 'legacy console renders board view');
  // profile pane: resume preview + editor payload from fixture profile
  assert.ok(page.includes('John Doe'), 'profile preview rendered');
  assert.ok(page.includes('id="view-instructions"'), 'instructions view present');
  assert.ok(page.includes('never-apply'), 'instructions content loaded');

  // custom sections render in the preview and survive the round-trip
  assert.ok(page.includes('ACM Regional Finalist'), 'custom section in preview');
  assert.ok(page.includes('Custom sections'), 'custom-section editor present');

  // profile API round-trip
  const prof = await (await fetch(`${base}/api/profile`)).json();
  assert.equal(prof.name, 'John Doe', 'profile GET');
  assert.equal(prof.customSections[0].title, 'Awards', 'custom section GET');
  const postProf = await fetch(`${base}/api/profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...prof, title: 'Staff Engineer' }),
  });
  assert.equal(postProf.status, 204, 'profile POST accepted');
  assert.equal(
    JSON.parse(readFileSync(join(outDir, 'profile.json'), 'utf8')).title,
    'Staff Engineer',
    'profile save persisted'
  );
  const badProf = await fetch(`${base}/api/profile`, { method: 'POST', body: '[1,2]' });
  assert.equal(badProf.status, 400, 'non-object profile rejected');

  // discovery preferences round-trip (first-run wizard persistence);
  // idempotent — asserts save/overwrite, not initial absence, since
  // harness/out keeps files between runs
  const prefPost = await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: 'internship', directions: ['backend', 'general'] }),
  });
  assert.equal(prefPost.status, 204, 'prefs saved');
  assert.equal((await (await fetch(`${base}/api/prefs`)).json()).level, 'internship', 'prefs persisted');
  await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: 'any', directions: [] }),
  });
  assert.equal((await (await fetch(`${base}/api/prefs`)).json()).level, 'any', 'prefs overwrite');

  // AI import: stubbed claude CLI parses pasted text into a profile object
  const imp = await fetch(`${base}/api/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Stub Person — Engineer at Stub Corp' }),
  });
  assert.equal(imp.status, 200, 'import accepted');
  const imported = await imp.json();
  assert.equal(imported.name, 'Stub Person', 'import parsed via CLI stub');
  const impEmpty = await fetch(`${base}/api/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '  ' }),
  });
  assert.equal(impEmpty.status, 500, 'empty import rejected');

  const apps = await (await fetch(`${base}/api/apps`)).json();
  const moved = apps.map(a =>
    a.id === '1752900000000' ? { ...a, status: 'applied' } : a
  );
  const post = await fetch(`${base}/api/apps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(moved),
  });
  assert.equal(post.status, 204, 'save accepted');
  const onDisk = JSON.parse(readFileSync(live, 'utf8'));
  assert.equal(
    onDisk.find(a => a.id === '1752900000000').status,
    'applied',
    'drag persisted to disk'
  );
  // invalid payload rejected
  const bad = await fetch(`${base}/api/apps`, { method: 'POST', body: '{"not":"array"}' });
  assert.equal(bad.status, 400, 'non-array rejected');

  // archive files served: per-app, global, and traversal blocked
  const prep = await fetch(`${base}/files/1752900000003/interview-prep.md`);
  assert.equal(prep.status, 200, 'per-app file served');
  assert.ok((await prep.text()).includes('Onsite 2026-07-24'), 'file content');
  const glob = await fetch(`${base}/files/interview-cheatsheet.md`);
  assert.equal(glob.status, 200, 'global file served');
  const evil = await fetch(`${base}/files/..%2Fapps-live.json`);
  assert.equal(evil.status, 404, 'path traversal blocked');
  console.log('board: serve-mode persistence + archive files ✓');

  // discover + one-click apply queue
  const disc = await (await fetch(`${base}/api/discover`)).json();
  assert.ok(disc.new.length >= 1, 'discovery returns new postings');
  const job = disc.new[0];
  const q1 = await fetch(`${base}/api/queue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(job),
  });
  assert.equal(q1.status, 200, 'queue accepted');
  const afterQueue = JSON.parse(readFileSync(live, 'utf8'));
  const queued = afterQueue.find(a => a.url === job.url);
  assert.ok(queued, 'queued job tracked');
  assert.equal(queued.status, 'pending');
  assert.ok(queued.history[0].event.includes('queued for apply'), 'queue history event');
  const q2 = await fetch(`${base}/api/queue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(job),
  });
  assert.equal(q2.status, 409, 'duplicate queue rejected');
  console.log('board: discover + apply queue ✓');

  // headless apply lifecycle: consent gate → fill → confirm → submitted
  writeFileSync(join(outDir, 'apply-config.json'), JSON.stringify({ headlessApply: false }));
  const denied = await fetch(`${base}/api/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://jobs.example.com/x' }),
  });
  assert.equal(denied.status, 403, 'headless apply gated on consent');

  writeFileSync(join(outDir, 'apply-config.json'), JSON.stringify({ headlessApply: true }));
  const started = await fetch(`${base}/api/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://jobs.example.com/x' }),
  });
  assert.equal(started.status, 200, 'headless apply started');
  const { id: applyId } = await started.json();

  const waitFor = async want => {
    for (let i = 0; i < 40; i += 1) {
      const s = await (await fetch(`${base}/api/apply/${applyId}`)).json();
      if (s.status === want) return s;
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`apply job never reached ${want}`);
  };
  const ready = await waitFor('awaiting_confirm');
  assert.ok(ready.tail.includes('READY_TO_SUBMIT'), 'fill run stopped before submit');

  await fetch(`${base}/api/apply/${applyId}/confirm`, { method: 'POST' });
  await waitFor('submitted');
  console.log('board: headless apply lifecycle ✓');
} finally {
  server.kill();
}

console.log('harness: tracker board check passed');
