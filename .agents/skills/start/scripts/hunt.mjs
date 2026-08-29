// Job discovery: fetch job-list sources (GitHub README tables), diff against
// the tracker AND the screening ledger, respect the user's never-apply list,
// optionally track new ones.
//
// Ships inside the start skill; user data lives in ~/.coforce/.
//
//   node hunt.mjs [--track] [--config ~/.coforce/config.json]
//     [--source-file path.md ...]   # local files instead of config URLs (harness)
//   NOTE: only --config's DIRECTORY is used; settings always load from
//   <dir>/config.json via the shared loader.
//     [--apps path] [--instructions path] [--screened path]
//
//   node hunt.mjs screen <url> --reason "<why>" [--by start-filter|user]
//     [--company X] [--role Y]     # when the posting was never tracked
//   node hunt.mjs unscreen <url>   # let it resurface on the next cycle
//
// Prints a JSON summary: {new, skipped: {tracked, screened, blocked}, sources}.
// Dedup: exact URL match OR case-insensitive company+role match — applying
// twice to the same posting hurts the candidate, so skip on any doubt.
//
// TWO ledgers, one rule: applications.json holds jobs you are actually
// chasing, and its `status` is the pipeline stage only (`rejected` = the
// company turned you down). A job screened out for fit never entered that
// pipeline, so it goes to screened.json instead — dedup reads both, and every
// consumer of applications.json stays correct without learning a new flag.

import { readFileSync } from 'node:fs';
import { dataHome } from '../../../lib/data-home.mjs';
import { writeJsonAtomic } from '../../../lib/fs-atomic.mjs';
import { loadConfig } from '../../../lib/config.mjs';
import { isNeverApply, neverApplyList } from '../../../lib/never-apply.mjs';
import { dirname, join, basename } from 'node:path';

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
// `screen` / `unscreen` take a positional url; bare hunt takes none
const sub = args[0] && !args[0].startsWith('--') ? args[0] : null;
const track = args.includes('--track');
const configPath = flag('config') ?? join(dataHome(), 'config.json');
const profileDir = dirname(configPath);
const appsPath = flag('apps') ?? join(profileDir, 'applications.json');
const instructionsPath =
  flag('instructions') ?? join(profileDir, 'instructions.md');
// deliberately keyed off appsPath, not profileDir: the two ledgers are
// siblings, and a harness run pointing --apps elsewhere must not write into
// somebody's real data home.
const screenedPath = flag('screened') ?? join(dirname(appsPath), 'screened.json');
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

// --- screening ledger ------------------------------------------------------
// "Seen, and not for me." Holds no pipeline state, so nothing that reads
// applications.json has to know it exists.
const SCREENED_VERSION = 1;
const pairKey = (company, role) =>
  `${(company || '').toLowerCase()}|${(role || '').toLowerCase()}`;

const loadScreened = () => {
  const raw = readJson(screenedPath, null);
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  return { version: SCREENED_VERSION, entries };
};
const saveScreened = ledger =>
  writeJsonAtomic(screenedPath, { ...ledger, version: SCREENED_VERSION });

// One-time repair: an older start cycle marked fit-filtered jobs `rejected`
// in the tracker, which made the board claim companies had turned the user
// down. Those entries carry a "filtered: <reason>" history event — nothing a
// real rejection ever has — so they can be moved out losslessly.
function migrateFilteredRejects() {
  const apps = readJson(appsPath, []);
  if (!Array.isArray(apps)) return 0;
  const filteredEvent = app =>
    (app.history || []).find(h => /^filtered:/i.test(h.event || ''));
  const stale = apps.filter(app => app.status === 'rejected' && filteredEvent(app));
  if (!stale.length) return 0;

  const ledger = loadScreened();
  const seen = new Set(ledger.entries.map(e => e.url));
  for (const app of stale) {
    if (seen.has(app.url)) continue;
    const event = filteredEvent(app);
    ledger.entries.push({
      url: app.url,
      company: app.company || '',
      role: app.position || app.title || '',
      ...(app.source ? { source: app.source } : {}),
      reason: event.event.replace(/^filtered:\s*/i, '').trim(),
      by: 'start-filter',
      screenedAt: event.date || app.updatedAt || new Date().toISOString(),
    });
    seen.add(app.url);
  }
  saveScreened(ledger);
  const staleUrls = new Set(stale.map(a => a.url));
  writeJsonAtomic(appsPath, apps.filter(app => !staleUrls.has(app.url)));
  return stale.length;
}

const migrated = migrateFilteredRejects();

// --- screen / unscreen -----------------------------------------------------
if (sub === 'screen' || sub === 'unscreen') {
  const url = args[1];
  if (!url || url.startsWith('--')) {
    console.error(`usage: hunt.mjs ${sub} <url>${sub === 'screen' ? ' --reason "<why>"' : ''}`);
    process.exit(1);
  }
  const ledger = loadScreened();

  if (sub === 'unscreen') {
    const before = ledger.entries.length;
    ledger.entries = ledger.entries.filter(e => e.url !== url);
    const removed = before - ledger.entries.length;
    if (removed) saveScreened(ledger);
    console.log(JSON.stringify({ unscreened: removed > 0, url, migrated }, null, 2));
    process.exit(0);
  }

  const reason = flag('reason');
  if (!reason) {
    console.error('hunt.mjs screen: --reason is required — an unexplained screen-out is unauditable');
    process.exit(1);
  }
  const apps = readJson(appsPath, []);
  const tracked = Array.isArray(apps) ? apps.find(a => a.url === url) : undefined;
  const already = ledger.entries.find(e => e.url === url);
  if (!already) {
    ledger.entries.push({
      url,
      company: flag('company') ?? tracked?.company ?? '',
      role: flag('role') ?? tracked?.position ?? tracked?.title ?? '',
      ...(tracked?.source ? { source: tracked.source } : {}),
      reason,
      by: flag('by') ?? 'start-filter',
      screenedAt: new Date().toISOString(),
    });
    saveScreened(ledger);
  }
  // it never entered the pipeline, so it must not sit in a pipeline column
  if (tracked) writeJsonAtomic(appsPath, apps.filter(a => a.url !== url));
  console.log(JSON.stringify({
    screened: already ?? ledger.entries.at(-1),
    alreadyScreened: Boolean(already),
    removedFromTracker: Boolean(tracked),
    migrated,
  }, null, 2));
  process.exit(0);
}

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
  apps.map(a => pairKey(a.company, a.position || a.title))
);
const screened = loadScreened();
const screenedUrls = new Set(screened.entries.map(e => e.url));
const screenedPair = new Set(
  screened.entries.filter(e => e.company && e.role).map(e => pairKey(e.company, e.role))
);

const summary = {
  new: [],
  skipped: { tracked: 0, screened: 0, blocked: 0 },
  migrated,
  sources: [],
};
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
    const pair = pairKey(job.company, job.role);
    if (knownUrls.has(job.url) || knownPair.has(pair)) {
      summary.skipped.tracked += 1;
      continue;
    }
    if (screenedUrls.has(job.url) || screenedPair.has(pair)) {
      summary.skipped.screened += 1;
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
  writeJsonAtomic(appsPath, [...entries, ...apps]);
}

console.log(JSON.stringify(summary, null, 2));
