// Deterministic campaign pipeline: jobs + JD + verified bullet pool → strict selection → review → approved ZIP.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  addFeedback,
  assembleResume,
  bulletPool,
  judgeResume,
  recordLlmJudge,
  renderResume,
  selectBullets,
  applyResumeReviewPolicy,
  approveJob,
  bulletOutcomes,
  campaignView,
  exportCampaign,
  htmlToText,
  hydrateJob,
  resolveCampaignFile,
  resumePageCoverageMinimumPercent,
  resumeReviewRequired,
  skillPool,
  skillReview,
  stageArtifacts,
  syncSelectedSkillsToResume,
  syncTemplateContractToResume,
  syncJobs,
} from '../.agents/skills/campaign/scripts/campaign-lib.mjs';
import { aggregateLlmJudgeRuns, LLM_JUDGE_SCHEMA, validateLlmJudge } from '../.agents/skills/campaign/scripts/llm-judge.mjs';
import {
  buildExperienceIndex,
  experiencePaths,
  upsertSource,
} from '../.agents/skills/experience/scripts/experience-lib.mjs';
import { resolveProfileContact } from '../.agents/lib/profile-contact.mjs';
import { onePagePdf, twoPagePdf } from './pdf-fixture.mjs';

const dataDir = process.env.COFORCE_CAMPAIGN_DIR || mkdtempSync(join(tmpdir(), 'coforce-campaign-'));
const llmVerdict = ({ total = 90, presentation = 18, jdFit = 8, deductions = 8, actionableDeductions = 2, criticalFixes = [] } = {}) => {
  const pass = presentation >= 16 && jdFit >= 7 && actionableDeductions <= 3 && criticalFixes.length === 0;
  return {
    schemaVersion: LLM_JUDGE_SCHEMA,
    judgedAt: '2026-08-06T00:00:00.000Z',
    runs: 1,
    medianTotal: total,
    gate: { presentation, jdFit, actionableDeductions, criticalFixes },
    pass,
    fixes: [],
    verdicts: [{
      substance: {},
      presentation: { score: presentation, max: 20, notes: 'fixture' },
      jd_fit: { score: jdFit, max: 10, note: 'fixture' },
      bonus: { total: 0, breakdown: [] },
      deductions: { total: deductions, reasons: [] },
      actionable_deductions: { total: actionableDeductions, reasons: [] },
      total,
      key_strengths: [],
      fixes: [],
    }],
  };
};
assert.equal(validateLlmJudge(llmVerdict()).pass, true);
{
  const runs = [
    llmVerdict({ total: 70, presentation: 14, jdFit: 5, actionableDeductions: 0 }),
    llmVerdict({ total: 72, presentation: 15, jdFit: 6, actionableDeductions: 1 }),
    llmVerdict({ total: 90, presentation: 18, jdFit: 8, actionableDeductions: 2 }),
  ];
  const aggregated = aggregateLlmJudgeRuns(runs);
  assert.equal(aggregated.runs, 3);
  assert.equal(aggregated.medianTotal, 72);
  assert.deepEqual(aggregated.gate, {
    presentation: 15,
    jdFit: 6,
    actionableDeductions: 1,
    criticalFixes: [],
  });
  assert.equal(aggregated.pass, false);
}
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
  email: 'test@example.com',
  phone: '614-000-0000',
  localizedContacts: {
    'zh-CN': { email: 'cn@example.com', phone: '18900000000' },
  },
  skills: ['TypeScript', 'Node.js', 'Python'],
  resumeSkillPolicy: {
    status: 'approved',
    baseline: ['TypeScript'],
    rolePacks: {
      backend: ['Node.js'],
    },
    reviewedAt: '2026-07-01T00:00:00.000Z',
  },
  verifiedSkills: [
    {
      name: 'TypeScript',
      category: 'Programming Languages',
      source: 'https://github.com/example/product/pull/42',
      evidenceIds: ['product:pr:repo:42'],
      verifiedAt: '2026-07-01',
    },
    {
      name: 'Node.js',
      category: 'Backend & APIs',
      source: 'https://github.com/example/product/pull/42',
      evidenceIds: ['product:pr:repo:42'],
      verifiedAt: '2026-07-01',
    },
  ],
  experience: [{
    company: 'Product Inc', title: 'Backend Engineer', date: '2025 - Present', location: 'Remote',
    localized: {
      'zh-CN': { company: '产品公司', title: '后端工程师', date: '2025年 - 至今', location: '远程' },
    },
    description: [
      { text: 'Built reliable TypeScript agent API retries with observability and regression tests', textZh: '构建具备可观测性和回归测试的可靠 TypeScript Agent API 重试机制', source: 'https://github.com/example/product/pull/42', verifiedAt: '2026-07-01' },
      { text: 'Migrated data storage schema with zero-downtime migration tooling', textZh: null, source: 'https://github.com/example/product/commit/abc', verifiedAt: '2026-07-01' },
    ],
  }],
  projects: [{
    name: 'CoForce', role: 'Open Source Project', dateRange: '2026', url: 'https://github.com/example/coforce',
    localized: { 'zh-CN': { name: 'CoForce', role: '开源项目', dateRange: '2026年' } },
    description: [{
      text: 'Designed a two-gate apply pipeline with a verified bullet pool',
      textZh: '设计具备审核门和可信经历池的双阶段申请流程',
    }],
  }],
  education: [{
    institution: 'Example University', degree: 'B.S. Computer Science', date: '2022 - 2026', location: 'Example City',
    localized: { 'zh-CN': { institution: '示例大学', degree: '计算机科学学士', date: '2022年 - 2026年', location: '示例市' } },
  }],
}, null, 2));
const fixtureProfile = JSON.parse(readFileSync(join(dataDir, 'profile.json'), 'utf8'));
assert.deepEqual(resolveProfileContact(fixtureProfile, 'zh'), {
  language: 'zh-CN', email: 'cn@example.com', phone: '18900000000',
});
assert.deepEqual(resolveProfileContact(fixtureProfile, 'en-US'), {
  language: 'en-US', email: 'test@example.com', phone: '614-000-0000',
});

