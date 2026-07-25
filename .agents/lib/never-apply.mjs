// The user's never-apply list, parsed from the "## never-apply" section of
// instructions.md.
//
// Shared because it must be enforced on EVERY path that queues a job, not just
// discovery: hunt.mjs filters what it fetches, and the console's "Build resume"
// button queues jobs the user pasted or clicked. One parser, every caller.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Lowercased company names from the "## never-apply" section. */
export function neverApplyList(instructionsPath) {
  if (!existsSync(instructionsPath)) return [];
  const md = readFileSync(instructionsPath, 'utf8');
  const section = md.match(/^##\s*never-apply\s*$([\s\S]*?)(?=^##\s|\n*$(?![\s\S]))/im);
  if (!section) return [];
  return section[1]
    .split('\n')
    // "-", "*" and "+" bullets, and numbered items — people write all of them
    .map(line => line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean)
    .map(s => s.toLowerCase());
}

/** True when a company name matches the list. Substring, case-insensitive. */
export const isNeverApply = (company, blocked) => {
  const name = String(company || '').toLowerCase();
  return !!name && blocked.some(b => name.includes(b));
};

export const neverApplyFor = dataDir =>
  neverApplyList(join(dataDir, 'instructions.md'));
