# Roadmap: Extension-first → Skill-first

## Why

The current design does everything inside the Chrome extension (profile storage, JD
analysis, resume generation) against our own OpenAI-compatible API. That makes the
extension the center of gravity: hard to debug, hard to extend, and the AI work is
locked behind a browser runtime.

New direction: **the configured Codex or Claude Code runtime is the brain; the extension is only the hands.**

## Phase 1 — Local profile as a Skill ✅ (this repo, `.agents/skills/profile`)

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

Reference implementation in this repo: `.agents/skills/repo-bullets` — point it at a
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
   the failure in its history, and copies a Chrome-backed agent command
   (`codex '$apply <url>'` or `claude --chrome "/apply <url>"`);
   the `apply` skill (`.agents/skills/apply/SKILL.md`) completes the application
   in the user's existing Chrome session and stops before final submit for user
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

## Discover → grounded resume campaign ✅

`scripts/hunt.mjs` fetches job-list sources (seeded with speedyapply/
2027-SWE-College-Jobs and vanshb03/Summer2027-Internships), parses the README
tables, dedups against the tracker (URL or company+role — never double-apply),
filters the `## never-apply` section of `profile/instructions.md`, and
`--track`s the rest as pending. The independent Tier 0 `experience` skill owns
all GitHub scanning. Its maintained `sources.json` names the exact repositories
and accepted authors per repository; refresh never expands that allowlist. It
creates a compact, tagged, source-linked experience index containing only
matching and provenance fields. The `campaign` skill then hydrates full JDs, reads only that local index,
creates a deterministic evidence shortlist per job, fills the user's LaTeX template, and
renders one-page PDFs. The tracker console's Review tab shows each job link,
zoomable PDF, evidence, feedback, and approval state. Once every resume is
approved it exports one ZIP containing a manifest and one folder per job.
`instructions.md` remains standing user instruction. Flow split: `setup`
(one-time onboarding), `experience` (explicit scan/tag or offline rebuild),
`start` (discover + local-index campaign cycle), and `apply` (later delivery
with its independent final-submit confirmation).

## Harness — mock E2E ✅

`harness/` holds the mock environment (fixture profile, mock JD, mock ATS form).
The deterministic harness covers evidence attribution/pagination, Tier 0 index
construction, zero-GitHub multi-job campaign matching/feedback/approval/ZIP
export, tracker Review APIs, and the
two-tier apply confirmation lifecycle without touching real user data or job
sites. Resume wording remains agent-owned; state and provenance gates are
deterministic.

## Distribution — repo-local skills ✅

Users clone the repository and run Codex or Claude Code from that checkout.
Codex discovers the canonical `.agents/skills` tree; `.claude/skills` is a
project-local compatibility symlink to the same files. Nothing is copied into a
global skill directory. Skills remain self-contained, user data lives in
`~/.coforce/`, and the repository also carries the harness and extension build.

## Phase 4 — Rebrand & merge 🔶 (prep done)

Rebranded in-repo to **CoForce Apply** (new logo, manifest, README, package name).
The GitHub rename and the merge into CoForce (repo doesn't exist yet) are
owner-run steps — see `docs/MIGRATION.md`.
