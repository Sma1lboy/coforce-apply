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

// --- 3. serve mode: drag persistence writes back to the JSON file ---
const live = join(outDir, 'apps-live.json');
copyFileSync(join(here, 'fixtures/applications.json'), live);
// mirror the archive folder next to the live JSON so /files/ serving is testable
cpSync(join(here, 'fixtures/applications'), join(outDir, 'applications'), {
  recursive: true,
});
const server = spawn(process.execPath, ['.claude/skills/tracker/scripts/board.mjs', live, '--serve', '0'], {
  cwd: root,
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
  const page = await (await fetch(base)).text();
  assert.ok(page.includes('Application Board'), 'serve renders board');

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
} finally {
  server.kill();
}

console.log('harness: tracker board check passed');
