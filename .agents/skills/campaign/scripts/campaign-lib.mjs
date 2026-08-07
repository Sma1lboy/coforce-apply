// Durable local resume-campaign state for CoForce Apply.
// All personal artifacts live under <dataDir>/campaigns/current (normally
// ~/.coforce/campaigns/current); this module never writes into the repository.

import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { writeJsonAtomic } from '../../../lib/fs-atomic.mjs';
import { loadConfig } from '../../../lib/config.mjs';
import { normalizeResumeLanguage } from '../../../lib/profile-contact.mjs';
import {
  assembleResumeTex,
  escapeResumeText,
  localizedSkillGroups,
  localizeResumeTemplate,
  resumeSectionLabels,
} from './resume-assembly.mjs';
import { aggregateLlmJudgeRuns, llmJudgePasses, validateLlmJudge } from './llm-judge.mjs';

export const CAMPAIGN_SCHEMA = '1.0';
export const REQUIRED_EXPORT_FILES = [
  'resume.pdf',
  'resume.tex',
  'job-description.md',
  'job.json',
  'match-report.md',
];

const now = () => new Date().toISOString();

export const campaignPaths = dataDir => {
  const root = join(dataDir, 'campaigns', 'current');
  return {
    root,
    manifest: join(root, 'manifest.json'),
    jobs: join(root, 'jobs'),
    exports: join(root, 'exports'),
  };
};

const ensureDir = path => {
  mkdirSync(path, { recursive: true });
  return path;
};

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

const removeIfExists = path => {
  if (existsSync(path)) unlinkSync(path);
};

export const DEFAULT_RESUME_PAGE_COVERAGE_MINIMUM_PERCENT = 93;
export const PAGE_COVERAGE_INSUFFICIENT_REASON = 'page_coverage_insufficient';

export const REVIEW_FEEDBACK_REASONS = {
  [PAGE_COVERAGE_INSUFFICIENT_REASON]:
    'Page coverage is below the configured minimum; add relevant reviewed content without changing template spacing.',
};

export const resumePageCoverageMinimumPercent = dataDir => {
  try {
    const raw = loadConfig(dataDir).resumePageCoverageMinimumPercent;
    if (raw === '' || raw === null || raw === undefined) {
      return DEFAULT_RESUME_PAGE_COVERAGE_MINIMUM_PERCENT;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 100
      ? value
      : DEFAULT_RESUME_PAGE_COVERAGE_MINIMUM_PERCENT;
  } catch {
    return DEFAULT_RESUME_PAGE_COVERAGE_MINIMUM_PERCENT;
  }
};

const currentResumeJudge = (dataDir, job) => {
  const dir = jobDir(dataDir, job);
  const path = join(dir, 'judge.json');
  const minimumPageCoveragePercent = resumePageCoverageMinimumPercent(dataDir);
  if (existsSync(path)) {
    try {
      const saved = readJson(path);
      const judgeModifiedAt = statSync(path).mtimeMs;
      const newestInputModifiedAt = ['resume.pdf', 'resume.tex', 'match.json']
        .map(name => join(dir, name))
        .filter(existsSync)
        .reduce((latest, input) => Math.max(latest, statSync(input).mtimeMs), 0);
      if (
        saved.minimumPageCoveragePercent === minimumPageCoveragePercent &&
        judgeModifiedAt >= newestInputModifiedAt
      ) return saved;
    } catch {}
  }
  return judgeResume(dataDir, job.id);
};

const pageCoverageActualPercent = fullness =>
  Number.isFinite(fullness) ? Math.round(fullness * 1000) / 10 : null;

export const pageCoverageDeliveryProof = judge => {
  if (judge?.fullPage !== true || !Number.isFinite(judge?.fullness)) return null;
  return {
    status: 'passed',
    actualPercent: pageCoverageActualPercent(judge.fullness),
    minimumPercent: judge.minimumPageCoveragePercent,
    judgedAt: judge.judgedAt,
    artifact: 'judge.json',
  };
};

const REQUIRED_MACHINE_GATE_CHECKS = [
  ['onePage', 'resume must be exactly one page'],
  ['fullPage', 'page coverage must meet the configured minimum'],
  ['resumeItemsUseBodyArgument', 'resume bullets must use the template body argument'],
  ['verbatim', 'resume bullets must come verbatim from the selected pool'],
  ['skillsVerbatim', 'rendered skills must match the selected skills'],
  ['extractable', 'every resume bullet must survive PDF text extraction'],
];

const OPTIONAL_MACHINE_GATE_CHECKS = [
  ['sectionTransitionsCompact', 'section transitions must stay compact'],
  ['templatePreambleExact', 'template preamble must match the managed template'],
  ['templateContactHeaderExact', 'contact header must match the managed template'],
  ['skillsSectionSpacingExact', 'Skills spacing must match the managed template'],
  ['projectEntryScaffoldingExact', 'Project entries must match the managed template'],
  ['projectTransitionSpacingExact', 'Project transitions must match the managed template'],
  ['projectTailSpacingExact', 'Project tail spacing must match the managed template'],
];

export const machineGateFailures = judge => [
  ...REQUIRED_MACHINE_GATE_CHECKS
    .filter(([key]) => judge?.[key] !== true)
    .map(([key, message]) => ({ key, message, actual: judge?.[key] ?? null })),
  ...OPTIONAL_MACHINE_GATE_CHECKS
    .filter(([key]) => judge?.[key] === false)
    .map(([key, message]) => ({ key, message, actual: false })),
];

const machineGateFailureMessage = failures =>
  `Machine review failed: ${failures.map(item => item.message).join('; ')}`;

const coverageFeedbackText = ({ fullness, minimumPageCoveragePercent }) => {
  const actual = pageCoverageActualPercent(fullness);
  return actual === null
    ? `Page coverage could not be verified against the configured ${minimumPageCoveragePercent}% minimum.`
    : `Page coverage is ${actual}%, below the configured ${minimumPageCoveragePercent}% minimum.`;
};

const addCoverageFeedbackIfMissing = (job, details) => {
  const feedback = job.feedback || [];
  const existing = feedback.find(item =>
    item.reasonCode === PAGE_COVERAGE_INSUFFICIENT_REASON && item.status === 'open');
  if (existing) {
    existing.visibility = 'internal';
    return false;
  }
  job.feedback = [...feedback, {
    id: `feedback-${Date.now()}-${job.id}`,
    reasonCode: PAGE_COVERAGE_INSUFFICIENT_REASON,
    visibility: 'internal',
    text: coverageFeedbackText(details),
    createdAt: now(),
    status: 'open',
  }];
  return true;
};

const resolveCoverageFeedback = (feedback, proof) =>
  (feedback || []).map(item =>
    item.reasonCode === PAGE_COVERAGE_INSUFFICIENT_REASON && item.status === 'open'
      ? {
          ...item,
          status: 'resolved',
          resolvedAt: proof.judgedAt || now(),
          resolutionEvidence: proof,
        }
      : item);

// Fails safe to human review: an unreadable or absent config means review.
export const resumeReviewRequired = dataDir =>
  loadConfig(dataDir).requireResumeReview !== false;

const latexTemplatePath = dataDir => {
  const templatePath = loadConfig(dataDir).latexTemplate;
  return templatePath && existsSync(templatePath) ? templatePath : null;
};

const resumeLanguageForJob = (dataDir, job, explicitLanguage = null) => {
  const matchPath = join(jobDir(dataDir, job), 'match.json');
  let matchLanguage = null;
  if (existsSync(matchPath)) {
    try {
      matchLanguage = readJson(matchPath).resumeLanguage;
    } catch {}
  }
  let inferredLanguage = 'en-US';
  const jdPath = join(jobDir(dataDir, job), 'job-description.md');
  if (existsSync(jdPath)) {
    const chineseCharacters = readFileSync(jdPath, 'utf8').match(/[\u3400-\u9fff]/g)?.length || 0;
    if (chineseCharacters >= 10) inferredLanguage = 'zh-CN';
  }
  return normalizeResumeLanguage(
    explicitLanguage || matchLanguage || job.resumeLanguage || inferredLanguage,
  );
};

const templateForResumeLanguage = (dataDir, template, language) => {
  const profilePath = join(dataDir, 'profile.json');
  if (!existsSync(profilePath)) return template;
  return localizeResumeTemplate(template, readJson(profilePath), language, {
    cjkFont: loadConfig(dataDir).resumeCjkFont,
  });
};

const slugify = value =>
  String(value || 'job')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'job';

const stableId = job => {
  const raw = String(job.id || job.url || `${job.company}-${job.role}`);
  let hash = 2166136261;
  for (const char of raw) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `job-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export function loadCampaign(dataDir) {
  const paths = campaignPaths(dataDir);
  if (!existsSync(paths.manifest)) {
    return {
      schemaVersion: CAMPAIGN_SCHEMA,
      createdAt: now(),
      updatedAt: now(),
      jobs: [],
      lastExport: null,
    };
  }
  const manifest = readJson(paths.manifest);
  if (!manifest || !Array.isArray(manifest.jobs)) {
    throw new Error(`${paths.manifest} must contain a jobs array`);
  }
  return manifest;
}

// Advisory lock around manifest read-modify-write cycles: the CLI and the
// console server can mutate the same campaign concurrently, and a lost update
// here silently drops approvals. Reentrant within the process.
// ponytail: dir-lock + busy-wait; a proper lockfile lib only if contention grows.
let campaignLockHeld = false;
function withCampaignLock(dataDir, fn) {
  if (campaignLockHeld) return fn();
  const lockPath = join(ensureDir(campaignPaths(dataDir).root), '.manifest-lock');
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      mkdirSync(lockPath);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 30_000) {
          rmdirSync(lockPath); // stale lock from a crashed process
          continue;
        }
      } catch {}
      if (Date.now() > deadline) throw new Error('campaign manifest is locked by another process');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  campaignLockHeld = true;
  try {
    return fn();
  } finally {
    campaignLockHeld = false;
    try { rmdirSync(lockPath); } catch {}
  }
}

export function saveCampaign(dataDir, manifest) {
  const paths = campaignPaths(dataDir);
  manifest.schemaVersion = CAMPAIGN_SCHEMA;
  manifest.updatedAt = now();
  writeJsonAtomic(paths.manifest, manifest);
  return manifest;
}

export const jobDir = (dataDir, job) =>
  join(campaignPaths(dataDir).jobs, job.folder);

const snapshotFor = job => ({
  id: job.id,
  applicationId: job.applicationId || null,
  company: job.company,
  role: job.role,
  location: job.location || '',
  source: job.source || '',
  url: job.url,
  status: job.status,
  matchScore: job.matchScore ?? null,
  evidenceIds: job.evidenceIds || [],
  selectedSkillIds: job.selectedSkillIds || [],
  selectedSkillPack: job.selectedSkillPack || null,
  experienceIndexGeneratedAt: job.experienceIndexGeneratedAt || null,
  experienceIndexFingerprint: job.experienceIndexFingerprint || null,
  approvedAt: job.approvedAt || null,
  approvalMode: job.approvalMode || null,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const persistJobSnapshot = (dataDir, job) => {
  const dir = ensureDir(jobDir(dataDir, job));
  writeJsonAtomic(join(dir, 'job.json'), snapshotFor(job));
};

export function syncJobs(dataDir, incoming) {
  if (!Array.isArray(incoming)) throw new Error('jobs must be an array');
  return withCampaignLock(dataDir, () => {
  const manifest = loadCampaign(dataDir);
  const byUrl = new Map(manifest.jobs.map(job => [job.url, job]));
  const folders = new Set(manifest.jobs.map(job => job.folder));
  const added = [];
  for (const item of incoming) {
    const url = String(item.url || '').trim();
    const company = String(item.company || '').trim();
    const role = String(item.role || item.position || '').trim();
    if (!url || !company || !role) continue;
    if (byUrl.has(url)) continue;
    const id = stableId(item);
    const baseFolder = slugify(`${company}-${role}`);
    let folder = baseFolder;
    if (folders.has(folder)) folder = `${baseFolder}-${id.slice(-6)}`;
    folders.add(folder);
    const stamp = now();
    const job = {
      id,
      applicationId: item.id ? String(item.id) : null,
      company,
      role,
      location: String(item.location || item.notes || '').trim(),
      source: String(item.source || 'tracker').trim(),
      url,
      folder,
      status: 'queued',
      matchScore: null,
      evidenceIds: [],
      selectedSkillIds: [],
      selectedSkillPack: null,
      feedback: [],
      approvedAt: null,
      approvalMode: null,
      createdAt: stamp,
      updatedAt: stamp,
      error: null,
    };
    manifest.jobs.push(job);
    byUrl.set(url, job);
    persistJobSnapshot(dataDir, job);
    added.push(job);
  }
  if (added.length || !existsSync(campaignPaths(dataDir).manifest)) {
    saveCampaign(dataDir, manifest);
  }
  return { manifest, added };
  });
}

export function findJob(dataDir, id) {
  const manifest = loadCampaign(dataDir);
  const job = manifest.jobs.find(item => item.id === id || item.applicationId === id);
  if (!job) throw new Error(`Unknown campaign job: ${id}`);
  return { manifest, job };
}

const updateJob = (dataDir, id, updater) =>
  withCampaignLock(dataDir, () => {
    const { manifest, job } = findJob(dataDir, id);
    updater(job);
    job.updatedAt = now();
    persistJobSnapshot(dataDir, job);
    saveCampaign(dataDir, manifest);
    return job;
  });

export function applyResumeReviewPolicy(dataDir) {
  const reviewRequired = resumeReviewRequired(dataDir);
  if (reviewRequired) return { reviewRequired, autoApproved: 0, exported: null };

  return withCampaignLock(dataDir, () => {
  const manifest = loadCampaign(dataDir);
  let autoApproved = 0;
  for (const job of manifest.jobs) {
    if (job.status !== 'rendered') continue;
    const dir = jobDir(dataDir, job);
    const missing = REQUIRED_EXPORT_FILES.filter(name => !existsSync(join(dir, name)));
    if (missing.length) continue;
    let judge = null;
    try {
      // Recompute when the configurable coverage threshold changed. A saved
      // judge must never keep passing under an older, lower setting.
      judge = currentResumeJudge(dataDir, job);
    } catch {
      continue;
    }
    if (machineGateFailures(judge).length) continue;
    const coverageProof = pageCoverageDeliveryProof(judge);
    if (!coverageProof) continue;
    // the LLM review is mandatory: no recorded passing verdict, no automatic
    // approval — the playbook records llm-judge.json after the context-free
    // judge run (see references/resume-judge.md)
    let llmJudge = null;
    try {
      llmJudge = readJson(join(dir, 'llm-judge.json'));
    } catch {}
    if (!llmJudgePasses(llmJudge)) continue;
    job.status = 'approved';
    job.approvedAt = now();
    job.approvalMode = 'automatic';
    job.reviewDeliveryProof = {
      ...(job.reviewDeliveryProof || {}),
      pageCoverage: coverageProof,
    };
    job.feedback = resolveCoverageFeedback(job.feedback, coverageProof)
      .map(item => ({ ...item, status: 'resolved' }));
    job.error = null;
    job.updatedAt = now();
    persistJobSnapshot(dataDir, job);
    autoApproved += 1;
  }
  if (autoApproved) saveCampaign(dataDir, manifest);

  const allApproved = manifest.jobs.length > 0 && manifest.jobs.every(job => job.status === 'approved');
  const exported = allApproved && (autoApproved > 0 || !manifest.lastExport)
    ? exportCampaign(dataDir)
    : null;
  return { reviewRequired, autoApproved, exported };
  });
}

const decodeEntity = (_, named, decimal, hex) => {
  if (decimal) return String.fromCodePoint(Number(decimal));
  if (hex) return String.fromCodePoint(parseInt(hex, 16));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[named] || `&${named};`;
};

export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/section|\/article|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-z]+);|&#(\d+);|&#x([0-9a-f]+);/gi, decodeEntity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function hydrateJob(dataDir, id, options = {}) {
  const { job } = findJob(dataDir, id);
  let text = options.text || '';
  let source = options.source || 'provided';
  if (!text && options.file) {
    text = readFileSync(options.file, 'utf8');
    source = options.source || 'file';
  }
  if (!text) {
    const response = await fetch(job.url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'CoForce-Apply/2.0 (+local resume campaign)',
        accept: 'text/html,application/xhtml+xml,text/plain',
      },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`JD fetch failed: HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    const raw = await response.text();
    text = type.includes('html') || /<html/i.test(raw) ? htmlToText(raw) : raw.trim();
    source = `http:${response.url}`;
  }
  if (text.length < 400 || /enable javascript|access denied|verify you are human|captcha/i.test(text.slice(0, 2000))) {
    updateJob(dataDir, id, current => {
      current.status = 'needs_browser_jd';
      current.error = 'The listing did not expose a complete JD over HTTP; capture it with Chrome.';
    });
    throw new Error('JD content is incomplete; browser capture required');
  }
  // write the JD to disk BEFORE flipping status — a crash between the two must
  // not leave the manifest claiming jd_ready with no file behind it
  const { job: pending } = findJob(dataDir, id);
  writeFileSync(
    join(ensureDir(jobDir(dataDir, pending)), 'job-description.md'),
    `# ${pending.role} — ${pending.company}\n\nSource: ${pending.url}\nCaptured via: ${source}\n\n${text.trim()}\n`
  );
  return updateJob(dataDir, id, current => {
    current.status = 'jd_ready';
    current.jdSource = source;
    current.error = null;
    current.approvedAt = null;
    current.approvalMode = null;
  });
}

