// Local application-tracker board: applications JSON → interactive kanban HTML.
// Ships inside the tracker skill; user data lives in ~/.coforce/.
//
//   node board.mjs [input.json] [output.html]   # render static file
//   node board.mjs [input.json] --serve [port]  # live board, drag persists
//
// Defaults: ~/.coforce/applications.json → ~/.coforce/out/board.html, port 4517.
// Serve mode regenerates on every GET and writes drags back to the input JSON
// (POST /api/apps). Static mode falls back to a "copy JSON" bar after a drag.
// Theme: kobe "Hallmark" tokens (terracotta on warm dark) — the CoForce brand look.

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
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addFeedback,
  applyResumeReviewPolicy,
  approveJob,
  campaignView,
  contentTypeFor,
  exportCampaign,
  resolveCampaignFile,
  syncJobs,
} from '../../campaign/scripts/campaign-lib.mjs';
import { experienceView } from '../../experience/scripts/experience-lib.mjs';
import {
  agentLabel,
  applyJobStatus,
  runAgentAdd,
  runAgentImport,
  selectedAgent,
  spawnAgent,
} from './agent-runner.mjs';
import { renderBoard } from './legacy-render.mjs';

// hunt.mjs lives in the sibling start skill (all skills install together)
const huntScript = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../start/scripts/hunt.mjs'
);
// prebuilt React console (tracker/web) — served at / when present;
// the inline-rendered page stays available at /legacy as fallback
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

const HOME = join(homedir(), '.coforce');
const args = process.argv.slice(2);
const serveIdx = args.indexOf('--serve');
const serve = serveIdx !== -1;
// port 0 is valid (ephemeral) — don't let || swallow it
const portArg = serve ? args[serveIdx + 1] : undefined;
const hasPortArg = portArg !== undefined && /^\d+$/.test(portArg);
const port = serve ? (hasPortArg ? Number(portArg) : 4517) : null;
const positional = args.filter(
  (a, i) => a !== '--serve' && !(hasPortArg && i === serveIdx + 1)
);
const [
  input = join(HOME, 'applications.json'),
  output = join(HOME, 'out', 'board.html'),
] = positional;

// --- background Chrome apply job runner ---------------------------------
// POST /api/apply starts the configured local agent (Codex or Claude) in the
// background. The skill's background protocol stops BEFORE the final submit and
// prints COFORCE_STATUS: READY_TO_SUBMIT. The user confirms in the console
// dialog → POST .../confirm resumes the same session to submit. Gated on the
// user's standing consent (`headlessApply` in apply-config.json, retained for
// compatibility with existing installations).
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
const prefsPath = join(dataDir, 'preferences.json');

