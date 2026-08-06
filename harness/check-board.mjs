// Tracker harness check: the console API over fixture data.
// board.mjs serves the prebuilt React console and is its API — there is no
// second, hand-rolled renderer to assert HTML against any more, so the
// board's contract is the /api/* payloads plus the shell it serves.
// Run: node harness/check-board.mjs

import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { onePagePdf } from './pdf-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

// --- 0. data-home resolution: env override → in-repo (private fork) → ~ ---
{
  const { dataHome } = await import(
    join(root, '.agents/lib/data-home.mjs')
  );
  const { homedir } = await import('node:os');
  process.env.COFORCE_HOME = join(outDir, 'env-home');
  assert.equal(dataHome(), join(outDir, 'env-home'), 'COFORCE_HOME wins');
  delete process.env.COFORCE_HOME;
  const forkRoot = join(outDir, 'fake-fork');
  mkdirSync(join(forkRoot, '.coforce'), { recursive: true });
  assert.equal(dataHome(forkRoot), join(forkRoot, '.coforce'), 'in-repo .coforce wins when present');
  const bareRoot = join(outDir, 'fake-clone');
  mkdirSync(bareRoot, { recursive: true });
  assert.equal(dataHome(bareRoot), join(homedir(), '.coforce'), 'falls back to ~/.coforce');
  console.log('data home: env → in-repo → ~ resolution ✓');
}