// The bundled setup template is a fillable source. Normalizing its static
// contract must materialize profile fields, never copy raw placeholders back
// over the assembled resume header.
{
  const placeholderDir = mkdtempSync(join(tmpdir(), 'coforce-template-placeholders-'));
  const templateDir = join(placeholderDir, 'templates');
  mkdirSync(templateDir, { recursive: true });
  const templatePath = join(templateDir, 'resume_template.tex');
  const rawTemplate = [
    '\\documentclass{article}',
    '\\newcommand{\\resumeItem}[2]{#2}',
    '\\begin{document}',
    '\\begin{center}',
    '\\textbf{\\Huge \\scshape {name}}\\\\',
    '\\small',
    '\\href{sms:{phone}}{{phone}} $|$',
    '\\href{mailto:{email}}{{email}}',
    '\\end{center}',
    '\\section{Skills}',
    '\\resumeHeadingSkillStart',
    '\\resumeSubItem{Languages:}{Node.js}',
    '\\resumeHeadingSkillEnd',
    '\\section{Projects}',
    '\\resumeSubHeadingListStart',
    '\\resumeSubheading{One}{}{}{}',
    '\\resumeItem{}{Built a thing}',
    '\\resumeSubHeadingListEnd',
    '\\end{document}',
    '',
  ].join('\n');
  writeFileSync(templatePath, rawTemplate);
  writeFileSync(join(placeholderDir, 'config.json'), JSON.stringify({ latexTemplate: templatePath }));
  writeFileSync(join(placeholderDir, 'profile.json'), JSON.stringify({
    name: 'Real Candidate', email: 'real@example.com', phone: '1234567890',
  }));
  const placeholderJob = syncJobs(placeholderDir, [{
    url: 'https://jobs.example/placeholders', company: 'Template Co', role: 'Engineer',
  }]).added[0];
  const placeholderJobDir = join(
    placeholderDir, 'campaigns', 'current', 'jobs', placeholderJob.folder,
  );
  writeFileSync(join(placeholderJobDir, 'resume.tex'), rawTemplate
    .replace('{name}', 'Real Candidate')
    .replaceAll('{email}', 'real@example.com')
    .replaceAll('{phone}', '1234567890'));
  syncTemplateContractToResume(placeholderDir, placeholderJob.id, 'en-US');
  const normalized = readFileSync(join(placeholderJobDir, 'resume.tex'), 'utf8');
  assert.match(normalized, /Real Candidate/);
  assert.match(normalized, /real@example\.com/);
  assert.match(normalized, /1234567890/);
  assert.doesNotMatch(normalized, /\{(?:name|email|phone)\}/,
    'template normalization never restores raw profile placeholders');
}
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
writeFileSync(tex, [
  '\\documentclass{article}',
  '\\newcommand{\\resumeSubItem}[2]{#1 #2}',
  '\\begin{document}',
  '\\section{\\textbf{Skills}}',
  '\\resumeSubItem{Languages, Frameworks, Backend \\& Data:}{TypeScript, Node.js, Python}',
  'Grounded fixture',
  '\\end{document}',
  '',
].join('\n'));
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
assert.equal(pool[0].textZh, '构建具备可观测性和回归测试的可靠 TypeScript Agent API 重试机制', 'Chinese translation survives into the pool');
assert.equal(pool[1].textZh, null, 'nullable Chinese translation remains null');
const skillsOut = execFileSync(process.execPath, [campaignCli, 'skills', '--data-dir', dataDir], {
  env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, COFORCE_GH_LOG: ghLog },
  encoding: 'utf8',
});
const skills = JSON.parse(skillsOut);
assert.equal(skills.length, 3, 'campaign merges all resume-attested skills with evidence enrichments');
assert.ok(skills.slice(0, 2).every(skill =>
  skill.id.length === 8 &&
  skill.name &&
  skill.category &&
  skill.source &&
  skill.evidenceIds.length
), 'verified skills preserve category and Tier 0 provenance');
assert.equal(skills.find(skill => skill.name === 'Python').attested, true);
assert.equal(skills.find(skill => skill.name === 'Python').evidenceBacked, false);
assert.deepEqual(skills.find(skill => skill.name === 'TypeScript').origins, ['resume', 'experience']);
assert.equal(skills.find(skill => skill.name === 'TypeScript').baseline, true);
assert.deepEqual(skills.find(skill => skill.name === 'Node.js').rolePacks, ['backend']);
assert.equal(skillReview(dataDir).status, 'approved');
{
  const profilePath = join(dataDir, 'profile.json');
  const approvedProfile = JSON.parse(readFileSync(profilePath, 'utf8'));
  writeFileSync(profilePath, JSON.stringify({
    ...approvedProfile,
    resumeSkillPolicy: { ...approvedProfile.resumeSkillPolicy, status: 'review_requested' },
  }, null, 2));
  assert.equal(skillReview(dataDir).status, 'review_requested');
  assert.throws(
    () => selectBullets(
      dataDir,
      synced.added[0].id,
      [pool[0].id],
      skills.map(skill => skill.id),
      'backend',
    ),
    /skill policy is review_requested/,
    'campaign selection waits for explicit human approval of baseline and role packs'
  );
  writeFileSync(profilePath, JSON.stringify(approvedProfile, null, 2));
}
writeFileSync(
  join(dataDir, 'campaigns', 'current', 'jobs', synced.added[0].folder, 'job-description.md'),
  '负责智能体平台、前向部署与客户交付，构建可靠后端服务并完善测试与可观测性。'.repeat(4),
);
for (const [jobIndex, job] of synced.added.entries()) {
  const resumeLanguage = jobIndex === 0 ? 'zh-CN' : 'en-US';
  execFileSync(process.execPath, [campaignCli, 'select', '--data-dir', dataDir, '--id', job.id,
    '--bullets', `${pool[0].id},${pool[2].id}`,
    '--skills', skills.map(skill => skill.id).join(','),
    '--skill-pack', 'backend'], {
    env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, COFORCE_GH_LOG: ghLog },
    stdio: 'pipe',
  });
  const matched = campaignView(dataDir).jobs.find(item => item.id === job.id);
  assert.equal(matched.status, 'matched');
  assert.deepEqual(matched.evidenceIds, [pool[0].id, pool[2].id], 'selection recorded as bullet ids');
  assert.deepEqual(matched.selectedSkillIds, skills.map(skill => skill.id), 'selection records eligible skill ids');
  assert.equal(matched.match.mode, 'selection');
  assert.equal(matched.match.bullets[0].text, pool[0].text, 'selected bullets are verbatim pool text');
  assert.equal(matched.match.bullets[0].textZh, pool[0].textZh, 'selected bullets preserve Chinese translations');
  assert.deepEqual(matched.match.skills.map(skill => skill.name), ['TypeScript', 'Node.js', 'Python']);
  assert.equal(matched.match.skills[0].source, 'https://github.com/example/product/pull/42');
  assert.equal(matched.selectedSkillPack, 'backend');
  assert.equal(matched.match.selectedRolePack, 'backend');
  assert.deepEqual(matched.match.experienceSnapshot, {
    generatedAt: index.generatedAt,
    sourceFingerprint: index.sourceFingerprint,
  });
  assert.equal(matched.resumeLanguage, resumeLanguage);
  assert.equal(matched.match.resumeLanguage, resumeLanguage);
  assert.deepEqual(matched.match.skillComposition, {
    total: 3,
    baseline: 1,
    rolePack: 1,
    jdExtras: 1,
  });
  // The synthetic PDF fixture has a Latin-only text layer. Exercise the
  // manual-review transition with the English selection here; the real
  // Tectonic E2E below covers the Chinese assembler and extracted CJK text.
  if (resumeLanguage === 'en-US') {
    writeFileSync(tex, [
      '\\documentclass{article}',
      '\\newcommand{\\resumeItem}[2]{#2}',
      '\\newcommand{\\resumeSubItem}[2]{#1 #2}',
      '\\begin{document}',
      '\\section{\\textbf{Skills}}',
      '\\resumeSubItem{Relevant Skills:}{TypeScript, Node.js, Python}',
      `\\resumeItem{}{${pool[0].text}}`,
      `\\resumeItem{}{${pool[2].text}}`,
      '\\end{document}',
      '',
    ].join('\n'));
    writeFileSync(pdf, onePagePdf(`${pool[0].text} ${pool[2].text}`, true, 8));
    const staged = stageArtifacts(dataDir, job.id, { tex, pdf });
    assert.equal(staged.status, 'rendered', 'default mode waits for manual review');
    assert.equal(staged.approvalMode, null);
  }
}
assert.throws(
  () => selectBullets(dataDir, synced.added[0].id, [pool[0].id, 'deadbeef']),
  /outside the verified pool/,
  'out-of-pool bullet ids must be rejected — fabrication is structurally impossible'
);
assert.throws(
  () => selectBullets(dataDir, synced.added[0].id, [pool[0].id], [skills[0].id, 'deadbeef']),
  /skills outside the eligible pool/,
  'out-of-pool skill ids must be rejected — keyword fabrication is structurally impossible'
);
assert.throws(
  () => selectBullets(
    dataDir,
    synced.added[0].id,
    [pool[0].id],
    [skills.find(skill => skill.name === 'TypeScript').id,
      skills.find(skill => skill.name === 'Python').id],
    'backend',
  ),
  /omits mandatory skills/,
  'baseline and the selected role pack are mandatory before JD extras'
);
assert.equal(existsSync(ghLog), false, 'selection must never invoke gh');
assert.equal(statSync(libraryPath).mtimeMs, libraryBefore.mtimeMs, 'campaign must not rewrite experience sources');

