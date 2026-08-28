#!/usr/bin/env node
// Render a terminal capture (harness/out/*/frames.json, written by
// record-setup.mjs) into the README demo asset.
//
// Two outputs from one frame builder:
//   demo.svg  — a self-contained animated SVG. Zero dependencies, renders on
//               every platform, stays crisp at any width. Always written.
//   demo.gif  — the same frames rasterised. GitHub plays a GIF everywhere, so
//               this is what the README embeds. Needs two dev-only packages
//               that are deliberately NOT in package.json (the repo ships with
//               no runtime dependencies):
//                 npm i --no-save @resvg/resvg-js gifenc
//               Without them the GIF leg is skipped and says so.
//
//   node harness/render-demo.mjs [frames.json] [--out <dir>] [--scale 1]
//
// The old renderer shelled out to qlmanage + ffmpeg and therefore only ever
// produced a video on macOS; this one runs anywhere Node runs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ---- theme: kobe Hallmark, the same tokens the console uses ----------------
const THEME = {
  bg: '#181310',
  chrome: '#221a15',
  border: '#3a2c24',
  ink: '#f2e7dd',
  muted: '#a89484',
  accent: '#d97b57', // terracotta
  command: '#d9b06b',
  ok: '#7fa66a',
  bad: '#d9615a',
  user: '#8fb3c9',
};

const FONT = 'JetBrains Mono, DejaVu Sans Mono, Menlo, ui-monospace, monospace';
const FONT_SIZE = 15;
const ADVANCE = 0.6023 * FONT_SIZE; // real monospace advance, not a guess
const LINE_H = 22;
const PAD_X = 26;
const PAD_Y = 20;
const TITLEBAR = 38;

// Line colour is a function of its marker — the capture writes the markers.
const lineColor = line => {
  if (line.startsWith('▌')) return THEME.accent;
  if (line.startsWith('$ ')) return THEME.command;
  if (line.startsWith('› ')) return THEME.user;
  if (line.trimStart().startsWith('✗')) return THEME.bad;
  if (line.startsWith('  ')) return THEME.muted;
  return THEME.ink;
};

const esc = s => s
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

export function frameGeometry(capture) {
  const width = Math.round(capture.cols * ADVANCE + PAD_X * 2);
  const height = Math.round(capture.rows * LINE_H + PAD_Y * 2 + TITLEBAR);
  return { width, height };
}

const windowChrome = (width, title) => {
  const dots = ['#d9615a', '#d9b06b', '#7fa66a']
    .map((fill, index) => `<circle cx="${22 + index * 18}" cy="${TITLEBAR / 2}" r="5.5" fill="${fill}"/>`)
    .join('');
  return `<rect width="${width}" height="${TITLEBAR}" fill="${THEME.chrome}"/>`
    + `<line x1="0" y1="${TITLEBAR}" x2="${width}" y2="${TITLEBAR}" stroke="${THEME.border}" stroke-width="1"/>`
    + dots
    + `<text x="${width / 2}" y="${TITLEBAR / 2 + 4}" text-anchor="middle" fill="${THEME.muted}"`
    + ` font-family="${FONT}" font-size="12">${esc(title)}</text>`;
};

// One frame as SVG body (no <svg> wrapper) so both outputs share a renderer.
export function frameBody(frame) {
  return frame.lines.map((line, row) => {
    if (!line) return '';
    const y = TITLEBAR + PAD_Y + (row + 1) * LINE_H - 6;
    return `<text x="${PAD_X}" y="${y}" fill="${lineColor(line)}" xml:space="preserve">${esc(line)}</text>`;
  }).join('');
}