// --- 1. serve mode: the console API is the only board renderer now ---
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
writeFileSync(
  join(outDir, 'config.json'),
  JSON.stringify({ headlessApply: false })
);
const server = spawn(process.execPath, ['.agents/skills/tracker/scripts/board.mjs', live, '--serve', '0'], {
  cwd: root,
  env: {
    ...process.env,
    COFORCE_CLAUDE_BIN: join(here, 'fixtures/agent-stub.sh'),
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
  const workerAsset = readdirSync(join(root, '.agents/skills/tracker/web/dist/assets'))
    .find(name => name.endsWith('.mjs'));
  assert.ok(workerAsset, 'PDF.js worker is bundled');
  const workerResponse = await fetch(`${base}/assets/${workerAsset}`);
  assert.equal(workerResponse.status, 200, 'PDF.js worker served');
  assert.ok(workerResponse.headers.get('content-type').startsWith('text/javascript'), 'PDF.js worker has executable MIME type');
  const bootstrap = await (await fetch(`${base}/api/state`)).json();
  assert.equal(bootstrap.profile.name, 'John Doe', 'state bootstrap profile');
  assert.equal(bootstrap.apps.length, 5, 'state bootstrap apps');
  assert.equal(bootstrap.agent, 'claude', 'state exposes the runtime');
  assert.equal(bootstrap.experience.tier, 0, 'state exposes Tier 0 experience status');
  assert.ok(Array.isArray(bootstrap.globalFiles), 'state bootstrap files');

  assert.equal((await fetch(`${base}/legacy`)).status, 404, 'the second renderer is gone');

  // every field the console's Board tab reads must reach it through /api/state
  const nimbus = bootstrap.apps.find(a => a.title?.includes('Nimbus Analytics'));
  assert.ok(nimbus, 'fixture application in the payload');
  assert.ok(nimbus.description?.includes('real-time observability'), 'JD text in payload');
  assert.ok(nimbus.history?.length, 'delivery history in payload');
  assert.ok(Array.isArray(nimbus._files), 'per-application archive listed');
  assert.ok(
    bootstrap.globalFiles.includes('interview-cheatsheet.md'),
    'global archive listed'
  );
  assert.ok(bootstrap.instructions.includes('never-apply'), 'instructions in payload');
  assert.equal(
    bootstrap.profile.customSections[0].entries[0].heading,
    'ACM Regional Finalist',
    'custom sections reach the profile editor'
  );

  // statuses the board can show — and the two legacy ones it must migrate away
  const statuses = new Set(bootstrap.apps.map(a => a.status));
  for (const s of statuses) {
    assert.ok(
      ['pending', 'applied', 'interviewing', 'offer', 'rejected'].includes(s),
      `unexpected status in payload: ${s}`
    );
  }

  // hostile data stays DATA: it round-trips through JSON and never reaches the
  // served HTML shell (React escapes on render; the shell is static)
  const hostile = JSON.parse(readFileSync(live, 'utf8'));
  hostile.unshift({
    id: 'x1',
    url: 'https://example.com/"><img src=x>',
    title: '<script>alert(1)</script>',
    status: 'fallback', // legacy status — must normalize to pending + flag
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    notes: '<img src=x onerror=alert(2)>',
  });
  writeFileSync(live, JSON.stringify(hostile, null, 2));
  const withHostile = await (await fetch(`${base}/api/state`)).json();
  const evilApp = withHostile.apps.find(a => a.id === 'x1');
  assert.equal(evilApp.title, '<script>alert(1)</script>', 'hostile title survives as data');
  assert.equal(evilApp.status, 'pending', 'legacy fallback status normalized');
  assert.equal(evilApp.needsFallback, true, 'and flagged for the human');
  assert.ok(
    !(await (await fetch(base)).text()).includes('<script>alert(1)'),
    'hostile data never reaches the served shell'
  );
  writeFileSync(live, JSON.stringify(hostile.slice(1), null, 2));
  console.log('board: state payload + hostile data stays data ✓');

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

  // skill-policy review: merged inventory → explicit human approval
  const skillPolicy = await (await fetch(`${base}/api/skills/policy`)).json();
  assert.ok(skillPolicy.skills.some(skill => skill.name === 'JavaScript'), 'resume skill enters merged inventory');
  assert.equal(skillPolicy.review.status, 'review_requested', 'missing policy starts behind review gate');
  const badSkillPolicy = await fetch(`${base}/api/skills/policy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseline: ['Invented Framework'],
      rolePacks: { frontend: ['React'] },
      approve: true,
    }),
  });
  assert.equal(badSkillPolicy.status, 400, 'policy cannot reference skills outside merged pool');
  const approvedSkillPolicy = await fetch(`${base}/api/skills/policy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseline: ['JavaScript', 'TypeScript'],
      rolePacks: { frontend: ['React'] },
      approve: true,
    }),
  });
  assert.equal(approvedSkillPolicy.status, 200, 'complete skill policy approved');
  const approvedSkillPolicyJson = await approvedSkillPolicy.json();
  assert.equal(approvedSkillPolicyJson.review.status, 'approved', 'approval unlocks skill selection');
  assert.ok(approvedSkillPolicyJson.policy.reviewedAt, 'approval timestamp persisted');
  console.log('board: skill-policy approval API ✓');

  // discovery preferences round-trip (first-run wizard persistence);
  // idempotent — asserts save/overwrite, not initial absence, since
  // harness/out keeps files between runs
  const prefPost = await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: 'internship', directions: ['backend', 'general'], needsSponsorship: true, workMode: 'remote' }),
  });
  assert.equal(prefPost.status, 204, 'prefs saved');
  assert.equal((await (await fetch(`${base}/api/prefs`)).json()).level, 'internship', 'prefs persisted');
  await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: 'any', directions: [] }),
  });
  const mergedPrefs = await (await fetch(`${base}/api/prefs`)).json();
  assert.equal(mergedPrefs.level, 'any', 'prefs overwrite');
  // console edits merge into the canonical file — setup-collected intent
  // (sponsorship, work mode) must survive a wizard save that omits them
  assert.equal(mergedPrefs.needsSponsorship, true, 'prefs merge keeps sponsorship');
  assert.equal(mergedPrefs.workMode, 'remote', 'prefs merge keeps work mode');
  // intent and runtime config are two views on the one config.json
  const cfgAfterPrefs = await (await fetch(`${base}/api/config`)).json();
  assert.equal(cfgAfterPrefs.version, 2, 'config stamped with schema version');
  assert.equal(cfgAfterPrefs.level, 'any', 'intent keys live in config.json');
  assert.equal(
    cfgAfterPrefs.headlessApply,
    false,
    'runtime config survives an intent-only save'
  );

  // AI import: stubbed configured agent parses pasted text into a profile object
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

  // Additive AI channel: raw material (award link + note) → agent returns ONLY
  // new entries with link provenance; profile on disk stays untouched until
  // the user reviews and saves client-side
  const profileBefore = readFileSync(join(outDir, 'profile.json'), 'utf8');
  const add = await fetch(`${base}/api/profile/add`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Won 1st place at Stub Hackathon 2025 — https://example.com/results' }),
  });
  assert.equal(add.status, 200, 'profile add accepted');
  const additions = await add.json();
  assert.equal(additions.customSections?.[0]?.title, 'Awards', 'add flow returns award section');
  assert.equal(
    additions.customSections[0].entries[0].description[0].source,
    'https://example.com/results',
    'award bullet carries link provenance'
  );
  assert.equal(
    readFileSync(join(outDir, 'profile.json'), 'utf8'),
    profileBefore,
    'add flow never writes profile.json directly'
  );
  const addEmpty = await fetch(`${base}/api/profile/add`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: ' ' }),
  });
  assert.equal(addEmpty.status, 500, 'empty material rejected');

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

  // fresh workspace: a data home with no applications.json is an empty board,
  // not a crash (board.mjs must never invent or overwrite data it cannot read)
  {
    const freshHome = mkdtempSync(join(tmpdir(), 'coforce-board-fresh-'));
    const fresh = spawn(
      process.execPath,
      ['.agents/skills/tracker/scripts/board.mjs', join(freshHome, 'applications.json'), '--serve', '0'],
      { cwd: root, env: { ...process.env, COFORCE_SOURCE_FILE: join(here, 'fixtures/source-jobs.md') } }
    );
    try {
      const freshPort = await new Promise((res, rej) => {
        let buf = '';
        fresh.stdout.on('data', d => {
          buf += d;
          const m = buf.match(/localhost:(\d+)/);
          if (m) res(Number(m[1]));
        });
        fresh.on('exit', () => rej(new Error(`fresh server exited: ${buf}`)));
        setTimeout(() => rej(new Error('fresh server start timeout')), 5000);
      });
      const freshState = await (await fetch(`http://localhost:${freshPort}/api/state`)).json();
      assert.deepEqual(freshState.apps, [], 'missing applications.json → empty board');
      assert.equal(freshState.prefs, null, 'no settings → the welcome wizard opens');
      const freshSkillPolicyResponse = await fetch(`http://localhost:${freshPort}/api/skills/policy`);
      assert.equal(freshSkillPolicyResponse.status, 200, 'fresh profile skill policy is readable');
      const freshSkillPolicy = await freshSkillPolicyResponse.json();
      assert.equal(freshSkillPolicy.review.status, 'review_requested');
      assert.deepEqual(freshSkillPolicy.skills, [], 'fresh profile starts with an empty skill inventory');
      const freshProfileSave = await fetch(`http://localhost:${freshPort}/api/profile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Fresh Candidate', skills: ['Node.js'] }),
      });
      assert.equal(freshProfileSave.status, 204, 'first profile save succeeds without restarting the board');
      const refreshedSkillPolicy = await (
        await fetch(`http://localhost:${freshPort}/api/skills/policy`)
      ).json();
      assert.deepEqual(
        refreshedSkillPolicy.skills.map(skill => skill.name),
        ['Node.js'],
        'skill inventory becomes available immediately after the first profile save'
      );
      assert.equal(
        existsSync(join(freshHome, 'applications.json')),
        false,
        'reading an empty workspace must not create files'
      );
      console.log('board: fresh workspace ✓');
    } finally {
      fresh.kill();
    }
  }

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
  const queuedResult = await q1.json();
  const afterQueue = JSON.parse(readFileSync(live, 'utf8'));
  const queued = afterQueue.find(a => a.url === job.url);
  assert.ok(queued, 'queued job tracked');
  assert.equal(queued.status, 'pending');
  assert.ok(queued.history[0].event.includes('queued for resume campaign'), 'queue history event');
  const q2 = await fetch(`${base}/api/queue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(job),
  });
  assert.equal(q2.status, 409, 'duplicate queue rejected');
  // instructions.md overrides everything on EVERY queueing path — the console's
  // Build-resume button used to walk straight past the never-apply list
  const blockedQueue = await fetch(`${base}/api/queue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: 'https://jobs.example.com/megaevil-1',
      role: 'Engineer',
      company: 'MegaEvil Inc',
    }),
  });
  assert.equal(blockedQueue.status, 403, 'never-apply company rejected at queue');
  assert.ok(
    !JSON.parse(readFileSync(live, 'utf8')).some(a => a.company === 'MegaEvil Inc'),
    'never-apply company never reaches the tracker'
  );
  console.log('board: discover + apply queue + never-apply gate ✓');

  // resume campaign API: queue → feedback → approve → export/download
  const campaign = await (await fetch(`${base}/api/campaign`)).json();
  const campaignJob = campaign.jobs.find(item =>
    item.id === queuedResult.campaignJobId || item.url === job.url
  );
  assert.ok(campaignJob, 'queued listing appears in resume campaign');
  const feedback = await fetch(`${base}/api/campaign/jobs/${campaignJob.id}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Lead with the grounded reliability work.' }),
  });
  assert.equal(feedback.status, 200, 'campaign feedback accepted');
  assert.equal((await feedback.json()).status, 'revision_requested');
  const campaignDir = join(outDir, 'campaigns', 'current', 'jobs', campaignJob.folder);
  mkdirSync(campaignDir, { recursive: true });
  for (const [name, content] of Object.entries({
    'resume.pdf': onePagePdf('CoForce board fixture'),
    'resume.tex': '\\documentclass{article}\\begin{document}Fixture\\end{document}\n',
    'job-description.md': '# Fixture JD\n',
    'job.json': JSON.stringify({ id: campaignJob.id }),
    'match-report.md': '# Grounded match\n',
    'judge.json': JSON.stringify({
      pageCount: 1,
      fullness: 0.94,
      minimumPageCoverage: 0.93,
      minimumPageCoveragePercent: 93,
      onePage: true,
      fullPage: true,
      resumeItemsUseBodyArgument: true,
      verbatim: true,
      skillsVerbatim: true,
      extractable: true,
    }),
    'llm-judge.json': JSON.stringify({
      judgedAt: '2026-07-26T00:00:00.000Z',
      runs: 3,
      medianTotal: 87,
      pass: true,
      fixes: ['Add one stronger result metric.'],
      verdicts: [
        { total: 84, jd_fit_note: 'Good adjacent fit.' },
        { total: 87, jd_fit_note: 'Strong direct fit; improve proof of impact.' },
        { total: 90, jd_fit_note: 'Strong direct fit.' },
      ],
    }),
  })) writeFileSync(join(campaignDir, name), content);
  const judgedCampaign = await (await fetch(`${base}/api/campaign`)).json();
  const judgedJob = judgedCampaign.jobs.find(item => item.id === campaignJob.id);
  assert.equal(judgedJob.machineJudge.pageCount, 1, 'campaign API exposes the machine gate summary');
  assert.equal(judgedJob.machineJudge.fullPage, undefined, 'Human API hides the coverage verdict');
  assert.equal(judgedJob.reviewDeliveryProof, undefined, 'Human API hides internal delivery proof');
  assert.equal(judgedJob.llmJudge.medianTotal, 87, 'campaign API exposes the LLM judge median');
  assert.equal(
    judgedJob.llmJudge.jdFitNote,
    'Strong direct fit; improve proof of impact.',
    'campaign API keeps JD fit distinct from absolute resume QA'
  );
  const approved = await fetch(`${base}/api/campaign/jobs/${campaignJob.id}/approve`, { method: 'POST' });
  assert.equal(approved.status, 200, 'campaign approval accepted with complete artifacts');
  const approvedJob = await approved.json();
  assert.equal(approvedJob.status, 'approved');
  assert.equal(approvedJob.reviewDeliveryProof, undefined, 'approval response remains Human-safe');
  const internalManifestPath = join(outDir, 'campaigns', 'current', 'manifest.json');
  assert.equal(
    JSON.parse(readFileSync(internalManifestPath, 'utf8')).jobs
      .find(item => item.id === campaignJob.id)
      .reviewDeliveryProof.pageCoverage.status,
    'passed',
    'internal manifest retains the coverage delivery proof'
  );
  const packed = await fetch(`${base}/api/campaign/export`, { method: 'POST' });
  assert.equal(packed.status, 200, 'approved campaign exported');
  const download = await fetch(`${base}${(await packed.json()).url}`);
  assert.equal(download.status, 200, 'campaign ZIP served');
  assert.equal(download.headers.get('content-type'), 'application/zip');
  const campaignEvil = await fetch(`${base}/campaign/files/..%2Fapps-live.json`);
  assert.equal(campaignEvil.status, 404, 'campaign traversal blocked');
  console.log('board: campaign feedback + approval + ZIP API ✓');

  const coverageSetting = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resumePageCoverageMinimumPercent: 96 }),
  });
  assert.equal(coverageSetting.status, 204, 'resume page coverage setting saved');
  const coverageState = await (await fetch(`${base}/api/state`)).json();
  const coverageJob = coverageState.campaign.jobs.find(item => item.id === campaignJob.id);
  assert.equal(coverageState.campaign.minimumPageCoveragePercent, 96);
  assert.equal(coverageJob.status, 'revision_requested', 'raising coverage reopens an underfilled approved resume');
  assert.equal(coverageJob.reviewReady, false);
  assert.ok(
    !JSON.stringify(coverageState.campaign).includes('page_coverage_insufficient'),
    'Human campaign API never exposes the internal reason code'
  );
  const internalCoverageJob = JSON.parse(readFileSync(internalManifestPath, 'utf8')).jobs
    .find(item => item.id === campaignJob.id);
  assert.ok(
    internalCoverageJob.feedback.some(item =>
      item.reasonCode === 'page_coverage_insufficient' &&
      item.visibility === 'internal' &&
      item.status === 'open'),
    'internal state retains the structured unresolved reason'
  );
  const blockedApproval = await fetch(`${base}/api/campaign/jobs/${campaignJob.id}/approve`, {
    method: 'POST',
  });
  assert.equal(blockedApproval.status, 400);
  assert.ok(!/coverage|proof|96/i.test(await blockedApproval.text()), 'approval error remains Human-safe');
  console.log('board: configurable resume coverage gate ✓');

  const reviewToggle = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requireResumeReview: false }),
  });
  assert.equal(reviewToggle.status, 204, 'resume review setting saved');
  const autoReviewState = await (await fetch(`${base}/api/state`)).json();
  assert.equal(autoReviewState.campaign.reviewRequired, false, 'campaign exposes auto-review mode');
  console.log('board: resume review toggle ✓');

  // background Chrome apply lifecycle: consent gate → fill → confirm → submitted
  writeFileSync(join(outDir, 'config.json'), JSON.stringify({ headlessApply: false }));
  const denied = await fetch(`${base}/api/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://jobs.example.com/x' }),
  });
  assert.equal(denied.status, 403, 'background apply gated on consent');

  writeFileSync(join(outDir, 'config.json'), JSON.stringify({ headlessApply: true }));
  const started = await fetch(`${base}/api/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://jobs.example.com/x' }),
  });
  assert.equal(started.status, 200, 'background Chrome apply started');
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
  console.log('board: Claude Chrome-backed apply lifecycle ✓');
} finally {
  server.kill();
}

console.log('harness: tracker board check passed');
