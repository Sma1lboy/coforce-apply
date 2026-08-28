#!/usr/bin/env node
// Console demo recorder: seeds a throwaway data home, starts the REAL console
// server on it, drives the REAL UI in a browser, and encodes what the browser
// showed into the README's hero GIF. Nothing here is a mockup — every pixel is
// the shipped React app rendering shipped fixtures.
//
//   npm run record:console
//
// Outputs under harness/out/console-recording/:
//   console-demo.gif  — the README hero
//   frames/*.png      — the beats as filmed (1x, the GIF's own frames)
//   stills/*.png      — the same beats at 2x, for embedding in the docs
//
// Dev-only dependencies, deliberately absent from package.json (the repo ships
// with no runtime dependencies):
//
//   npm i --no-save playwright pngjs gifenc && npx playwright install chromium
//
// Without them the run stops with that instruction instead of half-working.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedSandbox } from './sandbox.mjs';
import { describeGif, encodeGif } from './gif.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const outDir = join(here, 'out', 'console-recording');
const framesDir = join(outDir, 'frames');
const stillsDir = join(outDir, 'stills');
const PORT = Number(process.env.COFORCE_DEMO_PORT || 4521);
const VIEWPORT = { width: 1240, height: 780 };
// Two beats that paint the same pixels read as a frozen GIF, and it is not
// obvious from the script that they will: every beat here does *something*, it
// is just that some of those somethings leave the view unchanged. So the
// recording measures itself and fails rather than shipping a stall.
const MIN_FRAME_DELTA = 0.02;

const frameDelta = (before, after) => {
  let changed = 0;
  for (let px = 0; px < before.data.length; px += 4) {
    const drift = Math.abs(before.data[px] - after.data[px])
      + Math.abs(before.data[px + 1] - after.data[px + 1])
      + Math.abs(before.data[px + 2] - after.data[px + 2]);
    if (drift > 24) changed += 1;
  }
  return changed / (before.data.length / 4);
};

const skill = (...parts) => join(repoRoot, '.agents/skills', ...parts);
const node = (script, args) => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' });

