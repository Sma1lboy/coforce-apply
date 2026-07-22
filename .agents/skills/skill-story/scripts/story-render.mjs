#!/usr/bin/env node
// Skill story renderer — re-render side of the story system. frames.json is
// the source of truth (lines carry raw ANSI from `tmux capture-pane -e`);
// this parses SGR sequences into styled spans, kobe-quicklook style, and
// renders faithful-color artifacts as many times as you like:
//
//   node .agents/skills/skill-story/scripts/story-render.mjs <story-name> [--speed 1.5] [--max-frame-s 2]
//
// Outputs into harness/stories/<story-name>/:
//   replay.html — self-contained animated replay with true colors
//   story.mp4   — via qlmanage + ffmpeg (macOS; skipped gracefully elsewhere)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const name = args.find(a => !a.startsWith('--'));
if (!name) {
  console.error('usage: story-render.mjs <story-name> [--speed 1.5] [--max-frame-s 2]');
  process.exit(1);
}
const opt = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const speed = opt('--speed', 1.5);
const maxFrame = opt('--max-frame-s', 2);

const storyDir = join(here, '../../../../harness/stories', name);
const { cols, rows, frames } = JSON.parse(readFileSync(join(storyDir, 'frames.json'), 'utf8'));

// ---- minimal SGR parser (ported from kobe quicklook/ansi.ts) ---------------
// Captures contain SGR color/style sequences only (no cursor movement), so a
// span-splitter suffices — no terminal emulator.
const THEME = {
  defaultFg: '#f2e7dd',
  defaultBg: '#181310',
  // Hallmark-leaning 16-color palette (kobe's warm scheme, bg-adjusted)
  ansi16: [
    '#141413', '#D47563', '#9ACA86', '#E8C96B', '#CC785C', '#9B87F5', '#5FB4C9', '#EAE7DF',
    '#6b5d52', '#E08A76', '#B0DCA0', '#F2DA8C', '#D4967E', '#B3A3F8', '#8CD3E5', '#FFFFFF',
  ],
};