// Real render E2E: the same deterministic assembler and machine judge must
// compile both languages, then recover every selected bullet from the PDF text
// layer. CI installs Tectonic + Noto CJK; developer machines without a compiler
// still run the rest of the dependency-free contract harness.
let hasTectonic = true;
try {
  execFileSync('/usr/bin/which', ['tectonic'], { stdio: 'ignore' });
} catch {
  hasTectonic = false;
}
if (hasTectonic) {
  const realDir = mkdtempSync(join(tmpdir(), 'coforce-real-resume-'));
  writeFileSync(join(realDir, 'profile.json'), JSON.stringify(fixtureProfile, null, 2));
  writeFileSync(join(realDir, 'config.json'), JSON.stringify({
    latexTemplate: resolve('harness/fixtures/resume-template.tex'),
    resumeCjkFont: process.platform === 'darwin' ? 'Songti SC' : 'Noto Serif CJK SC',
    resumePageCoverageMinimumPercent: 0,
    requireResumeReview: true,
  }, null, 2));
  const realJobs = syncJobs(realDir, [
    { id: 'real-en', company: 'Render Labs', role: 'Agent Engineer', url: 'https://jobs.example/real-en' },
    { id: 'real-zh', company: '渲染实验室', role: '智能体工程师', url: 'https://jobs.example/real-zh' },
  ]).added;
  const realPool = bulletPool(realDir);
  const realSkills = skillPool(realDir);
  for (const [index, job] of realJobs.entries()) {
    const language = index === 0 ? 'en-US' : 'zh-CN';
    await hydrateJob(realDir, job.id, {
      text: language === 'zh-CN'
        ? '负责智能体后端、可靠交付、测试和可观测性。'.repeat(40)
        : 'Build reliable agent backends, delivery systems, tests, and observability. '.repeat(20),
      source: 'fixture',
    });
    selectBullets(
      realDir,
      job.id,
      [realPool[0].id, realPool[2].id],
      realSkills.map(skill => skill.id),
      'backend',
      language,
    );
    const assembled = assembleResume(realDir, job.id, language);
    assert.equal(assembled.language, language);
    assert.equal(assembled.bulletCount, 2);
    const rendered = renderResume(realDir, job.id, null, language);
    assert.equal(rendered.status, 'rendered');
    const machine = judgeResume(realDir, job.id);
    assert.equal(machine.onePage, true, `${language} real PDF is one page`);
    assert.equal(machine.verbatim, true, `${language} real PDF includes every selected bullet verbatim`);
    assert.equal(machine.skillsVerbatim, true, `${language} real PDF includes every selected skill once`);
    assert.equal(machine.extractable, true, `${language} real PDF preserves ATS text order`);
    const folder = campaignView(realDir).jobs.find(item => item.id === job.id).folder;
    const pdfPath = join(realDir, 'campaigns', 'current', 'jobs', folder, 'resume.pdf');
    const extracted = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' });
    assert.match(extracted, language === 'zh-CN' ? /工作经历/ : /Working Experience/);
    const verdictPath = join(realDir, `${job.id}-llm-judge.json`);
    writeFileSync(verdictPath, JSON.stringify(llmVerdict(), null, 2));
    assert.equal(recordLlmJudge(realDir, job.id, verdictPath).schemaVersion, LLM_JUDGE_SCHEMA);
  }
  console.log('campaign: real English + Chinese LaTeX/PDF/text E2E ✓');
} else {
  console.log('SKIP: tectonic not installed (CI runs the real bilingual PDF E2E)');
}

