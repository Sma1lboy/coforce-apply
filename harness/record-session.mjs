#!/usr/bin/env node
// Capture a REAL agent session running the setup skill, turn by turn, in a
// sandbox — the artifact is the complete interaction script (every agent
// question, every tool call, every reply), which is what you tune SKILL.md
// against. Not deterministic, not part of `npm run harness` — this is the
// prompt-tuning loop's instrument.
//
//   npm run record:session          # drives `claude -p` (session-id + resume)
//   COFORCE_CLAUDE_BIN=...          # override the binary (tests use the stub)
//
// Outputs under harness/out/session-recording/:
//   transcript.json  — structured turns (text + tool calls, verbatim)
//   transcript.md    — the readable interaction script
//   transcript.html  — chat-style page (shareable, Hallmark theme)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out', 'session-recording');
const sandbox = join(outDir, 'coforce');
mkdirSync(sandbox, { recursive: true });

const bin = process.env.COFORCE_CLAUDE_BIN || 'claude';
const sessionId = randomUUID();
const repoRoot = join(here, '..');

// The scripted user — edit these to probe how the setup conversation reacts.
const KICKOFF = `Run the setup skill of this repository now (skill file: .claude/skills/setup/SKILL.md).
IMPORTANT sandbox override for this entire session: use ${sandbox} as the CoForce data home instead of ~/.coforce — never touch the real ~/.coforce.
Walk me through setup stage by stage. Ask me your questions in batches per stage and WAIT for my answers; do not invent answers on my behalf. Start with stage 1 now.`;

// Real input, sandboxed output: point COFORCE_RESUME_PDF (or _TXT) at your
// actual resume to capture the real import conversation; the fixture persona
// is only the fallback so anyone can run this.
const resumePdf = process.env.COFORCE_RESUME_PDF;
const resumeTxt = process.env.COFORCE_RESUME_TXT;
const profileTurn = resumePdf
  ? `Import my profile from my real resume PDF at ${resumePdf} — read the file directly.`
  : resumeTxt
    ? `Import my profile from my real resume text file at ${resumeTxt} — read the file directly.`
    : `Import my profile from this resume text instead of an interview:
Jane Builder — Software Engineer. jane@example.com · 555-0100 · github: janebuilder · linkedin: jane-builder
Experience: Acme Robotics, Backend Intern (2025): built a Go telemetry ingestion service handling 50k msgs/min; cut p99 latency 45% with Redis caching. Orchard Labs, Full-stack Intern (2024): shipped a React + Spring Boot inventory app used by 30 stores.
Projects: trailmap (github.com/janebuilder/trailmap): open-source hiking route planner, 800 stars, Next.js + PostGIS.
Education: State University, BS Computer Science, 2026. Skills: Go, TypeScript, Java, React, Spring Boot, PostgreSQL, Redis, Docker.`;

const USER_TURNS = [
  profileTurn,
  `Preferences: internship level; directions backend and fullstack; I need visa sponsorship (F-1 OPT); work mode remote or hybrid; locations US Remote or Seattle; no salary floor.`,
  `Apply config: LaTeX template at ${join(repoRoot, '.agents/skills/tailor/assets/resume_template.tex')}; yes require resume review; email jane.sandbox@example.com; do NOT auto-register ATS accounts; mailbox access paste; resume pdf at ${join(sandbox, 'resume.pdf')}; headless apply NO. Keep the default job sources.`,
  `Skip the experience/Tier-0 stage for now. Standing instructions: never apply to EvilCorp or DataHarvest Inc; prefer remote-first teams; keep a professional, concise tone.`,
  `That all looks right — finish setup and summarize what was written where. Do not start the console server; just tell me the command.`,
];

const runTurn = (prompt, resume) => {
  const args = [
    '-p',
    ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
    '--add-dir', sandbox,
  ];
  const raw = execFileSync(bin, args, {
    cwd: repoRoot,
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60_000,
  });
  const events = raw.split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const texts = [];
  const tools = [];
  for (const event of events) {
    if (event.type === 'assistant') {
      for (const block of event.message?.content || []) {
        if (block.type === 'text' && block.text?.trim()) texts.push(block.text.trim());
        if (block.type === 'tool_use') {
          const input = JSON.stringify(block.input ?? {});
          tools.push({ name: block.name, input: input.length > 220 ? `${input.slice(0, 220)}…` : input });
        }
      }
    }
  }
  const result = events.find(event => event.type === 'result');
  return { texts, tools, costUsd: result?.total_cost_usd ?? null, durationMs: result?.duration_ms ?? null };
};

