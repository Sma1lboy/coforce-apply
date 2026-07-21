// Deterministic campaign pipeline: jobs + JD + evidence → review → approved ZIP.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  addFeedback,
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

function onePagePdf(label) {
  const safe = label.replace(/[()\\]/g, '');
  const stream = `BT /F1 20 Tf 72 720 Td (${safe}) Tj ET`;
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

const experience = experiencePaths(dataDir);
const libraryPath = experience.library;
mkdirSync(dirname(libraryPath), { recursive: true });
upsertSource(dataDir, { repo: 'example/product', authors: ['candidate'], project: 'Product' });
writeFileSync(join(dataDir, 'profile.json'), JSON.stringify({
  name: 'Candidate',
  skills: ['TypeScript', 'Node.js'],
  experience: [],
  projects: [],
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
for (const job of synced.added) {
  execFileSync(process.execPath, [campaignCli, 'match', '--data-dir', dataDir, '--id', job.id], {
    env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, COFORCE_GH_LOG: ghLog },
    stdio: 'pipe',
  });
  const matched = campaignView(dataDir).jobs.find(item => item.id === job.id);
  assert.ok(matched.matchScore > 0);
  assert.ok(matched.evidenceIds.includes('product:pr:repo:42'));
  assert.ok(matched.evidenceIds.includes('product:commit:repo:abc'));
  assert.ok(matched.evidenceIds.includes('profile:skills'), 'Tier 0 includes curated profile evidence');
  assert.equal(matched.experienceIndexFingerprint, index.sourceFingerprint);
  const staged = stageArtifacts(dataDir, job.id, { tex, pdf });
  assert.equal(staged.status, 'rendered', 'default mode waits for manual review');
  assert.equal(staged.approvalMode, null);
}
assert.equal(existsSync(ghLog), false, 'matching multiple JDs must never invoke gh');
assert.equal(statSync(libraryPath).mtimeMs, libraryBefore.mtimeMs, 'campaign must not rewrite Tier 0 sources');

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
const reconciled = applyResumeReviewPolicy(autoDir);
assert.equal(reconciled.autoApproved, 1, 'disabling review reconciles a complete rendered resume');
assert.ok(reconciled.exported?.path, 'disabling review auto-exports a completed campaign');
assert.equal(campaignView(autoDir).jobs[0].approvalMode, 'automatic');
assert.equal(campaignView(autoDir).reviewRequired, false);

const autoSecond = syncJobs(autoDir, [{
  id: 'auto-2', company: 'Auto Labs', role: 'Platform Engineer', url: 'https://jobs.example/auto-2',
}]).added[0];
const autoStaged = stageArtifacts(autoDir, autoSecond.id, { jd: autoJd, match: autoMatch, tex, pdf });
assert.equal(autoStaged.status, 'approved', 'auto mode approves newly completed resumes');
assert.equal(autoStaged.approvalMode, 'automatic');
assert.equal(campaignView(autoDir).lastExport.jobCount, 2, 'the final auto-approved job refreshes the ZIP');

console.log('campaign: two JD matches + zero GitHub scans + optional HITL + ZIP ✓');
