// The user's single settings file: <dataHome>/config.json.
//
// It replaces the old pair — preferences.json (job-search intent) and
// apply-config.json (runtime config + consents) — which overlapped in meaning
// and disagreed in practice: needsSponsorship lived in BOTH, and the docs and
// the on-disk reality never matched. One flat object, one merge, one writer.
//
// Migration is lazy and non-destructive: the first read of a data home that
// still has the old pair folds them into config.json and leaves the originals
// on disk, inert. Preferences win on overlap — that was already the documented
// tie-break. Nothing is written when BOTH old files are absent, because the
// absence of settings is how the skills detect "setup never ran".
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './fs-atomic.mjs';

export const CONFIG_VERSION = 2;

// Intent keys — what the user wants from a job. Everything else in the file is
// runtime config or a standing consent. The split is documentation only; the
// file is flat so a patch never has to know which half a key belongs to.
export const INTENT_KEYS = [
  'level',
  'directions',
  'needsSponsorship',
  'workAuthorization',
  'workMode',
  'locations',
  'salaryFloor',
];

// Dropped at migration: nothing ever read them.
//   workDays  — collected by setup, zero readers, code or prose
//   agent     — Codex/Claude runtime selector; Claude is now the only runtime
const DEAD_KEYS = ['workDays', 'agent'];

const readJsonSafe = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

export const configPath = dataDir => join(dataDir, 'config.json');

/**
 * The user's settings, migrating the legacy pair on first read.
 * Returns {} for a data home that was never set up (and writes nothing).
 */
export function loadConfig(dataDir) {
  const path = configPath(dataDir);
  const current = readJsonSafe(path);
  if (isPlainObject(current)) return current;

  const legacyApply = readJsonSafe(join(dataDir, 'apply-config.json'));
  const legacyPrefs = readJsonSafe(join(dataDir, 'preferences.json'));
  if (!isPlainObject(legacyApply) && !isPlainObject(legacyPrefs)) return {};

  const merged = {
    ...(isPlainObject(legacyApply) ? legacyApply : {}),
    // preferences win: needsSponsorship / workAuthorization lived in both, and
    // preferences.json was the canonical one
    ...(isPlainObject(legacyPrefs) ? legacyPrefs : {}),
    version: CONFIG_VERSION,
  };
  for (const key of DEAD_KEYS) delete merged[key];
  writeJsonAtomic(path, merged);
  return merged;
}

/**
 * Merge a patch into the settings. ALWAYS a merge, never a replace: the console
 * posts two-key patches ({level, directions} from a filter click), and a
 * replace there would silently delete the user's visa status.
 */
export function saveConfig(dataDir, patch) {
  if (!isPlainObject(patch)) throw new Error('expected a JSON object');
  const merged = { ...loadConfig(dataDir), ...patch, version: CONFIG_VERSION };
  writeJsonAtomic(configPath(dataDir), merged);
  return merged;
}

/**
 * The intent slice, or null when the user has never been onboarded.
 *
 * `level` is what setup collects first and what the console's discovery filter
 * needs, so its absence IS "not onboarded" — the console opens its welcome
 * wizard on a null here. Do not switch this to "config.json exists": after
 * migration the file always exists and the wizard would silently never open.
 */
export function intentOf(config) {
  if (!isPlainObject(config) || config.level === undefined) return null;
  const intent = {};
  for (const key of INTENT_KEYS) {
    if (config[key] !== undefined) intent[key] = config[key];
  }
  return intent;
}
