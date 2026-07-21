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
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// hunt.mjs lives in the sibling start skill (all skills install together)
const huntScript = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../start/scripts/hunt.mjs'
);

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

// Pipeline stages only — delivery mishaps (tier-1 failure, Claude fallback)
// are history events + a needsFallback flag, not statuses.
const COLUMNS = [
  ['pending', 'To Apply', 'oklch(75.5% 0.104 79)'],
  ['applied', 'Applied', 'oklch(78.5% 0.1 136)'],
  ['interviewing', 'Interviewing', 'oklch(72% 0.09 240)'],
  ['offer', 'Offer', 'oklch(84% 0.12 136)'],
  ['rejected', 'Rejected', 'oklch(49.5% 0.014 90)'],
];

// Prompt for the headless-Claude resume import (POST /api/import)
const IMPORT_PROMPT = `Parse the resume text from stdin into a JSON object with exactly this shape (all fields optional, omit anything absent):
{"name","title","email","phone","location","linkedin","github","website","summary","skills":[string],"education":[{"institution","degree","date","location"}],"experience":[{"company","title","date","location","description":[{"text"}]}],"projects":[{"name","technologies","dateRange","description":[{"text"}]}],"customSections":[{"title","entries":[{"heading","subheading","date","description":[{"text"}]}]}]}
Sections that are not Experience/Projects/Education/Skills (Awards, Publications, Certifications, Leadership, Volunteering…) go into customSections with their original section title.
Rules: linkedin/github are bare handles, not URLs; keep bullet text verbatim; dates verbatim; never invent data that is not in the text. Output ONLY the JSON object, no markdown fences, no commentary.`;

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

const readText = path => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
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

const esc = s =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

// Resume-style preview of ~/.coforce/profile.json for the Profile pane
function renderProfile(p) {
  if (!p)
    return '<div class="pane-empty">No profile yet — run /profile or /setup to create it</div>';
  const contact = [p.email, p.phone, p.location, p.linkedin, p.github, p.website]
    .filter(Boolean)
    .map(esc)
    .join(' · ');
  const bullets = d =>
    (d || [])
      .map(b => `<li>${esc(typeof b === 'string' ? b : b.text)}</li>`)
      .join('');
  const entry = (head, date, sub, body = '') => `
    <div class="entry"><div class="entry-head"><strong>${esc(head)}</strong><span>${esc(date || '')}</span></div>
    ${sub ? `<em>${esc(sub)}</em>` : ''}${body}</div>`;
  const exp = (p.experience || [])
    .map(e => entry(e.company, e.date, e.title, `<ul>${bullets(e.description)}</ul>`))
    .join('');
  const proj = (p.projects || [])
    .map(e => entry(e.name, e.dateRange, e.technologies, `<ul>${bullets(e.description)}</ul>`))
    .join('');
  const edu = (p.education || [])
    .map(e => entry(e.institution, e.date, e.degree))
    .join('');
  const custom = (p.customSections || [])
    .map(
      s =>
        `<h3>${esc(s.title)}</h3>${(s.entries || [])
          .map(e =>
            entry(
              e.heading || '',
              e.date,
              e.subheading,
              e.description?.length ? `<ul>${bullets(e.description)}</ul>` : ''
            )
          )
          .join('')}`
    )
    .join('');
  return `<div class="resume">
    <h2 class="r-name">${esc(p.name || '')}</h2>
    <div class="r-title">${esc(p.title || '')}</div>
    <div class="r-contact">${contact}</div>
    ${p.summary ? `<h3>Summary</h3><p>${esc(p.summary)}</p>` : ''}
    ${p.skills?.length ? `<h3>Skills</h3><div class="chips">${p.skills.map(s => `<span class="chip-s">${esc(s)}</span>`).join('')}</div>` : ''}
    ${exp ? `<h3>Experience</h3>${exp}` : ''}
    ${proj ? `<h3>Projects</h3>${proj}` : ''}
    ${edu ? `<h3>Education</h3>${edu}` : ''}
    ${custom}
  </div>`;
}