// ---- 1. a data home worth filming -------------------------------------------
// The landing site's demo persona, so the console and the site tell one story,
// and its already-rendered resume PDF, so the Review tab has a real proof to
// show without a LaTeX toolchain on the recording machine.
function seedDemoHome() {
  rmSync(join(outDir, 'coforce'), { recursive: true, force: true });
  const home = seedSandbox(join(outDir, 'coforce'));

  const profile = JSON.parse(readFileSync(join(repoRoot, 'site/demo/profile.json'), 'utf8'));
  delete profile._comment;
  profile.resumeSkillPolicy = {
    status: 'approved',
    reviewedAt: '2026-08-01T00:00:00.000Z',
    baseline: ['Go', 'Python', 'TypeScript'],
    rolePacks: {
      backend: ['PostgreSQL', 'Redis', 'Kafka', 'gRPC', 'Docker', 'Kubernetes'],
      infra: ['Terraform', 'AWS', 'Prometheus', 'OpenTelemetry'],
    },
  };
  writeFileSync(join(home, 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`);

  // a board with history on it, not an empty first run
  copyFileSync(join(here, 'fixtures/applications.json'), join(home, 'applications.json'));

  const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
  config.latexTemplate = skill('tailor/assets/resume_template.tex');
  config.requireResumeReview = true;
  // Discover's filters are the intent keys in config.json; 'any' is the UI's
  // "Both", and the direction keys come from tracker/web/src/lib/classify.js.
  config.level = 'any';
  config.directions = ['backend', 'fullstack', 'infra', 'data', 'ai-ml', 'frontend', 'general'];
  writeFileSync(join(home, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);

  const campaign = skill('campaign/scripts/campaign.mjs');
  node(skill('experience/scripts/experience.mjs'), ['build', '--data-dir', home]);
  node(campaign, ['sync', '--data-dir', home, '--apps', join(home, 'applications.json')]);

  const jobs = JSON.parse(node(campaign, ['show', '--data-dir', home])).jobs;
  const job = jobs.find(entry => /Nimbus/i.test(entry.company)) || jobs[0];
  const jdPath = join(outDir, 'jd.txt');
  writeFileSync(jdPath, [
    'Senior Full-Stack Engineer — Nimbus Analytics',
    '',
    'You will own an ingestion path end to end: designing services in Go and',
    'TypeScript on PostgreSQL and Kafka, profiling them, and driving down p99',
    'latency under production load. You will ship the deploy pipeline that',
    'carries them, instrument what you ship, and keep the error budget honest.',
    '',
    'Requirements: distributed systems fundamentals, gRPC or REST API design,',
    'containerised deploys, automated testing, and real observability practice.',
  ].join('\n'));
  node(campaign, ['hydrate', '--data-dir', home, '--id', job.id, '--file', jdPath]);

  const bullets = JSON.parse(node(campaign, ['pool', '--data-dir', home])).map(item => item.id);
  const skills = JSON.parse(node(campaign, ['skills', '--data-dir', home]));
  const selectable = skills
    .filter(item => item.baseline || item.rolePacks.includes('backend'))
    .map(item => item.id);
  node(campaign, ['select', '--data-dir', home, '--id', job.id,
    '--bullets', bullets.join(','), '--skills', selectable.join(','), '--skill-pack', 'backend']);
  node(campaign, ['assemble', '--data-dir', home, '--id', job.id]);
  node(campaign, ['stage', '--data-dir', home, '--id', job.id,
    '--pdf', join(repoRoot, 'site/demo/resume.pdf')]);

  return { home, job };
}

// ---- 2. the storyboard -------------------------------------------------------
// One entry per beat: what the viewer should understand, and how long to hold
// it. Holds are generous — a reader has to find the thing before it moves.
const storyboard = ({ job }) => [
  {
    name: 'discover',
    hold: 2400,
    async act(page) {
      await page.goto(`http://127.0.0.1:${PORT}/`);
      await page.waitForSelector('text=Refresh sources', { timeout: 20000 });
      await page.waitForTimeout(1200);
    },
  },
  {
    name: 'queue',
    hold: 1800,
    async act(page) {
      const build = page.locator('text=Build resume').first();
      if (await build.count()) {
        await build.scrollIntoViewIfNeeded();
        await build.click();
        await page.waitForTimeout(1600);
      }
    },
  },
  {
    name: 'review-pdf',
    hold: 2200,
    async act(page) {
      // Queueing already landed on Review with this job selected, so the beat
      // that earns its own frame is reading DOWN the proof, not re-selecting it.
      await page.waitForSelector('text=PDF proof', { timeout: 20000 });
      await page.locator(`text=${job.role}`).first().click();
      await page.waitForTimeout(2200); // pdf.js has to paint the page
      await page.mouse.move(620, 480);
      await page.mouse.wheel(0, 620);
      await page.waitForTimeout(900);
    },
  },
  {
    name: 'review-zoom',
    hold: 2000,
    async act(page) {
      const zoomIn = page.locator('button', { hasText: /^\+$/ }).first();
      if (await zoomIn.count()) {
        await zoomIn.click();
        await zoomIn.click();
      }
      await page.waitForTimeout(1200);
    },
  },
  {
    name: 'review-evidence',
    hold: 2600,
    async act(page) {
      // The right rail is the argument: every line on that PDF, verbatim, with
      // the profile entry it came from. Scroll it, do not just point at it —
      // but stop on the evidence, before the review controls.
      await page.mouse.move(1080, 480);
      await page.mouse.wheel(0, 380);
      await page.waitForTimeout(900);
    },
  },
  {
    name: 'board',
    hold: 2400,
    async act(page) {
      await page.click('text=Board');
      await page.waitForTimeout(1400);
    },
  },
  {
    name: 'profile-policy',
    hold: 2600,
    async act(page) {
      await page.click('text=Profile');
      await page.waitForTimeout(1400);
      await page.evaluate(() => {
        const heading = [...document.querySelectorAll('*')]
          .find(node => node.textContent.trim().startsWith('RESUME SKILL POLICY') && node.children.length < 4);
        heading?.scrollIntoView({ block: 'center' });
      });
      await page.waitForTimeout(1000);
    },
  },
  {
    name: 'instructions',
    hold: 2800,
    async act(page) {
      await page.click('text=Instructions');
      await page.waitForTimeout(1400);
    },
  },
];

