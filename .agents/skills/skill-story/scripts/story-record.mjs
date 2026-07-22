#!/usr/bin/env node
// Skill story recorder — capture side of the story system. Starts a REAL
// interactive agent session in tmux running one skill, and snapshots the
// terminal into a consolidated, re-renderable frames.json (kobe capture
// format). The DRIVER (a human, or an agent puppeting `tmux send-keys`)
// answers the AskUserQuestion popups; this process only records.
//
//   node harness/story-record.mjs <story-name> --kickoff <prompt-file>
//     [--cols 110] [--rows 32] [--bin claude]
//
// Output: harness/stories/<story-name>/frames.json (+ sandbox dir the
// kickoff should point the skill at). Render with story-render.mjs —
// capture once, render many.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const name = args.find(a => !a.startsWith('--'));
if (!name) {
  console.error('usage: story-record.mjs <story-name> --kickoff <prompt-file> [--cols N] [--rows N] [--bin claude]');
  process.exit(1);
}
const opt = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};
const cols = Number(opt('--cols', 110));
const rows = Number(opt('--rows', 32));
const bin = opt('--bin', 'claude');
const kickoffFile = opt('--kickoff', null);
if (!kickoffFile) {
  console.error('--kickoff <prompt-file> is required (the instruction that starts the skill, incl. sandbox override)');
  process.exit(1);
}

const storyDir = join(here, '../../../../harness/stories', name);
mkdirSync(join(storyDir, 'sandbox'), { recursive: true });
const session = `coforce-story-${name}`;
const tmux = (...a) => spawnSync('tmux', a, { encoding: 'utf8' });

tmux('kill-session', '-t', session);
const started = tmux('new-session', '-d', '-s', session, '-x', String(cols), '-y', String(rows), '-c', resolve(here, '../../../..'));
if (started.status !== 0) {
  console.error('tmux failed:', started.stderr);
  process.exit(1);
}
tmux('send-keys', '-t', session, `${bin} --dangerously-skip-permissions "$(cat ${resolve(kickoffFile)})"`, 'Enter');
console.log(`story-record: session '${session}' started (${cols}x${rows}).`);
console.log(`  drive it:   tmux attach -t ${session}   (or agent-driven send-keys)`);
console.log(`  recording until the session ends…`);

const start = Date.now();
const frames = [];
let last = null;
for (;;) {
  const cap = tmux('capture-pane', '-e', '-pt', session); // -e keeps ANSI colors (kobe-style rawAnsi lines)
  if (cap.status !== 0) break; // session ended
  const lines = cap.stdout.replace(/\n+$/, '').split('\n').slice(-rows);
  const key = JSON.stringify(lines);
  if (key !== last) {
    frames.push({ t: Date.now() - start, lines });
    last = key;
  }
  spawnSync('sleep', ['0.4']);
}

const capture = { cols, rows, frames, meta: { story: name, bin, recordedAt: new Date().toISOString() } };
writeFileSync(join(storyDir, 'frames.json'), `${JSON.stringify(capture)}\n`);
console.log(`story-record: ${frames.length} frames → ${join(storyDir, 'frames.json')}`);
console.log(`  render:     node .agents/skills/skill-story/scripts/story-render.mjs ${name}`);