function render(apps, profile = loadProfile(), instructions = readText(instructionsPath)) {
  const card = a => `
        <div class="card" draggable="true" data-id="${esc(a.id)}" tabindex="0">
          <div class="card-title">${esc(a.title)}</div>
          ${a.company || a.position ? `<div class="meta">${esc([a.company, a.position].filter(Boolean).join(' · '))}</div>` : ''}
          ${a.needsFallback && a.status === 'pending' ? '<div class="flag">⚑ needs Claude fallback</div>' : ''}
          ${a.notes ? `<div class="notes">${esc(a.notes)}</div>` : ''}
          <div class="date">${esc((a.updatedAt || '').slice(0, 10))}</div>
        </div>`;

  const columns = COLUMNS.map(([status, label, color]) => {
    const items = apps.filter(a => a.status === status);
    return `
      <section class="col" data-status="${status}" style="--col-accent:${color}">
        <h2>${label} <span class="count">${items.length}</span></h2>
        <div class="cards">${items.map(card).join('')}</div>
      </section>`;
  }).join('');

  const withFiles = apps.map(a => ({
    ...a,
    _files: listFiles(join(filesRoot, a.id)),
  }));
  const payload = JSON.stringify(withFiles).replaceAll('<', '\\u003c');
  const globalFiles = JSON.stringify(listFiles(filesRoot)).replaceAll(
    '<',
    '\\u003c'
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CoForce Console</title>
<style>
  /* Hallmark tokens (kobe brand): terracotta on warm dark paper */
  :root {
    --paper: oklch(17.5% 0.003 100);
    --paper-2: oklch(20% 0.004 95);
    --paper-3: oklch(18.6% 0.004 95);
    --well: oklch(14% 0.003 95);
    --ink: oklch(92.5% 0.011 95);
    --ink-2: oklch(85.7% 0.014 95);
    --muted: oklch(69.5% 0.015 90);
    --faint: oklch(60.5% 0.014 90);
    --dim: oklch(49.5% 0.014 90);
    --rule: oklch(25.7% 0.01 85);
    --rule-2: oklch(29% 0.011 85);
    --accent: oklch(65% 0.107 41);
    --accent-2: oklch(70.5% 0.095 41);
    --accent-soft: oklch(83.5% 0.045 45);
    --accent-wash: oklch(65% 0.107 41 / 0.12);
    --font-display: "Space Grotesk", system-ui, sans-serif;
    --font-body: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
    --radius-card: 13px;
    --radius-chip: 8px;
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font: 400 13px/1.5 var(--font-body);
    margin: 0; background: var(--paper); color: var(--ink);
    display: flex; flex-direction: column; overflow: hidden;
  }
  header {
    display: flex; align-items: baseline; gap: 12px; flex: none;
    padding: 16px clamp(20px, 4vw, 40px);
    border-bottom: 1px solid var(--rule);
    background: var(--paper-2);
  }
  header h1 { font: 600 1.03rem var(--font-display); margin: 0; letter-spacing: .01em; }
  header h1::before { content: "◆ "; color: var(--accent); }
  header .tracked { color: var(--faint); font-size: .75rem; }
  #savebar {
    margin-left: auto; display: none; align-items: center; gap: 10px; font-size: .75rem;
  }
  #savebar.dirty { display: flex; }
  #savebar .state { color: var(--faint); }
  #savebar button {
    font: 500 .75rem var(--font-body); color: var(--accent-soft);
    background: var(--accent-wash); border: 1px solid var(--accent);
    border-radius: var(--radius-chip); padding: 4px 10px; cursor: pointer;
  }

  nav#tabs { display: flex; gap: 4px; margin-left: 18px; }
  nav#tabs button {
    font: 500 .8125rem var(--font-display); letter-spacing: .02em;
    color: var(--muted); background: none; border: 1px solid transparent;
    border-radius: var(--radius-chip); padding: 5px 14px; cursor: pointer;
  }
  nav#tabs button:hover { color: var(--ink-2); }
  nav#tabs button.active {
    color: var(--accent-soft); background: var(--accent-wash);
    border-color: var(--accent);
  }
  main.views { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .view { flex: 1; min-height: 0; display: none; flex-direction: column; }
  .view.active { display: flex; }
  .board {
    flex: 1; min-height: 0;
    display: flex; gap: 14px; align-items: stretch;
    padding: clamp(16px, 3vw, 28px); overflow-x: auto;
  }
  .panes {
    flex: 1; min-height: 0; display: flex; gap: 16px;
    padding: clamp(16px, 3vw, 28px); overflow: hidden;
  }
  .pane { min-height: 0; display: flex; flex-direction: column; }
  .pane.preview {
    flex: 1.2; overflow-y: auto; background: var(--paper-2);
    border: 1px solid var(--rule); border-radius: var(--radius-card);
    padding: clamp(20px, 3vw, 36px);
  }
  .pane.editor { flex: 1; gap: 10px; }
  .pane.editor textarea {
    flex: 1; resize: none; font: 400 12.5px/1.55 var(--font-body);
    color: var(--ink-2); background: var(--well);
    border: 1px solid var(--rule); border-radius: var(--radius-card);
    padding: 14px 16px; outline: none;
  }
  .pane.editor textarea:focus { border-color: var(--accent); }
  .editor-toolbar { display: flex; align-items: center; gap: 10px; }
  .editor-toolbar #profile-status { flex: 1; text-align: right; }
  .editor-toolbar button, .editor-bar button {
    font: 500 .75rem var(--font-body); color: var(--accent-soft);
    background: var(--accent-wash); border: 1px solid var(--accent);
    border-radius: var(--radius-chip); padding: 6px 14px; cursor: pointer; white-space: nowrap;
  }
  .editor-toolbar button.ghost { background: none; border-color: var(--rule-2); color: var(--muted); }
  .editor-toolbar button.ghost:hover { border-color: var(--accent); color: var(--accent-soft); }
  .form-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-right: 6px; }
  .f { display: flex; flex-direction: column; gap: 3px; }
  .f > span { font-size: .6875rem; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; }
  .f input, .f textarea, .bullet textarea {
    font: 400 12.5px/1.5 var(--font-body); color: var(--ink);
    background: var(--well); border: 1px solid var(--rule);
    border-radius: var(--radius-chip); padding: 7px 10px; outline: none; width: 100%;
  }
  .f input:focus, .f textarea:focus, .bullet textarea:focus { border-color: var(--accent); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .form-scroll h3 {
    font: 600 .6875rem var(--font-display); text-transform: uppercase;
    letter-spacing: .1em; color: var(--accent); margin: 18px 0 8px;
    padding-bottom: 5px; border-bottom: 1px solid var(--rule-2);
  }
  .chips-edit { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chips-edit .chip-s { display: inline-flex; align-items: center; gap: 5px; }
  .chips-edit .chip-s button { background: none; border: none; color: var(--dim); cursor: pointer; padding: 0; font-size: .75rem; }
  .chips-edit .chip-s button:hover { color: var(--accent-2); }
  .chips-edit input { width: 130px; font: 400 12px var(--font-body); color: var(--ink);
    background: var(--well); border: 1px dashed var(--rule-2); border-radius: 999px; padding: 3px 10px; outline: none; }
  .ecard {
    background: var(--paper-3); border: 1px solid var(--rule);
    border-radius: var(--radius-chip); padding: 12px; margin-bottom: 10px;
  }
  .ecard .grid2 { margin-bottom: 6px; }
  .bullet { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px; }
  .bullet textarea { min-height: 34px; resize: vertical; }
  .mini {
    background: none; border: 1px solid var(--rule-2); color: var(--dim);
    border-radius: var(--radius-chip); font: 500 .6875rem var(--font-body);
    padding: 4px 9px; cursor: pointer; white-space: nowrap;
  }
  .mini:hover { color: var(--accent-soft); border-color: var(--accent); }
  .mini.add { margin-top: 8px; }
  .card-actions { display: flex; justify-content: flex-end; margin-top: 6px; }
  #import-dlg textarea { width: 100%; min-height: 260px; resize: vertical; font: 400 12px/1.5 var(--font-body);
    color: var(--ink-2); background: var(--well); border: 1px solid var(--rule);
    border-radius: var(--radius-chip); padding: 10px 12px; outline: none; margin-bottom: 10px; }
  #import-dlg .dlg-body { max-height: none; }
  .busy { color: var(--accent-soft) !important; }
  .editor-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .editor-bar .hint { color: var(--dim); font-size: .6875rem; word-break: break-all; }
  .editor-bar button {
    font: 500 .75rem var(--font-body); color: var(--accent-soft);
    background: var(--accent-wash); border: 1px solid var(--accent);
    border-radius: var(--radius-chip); padding: 6px 14px; cursor: pointer; white-space: nowrap;
  }
  .pane-empty { color: var(--dim); text-align: center; margin: auto; }
  .discover-wrap {
    flex: 1; min-height: 0; display: flex; gap: 16px;
    padding: clamp(16px, 3vw, 28px); max-width: 1240px; width: 100%; margin: 0 auto;
  }
  #filters {
    width: 235px; flex: none; overflow-y: auto;
    background: var(--paper-2); border: 1px solid var(--rule);
    border-radius: var(--radius-card); padding: 14px;
  }
  #filters h4 {
    font: 600 .6875rem var(--font-display); text-transform: uppercase;
    letter-spacing: .1em; color: var(--faint); margin: 14px 0 8px;
  }
  #filters h4:first-child { margin-top: 0; }
  #filters .frow {
    display: flex; align-items: center; gap: 8px; padding: 4px 0;
    color: var(--ink-2); font-size: .78rem; cursor: pointer;
  }
  #filters .frow input { accent-color: oklch(65% 0.107 41); }
  #filters .frow .fcount { margin-left: auto; color: var(--dim); font-size: .6875rem; }
  #filters .fsearch {
    width: 100%; font: 400 12px var(--font-body); color: var(--ink);
    background: var(--well); border: 1px solid var(--rule);
    border-radius: var(--radius-chip); padding: 6px 10px; outline: none;
  }
  #filters .fsearch:focus { border-color: var(--accent); }
  .discover-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .choice-row { display: flex; gap: 8px; margin-bottom: 6px; }
  .choice-row.wrap { flex-wrap: wrap; }
  .choice-row button {
    font: 500 .78rem var(--font-body); color: var(--muted);
    background: var(--well); border: 1px solid var(--rule-2);
    border-radius: 999px; padding: 7px 16px; cursor: pointer;
    transition: border-color 180ms var(--ease-out);
  }
  .choice-row button:hover { border-color: var(--accent); color: var(--ink-2); }
  .choice-row button.sel {
    color: var(--accent-soft); background: var(--accent-wash); border-color: var(--accent);
  }
  .drow {
    display: flex; align-items: center; gap: 14px;
    background: var(--paper-2); border: 1px solid var(--rule);
    border-radius: var(--radius-chip); padding: 10px 14px; margin-bottom: 8px;
    transition: border-color 180ms var(--ease-out);
  }
  .drow:hover { border-color: var(--rule-2); }
  .dmain { flex: 1; min-width: 0; }
  .dtitle { color: var(--accent-soft); font-weight: 500; text-decoration: none; word-break: break-word; }
  .dtitle:hover { color: var(--accent-2); text-decoration: underline; }
  .dsource { color: var(--dim); }
  .dlogo {
    width: 26px; height: 26px; border-radius: 6px; flex: none;
    background: var(--paper-3); object-fit: contain;
  }
  .dapply {
    font: 500 .75rem var(--font-body); color: var(--accent-soft);
    background: var(--accent-wash); border: 1px solid var(--accent);
    border-radius: var(--radius-chip); padding: 6px 14px; cursor: pointer; white-space: nowrap;
  }
  .dapply:disabled { color: var(--ok, #9c6); background: none; border-color: var(--rule-2); cursor: default; }
  .resume { max-width: 640px; }
  .resume .r-name { font: 600 1.5rem var(--font-display); margin: 0; }
  .resume .r-title { color: var(--accent-soft); margin-top: 2px; }
  .resume .r-contact { color: var(--faint); font-size: .75rem; margin-top: 6px; }
  .resume h3 {
    font: 600 .6875rem var(--font-display); text-transform: uppercase;
    letter-spacing: .1em; color: var(--accent); margin: 20px 0 8px;
    padding-bottom: 5px; border-bottom: 1px solid var(--rule-2);
  }
  .resume p, .resume li { color: var(--ink-2); font-size: .8125rem; }
  .resume ul { margin: 6px 0 0; padding-left: 18px; }
  .resume .entry { margin-bottom: 12px; }
  .resume .entry-head { display: flex; justify-content: space-between; }
  .resume .entry-head span { color: var(--dim); font-size: .75rem; }
  .resume em { color: var(--muted); font-style: normal; font-size: .78rem; }
  .resume .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .resume .chip-s {
    font-size: .6875rem; color: var(--ink-2); background: var(--paper-3);
    border: 1px solid var(--rule-2); border-radius: 999px; padding: 2px 10px;
  }
  .col {
    display: flex; flex-direction: column; min-height: 0;
    background: var(--paper-2); border: 1px solid var(--rule);
    border-radius: var(--radius-card); padding: 12px;
    min-width: 240px; width: 240px; flex: 1 0 240px;
  }
  .col h2 {
    flex: none;
    font: 600 .6875rem var(--font-display);
    text-transform: uppercase; letter-spacing: .1em;
    color: var(--ink-2); margin: 0 0 10px; padding-bottom: 8px;
    border-bottom: 2px solid var(--col-accent);
  }
  .col h2 .count { float: right; color: var(--col-accent); font-family: var(--font-body); }
  .col.dragover { border-color: var(--col-accent); background: var(--paper-3); }
  .cards { flex: 1; min-height: 40px; overflow-y: auto; scrollbar-width: thin; }
  .cards:empty::after { content: "—"; display: block; color: var(--dim); text-align: center; padding: 10px 0; }

  .card {
    background: var(--paper-3); border: 1px solid var(--rule);
    border-radius: var(--radius-chip); padding: 10px 12px; margin-bottom: 10px;
    cursor: grab;
    transition: border-color 180ms var(--ease-out);
  }
  .card:hover, .card:focus-visible { border-color: var(--accent); outline: none; }
  .card.dragging { opacity: .45; cursor: grabbing; }
  .card-title { color: var(--accent-soft); font-weight: 500; word-break: break-word; }
  .meta { color: var(--muted); font-size: .75rem; margin-top: 3px; }
  .notes {
    color: var(--faint); font-size: .75rem; margin-top: 6px; white-space: pre-wrap;
    border-left: 2px solid var(--rule-2); padding-left: 8px;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .date { color: var(--dim); font-size: .6875rem; margin-top: 8px; }
  .flag {
    display: inline-block; margin-top: 6px;
    font-size: .6875rem; color: var(--accent-soft);
    background: var(--accent-wash); border: 1px solid var(--accent-line, var(--accent));
    border-radius: 999px; padding: 1px 8px;
  }

  dialog {
    background: var(--paper-2); color: var(--ink);
    border: 1px solid var(--rule-2); border-radius: var(--radius-card);
    width: min(680px, calc(100vw - 48px)); max-height: 82vh;
    padding: 0;
  }
  dialog::backdrop { background: oklch(14% 0.003 95 / 0.72); }
  .dlg-head {
    display: flex; align-items: flex-start; gap: 12px;
    padding: 18px 22px 14px; border-bottom: 1px solid var(--rule);
  }
  .dlg-head h3 { font: 600 1.03rem var(--font-display); margin: 0; flex: 1; }
  .dlg-head .chip {
    font-size: .6875rem; text-transform: uppercase; letter-spacing: .08em;
    border: 1px solid var(--chip-accent, var(--rule-2)); color: var(--chip-accent, var(--muted));
    border-radius: 999px; padding: 2px 10px; white-space: nowrap;
  }
  .dlg-head .close {
    background: none; border: none; color: var(--dim); font-size: 1.1rem; cursor: pointer;
  }
  .dlg-body { padding: 16px 22px 22px; overflow-y: auto; max-height: calc(82vh - 70px); }
  .dlg-body h4 {
    font: 600 .6875rem var(--font-display); text-transform: uppercase;
    letter-spacing: .1em; color: var(--faint); margin: 18px 0 6px;
  }
  .dlg-body h4:first-child { margin-top: 0; }
  .kv { color: var(--ink-2); }
  .kv .k { color: var(--faint); }
  .jd-link { color: var(--accent-soft); word-break: break-all; }
  .jd-link:hover { color: var(--accent-2); }
  .desc {
    white-space: pre-wrap; color: var(--ink-2); font-size: .8125rem;
    background: var(--well); border: 1px solid var(--rule);
    border-radius: var(--radius-chip); padding: 12px; max-height: 240px; overflow-y: auto;
  }
  .timeline { list-style: none; margin: 0; padding: 0; }
  .timeline li {
    position: relative; padding: 0 0 12px 18px; color: var(--ink-2);
    border-left: 1px solid var(--rule-2); margin-left: 5px;
  }
  .timeline li::before {
    content: ""; position: absolute; left: -4px; top: 5px;
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--accent); border: 1px solid var(--paper-2);
  }
  .timeline .t-date { color: var(--dim); font-size: .6875rem; display: block; }
  .empty-note { color: var(--dim); }
</style>
</head>
<body>
<header>
  <h1>CoForce</h1>
  <nav id="tabs">
    <button data-view="discover" type="button">Discover</button>
    <button data-view="profile" type="button">Profile</button>
    <button data-view="board" type="button">Board</button>
    <button data-view="instructions" type="button">Instructions</button>
  </nav>
  <span class="tracked">${apps.length} tracked</span>
  <div id="savebar"><span class="state"></span><button id="copyjson" type="button">Copy JSON</button></div>
</header>
<main class="views">
  <div class="view" id="view-board">
    <div class="board">${columns}
    </div>
  </div>
  <div class="view" id="view-discover">
    <div class="discover-wrap">
      <aside id="filters"><div class="pane-empty">Filters appear after the first fetch</div></aside>
      <div class="discover-main">
        <div class="editor-toolbar">
          <button id="discover-refresh" type="button" class="ghost">↻ Refresh sources</button>
          <span id="discover-status" class="hint"></span>
        </div>
        <div id="discover-list" class="form-scroll"></div>
      </div>
    </div>
  </div>
  <div class="view" id="view-profile">
    <div class="panes">
      <div class="pane preview">${renderProfile(profile)}</div>
      <div class="pane editor">
        <div class="editor-toolbar">
          <button id="import-open" type="button" class="ghost">⇪ Import resume (AI)</button>
          <span id="profile-status" class="hint"></span>
          <button id="save-profile" type="button">Save profile</button>
        </div>
        <div id="profile-form" class="form-scroll"></div>
      </div>
    </div>
  </div>
  <div class="view" id="view-instructions">
    <div class="panes">
      <div class="pane editor">
        <textarea id="instructions-md" spellcheck="false" placeholder="# My Application Instructions&#10;&#10;## never-apply&#10;&#10;- Company A">${esc(instructions)}</textarea>
        <div class="editor-bar"><span class="hint">${esc(instructionsPath)} — standing rules every skill obeys</span><button id="save-instructions" type="button">Save instructions</button></div>
      </div>
    </div>
  </div>
</main>
<dialog id="detail"></dialog>
<dialog id="prefs-dlg">
  <div class="dlg-head"><h3>Welcome 👋 — tune your discovery</h3></div>
  <div class="dlg-body">
    <h4>What are you looking for?</h4>
    <div class="choice-row" id="pref-level"></div>
    <h4>Directions — pick any that fit</h4>
    <div class="choice-row wrap" id="pref-dirs"></div>
    <div class="editor-bar" style="margin-top:16px">
      <span class="hint">Saved locally to ~/.coforce/preferences.json — change anytime in the filter panel</span>
      <button id="prefs-save" type="button">Start discovering →</button>
    </div>
  </div>
</dialog>
<dialog id="import-dlg">
  <div class="dlg-head"><h3>Import resume with AI</h3><button class="close" type="button" aria-label="Close">✕</button></div>
  <div class="dlg-body">
    <p class="hint" style="margin-top:0">Paste your resume text (from PDF, Word, LinkedIn — anything). A local
    headless Claude parses it into your profile; nothing is saved until you review and hit Save.</p>
    <textarea id="import-text" spellcheck="false" placeholder="Paste resume text here…"></textarea>
    <div class="editor-bar">
      <span id="import-status" class="hint"></span>
      <button id="import-run" type="button">Parse with Claude</button>
    </div>
  </div>
</dialog>
<script>
const APPS = ${payload};
const PROFILE = ${JSON.stringify(profile).replaceAll('<', '\\u003c')};
const PREFS = ${JSON.stringify(existsSync(prefsPath) ? JSON.parse(readFileSync(prefsPath, 'utf8')) : null).replaceAll('<', '\\u003c')};
const GLOBAL_FILES = ${globalFiles};
const SERVE = ${JSON.stringify(serve)};
const FILES_ROOT = ${JSON.stringify(filesRoot).replaceAll('<', '\\u003c')};
const COLORS = ${JSON.stringify(Object.fromEntries(COLUMNS.map(([s, , c]) => [s, c])))};
const byId = id => APPS.find(a => a.id === id);
const escHtml = s => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// --- persistence: POST to the serve-mode API, else offer copy-paste ---
const savebar = document.getElementById('savebar');
const stateEl = savebar.querySelector('.state');
async function save() {
  try {
    const res = await fetch('/api/apps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(APPS),
    });
    if (!res.ok) throw new Error(res.status);
    savebar.classList.remove('dirty');
  } catch {
    savebar.classList.add('dirty');
    stateEl.textContent = 'static file — changes not saved; copy JSON into profile/applications.json';
  }
}
document.getElementById('copyjson').addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(APPS, null, 2));
  stateEl.textContent = 'copied — paste into profile/applications.json';
});

