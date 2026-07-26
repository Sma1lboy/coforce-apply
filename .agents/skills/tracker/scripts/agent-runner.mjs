// agent-runner.mjs — the console's adapter onto the local agent CLI.
//
// Claude Code is the only implemented runtime. Everything runtime-specific is
// confined to two functions: agentRun (spawn args) and parseLine (stdout →
// normalized COFORCE_STATUS marks). Everything else — line buffering, per-run
// mark segments, the job state machine, the silence watchdog — is runtime-
// neutral and consumes only normalized marks.
//
// TODO(codex): Codex support was removed (see git history for the `codex exec
// --json` spawn args and the JSONL thread-event parser). Re-adding a runtime
// means an entry in these two functions plus a runtime field on the job — the
// state machine below must stay branch-free.
import { appendFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

const APPLY_STATUS_RE = /COFORCE_STATUS:\s*(READY_TO_SUBMIT|SUBMITTED|FAILED)/g;

export const AGENT_LABEL = 'Claude';

const claudeBin = () => process.env.COFORCE_CLAUDE_BIN || 'claude';

const CONFIRM_APPLY_PROMPT =
  'User confirmed in the CoForce console — continue in the same Chrome-backed application session and submit the application now. After the submission is verifiably in, print exactly "COFORCE_STATUS: SUBMITTED" and update ~/.coforce/applications.json (status applied + history event). If submission fails print "COFORCE_STATUS: FAILED" plus the reason.';

const headlessApplyPrompt = url =>
  `/apply ${url}\n\nBACKGROUND MODE: no interactive terminal user is attached. The apply skill must initialize the configured Chrome integration itself and follow its background protocol exactly: read ~/.coforce data, complete the entire application (registering an ATS account only if config.json consents), but STOP BEFORE the final submit. Then print exactly "COFORCE_STATUS: READY_TO_SUBMIT" followed by a short summary of what was filled. If you hit an unrecoverable blocker (captcha, missing required info, or unavailable Chrome integration), print "COFORCE_STATUS: FAILED" plus the reason. Never submit in this run.`;

const IMPORT_PROMPT = `Parse the resume text from stdin into a JSON object with exactly this shape (all fields optional, omit anything absent):
{"name","title","email","phone","location","linkedin","github","website","summary","skills":[string],"education":[{"institution","degree","date","location"}],"experience":[{"company","title","date","location","description":[{"text","textZh":null}]}],"projects":[{"name","technologies","dateRange","description":[{"text","textZh":null}]}],"customSections":[{"title","entries":[{"heading","subheading","date","description":[{"text","textZh":null}]}]}]}
Sections that are not Experience/Projects/Education/Skills (Awards, Publications, Certifications, Leadership, Volunteering…) go into customSections with their original section title.
Rules: linkedin/github are bare handles, not URLs; keep bullet text verbatim; dates verbatim; never invent data that is not in the text. Output ONLY the JSON object, no markdown fences, no commentary.`;

const ADD_PROMPT = `Stdin is JSON {"profile": <the user's current profile>, "material": <new raw material they want added>}. The material may be a work-experience story, an award or competition result (possibly just a URL plus a note), a certificate, a publication, or a pasted LinkedIn section. Return ONLY the new entries to append, as a JSON object using this partial profile shape (include only the keys you are adding to):
{"skills":[string],"experience":[{"company","title","date","location","url","description":[{"text","textZh":null,"source"}]}],"projects":[{"name","technologies","dateRange","url","description":[{"text","textZh":null,"source"}]}],"education":[{"institution","degree","date","location"}],"certifications":[{"name","issuer","date"}],"customSections":[{"title","entries":[{"heading","subheading","date","description":[{"text","textZh":null,"source"}]}]}],"notes":string}
Rules:
- Additive only: never restate entries already in the profile; if the material duplicates an existing entry, return {} with a note saying so.
- Awards/honors/competitions/publications/leadership go into customSections — reuse an existing section title from the profile when one fits (e.g. "Awards"), otherwise pick a conventional one.
- Rewrite narrative into concise STAR resume bullets (action verb + what + measurable result), but never invent facts, metrics, or dates that are not in the material; dates verbatim.
- If the material contains URLs, set them as the entry "url" and as "source" on the bullets they evidence. If the material is only a URL and your tooling lets you fetch it, extract verbatim facts from the page; otherwise use what you were given.
- Put anything you could NOT determine (missing date, missing metric worth asking the user for) into "notes" as one short sentence.
Output ONLY the JSON object, no markdown fences, no commentary.`;

function agentRun(mode, job) {
  return mode === 'start'
    ? [
        '--chrome', '-p', '--session-id', job.sessionId,
        '--dangerously-skip-permissions', headlessApplyPrompt(job.url),
      ]
    : [
        '--chrome', '-p', '--resume', job.sessionId,
        '--dangerously-skip-permissions', CONFIRM_APPLY_PROMPT,
      ];
}

// stdout → normalized marks. Claude prints the sentinels straight into its
// transcript output.
function parseLine(job, line) {
  for (const m of line.matchAll(APPLY_STATUS_RE)) job.statusMarks.push(m[1]);
}

// sentinels can split across chunk boundaries — buffer to whole lines
function feed(job, chunk, flush = false) {
  job.stdoutBuffer = `${job.stdoutBuffer || ''}${chunk}`;
  const lines = job.stdoutBuffer.split('\n');
  job.stdoutBuffer = flush ? '' : lines.pop();
  for (const line of lines) parseLine(job, line);
}

export function spawnAgent(job, mode, extraLog, dataDir) {
  // fresh mark segment for EVERY spawn — a confirm/retry run must never be
  // judged by sentinels from the previous run
  job.statusMarks = [];
  job.stdoutBuffer = '';
  appendFileSync(job.logPath, extraLog);
  const child = spawn(claudeBin(), agentRun(mode, job), {
    cwd: dataDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = d => appendFileSync(job.logPath, d);
  child.stdout.on('data', d => {
    feed(job, d.toString());
    append(d);
  });
  child.stderr.on('data', append);
  child.on('exit', code => {
    clearTimeout(job.watchdog);
    if (job.stdoutBuffer) feed(job, '\n', true);
    job.exited = true;
    job.confirming = false;
    append(`\n[${AGENT_LABEL} exited ${code}]\n`);
  });
  child.on('error', err => {
    clearTimeout(job.watchdog);
    job.exited = true;
    job.confirming = false;
    append(`\n[${AGENT_LABEL} failed to start: ${err.message}]\n`);
  });
  // watchdog: a silently hung agent must not pin the job in running/confirming forever
  clearTimeout(job.watchdog);
  job.watchdog = setTimeout(() => {
    if (!job.exited) {
      append(`\n[watchdog: ${AGENT_LABEL} produced no exit for 15 min — killing run]\n`);
      child.kill();
    }
  }, 15 * 60_000);
  job.watchdog.unref?.();
  job.child = child;
  job.exited = false;
  return child;
}

// One state machine over normalized marks — no per-runtime branches.
export function applyJobStatus(job) {
  const last = job.statusMarks?.at(-1);
  if (last === 'SUBMITTED') return 'submitted';
  if (last === 'FAILED') return job.exited ? 'failed' : 'running';
  if (last === 'READY_TO_SUBMIT' && !job.confirming) return 'awaiting_confirm';
  if (job.exited && !job.confirming) return last ? 'awaiting_confirm' : 'error';
  return 'running';
}

function runAgentPrompt(prompt, input, dataDir) {
  return execFileSync(claudeBin(), ['-p', prompt], {
    cwd: dataDir,
    input,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export function runAgentImport(text, dataDir) {
  return runAgentPrompt(IMPORT_PROMPT, text, dataDir);
}

export function runAgentAdd(material, profile, dataDir) {
  return runAgentPrompt(ADD_PROMPT, JSON.stringify({ profile, material }), dataDir);
}
