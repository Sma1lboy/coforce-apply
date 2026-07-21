# Roadmap: Extension-first → Skill-first

## Why

The current design does everything inside the Chrome extension (profile storage, JD
analysis, resume generation) against our own OpenAI-compatible API. That makes the
extension the center of gravity: hard to debug, hard to extend, and the AI work is
locked behind a browser runtime.

New direction: **Claude Code (skills) is the brain, the extension is only the hands.**

## Phase 1 — Local profile as a Skill ✅ (this repo, `.claude/skills/profile`)

The user's background (experience, projects, education, contact info) lives locally
as `profile/profile.json`, maintained through the `profile` skill. The schema is the
existing `userProfileSchema` in `src/types.ts` — unchanged, so the JSON exports
directly into the extension's existing "Import from JSON" flow with zero new code.

- `profile/profile.json` is gitignored (personal data never committed).
- The skill supports: init (interview / import from resume PDF or JSON), incremental
  updates, review, and export.

## Phase 2 — Third-party skills ✅

Capabilities beyond core profile maintenance come from installable third-party
skills, not from this repo's code. The contract a third-party skill needs:

- Read/write `profile/profile.json` (schema: `src/types.ts` `userProfileSchema`).
- Bullet points follow STAR (Situation/Task, Action, Result-with-metric).

Reference implementation in this repo: `.claude/skills/repo-bullets` — point it at a
git repo, it reads the user's actual commits/code and produces STAR bullets, then
merges them into the profile's `projects` section.

First real third-party adoption: `shushu-internship-tool` (Apache-2.0,
vendored with an appended CoForce integration layer; judged in
`docs/third-party/shushu-judge.md`) — JD → adapt a real GitHub project →
STAR lines + interview pack, complementing `repo-bullets`.

## Phase 3 — Auto-apply (extension as delivery manager) ✅ (v1)

The extension stops being the generator and becomes the **application manager**:
tracks which JDs to apply to, holds the tailored resume artifacts, and executes
submission with a two-tier strategy:

1. **Tier 1 (cheap/fast)**: scripted form-fill from the profile — implemented as
   the popup's Apply tab (`src/components/popup/ApplyTab.tsx`) + the
   `autofillApplication` handler in `src/ContentScript/index.ts` (heuristic
   label/name/placeholder matching). Site-specific ATS adapters
   (Workday/Greenhouse/Lever) and small-model driving are future upgrades.
2. **Tier 2 (fallback)**: when tier 1 fills nothing or leaves required fields
   empty, the Apply tab flags the application `needsFallback` (status stays
   `pending` — fallback is a delivery method, not a pipeline stage), records
   the failure in its history, and copies a `claude "/apply <url>"` command;
   the `apply` skill (`.claude/skills/apply/SKILL.md`) completes the
   application via browser-use and stops before final submit for user
   confirmation. It handles ATS account registration (Workday etc.): one-time
   consented setup in `profile/apply-config.json`, email = user's Gmail,
   passwords generated locally into macOS Keychain (metadata only in
   `profile/accounts.json`), verification codes fetched from the mailbox via
   browser session or user paste.

## Application tracker ✅

Local truth `profile/applications.json` (gitignored), maintained by the
`tracker` skill; `yarn board` renders a kanban (`scripts/board.mjs` →
`out/board.html`, 7 status columns: pending/fallback/failed/applied/
interviewing/offer/rejected). The extension's Apply tab syncs via Export/Import
JSON (merge by url, newer `updatedAt` wins). Per-application archive:
`profile/applications/<id>/` holds that application's files (interview prep,
offer letter, tailored resume); siblings of the id-folders are global files —
the board's detail dialog lists and serves them. Future: email-feedback
auto-marking as a separate skill writing to the same file.

## Resume formats & templates ✅

`tailor` accepts a template (`.tex`/`.html`) or reference resume
(`.pdf`/`.docx`) from `templates/` (gitignored) and outputs tex/PDF
(pdflatex) or Word (markdown → pandoc, textutil fallback).

## Discover → auto-apply loop ✅

`scripts/hunt.mjs` fetches job-list sources (seeded with speedyapply/
2027-SWE-College-Jobs and vanshb03/Summer2027-Internships), parses the README
tables, dedups against the tracker (URL or company+role — never double-apply),
filters the `## never-apply` section of `profile/instructions.md`, and
`--track`s the rest as pending. `instructions.md` is standing user instruction
metadata every skill reads first. Flow split: `setup` skill (one-time
onboarding) vs `start` skill (one cycle; recur via `/loop 30m /start` or a
cloud schedule).

## Harness — mock E2E ✅

`harness/` holds the mock environment (fixture profile, mock JD, mock ATS form).
The `harness` skill runs the full loop — tailor a resume from the mock JD, then
the deterministic two-tier apply check (`yarn harness`) — without touching real
data or real job sites. Resume generation itself is the `tailor` skill.

## Distribution — installable skills ✅

The product ships as Claude Code skills, not a project: users paste the README
install prompt (or one-liner), the agent shallow-clones the repo, copies the
skill folders (minus `harness`) into `~/.claude/skills/`, and runs `/setup`.
Skills are self-contained — scripts and the resume template live inside their
skill directories; user data lives in `~/.coforce/`. The repo remains the dev
environment (harness, extension build).

## Phase 4 — Rebrand & merge 🔶 (prep done)

Rebranded in-repo to **CoForce Apply** (new logo, manifest, README, package name).
The GitHub rename and the merge into CoForce (repo doesn't exist yet) are
owner-run steps — see `docs/MIGRATION.md`.
