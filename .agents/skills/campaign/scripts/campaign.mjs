#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  addFeedback,
  approveJob,
  applyResumeReviewPolicy,
  campaignView,
  exportCampaign,
  bulletPool,
  hydrateJob,
  judgeResume,
  renderResume,
  selectBullets,
  stageArtifacts,
  syncJobs,
} from './campaign-lib.mjs';

const argv = process.argv.slice(2);
const command = argv.shift();
const option = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
};
const dataDir = resolve(option('--data-dir', join(homedir(), '.coforce')));
const need = (name, value = option(name)) => {
  if (!value) throw new Error(`${name} is required`);
  return value;
};

async function main() {
  if (command === 'sync') {
    const appsPath = resolve(option('--apps', join(dataDir, 'applications.json')));
    const apps = existsSync(appsPath) ? JSON.parse(readFileSync(appsPath, 'utf8')) : [];
    const pending = apps.filter(app => app.status === 'pending').map(app => ({
      ...app,
      role: app.position || app.role,
    }));
    const result = syncJobs(dataDir, pending);
    console.log(JSON.stringify({ added: result.added.length, jobs: result.manifest.jobs.length }, null, 2));
    return;
  }
  if (command === 'hydrate') {
    const id = need('--id');
    const file = option('--file');
    const text = option('--text');
    console.log(JSON.stringify(await hydrateJob(dataDir, id, { file, text }), null, 2));
    return;
  }
  if (command === 'pool') {
    console.log(JSON.stringify(bulletPool(dataDir), null, 2));
    return;
  }
  if (command === 'select') {
    console.log(JSON.stringify(selectBullets(dataDir, need('--id'), need('--bullets').split(',')), null, 2));
    return;
  }
  if (command === 'stage') {
    console.log(JSON.stringify(stageArtifacts(dataDir, need('--id'), {
      jd: option('--jd'), tex: option('--tex'), pdf: option('--pdf'), match: option('--match-report'),
    }), null, 2));
    return;
  }
  if (command === 'judge') {
    console.log(JSON.stringify(judgeResume(dataDir, need('--id')), null, 2));
    return;
  }
  if (command === 'render') {
    console.log(JSON.stringify(renderResume(dataDir, need('--id'), option('--tex')), null, 2));
    return;
  }
  if (command === 'feedback') {
    console.log(JSON.stringify(addFeedback(dataDir, need('--id'), need('--text')), null, 2));
    return;
  }
  if (command === 'approve') {
    console.log(JSON.stringify(approveJob(dataDir, need('--id')), null, 2));
    return;
  }
  if (command === 'export') {
    console.log(JSON.stringify(exportCampaign(dataDir, option('--out') ? resolve(option('--out')) : null), null, 2));
    return;
  }
  if (command === 'reconcile') {
    console.log(JSON.stringify(applyResumeReviewPolicy(dataDir), null, 2));
    return;
  }
  if (command === 'show') {
    console.log(JSON.stringify(campaignView(dataDir), null, 2));
    return;
  }
  throw new Error('usage: campaign.mjs sync|hydrate|pool|select|stage|render|judge|feedback|approve|reconcile|export|show [options]');
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
