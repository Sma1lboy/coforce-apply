// Deterministic campaign pipeline: jobs + JD + verified bullet pool → strict selection → review → approved ZIP.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  addFeedback,
  judgeResume,
  selectBullets,
  applyResumeReviewPolicy,
  approveJob,
  campaignView,
  exportCampaign,
  htmlToText,
  hydrateJob,
  resolveCampaignFile,
  resumeReviewRequired,
  stageArtifacts,
  syncJobs,
} from '../.agents/skills/campaign/scripts/campaign-lib.mjs';
import {
  buildExperienceIndex,
  experiencePaths,
  upsertSource,
} from '../.agents/skills/experience/scripts/experience-lib.mjs';

function onePagePdf(label, full = true) {
  const safe = label.replace(/[()\\]/g, '');
  const bottom = full ? ' BT /F1 12 Tf 72 40 Td (page filled to the bottom margin) Tj ET' : '';
  const stream = `BT /F1 20 Tf 72 720 Td (${safe}) Tj ET${bottom}`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

const dataDir = process.env.COFORCE_CAMPAIGN_DIR || mkdtempSync(join(tmpdir(), 'coforce-campaign-'));
const jobs = [
  { id: 'app-1', company: 'Acme Labs', role: 'Backend Engineer', url: 'https://jobs.example/acme', source: 'fixture' },
  { id: 'app-2', company: 'Orbit AI', role: 'Agent Engineer', url: 'https://jobs.example/orbit', source: 'fixture' },
];
const synced = syncJobs(dataDir, jobs);
assert.equal(synced.added.length, 2);
assert.equal(syncJobs(dataDir, jobs).added.length, 0, 'URL sync is idempotent');
assert.equal(resumeReviewRequired(dataDir), true, 'resume review is required by default');

const jd = `Build reliable TypeScript backend APIs and agent workflows. ${'Design tests, observability, retries, and data systems. '.repeat(12)}`;
for (const job of synced.added) await hydrateJob(dataDir, job.id, { text: jd, source: 'fixture' });
assert.ok(htmlToText('<h1>Role</h1><script>bad()</script><p>Backend &amp; API</p>').includes('Backend & API'));

// regression: a JD that merely MENTIONS Cloudflare (e.g. Cloudflare's own
// postings) must not trip the bot-wall heuristic into needs_browser_jd
{
  const cfDir = mkdtempSync(join(tmpdir(), 'coforce-cf-'));
  const cfJob = syncJobs(cfDir, [{ url: 'https://example.com/cf-job', company: 'Cloudflare', role: 'SWE Intern' }]).added[0];
  const cfHydrated = await hydrateJob(cfDir, cfJob.id, { text: `Cloudflare runs one of the largest networks in the world. ${'Build and operate systems at Internet scale with Go, Rust and TypeScript. '.repeat(10)}`, source: 'fixture' });
  assert.equal(cfHydrated.status, 'jd_ready', "mentioning 'cloudflare' is not a bot wall");
}

const experience = experiencePaths(dataDir);
const libraryPath = experience.library;
mkdirSync(dirname(libraryPath), { recursive: true });
upsertSource(dataDir, { repo: 'example/product', authors: ['candidate'], project: 'Product' });
writeFileSync(join(dataDir, 'profile.json'), JSON.stringify({
  name: 'Candidate',
  skills: ['TypeScript', 'Node.js'],
  experience: [{
    company: 'Product Inc', title: 'Backend Engineer',
    description: [
      { text: 'Built reliable TypeScript agent API retries with observability and regression tests', source: 'https://github.com/example/product/pull/42', verifiedAt: '2026-07-01' },
      { text: 'Migrated data storage schema with zero-downtime migration tooling', source: 'https://github.com/example/product/commit/abc', verifiedAt: '2026-07-01' },
    ],
  }],
  projects: [{
    name: 'CoForce', description: [{ text: 'Designed a two-gate apply pipeline with a verified bullet pool' }],
  }],
}, null, 2));
writeFileSync(libraryPath, JSON.stringify({
  github_logins: ['candidate'],
  sources: [{ repo: 'example/product', authors: ['candidate'], project: 'Product' }],
  entries: [
    {
      id: 'product:pr:repo:42', project_id: 'product', project_name: 'Product',
      repository: 'example/product', artifact: 'pull_request', status: 'merged',
      author: 'candidate',
      title: 'Build reliable TypeScript agent API retries',
      body: 'Added backend observability and regression tests for data workflows.',
      tags: ['tech:typescript', 'work:api-backend', 'work:agent-ai', 'work:testing'],
      files: ['packages/api/retry.ts'],
      sources: [{ type: 'pull_request', url: 'https://github.com/example/product/pull/42' }],
    },
    {
      id: 'product:commit:repo:abc', project_id: 'product', project_name: 'Product',
      repository: 'example/product', artifact: 'commit', status: 'committed',
      author: 'candidate',
      title: 'Add database migration', body: 'Data storage schema migration',
      tags: ['work:data-storage'], files: [],
      sources: [{ type: 'commit', url: 'https://github.com/example/product/commit/abc' }],
    },
  ],
}, null, 2));
const index = buildExperienceIndex(dataDir);
assert.equal(index.tier, 0);

const tex = join(dataDir, 'fixture.tex');
const pdf = join(dataDir, 'fixture.pdf');
writeFileSync(tex, '\\documentclass{article}\\begin{document}Grounded fixture\\end{document}\n');
writeFileSync(pdf, onePagePdf('CoForce campaign fixture'));

const stubBin = join(dataDir, 'stub-bin');
const ghLog = join(dataDir, 'gh-called.log');
mkdirSync(stubBin, { recursive: true });
writeFileSync(join(stubBin, 'gh'), '#!/bin/sh\nprintf called >> "$COFORCE_GH_LOG"\nexit 91\n');
chmodSync(join(stubBin, 'gh'), 0o755);
const campaignCli = resolve('.agents/skills/campaign/scripts/campaign.mjs');
const libraryBefore = statSync(libraryPath);
const poolOut = execFileSync(process.execPath, [campaignCli, 'pool', '--data-dir', dataDir], {
  env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, COFORCE_GH_LOG: ghLog },
  encoding: 'utf8',
});
const pool = JSON.parse(poolOut);
assert.equal(pool.length, 3, 'pool = every bullet already reviewed into profile.json');
assert.ok(pool.every(bullet => bullet.id.length === 8 && bullet.text && bullet.origin));
assert.equal(pool.filter(bullet => bullet.verifiedAt).length, 2, 'provenance fields survive into the pool');
for (const job of synced.added) {
  execFileSync(process.execPath, [campaignCli, 'select', '--data-dir', dataDir, '--id', job.id,
    '--bullets', `${pool[0].id},${pool[2].id}`], {
    env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, COFORCE_GH_LOG: ghLog },
    stdio: 'pipe',
  });
  const matched = campaignView(dataDir).jobs.find(item => item.id === job.id);
  assert.equal(matched.status, 'matched');
  assert.deepEqual(matched.evidenceIds, [pool[0].id, pool[2].id], 'selection recorded as bullet ids');
  assert.equal(matched.match.mode, 'selection');
  assert.equal(matched.match.bullets[0].text, pool[0].text, 'selected bullets are verbatim pool text');
  const staged = stageArtifacts(dataDir, job.id, { tex, pdf });
  assert.equal(staged.status, 'rendered', 'default mode waits for manual review');
  assert.equal(staged.approvalMode, null);
}
assert.throws(
  () => selectBullets(dataDir, synced.added[0].id, [pool[0].id, 'deadbeef']),
  /outside the verified pool/,
  'out-of-pool bullet ids must be rejected — fabrication is structurally impossible'
);
assert.equal(existsSync(ghLog), false, 'selection must never invoke gh');
assert.equal(statSync(libraryPath).mtimeMs, libraryBefore.mtimeMs, 'campaign must not rewrite experience sources');

