// Local application-tracker board: applications JSON → interactive kanban HTML.
// Ships inside the tracker skill; user data lives in ~/.coforce/.
//
//   node board.mjs [input.json] [--serve] [port]
//
// Defaults: ~/.coforce/applications.json, port 4517. Always serves: the board
// IS the React console in tracker/web/dist (committed with the skill), and
// this process is its API. Drags persist back to the input JSON via
// POST /api/apps. There used to be a second, hand-rolled HTML renderer for a
// static export; it duplicated the console a thousand lines at a time and is
// gone — read git history if you ever want a single-file export back.

import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dataHome } from '../../../lib/data-home.mjs';
import { intentOf, loadConfig, saveConfig } from '../../../lib/config.mjs';
import { isNeverApply, neverApplyFor } from '../../../lib/never-apply.mjs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addFeedback,
  applyResumeReviewPolicy,
  approveJob,
  campaignView,
  contentTypeFor,
  exportCampaign,
  reconcileResumePageCoverage,
  resolveCampaignFile,
  skillPool,
  skillReview,
  syncJobs,
} from '../../campaign/scripts/campaign-lib.mjs';
import { experienceView } from '../../experience/scripts/experience-lib.mjs';
import {
  AGENT_LABEL,
  applyJobStatus,
  runAgentAdd,
  runAgentImport,
  spawnAgent,
} from './agent-runner.mjs';

// hunt.mjs lives in the sibling start skill (all skills install together)
const huntScript = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../start/scripts/hunt.mjs'
);
// prebuilt React console (tracker/web) — the board itself, served at /
const webDist = join(dirname(fileURLToPath(import.meta.url)), '../web/dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const HOME = dataHome();
const args = process.argv.slice(2);
// --serve is accepted and ignored: serving is all this does now, but the flag
// is in every existing script, doc and muscle memory.
const serveIdx = args.indexOf('--serve');
// port 0 is valid (ephemeral) — don't let || swallow it
const portArg = serveIdx === -1 ? undefined : args[serveIdx + 1];
const hasPortArg = portArg !== undefined && /^\d+$/.test(portArg);
const port = hasPortArg ? Number(portArg) : 4517;
const positional = args.filter(
  (a, i) => a !== '--serve' && !(hasPortArg && i === serveIdx + 1)
);
const [input = join(HOME, 'applications.json')] = positional;

// --- background Chrome apply job runner ---------------------------------
// POST /api/apply starts Claude Code in the background. The skill's background protocol stops BEFORE the final submit and
// prints COFORCE_STATUS: READY_TO_SUBMIT. The user confirms in the console
// dialog → POST .../confirm resumes the same session to submit. Gated on the
// user's standing consent (`headlessApply` in config.json; the property name
// is retained for compatibility with existing installations).
const applyJobs = new Map(); // id → {url, sessionId, logPath, child}

const applyLogsDir = () => {
  const dir = join(dataDir, 'out', 'apply-logs');
  mkdirSync(dir, { recursive: true });
  return dir;
};

// migration shim for entries saved before failed/fallback became history events
const normalize = app =>
  app.status === 'failed' || app.status === 'fallback'
    ? { ...app, status: 'pending', needsFallback: true }
    : app;

// Per-application archive: <dir-of-input>/applications/<id>/ holds that
// application's files (interview prep, offer letter, tailored resume);
// files directly in applications/ are global (shared prep, salary research).
const dataDir = dirname(input);
const filesRoot = join(dataDir, 'applications');
const profilePath = join(dataDir, 'profile.json');
const instructionsPath = join(dataDir, 'instructions.md');

const humanCampaignJob = job => {
  const {
    reviewDeliveryProof: _internalDeliveryProof,
    machineJudge,
    ...publicJob
  } = job;
  let publicMachineJudge = machineJudge;
  if (machineJudge) {
    const {
      fullness: _fullness,
      fullPage: _fullPage,
      minimumPageCoverage: _minimumPageCoverage,
      minimumPageCoveragePercent: _minimumPageCoveragePercent,
      issues: _issues,
      ...rest
    } = machineJudge;
    publicMachineJudge = rest;
  }
  return {
    ...publicJob,
    feedback: (job.feedback || []).filter(item =>
      item.visibility !== 'internal' &&
      item.reasonCode !== 'page_coverage_insufficient'
    ),
    machineJudge: publicMachineJudge,
    error: /page coverage|coverage.*minimum/i.test(String(job.error || ''))
      ? null
      : job.error,
    reviewReady: ['rendered', 'approved'].includes(job.status),
  };
};

const humanCampaignView = dataDir => {
  const view = campaignView(dataDir);
  return {
    ...view,
    jobs: view.jobs.map(humanCampaignJob),
  };
};

const humanCampaignError = (error, fallback) => {
  const message = String(error?.message || error || '');
  return /page coverage|coverage.*minimum|delivery proof/i.test(message)
    ? fallback
    : message;
};

const BODY_LIMIT = 2 * 1024 * 1024; // ponytail: 2MB covers resume pastes; raise if a legit payload ever hits it
function readBody(req, res, onBody) {
  let body = '';
  let over = false;
  req.on('data', chunk => {
    if (over) return;
    body += chunk;
    if (body.length > BODY_LIMIT) {
      over = true;
      res.writeHead(413, { 'content-type': 'text/plain' });
      res.end('request body too large');
      req.destroy();
    }
  });
  req.on('end', () => {
    if (!over) onBody(body);
  });
}

const readText = path => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

const readJsonSafe = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

const loadProfile = () => {
  try {
    return JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    return null;
  }
};

const normalizedSkillKey = value => String(value || '').trim().toLowerCase();

const normalizeSkillPolicyInput = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected a JSON object');
  }
  if (!Array.isArray(value.baseline)) {
    throw new Error('baseline must be an array');
  }
  if (!value.rolePacks || typeof value.rolePacks !== 'object' || Array.isArray(value.rolePacks)) {
    throw new Error('rolePacks must be an object of skill arrays');
  }
  const baseline = [...new Set(value.baseline
    .map(item => String(item || '').trim())
    .filter(Boolean))];
  const rolePacks = Object.fromEntries(Object.entries(value.rolePacks)
    .map(([name, skills]) => {
      const packName = String(name || '').trim();
      if (!Array.isArray(skills)) {
        throw new Error(`role pack ${packName || '(unnamed)'} must be an array`);
      }
      return [
        packName,
        [...new Set(skills.map(item => String(item || '').trim()).filter(Boolean))],
      ];
    })
    .filter(([name, skills]) => name && skills.length));
  return { baseline, rolePacks, approve: value.approve === true };
};

