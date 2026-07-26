// Tier 0: durable, source-backed experience tags.
// This module is intentionally network-free. Only experience.mjs `refresh`
// may invoke the GitHub collector; campaigns import this read-only surface.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { writeJsonAtomic } from '../../../lib/fs-atomic.mjs';

export const EXPERIENCE_SCHEMA = '1.1';

export const experiencePaths = dataDir => {
  const root = join(dataDir, 'experience');
  return {
    root,
    sources: join(root, 'sources.json'),
    legacySources: join(root, 'github-sources.json'),
    evidence: join(root, 'github-evidence'),
    library: join(root, 'github-evidence', 'library', 'library.json'),
    index: join(root, 'experience-index.json'),
    manifest: join(root, 'manifest.json'),
  };
};

const ensureDir = path => {
  mkdirSync(path, { recursive: true });
  return path;
};

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

const sha256 = value => createHash('sha256').update(value).digest('hex');

const fileFingerprint = path =>
  existsSync(path) ? sha256(readFileSync(path)) : null;

const slugify = value =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';

const normalizeRepo = value => {
  const repo = String(value || '').trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error(`Invalid GitHub repository: ${value}`);
  return repo;
};

const normalizeStrings = values => [...new Set(
  (Array.isArray(values) ? values : [values])
    .map(value => String(value || '').trim())
    .filter(Boolean)
)].sort((a, b) => a.localeCompare(b));

export function normalizeSourceManifest(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Tier 0 sources must be a JSON object');
  if (!Array.isArray(payload.repositories) || !payload.repositories.length) {
    throw new Error('Tier 0 sources must contain a non-empty repositories array');
  }
  const seen = new Set();
  const repositories = payload.repositories.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Each Tier 0 source must be an object');
    const repo = normalizeRepo(item.repo);
    if (seen.has(repo.toLowerCase())) throw new Error(`Duplicate Tier 0 repository: ${repo}`);
    seen.add(repo.toLowerCase());
    const authors = normalizeStrings(item.authors);
    if (!authors.length) throw new Error(`Tier 0 source ${repo} must declare authors`);
    const normalized = { repo, authors };
    const project = String(item.project || '').trim();
    const tags = normalizeStrings(item.tags).map(tag => tag.toLowerCase());
    if (project) normalized.project = project;
    if (tags.length) normalized.tags = tags;
    return normalized;
  });
  repositories.sort((a, b) => a.repo.localeCompare(b.repo));
  return { repositories };
}

export function loadSourceManifest(dataDir, sourceFile = experiencePaths(dataDir).sources) {
  if (!existsSync(sourceFile)) {
    const legacy = experiencePaths(dataDir).legacySources;
    const suffix = existsSync(legacy)
      ? ` The old auto-discovered file still exists at ${legacy}, but it will not be imported implicitly.`
      : '';
    throw new Error(`Tier 0 source manifest is missing: ${sourceFile}. Add repositories with /experience source add.${suffix}`);
  }
  return normalizeSourceManifest(readJson(sourceFile));
}

export function saveSourceManifest(dataDir, payload) {
  const manifest = normalizeSourceManifest(payload);
  writeJsonAtomic(experiencePaths(dataDir).sources, manifest);
  return manifest;
}

export function upsertSource(dataDir, source) {
  const paths = experiencePaths(dataDir);
  const current = existsSync(paths.sources) ? loadSourceManifest(dataDir) : { repositories: [] };
  const normalized = normalizeSourceManifest({ repositories: [source] }).repositories[0];
  const repositories = current.repositories.filter(item => item.repo.toLowerCase() !== normalized.repo.toLowerCase());
  repositories.push(normalized);
  return saveSourceManifest(dataDir, { repositories });
}

export function removeSource(dataDir, repo) {
  const current = loadSourceManifest(dataDir);
  const target = normalizeRepo(repo).toLowerCase();
  const repositories = current.repositories.filter(item => item.repo.toLowerCase() !== target);
  if (repositories.length === current.repositories.length) throw new Error(`Tier 0 source not found: ${repo}`);
  if (!repositories.length) throw new Error('Tier 0 must retain at least one repository');
  return saveSourceManifest(dataDir, { repositories });
}

const textOfBullets = value =>
  (Array.isArray(value) ? value : [])
    .map(item => typeof item === 'string' ? item : item?.text)
    .filter(Boolean)
    .join('\n');

const skillName = value =>
  String(typeof value === 'string' ? value : value?.name || '').trim();

const profileSkillNames = profile => normalizeStrings([
  ...(Array.isArray(profile?.skills) ? profile.skills : []),
  ...(Array.isArray(profile?.verifiedSkills) ? profile.verifiedSkills : []),
].map(skillName));

const firstBulletSource = value =>
  (Array.isArray(value) ? value : [])
    .find(item => typeof item === 'object' && item?.source)?.source || null;