// --- header tabs (Discover is home; hash keeps the tab across reloads) ---
let queuedDirty = false;
function showView(name) {
  document.querySelectorAll('#tabs button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === 'view-' + name));
  location.hash = name;
  if (name === 'discover' && !discoverLoaded) loadDiscover();
}
document.querySelectorAll('#tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'board' && queuedDirty) {
      location.hash = 'board';
      location.reload();
      return;
    }
    showView(btn.dataset.view);
  });
});

// --- discover: preference wizard + filters + classified list ---
let discoverLoaded = false;
let DISCOVER = [];
let DSUMMARY = null;
const dList = document.getElementById('discover-list');
const dStatus = document.getElementById('discover-status');
const filtersEl = document.getElementById('filters');

// ponytail: hardcoded keyword classifier — an LLM pass can replace it later
const LEVELS = [['internship', 'Internship'], ['newgrad', 'New Grad / Full-time'], ['any', 'Both']];
// NB: this block ships through a server-side template literal — word
// boundaries must be written \\b or they arrive as backspace characters
const DIRS = [
  ['frontend', 'Frontend', /front.?end|\\bui\\b|web develop/i],
  ['backend', 'Backend', /back.?end|\\bapi\\b|server|distributed|microservice/i],
  ['fullstack', 'Full-Stack', /full.?stack/i],
  ['mobile', 'Mobile', /mobile|\\bios\\b|android/i],
  ['ai-ml', 'AI / ML', /machine learning|\\bml\\b|\\bai\\b|deep learning|\\bllm\\b|computer vision|\\bnlp\\b|data scien|perception/i],
  ['data', 'Data Eng', /data engineer|analytics|\\betl\\b|data platform/i],
  ['infra', 'Infra / Cloud', /infrastructure|cloud|devops|\\bsre\\b|kubernetes|reliability|platform engineer/i],
  ['security', 'Security', /security|appsec|crypto/i],
  ['embedded', 'Embedded / Systems', /embedded|firmware|kernel|systems software|silicon|hardware/i],
  ['qa', 'QA / Test', /\\bqa\\b|quality|test engineer/i],
  ['general', 'General SWE', null],
];
const levelOf = j => (/\\bintern(ship)?s?\\b/i.test(j.role) ? 'internship' : 'newgrad');
const dirsOf = j => {
  const hit = DIRS.filter(([, , re]) => re && re.test(j.role)).map(([k]) => k);
  return hit.length ? hit : ['general'];
};

