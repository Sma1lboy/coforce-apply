#!/usr/bin/env node
// Demo recorder: a scripted driver runs the REAL pipeline commands in a
// throwaway sandbox, snapshots the terminal as timestamped text frames, and
// asserts the sandbox state after every step — the capture IS the
// verification, so the README demo can never drift from what the code does.
// Outputs:
//
//   harness/out/setup-recording/frames.json  — the capture document
//   harness/out/setup-recording/replay.html  — self-contained animated replay
//   harness/out/setup-recording/demo.svg     — animated SVG (always)
//   harness/out/setup-recording/demo.gif     — README hero, when the two
//                                              dev-only render deps are present
//
//   npm run record:setup
//   npm run record:demo    # re-render the asset without re-running the pipeline
//
// Rendering lives in render-demo.mjs — this file only decides what happens and
// in what order.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedSandbox } from './sandbox.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out', 'setup-recording');
mkdirSync(outDir, { recursive: true });
const home = seedSandbox(join(outDir, 'coforce'));
const campaignCli = join(here, '../.agents/skills/campaign/scripts/campaign.mjs');
const experienceCli = join(here, '../.agents/skills/experience/scripts/experience.mjs');
const huntCli = join(here, '../.agents/skills/start/scripts/hunt.mjs');

const COLS = 92;
const ROWS = 26;
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
// Nothing about this machine belongs in a committed asset: the sandbox path
// and the checkout path are rewritten to the paths a reader would actually see.
const repoRoot = join(here, '..');
const redact = line => line
  .replaceAll(home, '~/.coforce')
  .replaceAll(repoRoot, '.');
const print = (...lines) => {
  for (const line of lines) {
    term.push(redact(line));
    snapshot();
  }
};
// Commands are shown the way a reader would type them: no sandbox paths.
const HIDDEN_FLAGS = ['--data-dir', '--apps', '--instructions', '--config'];
const shown = args => args
  .map(arg => (arg.startsWith('/') ? arg.split('/').at(-1) : arg))
  // a comma list of eight content hashes is noise, not information
  .map(arg => (arg.split(',').length > 2 ? `${arg.split(',').slice(0, 2).join(',')},…` : arg))
  .filter((_, index, all) => !HIDDEN_FLAGS.includes(all[index - 1]))
  .filter(arg => !HIDDEN_FLAGS.includes(arg));