const svgDocument = (capture, body, extraDefs = '') => {
  const { width, height } = frameGeometry(capture);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`
    + ` viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="${FONT_SIZE}">`
    + extraDefs
    + `<rect width="${width}" height="${height}" fill="${THEME.bg}"/>`
    + windowChrome(width, capture.meta?.title || 'coforce apply')
    + body
    + '</svg>';
};

// A still of one frame — what the rasteriser consumes.
export function frameSvg(capture, frame) {
  return svgDocument(capture, frameBody(frame));
}

// ---- timing ----------------------------------------------------------------
// Capture timestamps are real wall-clock: a command that took 4s would hold a
// dead frame for 4s. Clamp into a readable band and give the last frame a beat.
const MIN_MS = 260;
const MAX_MS = 1500;
const TAIL_MS = 3200;

export function frameDurations(frames) {
  return frames.map((frame, index) => {
    const next = frames[index + 1];
    if (!next) return TAIL_MS;
    return Math.min(Math.max(next.t - frame.t, MIN_MS), MAX_MS);
  });
}

// ---- output 1: animated SVG (zero dependencies) ----------------------------
export function renderAnimatedSvg(capture) {
  const durations = frameDurations(capture.frames);
  const total = durations.reduce((sum, ms) => sum + ms, 0);
  let elapsed = 0;
  const groups = [];
  const rules = [];
  capture.frames.forEach((frame, index) => {
    const from = (elapsed / total) * 100;
    elapsed += durations[index];
    const to = (elapsed / total) * 100;
    const p = value => Math.max(0, Math.min(100, value)).toFixed(4);
    // steps(1) keeps every switch instant — a terminal does not cross-fade.
    rules.push(`@keyframes f${index}{0%,${p(from)}%{opacity:0}`
      + `${p(from + 0.0001)}%,${p(to)}%{opacity:1}`
      + `${p(to + 0.0001)}%,100%{opacity:0}}`
      + `#f${index}{animation:f${index} ${(total / 1000).toFixed(2)}s steps(1,end) infinite}`);
    groups.push(`<g id="f${index}" opacity="0">${frameBody(frame)}</g>`);
  });
  const style = `<style>${rules.join('')}</style>`;
  return `${svgDocument(capture, groups.join(''), style)}\n`;
}

// ---- output 2: GIF (optional dev dependencies) ------------------------------
async function renderGif(capture, outPath, scale) {
  let Resvg;
  let gifenc;
  try {
    ({ Resvg } = await import('@resvg/resvg-js'));
    gifenc = await import('gifenc');
  } catch {
    return { ok: false, reason: 'needs `npm i --no-save @resvg/resvg-js gifenc`' };
  }
  const { GIFEncoder, quantize, applyPalette } = gifenc.default || gifenc;
  const { width, height } = frameGeometry(capture);
  const outWidth = Math.round(width * scale);
  const durations = frameDurations(capture.frames);
  const encoder = GIFEncoder();
  // The palette is built once, from the busiest frame, and reused: a shared
  // global palette is both smaller and free of the frame-to-frame colour
  // shimmer you get from per-frame quantisation.
  const busiest = capture.frames.reduce((best, frame) =>
    (frame.lines.join('').length > best.lines.join('').length ? frame : best), capture.frames[0]);
  const rasterise = frame => {
    const png = new Resvg(frameSvg(capture, frame), {
      fitTo: { mode: 'width', value: outWidth },
      font: { loadSystemFonts: true },
    }).render();
    return { data: new Uint8Array(png.pixels), width: png.width, height: png.height };
  };
  const reference = rasterise(busiest);
  const palette = quantize(reference.data, 64, { format: 'rgba4444' });
  for (const [index, frame] of capture.frames.entries()) {
    const raster = rasterise(frame);
    encoder.writeFrame(applyPalette(raster.data, palette, 'rgba4444'), raster.width, raster.height, {
      palette: index === 0 ? palette : undefined,
      delay: durations[index],
      repeat: 0,
    });
  }
  encoder.finish();
  const bytes = Buffer.from(encoder.bytes());
  writeFileSync(outPath, bytes);
  return { ok: true, bytes: bytes.length, width: outWidth, height: Math.round(height * scale) };
}

// ---- cli -------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (name, fallback = null) => {
    const index = argv.indexOf(name);
    return index === -1 ? fallback : argv[index + 1];
  };
  const input = resolve(argv.find(value => !value.startsWith('--') && value !== flag('--out') && value !== flag('--scale'))
    || join(here, 'out/setup-recording/frames.json'));
  if (!existsSync(input)) {
    console.error(`no capture at ${input} — run \`npm run record:setup\` first`);
    process.exit(1);
  }
  const outDir = resolve(flag('--out', dirname(input)));
  const scale = Number(flag('--scale', '1')) || 1;
  mkdirSync(outDir, { recursive: true });
  const capture = JSON.parse(readFileSync(input, 'utf8'));

  const svgPath = join(outDir, 'demo.svg');
  writeFileSync(svgPath, renderAnimatedSvg(capture));
  const seconds = (frameDurations(capture.frames).reduce((sum, ms) => sum + ms, 0) / 1000).toFixed(1);
  console.log(`render-demo: ${capture.frames.length} frames, ${seconds}s loop`);
  console.log(`  svg : ${svgPath}`);

  const gif = await renderGif(capture, join(outDir, 'demo.gif'), scale);
  console.log(gif.ok
    ? `  gif : ${join(outDir, 'demo.gif')} (${(gif.bytes / 1e6).toFixed(2)} MB, ${gif.width}×${gif.height})`
    : `  gif : skipped — ${gif.reason}`);
}