const transcript = [];
const record = (role, content) => transcript.push({ turn: transcript.length, role, ...content });

console.log(`record-session: driving REAL ${bin} session ${sessionId.slice(0, 8)}… (${USER_TURNS.length + 1} turns)`);
record('user', { texts: [KICKOFF], tools: [] });
let reply = runTurn(KICKOFF, false);
record('agent', reply);
console.log(`  turn 1/${USER_TURNS.length + 1} done (${reply.tools.length} tool calls)`);
USER_TURNS.forEach((message, index) => {
  record('user', { texts: [message], tools: [] });
  reply = runTurn(message, true);
  record('agent', reply);
  console.log(`  turn ${index + 2}/${USER_TURNS.length + 1} done (${reply.tools.length} tool calls)`);
});

// light harness assertions: the conversation must actually have built the home
const wrote = name => existsSync(join(sandbox, name));
const checks = {
  profile: wrote('profile.json'),
  preferences: wrote('preferences.json'),
  applyConfig: wrote('apply-config.json'),
  instructions: wrote('instructions.md'),
};
console.log('sandbox state:', JSON.stringify(checks));

writeFileSync(join(outDir, 'transcript.json'), `${JSON.stringify({ sessionId, bin, sandbox, checks, transcript }, null, 2)}\n`);

const md = ['# CoForce /setup — real session interaction script', '',
  `- session: \`${sessionId}\` · agent: \`${bin}\` · sandbox: \`${sandbox}\``,
  `- files written: ${Object.entries(checks).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join(' · ')}`, ''];
for (const entry of transcript) {
  md.push(`## Turn ${Math.floor(entry.turn / 2) + 1} — ${entry.role === 'user' ? '👤 user' : '◆ agent'}`, '');
  for (const text of entry.texts) md.push(text, '');
  if (entry.tools?.length) {
    md.push('<details><summary>tool calls</summary>', '');
    for (const tool of entry.tools) md.push(`- \`${tool.name}\` ${tool.input}`);
    md.push('', '</details>', '');
  }
}
writeFileSync(join(outDir, 'transcript.md'), `${md.join('\n')}\n`);

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const bubbles = transcript.map(entry => {
  const tools = entry.tools?.length
    ? `<details><summary>${entry.tools.length} tool calls</summary>${entry.tools.map(tool => `<div class="tool"><b>${esc(tool.name)}</b> <code>${esc(tool.input)}</code></div>`).join('')}</details>`
    : '';
  return `<div class="msg ${entry.role}"><div class="who">${entry.role === 'user' ? '👤 user' : '◆ agent'}</div><div class="body">${entry.texts.map(text => `<p>${esc(text).replaceAll('\n', '<br>')}</p>`).join('')}${tools}</div></div>`;
}).join('\n');
writeFileSync(join(outDir, 'transcript.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CoForce /setup — real session transcript</title>
<style>body{background:#181310;color:#f2e7dd;font:14px/1.6 "Space Grotesk",system-ui,sans-serif;max-width:900px;margin:0 auto;padding:40px 20px}
h1{color:#d97b57;font-size:20px} .meta{color:#8a7666;font-family:ui-monospace,monospace;font-size:12px;margin-bottom:24px}
.msg{display:flex;gap:12px;margin:14px 0}.who{flex:0 0 84px;color:#8a7666;font-size:12px;padding-top:10px;text-align:right}
.body{flex:1;background:#221a15;border:1px solid #4a382d;border-radius:12px;padding:10px 16px;overflow-wrap:anywhere}
.msg.user .body{background:#2a201a;border-color:#5c4a3a}.msg.user .who{color:#d9b06b}
.msg.agent .who{color:#d97b57}
p{margin:8px 0} code{font-family:ui-monospace,monospace;font-size:11.5px;color:#d9b06b}
details{margin:8px 0;color:#b9a695;font-size:12px}summary{cursor:pointer;color:#8a7666}
.tool{margin:6px 0;padding:6px 10px;background:#181310;border-radius:8px;border:1px solid #38291f}</style></head><body>
<h1>CoForce /setup — real session transcript</h1>
<div class="meta">session ${esc(sessionId)} · ${esc(bin)} · sandbox ${esc(sandbox)}<br>files: ${Object.entries(checks).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join(' · ')}</div>
${bubbles}</body></html>\n`);

console.log(`record-session: done`);
console.log(`  script : ${join(outDir, 'transcript.md')}`);
console.log(`  chat   : ${join(outDir, 'transcript.html')}`);
console.log(`  raw    : ${join(outDir, 'transcript.json')}`);