const cube = n => (n === 0 ? 0 : 55 + n * 40);
const color256 = n => {
  if (n < 16) return THEME.ansi16[n];
  if (n < 232) {
    const i = n - 16;
    const r = cube(Math.floor(i / 36));
    const g = cube(Math.floor((i % 36) / 6));
    const b = cube(i % 6);
    return `rgb(${r},${g},${b})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v},${v},${v})`;
};

function parseAnsiLine(raw) {
  const spans = [];
  let style = {};
  let text = '';
  const flush = () => {
    if (text) spans.push({ text, ...style });
    text = '';
  };
  let i = 0;
  const CSI_RE = /^\x1b\[[0-?]*[ -\/]*[@-~]/;
  while (i < raw.length) {
    if (raw[i] === '\x1b') {
      const rest = raw.slice(i);
      const nextCh = raw[i + 1];
      if (nextCh === ']') {
        // OSC: consume to BEL or ST
        const bel = raw.indexOf('\x07', i + 2);
        const st = raw.indexOf('\x1b\\', i + 2);
        const end = bel === -1 ? st : (st === -1 ? bel : Math.min(bel, st));
        i = end === -1 ? raw.length : end + (end === st ? 2 : 1);
        continue;
      }
      const csi = CSI_RE.exec(rest);
      if (!csi) {
        i += 2; // two-char escape (charset select etc.)
        continue;
      }
      if (!csi[0].endsWith('m')) {
        i += csi[0].length; // non-SGR CSI (cursor/erase) — consume, ignore
        continue;
      }
      const end = i + csi[0].length - 1;
      const codes = raw.slice(i + 2, end).split(';').map(v => (v === '' ? 0 : Number(v)));
      flush();
      for (let c = 0; c < codes.length; c += 1) {
        const code = codes[c];
        if (code === 0) style = {};
        else if (code === 1) style.bold = true;
        else if (code === 2) style.dim = true;
        else if (code === 3) style.italic = true;
        else if (code === 4) style.underline = true;
        else if (code === 7) style.reverse = true;
        else if (code === 22) { delete style.bold; delete style.dim; }
        else if (code === 23) delete style.italic;
        else if (code === 24) delete style.underline;
        else if (code === 27) delete style.reverse;
        else if (code >= 30 && code <= 37) style.fg = THEME.ansi16[code - 30];
        else if (code >= 90 && code <= 97) style.fg = THEME.ansi16[code - 90 + 8];
        else if (code === 39) delete style.fg;
        else if (code >= 40 && code <= 47) style.bg = THEME.ansi16[code - 40];
        else if (code >= 100 && code <= 107) style.bg = THEME.ansi16[code - 100 + 8];
        else if (code === 49) delete style.bg;
        else if (code === 38 || code === 48) {
          const key = code === 38 ? 'fg' : 'bg';
          if (codes[c + 1] === 5) { style[key] = color256(codes[c + 2]); c += 2; }
          else if (codes[c + 1] === 2) { style[key] = `rgb(${codes[c + 2]},${codes[c + 3]},${codes[c + 4]})`; c += 4; }
        }
      }
      i = end + 1;
    } else {
      text += raw[i];
      i += 1;
    }
  }
  flush();
  // control chars must never reach SVG/HTML (XML rejects them — 'PCDATA invalid Char value 27')
  for (const span of spans) span.text = span.text.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
  // clip to cols AFTER parsing (never cut an escape sequence)
  let used = 0;
  const clipped = [];
  for (const span of spans) {
    if (used >= cols) break;
    const room = cols - used;
    const t = span.text.length > room ? span.text.slice(0, room) : span.text;
    clipped.push({ ...span, text: t });
    used += t.length;
  }
  return clipped;
}

const parsed = frames.map(frame => ({ t: frame.t, lines: frame.lines.map(parseAnsiLine) }));
console.log(`story-render: ${name} — ${frames.length} frames @ ${cols}x${rows}, speed x${speed}, true-color`);

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const spanCss = s => {
  const css = [];
  css.push(`color:${s.reverse ? (s.bg || THEME.defaultBg) : (s.fg || THEME.defaultFg)}`);
  const bg = s.reverse ? (s.fg || THEME.defaultFg) : s.bg;
  if (bg) css.push(`background:${bg}`);
  if (s.bold) css.push('font-weight:700');
  if (s.dim) css.push('opacity:.55');
  if (s.italic) css.push('font-style:italic');
  if (s.underline) css.push('text-decoration:underline');
  return css.join(';');
};

// replay.html — pre-rendered styled lines, real (speed-adjusted) timing
const htmlFrames = parsed.map(frame =>
  frame.lines.map(line => line.map(s => `<span style="${spanCss(s)}">${esc(s.text)}</span>`).join('')).join('\n'));
writeFileSync(join(storyDir, 'replay.html'), `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(name)} — skill story replay</title>
<style>body{background:${THEME.defaultBg};color:${THEME.defaultFg};font:12.5px/1.5 "JetBrains Mono",ui-monospace,monospace;display:grid;place-items:center;min-height:100vh;margin:0}
pre{background:#221a15;border:1px solid #4a382d;border-radius:12px;padding:20px 24px;width:${cols}ch;min-height:${rows + 2}em;white-space:pre}
.bar{position:fixed;bottom:0;left:0;height:3px;background:#d97b57;transition:width .2s}</style></head><body>
<pre id="t"></pre><div class="bar" id="b"></div>
<script>const F=${JSON.stringify(htmlFrames)};const T=${JSON.stringify(parsed.map(f => f.t))};const SP=${speed};
const t=document.getElementById('t');const b=document.getElementById('b');let i=0;
const tick=()=>{if(i>=F.length){setTimeout(()=>{i=0;tick();},4000);return;}
t.innerHTML=F[i];b.style.width=(100*i/F.length)+'%';
const wait=i+1<T.length?Math.min(Math.max((T[i+1]-T[i])/SP,100),${maxFrame * 1000}):3000;i+=1;setTimeout(tick,wait);};tick();</script></body></html>\n`);

// story.mp4 — svg with tspans → qlmanage png → ffmpeg concat
let video = 'skipped (needs qlmanage + ffmpeg, macOS)';
try {
  execFileSync('which', ['qlmanage'], { stdio: 'pipe' });
  execFileSync('which', ['ffmpeg'], { stdio: 'pipe' });
  const pngDir = join(storyDir, 'png');
  mkdirSync(pngDir, { recursive: true });
  const width = 1344;
  const height = 756;
  const lineH = Math.floor((height - 40) / rows);
  const charW = 11.4; // Menlo 13px advance approximation for bg rects
  const concat = [];
  parsed.forEach((frame, index) => {
    const rowsSvg = frame.lines.map((line, row) => {
      const y = 26 + row * lineH;
      let x = 18;
      const bgs = [];
      const tspans = line.map(s => {
        const w = s.text.length * charW;
        const bg = s.reverse ? (s.fg || THEME.defaultFg) : s.bg;
        if (bg) bgs.push(`<rect x="${x.toFixed(1)}" y="${y - lineH + 5}" width="${w.toFixed(1)}" height="${lineH}" fill="${bg}"/>`);
        const fill = s.reverse ? (s.bg || THEME.defaultBg) : (s.fg || THEME.defaultFg);
        const t = `<text x="${x.toFixed(1)}" y="${y}" fill="${fill}"${s.bold ? ' font-weight="700"' : ''}${s.dim ? ' opacity="0.55"' : ''}${s.italic ? ' font-style="italic"' : ''}${s.underline ? ' text-decoration="underline"' : ''} xml:space="preserve">${esc(s.text)}</text>`;
        x += w;
        return t;
      }).join('');
      return bgs.join('') + tspans;
    }).join('');
    const svg = join(pngDir, `f${String(index).padStart(4, '0')}.svg`);
    writeFileSync(svg, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Menlo, monospace" font-size="13"><rect width="${width}" height="${height}" fill="${THEME.defaultBg}"/>${rowsSvg}</svg>`);
    execFileSync('qlmanage', ['-t', '-s', String(width), '-o', pngDir, svg], { stdio: 'pipe' });
    const next = parsed[index + 1];
    const dur = next ? Math.min(Math.max((next.t - frame.t) / 1000 / speed, 0.12), maxFrame) : 3;
    concat.push(`file '${svg}.png'`, `duration ${dur.toFixed(2)}`);
  });
  concat.push(concat.at(-2));
  writeFileSync(join(pngDir, 'concat.txt'), `${concat.join('\n')}\n`);
  execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', join(pngDir, 'concat.txt'),
    '-vf', `scale=${width}:${height},format=yuv420p`, '-r', '30', join(storyDir, 'story.mp4')], { stdio: 'pipe' });
  video = join(storyDir, 'story.mp4');
} catch (err) {
  video = `skipped (${String(err.message).split('\n')[0]})`;
}

console.log(`  replay : ${join(storyDir, 'replay.html')}`);
console.log(`  video  : ${video}`);