const profileTags = (text, skills = []) => {
  const lowered = String(text || '').toLowerCase();
  const tags = new Set();
  for (const skill of skills) {
    const raw = skillName(skill);
    if (raw && lowered.includes(raw.toLowerCase())) tags.add(`skill:${slugify(raw)}`);
  }
  return [...tags].sort();
};

function profileEntries(profile) {
  if (!profile || typeof profile !== 'object') return [];
  const skills = profileSkillNames(profile);
  const entries = [];

  if (skills.length) {
    entries.push({
      id: 'profile:skills',
      project_id: 'profile-skills',
      project_name: 'Curated Skills',
      artifact: 'profile_skills',
      title: 'Curated skills',
      body: skills.join(', '),
      status: 'curated',
      tags: ['source:profile', ...skills.map(skill => `skill:${slugify(skill)}`)],
      source_url: null,
    });
  }

  for (const [index, item] of (profile.experience || []).entries()) {
    const body = [item.title, item.company, textOfBullets(item.description)].filter(Boolean).join('\n');
    entries.push({
      id: `profile:experience:${index}`,
      project_id: `experience-${slugify(item.company || index)}`,
      project_name: item.company || 'Experience',
      artifact: 'profile_experience',
      title: [item.title, item.company].filter(Boolean).join(' at '),
      body,
      status: 'curated',
      authored_at: item.date || null,
      tags: ['source:profile', 'artifact:experience', ...profileTags(body, skills)],
      source_url: item.url || firstBulletSource(item.description),
    });
  }

  for (const [index, item] of (profile.projects || []).entries()) {
    const body = [item.technologies, textOfBullets(item.description)].filter(Boolean).join('\n');
    entries.push({
      id: `profile:project:${index}`,
      project_id: `profile-project-${slugify(item.name || index)}`,
      project_name: item.name || 'Profile Project',
      artifact: 'profile_project',
      title: item.name || `Project ${index + 1}`,
      body,
      status: 'curated',
      authored_at: item.dateRange || null,
      tags: ['source:profile', 'artifact:project', ...profileTags(body, skills)],
      source_url: item.url || firstBulletSource(item.description),
    });
  }
  return entries;
}

const splitTechnologies = value =>
  String(value || '')
    .split(/[,|]/)
    .map(item => item.trim())
    .filter(Boolean);

