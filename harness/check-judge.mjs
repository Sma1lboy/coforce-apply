// Two properties of the machine judge that only fail on someone else's
// machine, which is why they get a check of their own:
//
//   1. a cached verdict must not outlive the artifacts it judged, even when the
//      filesystem gives those artifacts the same timestamp as the verdict;
//   2. a macro call written inside a LaTeX comment is not a macro call.
//
// Both were found the hard way. (1) made `npm run harness` fail on a tmpfs
// where two consecutive writes share an mtime, and would let a resume ship
// against gates computed for a different file. (2) made a template that
// documented its own contract in a comment fail the bullet-shape gate with
// nothing to point at.

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  approveJob,
  campaignView,
  judgeResume,
  stageArtifacts,
  syncJobs,
} from '../.agents/skills/campaign/scripts/campaign-lib.mjs';
import { onePagePdf } from './pdf-fixture.mjs';

const REAL_BULLET = 'Rebuilt the ingestion pipeline and cut write latency under replay load';
const FABRICATED = 'A line nobody ever reviewed';

const texFor = bullet => [
  '\\documentclass{article}',
  '\\newcommand{\\resumeItem}[2]{#2}',
  '\\begin{document}',
  `\\resumeItem{}{${bullet}}`,
  '\\end{document}',
  '',
].join('\n');

// stageArtifacts copies from paths, so the fixtures land in a staging dir first.
const seed = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'coforce-judge-'));
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ version: 2 }));
  const job = syncJobs(dataDir, [{
    id: 'judge-1', company: 'Example Labs', role: 'Engineer', url: 'https://jobs.example/judge-1',
  }]).added[0];
  const dir = join(dataDir, 'campaigns', 'current', 'jobs',
    campaignView(dataDir).jobs[0].folder);
  const staging = mkdtempSync(join(tmpdir(), 'coforce-judge-in-'));
  const stage = bullet => {
    const tex = join(staging, 'resume.tex');
    const pdf = join(staging, 'resume.pdf');
    writeFileSync(tex, texFor(bullet));
    writeFileSync(pdf, onePagePdf(bullet, true, 8));
    stageArtifacts(dataDir, job.id, { tex, pdf });
    // the selected-evidence side is written into the job folder directly, the
    // way the campaign checks do it
    writeFileSync(join(dir, 'match.json'), JSON.stringify({ bullets: [{ text: bullet }] }));
  };
  return { dataDir, job, dir, stage };
};

// ---- 1. a verdict is about the artifacts it judged ---------------------------
// Approval is the path that consults the cache (judgeResume itself always
// recomputes), and approval is also where a stale verdict does damage: it is
// the gate between a rendered resume and one that gets sent.
{
  const { dataDir, job, dir, stage } = seed();
  stage(REAL_BULLET);
  writeFileSync(join(dir, 'job-description.md'), '# Engineer\n\nfixture posting\n');
  writeFileSync(join(dir, 'match-report.md'), '# Match\n\nfixture report\n');
  const first = judgeResume(dataDir, job.id);
  assert.equal(first.verbatim, true, 'the honest resume passes verbatim');
  assert.ok(first.inputsFingerprint, 'a verdict records what it judged');

  // Swap in a resume the verdict has never seen, and pin every file — verdict
  // included — to the SAME mtime. That is what a coarse-timestamp filesystem
  // does on its own; forcing it here makes the check mean the same thing
  // everywhere, instead of passing on whichever machine happens to be slower.
  writeFileSync(join(dir, 'resume.tex'), texFor(FABRICATED));
  const when = statSync(join(dir, 'judge.json')).mtime;
  for (const name of ['judge.json', 'resume.tex', 'match.json', 'resume.pdf']) {
    utimesSync(join(dir, name), when, when);
  }
  assert.equal(
    statSync(join(dir, 'judge.json')).mtimeMs,
    statSync(join(dir, 'resume.tex')).mtimeMs,
    'the timestamp tie this check is about is actually set up',
  );

  // approveJob is a cache consumer: it asks currentResumeJudge for the verdict
  // before it checks any gate. Whether the approval then succeeds depends on
  // gates this fixture does not try to satisfy — what matters here is only
  // whether the verdict got recomputed for the file that is actually on disk.
  const cachedBefore = JSON.parse(readFileSync(join(dir, 'judge.json'), 'utf8'));
  try {
    approveJob(dataDir, job.id);
  } catch {
    // gate outcome is not this check's business
  }
  const cachedAfter = JSON.parse(readFileSync(join(dir, 'judge.json'), 'utf8'));
  assert.notEqual(cachedAfter.inputsFingerprint, cachedBefore.inputsFingerprint,
    'a swapped resume must be re-judged even when its timestamp ties the verdict');
  assert.equal(cachedAfter.verbatim, false,
    'and the refreshed verdict must reflect the file that is actually on disk');
}

// ---- 2. a commented-out macro call is not a macro call -----------------------
{
  const { dataDir, job, dir, stage } = seed();
  stage(REAL_BULLET);
  const clean = judgeResume(dataDir, job.id);
  assert.equal(clean.resumeItemsUseBodyArgument, true, 'baseline: real bullets use the body argument');
  assert.equal(clean.verbatim, true);

  const documented = readFileSync(join(dir, 'resume.tex'), 'utf8').replace(
    '\\begin{document}',
    '\\begin{document}\n% bullets look like \\resumeItem{Bold label}{body text}\n'
      + '% and an escaped 50\\% sign must not start a comment',
  );
  writeFileSync(join(dir, 'resume.tex'), documented);
  const judged = judgeResume(dataDir, job.id);
  assert.equal(judged.resumeItemsUseBodyArgument, true,
    'a macro call inside a comment must not count as a labelled bullet');
  assert.equal(judged.verbatim, true,
    'a commented-out bullet must not count as unreviewed resume content');
  assert.deepEqual(judged.unknownLines, [], 'comments contribute no resume lines');
}

console.log('judge: verdict freshness by content + comments are not source ✓');