// filter state, seeded from saved preferences
const F = {
  level: PREFS?.level || 'any',
  dirs: new Set(PREFS?.directions || []),
  sources: new Set(),
  q: '',
};
async function savePrefs() {
  try {
    await postTo('/api/prefs', JSON.stringify({ level: F.level, directions: [...F.dirs] }), 'application/json');
  } catch {}
}

function matches(j) {
  if (F.level !== 'any' && j._level !== F.level) return false;
  if (F.dirs.size && !j._dirs.some(d => F.dirs.has(d))) return false;
  if (F.sources.size && !F.sources.has(j.source)) return false;
  if (F.q && !(j.role + ' ' + j.company + ' ' + (j.location || '')).toLowerCase().includes(F.q)) return false;
  return true;
}

function renderFilters() {
  const dirCounts = {};
  const srcCounts = {};
  for (const j of DISCOVER) {
    for (const d of j._dirs) dirCounts[d] = (dirCounts[d] || 0) + 1;
    srcCounts[j.source] = (srcCounts[j.source] || 0) + 1;
  }
  filtersEl.innerHTML =
    '<h4>Search</h4><input class="fsearch" id="f-q" placeholder="role, company, city…" value="' + escHtml(F.q) + '">' +
    '<h4>Level</h4>' + LEVELS.map(([k, label]) =>
      '<label class="frow"><input type="radio" name="f-level" value="' + k + '"' + (F.level === k ? ' checked' : '') + '> ' + label + '</label>').join('') +
    '<h4>Direction</h4>' + DIRS.map(([k, label]) =>
      '<label class="frow"><input type="checkbox" data-dir="' + k + '"' + (F.dirs.size === 0 || F.dirs.has(k) ? ' checked' : '') + '> ' + label +
      '<span class="fcount">' + (dirCounts[k] || 0) + '</span></label>').join('') +
    '<h4>Source</h4>' + Object.keys(srcCounts).map(s =>
      '<label class="frow"><input type="checkbox" data-src="' + escHtml(s) + '"' + (F.sources.size === 0 || F.sources.has(s) ? ' checked' : '') + '> ' + escHtml(s) +
      '<span class="fcount">' + srcCounts[s] + '</span></label>').join('');
}
filtersEl.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'f-q') F.q = t.value.trim().toLowerCase();
  else if (t.name === 'f-level') { F.level = t.value; savePrefs(); }
  else if (t.dataset.dir) {
    const checked = [...filtersEl.querySelectorAll('[data-dir]:checked')].map(x => x.dataset.dir);
    F.dirs = checked.length === DIRS.length ? new Set() : new Set(checked);
    savePrefs();
  } else if (t.dataset.src) {
    const all = [...filtersEl.querySelectorAll('[data-src]')];
    const checked = all.filter(x => x.checked).map(x => x.dataset.src);
    F.sources = checked.length === all.length ? new Set() : new Set(checked);
  }
  renderList();
});