// judge: verbatim metric against the selection, and the auto-approve gate
{
  const jobView = campaignView(dataDir).jobs.find(item => item.id === synced.added[0].id);
  const jobTexDir = join(dataDir, 'campaigns', 'current', 'jobs', jobView.folder);
  const fixtureTemplatePath = join(dataDir, 'fixture-template.tex');
  const fixtureTemplate =
    `\\documentclass{article}\n\\newcommand{\\resumeItem}[2]{\\textbf{#1}#2}\n\\begin{document}\n` +
    `\\small\n\\href{sms:614-000-0000}{614-000-0000} $|$\n` +
    `\\href{mailto:test@example.com}{test@example.com}\n` +
    `\\vspace{-8mm}\n` +
    `\\section{\\textbf{Skills}}\\resumeSubItem{Languages, Frameworks, Backend \\& Data:}{TypeScript, Node.js, Python}\n` +
    `\\section{\\textbf{Projects}}\n` +
    `\\resumeSubHeadingListStart\n\\resumeSubheading{First}{}{}{}\n` +
    `\\resumeItem{}{template placeholder}\n\\resumeSubHeadingListEnd\n` +
    `\\vspace{-9mm}\n\\resumeSubHeadingListStart\n\\vspace{-1mm}\n` +
    `\\resumeSubheading{Second}{}{}{}\n\\resumeSubHeadingListEnd\n` +
    `\\vspace{-9mm}\n\\end{document}\n`;
  writeFileSync(fixtureTemplatePath, fixtureTemplate);
  const conflictingLegacyTemplatePath = join(dataDir, 'legacy-template.tex');
  writeFileSync(
    conflictingLegacyTemplatePath,
    fixtureTemplate.replace('test@example.com', 'legacy@example.com')
  );
  writeFileSync(join(dataDir, 'apply-config.json'), JSON.stringify({
    latexTemplate: conflictingLegacyTemplatePath,
  }));
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
    latexTemplate: fixtureTemplatePath,
    requireResumeReview: true,
  }));
  const driftedResume =
    fixtureTemplate
      .replace('\\textbf{#1}#2', '#1#2')
      .replace('test@example.com', 'visa status')
      .replace('Skills', '专业技能')
      .replace('Projects', '项目经历')
      .replace('-8mm', '-6mm')
      .replaceAll('-9mm', '-6mm')
      .replace('\\resumeSubHeadingListStart\n\\resumeSubheading{First}',
        '\\resumeSubHeadingListStart\n\\vspace{-4mm}\n\\resumeSubheading{First}')
      .replace(
        '\\resumeItem{}{template placeholder}',
        `\\resumeItem{${pool[0].textZh}}{}\n\\resumeItem{}{${pool[2].textZh}}`,
      );
  writeFileSync(join(jobTexDir, 'resume.tex'), driftedResume);
  writeFileSync(join(jobTexDir, 'resume.pdf'), onePagePdf('CoForce campaign fixture'));
  const normalizedTemplate = syncTemplateContractToResume(dataDir, synced.added[0].id);
  assert.equal(normalizedTemplate.updated, true);
  assert.equal(normalizedTemplate.templatePreambleExact, true);
  assert.equal(normalizedTemplate.templateContactHeaderExact, true);
  assert.equal(normalizedTemplate.skillsSectionSpacingExact, true);
  assert.equal(normalizedTemplate.projectEntryScaffoldingExact, true);
  assert.equal(normalizedTemplate.projectTransitionSpacingExact, true);
  assert.equal(normalizedTemplate.projectTailSpacingExact, true);
  assert.equal(normalizedTemplate.resumeItemsUseBodyArgument, true);
  const normalizedFixtureTex = readFileSync(join(jobTexDir, 'resume.tex'), 'utf8');
  assert.match(normalizedFixtureTex, /\\href\{sms:18900000000\}\{18900000000\}/,
    'the localized phone is applied even when it is on a separate template line');
  assert.match(normalizedFixtureTex, /\\href\{mailto:cn@example\.com\}\{cn@example\.com\}/,
    'the localized email is applied from the same profile override');
  assert.match(normalizedFixtureTex, /\\vspace\{-8mm\}\n\\section\{\\textbf\{专业技能\}\}/,
    'config.json remains the only template source for localized section spacing');
  const good = judgeResume(dataDir, synced.added[0].id);
  assert.equal(good.verbatim, true, 'pool bullet verbatim passes the judge');
  assert.equal(good.resumeItemsUseBodyArgument, true, 'resume bullets use the non-bold body argument');
  assert.equal(good.skillsVerbatim, true, 'selected skills rendered verbatim pass the judge');
  assert.equal(good.renderedSkillGroupCount, 1);
  assert.equal(good.renderedSkillCount, 3);
  assert.equal(good.itemCount, 2);
  if (good.pageCount !== null) assert.equal(good.onePage, true, 'fixture pdf is one page');
  if (good.fullness !== null) assert.equal(good.fullPage, true, 'fixture pdf fills the page');
  assert.equal(good.minimumPageCoveragePercent, 93, 'page coverage defaults to 93%');
  const configured = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8'));
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
    ...configured,
    resumePageCoverageMinimumPercent: 96,
  }));
  assert.equal(resumePageCoverageMinimumPercent(dataDir), 96);
  const strictCoverage = judgeResume(dataDir, synced.added[0].id);
  assert.equal(strictCoverage.minimumPageCoverage, 0.96);
  if (strictCoverage.fullness !== null && strictCoverage.fullness < 0.96) {
    assert.equal(strictCoverage.fullPage, false, 'the configured 96% threshold is enforced');
    assert.deepEqual(strictCoverage.issues, [{
      code: 'page_coverage_insufficient',
      actualPercent: Math.round(strictCoverage.fullness * 1000) / 10,
      minimumPercent: 96,
    }], 'coverage failure exposes a machine-readable revision option');
    assert.throws(
      () => approveJob(dataDir, synced.added[0].id),
      /page coverage .* below the 96% minimum/,
      'manual approval cannot bypass the configured coverage minimum'
    );
  }
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
    ...configured,
    resumePageCoverageMinimumPercent: 93,
  }));
  const englishJob = campaignView(dataDir).jobs.find(item => item.id === synced.added[1].id);
  const englishJobTexDir = join(dataDir, 'campaigns', 'current', 'jobs', englishJob.folder);
  judgeResume(dataDir, englishJob.id);
  writeFileSync(join(englishJobTexDir, 'resume.tex'),
    `\\documentclass{article}\\begin{document}\\newcommand{\\resumeItem}[2]{#2}\n` +
    `\\section{\\textbf{Skills}}\\resumeSubItem{Languages, Frameworks, Backend \\& Data:}{TypeScript, Node.js, Python}\n` +
    `\\resumeItem{}{${pool[0].text}}\n\\end{document}\n`);
  // a one-page resume that leaves the bottom half empty must FAIL the judge
  writeFileSync(join(englishJobTexDir, 'resume.pdf'), onePagePdf('sparse fixture', false));
  const sparse = judgeResume(dataDir, englishJob.id);
  if (sparse.fullness !== null) {
    assert.equal(sparse.fullPage, false, 'a half-empty page fails the fullness metric');
  }
  writeFileSync(join(englishJobTexDir, 'resume.pdf'), onePagePdf('CoForce campaign fixture'));
  writeFileSync(join(englishJobTexDir, 'resume.tex'),
    '\\documentclass{article}\\begin{document}\\newcommand{\\resumeItem}[2]{#2}\n' +
    '\\section{\\textbf{Skills}}\\resumeSubItem{Programming Languages:}{TypeScript, InventedDB}\\resumeSubItem{Backend \\& APIs:}{Node.js}\n' +
    '\\resumeItem{}{Invented a claim that is not in the pool}\n\\end{document}\n');
  const bad = judgeResume(dataDir, englishJob.id);
  assert.equal(bad.verbatim, false, 'out-of-pool resume line fails the judge');
  assert.equal(bad.skillsVerbatim, false, 'out-of-pool resume skill fails the judge');
  assert.deepEqual(bad.unknownSkills, ['InventedDB']);
  assert.equal(bad.unknownLines.length, 1);
  // ATS parseability: every ATS starts from the PDF text layer, so a bullet
  // that does not survive extraction, in order, is a bullet no screener sees.
  writeFileSync(join(englishJobTexDir, 'resume.tex'),
    '\\documentclass{article}\\begin{document}\\newcommand{\\resumeItem}[2]{#2}\n' +
    `\\resumeItem{}{${pool[0].text}}\n\\end{document}\n`);
  writeFileSync(join(englishJobTexDir, 'resume.pdf'), onePagePdf(pool[0].text, true, 12));
  const extracted = judgeResume(dataDir, englishJob.id);
  if (extracted.extractable !== null) {
    assert.equal(extracted.extractable, true, 'a bullet present in the PDF text layer extracts');
    assert.deepEqual(extracted.unextractedLines, []);
  }
  // an ATS-hostile render: the page reads fine to a human, the text layer does
  // not carry the bullet at all (outlined glyphs, scrambled columns)
  writeFileSync(join(englishJobTexDir, 'resume.pdf'), onePagePdf('glyphs without a text layer'));
  const opaque = judgeResume(dataDir, englishJob.id);
  if (opaque.extractable !== null) {
    assert.equal(opaque.extractable, false, 'a bullet missing from the text layer fails the judge');
    assert.equal(opaque.unextractedLines.length, 1);
  }
  const assembledEnglish = assembleResume(dataDir, englishJob.id, 'en-US');
  syncTemplateContractToResume(dataDir, englishJob.id, 'en-US');
  writeFileSync(tex, readFileSync(assembledEnglish.path, 'utf8'));
  const englishPdfText = `${pool[0].text} ${pool[2].text}`;
  writeFileSync(pdf, twoPagePdf(englishPdfText, true, 8));
  const twoPageStage = stageArtifacts(dataDir, englishJob.id, { tex, pdf });
  assert.equal(twoPageStage.status, 'revision_requested', 'a two-page staged PDF never reaches Review');
  assert.throws(
    () => approveJob(dataDir, englishJob.id),
    /exactly one page/,
    'manual approval cannot bypass the shared machine gate'
  );
  writeFileSync(pdf, onePagePdf(englishPdfText, true, 8));
  const restored = stageArtifacts(dataDir, englishJob.id, { tex, pdf });
  assert.equal(restored.status, 'rendered', 'a clean staged PDF returns to Review');
}