function listFiles(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile() && !d.name.startsWith('.'))
      .map(d => d.name)
      .sort();
  } catch {
    return [];
  }
}

function loadApps() {
  // missing file = fresh workspace (empty board); corrupt file must THROW —
  // never silently return [] or a later save would wipe the user's data
  if (!existsSync(input)) return [];
  const apps = JSON.parse(readFileSync(input, 'utf8'));
  if (!Array.isArray(apps)) {
    throw new Error(`${input} must be a JSON array of applications`);
  }
  return apps.map(normalize);
}

{
  const server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(err.message));
    }
  });
  const handle = (req, res) => {
    const hasDist = existsSync(join(webDist, 'index.html'));
    if (req.method === 'GET' && (req.url === '/' || req.url === '/board') && !hasDist) {
      // the console bundle ships committed with the skill, so this only fires
      // on a partial checkout — say exactly how to fix it instead of 404ing
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`console bundle missing at ${webDist}\nbuild it: cd ${webDist}/.. && bun install && bun run build\n(the API on this port keeps working meanwhile)`);
      return;
    }
    if (
      req.method === 'GET' &&
      hasDist &&
      (req.url === '/' || req.url.startsWith('/assets/'))
    ) {
      const rel = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
      const target = resolve(webDist, rel);
      if (
        (target.startsWith(resolve(webDist) + sep)) &&
        existsSync(target) &&
        statSync(target).isFile()
      ) {
        res.writeHead(200, {
          'content-type':
            MIME[extname(target).toLowerCase()] || 'application/octet-stream',
        });
        createReadStream(target).pipe(res);
      } else {
        res.writeHead(404).end();
      }
      return;
    }
    if (req.url === '/api/state' && req.method === 'GET') {
      const apps = loadApps().map(a => ({
        ...a,
        _files: listFiles(join(filesRoot, a.id)),
      }));
      const config = loadConfig(dataDir);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          apps,
          profile: loadProfile(),
          instructions: readText(instructionsPath),
          prefs: intentOf(config),
          globalFiles: listFiles(filesRoot),
          experience: experienceView(dataDir),
          campaign: humanCampaignView(dataDir),
          agent: AGENT_LABEL,
          applyMode: config.headlessApply ? 'headless' : 'manual',
          config: { logoDevToken: config.logoDevToken || null },
        })
      );
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/files/')) {
      const rel = decodeURIComponent(req.url.slice('/files/'.length));
      const target = resolve(filesRoot, rel);
      if (
        !target.startsWith(resolve(filesRoot) + sep) ||
        !existsSync(target) ||
        !statSync(target).isFile()
      ) {
        res.writeHead(404).end();
        return;
      }
      const types = {
        '.md': 'text/plain; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8',
        '.tex': 'text/plain; charset=utf-8',
        '.json': 'application/json',
        '.html': 'text/html; charset=utf-8',
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.docx':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
      res.writeHead(200, {
        'content-type':
          types[extname(target).toLowerCase()] || 'application/octet-stream',
      });
      createReadStream(target).pipe(res);
      return;
    }
    if (req.url === '/api/discover' && req.method === 'GET') {
      if (!existsSync(huntScript)) {
        res.writeHead(501, { 'content-type': 'text/plain' });
        res.end('start skill not installed next to tracker — discovery needs its hunt.mjs');
        return;
      }
      const extra = process.env.COFORCE_SOURCE_FILE
        ? ['--source-file', process.env.COFORCE_SOURCE_FILE]
        : [];
      const out = execFileSync(
        process.execPath,
        [
          huntScript,
          '--config', join(dataDir, 'config.json'),
          '--apps', input,
          '--instructions', instructionsPath,
          ...extra,
        ],
        { encoding: 'utf8', timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(out);
      return;
    }
    if (req.url === '/api/queue' && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          const job = JSON.parse(body);
          if (!job?.url || !job?.role || !job?.company)
            throw new Error('need url, role, company');
          const apps = loadApps();
          if (apps.some(a => a.url === job.url)) {
            res.writeHead(409, { 'content-type': 'text/plain' });
            res.end('already tracked');
            return;
          }
          // instructions.md overrides everything, on EVERY path that queues a
          // job — not just discovery. hunt.mjs filters what it fetches; this
          // is the console's Build-resume button, which used to walk straight
          // past the user's never-apply list.
          if (isNeverApply(job.company, neverApplyFor(dataDir))) {
            res.writeHead(403, { 'content-type': 'text/plain' });
            res.end(`${job.company} is on your never-apply list (instructions.md)`);
            return;
          }
          const now = new Date().toISOString();
          apps.unshift({
            id: `${Date.now()}`,
            url: job.url,
            title: `${job.role} — ${job.company}`,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            company: job.company,
            position: job.role,
            source: job.source || 'console',
            location: job.location || '',
            ...(job.location ? { notes: job.location } : {}),
            history: [
              { date: now, event: `discovered via console (${job.source || 'manual'}) — queued for resume campaign` },
            ],
          });
          writeFileSync(input, `${JSON.stringify(apps, null, 2)}\n`);
          const campaign = syncJobs(dataDir, [{ ...apps[0], role: apps[0].position }]);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: apps[0].id, campaignJobId: campaign.added[0]?.id || null }));
        } catch (err) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end(String(err.message));
        }
      });
      return;
    }
    if (req.url === '/api/campaign' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(humanCampaignView(dataDir)));
      return;
    }
    if (req.url === '/api/campaign/sync' && req.method === 'POST') {
      const pending = loadApps()
        .filter(app => app.status === 'pending')
        .map(app => ({ ...app, role: app.position || app.role }));
      const result = syncJobs(dataDir, pending);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ added: result.added.length, campaign: humanCampaignView(dataDir) }));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/campaign/files/')) {
      const rel = decodeURIComponent(req.url.slice('/campaign/files/'.length).split('?')[0]);
      const target = resolveCampaignFile(dataDir, rel);
      if (!target) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        'content-type': contentTypeFor(target),
        'content-disposition': target.endsWith('.zip')
          ? 'attachment; filename="resume-applications.zip"'
          : 'inline',
      });
      createReadStream(target).pipe(res);
      return;
    }
    const feedbackMatch = req.url?.match(/^\/api\/campaign\/jobs\/([^/]+)\/feedback$/);
    if (feedbackMatch && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          const payload = JSON.parse(body);
          const job = addFeedback(
            dataDir,
            decodeURIComponent(feedbackMatch[1]),
            payload.text,
          );
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(humanCampaignJob(job)));
        } catch (err) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end(String(err.message));
        }
      });
      return;
    }
    const approveMatch = req.url?.match(/^\/api\/campaign\/jobs\/([^/]+)\/approve$/);
    if (approveMatch && req.method === 'POST') {
      try {
        const job = approveJob(dataDir, decodeURIComponent(approveMatch[1]));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(humanCampaignJob(job)));
      } catch (err) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end(humanCampaignError(err, 'Resume is still being prepared and is not ready for review.'));
      }
      return;
    }
    if (req.url === '/api/campaign/export' && req.method === 'POST') {
      try {
        const result = exportCampaign(dataDir);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ...result, url: '/campaign/files/exports/resume-applications.zip' }));
      } catch (err) {
        res.writeHead(409, { 'content-type': 'text/plain' });
        res.end(humanCampaignError(err, 'Some resumes are still being prepared.'));
      }
      return;
    }
    if (req.url === '/api/apply' && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          const config = loadConfig(dataDir);
          if (!config?.headlessApply) {
            res.writeHead(403, { 'content-type': 'text/plain' });
            res.end('background apply not enabled — set "headlessApply": true in ~/.coforce/config.json (asked during setup)');
            return;
          }
          const { url } = JSON.parse(body);
          if (!url) throw new Error('need url');
          const id = `${Date.now()}`;
          const job = {
            id,
            url,
            agent: 'claude',
            sessionId: null,
            logPath: join(applyLogsDir(), `apply-${id}.log`),
          };
          if (job.agent === 'claude') job.sessionId = randomUUID();
          writeFileSync(job.logPath, '');
          spawnAgent(
            job,
            'start',
            `[background ${job.agent} Chrome apply started for ${url}]\n`,
            dataDir
          );
          applyJobs.set(id, job);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id }));
        } catch (err) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end(String(err.message));
        }
      });
      return;
    }
    if (req.url?.startsWith('/api/apply/') && req.method === 'GET') {
      const job = applyJobs.get(req.url.split('/')[3]);
      if (!job) { res.writeHead(404).end(); return; }
      const log = readText(job.logPath);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        status: applyJobStatus(job),
        tail: log.split('\n').slice(-14).join('\n'),
      }));
      return;
    }
    if (req.url?.startsWith('/api/apply/') && req.url.endsWith('/confirm') && req.method === 'POST') {
      const job = applyJobs.get(req.url.split('/')[3]);
      if (!job) { res.writeHead(404).end(); return; }
      if (!job.sessionId) {
        res.writeHead(409, { 'content-type': 'text/plain' });
        res.end(`${AGENT_LABEL} session id is not available yet`);
        return;
      }
      job.confirming = true;
      spawnAgent(
        job,
        'confirm',
        '\n[user confirmed — submitting]\n',
        dataDir
      );
      res.writeHead(204).end();
      return;
    }
    if (req.url?.startsWith('/api/apply/') && req.url.endsWith('/cancel') && req.method === 'POST') {
      const job = applyJobs.get(req.url.split('/')[3]);
      if (job?.child && !job.exited) job.child.kill();
      res.writeHead(204).end();
      return;
    }
    if (req.url === '/api/config' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(loadConfig(dataDir)));
      return;
    }
    if (req.url === '/api/config' && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          const patch = JSON.parse(body);
          if (!patch || typeof patch !== 'object' || Array.isArray(patch))
            throw new Error('expected a JSON object');
          if (Object.hasOwn(patch, 'resumePageCoverageMinimumPercent')) {
            if (
              patch.resumePageCoverageMinimumPercent === '' ||
              patch.resumePageCoverageMinimumPercent === null
            ) {
              throw new Error('resumePageCoverageMinimumPercent is required');
            }
            const value = Number(patch.resumePageCoverageMinimumPercent);
            if (!Number.isFinite(value) || value < 0 || value > 100) {
              throw new Error('resumePageCoverageMinimumPercent must be a number from 0 to 100');
            }
            patch.resumePageCoverageMinimumPercent = value;
          }
          saveConfig(dataDir, patch);
          if (Object.hasOwn(patch, 'resumePageCoverageMinimumPercent')) {
            reconcileResumePageCoverage(dataDir);
          }
          if (patch.requireResumeReview === false) applyResumeReviewPolicy(dataDir);
          res.writeHead(204).end();
        } catch (err) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end(String(err.message));
        }
      });
      return;
    }
    if (req.url === '/api/prefs' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(intentOf(loadConfig(dataDir))));
      return;
    }
    if (req.url === '/api/prefs' && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          // The console only ever edits the keys it knows — a filter click
          // posts {level, directions}. saveConfig MERGES, so the keys it does
          // not know (visa status, work mode, salary floor) survive.
          saveConfig(dataDir, JSON.parse(body));
          res.writeHead(204).end();
        } catch (err) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end(String(err.message));
        }
      });
      return;
    }
    if (req.url === '/api/profile' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(loadProfile()));
      return;
    }
    if (req.url === '/api/skills/policy' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        review: skillReview(dataDir),
        skills: skillPool(dataDir),
      }));
      return;
    }
    if (req.url === '/api/skills/policy' && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          const inputPolicy = normalizeSkillPolicyInput(JSON.parse(body));
          const availableSkills = skillPool(dataDir);
          const canonicalNames = new Map(availableSkills
            .map(skill => [normalizedSkillKey(skill.name), skill.name]));
          const referenced = [
            ...inputPolicy.baseline,
            ...Object.values(inputPolicy.rolePacks).flat(),
          ];
          const unknown = [...new Set(referenced
            .filter(name => !canonicalNames.has(normalizedSkillKey(name))))];
          if (unknown.length) {
            throw new Error(`policy references skills outside the merged pool: ${unknown.join(', ')}`);
          }
          const canonicalize = names => names.map(name => canonicalNames.get(normalizedSkillKey(name)));
          const baseline = canonicalize(inputPolicy.baseline);
          const rolePacks = Object.fromEntries(Object.entries(inputPolicy.rolePacks)
            .map(([name, names]) => [name, canonicalize(names)]));
          if (inputPolicy.approve && !baseline.length) {
            throw new Error('approval requires at least one baseline skill');
          }
          if (inputPolicy.approve && !Object.keys(rolePacks).length) {
            throw new Error('approval requires at least one non-empty role pack');
          }
          const profile = loadProfile();
          if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
            throw new Error('profile.json is missing or invalid');
          }
          profile.resumeSkillPolicy = {
            status: inputPolicy.approve ? 'approved' : 'review_requested',
            baseline,
            rolePacks,
            reviewedAt: inputPolicy.approve ? new Date().toISOString() : null,
          };
          writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            policy: profile.resumeSkillPolicy,
            review: skillReview(dataDir),
            skills: skillPool(dataDir),
          }));
        } catch (err) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end(String(err.message));
        }
      });
      return;
    }
    if (req.url === '/api/profile' && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          const profile = JSON.parse(body);
          if (!profile || typeof profile !== 'object' || Array.isArray(profile))
            throw new Error('expected a JSON object');
          writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
          res.writeHead(204).end();
        } catch (err) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end(String(err.message));
        }
      });
      return;
    }
    if (req.url === '/api/import' && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          const { text } = JSON.parse(body);
          if (!text?.trim()) throw new Error('empty resume text');
          const out = runAgentImport(text, dataDir);
          const jsonText = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
          const profile = JSON.parse(jsonText);
          if (!profile || typeof profile !== 'object' || Array.isArray(profile))
            throw new Error('parser returned a non-object');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(profile));
        } catch (err) {
          const hint = /ENOENT/.test(String(err.message))
            ? 'claude CLI not found on PATH — install Claude Code, or set $COFORCE_CLAUDE_BIN'
            : err.message;
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(String(hint));
        }
      });
      return;
    }
    // Additive channel: raw material (experience story, award link, certificate)
    // → agent returns ONLY new entries; the client reviews and merges — the
    // profile on disk is untouched until the user saves.
    if (req.url === '/api/profile/add' && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          const { text } = JSON.parse(body);
          if (!text?.trim()) throw new Error('empty material');
          const profile = readJsonSafe(profilePath) ?? {};
          const out = runAgentAdd(text, profile, dataDir);
          const jsonText = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
          const additions = JSON.parse(jsonText);
          if (!additions || typeof additions !== 'object' || Array.isArray(additions))
            throw new Error('agent returned a non-object');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(additions));
        } catch (err) {
          const hint = /ENOENT/.test(String(err.message))
            ? 'claude CLI not found on PATH — install Claude Code, or set $COFORCE_CLAUDE_BIN'
            : err.message;
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(String(hint));
        }
      });
      return;
    }
    if (req.url === '/api/instructions' && req.method === 'POST') {
      readBody(req, res, body => {
        // whole-file replace is right for a textarea, but an empty body is
        // never a legitimate save — it would silently truncate the user's
        // standing rules and never-apply list
        if (!body.trim()) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end('refusing to save empty instructions — delete the file by hand if you mean it');
          return;
        }
        writeFileSync(instructionsPath, body);
        res.writeHead(204).end();
      });
      return;
    }
    if (req.url === '/api/apps' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(loadApps()));
      return;
    }
    if (req.url === '/api/apps' && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          const apps = JSON.parse(body);
          if (!Array.isArray(apps)) throw new Error('expected array');
          writeFileSync(input, `${JSON.stringify(apps, null, 2)}\n`);
          res.writeHead(204).end();
        } catch (err) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end(String(err.message));
        }
      });
      return;
    }
    res.writeHead(404).end();
  };
  server.listen(port, '127.0.0.1', () => {
    const actual = server.address().port;
    console.log(`console: http://localhost:${actual} (writes ${input})`);
  });
}