function renderList() {
  const shown = DISCOVER.filter(matches);
  if (DSUMMARY) {
    dStatus.textContent = shown.length + ' shown of ' + DISCOVER.length + ' new · ' +
      DSUMMARY.skipped.tracked + ' tracked · ' + DSUMMARY.skipped.blocked + ' never-apply · ' +
      DSUMMARY.sources.map(s => s.name + (s.error ? ' ⚠' : '')).join(' · ');
  }
  dList.innerHTML = shown.map(j => {
    const i = DISCOVER.indexOf(j);
    let logo = '';
    try {
      if (j.homepage) {
        const host = new URL(j.homepage).hostname;
        logo = '<img class="dlogo" alt="" loading="lazy" ' +
          'src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=64" ' +
          'onerror="this.remove()">';
      }
    } catch {}
    return '<div class="drow">' + logo +
      '<div class="dmain"><a class="dtitle" href="' + escHtml(j.url) + '" target="_blank" rel="noreferrer">' +
      escHtml(j.role) + '</a>' +
      '<div class="meta">' + escHtml(j.company) + (j.location ? ' · ' + escHtml(j.location) : '') +
      ' · <span class="dsource">' + escHtml(j.source) + '</span></div></div>' +
      '<button class="dapply" type="button" data-i="' + i + '">Apply ⇢</button></div>';
  }).join('') || '<div class="pane-empty">Nothing matches these filters — loosen them or ↻ refresh sources.</div>';
}

async function loadDiscover() {
  if (!SERVE) { dStatus.textContent = 'static file — discovery needs the served console'; return; }
  dStatus.textContent = 'Fetching job sources…';
  dStatus.classList.add('busy');
  dList.innerHTML = '';
  try {
    const res = await fetch('/api/discover');
    if (!res.ok) throw new Error(await res.text() || res.status);
    const d = await res.json();
    discoverLoaded = true;
    DSUMMARY = d;
    DISCOVER = d.new.map(j => ({ ...j, _level: levelOf(j), _dirs: dirsOf(j) }));
    renderFilters();
    renderList();
    if (!PREFS) openPrefsWizard();
  } catch (e) {
    dStatus.textContent = 'Discovery failed: ' + e.message;
  } finally {
    dStatus.classList.remove('busy');
  }
}
document.getElementById('discover-refresh').addEventListener('click', () => { discoverLoaded = false; loadDiscover(); });

