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
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';

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
  return `<div class="resume">
    <h2 class="r-name">${esc(p.name || '')}</h2>
    <div class="r-title">${esc(p.title || '')}</div>
    <div class="r-contact">${contact}</div>
    ${p.summary ? `<h3>Summary</h3><p>${esc(p.summary)}</p>` : ''}
    ${p.skills?.length ? `<h3>Skills</h3><div class="chips">${p.skills.map(s => `<span class="chip-s">${esc(s)}</span>`).join('')}</div>` : ''}
    ${exp ? `<h3>Experience</h3>${exp}` : ''}
    ${proj ? `<h3>Projects</h3>${proj}` : ''}
    ${edu ? `<h3>Education</h3>${edu}` : ''}
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
  .editor-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .editor-bar .hint { color: var(--dim); font-size: .6875rem; word-break: break-all; }
  .editor-bar button {
    font: 500 .75rem var(--font-body); color: var(--accent-soft);
    background: var(--accent-wash); border: 1px solid var(--accent);
    border-radius: var(--radius-chip); padding: 6px 14px; cursor: pointer; white-space: nowrap;
  }
  .pane-empty { color: var(--dim); text-align: center; margin: auto; }
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
    <button data-view="board" class="active" type="button">Board</button>
    <button data-view="profile" type="button">Profile</button>
    <button data-view="instructions" type="button">Instructions</button>
  </nav>
  <span class="tracked">${apps.length} tracked</span>
  <div id="savebar"><span class="state"></span><button id="copyjson" type="button">Copy JSON</button></div>
</header>
<main class="views">
  <div class="view active" id="view-board">
    <div class="board">${columns}
    </div>
  </div>
  <div class="view" id="view-profile">
    <div class="panes">
      <div class="pane preview">${renderProfile(profile)}</div>
      <div class="pane editor">
        <textarea id="profile-json" spellcheck="false">${esc(profile ? JSON.stringify(profile, null, 2) : '{\n}')}</textarea>
        <div class="editor-bar"><span class="hint">${esc(profilePath)}</span><button id="save-profile" type="button">Save profile</button></div>
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
<script>
const APPS = ${payload};
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

// --- header tabs ---
document.querySelectorAll('#tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach(v =>
      v.classList.toggle('active', v.id === 'view-' + btn.dataset.view));
  });
});

// --- profile & instructions editors (serve mode only) ---
async function postTo(url, body, contentType) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': contentType }, body });
  if (!res.ok) throw new Error(await res.text() || res.status);
}
const saveProfileBtn = document.getElementById('save-profile');
const saveInstrBtn = document.getElementById('save-instructions');
if (!SERVE) {
  saveProfileBtn.disabled = saveInstrBtn.disabled = true;
  saveProfileBtn.textContent = saveInstrBtn.textContent = 'static file — read-only';
}
saveProfileBtn.addEventListener('click', async () => {
  const raw = document.getElementById('profile-json').value;
  try { JSON.parse(raw); } catch (e) { saveProfileBtn.textContent = 'Invalid JSON: ' + e.message; return; }
  try {
    await postTo('/api/profile', raw, 'application/json');
    location.reload();
  } catch (e) { saveProfileBtn.textContent = 'Save failed: ' + e.message; }
});
saveInstrBtn.addEventListener('click', async () => {
  try {
    await postTo('/api/instructions', document.getElementById('instructions-md').value, 'text/plain');
    location.reload();
  } catch (e) { saveInstrBtn.textContent = 'Save failed: ' + e.message; }
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
