// Durable local resume-campaign state for CoForce Apply.
// All personal artifacts live under <dataDir>/campaigns/current (normally
// ~/.coforce/campaigns/current); this module never writes into the repository.

import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';

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

export const resumeReviewRequired = dataDir => {
  const configPath = join(dataDir, 'apply-config.json');
  if (!existsSync(configPath)) return true;
  try {
    return readJson(configPath).requireResumeReview !== false;
  } catch {
    return true;
  }
};

const writeJsonAtomic = (path, value) => {
  ensureDir(dirname(path));
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
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
  if (text.length < 400 || /enable javascript|access denied|captcha|cloudflare/i.test(text.slice(0, 2000))) {
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

const tokens = value => {
  const found = String(value || '').toLowerCase().match(/[a-z][a-z0-9.+#-]{1,30}|[\u4e00-\u9fff]{2,8}/g) || [];
  return [...new Set(found.filter(token => token.length > 1 && !STOP.has(token)))];
};

const sourceUrl = entry => entry.source_url || entry.sources?.find(source => source.type !== 'repository')?.url || entry.sources?.[0]?.url || '';

export function matchJob(dataDir, id, experienceIndexFile) {
  const { job } = findJob(dataDir, id);
  const jdPath = join(jobDir(dataDir, job), 'job-description.md');
  if (!existsSync(jdPath)) throw new Error('job-description.md is missing');
  if (!existsSync(experienceIndexFile)) {
    throw new Error(`Tier 0 experience index is missing: ${experienceIndexFile}. Run $experience refresh.`);
  }
  const experienceIndex = readJson(experienceIndexFile);
  if (experienceIndex.tier !== 0) throw new Error('Experience index must declare tier: 0');
  const entries = Array.isArray(experienceIndex.entries) ? experienceIndex.entries : [];
  if (!entries.length) throw new Error('Tier 0 experience index has no entries');
  const jd = readFileSync(jdPath, 'utf8');
  const jdTokens = tokens(jd).slice(0, 180);
  const ranked = entries.map(entry => {
    const title = String(entry.title || '').toLowerCase();
    const body = String(entry.body || '').toLowerCase();
    const tags = (entry.tags || []).join(' ').toLowerCase();
    const files = (entry.files || []).join(' ').toLowerCase();
    const matched = [];
    let score = 0;
    for (const term of jdTokens) {
      let weight = 0;
      if (title.includes(term)) weight = 5;
      else if (tags.includes(term)) weight = 4;
      else if (body.includes(term)) weight = 2;
      else if (files.includes(term)) weight = 1;
      if (weight) {
        matched.push(term);
        score += weight;
      }
    }
    if (entry.artifact === 'pull_request') score += 2;
    if (entry.status === 'merged') score += 2;
    return { entry, score, matched: [...new Set(matched)].slice(0, 12) };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.entry.authored_at || '').localeCompare(String(a.entry.authored_at || '')));

  const selected = [];
  const perProject = new Map();
  for (const item of ranked) {
    const project = item.entry.project_id || 'unknown';
    if ((perProject.get(project) || 0) >= 4) continue;
    selected.push(item);
    perProject.set(project, (perProject.get(project) || 0) + 1);
    if (selected.length === 12) break;
  }
  const matchedTerms = new Set(selected.flatMap(item => item.matched));
  const score = Math.min(100, Math.round((matchedTerms.size / Math.max(12, Math.min(60, jdTokens.length))) * 100));
  const report = [
    `# Match Report — ${job.role} at ${job.company}`,
    '',
    `- Job: ${job.url}`,
    `- Tier 0 Experience Index: ${(experienceIndex.authors || []).join(', ') || 'local profile'} · ${entries.length} entries`,
    `- Index generated: ${experienceIndex.generatedAt || 'unknown'}`,
    `- Source fingerprint: \`${experienceIndex.sourceFingerprint || 'unknown'}\``,
    `- Deterministic keyword coverage: **${score}/100**`,
    `- Matched JD terms: ${[...matchedTerms].slice(0, 30).map(term => `\`${term}\``).join(', ') || 'none'}`,
    '',
    '## Grounded Evidence Shortlist',
    '',
    ...selected.flatMap(({ entry, matched }) => [
      `### ${entry.project_name || entry.project_id} — ${entry.title || entry.id}`,
      '',
      `- Evidence ID: \`${entry.id}\``,
      `- Source: ${sourceUrl(entry) || 'local evidence record'}`,
      `- Why it matches: ${matched.map(term => `\`${term}\``).join(', ') || 'related project evidence'}`,
      `- Supported tags: ${(entry.tags || []).slice(0, 12).map(tag => `\`${tag}\``).join(', ')}`,
      '',
    ]),
    '## Writing Guardrail',
    '',
    'Use only facts supported by the evidence IDs above or by the curated profile. Do not invent metrics, ownership, outcomes, employers, dates, or technologies.',
  ].join('\n');

  const updated = updateJob(dataDir, id, current => {
    current.status = 'matched';
    current.matchScore = score;
    current.evidenceIds = selected.map(item => item.entry.id);
    current.experienceIndexGeneratedAt = experienceIndex.generatedAt || null;
    current.experienceIndexFingerprint = experienceIndex.sourceFingerprint || null;
    current.error = null;
    current.approvedAt = null;
    current.approvalMode = null;
  });
  const dir = jobDir(dataDir, updated);
  writeFileSync(join(dir, 'match-report.md'), `${report.trim()}\n`);
  writeJsonAtomic(join(dir, 'match.json'), {
    score,
    experienceIndexGeneratedAt: experienceIndex.generatedAt || null,
    experienceIndexFingerprint: experienceIndex.sourceFingerprint || null,
    jdTokens,
    matchedTerms: [...matchedTerms],
    evidence: selected.map(({ entry, matched, score: evidenceScore }) => ({
      id: entry.id,
      projectId: entry.project_id,
      title: entry.title,
      author: entry.author || null,
      url: sourceUrl(entry),
      tags: entry.tags || [],
      matched,
      score: evidenceScore,
    })),
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

export function renderResume(dataDir, id, texSource = null) {
  const { job } = findJob(dataDir, id);
  const dir = ensureDir(jobDir(dataDir, job));
  const tex = join(dir, 'resume.tex');
  safeCopy(texSource, tex);
  if (!existsSync(tex)) throw new Error('resume.tex is missing');
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
        [...REQUIRED_EXPORT_FILES, 'match.json', 'render.log'].map(name => [name, existsSync(join(dir, name))])
      );
      const match = artifacts['match.json'] ? readJson(join(dir, 'match.json')) : null;
      return { ...job, artifacts, match };
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
