// Every string here is traceable to README.md, CLAUDE.md, or docs/OPERATOR.md in
// this repo. Hallmark discipline 2: no fabricated content. There is deliberately
// not a single metric on this page — no user count, no success rate, no "10x
// faster". The tracker in this repo records 5 applications; nothing on disk
// supports a headline number, so the page is built to not need one. If real
// figures with a stated denominator arrive later, this file is where they land.

export const product = {
  name: 'CoForce Apply',
  tagline: 'Your job hunt on autopilot.',
  summary:
    'A skill-first job application agent. Claude Code finds postings, matches them against your real GitHub work, builds resumes you review, fills applications in your own Chrome, and tracks all of it on your machine.',
  repo: 'https://github.com/Sma1lboy/coforce-apply',
  license: 'MIT',
};

// The CTA. One line, and it runs — so the line is the hero, not a button
// pointing at a signup form that does not exist.
export const install = 'git clone https://github.com/Sma1lboy/coforce-apply && cd coforce-apply && claude';

// The operating cycle, verbatim from the README banner: discover → tailor →
// apply → track. Each step names the actual skill you invoke — the commands
// ARE the product, so the page shows them instead of marketing verbs.
export const pipeline = [
  { verb: 'discover', cmd: '/start', note: 'new postings from sources you configured, deduped' },
  { verb: 'tailor', cmd: '/tailor', note: 'a JD in, a one-page PDF out of your verified bullets' },
  { verb: 'apply', cmd: '/apply', note: 'your visible Chrome, stops before submit' },
  { verb: 'track', cmd: '/tracker', note: 'a local board, every status change keeps its history' },
];

export const firstRun = {
  command: '/tailor https://job-posting-url',
  promise: 'One job description in, a one-page PDF out.',
  detail:
    'Paste a posting and point at the resume you already have. Nothing to configure first — no account, no onboarding, no profile to fill in.',
};

// ── The diagram ──────────────────────────────────────────────────────────────
// Two rails and one crossing. Everything the user has verified enters from the
// left; everything a specific employer wants enters from the right; the only
// edge out of the crossing runs through the pool they approved. Wording stays
// short because these are labels on a graph, not paragraphs.

export const supplyRail = {
  label: 'what you have actually done',
  steps: [
    { node: 'a repository', note: 'local path or a GitHub URL' },
    { node: 'your commits', note: 'scoped to you, read from the diffs' },
    { node: 'draft bullets', note: 'written with no job description in context' },
    { node: 'you approve them', note: 'the only way in', live: true },
  ],
};

export const demandRail = {
  label: 'what one employer wants',
  steps: [
    { node: 'a posting', note: 'pasted, or found by a source you configured' },
    { node: 'the full description', note: 'never a search snippet' },
    { node: 'its real requirements', note: 'ranked the way the posting ranks them' },
    { node: 'what the pool cannot cover', note: 'named, not papered over', live: true },
  ],
};

export const crossing = {
  node: 'your verified pool',
  claim:
    'This is the only crossing. A posting decides which of your sentences appear and in what order. It cannot write one.',
  out: [
    { step: 'verbatim selection', note: 'word for word, ids checked against the pool' },
    { step: 'one page, filled', note: 'measured, not eyeballed' },
    { step: 'still readable after extraction', note: 'the layer every ATS reads' },
  ],
};

export const gate = {
  word: 'you',
  body:
    'Nothing crosses this line without you saying so — not with review turned off, not with headless apply turned on. An unanswerable screening question stops the run instead of guessing.',
};

// ── The submission half ─────────────────────────────────────────────────────
// The four laws from docs/OPERATOR.md. This is the contract the submitting agent
// runs against, not a settings page — worth saying plainly, because "an agent
// that applies to jobs for you" is the part people are right to distrust.
export const ironLaws = [
  {
    law: 'Never cross the confirmation gate',
    body:
      'No operator submits an application without your explicit confirmation for that specific submission. Turning resume review off does not waive it. Turning on headless apply does not waive it.',
  },
  {
    law: 'Never fabricate',
    body:
      'Screening answers — visa status, sponsorship, years of experience — come from your config and profile or the run stops. An unanswerable required question is a failure, not a guess.',
  },
  {
    law: 'Your standing instructions outrank everything',
    body:
      'Including a job already queued. A never-apply company stops the run and reports, at every tier, no matter what else said go.',
  },
  {
    law: 'All state lands in your files',
    body:
      'An operator’s only outputs are its status events and writes under ~/.coforce — the tracker entry, the history event, the logs. There are no side channels.',
  },
];

export const lane = ['pending', 'applied', 'interviewing', 'offer', 'rejected'];

export const tracking = [
  {
    heading: 'A lane, and an honest failure state',
    body:
      'pending → applied → interviewing → offer or rejected, on a board you open locally. Plus one status the polite tools leave out: needsFallback — the operator gave up and a human has to take this one. It clears when someone does.',
  },
  {
    heading: 'Every application keeps its own folder',
    body:
      'The resume that went out, the description as it read that day, screenshots of what was submitted, the offer letter if it comes. Enter interviewing and it offers to start an interview-prep note; go quiet for two weeks and it lists what has gone stale.',
  },
  {
    heading: 'It looks back at which bullets worked',
    body:
      'Each resume records which of your bullets it used, and the tracker records where that application ended up. Joining the two says which lines rode on applications that advanced, which rode on rejections, and which have never been picked for a single resume. Correlation, not causation — with five applications it tells you nothing, and it says so.',
  },
];

// The ticker's contents: the actual files this thing writes under your data
// home. Real paths, so the strip is information and not filler words.
export const dataHome = [
  { path: '~/.coforce/profile.json', note: 'your verified pool' },
  { path: 'applications.json', note: 'the tracker, source of truth' },
  { path: 'instructions.md', note: 'your standing rules, they outrank the agent' },
  { path: 'config.json', note: 'level · sponsorship · work mode · locations' },
  { path: 'campaigns/current/', note: 'this cycle, per job' },
  { path: 'applications/<id>/', note: 'resume, jd, screenshots, offer letter' },
  { path: 'experience/', note: 'regenerable cache, not a contract' },
  { path: 'out/', note: 'the PDFs' },
];

// Real captures of the running product, both from the repo's own sandbox
// (`npm run sandbox` — a seeded throwaway data home). Naming the fixture in the
// caption matters: a screenshot of invented activity would be the same lie as an
// invented metric, and a reader who clones the repo can reproduce exactly these.
export const shots = [
  {
    src: './demo-console.png',
    alt: 'The CoForce board: seven applications across to-apply, applied, interviewing, offer and rejected columns.',
    title: 'The board',
    caption:
      'Seven applications, each column counted, every status change keeping its own dated history event. Served locally off your own files — this one runs on the repo’s sandbox, so the companies are seed data.',
  },
  {
    src: './demo-resume.png',
    alt: 'A rendered one-page resume: education, two roles with five and four bullets, two projects, a skills block, filling the page to the bottom margin.',
    title: 'One page. Nothing invented.',
    caption:
      'One page at 94.2% coverage — measured by the same gate the product refuses to auto-approve below, not eyeballed. Invented person, real artifact: site/demo/render.mjs will not emit this image if the PDF drops under 93%.',
  },
];

export const requirements = [
  'Claude Code',
  'Node 22+',
  'A LaTeX toolchain for PDFs',
  'Claude in Chrome, only for /apply',
];
