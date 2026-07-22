#!/usr/bin/env node
// Dev sandbox: a seeded, throwaway ~/.coforce equivalent + the real console
// server on top of it. One command, no real user data touched:
//
//   npm run sandbox            # seed + serve on http://127.0.0.1:4519
//   node harness/sandbox.mjs --seed-only <dir>   # just build a sandbox dir
//
// The recording harness (record-setup.mjs) reuses seedSandbox().
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function seedSandbox(root) {
  const home = resolve(root);
  mkdirSync(home, { recursive: true });
  copyFileSync(join(here, 'fixtures/profile.json'), join(home, 'profile.json'));
  copyFileSync(join(here, 'fixtures/instructions.md'), join(home, 'instructions.md'));
  writeFileSync(join(home, 'applications.json'), '[]\n');
  writeFileSync(join(home, 'preferences.json'), `${JSON.stringify({
    version: 1,
    level: 'internship',
    directions: ['backend', 'fullstack', 'general'],
    needsSponsorship: true,
    workAuthorization: 'F-1 OPT',
    workMode: 'any',
    locations: ['US Remote', 'Bay Area'],
    salaryFloor: null,
  }, null, 2)}\n`);
  writeFileSync(join(home, 'apply-config.json'), `${JSON.stringify({
    agent: 'claude',
    email: 'sandbox@example.com',
    autoRegister: false,
    mailboxAccess: 'paste',
    resumePdf: join(home, 'resume.pdf'),
    headlessApply: false,
  }, null, 2)}\n`);
  return home;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const seedOnly = process.argv.includes('--seed-only');
  const root = process.argv.find(a => !a.includes('sandbox.mjs') && !a.startsWith('--') && !a.includes('node'))
    || join(here, 'out', 'sandbox', 'coforce');
  const home = seedSandbox(root);
  console.log(`sandbox seeded: ${home}`);
  if (seedOnly) process.exit(0);
  const board = join(here, '../.agents/skills/tracker/scripts/board.mjs');
  const child = spawn(process.execPath, [board, join(home, 'applications.json'), '--serve', '4519'], {
    stdio: 'inherit',
    env: { ...process.env, COFORCE_SOURCE_FILE: join(here, 'fixtures/source-jobs.md') },
  });
  child.on('exit', code => process.exit(code ?? 0));
}