// judge: verbatim metric against the selection, and the auto-approve gate
{
  const jobView = campaignView(dataDir).jobs.find(item => item.id === synced.added[0].id);
  const jobTexDir = join(dataDir, 'campaigns', 'current', 'jobs', jobView.folder);
  writeFileSync(join(jobTexDir, 'resume.tex'),
    `\\documentclass{article}\\begin{document}\\newcommand{\\resumeItem}[1]{#1}\n\\resumeItem{${pool[0].text}}\n\\end{document}\n`);
  const good = judgeResume(dataDir, synced.added[0].id);
  assert.equal(good.verbatim, true, 'pool bullet verbatim passes the judge');
  assert.equal(good.itemCount, 1);
  if (good.pageCount !== null) assert.equal(good.onePage, true, 'fixture pdf is one page');
  if (good.fullness !== null) assert.equal(good.fullPage, true, 'fixture pdf fills the page');
  // a one-page resume that leaves the bottom half empty must FAIL the judge
  writeFileSync(join(jobTexDir, 'resume.pdf'), onePagePdf('sparse fixture', false));
  const sparse = judgeResume(dataDir, synced.added[0].id);
  if (sparse.fullness !== null) {
    assert.equal(sparse.fullPage, false, 'a half-empty page fails the fullness metric');
  }
  writeFileSync(join(jobTexDir, 'resume.pdf'), onePagePdf('CoForce campaign fixture'));
  writeFileSync(join(jobTexDir, 'resume.tex'),
    '\\documentclass{article}\\begin{document}\\newcommand{\\resumeItem}[1]{#1}\n\\resumeItem{Invented a claim that is not in the pool}\n\\end{document}\n');
  const bad = judgeResume(dataDir, synced.added[0].id);
  assert.equal(bad.verbatim, false, 'out-of-pool resume line fails the judge');
  assert.equal(bad.unknownLines.length, 1);
  stageArtifacts(dataDir, synced.added[0].id, { tex, pdf });
  judgeResume(dataDir, synced.added[0].id); // restore a clean judge for the flow below
}