const STOP = new Set([
  'about', 'after', 'also', 'and', 'are', 'but', 'can', 'company', 'experience',
  'for', 'from', 'have', 'into', 'job', 'more', 'our', 'role', 'skills', 'that',
  'the', 'their', 'this', 'through', 'using', 'with', 'work', 'will', 'you', 'your',
  '岗位', '工作', '要求', '负责', '相关', '以及', '我们', '能够', '具有',
]);

// ---- Module 2: JD → strict selection from the verified bullet pool ---------
// Module 1 (experience / profile skills) generates bullets JD-free and the
// user reviews them INTO profile.json — so the profile IS the verified pool.
// Selection can only reference pool ids; fabrication is structurally
// impossible, not prompt-discouraged.

const bulletId = text => createHash('sha256').update(text).digest('hex').slice(0, 8);
const skillId = name => createHash('sha256')
  .update(`skill:${String(name || '').trim().toLowerCase()}`)
  .digest('hex')
  .slice(0, 8);
const normalizeSkillName = value => String(value || '').trim().toLowerCase();

export function bulletPool(dataDir) {
  const profilePath = join(dataDir, 'profile.json');
  if (!existsSync(profilePath)) throw new Error('profile.json is missing — run the profile skill first');
  const profile = readJson(profilePath);
  const pool = [];
  const push = (bullet, origin) => {
    const text = String(typeof bullet === 'string' ? bullet : bullet?.text || '').trim();
    if (!text) return;
    const textZh = typeof bullet === 'object' && typeof bullet?.textZh === 'string'
      ? bullet.textZh.trim() || null
      : null;
    pool.push({
      id: bulletId(text),
      text,
      textZh,
      origin,
      source: (typeof bullet === 'object' && bullet?.source) || null,
      verifiedAt: (typeof bullet === 'object' && bullet?.verifiedAt) || null,
    });
  };
  for (const item of profile.experience || []) {
    for (const bullet of item.description || []) push(bullet, `experience · ${[item.company, item.title].filter(Boolean).join(' — ')}`);
  }
  for (const item of profile.projects || []) {
    for (const bullet of item.description || []) push(bullet, `project · ${item.name || ''}`);
  }
  for (const section of profile.customSections || []) {
    for (const entry of section.entries || []) {
      for (const bullet of entry.description || []) push(bullet, `${section.title || 'custom'} · ${entry.heading || ''}`);
    }
  }
  if (!pool.length) {
    throw new Error('profile.json has no bullet points — build the verified pool first (experience or profile skill), then retry');
  }
  return pool;
}