// --- first-run preference wizard ---
const prefsDlg = document.getElementById('prefs-dlg');
function openPrefsWizard() {
  const lvl = document.getElementById('pref-level');
  const dir = document.getElementById('pref-dirs');
  lvl.innerHTML = LEVELS.map(([k, label]) =>
    '<button type="button" data-k="' + k + '"' + (k === 'any' ? ' class="sel"' : '') + '>' + label + '</button>').join('');
  dir.innerHTML = DIRS.filter(([k]) => k !== 'general').map(([k, label]) =>
    '<button type="button" data-k="' + k + '">' + label + '</button>').join('');
  lvl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    lvl.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
  });
  dir.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    b.classList.toggle('sel');
  });
  prefsDlg.showModal();
}
document.getElementById('prefs-save').addEventListener('click', async () => {
  F.level = document.querySelector('#pref-level button.sel')?.dataset.k || 'any';
  const picked = [...document.querySelectorAll('#pref-dirs button.sel')].map(b => b.dataset.k);
  F.dirs = new Set(picked.length ? [...picked, 'general'] : []);
  await savePrefs();
  prefsDlg.close();
  renderFilters();
  renderList();
});
dList.addEventListener('click', async e => {
  const btn = e.target.closest('.dapply');
  if (!btn || btn.disabled) return;
  const job = DISCOVER[Number(btn.dataset.i)];
  btn.textContent = 'Queuing…';
  try {
    const res = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job),
    });
    if (!res.ok && res.status !== 409) throw new Error(await res.text() || res.status);
    btn.textContent = res.status === 409 ? 'Already tracked' : '✓ Queued';
    btn.disabled = true;
    queuedDirty = true;
    try { await navigator.clipboard.writeText('claude "/apply ' + job.url + '"'); } catch {}
    dStatus.textContent = 'Queued "' + job.role + '" — claude "/apply …" copied; paste it in Claude Code to run the full flow, or let /start pick it up.';
  } catch (err) {
    btn.textContent = 'Failed: ' + err.message;
  }
});

// --- profile form editor + AI import (serve mode only) ---
async function postTo(url, body, contentType) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': contentType }, body });
  if (!res.ok) throw new Error(await res.text() || res.status);
  return res;
}
let P = PROFILE || {};
const FORM = document.getElementById('profile-form');
const statusEl = document.getElementById('profile-status');
const setPath = (obj, path, value) => {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i += 1) o = o[keys[i]];
  o[keys.at(-1)] = value;
};
const field = (label, path, value, wide) =>
  '<label class="f"' + (wide ? ' style="grid-column:1/-1"' : '') + '><span>' + label + '</span>' +
  '<input data-path="' + path + '" value="' + escHtml(value ?? '') + '"></label>';
const area = (label, path, value) =>
  '<label class="f" style="grid-column:1/-1"><span>' + label + '</span>' +
  '<textarea data-path="' + path + '" rows="3">' + escHtml(value ?? '') + '</textarea></label>';

// [section key, heading, add-label, entry renderer]
const SECTIONS = [
  ['experience', 'Experience', '+ Add experience', (e, i) =>
    '<div class="grid2">' +
    field('Company', 'experience.' + i + '.company', e.company) +
    field('Title', 'experience.' + i + '.title', e.title) +
    field('Date', 'experience.' + i + '.date', e.date) +
    field('Location', 'experience.' + i + '.location', e.location) +
    '</div>' + bulletsHtml('experience', i, e.description)],
  ['projects', 'Projects', '+ Add project', (e, i) =>
    '<div class="grid2">' +
    field('Name', 'projects.' + i + '.name', e.name) +
    field('Technologies', 'projects.' + i + '.technologies', e.technologies) +
    field('Date range', 'projects.' + i + '.dateRange', e.dateRange) +
    '</div>' + bulletsHtml('projects', i, e.description)],
  ['education', 'Education', '+ Add education', (e, i) =>
    '<div class="grid2">' +
    field('Institution', 'education.' + i + '.institution', e.institution) +
    field('Degree', 'education.' + i + '.degree', e.degree, true) +
    field('Date', 'education.' + i + '.date', e.date) +
    field('Location', 'education.' + i + '.location', e.location) +
    '</div>'],
];

function bulletsHtml(section, i, bullets) {
  return (bullets || []).map((b, j) =>
    '<div class="bullet"><textarea data-path="' + section + '.' + i + '.description.' + j + '.text" rows="2">' +
    escHtml(b.text) + '</textarea>' +
    '<button class="mini" type="button" data-del-bullet="' + section + '.' + i + '.' + j + '" title="Remove bullet">✕</button></div>'
  ).join('') +
  '<div class="card-actions"><button class="mini" type="button" data-add-bullet="' + section + '.' + i + '">+ Bullet</button></div>';
}

function renderForm() {
  let html = '<h3>Basics</h3><div class="grid2">' +
    field('Name', 'name', P.name) + field('Title', 'title', P.title) +
    field('Email', 'email', P.email) + field('Phone', 'phone', P.phone) +
    field('Location', 'location', P.location) + field('LinkedIn (handle)', 'linkedin', P.linkedin) +
    field('GitHub (handle)', 'github', P.github) + field('Website', 'website', P.website) +
    area('Summary', 'summary', P.summary) + '</div>';
  html += '<h3>Skills</h3><div class="chips-edit">' +
    (P.skills || []).map((s, i) =>
      '<span class="chip-s">' + escHtml(s) + '<button type="button" data-del-skill="' + i + '">✕</button></span>').join('') +
    '<input id="skill-add" placeholder="+ add skill ⏎"></div>';
  for (const [key, heading, addLabel, entry] of SECTIONS) {
    html += '<h3>' + heading + '</h3>' +
      (P[key] || []).map((e, i) =>
        '<div class="ecard">' + entry(e, i) +
        '<div class="card-actions"><button class="mini" type="button" data-del-entry="' + key + '.' + i + '">Remove</button></div></div>'
      ).join('') +
      '<button class="mini add" type="button" data-add-entry="' + key + '">' + addLabel + '</button>';
  }
  html += '<h3>Custom sections</h3>' +
    (P.customSections || []).map((s, i) => {
      const base = 'customSections.' + i;
      return '<div class="ecard">' +
        '<div class="grid2">' + field('Section title (e.g. Awards, Publications)', base + '.title', s.title, true) + '</div>' +
        (s.entries || []).map((e, j) => {
          const eb = base + '.entries.' + j;
          return '<div class="ecard">' +
            '<div class="grid2">' +
            field('Heading', eb + '.heading', e.heading) +
            field('Date', eb + '.date', e.date) +
            field('Subheading', eb + '.subheading', e.subheading, true) +
            '</div>' +
            (e.description || []).map((b, k) =>
              '<div class="bullet"><textarea data-path="' + eb + '.description.' + k + '.text" rows="2">' + escHtml(b.text) + '</textarea>' +
              '<button class="mini" type="button" data-del-cbullet="' + i + '.' + j + '.' + k + '" title="Remove bullet">✕</button></div>').join('') +
            '<div class="card-actions">' +
            '<button class="mini" type="button" data-add-cbullet="' + i + '.' + j + '">+ Bullet</button>' +
            '<button class="mini" type="button" data-del-centry="' + i + '.' + j + '" style="margin-left:6px">Remove entry</button>' +
            '</div></div>';
        }).join('') +
        '<div class="card-actions">' +
        '<button class="mini" type="button" data-add-centry="' + i + '">+ Entry</button>' +
        '<button class="mini" type="button" data-del-csection="' + i + '" style="margin-left:6px">Remove section</button>' +
        '</div></div>';
    }).join('') +
    '<button class="mini add" type="button" data-add-csection="1">+ Add custom section</button>';
  FORM.innerHTML = html;
}
renderForm();