// Saved skill selections replace stale sparse template keywords while the
// surrounding template body remains intact.
{
  const jobView = campaignView(dataDir).jobs.find(item => item.id === synced.added[1].id);
  const jobTexDir = join(dataDir, 'campaigns', 'current', 'jobs', jobView.folder);
  const resumeTex = join(jobTexDir, 'resume.tex');
  writeFileSync(resumeTex, [
    '\\documentclass{article}',
    '\\begin{document}',
    '\\section{\\textbf{Skills}}',
    '\\resumeHeadingSkillStart',
    '\\resumeSubItem{Old:}{SparseSkill}',
    '\\resumeHeadingSkillEnd',
    '\\section{Projects}',
    'Keep this body',
    '\\end{document}',
    '',
  ].join('\n'));
  const syncedSkills = syncSelectedSkillsToResume(dataDir, jobView.id);
  const syncedTex = readFileSync(resumeTex, 'utf8');
  assert.equal(syncedSkills.skills, 3);
  assert.equal(syncedSkills.groups, 1);
  assert.match(syncedTex, /Relevant Skills:.*TypeScript, Node\.js, Python/s);
  assert.doesNotMatch(syncedTex, /SparseSkill/);
  assert.match(syncedTex, /\\section\{Projects\}\nKeep this body/);
  stageArtifacts(dataDir, jobView.id, { tex, pdf });
}

