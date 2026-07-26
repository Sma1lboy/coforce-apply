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
import { inferSkillCategory } from '../../../lib/skill-catalog.mjs';

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

// Fails safe to human review: an unreadable or absent config means review.
export const resumeReviewRequired = dataDir =>
  loadConfig(dataDir).requireResumeReview !== false;

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
      judge = existsSync(join(dir, 'judge.json')) ? readJson(join(dir, 'judge.json')) : judgeResume(dataDir, job.id);
    } catch {
      continue;
    }
    // null = unverifiable (no pdfinfo / template without \resumeItem); only a
    // FAILED metric blocks auto-approval — humans can still approve manually
    if (
      judge.onePage === false ||
      judge.fullPage === false ||
      judge.verbatim === false ||
      judge.skillsDense === false ||
      judge.skillGroupsDense === false ||
      judge.skillsVerbatim === false
    ) continue;
    // the LLM review is mandatory: no recorded passing verdict, no automatic
    // approval — the playbook records llm-judge.json after the context-free
    // judge run (see references/resume-judge.md)
    let llmJudge = null;
    try {
      llmJudge = readJson(join(dir, 'llm-judge.json'));
    } catch {}
    if (!llmJudge || llmJudge.pass !== true) continue;
    job.status = 'approved';
    job.approvedAt = now();
    job.approvalMode = 'automatic';
    job.feedback = (job.feedback || []).map(item => ({ ...item, status: 'resolved' }));
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
// Module 1 (repo-bullets / profile skills) generates bullets JD-free and the
// user reviews them INTO profile.json — so the profile IS the verified pool.
// Selection can only reference pool ids; fabrication is structurally
// impossible, not prompt-discouraged.

const bulletId = text => createHash('sha256').update(text).digest('hex').slice(0, 8);
const skillId = name => createHash('sha256')
  .update(`skill:${String(name || '').trim().toLowerCase()}`)
  .digest('hex')
  .slice(0, 8);
const DENSE_SKILL_MIN = 18;
const minimumSkillSelection = poolSize => Math.min(DENSE_SKILL_MIN, poolSize);
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
    throw new Error('profile.json has no bullet points — build the verified pool first (repo-bullets or profile skill), then retry');
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
      inferSkillCategory(name);
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

