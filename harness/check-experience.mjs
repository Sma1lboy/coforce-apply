// Tier 0 experience index: cached GitHub evidence + profile tags, no network.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  buildExperienceIndex,
  experiencePaths,
  experienceView,
} from '../.agents/skills/experience/scripts/experience-lib.mjs';
import {
  parseGitHubUrl,
  resolveSourceUrl,
} from '../.agents/skills/experience/scripts/source-resolver.mjs';

assert.deepEqual(parseGitHubUrl('https://github.com/owner/repo'), {
  repo: 'owner/repo', kind: 'repository',
});
assert.deepEqual(parseGitHubUrl('https://github.com/owner/repo/pull/42/files'), {
  repo: 'owner/repo', kind: 'pull_request', id: '42',
});
assert.deepEqual(parseGitHubUrl('https://github.com/owner/repo/commit/abc123?diff=split'), {
  repo: 'owner/repo', kind: 'commit', id: 'abc123',
});
assert.deepEqual(parseGitHubUrl('git@github.com:owner/repo.git'), {
  repo: 'owner/repo', kind: 'repository',
});
assert.throws(() => parseGitHubUrl('https://gitlab.com/owner/repo'), /Only github\.com/);
assert.throws(() => parseGitHubUrl('https://github.com/owner/repo/issues/1'), /Unsupported GitHub source/);

const apiCalls = [];
const apiPayloads = {
  user: { login: 'candidate' },
  'repos/owner/pr-repo/pulls/42': { user: { login: 'pr-author' } },
  'repos/owner/commit-repo/commits/abc123': { author: { login: 'commit-author' } },
  'repos/owner/unlinked/commits/deadbeef': { author: null },
};
const fakeGhRunner = (_binary, args) => {
  apiCalls.push(args[1]);
  return JSON.stringify(apiPayloads[args[1]]);
};
assert.deepEqual(resolveSourceUrl('https://github.com/owner/repo', { runner: fakeGhRunner }), {
  repo: 'owner/repo', kind: 'repository', authors: ['candidate'], detectedFrom: 'authenticated_user',
});
assert.deepEqual(resolveSourceUrl('https://github.com/owner/pr-repo/pull/42', { runner: fakeGhRunner }), {
  repo: 'owner/pr-repo', kind: 'pull_request', id: '42', authors: ['pr-author'], detectedFrom: 'pull_request',
});
assert.deepEqual(resolveSourceUrl('https://github.com/owner/commit-repo/commit/abc123', { runner: fakeGhRunner }), {
  repo: 'owner/commit-repo', kind: 'commit', id: 'abc123', authors: ['commit-author'], detectedFrom: 'commit',
});
assert.deepEqual(resolveSourceUrl('https://github.com/owner/unlinked/commit/deadbeef', { runner: fakeGhRunner }), {
  repo: 'owner/unlinked', kind: 'commit', id: 'deadbeef', authors: ['candidate'], detectedFrom: 'authenticated_user',
});
const callsBeforeOverride = apiCalls.length;
assert.deepEqual(resolveSourceUrl('owner/repo', { authors: ['alternate', 'candidate'], runner: fakeGhRunner }), {
  repo: 'owner/repo', kind: 'repository', authors: ['alternate', 'candidate'], detectedFrom: 'explicit',
});
assert.equal(apiCalls.length, callsBeforeOverride, 'an explicit author override must not call GitHub');

const dataDir = mkdtempSync(join(tmpdir(), 'coforce-experience-'));
const paths = experiencePaths(dataDir);
const experienceCli = resolve('.agents/skills/experience/scripts/experience.mjs');
const missingDataDir = mkdtempSync(join(tmpdir(), 'coforce-experience-missing-'));
let missingError = '';
try {
  execFileSync(process.execPath, [experienceCli, 'refresh', '--data-dir', missingDataDir], { stdio: 'pipe' });
} catch (error) {
  missingError = String(error.stderr || error.message || error);
}
assert.match(missingError, /source manifest is missing/i, 'refresh must not auto-discover repositories');
mkdirSync(dirname(paths.library), { recursive: true });
const sourceGh = join(dataDir, 'source-gh');
writeFileSync(sourceGh, '#!/bin/sh\n[ "$1" = api ] && [ "$2" = user ] && printf \'%s\' \'{"login":"candidate"}\' && exit 0\nexit 92\n');
chmodSync(sourceGh, 0o755);
execFileSync(process.execPath, [
  experienceCli, 'source', 'add', '--data-dir', dataDir,
  'https://github.com/owner/repo', '--gh-binary', sourceGh,
  '--project', 'Agent Runtime', '--tag', 'agent',
], { stdio: 'pipe' });