const stageReviewableEnglishFixture = jobId => {
  selectBullets(
    dataDir,
    jobId,
    [pool[0].id, pool[2].id],
    skills.map(skill => skill.id),
    'backend',
    'en-US',
  );
  const assembled = assembleResume(dataDir, jobId, 'en-US');
  syncTemplateContractToResume(dataDir, jobId, 'en-US');
  writeFileSync(tex, readFileSync(assembled.path, 'utf8'));
  writeFileSync(pdf, onePagePdf(`${pool[0].text} ${pool[2].text}`, true, 8));
  return stageArtifacts(dataDir, jobId, { tex, pdf });
};

const first = synced.added[0];
assert.equal(stageReviewableEnglishFixture(first.id).status, 'rendered');
addFeedback(dataDir, first.id, 'Lead with the retry and observability work.');
assert.equal(campaignView(dataDir).jobs.find(job => job.id === first.id).status, 'revision_requested');
assert.equal(stageReviewableEnglishFixture(first.id).status, 'rendered');
approveJob(dataDir, first.id);
assert.equal(campaignView(dataDir).jobs.find(job => job.id === first.id).approvalMode, 'manual');
assert.throws(() => exportCampaign(dataDir), /All resumes must be approved/);
assert.equal(stageReviewableEnglishFixture(synced.added[1].id).status, 'rendered');
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