const compact = out => {
  // every CLI here prints JSON; a pretty-printed object sliced at N lines is
  // unreadable, one compact line is what a reader actually parses
  try {
    const value = JSON.parse(out);
    return [JSON.stringify(Array.isArray(value) ? { items: value.length } : value)];
  } catch {
    return out.trim().split('\n');
  }
};
const sh = (bin, args, { lines = 1 } = {}) => {
  print(`$ ${[bin.split('/').at(-1), ...shown(args)].join(' ')}`);
  const out = execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
  print(...compact(out).slice(0, lines).map(line => `  ${line}`));
  return out;
};
const json = (bin, args) => JSON.parse(execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8' }));
const say = (who, text) => print(`${who === 'user' ? '›' : '◆'} ${text}`);
const gap = () => print('');

// ---- Act 1: onboarding writes the data home ---------------------------------
print('▌ CoForce Apply — one full cycle, recorded in a sandbox', '');
say('user', 'claude');
say('agent', 'Claude Code · /setup');
gap();
const profile = JSON.parse(readFileSync(join(home, 'profile.json'), 'utf8'));
assert.equal(profile.name, 'John Doe');
say('agent', 'Stage 1 · Profile — imported from the resume you already have.');
say('agent', `  profile.json ✓  ${profile.name} · ${profile.experience.length} roles · every bullet reviewed by you`);
const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
assert.equal(config.needsSponsorship, true);
assert.equal(config.version, 2);
assert.equal(config.headlessApply, false);
say('agent', 'Stage 2 · Intent + consents — level, sponsorship, work mode, locations.');
say('agent', `  config.json ✓  ${config.level} · ${config.workAuthorization} · ${config.locations.join(' / ')}`);
assert.ok(readFileSync(join(home, 'instructions.md'), 'utf8').includes('never-apply'));
say('agent', 'Stage 3 · Standing instructions.');
say('agent', '  instructions.md ✓  your never-apply list, honoured by every skill and script');
gap();

// ---- Act 2: Module 1 — your real work becomes evidence ----------------------
print('▌ /experience — your GitHub work becomes verified evidence', '');
const index = JSON.parse(sh(experienceCli, ['build', '--data-dir', home]));
assert.equal(index.status, 'ready');
assert.equal(index.tier, 0);
say('agent', `Tier 0 index: ${index.counts.entries} entries · ${index.counts.skills} skills · `
  + `${index.counts.repositories} repo — built offline, zero GitHub calls`);
gap();

// ---- Act 3: discover → tracker (a real hunt run) ----------------------------
print('▌ /start — discover, dedup, track', '');
sh(huntCli, [
  '--track',
  '--source-file', join(here, 'fixtures/source-jobs.md'),
  '--apps', join(home, 'applications.json'),
  '--instructions', join(home, 'instructions.md'),
  '--config', join(home, 'config.json'),
]);
const apps = JSON.parse(readFileSync(join(home, 'applications.json'), 'utf8'));
assert.ok(apps.filter(app => app.status === 'pending').length >= 2, 'hunt tracked pending jobs');
say('agent', `${apps.length} postings tracked as pending — deduped by URL and company·role,`);
say('agent', '  never-apply companies dropped before they ever reach you');
gap();

// ---- Act 4: Module 2 — strict selection out of the verified pool ------------
print('▌ /campaign — verified pool in, verbatim selection out', '');
sh(campaignCli, ['sync', '--data-dir', home, '--apps', join(home, 'applications.json')]);
const pool = json(campaignCli, ['pool', '--data-dir', home]);
assert.ok(pool.length >= 5, 'verified pool from profile bullets');
say('agent', `pool: ${pool.length} reviewed bullets. A resume may use ONLY these ids.`);
const review = json(campaignCli, ['skill-review', '--data-dir', home]);
assert.equal(review.status, 'approved');
say('agent', `skills: baseline [${review.baseline.join(', ')}] + role packs `
  + `[${Object.keys(review.rolePacks).join(', ')}]`);
say('agent', '  every one approved by you in the console — none of them inferred from the JD');
const skills = json(campaignCli, ['skills', '--data-dir', home]);
const job = json(campaignCli, ['show', '--data-dir', home]).jobs[0];
const jdPath = join(outDir, 'jd.txt');
writeFileSync(jdPath, `Software Engineer Intern. ${'TypeScript, React, Java, Spring Boot microservices, CI/CD, testing. '.repeat(10)}`);
sh(campaignCli, ['hydrate', '--data-dir', home, '--id', job.id, '--file', jdPath]);
const picks = pool.slice(0, Math.min(8, pool.length)).map(bullet => bullet.id);
const eligible = skills.filter(skill => skill.baseline || skill.rolePacks.includes('backend')).map(skill => skill.id);
sh(campaignCli, ['select', '--data-dir', home, '--id', job.id,
  '--bullets', picks.join(','), '--skills', eligible.join(','), '--skill-pack', 'backend']);
say('agent', `${picks.length} bullets + ${eligible.length} approved skills selected, every one verbatim.`);
say('agent', 'A bullet the agent invented instead of selecting is structurally impossible:');
let rejected = false;
try {
  execFileSync(process.execPath, [campaignCli, 'select', '--data-dir', home, '--id', job.id,
    '--bullets', 'deadbeef'], { encoding: 'utf8', stdio: 'pipe' });
} catch (error) {
  rejected = true;
  print(`  ✗ ${String(error.stderr || '').trim().split('\n')[0]}`);
}
assert.ok(rejected, 'fabricated id must be rejected');
gap();

// ---- Act 5: the machine gates in front of your review -----------------------
const view = json(campaignCli, ['show', '--data-dir', home]).jobs.find(entry => entry.id === job.id);
const jobDir = join(home, 'campaigns', 'current', 'jobs', view.folder);
writeFileSync(join(jobDir, 'resume.tex'), '\\documentclass{article}\\begin{document}\\newcommand{\\resumeItem}[1]{#1}\n'
  + picks.map(id => `\\resumeItem{${pool.find(bullet => bullet.id === id).text}}`).join('\n')
  + '\n\\end{document}\n');
copyFixturePdf(join(jobDir, 'resume.pdf'));
print('▌ machine gates → your review → the submit gate', '');
const judge = json(campaignCli, ['judge', '--data-dir', home, '--id', job.id]);
assert.equal(judge.verbatim, true, 'every resume line is a pool bullet, verbatim');
say('agent', `onePage=${judge.onePage}  fullPage=${judge.fullPage}  verbatim=${judge.verbatim}`
  + `  — machine checks first, then the LLM judge`);
say('agent', 'Review the PDF in the console, approve it, export every approved job as one ZIP.');
gap();
say('agent', '/apply drives your own visible Chrome — and ALWAYS stops before the final');
say('agent', '  submit. The last click is yours, in every mode.');
gap();
print('▌ console: http://localhost:4517 · your data never leaves ~/.coforce');
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
const capture = {
  cols: COLS,
  rows: ROWS,
  frames,
  meta: { theme: 'coforce-hallmark', title: 'coforce apply — /setup → /start → /campaign' },
};
writeFileSync(join(outDir, 'frames.json'), `${JSON.stringify(capture, null, 2)}\n`);

writeFileSync(join(outDir, 'replay.html'), `<!doctype html><html><head><meta charset="utf-8">
<title>CoForce — sandbox replay</title>
<style>body{background:#181310;color:#f2e7dd;font:13px/1.5 "JetBrains Mono",ui-monospace,monospace;display:grid;place-items:center;min-height:100vh;margin:0}
pre{background:#221a15;border:1px solid #3a2c24;border-radius:12px;padding:22px 26px;width:${COLS}ch;min-height:${ROWS + 2}em;white-space:pre-wrap}
.h{color:#d97b57;font-weight:700}</style></head><body><pre id="t"></pre>
<script>const F=${JSON.stringify(frames)};const t=document.getElementById('t');let i=0;
const tick=()=>{if(i>=F.length){setTimeout(()=>{i=0;tick();},4000);return;}
t.innerHTML=F[i].lines.map(l=>l.startsWith('━━')?'<span class="h">'+l.replace(/</g,'&lt;')+'</span>':l.replace(/</g,'&lt;')).join('\\n');
const next=F[i+1];const wait=next?Math.min(Math.max(next.t-F[i].t,120),1400):2500;i+=1;setTimeout(tick,wait);};tick();</script></body></html>\n`);
console.log(`record-setup: ${frames.length} frames captured, all step assertions passed ✓`);
console.log(`  frames : ${join(outDir, 'frames.json')}`);
console.log(`  replay : ${join(outDir, 'replay.html')}`);
console.log('  render : node harness/render-demo.mjs');