const first = synced.added[0];
addFeedback(dataDir, first.id, 'Lead with the retry and observability work.');
assert.equal(campaignView(dataDir).jobs.find(job => job.id === first.id).status, 'revision_requested');
stageArtifacts(dataDir, first.id, { tex, pdf });
approveJob(dataDir, first.id);
assert.equal(campaignView(dataDir).jobs.find(job => job.id === first.id).approvalMode, 'manual');
assert.throws(() => exportCampaign(dataDir), /All resumes must be approved/);
approveJob(dataDir, synced.added[1].id);

const exported = exportCampaign(dataDir);
const listing = execFileSync('/usr/bin/unzip', ['-Z1', exported.path], { encoding: 'utf8' }).trim().split('\n');
assert.ok(listing.includes('manifest.json'));
for (const job of campaignView(dataDir).jobs) {
  for (const name of ['resume.pdf', 'resume.tex', 'job-description.md', 'job.json', 'match-report.md']) {
    assert.ok(listing.includes(`${job.folder}/${name}`), `archive missing ${job.folder}/${name}`);
  }
}
assert.equal(campaignView(dataDir).allApproved, true);
assert.ok(readFileSync(exported.path).length > 1000);
assert.equal(resolveCampaignFile(dataDir, '../applications.json'), null, 'traversal blocked');

const autoDir = mkdtempSync(join(tmpdir(), 'coforce-campaign-auto-'));
const autoJd = join(autoDir, 'job-description.md');
const autoMatch = join(autoDir, 'match-report.md');
writeFileSync(autoJd, '# Job description\n\nGrounded fixture role.\n');
writeFileSync(autoMatch, '# Match report\n\nEvidence: fixture.\n');
const autoFirst = syncJobs(autoDir, [{
  id: 'auto-1', company: 'Auto Labs', role: 'Engineer', url: 'https://jobs.example/auto-1',
}]).added[0];
stageArtifacts(autoDir, autoFirst.id, { jd: autoJd, match: autoMatch, tex, pdf });
assert.equal(campaignView(autoDir).jobs[0].status, 'rendered');
assert.equal(campaignView(autoDir).lastExport, null);
writeFileSync(join(autoDir, 'apply-config.json'), JSON.stringify({ requireResumeReview: false }));
const autoView = campaignView(autoDir).jobs[0];
// auto-approval demands a recorded PASSING llm verdict — absent blocks first
const preVerdict = applyResumeReviewPolicy(autoDir);
assert.equal(preVerdict.autoApproved, 0, 'no recorded llm verdict, no automatic approval');
writeFileSync(join(autoDir, 'campaigns', 'current', 'jobs', autoView.folder, 'llm-judge.json'),
  JSON.stringify({ judgedAt: 'fixture', runs: 1, medianTotal: 92, pass: true, fixes: [] }));