const displayNameForTag = tag => {
  const slug = String(tag || '').replace(/^(?:repo-)?tech:/, '');
  if (!slug) return null;
  return slug
    .split('-')
    .map(part => part ? part[0].toUpperCase() + part.slice(1) : '')
    .join(' ');
};

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const textMentionsSkill = (text, name) => {
  const raw = String(name || '').trim();
  if (!raw) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(raw)}([^a-z0-9]|$)`, 'i')
    .test(String(text || ''));
};

export function buildSkillCandidates(entries, profile = null) {
  const seeds = new Map();
  const addSeed = (name, category = null) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    const existing = seeds.get(key);
    if (!existing) seeds.set(key, {
      name: clean,
      category: category || 'Tools & Technologies',
    });
    else if (category && existing.category === 'Tools & Technologies') existing.category = category;
  };

  for (const item of profile?.skills || []) {
    addSeed(skillName(item), typeof item === 'object' ? item?.category : null);
  }
  for (const item of profile?.verifiedSkills || []) addSeed(skillName(item), item?.category);
  for (const project of profile?.projects || []) {
    for (const name of splitTechnologies(project.technologies)) addSeed(name);
  }
  for (const entry of entries) {
    for (const tag of entry.tags || []) {
      if (/^(?:repo-)?tech:/.test(tag)) {
        addSeed(displayNameForTag(tag), 'Repository Technologies');
      }
    }
  }

  const candidates = [];
  for (const seed of seeds.values()) {
    const evidence = [];
    let evidenceCount = 0;
    const seedSlug = slugify(seed.name);
    for (const entry of entries) {
      if (entry.artifact === 'profile_skills' || !entry.source_url) continue;
      const tags = entry.tags || [];
      const directTag = tags.some(tag =>
        tag === `skill:${seedSlug}` ||
        (/^(?:repo-)?tech:/.test(tag) && slugify(displayNameForTag(tag)) === seedSlug)
      );
      const searchable = [entry.title, entry.body, ...(entry.files || [])].filter(Boolean).join('\n');
      if (!directTag && !textMentionsSkill(searchable, seed.name)) continue;
      evidenceCount += 1;
      if (evidence.length < 8) {
        evidence.push({ id: entry.id, source: entry.source_url });
      }
    }
    if (!evidenceCount) continue;
    candidates.push({
      id: `skill-${sha256(seed.name.toLowerCase()).slice(0, 8)}`,
      name: seed.name,
      category: seed.category,
      evidenceCount,
      evidence,
    });
  }
  return candidates.sort((a, b) =>
    b.evidenceCount - a.evidenceCount ||
    a.category.localeCompare(b.category) ||
    a.name.localeCompare(b.name)
  );
}

const compactGithubEntry = entry => ({
  id: entry.id,
  project_id: entry.project_id,
  project_name: entry.project_name,
  repository: entry.repository,
  author: entry.author || null,
  artifact: entry.artifact,
  title: entry.title || '',
  body: entry.body || '',
  status: entry.status || null,
  authored_at: entry.authored_at || null,
  tags: normalizeStrings(entry.tags),
  files: normalizeStrings(entry.files),
  source_url: entry.source_url || entry.sources?.find(source => source.type !== 'repository')?.url || null,
});

export function buildExperienceIndex(dataDir, options = {}) {
  const paths = experiencePaths(dataDir);
  const libraryPath = options.library || paths.library;
  const profilePath = options.profile || join(dataDir, 'profile.json');
  const sourcePath = options.sources || paths.sources;
  if (!existsSync(libraryPath)) {
    throw new Error(`Tier 0 GitHub evidence is missing: ${libraryPath}. Run /experience refresh.`);
  }
  const library = readJson(libraryPath);
  const sources = loadSourceManifest(dataDir, sourcePath);
  const librarySources = normalizeSourceManifest({ repositories: library.sources || [] });
  if (JSON.stringify(librarySources) !== JSON.stringify(sources)) {
    throw new Error('Cached GitHub evidence does not match sources.json. Run /experience refresh.');
  }
  const githubEntries = (Array.isArray(library.entries) ? library.entries : []).map(compactGithubEntry);
  const profile = existsSync(profilePath) ? readJson(profilePath) : null;
  const curatedEntries = profileEntries(profile);
  const entries = [...curatedEntries, ...githubEntries];
  if (!entries.length) throw new Error('Tier 0 has no profile or GitHub evidence entries');
  const skills = buildSkillCandidates(entries, profile);

  const tags = new Set();
  for (const entry of entries) {
    for (const tag of entry.tags || []) tags.add(tag);
  }

  const generatedAt = new Date().toISOString();
  const sourcesFingerprint = fileFingerprint(sourcePath);
  const profileFingerprint = fileFingerprint(profilePath);
  const githubFingerprint = fileFingerprint(libraryPath);
  const sourceFingerprint = sha256(`${sourcesFingerprint || ''}:${profileFingerprint || ''}:${githubFingerprint || ''}`);
  const authors = normalizeStrings(sources.repositories.flatMap(source => source.authors));
  const index = {
    schemaVersion: EXPERIENCE_SCHEMA,
    tier: 0,
    generatedAt,
    sourceFingerprint,
    authors,
    counts: {
      entries: entries.length,
      tags: tags.size,
      repositories: sources.repositories.length,
      skills: skills.length,
    },
    entries,
    skills,
  };
  writeJsonAtomic(paths.index, index);
  writeJsonAtomic(paths.manifest, {
    schemaVersion: EXPERIENCE_SCHEMA,
    inputs: {
      sources: sourcesFingerprint,
      profile: profileFingerprint,
      evidence: githubFingerprint,
    },
  });
  return index;
}

export function experienceView(dataDir) {
  const paths = experiencePaths(dataDir);
  try {
    const sources = existsSync(paths.sources) ? loadSourceManifest(dataDir).repositories : [];
    if (!existsSync(paths.index)) {
      return {
        status: 'missing',
        tier: 0,
        path: paths.index,
        sources,
        message: sources.length
          ? 'Run /experience refresh once before matching jobs.'
          : 'Add at least one maintained repo/author source, then run /experience refresh.',
      };
    }
    const index = readJson(paths.index);
    const manifest = readJson(paths.manifest);
    if (index.tier !== 0) throw new Error('experience-index.json must declare tier: 0');
    const sourcesChanged = manifest.inputs?.sources !== fileFingerprint(paths.sources);
    const profileChanged = manifest.inputs?.profile !== fileFingerprint(join(dataDir, 'profile.json'));
    const evidenceChanged = manifest.inputs?.evidence !== fileFingerprint(paths.library);
    const status = sourcesChanged ? 'sources_changed' : evidenceChanged ? 'evidence_changed' : profileChanged ? 'profile_changed' : 'ready';
    return {
      status,
      tier: 0,
      path: paths.index,
      generatedAt: index.generatedAt,
      sourceFingerprint: index.sourceFingerprint,
      authors: index.authors,
      sources,
      counts: index.counts,
      profileChanged,
      sourcesChanged,
      evidenceChanged,
      message: sourcesChanged
        ? 'Tier 0 sources changed; run /experience refresh to fetch the maintained repo/author scope.'
        : evidenceChanged
        ? 'Cached GitHub evidence changed after Tier 0 build; run /experience build (no GitHub scan).'
        : profileChanged
        ? 'Profile changed after Tier 0 build; run /experience build (no GitHub scan).'
        : 'Campaign matching reads this local index and never scans GitHub.',
    };
  } catch (error) {
    return { status: 'invalid', tier: 0, path: paths.index, message: String(error.message || error) };
  }
}