// Structured coverage feedback stays open until a newer passing judge creates
// the durable proof used to deliver the resume back to Review.
const coverageFeedbackDir = mkdtempSync(join(tmpdir(), 'coforce-coverage-feedback-'));
const coverageFeedbackJob = syncJobs(coverageFeedbackDir, [{
  id: 'coverage-feedback-1',
  company: 'Coverage Labs',
  role: 'Engineer',
  url: 'https://jobs.example/coverage-feedback-1',
}]).added[0];
addFeedback(
  coverageFeedbackDir,
  coverageFeedbackJob.id,
  '',
  'page_coverage_insufficient',
);
addFeedback(
  coverageFeedbackDir,
  coverageFeedbackJob.id,
  '',
  'page_coverage_insufficient',
);
let coverageFeedbackView = campaignView(coverageFeedbackDir).jobs[0];
assert.equal(coverageFeedbackView.status, 'revision_requested');
assert.equal(coverageFeedbackView.feedback.length, 1, 'structured feedback reason is idempotent while open');
assert.equal(coverageFeedbackView.feedback[0].reasonCode, 'page_coverage_insufficient');
assert.equal(coverageFeedbackView.feedback[0].visibility, 'internal');
const coverageFeedbackJobDir = join(
  coverageFeedbackDir, 'campaigns', 'current', 'jobs', coverageFeedbackJob.folder,
);
writeFileSync(join(coverageFeedbackJobDir, 'match.json'), JSON.stringify({
  bullets: [{ text: pool[0].text }, { text: pool[2].text }],
  skills: skills.map(skill => ({ name: skill.name })),
}));
stageArtifacts(coverageFeedbackDir, coverageFeedbackJob.id, { tex, pdf });
coverageFeedbackView = campaignView(coverageFeedbackDir).jobs[0];
assert.equal(coverageFeedbackView.status, 'rendered', 'passing coverage proof delivers the revision back to Review');
assert.equal(coverageFeedbackView.reviewDeliveryProof.pageCoverage.status, 'passed');
assert.equal(coverageFeedbackView.reviewDeliveryProof.pageCoverage.artifact, 'judge.json');
assert.equal(coverageFeedbackView.feedback[0].status, 'resolved');
assert.deepEqual(
  coverageFeedbackView.feedback[0].resolutionEvidence,
  coverageFeedbackView.reviewDeliveryProof.pageCoverage,
  'resolved feedback carries the exact Review delivery proof'
);

const autoDir = mkdtempSync(join(tmpdir(), 'coforce-campaign-auto-'));
const autoJd = join(autoDir, 'job-description.md');
const autoMatch = join(autoDir, 'match-report.md');
writeFileSync(autoJd, '# Job description\n\nGrounded fixture role.\n');
writeFileSync(autoMatch, '# Match report\n\nEvidence: fixture.\n');
const writePassingMatch = (dir, job) => {
  const dirPath = join(dir, 'campaigns', 'current', 'jobs', job.folder);
  writeFileSync(join(dirPath, 'match.json'), JSON.stringify({
    bullets: [{ text: pool[0].text }, { text: pool[2].text }],
    skills: skills.map(skill => ({ name: skill.name })),
  }));
};
const autoFirst = syncJobs(autoDir, [{
  id: 'auto-1', company: 'Auto Labs', role: 'Engineer', url: 'https://jobs.example/auto-1',
}]).added[0];
writePassingMatch(autoDir, autoFirst);
stageArtifacts(autoDir, autoFirst.id, { jd: autoJd, match: autoMatch, tex, pdf });
assert.equal(campaignView(autoDir).jobs[0].status, 'rendered');
assert.equal(campaignView(autoDir).lastExport, null);
writeFileSync(join(autoDir, 'config.json'), JSON.stringify({ requireResumeReview: false }));
const autoView = campaignView(autoDir).jobs[0];
// auto-approval demands a recorded PASSING llm verdict — absent blocks first
const preVerdict = applyResumeReviewPolicy(autoDir);
assert.equal(preVerdict.autoApproved, 0, 'no recorded llm verdict, no automatic approval');
writeFileSync(join(autoDir, 'campaigns', 'current', 'jobs', autoView.folder, 'llm-judge.json'),
  JSON.stringify({ judgedAt: 'fixture', runs: 1, medianTotal: 92, pass: true, fixes: [] }));
const staleVerdict = applyResumeReviewPolicy(autoDir);
assert.equal(staleVerdict.autoApproved, 0, 'legacy LLM judge schema cannot auto-approve');
assert.equal(campaignView(autoDir).jobs[0].llmJudge.valid, false, 'Review exposes stale judge artifacts');
writeFileSync(join(autoDir, 'campaigns', 'current', 'jobs', autoView.folder, 'llm-judge.json'),
  JSON.stringify(llmVerdict({ total: 92 })));
