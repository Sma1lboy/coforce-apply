// Shared low-level fs utility for skill scripts and the console server.
// Data files are the contract between skills — every writer goes through the
// same atomic temp+rename so a crash can never leave a half-written contract.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const writeJsonAtomic = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
};