export function skillPool(dataDir) {
  const profilePath = join(dataDir, 'profile.json');
  if (!existsSync(profilePath)) throw new Error('profile.json is missing — run the profile skill first');
  const profile = readJson(profilePath);
  const experienceIndexPath = join(dataDir, 'experience', 'experience-index.json');
  const experienceIndex = existsSync(experienceIndexPath) ? readJson(experienceIndexPath) : null;
  const byName = new Map();
  const add = (item, origin) => {
    const name = String(typeof item === 'string' ? item : item?.name || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    const evidence = typeof item === 'object' && Array.isArray(item?.evidence)
      ? item.evidence
      : [];
    const evidenceIds = [
      ...(typeof item === 'object' && Array.isArray(item?.evidenceIds) ? item.evidenceIds : []),
      ...evidence.map(value => value?.id),
    ].map(value => String(value || '').trim()).filter(Boolean);
    const source = (typeof item === 'object' && item?.source) ||
      evidence.find(value => value?.source)?.source ||
      null;
    const category = String(typeof item === 'object' ? item?.category || '' : '').trim() ||
      'Tools & Technologies';
    const existing = byName.get(key);
    if (existing) {
      if (existing.category === 'Tools & Technologies' && category !== existing.category) {
        existing.category = category;
      }
      if (!existing.source && source) existing.source = source;
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...evidenceIds])];
      existing.origins = [...new Set([...existing.origins, origin])];
      existing.attested ||= origin === 'resume';
      existing.evidenceBacked ||= evidenceIds.length > 0 || origin === 'experience';
      if (!existing.verifiedAt && typeof item === 'object' && item?.verifiedAt) {
        existing.verifiedAt = item.verifiedAt;
      }
      return;
    }
    byName.set(key, {
      id: skillId(name),
      name,
      category,
      source,
      evidenceIds: [...new Set(evidenceIds)],
      verifiedAt: (typeof item === 'object' && item?.verifiedAt) || null,
      origins: [origin],
      attested: origin === 'resume',
      evidenceBacked: evidenceIds.length > 0 || origin === 'experience',
      legacy: false,
    });
  };
  for (const item of profile.skills || []) add(item, 'resume');
  for (const item of profile.verifiedSkills || []) add(item, 'experience');
  for (const item of experienceIndex?.skills || []) add(item, 'experience');
  const strategy = profile.resumeSkillPolicy && typeof profile.resumeSkillPolicy === 'object'
    ? profile.resumeSkillPolicy
    : {};
  const baseline = new Set((strategy.baseline || []).map(normalizeSkillName).filter(Boolean));
  const rolePacks = strategy.rolePacks && typeof strategy.rolePacks === 'object' &&
    !Array.isArray(strategy.rolePacks)
    ? strategy.rolePacks
    : {};
  return [...byName.values()].map(skill => {
    const key = normalizeSkillName(skill.name);
    return {
      ...skill,
      source: skill.source || (skill.attested ? 'resume-attested' : null),
      baseline: baseline.has(key),
      rolePacks: Object.entries(rolePacks)
        .filter(([, names]) => Array.isArray(names) &&
          names.some(name => normalizeSkillName(name) === key))
        .map(([name]) => name),
    };
  });
}

export function skillReview(dataDir) {
  const profilePath = join(dataDir, 'profile.json');
  if (!existsSync(profilePath)) throw new Error('profile.json is missing — run the profile skill first');
  const profile = readJson(profilePath);
  const strategy = profile.resumeSkillPolicy && typeof profile.resumeSkillPolicy === 'object'
    ? profile.resumeSkillPolicy
    : {};
  const skills = skillPool(dataDir);
  const namesByKey = new Map(skills.map(skill => [normalizeSkillName(skill.name), skill.name]));
  const baseline = [...new Set((strategy.baseline || [])
    .map(value => String(value || '').trim()).filter(Boolean))];
  const rawRolePacks = strategy.rolePacks && typeof strategy.rolePacks === 'object' &&
    !Array.isArray(strategy.rolePacks)
    ? strategy.rolePacks
    : {};
  const rolePacks = Object.fromEntries(Object.entries(rawRolePacks)
    .map(([name, values]) => [
      String(name || '').trim(),
      [...new Set((Array.isArray(values) ? values : [])
        .map(value => String(value || '').trim()).filter(Boolean))],
    ])
    .filter(([name, values]) => name && values.length));
  const referenced = [...baseline, ...Object.values(rolePacks).flat()];
  const unknown = [...new Set(referenced
    .filter(name => !namesByKey.has(normalizeSkillName(name))))];
  const declaredStatus = strategy.status === 'approved' ? 'approved' : 'review_requested';
  const reviewedAt = typeof strategy.reviewedAt === 'string' && strategy.reviewedAt.trim()
    ? strategy.reviewedAt
    : null;
  const complete = baseline.length > 0 && Object.keys(rolePacks).length > 0 && unknown.length === 0;
  const status = declaredStatus === 'approved' && reviewedAt && complete ? 'approved' : 'review_requested';
  const reasons = [];
  if (declaredStatus !== 'approved') reasons.push('human approval has not been recorded');
  if (declaredStatus === 'approved' && !reviewedAt) reasons.push('human approval timestamp is missing');
  if (!baseline.length) reasons.push('the mandatory baseline is empty');
  if (!Object.keys(rolePacks).length) reasons.push('no non-empty role packs are defined');
  if (unknown.length) reasons.push(`${unknown.length} baseline or role-pack skills are no longer in the merged pool`);
  const jdOnly = skills
    .filter(skill => !skill.baseline && skill.rolePacks.length === 0)
    .map(skill => skill.name);
  return {
    schemaVersion: '1.0',
    status,
    declaredStatus,
    reviewedAt,
    policy: {
      baseline: 'mandatory',
      rolePack: 'mandatory-selected-pack',
      jdExtras: 'dynamic-from-eligible-pool',
      classifier: 'human',
    },
    counts: {
      total: skills.length,
      baseline: skills.filter(skill => skill.baseline).length,
      rolePacks: Object.keys(rolePacks).length,
      rolePackMemberships: Object.values(rolePacks).flat().length,
      jdOnly: jdOnly.length,
    },
    baseline,
    rolePacks,
    jdOnly,
    unknown,
    reasons,
  };
}

export function selectBullets(
  dataDir,
  id,
  bulletIds,
  selectedSkills = [],
  selectedRolePack = '',
  resumeLanguage = null,
) {
  const ids = [...new Set((bulletIds || []).map(value => String(value).trim()).filter(Boolean))];
  if (!ids.length) throw new Error('no bullet ids given');
  const pool = bulletPool(dataDir);
  const byId = new Map(pool.map(bullet => [bullet.id, bullet]));
  const unknown = ids.filter(item => !byId.has(item));
  if (unknown.length) {
    throw new Error(`selection includes bullets outside the verified pool: ${unknown.join(', ')} — only reviewed profile bullets may reach a resume`);
  }
  const { job } = findJob(dataDir, id);
  const jdPath = join(jobDir(dataDir, job), 'job-description.md');
  if (!existsSync(jdPath)) throw new Error('job-description.md is missing');
  const bullets = ids.map(item => byId.get(item));
  const skillIds = [...new Set((selectedSkills || []).map(value => String(value).trim()).filter(Boolean))];
  const availableSkills = skillPool(dataDir);
  const skillsById = new Map(availableSkills.map(skill => [skill.id, skill]));
  const unknownSkills = skillIds.filter(item => !skillsById.has(item));
  if (unknownSkills.length) {
    throw new Error(`selection includes skills outside the eligible pool: ${unknownSkills.join(', ')} — skills must come from the user's resume/coursework inventory or local Tier 0 experience index`);
  }
  const review = skillReview(dataDir);
  if (review.status !== 'approved') {
    throw new Error(`skill policy is review_requested: ${review.reasons.join('; ')} — a human must approve the mandatory baseline and role packs before campaign selection`);
  }
  const requestedPack = String(selectedRolePack || '').trim();
  const rolePackName = Object.keys(review.rolePacks)
    .find(name => name.toLowerCase() === requestedPack.toLowerCase());
  if (!rolePackName) {
    throw new Error(`role pack is review_requested: choose one approved pack for this job (${Object.keys(review.rolePacks).join(', ')})`);
  }
  const requiredNames = [...new Set([...review.baseline, ...review.rolePacks[rolePackName]])];
  const selectedNameKeys = new Set(skillIds
    .map(skillIdValue => skillsById.get(skillIdValue)?.name)
    .filter(Boolean)
    .map(normalizeSkillName));
  const missingRequired = requiredNames
    .filter(name => !selectedNameKeys.has(normalizeSkillName(name)));
  if (missingRequired.length) {
    throw new Error(`selection omits mandatory skills for baseline + ${rolePackName}: ${missingRequired.join(', ')}`);
  }
  const skills = skillIds.map(item => skillsById.get(item));
  const normalizedResumeLanguage = resumeLanguageForJob(dataDir, job, resumeLanguage);
  const experienceIndexPath = join(dataDir, 'experience', 'experience-index.json');
  const experienceIndex = existsSync(experienceIndexPath) ? readJson(experienceIndexPath) : null;
  const experienceSnapshot = experienceIndex
    ? {
        generatedAt: experienceIndex.generatedAt,
        sourceFingerprint: experienceIndex.sourceFingerprint,
      }
    : null;
  const composition = {
    total: skills.length,
    baseline: skills.filter(skill => skill.baseline).length,
    rolePack: skills.filter(skill => !skill.baseline && skill.rolePacks.includes(rolePackName)).length,
    jdExtras: skills.filter(skill => !skill.baseline && !skill.rolePacks.includes(rolePackName)).length,
  };

  const report = [
    `# Selection Report — ${job.role} at ${job.company}`,
    '',
    `- Job: ${job.url}`,
    `- Resume language: **${normalizedResumeLanguage}**`,
    `- Verified pool: ${pool.length} bullets from profile.json`,
    `- Selected: **${bullets.length}**`,
    `- Eligible skill pool: ${availableSkills.length} skills from resume/coursework plus the local Tier 0 experience index`,
    `- Tier 0 snapshot: **${experienceSnapshot?.sourceFingerprint || 'not available'}**` +
      `${experienceSnapshot?.generatedAt ? ` · ${experienceSnapshot.generatedAt}` : ''}`,
    `- Selected skills: **${skills.length}**`,
    `- Skill policy: **${composition.baseline} baseline + ${composition.rolePack} ${rolePackName} pack + ${composition.jdExtras} JD extras**`,
    '',
    '## Selected Bullets (verbatim — the resume may reorder and cut, never rewrite)',
    '',
    ...bullets.flatMap(bullet => [
      `- \`${bullet.id}\` — ${bullet.text}`,
      ...(bullet.textZh ? [`  - 中文：${bullet.textZh}`] : []),
      `  - ${bullet.origin}${bullet.source ? ` · ${bullet.source}` : ''}`,
    ]),
    '',
    '## Selected Skills (verbatim — group and reorder only)',
    '',
    ...(skills.length ? skills.flatMap(skill => [
      `- \`${skill.id}\` — **${skill.name}** · ${skill.category} · ${
        skill.baseline
          ? 'baseline'
          : skill.rolePacks.includes(rolePackName)
            ? `role-pack:${rolePackName}`
            : 'jd-extra'
      }`,
      `  - ${skill.source || 'profile-attested'}${skill.evidenceIds.length ? ` · evidence: ${skill.evidenceIds.join(', ')}` : ''}`,
    ]) : ['_No skills selected._']),
    '',
    '## Iron Law',
    '',
    'Every resume line must be one of the selected bullets, verbatim. Rewording goes back through Module 1 (generate → review → profile), never happens here.',
  ].join('\n');

  const updated = updateJob(dataDir, id, current => {
    current.status = 'matched';
    current.matchScore = bullets.length;
    current.evidenceIds = ids;
    current.selectedSkillIds = skillIds;
    current.selectedSkillPack = rolePackName;
    current.resumeLanguage = normalizedResumeLanguage;
    current.error = null;
    current.approvedAt = null;
    current.approvalMode = null;
  });
  const dir = jobDir(dataDir, updated);
  removeIfExists(join(dir, 'judge.json'));
  removeIfExists(join(dir, 'llm-judge.json'));
  writeFileSync(join(dir, 'match-report.md'), `${report.trim()}\n`);
  writeJsonAtomic(join(dir, 'match.json'), {
    schemaVersion: CAMPAIGN_SCHEMA,
    mode: 'selection',
    selectedAt: now(),
    poolSize: pool.length,
    skillPoolSize: availableSkills.length,
    resumeSkillPolicy: {
      status: review.status,
      reviewedAt: review.reviewedAt,
      policy: review.policy,
    },
    experienceSnapshot,
    selectedRolePack: rolePackName,
    resumeLanguage: normalizedResumeLanguage,
    skillComposition: composition,
    bullets,
    skills,
  });
  return updated;
}