writeFileSync(join(dataDir, 'profile.json'), JSON.stringify({
  name: 'Candidate',
  skills: ['TypeScript', 'PostgreSQL'],
  experience: [{
    company: 'Acme',
    title: 'Backend Engineer',
    date: '2024',
    description: ['Built reliable TypeScript APIs backed by PostgreSQL.'],
  }],
  projects: [{
    name: 'Agent Runtime',
    technologies: 'TypeScript, Node.js',
    description: ['Implemented agent retries and observability.'],
  }],
}, null, 2));
writeFileSync(paths.library, JSON.stringify({
  github_logins: ['candidate'],
  sources: [{ repo: 'owner/repo', authors: ['candidate'], project: 'Agent Runtime', tags: ['agent'] }],
  entries: [{
    id: 'runtime:pr:owner/repo:42',
    project_id: 'runtime',
    project_name: 'Agent Runtime',
    repository: 'owner/repo',
    author: 'candidate',
    artifact: 'pull_request',
    title: 'Add TypeScript retry policy',
    body: 'Improved agent workflow reliability.',
    status: 'merged',
    tags: ['tech:typescript', 'work:agent-ai'],
    files: ['src/retry.ts'],
    sources: [{ type: 'pull_request', url: 'https://github.com/owner/repo/pull/42' }],
  }],
}, null, 2));

const libraryBefore = statSync(paths.library);
const index = buildExperienceIndex(dataDir);
assert.equal(index.tier, 0);
assert.deepEqual(index.authors, ['candidate']);
assert.equal(index.counts.entries, 4);
assert.deepEqual(Object.keys(index.counts).sort(), ['entries', 'repositories', 'tags']);
assert.equal(index.entries.filter(item => item.id.startsWith('profile:')).length, 3);
assert.ok(index.entries.some(item => item.tags.includes('skill:typescript')));
assert.ok(index.entries.some(item => item.id === 'runtime:pr:owner/repo:42'));
const githubEntry = index.entries.find(item => item.id === 'runtime:pr:owner/repo:42');
assert.deepEqual(Object.keys(githubEntry).sort(), [
  'artifact', 'author', 'authored_at', 'body', 'files', 'id', 'project_id',
  'project_name', 'repository', 'source_url', 'status', 'tags', 'title',
]);
assert.equal(githubEntry.author, 'candidate');
assert.equal('stats' in githubEntry, false);
assert.deepEqual(Object.keys(index).sort(), [
  'authors', 'counts', 'entries', 'generatedAt', 'schemaVersion', 'sourceFingerprint', 'tier',
]);
assert.equal(experienceView(dataDir).status, 'ready');

const profile = JSON.parse(readFileSync(join(dataDir, 'profile.json'), 'utf8'));
profile.skills.push('React');
writeFileSync(join(dataDir, 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`);
assert.equal(experienceView(dataDir).status, 'profile_changed');
const stubBin = join(dataDir, 'stub-bin');
const ghLog = join(dataDir, 'gh-called.log');
mkdirSync(stubBin, { recursive: true });
writeFileSync(join(stubBin, 'gh'), '#!/bin/sh\nprintf called >> "$COFORCE_GH_LOG"\nexit 91\n');
chmodSync(join(stubBin, 'gh'), 0o755);
const cliEnv = { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, COFORCE_GH_LOG: ghLog };
execFileSync(process.execPath, [experienceCli, 'build', '--data-dir', dataDir], { env: cliEnv, stdio: 'pipe' });
execFileSync(process.execPath, [experienceCli, 'status', '--data-dir', dataDir], { env: cliEnv, stdio: 'pipe' });
const rebuilt = JSON.parse(readFileSync(paths.index, 'utf8'));
assert.ok(rebuilt.entries.some(item => item.tags.includes('skill:react')));
assert.equal(experienceView(dataDir).status, 'ready');
assert.equal(existsSync(ghLog), false, 'Tier 0 build/status must never invoke gh');
const libraryAfter = statSync(paths.library);
assert.equal(libraryAfter.mtimeMs, libraryBefore.mtimeMs, 'offline build must not rewrite GitHub evidence');

writeFileSync(paths.library, `${readFileSync(paths.library, 'utf8')}\n`);
assert.equal(experienceView(dataDir).status, 'evidence_changed');
execFileSync(process.execPath, [experienceCli, 'build', '--data-dir', dataDir], { env: cliEnv, stdio: 'pipe' });
assert.equal(experienceView(dataDir).status, 'ready');
assert.equal(existsSync(ghLog), false, 're-indexing changed cached sources must not invoke gh');

execFileSync(process.execPath, [
  experienceCli, 'source', 'add', '--data-dir', dataDir,
  '--repo', 'owner/spare', '--author', 'candidate',
], { env: cliEnv, stdio: 'pipe' });
const listed = JSON.parse(execFileSync(process.execPath, [experienceCli, 'source', 'list', '--data-dir', dataDir], { env: cliEnv, encoding: 'utf8' }));
assert.equal(listed.repositories.length, 2);
execFileSync(process.execPath, [experienceCli, 'source', 'remove', '--data-dir', dataDir, '--repo', 'owner/spare'], { env: cliEnv, stdio: 'pipe' });
execFileSync(process.execPath, [
  experienceCli, 'source', 'add', '--data-dir', dataDir,
  '--repo', 'owner/repo', '--author', 'candidate', '--author', 'candidate-alt',
  '--project', 'Agent Runtime', '--tag', 'agent',
], { env: cliEnv, stdio: 'pipe' });
assert.equal(experienceView(dataDir).status, 'sources_changed');
assert.throws(() => buildExperienceIndex(dataDir), /does not match sources\.json/);

console.log('experience: Tier 0 tags + provenance + offline rebuild ✓');
