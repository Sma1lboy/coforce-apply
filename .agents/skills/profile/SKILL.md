---
name: profile
description: Maintain the user's local career background (resume metadata) in ~/.coforce/profile.json — init from interview or an existing resume (PDF/JSON), add or update experience/projects/education/skills, review, and export for the extension. Use whenever the user mentions their profile, background, resume data, work history, wants to add something they built to their record, invokes "$profile" in Codex, or invokes "/profile" in Claude Code.
---

# Profile — local background maintenance

Single source of truth: `~/.coforce/profile.json` (personal data — never in any
repo). The authoritative schema is the shape below. Never invent fields.

Shape (all fields optional): `name`, `title`, `email`, `phone`, `location`,
`linkedin`, `github`, `website`, `summary`, `skills[]`, `courses[]`,
`experience[] {company, title, date, location?, description[{text, weight?}], weight?}`,
`education[] {institution, degree, date, location?, relevantCourses?}`,
`projects[] {name, description[{text, weight?}], technologies?, dateRange?, weight?}`,
`certifications[] {name, issuer, date}`, `languages[] {language, proficiency}`,
`customSections[] {title, weight?, entries[{heading?, subheading?, date?, description?[{text, weight?}]}]}`
— user-defined resume sections (Awards, Publications, Leadership, Open Source…)
that tailor renders as additional sections when relevant.
`weight` (higher = more important) drives what gets picked when tailoring a resume
to a JD — set it when the user signals importance, otherwise omit.

## Operations

**Init** (`~/.coforce/profile.json` missing):
- Create `~/.coforce/` if needed. If the user has an existing resume
  (PDF/JSON/text), read it and map into the schema.
- Point the user at the console's Profile tab (tracker skill, port 4517) as
  the friendly editing surface: structured form (basics, skill chips,
  experience/project/education cards with per-bullet editing) plus an
  "Import resume (AI)" button that parses pasted text via the configured local
  agent (`codex exec` or `claude -p`) for review-then-save.
- Otherwise interview briefly: contact basics → education → experience → projects
  → skills. Don't interrogate; accept partial data, everything is optional.

**Update**: read current JSON, apply the change (new job, new project, edited
bullet, added skill), write back. Preserve fields you didn't touch. When adding
description bullets, follow STAR: action verb + what + measurable result where
the user can supply one — ask for the metric once, don't block on it.

**Review**: summarize the profile compactly (one line per experience/project) and
point out gaps: missing dates, bullets with no results/metrics, stale `title`.

**Export**: the JSON is already in the exact format the extension's
"Import from JSON" (Options → Profile) accepts. To hand it to the extension, just
tell the user the file path or print the JSON.

## Rules

- Validate against the shape above before writing; `description` entries are
  objects `{text, weight?}`, not bare strings.
- Never fabricate experience, dates, or metrics. Unknown → omit or ask.
- Never commit `~/.coforce/profile.json` anywhere or paste its contents into
  commits/PRs.

## The profile is the verified bullet pool

Every `description` bullet may carry two optional provenance fields alongside
`text`: `source` (URL of the repo/PR/commit it derives from) and `verifiedAt`
(ISO date the user approved it into the profile). Nothing enters the profile
without explicit user approval — which is exactly why downstream resume
generation (the campaign skill) is allowed to select ONLY from these bullets,
verbatim. Editors must preserve unknown/optional fields on save.