const safeCopy = (source, target) => {
  if (!source) return;
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Missing file: ${source}`);
  ensureDir(dirname(target));
  if (resolve(source) !== resolve(target)) copyFileSync(source, target);
};

export function stageArtifacts(dataDir, id, artifacts) {
  const { job } = findJob(dataDir, id);
  const dir = ensureDir(jobDir(dataDir, job));
  removeIfExists(join(dir, 'judge.json'));
  removeIfExists(join(dir, 'llm-judge.json'));
  const mapping = {
    jd: 'job-description.md',
    tex: 'resume.tex',
    pdf: 'resume.pdf',
    match: 'match-report.md',
  };
  for (const [key, name] of Object.entries(mapping)) safeCopy(artifacts[key], join(dir, name));
  let staged = updateJob(dataDir, id, current => {
    const hasPdf = existsSync(join(dir, 'resume.pdf'));
    const hasTex = existsSync(join(dir, 'resume.tex'));
    current.status = hasPdf && hasTex ? 'matched' : current.status;
    current.approvedAt = null;
    current.approvalMode = null;
    current.reviewDeliveryProof = null;
    current.error = null;
  });
  if (existsSync(join(dir, 'resume.pdf')) && existsSync(join(dir, 'resume.tex'))) {
    try {
      const judge = judgeResume(dataDir, id);
      const proof = pageCoverageDeliveryProof(judge);
      const gateFailures = machineGateFailures(judge);
      staged = updateJob(dataDir, id, current => {
        if (proof && gateFailures.length === 0) {
          current.status = 'rendered';
          current.reviewDeliveryProof = {
            ...(current.reviewDeliveryProof || {}),
            pageCoverage: proof,
          };
          current.feedback = resolveCoverageFeedback(current.feedback, proof);
          current.error = null;
        } else {
          current.status = 'revision_requested';
          current.reviewDeliveryProof = null;
          current.error = judge.fullPage === false
            ? coverageFeedbackText({
                fullness: judge.fullness,
                minimumPageCoveragePercent: judge.minimumPageCoveragePercent,
              })
            : gateFailures.length
              ? machineGateFailureMessage(gateFailures)
              : 'Page coverage could not be measured; Review delivery proof is required';
          if (judge.fullPage !== true) {
            addCoverageFeedbackIfMissing(current, {
              fullness: judge.fullness,
              minimumPageCoveragePercent: judge.minimumPageCoveragePercent,
            });
          }
        }
      });
    } catch (error) {
      staged = updateJob(dataDir, id, current => {
        current.status = 'render_failed';
        current.reviewDeliveryProof = null;
        current.error = String(error.message || error);
      });
    }
  }
  if (staged.status === 'rendered' && !resumeReviewRequired(dataDir)) {
    applyResumeReviewPolicy(dataDir);
    return findJob(dataDir, id).job;
  }
  return staged;
}

const findBinary = names => {
  for (const name of names) {
    try {
      return execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim();
    } catch { /* try next */ }
  }
  return null;
};

export function syncSelectedSkillsToResume(dataDir, id) {
  const { job } = findJob(dataDir, id);
  const dir = jobDir(dataDir, job);
  const texPath = join(dir, 'resume.tex');
  const matchPath = join(dir, 'match.json');
  if (!existsSync(texPath)) throw new Error('resume.tex is missing');
  if (!existsSync(matchPath)) return { updated: false, skills: 0 };
  const match = readJson(matchPath);
  const skills = Array.isArray(match.skills) ? match.skills : [];
  if (!skills.length) return { updated: false, skills: 0 };

  const resumeLanguage = resumeLanguageForJob(dataDir, job);
  const groups = localizedSkillGroups(skills, resumeLanguage);
  const rows = groups.map(group =>
    `\\resumeSubItem{${escapeResumeText(group.label)}:}\n  {${group.names.map(escapeResumeText).join(', ')}}`
  ).join('\n\\vspace{-1mm}\n');

  const tex = readFileSync(texPath, 'utf8');
  const skillLabel = resumeSectionLabels(resumeLanguage).skills;
  const section = sectionMatch(tex, skillLabel);
  if (!section || section.index === undefined) throw new Error(`resume.tex has no ${skillLabel} section`);
  const startAt = tex.indexOf('\\resumeHeadingSkillStart', section.index + section[0].length);
  const endAt = tex.indexOf('\\resumeHeadingSkillEnd', startAt);
  if (startAt === -1 || endAt === -1) {
    throw new Error('Skills section must use resumeHeadingSkillStart/resumeHeadingSkillEnd');
  }
  const bodyStart = startAt + '\\resumeHeadingSkillStart'.length;
  const next = `${tex.slice(0, bodyStart)}\n${rows}\n${tex.slice(endAt)}`;
  if (next !== tex) writeFileSync(texPath, next);
  return {
    updated: next !== tex,
    skills: skills.length,
    groups: groups.length,
  };
}

export function assembleResume(dataDir, id, explicitLanguage = null) {
  const templatePath = latexTemplatePath(dataDir);
  if (!templatePath) throw new Error('config.json latexTemplate is missing or unreadable');
  const profilePath = join(dataDir, 'profile.json');
  if (!existsSync(profilePath)) throw new Error('profile.json is missing');
  const { job } = findJob(dataDir, id);
  const dir = ensureDir(jobDir(dataDir, job));
  const matchPath = join(dir, 'match.json');
  if (!existsSync(matchPath)) throw new Error('match.json is missing — select reviewed bullets first');
  const match = readJson(matchPath);
  const resumeLanguage = resumeLanguageForJob(dataDir, job, explicitLanguage);
  const result = assembleResumeTex({
    template: readFileSync(templatePath, 'utf8'),
    profile: readJson(profilePath),
    match: { ...match, resumeLanguage },
    language: resumeLanguage,
    cjkFont: loadConfig(dataDir).resumeCjkFont,
  });
  writeFileSync(join(dir, 'resume.tex'), result.tex);
  writeJsonAtomic(matchPath, { ...match, resumeLanguage });
  removeIfExists(join(dir, 'judge.json'));
  removeIfExists(join(dir, 'llm-judge.json'));
  updateJob(dataDir, id, current => {
    current.resumeLanguage = resumeLanguage;
    current.status = 'matched';
    current.approvedAt = null;
    current.approvalMode = null;
    current.reviewDeliveryProof = null;
    current.error = null;
  });
  return { ...result, path: join(dir, 'resume.tex') };
}

export function syncTemplateContractToResume(dataDir, id, explicitLanguage = null) {
  const templatePath = latexTemplatePath(dataDir);
  if (!templatePath) return { updated: false, reason: 'no latex template configured' };
  const { job } = findJob(dataDir, id);
  const texPath = join(jobDir(dataDir, job), 'resume.tex');
  if (!existsSync(texPath)) throw new Error('resume.tex is missing');
  const resumeLanguage = resumeLanguageForJob(dataDir, job, explicitLanguage);
  const template = templateForResumeLanguage(
    dataDir,
    readFileSync(templatePath, 'utf8'),
    resumeLanguage,
  );
  const source = readFileSync(texPath, 'utf8');
  const labels = resumeSectionLabels(resumeLanguage);
  const marker = '\\begin{document}';
  const templateBodyStart = template.indexOf(marker);
  const sourceBodyStart = source.indexOf(marker);
  if (templateBodyStart === -1 || sourceBodyStart === -1) {
    throw new Error('template and resume.tex must contain \\begin{document}');
  }

  let body = source.slice(sourceBodyStart);
  body = body.replace(
    /^(\s*)\\resumeItem\{(.*)\}\{\}\s*$/gm,
    '$1\\resumeItem{}{$2}'
  );
  body = syncSectionLeadingSpacerFromTemplate(template, body, labels.skills);
  body = syncProjectScaffoldingFromTemplate(template, body, labels.projects);
  const expectedSpacers = [...new Set(texProjectTransitionSpacers(template, labels.projects))];
  if (expectedSpacers.length === 1) {
    body = body.replace(
      /(\\resumeSubHeadingListEnd\s*\n\s*)\\vspace\{[^}]+\}(\s*\n\s*\\resumeSubHeadingListStart)/g,
      `$1\\vspace{${expectedSpacers[0]}}$2`
    );
  }
  const templateHeader = templateDocumentHeader(template);
  const resumeHeader = templateDocumentHeader(body);
  if (templateHeader !== null && resumeHeader !== null) {
    body = templateHeader + body.slice(resumeHeader.length);
  } else {
    const templateContact = template.split(/\r?\n/).find(line => line.includes('mailto:'));
    if (templateContact) {
      const bodyLines = body.split(/\r?\n/);
      const contactIndex = bodyLines.findIndex(line => line.includes('mailto:'));
      if (contactIndex === -1) throw new Error('resume.tex is missing the template contact line');
      bodyLines[contactIndex] = templateContact;
      body = bodyLines.join('\n');
    }
  }

  const next = template.slice(0, templateBodyStart) + body;
  const metrics = compareTemplateContract(template, next, resumeLanguage);
  const nextBody = next.slice(next.indexOf(marker));
  const resumeItemArguments = texCommandArguments(nextBody, '\\resumeItem', 2);
  const resumeItemsUseBodyArgument = resumeItemArguments.length
    ? resumeItemArguments.every(([label, value]) => !label.trim() && value.trim())
    : null;
  if (
    metrics.templatePreambleExact === false ||
    metrics.templateContactHeaderExact === false ||
    metrics.skillsSectionSpacingExact === false ||
    metrics.projectEntryScaffoldingExact === false ||
    metrics.projectTransitionSpacingExact === false ||
    metrics.projectTailSpacingExact === false ||
    resumeItemsUseBodyArgument === false
  ) {
    throw new Error('resume.tex could not be normalized to the LaTeX template contract');
  }
  if (next !== source) writeFileSync(texPath, next);
  return { updated: next !== source, resumeLanguage, ...metrics, resumeItemsUseBodyArgument };
}

export function renderResume(dataDir, id, texSource = null, explicitLanguage = null) {
  const { job } = findJob(dataDir, id);
  const dir = ensureDir(jobDir(dataDir, job));
  const tex = join(dir, 'resume.tex');
  removeIfExists(join(dir, 'judge.json'));
  removeIfExists(join(dir, 'llm-judge.json'));
  if (texSource) safeCopy(texSource, tex);
  else if (existsSync(join(dir, 'match.json'))) assembleResume(dataDir, id, explicitLanguage);
  if (!existsSync(tex)) throw new Error('resume.tex is missing');
  const resumeLanguage = resumeLanguageForJob(dataDir, job, explicitLanguage);
  if (explicitLanguage) {
    updateJob(dataDir, id, current => {
      current.resumeLanguage = resumeLanguage;
    });
    const matchPath = join(dir, 'match.json');
    if (existsSync(matchPath)) {
      writeJsonAtomic(matchPath, { ...readJson(matchPath), resumeLanguage });
    }
  }
  syncTemplateContractToResume(dataDir, id, resumeLanguage);
  syncSelectedSkillsToResume(dataDir, id);
  const latexmk = findBinary(['latexmk']);
  const xelatex = findBinary(['xelatex']);
  const pdflatex = findBinary(['pdflatex']);
  const tectonic = findBinary(['tectonic']);
  let output = '';
  try {
    if (resumeLanguage === 'zh-CN' && xelatex) {
      for (let i = 0; i < 2; i += 1) output += execFileSync(xelatex, ['-interaction=nonstopmode', '-halt-on-error', 'resume.tex'], { cwd: dir, encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    } else if (resumeLanguage === 'zh-CN' && tectonic) {
      output = execFileSync(tectonic, ['resume.tex', '--outdir', dir], { cwd: dir, encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    } else if (latexmk) {
      output = execFileSync(latexmk, ['-pdf', '-interaction=nonstopmode', '-halt-on-error', 'resume.tex'], { cwd: dir, encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    } else if (pdflatex) {
      for (let i = 0; i < 2; i += 1) output += execFileSync(pdflatex, ['-interaction=nonstopmode', '-halt-on-error', 'resume.tex'], { cwd: dir, encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    } else if (tectonic) {
      output = execFileSync(tectonic, ['resume.tex', '--outdir', dir], { cwd: dir, encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    } else {
      throw new Error('No compatible LaTeX compiler found (Chinese requires xelatex or tectonic)');
    }
    const pdf = join(dir, 'resume.pdf');
    if (!existsSync(pdf)) throw new Error('LaTeX compiler did not create resume.pdf');
    const pdfinfo = findBinary(['pdfinfo']);
    let pages = null;
    if (pdfinfo) {
      const info = execFileSync(pdfinfo, [pdf], { encoding: 'utf8' });
      pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0) || null;
      if (pages !== 1) throw new Error(`Resume must be exactly one page; rendered ${pages}`);
    }
    writeFileSync(join(dir, 'render.log'), output);
    const judge = judgeResume(dataDir, id);
    const gateFailures = machineGateFailures(judge);
    if (gateFailures.length) {
      const error = new Error(
        judge.fullPage === false
          ? `Resume page coverage ${Math.round(judge.fullness * 1000) / 10}% is below the configured ` +
            `${judge.minimumPageCoveragePercent}% minimum`
          : machineGateFailureMessage(gateFailures)
      );
      error.code = judge.fullPage === false
        ? 'PAGE_COVERAGE_INSUFFICIENT'
        : 'MACHINE_GATE_FAILED';
      error.judge = judge;
      throw error;
    }
    const proof = pageCoverageDeliveryProof(judge);
    if (!proof) {
      const error = new Error('Resume page coverage must be measured before delivery to Review');
      error.code = 'PAGE_COVERAGE_UNVERIFIABLE';
      error.judge = judge;
      throw error;
    }
    const updated = updateJob(dataDir, id, current => {
      current.status = 'rendered';
      current.pageCount = pages;
      current.approvedAt = null;
      current.approvalMode = null;
      current.error = null;
      current.reviewDeliveryProof = {
        ...(current.reviewDeliveryProof || {}),
        pageCoverage: proof,
      };
      current.feedback = resolveCoverageFeedback(current.feedback, proof);
    });
    if (!resumeReviewRequired(dataDir)) {
      applyResumeReviewPolicy(dataDir);
      return findJob(dataDir, id).job;
    }
    return updated;
  } catch (error) {
    updateJob(dataDir, id, current => {
      const coverageFailure = String(error.code || '').startsWith('PAGE_COVERAGE_');
      const machineFailure = error.code === 'MACHINE_GATE_FAILED';
      current.status = coverageFailure || machineFailure ? 'revision_requested' : 'render_failed';
      current.error = String(error.message || error);
      if (coverageFailure || machineFailure) {
        current.reviewDeliveryProof = null;
      }
      if (coverageFailure) {
        addCoverageFeedbackIfMissing(current, {
          fullness: error.judge?.fullness ?? null,
          minimumPageCoveragePercent:
            error.judge?.minimumPageCoveragePercent ??
            resumePageCoverageMinimumPercent(dataDir),
        });
      }
    });
    throw error;
  }
}

// ---- Resume judge: machine metrics every render must pass ------------------
// onePage (pdfinfo, exact) and verbatim (every \resumeItem is one of the
// selected pool bullets) are deterministic; the LLM rubric on top of them
// lives in SKILL.md. Auto-approval refuses any resume with a failed metric.
const unescapeTex = value => String(value)
  .replace(/\\textbackslash\{\}/g, '\\')
  .replace(/\\([&%#_$])/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

// Compare resume text against extracted PDF text on letters+digits only: line
// wrapping, hyphenation at a break, punctuation and ligature differences are
// extraction noise, not ATS failures. What is left detects the real ones.
const LIGATURES = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl' };
const flattenForExtraction = value => String(value)
  .replace(/[ﬁﬂﬀﬃﬄ]/g, ch => LIGATURES[ch])
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

// The reviewed pool intentionally preserves lightweight LaTeX emphasis such
// as `\\textbf{...}`. PDF text extraction returns only the visible argument,
// so compare against that visible text rather than treating the command name
// as ATS content. Keep this separate from `unescapeTex`: verbatim checking
// must still compare the byte-stable reviewed source, including its markup.
const visibleTexText = value => {
  let text = String(value || '');
  let previous = null;
  while (text !== previous) {
    previous = text;
    text = text
      .replace(/\\href\{[^{}]*\}\{([^{}]*)\}/g, '$1')
      .replace(/\\(?:textbf|textit|emph|underline)\{([^{}]*)\}/g, '$1');
  }
  return unescapeTex(text.replace(/[{}]/g, ''));
};

const texResumeItems = tex => {
  const items = [];
  const needle = '\\resumeItem';
  let idx = 0;
  for (;;) {
    const at = tex.indexOf(needle, idx);
    if (at === -1) break;
    let i = at + needle.length;
    const args = [];
    while (args.length < 2) {
      while (/\s/.test(tex[i] || '')) i += 1;
      if (tex[i] !== '{') break;
      let depth = 1;
      const start = ++i;
      while (i < tex.length && depth > 0) {
        if (tex[i] === '{') depth += 1;
        else if (tex[i] === '}') depth -= 1;
        i += 1;
      }
      args.push(tex.slice(start, i - 1));
    }
    if (args.length) items.push(args.filter(value => value.trim()).join(' '));
    idx = Math.max(i, at + needle.length);
  }
  return items;
};

const texCommandArguments = (tex, command, count) => {
  const rows = [];
  let cursor = 0;
  for (;;) {
    const at = tex.indexOf(command, cursor);
    if (at === -1) break;
    let index = at + command.length;
    const args = [];
    while (args.length < count) {
      while (/\s/.test(tex[index] || '')) index += 1;
      if (tex[index] !== '{') break;
      let depth = 1;
      const start = ++index;
      while (index < tex.length && depth > 0) {
        if (tex[index] === '{') depth += 1;
        else if (tex[index] === '}') depth -= 1;
        index += 1;
      }
      args.push(tex.slice(start, index - 1));
    }
    if (args.length === count) rows.push(args);
    cursor = Math.max(index, at + command.length);
  }
  return rows;
};

const texSkillGroups = (tex, skillLabel = 'Skills') => {
  const section = sectionMatch(tex, skillLabel);
  if (!section || section.index === undefined) return [];
  const start = section.index + section[0].length;
  const nextSection = tex.indexOf('\\section', start);
  const block = tex.slice(start, nextSection === -1 ? tex.length : nextSection);
  return texCommandArguments(block, '\\resumeSubItem', 2)
    .map(([label, value]) => ({
      label: unescapeTex(label).replace(/[{}]/g, '').replace(/:\s*$/, ''),
      names: unescapeTex(value)
        .replace(/\\(?:textbf|textit|emph)\{([^{}]*)\}/g, '$1')
        .replace(/[{}]/g, '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean),
    }));
};

const texProjectTransitionSpacers = (tex, projectLabel = 'Projects') => {
  const section = sectionMatch(tex, projectLabel);
  if (!section || section.index === undefined) return [];
  const block = tex.slice(section.index + section[0].length);
  return [...block.matchAll(
    /\\resumeSubHeadingListEnd\s*\\vspace\{([^}]+)\}\s*\\resumeSubHeadingListStart/g
  )].map(match => match[1].trim());
};

const sectionMatch = (tex, name) => String(tex).match(new RegExp(
  `\\\\section\\s*\\{\\s*(?:\\\\textbf\\s*\\{\\s*)?${name}\\s*\\}?\\s*\\}`,
  'i'
));

const sectionLeadingSpacer = (tex, name) => {
  const source = String(tex);
  const section = sectionMatch(source, name);
  if (!section || section.index === undefined) return null;
  const before = source.slice(0, section.index);
  const spacer = before.match(/\\vspace\{([^}]+)\}(\s*)$/);
  if (!spacer || spacer.index === undefined) return null;
  return {
    value: spacer[1].trim(),
    start: spacer.index,
    end: before.length,
  };
};

const syncSectionLeadingSpacerFromTemplate = (template, resume, name) => {
  const expected = sectionLeadingSpacer(template, name);
  const rendered = sectionLeadingSpacer(resume, name);
  if (!expected || !rendered) return resume;
  return resume.slice(0, rendered.start) +
    `\\vspace{${expected.value}}` +
    resume.slice(rendered.end);
};

const projectSectionRange = (tex, projectLabel = 'Projects') => {
  const source = String(tex);
  const section = sectionMatch(source, projectLabel);
  if (!section || section.index === undefined) return null;
  const start = section.index + section[0].length;
  const nextSection = source.indexOf('\\section', start);
  const endDocument = source.indexOf('\\end{document}', start);
  const candidates = [nextSection, endDocument].filter(index => index !== -1);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return { start, end, block: source.slice(start, end) };
};

const texProjectEntryLeadings = (tex, projectLabel = 'Projects') => {
  const range = projectSectionRange(tex, projectLabel);
  if (!range) return [];
  return [...range.block.matchAll(
    /\\resumeSubHeadingListStart([\s\S]*?)\\resumeSubheading/g
  )].map(match => match[1]);
};

const texProjectTail = (tex, projectLabel = 'Projects') => {
  const range = projectSectionRange(tex, projectLabel);
  if (!range) return null;
  const command = '\\resumeSubHeadingListEnd';
  const last = range.block.lastIndexOf(command);
  return last === -1 ? null : range.block.slice(last + command.length);
};

const syncProjectScaffoldingFromTemplate = (template, resume, projectLabel = 'Projects') => {
  const expectedLeadings = texProjectEntryLeadings(template, projectLabel);
  const expectedTail = texProjectTail(template, projectLabel);
  const range = projectSectionRange(resume, projectLabel);
  if (!range) return resume;
  let entryIndex = 0;
  let block = range.block.replace(
    /(\\resumeSubHeadingListStart)([\s\S]*?)(\\resumeSubheading)/g,
    (match, start, gap, heading) => {
      if (!expectedLeadings.length) return match;
      const expected = expectedLeadings[
        Math.min(entryIndex, expectedLeadings.length - 1)
      ];
      entryIndex += 1;
      return `${start}${expected}${heading}`;
    }
  );
  if (expectedTail !== null) {
    const command = '\\resumeSubHeadingListEnd';
    const last = block.lastIndexOf(command);
    if (last !== -1) {
      block = block.slice(0, last + command.length) + expectedTail;
    }
  }
  return resume.slice(0, range.start) + block + resume.slice(range.end);
};

const templateContactLine = tex =>
  String(tex).split(/\r?\n/).map(line => line.trim()).find(line => line.includes('mailto:')) || null;

const templateDocumentHeader = tex => {
  const source = String(tex);
  const marker = '\\begin{document}';
  const bodyStart = source.indexOf(marker);
  if (bodyStart === -1) return null;
  const body = source.slice(bodyStart);
  const firstSection = body.search(/\\section\s*\{/);
  return firstSection === -1 ? null : body.slice(0, firstSection);
};

export const compareTemplateContract = (templateSource, resumeSource, language = 'en-US') => {
  const labels = resumeSectionLabels(language);
  const marker = '\\begin{document}';
  const templateBodyStart = String(templateSource).indexOf(marker);
  const resumeBodyStart = String(resumeSource).indexOf(marker);
  const templatePreambleExact = templateBodyStart === -1 || resumeBodyStart === -1
    ? null
    : String(templateSource).slice(0, templateBodyStart) ===
      String(resumeSource).slice(0, resumeBodyStart);
  const expectedContactHeader = templateDocumentHeader(templateSource);
  const renderedContactHeader = templateDocumentHeader(resumeSource);
  const expectedContactLine = templateContactLine(templateSource);
  const renderedContactLine = templateContactLine(resumeSource);
  const templateContactHeaderExact = expectedContactHeader !== null
    ? renderedContactHeader === expectedContactHeader
    : expectedContactLine === null
      ? null
      : renderedContactLine === expectedContactLine;
  const expectedSkillsSpacer = sectionLeadingSpacer(templateSource, labels.skills);
  const renderedSkillsSpacer = sectionLeadingSpacer(resumeSource, labels.skills);
  const skillsSectionSpacingExact = expectedSkillsSpacer === null
    ? null
    : renderedSkillsSpacer?.value === expectedSkillsSpacer.value;
  const expectedProjectTransitionSpacers = [
    ...new Set(texProjectTransitionSpacers(templateSource, labels.projects)),
  ];
  const renderedProjectTransitionSpacers = texProjectTransitionSpacers(resumeSource, labels.projects);
  const expectedProjectEntryLeadings = texProjectEntryLeadings(templateSource, labels.projects);
  const renderedProjectEntryLeadings = texProjectEntryLeadings(resumeSource, labels.projects);
  const projectEntryScaffoldingExact = expectedProjectEntryLeadings.length
    ? renderedProjectEntryLeadings.every((leading, index) =>
      leading === expectedProjectEntryLeadings[
        Math.min(index, expectedProjectEntryLeadings.length - 1)
      ])
    : null;
  const projectTransitionSpacingExact = expectedProjectTransitionSpacers.length
    ? renderedProjectTransitionSpacers.every(spacer =>
      expectedProjectTransitionSpacers.includes(spacer))
    : null;
  const expectedProjectTail = texProjectTail(templateSource, labels.projects);
  const renderedProjectTail = texProjectTail(resumeSource, labels.projects);
  const projectTailSpacingExact = expectedProjectTail === null
    ? null
    : renderedProjectTail === expectedProjectTail;
  return {
    templatePreambleExact,
    templateContactHeaderExact,
    skillsSectionSpacingExact,
    projectEntryScaffoldingExact,
    expectedProjectTransitionSpacers,
    renderedProjectTransitionSpacers,
    projectTransitionSpacingExact,
    projectTailSpacingExact,
  };
};

export const measureWorkProjectsGap = (bbox, language = 'en-US') => {
  const projectHeading = resumeSectionLabels(language).projects.replace(/\s+/g, '').toUpperCase();
  const words = [...String(bbox || '').matchAll(
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g
  )].map(match => ({
    yMin: Number(match[2]),
    text: match[5].replace(/&amp;/g, '&').trim().toUpperCase(),
  }));
  let headingY = null;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word.text.replace(/\s+/g, '') === projectHeading) {
      headingY = word.yMin;
      break;
    }
    const next = words[index + 1];
    if (
      projectHeading === 'PROJECTS' &&
      word.text === 'P' &&
      next?.text === 'ROJECTS' &&
      Math.abs(word.yMin - next.yMin) <= 3
    ) {
      headingY = Math.min(word.yMin, next.yMin);
      break;
    }
  }
  if (headingY === null) return null;
  // Compare line baselines (represented by each word's yMin), not glyph
  // bottoms. Glyph bottoms vary with letters such as g/p/y and caused clean
  // adjacent lines to be misclassified as a large gap.
  const previousBaseline = Math.max(
    ...words.filter(word => word.yMin < headingY - 0.1).map(word => word.yMin)
  );
  if (!Number.isFinite(previousBaseline)) return null;
  return Math.round(Math.max(0, headingY - previousBaseline) * 100) / 100;
};

export function judgeResume(dataDir, id) {
  const { job } = findJob(dataDir, id);
  const dir = jobDir(dataDir, job);
  const resumeLanguage = resumeLanguageForJob(dataDir, job);
  const labels = resumeSectionLabels(resumeLanguage);
  const pdfPath = join(dir, 'resume.pdf');
  const texPath = join(dir, 'resume.tex');
  if (!existsSync(pdfPath) || !existsSync(texPath)) {
    throw new Error('render resume.tex + resume.pdf before judging');
  }
  let pageCount = null;
  const pdfinfo = findBinary(['pdfinfo']);
  if (pdfinfo) {
    const info = execFileSync(pdfinfo, [pdfPath], { encoding: 'utf8' });
    pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0) || null;
  }
  const onePage = pageCount === null ? null : pageCount === 1;
  // "one page" is necessary, not sufficient: a resume that fills 60% of the
  // page is a failed product too. Measure how far content reaches down the
  // page from the pdftotext bounding boxes.
  let fullness = null;
  let workProjectsGapPoints = null;
  const pdftotext = findBinary(['pdftotext']);
  if (pdftotext) {
    const bbox = execFileSync(pdftotext, ['-bbox', pdfPath, '-'], { encoding: 'utf8' });
    const page = bbox.match(/<page width="([\d.]+)" height="([\d.]+)"/);
    const ys = [...bbox.matchAll(/yMax="([\d.]+)"/g)].map(m => Number(m[1]));
    if (page && ys.length) fullness = Math.round((Math.max(...ys) / Number(page[2])) * 1000) / 1000;
    workProjectsGapPoints = measureWorkProjectsGap(bbox, resumeLanguage);
  }
  const minimumPageCoveragePercent = resumePageCoverageMinimumPercent(dataDir);
  const minimumPageCoverage = minimumPageCoveragePercent / 100;
  const fullPage = fullness === null ? null : fullness >= minimumPageCoverage;
  const MAX_WORK_PROJECTS_GAP_POINTS = 13;
  const sectionTransitionsCompact = workProjectsGapPoints === null
    ? null
    : workProjectsGapPoints <= MAX_WORK_PROJECTS_GAP_POINTS;
  // judge only the document body — the preamble's macro definitions contain
  // \resumeItem{#1} and are not resume content
  const texSource = readFileSync(texPath, 'utf8');
  const bodyStart = texSource.indexOf('\\begin{document}');
  const texBody = bodyStart === -1 ? texSource : texSource.slice(bodyStart);
  const items = texResumeItems(texBody).map(unescapeTex);
  const resumeItemArguments = texCommandArguments(texBody, '\\resumeItem', 2);
  const resumeItemsUseBodyArgument = resumeItemArguments.length
    ? resumeItemArguments.every(([label, body]) => !label.trim() && body.trim())
    : null;
  // ATS parseability. A PDF a human reads fine can still extract as garbage —
  // two-column templates interleave lines, glyphs with no ToUnicode map extract
  // as nothing — and every ATS starts from this same text layer, so a bullet
  // that does not survive extraction, in order, is a bullet no screener ever
  // sees. Owning the managed template does not settle it: config's
  // `latexTemplate` can import any .tex the user points at.
  let extractable = null;
  const unextractedLines = [];
  if (items.length && pdftotext) {
    const flat = flattenForExtraction(
      execFileSync(pdftotext, [pdfPath, '-'], { encoding: 'utf8' })
    );
    let cursor = 0;
    for (const item of items) {
      const needle = flattenForExtraction(visibleTexText(item));
      if (needle.length < 8) continue; // too short to locate without false hits
      const at = flat.indexOf(needle, cursor);
      // searching from `cursor` also catches reading-order scrambles: a bullet
      // present but out of sequence reads as missing, which is what an ATS sees
      if (at === -1) unextractedLines.push(item);
      else cursor = at + needle.length;
    }
    extractable = unextractedLines.length === 0;
  }
  let templatePreambleExact = null;
  let templateContactHeaderExact = null;
  let skillsSectionSpacingExact = null;
  let projectEntryScaffoldingExact = null;
  let projectTransitionSpacingExact = null;
  let projectTailSpacingExact = null;
  let expectedProjectTransitionSpacers = [];
  let renderedProjectTransitionSpacers = texProjectTransitionSpacers(texBody, labels.projects);
  const configuredTemplatePath = latexTemplatePath(dataDir);
  if (configuredTemplatePath) {
    try {
      const templateSource = templateForResumeLanguage(
        dataDir,
        readFileSync(configuredTemplatePath, 'utf8'),
        resumeLanguage,
      );
      ({
        templatePreambleExact,
        templateContactHeaderExact,
        skillsSectionSpacingExact,
        projectEntryScaffoldingExact,
        expectedProjectTransitionSpacers,
        renderedProjectTransitionSpacers,
        projectTransitionSpacingExact,
        projectTailSpacingExact,
      } = compareTemplateContract(templateSource, texSource, resumeLanguage));
    } catch {}
  }
  const matchPath = join(dir, 'match.json');
  let verbatim = null;
  const unknownLines = [];
  const missingLines = [];
  let skillsVerbatim = null;
  const renderedSkillGroups = texSkillGroups(
    bodyStart === -1 ? texSource : texSource.slice(bodyStart),
    labels.skills,
  );
  const renderedSkills = renderedSkillGroups.flatMap(group => group.names);
  const unknownSkills = [];
  const missingSkills = [];
  if (existsSync(matchPath)) {
    const match = readJson(matchPath);
    const selectedLines = (match.bullets || []).map(bullet => String(
      resumeLanguage === 'zh-CN' ? bullet.textZh || '' : bullet.text || '',
    ).replace(/\s+/g, ' ').trim());
    if (selectedLines.length || items.length) {
      const allowed = new Set(selectedLines);
      for (const item of items) if (!allowed.has(item)) unknownLines.push(item);
      const renderedSet = new Set(items);
      for (const line of selectedLines) if (!line || !renderedSet.has(line)) missingLines.push(line || '<missing textZh>');
      verbatim = unknownLines.length === 0 && missingLines.length === 0;
    }
    const selectedSkills = (match.skills || []).map(skill => skill.name.replace(/\s+/g, ' ').trim());
    const allowedSkills = new Set(selectedSkills.map(skill => skill.toLowerCase()));
    const renderedNormalized = renderedSkills.map(skill => skill.replace(/\s+/g, ' ').trim());
    for (const skill of renderedNormalized) {
      if (!allowedSkills.has(skill.toLowerCase())) unknownSkills.push(skill);
    }
    const renderedSet = new Set(renderedNormalized.map(skill => skill.toLowerCase()));
    for (const skill of selectedSkills) {
      if (!renderedSet.has(skill.toLowerCase())) missingSkills.push(skill);
    }
    if (renderedSkills.length || selectedSkills.length) {
      skillsVerbatim = unknownSkills.length === 0 && missingSkills.length === 0;
    }
  }
  const issues = [];
  if (fullPage === false) {
    issues.push({
      code: PAGE_COVERAGE_INSUFFICIENT_REASON,
      actualPercent: pageCoverageActualPercent(fullness),
      minimumPercent: minimumPageCoveragePercent,
    });
  }
  const judge = {
    schemaVersion: CAMPAIGN_SCHEMA,
    resumeLanguage,
    judgedAt: now(),
    pageCount,
    onePage,
    fullness,
    minimumPageCoverage,
    minimumPageCoveragePercent,
    fullPage,
    issues,
    workProjectsGapPoints,
    maximumWorkProjectsGapPoints: MAX_WORK_PROJECTS_GAP_POINTS,
    sectionTransitionsCompact,
    templatePreambleExact,
    templateContactHeaderExact,
    skillsSectionSpacingExact,
    projectEntryScaffoldingExact,
    expectedProjectTransitionSpacers,
    renderedProjectTransitionSpacers,
    projectTransitionSpacingExact,
    projectTailSpacingExact,
    resumeItemsUseBodyArgument,
    itemCount: items.length,
    verbatim,
    unknownLines,
    missingLines,
    extractable,
    unextractedLines,
    renderedSkillCount: renderedSkills.length,
    renderedSkillGroupCount: renderedSkillGroups.length,
    skillGroupSizes: renderedSkillGroups.map(group => ({
      label: group.label,
      count: group.names.length,
    })),
    skillsVerbatim,
    unknownSkills,
    missingSkills,
  };
  writeJsonAtomic(join(dir, 'judge.json'), judge);
  return judge;
}

export function recordLlmJudge(dataDir, id, sourcePaths) {
  const paths = (Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths]).filter(Boolean);
  if (!paths.length || paths.some(sourcePath => !existsSync(sourcePath))) {
    throw new Error('one or more validated LLM judge JSON files are required');
  }
  const { job } = findJob(dataDir, id);
  const machine = currentResumeJudge(dataDir, job);
  const requiredMachinePasses = ['onePage', 'fullPage', 'verbatim', 'skillsVerbatim', 'extractable'];
  const failed = requiredMachinePasses.filter(key => machine[key] !== true);
  if (failed.length) throw new Error(`machine resume gate must pass before LLM review: ${failed.join(', ')}`);
  const records = paths.map(readJson);
  const verdict = records.length === 1
    ? validateLlmJudge(records[0])
    : aggregateLlmJudgeRuns(records);
  writeJsonAtomic(join(jobDir(dataDir, job), 'llm-judge.json'), verdict);
  return verdict;
}

export function addFeedback(dataDir, id, text, reasonCode = null) {
  const normalizedReason = reasonCode ? String(reasonCode).trim() : null;
  if (normalizedReason && !Object.hasOwn(REVIEW_FEEDBACK_REASONS, normalizedReason)) {
    throw new Error(`Unknown feedback reason: ${normalizedReason}`);
  }
  const body = String(text || REVIEW_FEEDBACK_REASONS[normalizedReason] || '').trim();
  if (!body) throw new Error('Feedback cannot be empty');
  return updateJob(dataDir, id, job => {
    const feedback = job.feedback || [];
    const duplicateReason = normalizedReason && feedback.some(item =>
      item.reasonCode === normalizedReason && item.status === 'open');
    job.feedback = duplicateReason ? feedback : [...feedback, {
      id: `feedback-${Date.now()}`,
      ...(normalizedReason ? { reasonCode: normalizedReason } : {}),
      ...(normalizedReason === PAGE_COVERAGE_INSUFFICIENT_REASON
        ? { visibility: 'internal' }
        : {}),
      text: body,
      createdAt: now(),
      status: 'open',
    }];
    job.status = 'revision_requested';
    job.approvedAt = null;
    job.approvalMode = null;
    job.reviewDeliveryProof = null;
    job.error = null;
  });
}

export function approveJob(dataDir, id) {
  const { job } = findJob(dataDir, id);
  const dir = jobDir(dataDir, job);
  const missing = REQUIRED_EXPORT_FILES.filter(name => !existsSync(join(dir, name)));
  if (missing.length) throw new Error(`Cannot approve; missing ${missing.join(', ')}`);
  const judge = currentResumeJudge(dataDir, job);
  const gateFailures = machineGateFailures(judge);
  if (judge.fullPage === false) {
    throw new Error(
      `Cannot approve; page coverage ${Math.round(judge.fullness * 1000) / 10}% is below the ` +
      `${judge.minimumPageCoveragePercent}% minimum`
    );
  }
  if (gateFailures.length) throw new Error(`Cannot approve; ${machineGateFailureMessage(gateFailures)}`);
  const proof = pageCoverageDeliveryProof(judge);
  if (!proof) throw new Error('Cannot approve; page coverage delivery proof is missing');
  return updateJob(dataDir, id, current => {
    current.status = 'approved';
    current.approvedAt = now();
    current.approvalMode = 'manual';
    current.error = null;
    current.reviewDeliveryProof = {
      ...(current.reviewDeliveryProof || {}),
      pageCoverage: proof,
    };
    current.feedback = resolveCoverageFeedback(current.feedback, proof);
    current.feedback = (current.feedback || []).map(item => ({ ...item, status: 'resolved' }));
  });
}

export function reconcileResumePageCoverage(dataDir) {
  const manifest = loadCampaign(dataDir);
  const minimumPageCoveragePercent = resumePageCoverageMinimumPercent(dataDir);
  const failed = [];
  const passed = [];
  let judged = 0;
  for (const job of manifest.jobs) {
    const dir = jobDir(dataDir, job);
    if (!existsSync(join(dir, 'resume.pdf')) || !existsSync(join(dir, 'resume.tex'))) continue;
    try {
      const judge = currentResumeJudge(dataDir, job);
      judged += 1;
      if (judge.fullPage === false) {
        failed.push({
          id: job.id,
          fullness: judge.fullness,
          minimumPageCoveragePercent,
        });
      } else {
        const proof = pageCoverageDeliveryProof(judge);
        if (proof) passed.push({ id: job.id, proof });
      }
    } catch (error) {
      judged += 1;
      failed.push({
        id: job.id,
        fullness: null,
        minimumPageCoveragePercent,
        error: String(error.message || error),
      });
    }
  }
  const failedIds = new Set(failed.map(item => item.id));
  const passedById = new Map(passed.map(item => [item.id, item.proof]));
  let reopened = 0;
  let proofRecorded = 0;
  withCampaignLock(dataDir, () => {
    const current = loadCampaign(dataDir);
    for (const job of current.jobs) {
      const proof = passedById.get(job.id);
      if (proof) {
        const previous = job.reviewDeliveryProof?.pageCoverage;
        const hadOpenCoverageFeedback = (job.feedback || []).some(item =>
          item.reasonCode === PAGE_COVERAGE_INSUFFICIENT_REASON && item.status === 'open');
        if (JSON.stringify(previous) !== JSON.stringify(proof) || hadOpenCoverageFeedback) {
          job.reviewDeliveryProof = {
            ...(job.reviewDeliveryProof || {}),
            pageCoverage: proof,
          };
          job.feedback = resolveCoverageFeedback(job.feedback, proof);
          job.updatedAt = now();
          persistJobSnapshot(dataDir, job);
          proofRecorded += 1;
        }
      }
      if (!failedIds.has(job.id)) continue;
      const details = failed.find(item => item.id === job.id);
      const wasDelivered = ['approved', 'rendered'].includes(job.status);
      if (wasDelivered) {
        job.status = 'revision_requested';
        job.approvedAt = null;
        job.approvalMode = null;
        reopened += 1;
      }
      job.reviewDeliveryProof = null;
      job.error = details?.error ||
        `Page coverage is below the configured ${minimumPageCoveragePercent}% minimum`;
      addCoverageFeedbackIfMissing(job, details);
      job.updatedAt = now();
      persistJobSnapshot(dataDir, job);
    }
    if (failed.length) current.lastExport = null;
    if (failed.length || proofRecorded) {
      saveCampaign(dataDir, current);
    }
  });
  return { minimumPageCoveragePercent, judged, reopened, proofRecorded, failed };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = buffer => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = date => {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

export function createZip(entries, output) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const stamp = dosDateTime(new Date());
  for (const entry of entries) {
    const safeName = entry.name.replaceAll('\\', '/');
    if (safeName.startsWith('/') || safeName.split('/').includes('..')) {
      throw new Error(`unsafe zip entry name: ${entry.name}`);
    }
    const name = Buffer.from(safeName);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralData = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  ensureDir(dirname(output));
  writeFileSync(output, Buffer.concat([...locals, centralData, end]));
  return output;
}

export function exportCampaign(dataDir, output = null) {
  const coverage = reconcileResumePageCoverage(dataDir);
  if (coverage.failed.length) {
    throw new Error(
      `All resumes must meet the ${coverage.minimumPageCoveragePercent}% page coverage minimum before export`
    );
  }
  return withCampaignLock(dataDir, () => {
  const manifest = loadCampaign(dataDir);
  if (!manifest.jobs.length) throw new Error('Campaign has no jobs');
  const unapproved = manifest.jobs.filter(job => job.status !== 'approved');
  if (unapproved.length) {
    throw new Error(`All resumes must be approved before export: ${unapproved.map(job => job.company).join(', ')}`);
  }
  const exportManifest = {
    schemaVersion: CAMPAIGN_SCHEMA,
    exportedAt: now(),
    jobs: manifest.jobs.map(job => snapshotFor(job)),
  };
  const entries = [{ name: 'manifest.json', data: `${JSON.stringify(exportManifest, null, 2)}\n` }];
  for (const job of manifest.jobs) {
    const dir = jobDir(dataDir, job);
    for (const name of REQUIRED_EXPORT_FILES) {
      const path = join(dir, name);
      if (!existsSync(path)) throw new Error(`${job.folder} is missing ${name}`);
      entries.push({ name: `${job.folder}/${name}`, data: readFileSync(path) });
    }
  }
  const paths = campaignPaths(dataDir);
  const target = output || join(paths.exports, 'resume-applications.zip');
  createZip(entries, target);
  manifest.lastExport = { path: target, exportedAt: exportManifest.exportedAt, jobCount: manifest.jobs.length };
  saveCampaign(dataDir, manifest);
  return manifest.lastExport;
  });
}

// Which verified bullets show up in resumes that got somewhere.
//
// The pipeline optimises for producing resumes and never looks back at which
// ones worked. This closes that loop with data both files already carry: the
// campaign manifest records the bullets selected per job (evidenceIds), the
// tracker records where each application ended up. Join on applicationId.
//
// ponytail: counting, not statistics. A person applies to tens of jobs, not
// thousands, and the same bullets ride along on almost every resume — read it
// as "worth a look", never as "this bullet causes interviews". The caveat
// travels with the data so a summarising agent cannot drop it.
const OUTCOME_OF = {
  interviewing: 'advanced',
  offer: 'advanced',
  rejected: 'rejected',
  applied: 'pending',
  pending: 'not sent',
};

export function bulletOutcomes(dataDir) {
  const manifest = loadCampaign(dataDir);
  const appsPath = join(dataDir, 'applications.json');
  const apps = existsSync(appsPath) ? readJson(appsPath) : [];
  const byId = new Map(apps.map(app => [String(app.id), app]));
  const byUrl = new Map(apps.map(app => [app.url, app]));

  const stats = new Map(); // bullet id → tallies
  const bump = (id, outcome, job) => {
    const row = stats.get(id) || { id, advanced: 0, rejected: 0, pending: 0, jobs: [] };
    if (outcome in row) row[outcome] += 1;
    row.jobs.push({ company: job.company, role: job.role, outcome });
    stats.set(id, row);
  };

  let judged = 0;
  for (const job of manifest.jobs) {
    if (!job.evidenceIds?.length) continue;
    const app = byId.get(String(job.applicationId)) || byUrl.get(job.url);
    const outcome = OUTCOME_OF[app?.status] ?? 'not sent';
    if (outcome === 'not sent') continue; // never left the building; no signal
    judged += 1;
    for (const id of job.evidenceIds) bump(id, outcome, job);
  }

  // the pool gives text + origin, and tells us which bullets NEVER got picked
  let pool = [];
  try {
    pool = bulletPool(dataDir);
  } catch {
    // no profile yet: report the tallies we have, without text
  }
  const poolById = new Map(pool.map(b => [b.id, b]));

  const used = [...stats.values()]
    .map(row => ({
      ...row,
      text: poolById.get(row.id)?.text ?? null,
      origin: poolById.get(row.id)?.origin ?? null,
      inPool: poolById.has(row.id),
    }))
    .sort((a, b) => b.advanced - a.advanced || b.rejected - a.rejected);

  const neverUsed = pool
    .filter(b => !stats.has(b.id))
    .map(b => ({ id: b.id, text: b.text, origin: b.origin }));

  return {
    judgedApplications: judged,
    caveat:
      judged < 10
        ? `Only ${judged} application(s) have an outcome — this is far too little to mean anything. Treat it as a reading aid, not evidence.`
        : `Counts over ${judged} applications with an outcome. Directional only: the same bullets ride along on most resumes, so this cannot separate cause from correlation.`,
    bullets: used,
    neverUsed,
    // a bullet no longer in the pool was edited or deleted after being used —
    // its id is a content hash, so the text moved out from under the record
    detached: used.filter(b => !b.inPool).map(b => b.id),
  };
}

export function campaignView(dataDir) {
  const manifest = loadCampaign(dataDir);
  const paths = campaignPaths(dataDir);
  return {
    ...manifest,
    root: paths.root,
    reviewRequired: resumeReviewRequired(dataDir),
    minimumPageCoveragePercent: resumePageCoverageMinimumPercent(dataDir),
    allApproved: manifest.jobs.length > 0 && manifest.jobs.every(job => job.status === 'approved'),
    jobs: manifest.jobs.map(job => {
      const dir = jobDir(dataDir, job);
      const artifacts = Object.fromEntries(
        [...REQUIRED_EXPORT_FILES, 'match.json', 'render.log', 'judge.json', 'llm-judge.json']
          .map(name => [name, existsSync(join(dir, name))])
      );
      const match = artifacts['match.json'] ? readJson(join(dir, 'match.json')) : null;
      const machineJudge = artifacts['judge.json']
        ? readJson(join(dir, 'judge.json'))
        : null;
      const rawLlmJudgeRecord = artifacts['llm-judge.json']
        ? readJson(join(dir, 'llm-judge.json'))
        : null;
      let llmJudgeRecord = null;
      let llmJudgeError = null;
      if (rawLlmJudgeRecord) {
        try {
          llmJudgeRecord = validateLlmJudge(rawLlmJudgeRecord);
        } catch (error) {
          llmJudgeError = String(error.message || error);
        }
      }
      const verdicts = llmJudgeRecord?.verdicts || [];
      const medianTotal = Number.isFinite(Number(llmJudgeRecord?.medianTotal))
        ? Number(llmJudgeRecord.medianTotal)
        : null;
      const representativeVerdict = verdicts.find(verdict =>
        Number(verdict?.total) === medianTotal) || verdicts[0] || null;
      const llmJudge = rawLlmJudgeRecord ? {
        valid: Boolean(llmJudgeRecord),
        validationError: llmJudgeError,
        judgedAt: llmJudgeRecord?.judgedAt || null,
        runs: Number(llmJudgeRecord?.runs) || verdicts.length,
        runTotals: verdicts
          .map(verdict => Number(verdict?.total))
          .filter(Number.isFinite),
        medianTotal,
        pass: llmJudgeRecord?.pass === true,
        jdFitNote: representativeVerdict?.jd_fit?.note
          || representativeVerdict?.jd_fit_note
          || null,
        jdFitScore: Number.isFinite(Number(representativeVerdict?.jd_fit?.score))
          ? Number(representativeVerdict.jd_fit.score)
          : null,
        gate: llmJudgeRecord?.gate || null,
        fixes: (llmJudgeRecord?.fixes || [])
          .map(item => typeof item === 'string' ? item : item?.fix)
          .filter(Boolean)
          .slice(0, 3),
      } : null;
      return { ...job, artifacts, match, machineJudge, llmJudge };
    }),
  };
}

export function resolveCampaignFile(dataDir, relative) {
  const root = campaignPaths(dataDir).root;
  const target = resolve(root, relative);
  if (!target.startsWith(resolve(root) + sep) || !existsSync(target) || !statSync(target).isFile()) return null;
  return target;
}

export function streamCampaignFile(dataDir, relative) {
  const path = resolveCampaignFile(dataDir, relative);
  return path ? createReadStream(path) : null;
}

export const artifactUrl = (job, name) =>
  `/campaign/files/jobs/${encodeURIComponent(job.folder)}/${encodeURIComponent(basename(name))}`;

export const contentTypeFor = path => ({
  '.pdf': 'application/pdf',
  '.tex': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
})[extname(path).toLowerCase()] || 'application/octet-stream';
