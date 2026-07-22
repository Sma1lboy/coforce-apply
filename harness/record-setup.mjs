#!/usr/bin/env node
// Setup-flow recording harness, kobe-quicklook style: a scripted driver runs
// the REAL pipeline commands in a throwaway sandbox, snapshots the terminal as
// timestamped text frames, and asserts the sandbox state after every step —
// the capture IS the verification. Outputs:
//
//   harness/out/setup-recording/frames.json   — kobe-compatible capture doc
//   harness/out/setup-recording/replay.html   — self-contained animated replay
//   harness/out/setup-recording/setup-demo.mp4 — via qlmanage+ffmpeg (macOS;
//                                                skipped gracefully elsewhere)
//
//   npm run record:setup
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedSandbox } from './sandbox.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out', 'setup-recording');
mkdirSync(outDir, { recursive: true });
const home = seedSandbox(join(outDir, 'coforce'));
const campaignCli = join(here, '../.agents/skills/campaign/scripts/campaign.mjs');
const huntCli = join(here, '../.agents/skills/start/scripts/hunt.mjs');

const COLS = 100;
const ROWS = 32;
const start = Date.now();
const term = [];
const frames = [];

const clip = line => (line.length > COLS ? `${line.slice(0, COLS - 1)}…` : line);
const snapshot = () => {
  const visible = term.slice(-ROWS).map(clip);
  const last = frames.at(-1);
  if (last && JSON.stringify(last.lines) === JSON.stringify(visible)) return;
  frames.push({ t: Date.now() - start, lines: visible });
};
const print = (...lines) => {
  for (const line of lines) {
    term.push(line);
    snapshot();
  }
};
const sh = (bin, args, env = {}) => {
  print(`$ ${[bin.split('/').at(-1), ...args.map(a => (a.startsWith('/') ? a.split('/').at(-1) : a))].join(' ')}`);
  const out = execFileSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  print(...out.trim().split('\n').slice(0, 14).map(l => `  ${l}`));
  return out;
};
const say = (who, text) => print(`${who === 'user' ? '›' : '◆'} ${text}`);
const gap = () => print('');

// ---- Act 1: onboarding writes the data home ---------------------------------
print('━━ CoForce Apply — setup, recorded in a sandbox ━━', '');
say('user', 'claude');
say('agent', 'Claude Code v2 — /setup');
gap();
say('agent', 'Stage 1 · Profile — imported from your resume (21 verified bullets).');
assert.equal(JSON.parse(readFileSync(join(home, 'profile.json'), 'utf8')).name, 'John Doe');
say('agent', `profile.json ✓  (name: John Doe, experience ×2, projects ×1)`);
gap();
say('agent', 'Stage 2 · Preferences — level? sponsorship? work mode? locations?');
say('user', 'internship · need sponsorship (F-1 OPT) · any mode · US Remote / Bay Area');
const prefs = JSON.parse(readFileSync(join(home, 'preferences.json'), 'utf8'));
assert.equal(prefs.needsSponsorship, true);
assert.equal(prefs.version, 1);
say('agent', 'preferences.json ✓  (canonical intent — every skill reads this)');
gap();
say('agent', 'Stage 3 · Apply config + standing instructions written.');
assert.equal(JSON.parse(readFileSync(join(home, 'apply-config.json'), 'utf8')).headlessApply, false);
assert.ok(readFileSync(join(home, 'instructions.md'), 'utf8').includes('never-apply'));
say('agent', 'apply-config.json ✓ · instructions.md ✓ (never-apply list respected everywhere)');
gap();

// ---- Act 2: discover → tracker (real hunt run) ------------------------------
print('━━ /start — discover real postings ━━', '');
sh(huntCli, [
  '--track',
  '--source-file', join(here, 'fixtures/source-jobs.md'),
  '--apps', join(home, 'applications.json'),
  '--instructions', join(home, 'instructions.md'),
  '--config', join(home, 'apply-config.json'),
]);
const apps = JSON.parse(readFileSync(join(home, 'applications.json'), 'utf8'));
assert.ok(apps.filter(a => a.status === 'pending').length >= 2, 'hunt tracked pending jobs');
say('agent', `tracked ${apps.length} postings as pending (deduped, never-apply filtered)`);
gap();

// ---- Act 3: campaign — pool → strict selection → render gates ---------------
print('━━ /campaign — verified pool → strict selection ━━', '');
sh(campaignCli, ['sync', '--data-dir', home, '--apps', join(home, 'applications.json')]);
const pool = JSON.parse(sh(campaignCli, ['pool', '--data-dir', home]));
assert.ok(pool.length >= 5, 'verified pool from profile bullets');
say('agent', `pool: ${pool.length} verified bullets — selection may ONLY use these ids`);
const jobs = JSON.parse(execFileSync(process.execPath, [campaignCli, 'show', '--data-dir', home], { encoding: 'utf8' })).jobs;
const job = jobs[0];
const jdPath = join(outDir, 'jd.txt');
writeFileSync(jdPath, `Software Engineer Intern. ${'TypeScript, React, Java, Spring Boot microservices, CI/CD, testing. '.repeat(10)}`);
sh(campaignCli, ['hydrate', '--data-dir', home, '--id', job.id, '--file', jdPath]);
const picks = pool.slice(0, Math.min(8, pool.length)).map(b => b.id);
sh(campaignCli, ['select', '--data-dir', home, '--id', job.id, '--bullets', picks.join(',')]);
say('agent', `selected ${picks.length} bullets — out-of-pool ids are structurally rejected:`);
let rejected = false;
try {
  execFileSync(process.execPath, [campaignCli, 'select', '--data-dir', home, '--id', job.id, '--bullets', 'deadbeef'], { encoding: 'utf8', stdio: 'pipe' });
} catch (err) {
  rejected = true;
  print(`  ✗ ${String(err.stderr || '').trim().split('\n')[0]}`);
}
assert.ok(rejected, 'fabricated id must be rejected');
gap();

