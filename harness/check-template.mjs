// The SHIPPED template against the campaign contract.
//
// This check exists because of the hole it closes: every other campaign check
// points `latexTemplate` at harness/fixtures/resume-template.tex, so the
// template `/setup` actually installs for users — tailor/assets/resume_template.tex
// — was never once run through assemble + normalize. It had drifted into a
// different dialect (a one-argument \resumeItem, no \resumeHeadingSkillStart)
// and every campaign render against it failed to compile, with nothing in the
// suite to notice.
//
// Nothing here needs a LaTeX engine: the contract is string work. If one IS on
// PATH the check also compiles the result, because "it normalizes" and "it
// builds" are different claims.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  assembleResume,
  bulletPool,
  hydrateJob,
  renderResume,
  selectBullets,
  skillPool,
  syncJobs,
  syncTemplateContractToResume,
} from '../.agents/skills/campaign/scripts/campaign-lib.mjs';

const TEMPLATE = resolve('.agents/skills/tailor/assets/resume_template.tex');
const template = readFileSync(TEMPLATE, 'utf8');

// ---- 1. every macro the assembler emits exists, with the arity it uses ------
// Arity matters as much as existence: a one-argument \resumeItem accepts
// \resumeItem{}{text} as "empty bullet, then a stray group", and TeX only
// complains much later, if at all.
const REQUIRED_MACROS = {
  resumeItem: 2,
  resumeSubItem: 2,
  resumeSubheading: 4,
  resumeSubHeadingListStart: 0,
  resumeSubHeadingListEnd: 0,
  resumeItemListStart: 0,
  resumeItemListEnd: 0,
  resumeHeadingSkillStart: 0,
  resumeHeadingSkillEnd: 0,
  resumeSectionTransition: 0,
};
const declared = Object.fromEntries([...template.matchAll(
  /\\newcommand\{\\([A-Za-z]+)\}(?:\[(\d+)\])?/g,
)].map(match => [match[1], Number(match[2] || 0)]));
for (const [name, arity] of Object.entries(REQUIRED_MACROS)) {
  assert.equal(declared[name], arity,
    `shipped template must define \\${name} with ${arity} argument(s), got ${declared[name] ?? 'nothing'}`);
}

// ---- 2. the body declares the spacing the assembler reads back out ----------
const body = template.slice(template.indexOf('\\begin{document}'));
for (const label of ['Education', 'Skills', 'Working Experience', 'Projects']) {
  assert.match(body, new RegExp(`\\\\section\\s*\\{\\s*\\\\textbf\\s*\\{\\s*${label}\\s*\\}\\s*\\}`),
    `shipped template must carry a ${label} section for the assembler to align to`);
}
assert.match(body, /\\resumeSubHeadingListEnd\s*\\vspace\{[^}]+\}\s*\\resumeSubHeadingListStart/,
  'Projects must show the entry-to-entry spacer, or the assembler falls back to a value tuned for another template');

// ---- 3. a real selection assembles and normalizes against it ----------------
const dataDir = mkdtempSync(join(tmpdir(), 'coforce-shipped-template-'));
writeFileSync(join(dataDir, 'profile.json'), JSON.stringify({
  name: 'Casey Rivera',
  email: 'casey@example.com',
  phone: '(555) 010-0100',
  linkedin: 'casey-rivera',
  github: 'caseyrivera',
  skills: ['Go', 'TypeScript', 'PostgreSQL'],
  resumeSkillPolicy: {
    status: 'approved',
    reviewedAt: '2026-08-01T00:00:00.000Z',
    baseline: ['Go'],
    rolePacks: { backend: ['PostgreSQL'] },
  },
  education: [{
    institution: 'Example University',
    degree: 'B.S. Computer Science',
    date: '2022 - 2026',
    location: 'Example City',
  }],
  experience: [{
    company: 'Example Corp',
    title: 'Backend Engineer',
    date: '2024 - Present',
    location: 'Remote',
    // 62% and $18k are the point: LaTeX-special characters in a reviewed
    // bullet must survive to the page, not comment out their own closing brace.
    description: [
      { text: 'Cut p99 write latency by 62% and warehouse spend by $18k per month.' },
      { text: 'Split a monolith into services behind a schema registry.' },
    ],
  }],
  projects: [{
    name: 'example-tool',
    technologies: 'Go, PostgreSQL',
    dateRange: '2025',
    description: [{ text: 'Built a change-data-capture engine used by three teams.' }],
  }],
}, null, 2));
writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
  version: 2, latexTemplate: TEMPLATE, resumePageCoverageMinimumPercent: 0,
}, null, 2));

const job = syncJobs(dataDir, [{
  id: 'shipped-1', company: 'Example Labs', role: 'Backend Engineer', url: 'https://jobs.example/shipped-1',
}]).added[0];
await hydrateJob(dataDir, job.id, {
  text: 'Backend engineer. Go, PostgreSQL, schema design, latency work. '.repeat(8),
  source: 'fixture',
});
const pool = bulletPool(dataDir);
const skills = skillPool(dataDir);
selectBullets(dataDir, job.id, pool.map(bullet => bullet.id),
  skills.filter(skill => skill.baseline || skill.rolePacks.includes('backend')).map(skill => skill.id),
  'backend');

const assembled = assembleResume(dataDir, job.id);
const tex = readFileSync(assembled.path, 'utf8');
assert.match(tex, /\\resumeItem\{\}\{/, 'bullets use the two-argument body form');
assert.match(tex, /62\\%/, 'a percent sign in a reviewed bullet reaches LaTeX escaped');
assert.match(tex, /\\\$18k/, 'a dollar sign in a reviewed bullet reaches LaTeX escaped');

// This is the call that used to throw "could not be normalized to the LaTeX
// template contract" for every user on the shipped template.
syncTemplateContractToResume(dataDir, job.id);

// ---- 4. and it builds, when there is something to build it with -------------
const engine = ['latexmk', 'pdflatex', 'tectonic'].find(binary => {
  try {
    execFileSync('/usr/bin/which', [binary], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
});
if (!engine) {
  console.log('SKIP: no LaTeX engine on PATH (the contract checks above still ran)');
} else {
  try {
    renderResume(dataDir, job.id);
    const pdf = join(dataDir, 'campaigns', 'current', 'jobs', 'example-labs-backend-engineer', 'resume.pdf');
    assert.ok(existsSync(pdf), `the shipped template must compile with ${engine}`);
  } catch (error) {
    // An incomplete TeX installation is not a broken template, and the two fail
    // the same way from here. Say which one this is instead of blaming the repo:
    // the engine chain does not skip an engine that exists but cannot resolve
    // the template's packages, so this is a real and documented user failure.
    const detail = String(error.stdout || error.message || error);
    const missing = detail.match(/File `([^']+)' not found/);
    if (!missing) throw error;
    console.log(`SKIP: ${engine} is installed but cannot resolve ${missing[1]} — `
      + 'install the full LaTeX package set (see docs/INSTALL.md) to run the compile leg');
  }
}

console.log('template: shipped LaTeX template satisfies the campaign contract ✓');