FORM.addEventListener('input', e => {
  const path = e.target.dataset.path;
  if (path) setPath(P, path, e.target.value);
});
FORM.addEventListener('keydown', e => {
  if (e.target.id === 'skill-add' && e.key === 'Enter' && e.target.value.trim()) {
    (P.skills ??= []).push(e.target.value.trim());
    renderForm();
    document.getElementById('skill-add').focus();
  }
});
const EMPTY_ENTRY = {
  experience: () => ({ company: '', title: '', date: '', location: '', description: [{ text: '' }] }),
  projects: () => ({ name: '', technologies: '', dateRange: '', description: [{ text: '' }] }),
  education: () => ({ institution: '', degree: '', date: '', location: '' }),
};
FORM.addEventListener('click', e => {
  const d = e.target.dataset;
  if (d.delSkill !== undefined) { P.skills.splice(Number(d.delSkill), 1); renderForm(); }
  else if (d.addEntry) { (P[d.addEntry] ??= []).push(EMPTY_ENTRY[d.addEntry]()); renderForm(); }
  else if (d.delEntry) { const [k, i] = d.delEntry.split('.'); P[k].splice(Number(i), 1); renderForm(); }
  else if (d.addBullet) { const [k, i] = d.addBullet.split('.'); (P[k][Number(i)].description ??= []).push({ text: '' }); renderForm(); }
  else if (d.delBullet) { const [k, i, j] = d.delBullet.split('.'); P[k][Number(i)].description.splice(Number(j), 1); renderForm(); }
  else if (d.addCsection) { (P.customSections ??= []).push({ title: '', entries: [{ heading: '', subheading: '', date: '', description: [] }] }); renderForm(); }
  else if (d.delCsection !== undefined) { P.customSections.splice(Number(d.delCsection), 1); renderForm(); }
  else if (d.addCentry !== undefined) { (P.customSections[Number(d.addCentry)].entries ??= []).push({ heading: '', subheading: '', date: '', description: [] }); renderForm(); }
  else if (d.delCentry) { const [i, j] = d.delCentry.split('.'); P.customSections[Number(i)].entries.splice(Number(j), 1); renderForm(); }
  else if (d.addCbullet) { const [i, j] = d.addCbullet.split('.'); (P.customSections[Number(i)].entries[Number(j)].description ??= []).push({ text: '' }); renderForm(); }
  else if (d.delCbullet) { const [i, j, k] = d.delCbullet.split('.'); P.customSections[Number(i)].entries[Number(j)].description.splice(Number(k), 1); renderForm(); }
});

function pruneProfile(p) {
  const clean = JSON.parse(JSON.stringify(p));
  for (const k of ['experience', 'projects', 'education']) {
    clean[k] = (clean[k] || []).filter(e =>
      Object.values(e).some(v => typeof v === 'string' && v.trim()));
    for (const e of clean[k]) {
      if (e.description) e.description = e.description.filter(b => b.text?.trim());
    }
    if (!clean[k].length) delete clean[k];
  }
  clean.customSections = (clean.customSections || [])
    .map(s => ({
      ...s,
      entries: (s.entries || []).map(e => ({
        ...e,
        description: (e.description || []).filter(b => b.text?.trim()),
      })).filter(e =>
        [e.heading, e.subheading, e.date].some(v => v?.trim()) || e.description.length),
    }))
    .filter(s => s.title?.trim() && s.entries.length);
  if (!clean.customSections.length) delete clean.customSections;
  for (const [k, v] of Object.entries(clean)) {
    if (v === '' || v == null) delete clean[k];
  }
  return clean;
}

const saveProfileBtn = document.getElementById('save-profile');
const saveInstrBtn = document.getElementById('save-instructions');
const importOpenBtn = document.getElementById('import-open');
if (!SERVE) {
  saveProfileBtn.disabled = saveInstrBtn.disabled = importOpenBtn.disabled = true;
  saveProfileBtn.textContent = 'static — read-only';
}
saveProfileBtn.addEventListener('click', async () => {
  try {
    await postTo('/api/profile', JSON.stringify(pruneProfile(P)), 'application/json');
    location.reload();
  } catch (e) { statusEl.textContent = 'Save failed: ' + e.message; }
});
saveInstrBtn.addEventListener('click', async () => {
  try {
    await postTo('/api/instructions', document.getElementById('instructions-md').value, 'text/plain');
    location.reload();
  } catch (e) { saveInstrBtn.textContent = 'Save failed: ' + e.message; }
});

// --- AI import dialog ---
const importDlg = document.getElementById('import-dlg');
const importStatus = document.getElementById('import-status');
importOpenBtn.addEventListener('click', () => importDlg.showModal());
importDlg.querySelector('.close').addEventListener('click', () => importDlg.close());
importDlg.addEventListener('click', e => { if (e.target === importDlg) importDlg.close(); });
document.getElementById('import-run').addEventListener('click', async () => {
  const text = document.getElementById('import-text').value;
  if (!text.trim()) { importStatus.textContent = 'Paste some resume text first.'; return; }
  importStatus.textContent = 'Claude is reading your resume… (~30s)';
  importStatus.classList.add('busy');
  try {
    const res = await postTo('/api/import', JSON.stringify({ text }), 'application/json');
    P = await res.json();
    renderForm();
    importDlg.close();
    statusEl.textContent = 'Imported — review below, then Save profile.';
  } catch (e) {
    importStatus.textContent = 'Import failed: ' + e.message;
  } finally {
    importStatus.classList.remove('busy');
  }
});

