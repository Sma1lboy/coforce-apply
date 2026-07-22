#!/usr/bin/env node
// Skill story renderer — the re-render side of the story system. A story's
// frames.json is the source of truth; this turns it into human-facing
// artifacts as many times as you like (二次渲染), no session re-run needed:
//
//   node harness/story-render.mjs <story-name> [--speed 1.5] [--max-frame-s 2]
//
// Outputs into harness/stories/<story-name>/:
//   replay.html — self-contained animated replay (shareable anywhere)
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

const storyDir = join(here, 'stories', name);
const { cols, rows, frames } = JSON.parse(readFileSync(join(storyDir, 'frames.json'), 'utf8'));
console.log(`story-render: ${name} — ${frames.length} frames @ ${cols}x${rows}, speed x${speed}`);

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const color = line => {
  if (line.startsWith('⏺')) return '#8fb573';
  if (line.startsWith('❯') || line.startsWith('│ ❯')) return '#d9b06b';
  if (line.includes('━━')) return '#d97b57';
  return '#f2e7dd';
};

// replay.html — plays the capture with real (speed-adjusted) timing
writeFileSync(join(storyDir, 'replay.html'), `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(name)} — skill story replay</title>
<style>body{background:#181310;color:#f2e7dd;font:12.5px/1.5 "JetBrains Mono",ui-monospace,monospace;display:grid;place-items:center;min-height:100vh;margin:0}
pre{background:#221a15;border:1px solid #4a382d;border-radius:12px;padding:20px 24px;width:${cols}ch;min-height:${rows + 2}em;white-space:pre-wrap}
.a{color:#8fb573}.u{color:#d9b06b}.h{color:#d97b57}</style></head><body><pre id="t"></pre>
<script>const F=${JSON.stringify(frames)};const SP=${speed};const t=document.getElementById('t');let i=0;
const cls=l=>l.startsWith('⏺')?'a':(l.startsWith('❯')||l.startsWith('│ ❯'))?'u':l.includes('━━')?'h':'';
const tick=()=>{if(i>=F.length){setTimeout(()=>{i=0;tick();},4000);return;}
t.innerHTML=F[i].lines.map(l=>{const c=cls(l);const s=l.replace(/&/g,'&amp;').replace(/</g,'&lt;');return c?'<span class="'+c+'">'+s+'</span>':s;}).join('\\n');
const next=F[i+1];const wait=next?Math.min(Math.max((next.t-F[i].t)/SP,100),${maxFrame * 1000}):3000;i+=1;setTimeout(tick,wait);};tick();</script></body></html>\n`);

// story.mp4 — svg frames → qlmanage png → ffmpeg concat
let video = 'skipped (needs qlmanage + ffmpeg, macOS)';
try {
  execFileSync('which', ['qlmanage'], { stdio: 'pipe' });
  execFileSync('which', ['ffmpeg'], { stdio: 'pipe' });
  const pngDir = join(storyDir, 'png');
  mkdirSync(pngDir, { recursive: true });
  const width = 1344;
  const height = 756;
  const concat = [];
  frames.forEach((frame, index) => {
    const texts = frame.lines.map((line, row) =>
      `<text x="18" y="${26 + row * Math.floor((height - 40) / rows)}" fill="${color(line)}">${esc(line.slice(0, Math.floor(width / 12)))}</text>`).join('');
    const svg = join(pngDir, `f${String(index).padStart(4, '0')}.svg`);
    writeFileSync(svg, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Menlo, monospace" font-size="13"><rect width="${width}" height="${height}" fill="#181310"/>${texts}</svg>`);
    execFileSync('qlmanage', ['-t', '-s', String(width), '-o', pngDir, svg], { stdio: 'pipe' });
    const next = frames[index + 1];
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