// everything the legacy page needs, gathered here so legacy-render stays pure
const renderCtx = () => {
  const runtime = selectedAgent(readJsonSafe(join(dataDir, 'apply-config.json')));
  return {
    profile: loadProfile(),
    instructions: readText(instructionsPath),
    prefs: readJsonSafe(prefsPath),
    runtime,
    runtimeLabel: agentLabel(runtime),
    filesRoot,
    instructionsPath,
    serve,
    listFiles,
  };
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

if (serve) {
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
    if (
      req.method === 'GET' &&
      (req.url === '/legacy' ||
        ((req.url === '/' || req.url === '/board') && !hasDist))
    ) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderBoard(loadApps(), renderCtx()));
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
      const config = readJsonSafe(join(dataDir, 'apply-config.json')) ?? {};
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          apps,
          profile: loadProfile(),
          instructions: readText(instructionsPath),
          prefs: existsSync(prefsPath)
            ? JSON.parse(readFileSync(prefsPath, 'utf8'))
            : null,
          globalFiles: listFiles(filesRoot),
          experience: experienceView(dataDir),
          campaign: campaignView(dataDir),
          agent: selectedAgent(config),
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
          '--config', join(dataDir, 'apply-config.json'),
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
      res.end(JSON.stringify(campaignView(dataDir)));
      return;
    }
    if (req.url === '/api/campaign/sync' && req.method === 'POST') {
      const pending = loadApps()
        .filter(app => app.status === 'pending')
        .map(app => ({ ...app, role: app.position || app.role }));
      const result = syncJobs(dataDir, pending);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ added: result.added.length, campaign: campaignView(dataDir) }));
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
          const job = addFeedback(dataDir, decodeURIComponent(feedbackMatch[1]), payload.text);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(job));
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
        res.end(JSON.stringify(job));
      } catch (err) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end(String(err.message));
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
        res.end(String(err.message));
      }
      return;
    }
    if (req.url === '/api/apply' && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          const config = readJsonSafe(join(dataDir, 'apply-config.json'));
          if (!config?.headlessApply) {
            res.writeHead(403, { 'content-type': 'text/plain' });
            res.end('background apply not enabled — set "headlessApply": true in ~/.coforce/apply-config.json (asked during setup)');
            return;
          }
          const { url } = JSON.parse(body);
          if (!url) throw new Error('need url');
          const id = `${Date.now()}`;
          const job = {
            id,
            url,
            agent: selectedAgent(config),
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
        res.end(`${agentLabel(job.agent)} session id is not available yet`);
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
      res.end(JSON.stringify(readJsonSafe(join(dataDir, 'apply-config.json')) ?? {}));
      return;
    }
    if (req.url === '/api/config' && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          const patch = JSON.parse(body);
          if (!patch || typeof patch !== 'object' || Array.isArray(patch))
            throw new Error('expected a JSON object');
          const merged = { ...(readJsonSafe(join(dataDir, 'apply-config.json')) ?? {}), ...patch };
          writeFileSync(join(dataDir, 'apply-config.json'), `${JSON.stringify(merged, null, 2)}\n`);
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
      res.end(existsSync(prefsPath) ? readFileSync(prefsPath, 'utf8') : 'null');
      return;
    }
    if (req.url === '/api/prefs' && req.method === 'POST') {
      readBody(req, res, body => {
        try {
          const prefs = JSON.parse(body);
          if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs))
            throw new Error('expected a JSON object');
          // preferences.json is the canonical user-intent file (schema: setup
          // skill); the console only edits the keys it knows, so merge into
          // whatever setup collected instead of clobbering the whole file
          const existing = readJsonSafe(prefsPath);
          const merged = {
            ...(existing && typeof existing === 'object' ? existing : {}),
            ...prefs,
            version: 1,
          };
          writeFileSync(prefsPath, `${JSON.stringify(merged, null, 2)}\n`);
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
          const config = readJsonSafe(join(dataDir, 'apply-config.json')) ?? {};
          const agent = selectedAgent(config);
          const out = runAgentImport(agent, text, dataDir);
          const jsonText = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
          const profile = JSON.parse(jsonText);
          if (!profile || typeof profile !== 'object' || Array.isArray(profile))
            throw new Error('parser returned a non-object');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(profile));
        } catch (err) {
          const hint = /ENOENT/.test(String(err.message))
            ? 'configured agent CLI not found — check Settings → Agent runtime or edit ~/.coforce/apply-config.json'
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
          const config = readJsonSafe(join(dataDir, 'apply-config.json')) ?? {};
          const agent = selectedAgent(config);
          const profile = readJsonSafe(profilePath) ?? {};
          const out = runAgentAdd(agent, text, profile, dataDir);
          const jsonText = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
          const additions = JSON.parse(jsonText);
          if (!additions || typeof additions !== 'object' || Array.isArray(additions))
            throw new Error('agent returned a non-object');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(additions));
        } catch (err) {
          const hint = /ENOENT/.test(String(err.message))
            ? 'configured agent CLI not found — check Settings → Agent runtime or edit ~/.coforce/apply-config.json'
            : err.message;
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(String(hint));
        }
      });
      return;
    }
    if (req.url === '/api/instructions' && req.method === 'POST') {
      readBody(req, res, body => {
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
} else {
  let apps;
  try {
    apps = loadApps();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, renderBoard(apps, renderCtx()));
  console.log(`board: ${apps.length} applications → ${output}`);
}