const reconciled = applyResumeReviewPolicy(autoDir);
assert.equal(reconciled.autoApproved, 1, 'disabling review reconciles a complete rendered resume');
assert.ok(reconciled.exported?.path, 'disabling review auto-exports a completed campaign');
assert.equal(campaignView(autoDir).jobs[0].approvalMode, 'automatic');
assert.equal(campaignView(autoDir).reviewRequired, false);

// a failed judge metric must block auto-approval even with review disabled
const gateDir = mkdtempSync(join(tmpdir(), 'coforce-campaign-gate-'));
const gateJob = syncJobs(gateDir, [{ id: 'gate-1', company: 'Gate Labs', role: 'Engineer', url: 'https://jobs.example/gate-1' }]).added[0];
stageArtifacts(gateDir, gateJob.id, { jd: autoJd, match: autoMatch, tex, pdf });
const gateView = campaignView(gateDir).jobs[0];
const gateJobDir = join(gateDir, 'campaigns', 'current', 'jobs', gateView.folder);
writeFileSync(join(gateJobDir, 'match.json'), JSON.stringify({ bullets: [{ text: 'Real bullet' }] }));
writeFileSync(join(gateJobDir, 'resume.tex'),
  '\\documentclass{article}\\begin{document}\\newcommand{\\resumeItem}[1]{#1}\n\\resumeItem{Fabricated line}\n\\end{document}\n');
writeFileSync(join(gateDir, 'apply-config.json'), JSON.stringify({ requireResumeReview: false }));
writeFileSync(join(gateJobDir, 'llm-judge.json'),
  JSON.stringify({ judgedAt: 'fixture', runs: 1, medianTotal: 95, pass: true, fixes: [] }));
const gated = applyResumeReviewPolicy(gateDir);
assert.equal(gated.autoApproved, 0, 'failed verbatim metric blocks auto-approval even with a passing llm verdict');
assert.equal(campaignView(gateDir).jobs[0].status, 'rendered', 'job stays in review instead of shipping');

const autoSecond = syncJobs(autoDir, [{
  id: 'auto-2', company: 'Auto Labs', role: 'Platform Engineer', url: 'https://jobs.example/auto-2',
}]).added[0];
const autoStaged = stageArtifacts(autoDir, autoSecond.id, { jd: autoJd, match: autoMatch, tex, pdf });
assert.equal(autoStaged.status, 'rendered', 'auto mode still waits for the mandatory llm verdict');
const autoSecondView = campaignView(autoDir).jobs.find(job => job.id === autoSecond.id);
writeFileSync(join(autoDir, 'campaigns', 'current', 'jobs', autoSecondView.folder, 'llm-judge.json'),
  JSON.stringify({ judgedAt: 'fixture', runs: 1, medianTotal: 90, pass: true, fixes: [] }));
applyResumeReviewPolicy(autoDir);
const autoSecondDone = campaignView(autoDir).jobs.find(job => job.id === autoSecond.id);
assert.equal(autoSecondDone.status, 'approved', 'verdict recorded → reconcile approves');
assert.equal(autoSecondDone.approvalMode, 'automatic');
assert.equal(campaignView(autoDir).lastExport.jobCount, 2, 'the final auto-approved job refreshes the ZIP');

console.log('campaign: two JD matches + zero GitHub scans + optional HITL + ZIP ✓');