export function selectBullets(dataDir, id, bulletIds, selectedSkills = [], selectedRolePack = '') {
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
  const minimumSkills = minimumSkillSelection(availableSkills.length);
  if (skillIds.length < minimumSkills) {
    throw new Error(`selection includes ${skillIds.length} skills; select at least ${minimumSkills} from the ${availableSkills.length}-skill eligible pool to preserve resume skill density`);
  }
  const skills = skillIds.map(item => skillsById.get(item));
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
    `- Verified pool: ${pool.length} bullets from profile.json`,
    `- Selected: **${bullets.length}**`,
    `- Eligible skill pool: ${availableSkills.length} skills from resume/coursework plus the local Tier 0 experience index`,
    `- Selected skills: **${skills.length}** (minimum density: ${minimumSkills})`,
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
    minimumSkillCount: minimumSkills,
    resumeSkillPolicy: {
      status: review.status,
      reviewedAt: review.reviewedAt,
      policy: review.policy,
    },
    selectedRolePack: rolePackName,
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
  const staged = updateJob(dataDir, id, current => {
    const hasPdf = existsSync(join(dir, 'resume.pdf'));
    const hasTex = existsSync(join(dir, 'resume.tex'));
    current.status = hasPdf && hasTex ? 'rendered' : current.status;
    current.approvedAt = null;
    current.approvalMode = null;
    current.error = null;
  });
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

const escapeSkillTex = value => String(value)
  .replace(/\\/g, '\\textbackslash{}')
  .replace(/([&%#_$])/g, '\\$1');

const DISPLAY_SKILL_GROUPS = [
  {
    key: 'languages',
    label: 'Languages & Frameworks',
    categories: ['Programming Languages', 'Frameworks & Developer Tools'],
  },
  {
    key: 'backend',
    label: 'Backend, APIs & Data',
    categories: ['Backend & APIs', 'Databases & Storage'],
  },
  {
    key: 'ai',
    label: 'AI/ML & Agent Systems',
    categories: ['AI/ML & Agent Systems'],
  },
  {
    key: 'infra',
    label: 'Infrastructure & Distributed Systems',
    categories: ['Infrastructure & Cloud', 'Distributed Systems & Data'],
  },
];

const consolidatedSkillGroups = skills => {
  const categoryToKey = new Map(DISPLAY_SKILL_GROUPS.flatMap(group =>
    group.categories.map(category => [category.toLowerCase(), group.key])));
  const groups = DISPLAY_SKILL_GROUPS.map(group => ({ ...group, names: [] }));
  const byKey = new Map(groups.map(group => [group.key, group]));
  for (const skill of skills) {
    const category = String(skill.category || '').trim().toLowerCase();
    const key = categoryToKey.get(category) || 'backend';
    byKey.get(key).names.push(String(skill.name || '').trim());
  }
  const active = groups.filter(group => group.names.length);
  const minimum = Math.min(5, skills.length);
  const merge = (sourceKey, targetKey, label) => {
    const source = active.find(group => group.key === sourceKey);
    const target = active.find(group => group.key === targetKey);
    if (!source || !target || source.names.length >= minimum) return false;
    target.names = active.indexOf(source) < active.indexOf(target)
      ? [...source.names, ...target.names]
      : [...target.names, ...source.names];
    target.label = label;
    active.splice(active.indexOf(source), 1);
    return true;
  };

  merge('ai', 'languages', 'Languages, Frameworks & AI');
  merge('infra', 'backend', 'Backend, Data & Infrastructure');
  merge('backend', 'infra', 'Backend, Data & Infrastructure');
  merge('languages', 'backend', 'Languages, Frameworks, Backend & Data');

  while (active.length > 1) {
    const sparse = active.find(group => group.names.length < minimum);
    if (!sparse) break;
    const target = active
      .filter(group => group !== sparse)
      .sort((a, b) => b.names.length - a.names.length)[0];
    target.names = active.indexOf(sparse) < active.indexOf(target)
      ? [...sparse.names, ...target.names]
      : [...target.names, ...sparse.names];
    target.label = `${target.label} & Related Technologies`;
    active.splice(active.indexOf(sparse), 1);
  }
  return { groups: active, minimum };
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

  const display = consolidatedSkillGroups(skills);
  const rows = display.groups.map(group =>
    `\\resumeSubItem{${escapeSkillTex(group.label)}:}\n  {${group.names.map(escapeSkillTex).join(', ')}}`
  ).join('\n\\vspace{-1mm}\n');

  const tex = readFileSync(texPath, 'utf8');
  const section = tex.match(/\\section\s*\{\s*(?:\\textbf\s*\{\s*)?Skills\s*\}?\s*\}/i);
  if (!section || section.index === undefined) throw new Error('resume.tex has no Skills section');
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
    groups: display.groups.length,
    minimumGroupSize: display.minimum,
  };
}

export function renderResume(dataDir, id, texSource = null) {
  const { job } = findJob(dataDir, id);
  const dir = ensureDir(jobDir(dataDir, job));
  const tex = join(dir, 'resume.tex');
  removeIfExists(join(dir, 'judge.json'));
  removeIfExists(join(dir, 'llm-judge.json'));
  safeCopy(texSource, tex);
  if (!existsSync(tex)) throw new Error('resume.tex is missing');
  syncSelectedSkillsToResume(dataDir, id);
  const latexmk = findBinary(['latexmk']);
  const pdflatex = findBinary(['pdflatex']);
  const tectonic = findBinary(['tectonic']);
  let output = '';
  try {
    if (latexmk) {
      output = execFileSync(latexmk, ['-pdf', '-interaction=nonstopmode', '-halt-on-error', 'resume.tex'], { cwd: dir, encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    } else if (pdflatex) {
      for (let i = 0; i < 2; i += 1) output += execFileSync(pdflatex, ['-interaction=nonstopmode', '-halt-on-error', 'resume.tex'], { cwd: dir, encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    } else if (tectonic) {
      output = execFileSync(tectonic, ['resume.tex', '--outdir', dir], { cwd: dir, encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    } else {
      throw new Error('No LaTeX compiler found (install latexmk, pdflatex, or tectonic)');
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
    const updated = updateJob(dataDir, id, current => {
      current.status = 'rendered';
      current.pageCount = pages;
      current.approvedAt = null;
      current.approvalMode = null;
      current.error = null;
    });
    writeFileSync(join(dir, 'render.log'), output);
    judgeResume(dataDir, id);
    if (!resumeReviewRequired(dataDir)) {
      applyResumeReviewPolicy(dataDir);
      return findJob(dataDir, id).job;
    }
    return updated;
  } catch (error) {
    updateJob(dataDir, id, current => {
      current.status = 'render_failed';
      current.error = String(error.message || error);
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

const texResumeItems = tex => {
  const items = [];
  const needle = '\\resumeItem{';
  let idx = 0;
  for (;;) {
    const at = tex.indexOf(needle, idx);
    if (at === -1) break;
    let depth = 1;
    let i = at + needle.length;
    const start = i;
    while (i < tex.length && depth > 0) {
      if (tex[i] === '{') depth += 1;
      else if (tex[i] === '}') depth -= 1;
      i += 1;
    }
    items.push(tex.slice(start, i - 1));
    idx = i;
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

const texSkillGroups = tex => {
  const section = tex.match(/\\section\s*\{\s*(?:\\textbf\s*\{\s*)?Skills\s*\}?\s*\}/i);
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

export function judgeResume(dataDir, id) {
  const { job } = findJob(dataDir, id);
  const dir = jobDir(dataDir, job);
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
  const pdftotext = findBinary(['pdftotext']);
  if (pdftotext) {
    const bbox = execFileSync(pdftotext, ['-bbox', pdfPath, '-'], { encoding: 'utf8' });
    const page = bbox.match(/<page width="([\d.]+)" height="([\d.]+)"/);
    const ys = [...bbox.matchAll(/yMax="([\d.]+)"/g)].map(m => Number(m[1]));
    if (page && ys.length) fullness = Math.round((Math.max(...ys) / Number(page[2])) * 1000) / 1000;
  }
  const FULL_PAGE_MIN = 0.93; // 撑满: content must press into the bottom margin zone (~0.77in of slack on letter); a page in the 0.8s reads half-hearted
  const fullPage = fullness === null ? null : fullness >= FULL_PAGE_MIN;
  // judge only the document body — the preamble's macro definitions contain
  // \resumeItem{#1} and are not resume content
  const texSource = readFileSync(texPath, 'utf8');
  const bodyStart = texSource.indexOf('\\begin{document}');
  const items = texResumeItems(bodyStart === -1 ? texSource : texSource.slice(bodyStart)).map(unescapeTex);
  const matchPath = join(dir, 'match.json');
  let verbatim = null;
  const unknownLines = [];
  let skillsVerbatim = null;
  let skillsDense = null;
  let minimumSkillCount = null;
  const renderedSkillGroups = texSkillGroups(bodyStart === -1 ? texSource : texSource.slice(bodyStart));
  const renderedSkills = renderedSkillGroups.flatMap(group => group.names);
  const minimumSkillGroupSize = Math.min(5, renderedSkills.length);
  const skillGroupsDense = renderedSkillGroups.length
    ? renderedSkillGroups.every(group => group.names.length >= minimumSkillGroupSize)
    : null;
  const unknownSkills = [];
  const missingSkills = [];
  if (items.length && existsSync(matchPath)) {
    const match = readJson(matchPath);
    const allowed = new Set((match.bullets || []).map(bullet => bullet.text.replace(/\s+/g, ' ').trim()));
    for (const item of items) if (!allowed.has(item)) unknownLines.push(item);
    verbatim = unknownLines.length === 0;
    const selectedSkills = (match.skills || []).map(skill => skill.name.replace(/\s+/g, ' ').trim());
    minimumSkillCount = Number(match.minimumSkillCount) ||
      minimumSkillSelection(Number(match.skillPoolSize) || selectedSkills.length);
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
      skillsDense = renderedSkills.length >= minimumSkillCount;
    }
  } else if (existsSync(matchPath)) {
    const match = readJson(matchPath);
    const selectedSkills = (match.skills || []).map(skill => skill.name);
    minimumSkillCount = Number(match.minimumSkillCount) ||
      minimumSkillSelection(Number(match.skillPoolSize) || selectedSkills.length);
    if (renderedSkills.length || selectedSkills.length) {
      skillsVerbatim = renderedSkills.length === selectedSkills.length &&
        renderedSkills.every(skill => selectedSkills.some(selected => selected.toLowerCase() === skill.toLowerCase()));
      skillsDense = renderedSkills.length >= minimumSkillCount;
      if (!skillsVerbatim) {
        unknownSkills.push(...renderedSkills.filter(skill =>
          !selectedSkills.some(selected => selected.toLowerCase() === skill.toLowerCase())));
        missingSkills.push(...selectedSkills.filter(skill =>
          !renderedSkills.some(rendered => rendered.toLowerCase() === skill.toLowerCase())));
      }
    }
  }
  const judge = {
    schemaVersion: CAMPAIGN_SCHEMA,
    judgedAt: now(),
    pageCount,
    onePage,
    fullness,
    fullPage,
    itemCount: items.length,
    verbatim,
    unknownLines,
    renderedSkillCount: renderedSkills.length,
    minimumSkillCount,
    skillsDense,
    renderedSkillGroupCount: renderedSkillGroups.length,
    minimumSkillGroupSize,
    skillGroupSizes: renderedSkillGroups.map(group => ({
      label: group.label,
      count: group.names.length,
    })),
    skillGroupsDense,
    skillsVerbatim,
    unknownSkills,
    missingSkills,
  };
  writeJsonAtomic(join(dir, 'judge.json'), judge);
  return judge;
}

export function addFeedback(dataDir, id, text) {
  const body = String(text || '').trim();
  if (!body) throw new Error('Feedback cannot be empty');
  return updateJob(dataDir, id, job => {
    job.feedback = [...(job.feedback || []), {
      id: `feedback-${Date.now()}`,
      text: body,
      createdAt: now(),
      status: 'open',
    }];
    job.status = 'revision_requested';
    job.approvedAt = null;
    job.approvalMode = null;
    job.error = null;
  });
}

export function approveJob(dataDir, id) {
  const { job } = findJob(dataDir, id);
  const dir = jobDir(dataDir, job);
  const missing = REQUIRED_EXPORT_FILES.filter(name => !existsSync(join(dir, name)));
  if (missing.length) throw new Error(`Cannot approve; missing ${missing.join(', ')}`);
  return updateJob(dataDir, id, current => {
    current.status = 'approved';
    current.approvedAt = now();
    current.approvalMode = 'manual';
    current.error = null;
    current.feedback = (current.feedback || []).map(item => ({ ...item, status: 'resolved' }));
  });
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
      const llmJudgeRecord = artifacts['llm-judge.json']
        ? readJson(join(dir, 'llm-judge.json'))
        : null;
      const llmJudge = llmJudgeRecord ? {
        judgedAt: llmJudgeRecord.judgedAt || null,
        runs: Number(llmJudgeRecord.runs) || (llmJudgeRecord.verdicts || []).length,
        runTotals: (llmJudgeRecord.verdicts || [])
          .map(verdict => Number(verdict?.total))
          .filter(Number.isFinite),
        medianTotal: Number.isFinite(Number(llmJudgeRecord.medianTotal))
          ? Number(llmJudgeRecord.medianTotal)
          : null,
        pass: llmJudgeRecord.pass === true,
        fixes: (llmJudgeRecord.fixes || []).slice(0, 3),
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
