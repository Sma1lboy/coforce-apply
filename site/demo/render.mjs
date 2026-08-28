#!/usr/bin/env node
// Renders site/demo/profile.json through the real tailor template and REFUSES to
// emit the landing page's asset unless the PDF clears the product's own machine
// gate: exactly one page, content reaching >= 93% down it (the same
// `onePage` / `fullPage` pair campaign-lib.mjs's judgeResume computes, from the
// same two binaries).
//
// The reason this script exists rather than a hand-made screenshot: the page
// claims "one page, filled — measured, not eyeballed" directly above the image.
// Shipping a half-empty resume there advertises that the gate does not work.
//
//   node site/demo/render.mjs            # render, measure, write PNG on pass
//   node site/demo/render.mjs --measure  # measure an existing PDF only
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../..');
const TEMPLATE = join(REPO, '.agents/skills/tailor/assets/resume_template.tex');
const MIN_COVERAGE = 93;

const esc = t => String(t)
  .replace(/\\/g, '\\textbackslash ')
  .replace(/&/g, '\\&')
  .replace(/%/g, '\\%')
  .replace(/\$/g, '\\$')
  .replace(/#/g, '\\#')
  .replace(/_/g, '\\_')
  .replace(/~/g, '\\textasciitilde ')
  .replace(/\^/g, '\\textasciicircum ');

const textOf = d => (typeof d === 'string' ? d : d.text);

function buildTex(profile) {
  const template = readFileSync(TEMPLATE, 'utf8');
  const head = template.slice(0, template.indexOf('\\begin{document}'));
  const L = new Set(['Go', 'Python', 'TypeScript', 'Rust', 'Java', 'C++', 'C#', 'JavaScript', 'SQL']);
  const langs = (profile.skills || []).filter(s => L.has(s));
  const tools = (profile.skills || []).filter(s => !L.has(s));

  const out = [
    '\\begin{document}',
    '\\begin{center}',
    `\\textbf{\\Huge \\scshape ${esc(profile.name)}} \\\\ \\vspace{1pt}`,
    '\\small',
    `${esc(profile.phone)} $|$ ${esc(profile.email)} $|$ ` +
      `linkedin.com/in/${esc(profile.linkedin)} $|$ github.com/${esc(profile.github)}`,
    '\\end{center}',
    '\\section{Education}',
    '\\resumeSubHeadingListStart',
  ];
  for (const e of profile.education || []) {
    out.push('\\resumeSubheading',
      `{${esc(e.institution)}}{${esc(e.location || '')}}`,
      `{${esc(e.degree || '')}}{${esc(e.date || '')}}`);
  }
  out.push('\\resumeSubHeadingListEnd', '\\section{Experience}', '\\resumeSubHeadingListStart');
  for (const e of profile.experience || []) {
    out.push('\\resumeSubheading',
      `{${esc(e.title || '')}}{${esc(e.location || '')}}`,
      `{${esc(e.company)}}{${esc(e.date || '')}}`,
      '\\resumeItemListStart');
    for (const d of e.description) out.push(`\\resumeItem{}{${esc(textOf(d))}}`);
    out.push('\\resumeItemListEnd');
  }
  out.push('\\resumeSubHeadingListEnd');

  if ((profile.projects || []).length) {
    out.push('\\section{Projects}', '\\resumeSubHeadingListStart');
    for (const p of profile.projects) {
      out.push('\\resumeProjectHeading',
        `{\\textbf{${esc(p.name)}} $|$ \\emph{${esc(p.technologies || '')}}}` +
          `{\\small\\textit{${esc(p.dateRange || '')}}}`,
        '\\resumeItemListStart');
      for (const d of p.description) out.push(`\\resumeItem{}{${esc(textOf(d))}}`);
      out.push('\\resumeItemListEnd');
    }
    out.push('\\resumeSubHeadingListEnd');
  }

  out.push('\\section{Skills}',
    '\\begin{itemize}[leftmargin=0.15in, label={}]', '\\small{\\item{',
    `\\textbf{Languages}: ${esc(langs.join(', '))} \\quad \\\\`,
    `\\textbf{Frameworks/Tools}: ${esc(tools.join(', '))}`,
    '}}', '\\end{itemize}', '\\end{document}');
  return head + out.join('\n') + '\n';
}

// The gate, computed the way the product computes it.
export function measure(pdf) {
  const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0) || null;
  const bbox = execFileSync('pdftotext', ['-bbox', pdf, '-'], { encoding: 'utf8' });
  const page = bbox.match(/<page width="([\d.]+)" height="([\d.]+)"/);
  const ys = [...bbox.matchAll(/yMax="([\d.]+)"/g)].map(m => Number(m[1]));
  const coverage = page && ys.length
    ? Math.round((Math.max(...ys) / Number(page[2])) * 1000) / 10
    : null;
  return {
    pages,
    onePage: pages === 1,
    coveragePercent: coverage,
    fullPage: coverage !== null && coverage >= MIN_COVERAGE,
  };
}

if (process.argv.includes('--measure')) {
  console.log(JSON.stringify(measure(join(here, 'resume.pdf'))));
  process.exit(0);
}

const profile = JSON.parse(readFileSync(join(here, 'profile.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'coforce-demo-'));
writeFileSync(join(work, 'resume.tex'), buildTex(profile));
execFileSync('pdflatex', ['-interaction=nonstopmode', 'resume.tex'], { cwd: work, stdio: 'ignore' });

const pdf = join(work, 'resume.pdf');
const verdict = measure(pdf);
console.log(JSON.stringify(verdict));

if (!verdict.onePage || !verdict.fullPage) {
  console.error(
    `\nREFUSING to emit: the demo resume fails the product's own gate ` +
    `(onePage=${verdict.onePage}, coverage=${verdict.coveragePercent}%, needs >= ${MIN_COVERAGE}%).\n` +
    `Add or cut content in site/demo/profile.json and run again. Do not ship a ` +
    `resume the product would reject next to the claim that it measures this.\n`
  );
  process.exit(1);
}

copyFileSync(pdf, join(here, 'resume.pdf'));
execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '1', pdf, join(here, 'resume')]);
copyFileSync(join(here, 'resume-1.png'), join(here, '../public/demo-resume.png'));
console.log(`emitted site/public/demo-resume.png (coverage ${verdict.coveragePercent}%)`);