// stage fixture artifacts (no LaTeX dependency in the recording), judge gates
const view = JSON.parse(execFileSync(process.execPath, [campaignCli, 'show', '--data-dir', home], { encoding: 'utf8' })).jobs.find(j => j.id === job.id);
const jobDir = join(home, 'campaigns', 'current', 'jobs', view.folder);
writeFileSync(join(jobDir, 'resume.tex'), '\\documentclass{article}\\begin{document}\\newcommand{\\resumeItem}[1]{#1}\n'
  + picks.map(id => `\\resumeItem{${pool.find(b => b.id === id).text}}`).join('\n')
  + '\n\\end{document}\n');
copyFixturePdf(join(jobDir, 'resume.pdf'));
const judge = JSON.parse(sh(campaignCli, ['judge', '--data-dir', home, '--id', job.id]));
assert.equal(judge.verbatim, true, 'every resume line is a pool bullet, verbatim');
say('agent', `judge: onePage=${judge.onePage} fullPage=${judge.fullPage} verbatim=${judge.verbatim} — llm review next, then human Review, then the ⛔ submit gate`);
gap();
print('━━ done — console: npm run sandbox → http://127.0.0.1:4519 ━━');
snapshot();

function copyFixturePdf(target) {
  // same minimal full-page one-pager the campaign harness uses
  const label = 'CoForce sandbox resume';
  const stream = `BT /F1 20 Tf 72 720 Td (${label}) Tj ET BT /F1 12 Tf 72 40 Td (page filled to the bottom margin) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(target, Buffer.from(body));
}

// ---- outputs ----------------------------------------------------------------
const capture = { cols: COLS, rows: ROWS, frames, meta: { theme: 'coforce-hallmark' } };
writeFileSync(join(outDir, 'frames.json'), `${JSON.stringify(capture, null, 2)}\n`);

const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
writeFileSync(join(outDir, 'replay.html'), `<!doctype html><html><head><meta charset="utf-8">
<title>CoForce setup — sandbox replay</title>
<style>body{background:#181310;color:#f2e7dd;font:13px/1.5 "JetBrains Mono",ui-monospace,monospace;display:grid;place-items:center;min-height:100vh;margin:0}
pre{background:#221a15;border:1px solid #4a382d;border-radius:12px;padding:22px 26px;width:${COLS}ch;min-height:${ROWS + 2}em;white-space:pre-wrap}
.h{color:#d97b57;font-weight:700}</style></head><body><pre id="t"></pre>
<script>const F=${JSON.stringify(frames)};const t=document.getElementById('t');let i=0;
const tick=()=>{if(i>=F.length){setTimeout(()=>{i=0;tick();},4000);return;}
t.innerHTML=F[i].lines.map(l=>l.startsWith('━━')?'<span class="h">'+l.replace(/</g,'&lt;')+'</span>':l.replace(/</g,'&lt;')).join('\\n');
const next=F[i+1];const wait=next?Math.min(Math.max(next.t-F[i].t,120),1400):2500;i+=1;setTimeout(tick,wait);};tick();</script></body></html>\n`);

let video = 'skipped (needs qlmanage + ffmpeg, macOS)';
try {
  execFileSync('which', ['qlmanage'], { stdio: 'pipe' });
  execFileSync('which', ['ffmpeg'], { stdio: 'pipe' });
  const framesDir = join(outDir, 'png');
  mkdirSync(framesDir, { recursive: true });
  const concat = [];
  frames.forEach((frame, index) => {
    const svg = join(framesDir, `f${String(index).padStart(3, '0')}.svg`);
    const lines = frame.lines.map((line, row) =>
      `<text x="24" y="${34 + row * 19}" fill="${line.startsWith('━━') ? '#d97b57' : line.startsWith('$') ? '#d9b06b' : '#f2e7dd'}">${esc(line)}</text>`).join('');
    // fixed 16:9 canvas fully painted — no letterbox surprises from the renderer
    writeFileSync(svg, `<svg xmlns="http://www.w3.org/2000/svg" width="1344" height="756" font-family="Menlo, monospace" font-size="14"><rect width="1344" height="756" fill="#181310"/>${lines}</svg>`);
    execFileSync('qlmanage', ['-t', '-s', '1344', '-o', framesDir, svg], { stdio: 'pipe' });
    const next = frames[index + 1];
    const dur = next ? Math.min(Math.max((next.t - frame.t) / 1000, 0.25), 1.6) : 3;
    concat.push(`file '${svg}.png'`, `duration ${dur.toFixed(2)}`);
  });
  concat.push(concat.at(-2)); // concat demuxer needs the last file repeated
  writeFileSync(join(framesDir, 'concat.txt'), `${concat.join('\n')}\n`);
  execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', join(framesDir, 'concat.txt'),
    '-vf', 'scale=1344:756,format=yuv420p', '-r', '30', join(outDir, 'setup-demo.mp4')], { stdio: 'pipe' });
  video = join(outDir, 'setup-demo.mp4');
} catch (err) {
  video = `skipped (${String(err.message).split('\n')[0]})`;
}

console.log(`record-setup: ${frames.length} frames captured, all step assertions passed ✓`);
console.log(`  frames : ${join(outDir, 'frames.json')}`);
console.log(`  replay : ${join(outDir, 'replay.html')}`);
console.log(`  video  : ${video}`);
