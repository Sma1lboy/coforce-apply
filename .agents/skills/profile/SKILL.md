---
name: profile
description: Maintain the user's local career background (resume metadata) in ~/.coforce/profile.json — init from interview or an existing resume (PDF/JSON), add or update experience/projects/education/skills, supplement from raw material (a story, an award link, a certificate — no pre-structuring), review, and export for the extension. Use whenever the user mentions their profile, background, resume data, work history, awards or honors, wants to add something they built or won to their record, invokes "$profile" in Codex, or invokes "/profile" in Claude Code.
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

**Supplement** (user drops new material — a work-experience story, an award,
a certificate, a publication, a pasted LinkedIn section): the user should
never have to pre-structure anything. Accept whatever they give — a paragraph
in their own words, a URL, a PDF path — and do the digging yourself:
1. Read/fetch the material (open PDFs and award/announcement URLs directly
   when tooling allows; extract facts verbatim from the page).
2. Classify: work experience → `experience[]`; award/competition/publication/
   leadership → `customSections[]` (reuse an existing section title like
   "Awards" when one fits); certificate → `certifications[]`.
3. Draft schema-shaped entries with STAR bullets from the narrative. Batch ALL
   gaps (missing dates, the one metric worth having) into a single question
   round — never interrogate item by item, never block on unanswered gaps.
4. Present the drafted entries for review, then merge additively — existing
   entries untouched. On approval stamp each new bullet's `verifiedAt`; set
   `source` to the evidencing URL when the material came with one (award
   pages and publication links are third-party evidence — stronger than
   self-description; always keep them). Purely narrated work with no artifact
   gets no `source` — that is fine: `verifiedAt` still marks the user's
   approval and the bullet is user-attested.
The console offers the same channel as Profile → "＋ Add with AI" (additive,
review-then-save). Work that has code but no public repo needs no special
path: `repo-bullets` reads local git history, so a private checkout goes
through the normal generate→review flow.

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

## Entries carry their links

Projects should carry `url` (repo) and optionally `demo` (live deployment);
experience entries may carry `url`. The resume assembly renders these as
links on the heading line, and the top-level `website` field joins the
contact header. Employer-side screeners deduct hard for unlinked projects —
a resume should be born with its links, not have them patched in review.

## The profile is the verified bullet pool

Every `description` bullet may carry two optional provenance fields alongside
`text`: `source` (URL of the repo/PR/commit it derives from) and `verifiedAt`
(ISO date the user approved it into the profile). Nothing enters the profile
without explicit user approval — which is exactly why downstream resume
generation (the campaign skill) is allowed to select ONLY from these bullets,
verbatim. Editors must preserve unknown/optional fields on save.
