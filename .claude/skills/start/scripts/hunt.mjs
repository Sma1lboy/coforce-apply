// Job discovery: fetch job-list sources (GitHub README tables), diff against
// the tracker, respect the user's never-apply list, optionally track new ones.
//
// Ships inside the start skill; user data lives in ~/.coforce/.
//
//   node hunt.mjs [--track] [--config ~/.coforce/apply-config.json]
//     [--source-file path.md ...]   # local files instead of config URLs (harness)
//     [--apps path] [--instructions path]
//
// Prints a JSON summary: {new, skipped: {tracked, blocked}, sources}.
// Dedup: exact URL match OR case-insensitive company+role match — applying
// twice to the same posting hurts the candidate, so skip on any doubt.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, basename } from 'node:path';

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const track = args.includes('--track');
const configPath =
  flag('config') ?? join(homedir(), '.coforce', 'apply-config.json');
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

const config = readJson(configPath, {});
const sources = sourceFiles.length
  ? sourceFiles.map(f => ({ name: basename(f), file: f }))
  : (config.sources?.length ? config.sources : DEFAULT_SOURCES);

// --- never-apply list from the "## never-apply" section of instructions.md ---
function neverApplyList(path) {
  if (!existsSync(path)) return [];
  const md = readFileSync(path, 'utf8');
  const m = md.match(/^##\s*never-apply\s*$([\s\S]*?)(?=^##\s|\n*$(?![\s\S]))/im);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map(l => l.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean)
    .map(s => s.toLowerCase());
}

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
    // the apply link is the LAST link in the row — the first is usually the
    // company homepage link inside the company cell
    const url =
      [...line.matchAll(/href="(https?:[^"]+)"/g)].at(-1)?.[1] ??
      [...line.matchAll(/\((https?:[^)]+)\)/g)].at(-1)?.[1];
    if (!url) continue;
    const company = first === '↳' || first === '' ? lastCompany : first;
    lastCompany = company;
    jobs.push({
      company,
      role: stripCell(cells[1]),
      location: stripCell(cells[2] ?? ''),
      url,
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
    if (blocked.some(b => job.company.toLowerCase().includes(b))) {
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
    history: [{ date: now, event: `discovered from ${job.source}` }],
  }));
  writeFileSync(appsPath, `${JSON.stringify([...entries, ...apps], null, 2)}\n`);
}

console.log(JSON.stringify(summary, null, 2));