// ---- 3. drive it -------------------------------------------------------------
async function main() {
  let chromium;
  let PNG;
  try {
    ({ chromium } = await import('playwright'));
    ({ PNG } = await import('pngjs'));
  } catch {
    console.error('record-console needs its dev-only render deps:\n'
      + '  npm i --no-save playwright pngjs gifenc && npx playwright install chromium');
    process.exit(1);
  }

  mkdirSync(framesDir, { recursive: true });
  mkdirSync(stillsDir, { recursive: true });
  const { home, job } = seedDemoHome();

  const server = spawn(process.execPath, [
    skill('tracker/scripts/board.mjs'), join(home, 'applications.json'), '--serve', String(PORT),
  ], {
    stdio: 'ignore',
    env: {
      ...process.env,
      COFORCE_HOME: home,
      COFORCE_SOURCE_FILE: join(here, 'fixtures/demo-jobs.md'),
    },
  });
  const stop = () => { if (!server.killed) server.kill('SIGKILL'); };
  process.on('exit', stop);

  const browser = await chromium.launch();
  const frames = [];
  const delays = [];
  try {
    await waitForServer(PORT);

    // Pass 1 — the animation. 1x keeps the GIF small; a terminal-sized hero
    // does not need retina pixels.
    const page = await browser.newPage({ viewport: VIEWPORT, colorScheme: 'dark' });
    const beats = storyboard({ job });
    const stalls = [];
    for (const [index, beat] of beats.entries()) {
      await beat.act(page);
      const png = await page.screenshot();
      writeFileSync(join(framesDir, `${beat.name}.png`), png);
      const decoded = PNG.sync.read(png);
      const previous = frames.at(-1);
      const delta = previous ? frameDelta(previous, decoded) : 1;
      frames.push({ data: new Uint8Array(decoded.data), width: decoded.width, height: decoded.height });
      delays.push(beat.hold);
      console.log(`  beat: ${beat.name}  (${(delta * 100).toFixed(1)}% of the view changed)`);
      if (delta < MIN_FRAME_DELTA) {
        stalls.push(`${beats[index - 1].name} → ${beat.name}: ${(delta * 100).toFixed(1)}%`);
      }
    }
    await page.close();
    if (stalls.length) {
      throw new Error('beats that leave the view unchanged would read as a frozen GIF:\n  '
        + stalls.join('\n  '));
    }

    // Pass 2 — the same beats at 2x, as the stills the docs embed. Same script,
    // same seeded state, so a screenshot in the docs can never show a console
    // the GIF does not.
    const retina = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: 'dark' });
    for (const beat of storyboard({ job })) {
      await beat.act(retina);
      writeFileSync(join(stillsDir, `${beat.name}.png`), await retina.screenshot());
    }
    await retina.close();
    console.log(`  stills: ${stillsDir}`);
  } finally {
    await browser.close();
    stop();
  }

  const gifPath = join(outDir, 'console-demo.gif');
  // The PDF proof is the most colourful frame, so it makes the palette.
  const result = await encodeGif({ frames, delays, outPath: gifPath, paletteFrame: frames[2] || frames[0] });
  console.log(`record-console: ${frames.length} beats captured from the real console ✓`);
  console.log(`  frames : ${framesDir}`);
  console.log(`  gif    : ${describeGif(result, gifPath)}`);
}

async function waitForServer(port, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/state`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error(`console did not come up on :${port}`);
}

await main();
