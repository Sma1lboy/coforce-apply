// Job discovery: fetch job-list sources (GitHub README tables), diff against
// the tracker, respect the user's never-apply list, optionally track new ones.
//
// Ships inside the start skill; user data lives in ~/.coforce/.
//
//   node hunt.mjs [--track] [--config ~/.coforce/config.json]
//     [--source-file path.md ...]   # local files instead of config URLs (harness)
//   NOTE: only --config's DIRECTORY is used; settings always load from
//   <dir>/config.json via the shared loader.
//     [--apps path] [--instructions path]
//
// Prints a JSON summary: {new, skipped: {tracked, blocked}, sources}.
// Dedup: exact URL match OR case-insensitive company+role match — applying
// twice to the same posting hurts the candidate, so skip on any doubt.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dataHome } from '../../../lib/data-home.mjs';
import { loadConfig } from '../../../lib/config.mjs';
import { isNeverApply, neverApplyList } from '../../../lib/never-apply.mjs';
import { dirname, join, basename } from 'node:path';

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const track = args.includes('--track');
const configPath = flag('config') ?? join(dataHome(), 'config.json');
const profileDir = dirname(configPath);
const appsPath = flag('apps') ?? join(profileDir, 'applications.json');
const instructionsPath =
  flag('instructions') ?? join(profileDir, 'instructions.md');
const sourceFiles = args.flatMap((a, i) =>
  a === '--source-file' ? [args[i + 1]] : []
);

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};

// Default seeds — GitHub job lists with README tables
const DEFAULT_SOURCES = [
  {
    name: '2027-SWE-College-Jobs',
    url: 'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md',
  },
  {
    name: 'Summer2027-Internships',
    url: 'https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/main/README.md',
  },
  {
    name: 'jobright-SWE-Internship',
    url: 'https://raw.githubusercontent.com/jobright-ai/2026-Software-Engineer-Internship/master/README.md',
  },
];

// Only touch the settings file when we actually need its sources — loadConfig
// migrates a legacy data home on read, and an explicit --source-file run
// (the harness, a one-off) must never write into someone's real data home.
const configured = sourceFiles.length ? null : loadConfig(profileDir).sources;
const sources = sourceFiles.length
  ? sourceFiles.map(f => ({ name: basename(f), file: f }))
  : (configured?.length ? configured : DEFAULT_SOURCES);

// --- parse a README markdown table into {company, role, location, url} ---
const stripCell = s =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function parseJobs(md) {
  const jobs = [];
  let lastCompany = '';
  for (const line of md.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 3) continue;
    const first = stripCell(cells[0]);
    if (/^-+$/.test(cells[0].replaceAll(':', '').trim()) || /company/i.test(first)) continue;
    // the apply link is the LAST link in the row; the FIRST (when different)
    // is usually the company homepage — kept for favicons/logos
    const links = [
      ...line.matchAll(/href="(https?:[^"]+)"|\]\((https?:[^)]+)\)/g),
    ].map(m => m[1] || m[2]);
    const url = links.at(-1);
    if (!url) continue;
    const homepage = links.length > 1 && links[0] !== url ? links[0] : undefined;
    const company = first === '↳' || first === '' ? lastCompany : first;
    lastCompany = company;
    jobs.push({
      company,
      role: stripCell(cells[1]),
      location: stripCell(cells[2] ?? ''),
      url,
      ...(homepage ? { homepage } : {}),
    });
  }
  return jobs;
}

// --- gather ---
const blocked = neverApplyList(instructionsPath);
const apps = readJson(appsPath, []);
const knownUrls = new Set(apps.map(a => a.url));
const knownPair = new Set(
  apps.map(a =>
    `${(a.company || '').toLowerCase()}|${(a.position || a.title || '').toLowerCase()}`
  )
);

const summary = { new: [], skipped: { tracked: 0, blocked: 0 }, sources: [] };
for (const src of sources) {
  let md;
  try {
    md = src.file
      ? readFileSync(src.file, 'utf8')
      : await (await fetch(src.url)).text();
  } catch (err) {
    summary.sources.push({ name: src.name, error: err.message });
    continue;
  }
  const jobs = parseJobs(md);
  summary.sources.push({ name: src.name, listings: jobs.length });
  for (const job of jobs) {
    const pair = `${job.company.toLowerCase()}|${job.role.toLowerCase()}`;
    if (knownUrls.has(job.url) || knownPair.has(pair)) {
      summary.skipped.tracked += 1;
      continue;
    }
    if (isNeverApply(job.company, blocked)) {
      summary.skipped.blocked += 1;
      continue;
    }
    knownUrls.add(job.url);
    knownPair.add(pair);
    summary.new.push({ ...job, source: src.name });
  }
}

if (track && summary.new.length) {
  const now = new Date().toISOString();
  const entries = summary.new.map((job, i) => ({
    id: `${Date.now() + i}`,
    url: job.url,
    title: `${job.role} — ${job.company}`,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    company: job.company,
    position: job.role,
    location: job.location || '',
    source: job.source,
    history: [{ date: now, event: `discovered from ${job.source}` }],
  }));
  writeFileSync(appsPath, `${JSON.stringify([...entries, ...apps], null, 2)}\n`);
}

console.log(JSON.stringify(summary, null, 2));
