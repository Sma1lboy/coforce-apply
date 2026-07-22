// The one data-home rule every script shares. Wherever a skill says
// "~/.coforce", what it means is:
//   1. $COFORCE_HOME            — explicit override (sandboxes, harness)
//   2. <checkout>/.coforce      — private-fork mode: the user forked the repo,
//                                 made the fork PRIVATE, and syncs their data
//                                 inside it across machines (setup verifies
//                                 privacy before ever creating this dir)
//   3. ~/.coforce               — default local-only home
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkoutRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function dataHome(root = checkoutRoot) {
  if (process.env.COFORCE_HOME) return resolve(process.env.COFORCE_HOME);
  const inRepo = join(root, '.coforce');
  return existsSync(inRepo) ? inRepo : join(homedir(), '.coforce');
}
