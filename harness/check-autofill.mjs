// Two-tier apply harness check. Run: node harness/check-autofill.mjs
//
// Tier 1: replays the content script's matching logic (src/utils/autofillFields.ts,
// imported directly via Node's TS type-stripping) against the mock ATS form,
// asserting each field resolves to the right fixture-profile value.
// Tier 2: asserts the failure signal (required fields tier 1 can't fill) that
// makes the extension surface an agent fallback command.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFieldValue } from '../src/utils/autofillFields.ts';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'mock/apply-form.html'), 'utf8');
const profile = JSON.parse(
  readFileSync(join(here, 'fixtures/profile.json'), 'utf8')
);

// ponytail: regex "parser" for our own controlled mock HTML only — swap in a
// real DOM (jsdom / browser run) if the mock ever grows beyond flat fields.
const attr = (tag, name) =>
  tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';

const labels = {};
for (const m of html.matchAll(/<label for="([^"]+)">([^<]*)<\/label>/g)) {
  labels[m[1]] = m[2];
}

const fields = [...html.matchAll(/<(input|textarea)\b[^>]*>/g)]
  .map(([tag, kind]) => ({
    kind,
    type: attr(tag, 'type') || 'text',
    id: attr(tag, 'id'),
    name: attr(tag, 'name'),
    placeholder: attr(tag, 'placeholder'),
    autocomplete: attr(tag, 'autocomplete'),
    required: /\brequired\b/.test(tag),
  }))
  // same exclusions as the content script's selector
  .filter(f => !['hidden', 'file', 'checkbox', 'radio', 'submit', 'button'].includes(f.type));

// Mirror describeInput(): label + name + id + placeholder + aria-label + autocomplete
const describe = f =>
  [labels[f.id] ?? '', f.name, f.id, f.placeholder, f.autocomplete].join(' ');

// --- Tier 1: every mappable field resolves to the right profile value ---
const expected = {
  first_name: 'John',
  last_name: 'Doe',
  email: 'john.doe@example.com',
  phone: '(123) 456-7890',
  job_application_location: 'San Francisco, CA',
  linkedin_url: 'johndoe',
  github_url: 'johndoe',
  portfolio: 'johndoe.com',
  sponsorship: undefined, // screening question must NOT be auto-answered
};

let filled = 0;
const unfilledRequired = [];
for (const f of fields) {
  const value = resolveFieldValue(describe(f), profile);
  assert.equal(
    value,
    expected[f.id],
    `field "${f.id}" resolved to ${JSON.stringify(value)}, expected ${JSON.stringify(expected[f.id])}`
  );
  if (value) filled += 1;
  else if (f.required) unfilledRequired.push(f.id);
}
assert.equal(filled, 8, `expected 8 filled fields, got ${filled}`);
console.log(`tier 1: filled ${filled}/${fields.length} fields ✓`);

// --- Tier 2: unfilled required screening question triggers the fallback ---
assert.deepEqual(unfilledRequired, ['sponsorship']);
const fallbackTriggered = filled === 0 || unfilledRequired.length > 0;
assert.ok(fallbackTriggered, 'tier-2 fallback should trigger');
console.log(
  `tier 2: fallback triggered by required [${unfilledRequired}] → agent apply skill ✓`
);

console.log('harness: two-tier apply check passed');
