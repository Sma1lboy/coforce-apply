---
name: profile
description: Maintain the user's local career background (resume metadata) in ~/.coforce/profile.json — init from interview or an existing resume (PDF/JSON), add or update experience/projects/education/skills, review, and export for the extension. Use whenever the user mentions their profile, background, resume data, work history, or wants to add something they built to their record.
---

# Profile — local background maintenance

Single source of truth: `~/.coforce/profile.json` (personal data — never in any
repo). The authoritative schema is the shape below. Never invent fields.

Shape (all fields optional): `name`, `title`, `email`, `phone`, `location`,
`linkedin`, `github`, `website`, `summary`, `skills[]`, `courses[]`,
`experience[] {company, title, date, description[{text, weight?}], weight?}`,
`education[] {institution, degree, date, relevantCourses?}`,
`projects[] {name, description[{text, weight?}], technologies?, dateRange?, weight?}`,
`certifications[] {name, issuer, date}`, `languages[] {language, proficiency}`.
`weight` (higher = more important) drives what gets picked when tailoring a resume
to a JD — set it when the user signals importance, otherwise omit.

## Operations

**Init** (`~/.coforce/profile.json` missing):
- Create `~/.coforce/` if needed. If the user has an existing resume
  (PDF/JSON/text), read it and map into the schema.
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