const reconciled = applyResumeReviewPolicy(autoDir);
assert.equal(reconciled.autoApproved, 1, 'disabling review reconciles a complete rendered resume');
assert.ok(reconciled.exported?.path, 'disabling review auto-exports a completed campaign');
assert.equal(campaignView(autoDir).jobs[0].approvalMode, 'automatic');
assert.equal(campaignView(autoDir).reviewRequired, false);

// a failed judge metric must block auto-approval even with review disabled
const gateDir = mkdtempSync(join(tmpdir(), 'coforce-campaign-gate-'));
const gateJob = syncJobs(gateDir, [{ id: 'gate-1', company: 'Gate Labs', role: 'Engineer', url: 'https://jobs.example/gate-1' }]).added[0];
writePassingMatch(gateDir, gateJob);
stageArtifacts(gateDir, gateJob.id, { jd: autoJd, match: autoMatch, tex, pdf });
const gateView = campaignView(gateDir).jobs[0];
const gateJobDir = join(gateDir, 'campaigns', 'current', 'jobs', gateView.folder);
writeFileSync(join(gateJobDir, 'match.json'), JSON.stringify({ bullets: [{ text: 'Real bullet' }] }));
writeFileSync(join(gateJobDir, 'resume.tex'),
  '\\documentclass{article}\\begin{document}\\newcommand{\\resumeItem}[2]{#2}\n\\resumeItem{}{Fabricated line}\n\\end{document}\n');
writeFileSync(join(gateDir, 'config.json'), JSON.stringify({ requireResumeReview: false }));
writeFileSync(join(gateJobDir, 'llm-judge.json'),
  JSON.stringify(llmVerdict({ total: 95 })));
const gated = applyResumeReviewPolicy(gateDir);
assert.equal(gated.autoApproved, 0, 'failed verbatim metric blocks auto-approval even with a passing llm verdict');
assert.equal(campaignView(gateDir).jobs[0].status, 'rendered', 'job stays in review instead of shipping');

const autoSecond = syncJobs(autoDir, [{
  id: 'auto-2', company: 'Auto Labs', role: 'Platform Engineer', url: 'https://jobs.example/auto-2',
}]).added[0];
writePassingMatch(autoDir, autoSecond);
const autoStaged = stageArtifacts(autoDir, autoSecond.id, { jd: autoJd, match: autoMatch, tex, pdf });
assert.equal(autoStaged.status, 'rendered', 'auto mode still waits for the mandatory llm verdict');
const autoSecondView = campaignView(autoDir).jobs.find(job => job.id === autoSecond.id);
writeFileSync(join(autoDir, 'campaigns', 'current', 'jobs', autoSecondView.folder, 'llm-judge.json'),
  JSON.stringify(llmVerdict({ total: 90 })));
applyResumeReviewPolicy(autoDir);
const autoSecondDone = campaignView(autoDir).jobs.find(job => job.id === autoSecond.id);
assert.equal(autoSecondDone.status, 'approved', 'verdict recorded → reconcile approves');
assert.equal(autoSecondDone.approvalMode, 'automatic');
assert.equal(campaignView(autoDir).lastExport.jobCount, 2, 'the final auto-approved job refreshes the ZIP');

// --- outcome feedback: which bullets rode on resumes that got somewhere ---
// The two synced jobs already carry evidenceIds from the selections above.
// Give them tracker outcomes and check the join.
const outcomeJobs = campaignView(dataDir).jobs;
const [advancedJob, rejectedJob] = outcomeJobs;
writeFileSync(join(dataDir, 'applications.json'), JSON.stringify([
  { id: advancedJob.applicationId, url: advancedJob.url, status: 'interviewing' },
  { id: rejectedJob.applicationId, url: rejectedJob.url, status: 'rejected' },
], null, 2));

const outcomes = bulletOutcomes(dataDir);
assert.equal(outcomes.judgedApplications, 2, 'both applications have an outcome');
assert.ok(/reading aid, not evidence/.test(outcomes.caveat), 'a tiny sample says so out loud');
const advancedIds = new Set(advancedJob.evidenceIds);
const rejectedIds = new Set(rejectedJob.evidenceIds);
for (const row of outcomes.bullets) {
  assert.equal(row.advanced, advancedIds.has(row.id) ? 1 : 0, `advanced tally for ${row.id}`);
  assert.equal(row.rejected, rejectedIds.has(row.id) ? 1 : 0, `rejected tally for ${row.id}`);
  assert.ok(row.text, 'every counted bullet resolves back to its pool text');
}
assert.ok(
  outcomes.bullets[0].advanced >= outcomes.bullets.at(-1).advanced,
  'sorted by what advanced'
);
assert.ok(
  outcomes.neverUsed.every(b => !advancedIds.has(b.id) && !rejectedIds.has(b.id)),
  'never-used list excludes everything that shipped'
);
assert.deepEqual(outcomes.detached, [], 'no counted bullet has drifted out of the pool');

// a job whose application never left `pending` contributes nothing
writeFileSync(join(dataDir, 'applications.json'), JSON.stringify([
  { id: advancedJob.applicationId, url: advancedJob.url, status: 'pending' },
], null, 2));
assert.equal(bulletOutcomes(dataDir).judgedApplications, 0, 'unsent applications are not signal');

console.log('campaign: two JD matches + zero GitHub scans + optional HITL + ZIP + outcomes ✓');