// --- drag & drop between columns ---
let draggingId = null;
document.querySelectorAll('.card').forEach(card => {
  card.addEventListener('dragstart', () => {
    draggingId = card.dataset.id;
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
});
document.querySelectorAll('.col').forEach(col => {
  col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('dragover'); });
  col.addEventListener('dragleave', () => col.classList.remove('dragover'));
  col.addEventListener('drop', e => {
    e.preventDefault();
    col.classList.remove('dragover');
    const app = byId(draggingId);
    if (!app || app.status === col.dataset.status) return;
    const from = app.status;
    app.status = col.dataset.status;
    app.updatedAt = new Date().toISOString();
    (app.history ??= []).push({ date: app.updatedAt, event: 'status: ' + from + ' → ' + app.status + ' (board)' });
    const cardEl = document.querySelector('.card[data-id="' + CSS.escape(draggingId) + '"]');
    col.querySelector('.cards').prepend(cardEl);
    cardEl.querySelector('.date').textContent = app.updatedAt.slice(0, 10);
    const flag = cardEl.querySelector('.flag');
    if (flag && app.status !== 'pending') flag.remove();
    document.querySelectorAll('.col').forEach(c => {
      c.querySelector('.count').textContent = c.querySelectorAll('.card').length;
    });
    save();
  });
});

// --- detail dialog: JD link, saved info, files, history, description ---
const fileLink = (rel, name) => SERVE
  ? '<a class="jd-link" href="/files/' + rel.split('/').map(encodeURIComponent).join('/') + '" target="_blank">' + escHtml(name) + '</a>'
  : escHtml(name);
function filesSection(app) {
  const own = (app._files || []).map(f => '⌁ ' + fileLink(app.id + '/' + f, f));
  const global = GLOBAL_FILES.map(f => '⌁ ' + fileLink(f, f) + ' <span class="k">(global)</span>');
  const rows = own.concat(global);
  return rows.length
    ? '<div class="kv">' + rows.join('<br>') + '</div>'
    : '<span class="empty-note">No files — drop them in ' + escHtml(FILES_ROOT + '/' + app.id + '/') + '</span>';
}
const dlg = document.getElementById('detail');
function openDetail(app) {
  const color = COLORS[app.status] || 'var(--rule-2)';
  const info = [
    ['Company', app.company], ['Position', app.position],
    ['Tracked', (app.createdAt || '').slice(0, 10)],
    ['Updated', (app.updatedAt || '').slice(0, 10)],
  ].filter(([, v]) => v);
  dlg.innerHTML =
    '<div class="dlg-head" style="--chip-accent:' + color + '">' +
      '<h3>' + escHtml(app.title) + '</h3>' +
      (app.needsFallback && app.status === 'pending'
        ? '<span class="chip" style="--chip-accent:var(--accent)">claude fallback</span>'
        : '') +
      '<span class="chip">' + escHtml(app.status) + '</span>' +
      '<button class="close" type="button" aria-label="Close">✕</button>' +
    '</div>' +
    '<div class="dlg-body">' +
      '<h4>JD Link</h4>' +
      '<a class="jd-link" href="' + escHtml(app.url) + '" target="_blank" rel="noreferrer">' + escHtml(app.url) + '</a>' +
      '<h4>Saved Info</h4>' +
      (info.length
        ? '<div class="kv">' + info.map(([k, v]) => '<span class="k">' + k + ':</span> ' + escHtml(v)).join('<br>') + '</div>'
        : '<span class="empty-note">—</span>') +
      (app.notes ? '<h4>Notes</h4><div class="kv">' + escHtml(app.notes) + '</div>' : '') +
      '<h4>Files</h4>' + filesSection(app) +
      '<h4>History</h4>' +
      (app.history?.length
        ? '<ul class="timeline">' + app.history.map(h =>
            '<li><span class="t-date">' + escHtml((h.date || '').replace('T', ' ').slice(0, 16)) + '</span>' + escHtml(h.event) + '</li>'
          ).join('') + '</ul>'
        : '<span class="empty-note">No events recorded yet</span>') +
      '<h4>Description</h4>' +
      (app.description
        ? '<div class="desc">' + escHtml(app.description) + '</div>'
        : '<span class="empty-note">No description saved</span>') +
    '</div>';
  dlg.querySelector('.close').addEventListener('click', () => dlg.close());
  dlg.showModal();
}
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
document.querySelectorAll('.card').forEach(card => {
  card.addEventListener('click', () => openDetail(byId(card.dataset.id)));
  card.addEventListener('keydown', e => { if (e.key === 'Enter') openDetail(byId(card.dataset.id)); });
});

// --- initial tab: hash if valid, else Discover is home ---
const initial = location.hash.slice(1);
showView(['discover', 'profile', 'board', 'instructions'].includes(initial) ? initial : 'discover');
</script>
</body>
</html>
`;
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
    if (req.method === 'GET' && (req.url === '/' || req.url === '/board')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(render(loadApps()));
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
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
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
            ...(job.location ? { notes: job.location } : {}),
            history: [
              { date: now, event: `discovered via console (${job.source || 'manual'}) — queued for apply` },
            ],
          });
          writeFileSync(input, `${JSON.stringify(apps, null, 2)}\n`);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: apps[0].id }));
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
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const prefs = JSON.parse(body);
          if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs))
            throw new Error('expected a JSON object');
          writeFileSync(prefsPath, `${JSON.stringify(prefs, null, 2)}\n`);
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
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
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
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { text } = JSON.parse(body);
          if (!text?.trim()) throw new Error('empty resume text');
          // headless local Claude; COFORCE_CLAUDE_BIN overrides for the harness stub
          const bin = process.env.COFORCE_CLAUDE_BIN || 'claude';
          const out = execFileSync(bin, ['-p', IMPORT_PROMPT], {
            input: text,
            encoding: 'utf8',
            timeout: 180_000,
            maxBuffer: 10 * 1024 * 1024,
          });
          const jsonText = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
          const profile = JSON.parse(jsonText);
          if (!profile || typeof profile !== 'object' || Array.isArray(profile))
            throw new Error('parser returned a non-object');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(profile));
        } catch (err) {
          const hint = /ENOENT/.test(String(err.message))
            ? 'claude CLI not found — run /profile inside Claude Code instead'
            : err.message;
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(String(hint));
        }
      });
      return;
    }
    if (req.url === '/api/instructions' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
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
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
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
  server.listen(port, () => {
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
  writeFileSync(output, render(apps));
  console.log(`board: ${apps.length} applications → ${output}`);
}
