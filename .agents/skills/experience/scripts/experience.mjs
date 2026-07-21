#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildExperienceIndex,
  experiencePaths,
  experienceView,
  loadSourceManifest,
  removeSource,
  upsertSource,
} from './experience-lib.mjs';
import { parseGitHubUrl, resolveSourceUrl } from './source-resolver.mjs';

const argv = process.argv.slice(2);
const command = argv.shift();
const option = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
};
const options = name => argv.flatMap((value, index) => value === name && argv[index + 1] ? [argv[index + 1]] : []);
const positionalArgs = () => {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) {
      index += 1;
    } else {
      values.push(argv[index]);
    }
  }
  return values;
};
const dataDir = resolve(option('--data-dir', join(homedir(), '.coforce')));
const paths = experiencePaths(dataDir);
const scripts = resolve(dirname(fileURLToPath(import.meta.url)), '../../shushu-internship-tool/scripts');
const python = option('--python', process.env.COFORCE_PYTHON || 'python3');

const runPython = (script, args) => {
  execFileSync(python, [join(scripts, script), ...args], {
    cwd: dataDir,
    stdio: 'inherit',
    timeout: 30 * 60 * 1000,
    maxBuffer: 50 * 1024 * 1024,
  });
};

function refresh() {
  mkdirSync(paths.root, { recursive: true });
  const sources = paths.sources;
  if (!existsSync(sources)) throw new Error(`Tier 0 source manifest is missing: ${sources}. Add one with $experience source add.`);
  const evidenceArgs = ['sync', '--config', sources, '--out', paths.evidence];
  const ghBinary = option('--gh-binary');
  if (ghBinary) evidenceArgs.push('--gh-binary', ghBinary);
  runPython('github_evidence.py', evidenceArgs);
  return buildExperienceIndex(dataDir);
}

try {
  if (command === 'refresh') {
    const index = refresh();
    console.log(JSON.stringify({ refreshed: true, ...experienceView(dataDir), counts: index.counts }, null, 2));
  } else if (command === 'build') {
    const index = buildExperienceIndex(dataDir);
    console.log(JSON.stringify({ rebuilt: true, ...experienceView(dataDir), counts: index.counts }, null, 2));
  } else if (command === 'status') {
    console.log(JSON.stringify(experienceView(dataDir), null, 2));
  } else if (command === 'source') {
    const action = argv.shift();
    if (action === 'add') {
      const sourceUrl = option('--url') || option('--repo') || positionalArgs()[0];
      const authors = options('--author');
      if (!sourceUrl) throw new Error('source add requires a GitHub repository, pull-request, or commit URL');
      const resolvedSource = resolveSourceUrl(sourceUrl, {
        authors,
        ghBinary: option('--gh-binary', 'gh'),
      });
      const manifest = upsertSource(dataDir, {
        repo: resolvedSource.repo,
        authors: resolvedSource.authors,
        project: option('--project') || undefined,
        tags: options('--tag'),
      });
      console.log(JSON.stringify(manifest, null, 2));
    } else if (action === 'remove') {
      const sourceUrl = option('--url') || option('--repo') || positionalArgs()[0];
      if (!sourceUrl) throw new Error('source remove requires a GitHub URL or owner/repository');
      const repo = parseGitHubUrl(sourceUrl).repo;
      console.log(JSON.stringify(removeSource(dataDir, repo), null, 2));
    } else if (action === 'list') {
      console.log(JSON.stringify(loadSourceManifest(dataDir), null, 2));
    } else {
      throw new Error('usage: experience.mjs source add <github-url> [--author LOGIN] | source remove <github-url> | source list');
    }
  } else {
    throw new Error('usage: experience.mjs refresh|build|status|source [options]');
  }
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
