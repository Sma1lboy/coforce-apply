#!/usr/bin/env node
// Supply-chain guards for the template's riskiest surfaces (borrowed from
// ai-job-search's tools/security_guards.py). This repo is clone-and-run: it
// ships skills, pre-approvable permissions, and scripts every user executes.
// These guards make the dangerous changes LOUD, not impossible — a PR that
// legitimately needs one must update the allowlists here in the same diff.
//
// 1. .gitignore — personal-data ignore rules must stay present, and no
//    un-allowlisted negation (!pattern) may re-include ignored content.
// 2. package.json (all, outside node_modules) — no npm/bun lifecycle
//    scripts, no trustedDependencies (code execution smuggled into install).
// 3. .claude/settings.json — must not exist unless every permissions.allow
//    entry and hook is allowlisted below (auto-approved on every clone).
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const errors = [];

// -- 1. .gitignore ----------------------------------------------------------
const REQUIRED_IGNORE_RULES = ["/.coforce/", "/profile/", "templates/", "out/"];
const ALLOWED_NEGATIONS = new Set([
  "!.yarn/releases",
  "!.yarn/plugins",
  "!.agents/skills/tracker/web/dist/",
  "!.agents/skills/tracker/web/dist/**",
  "!site/public/",
  "!site/public/**",
]);

const ignoreLines = readFileSync(path.join(ROOT, ".gitignore"), "utf8")
  .split("\n")
  .map((l) => l.trim());
for (const rule of REQUIRED_IGNORE_RULES) {
  if (!ignoreLines.includes(rule)) {
    errors.push(`.gitignore: required personal-data rule missing: ${rule}`);
  }
}
for (const line of ignoreLines) {
  if (line.startsWith("!") && !ALLOWED_NEGATIONS.has(line)) {
    errors.push(`.gitignore: un-allowlisted negation re-includes content: ${line}`);
  }
}

// -- 2. package.json lifecycle scripts --------------------------------------
const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack"];
const pkgFiles = execSync(
  "find . -name package.json -not -path '*/node_modules/*' -not -path './.git/*'",
  { cwd: ROOT, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);
for (const rel of pkgFiles) {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
  for (const hook of LIFECYCLE) {
    if (pkg.scripts?.[hook]) errors.push(`${rel}: lifecycle script "${hook}" runs code on install`);
  }
  if (pkg.trustedDependencies) errors.push(`${rel}: trustedDependencies enables install scripts`);
}

// -- 3. .claude/settings.json -----------------------------------------------
// The repo ships none today. If one appears, every entry must be listed here
// so the diff shows both the permission and its approval.
const ALLOWED_PERMISSIONS = new Set([]);
const ALLOWED_HOOKS = new Set([]);
const settingsPath = path.join(ROOT, ".claude/settings.json");
if (existsSync(settingsPath)) {
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  for (const p of settings.permissions?.allow ?? []) {
    if (!ALLOWED_PERMISSIONS.has(p)) errors.push(`.claude/settings.json: un-allowlisted permission: ${p}`);
  }
  for (const event of Object.keys(settings.hooks ?? {})) {
    if (!ALLOWED_HOOKS.has(event)) errors.push(`.claude/settings.json: un-allowlisted hook event: ${event}`);
  }
}

if (errors.length) {
  console.error("check-guards FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`check-guards OK (${pkgFiles.length} package.json files, ${REQUIRED_IGNORE_RULES.length} ignore rules)`);
