---
name: profile
description: Maintain the user's local career background (resume metadata) in ~/.coforce/profile.json — init from interview or an existing resume (PDF/JSON), add or update experience/projects/education/skills, supplement from raw material (a story, an award link, a certificate — no pre-structuring), and review. Use whenever the user mentions their profile, background, resume data, work history, awards or honors, wants to add something they built or won to their record, or invokes "/profile".
---

# Profile — local background maintenance

Single source of truth: `~/.coforce/profile.json` (personal data — never in any
repo). The authoritative schema is the shape below. Never invent fields.

Shape (all fields optional): `name`, `title`, `email`, `phone`, `location`,
`linkedin`, `github`, `website`, `summary`, `skills[]`, `courses[]`,
`verifiedSkills[] {name, category?, source?, evidenceIds[]?, verifiedAt?}`,
`resumeSkillPolicy {status: "review_requested" | "approved", baseline: string[],
rolePacks: Record<string, string[]>, reviewedAt?: string | null}`,
`experience[] {company, title, date, location?, description[{text, textZh?, weight?, source?, verifiedAt?}], weight?}`,
`education[] {institution, degree, date, location?, relevantCourses?}`,
`projects[] {name, description[{text, textZh?, weight?, source?, verifiedAt?}], technologies?, dateRange?, weight?}`,
`certifications[] {name, issuer, date}`, `languages[] {language, proficiency}`,
`customSections[] {title, weight?, entries[{heading?, subheading?, date?, description?[{text, textZh?, weight?, source?, verifiedAt?}]}]}`
— user-defined resume sections (Awards, Publications, Leadership, Open Source…)
that tailor renders as additional sections when relevant.
`weight` (higher = more important) drives what gets picked when tailoring a resume
to a JD — set it when the user signals importance, otherwise omit.

## Operations

**Init** (`~/.coforce/profile.json` missing):
- Create `~/.coforce/` if needed. If the user has an existing resume
  (PDF/JSON/text), read it and map into the schema.
- **A resume that lands here gets an intake review** — the material the user
  arrived with becomes the pool every future resume is selected from, so it is
  worth knowing what a screener sees in it before building on top. Run it per
  the `campaign` skill's `references/resume-judge.md`, **Intake mode** section
  (sibling install; fresh subagent, never this one — a parser that has read the
  rubric writes to it). It gates nothing and it runs AFTER whatever the user
  actually came for: `tailor`'s front door delivers the PDF first, then this.
  Skip it entirely if the user only asked to edit one field.
- Point the user at the console's Profile tab (tracker skill, port 4517) as
  the friendly editing surface: structured form (basics, skill chips,
  experience/project/education cards with per-bullet editing), a skill-policy
  review ledger, plus an "Import resume (AI)" button that parses pasted text
  via the local agent runtime for review-then-save.
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
path: `experience` reads local git history, so a private checkout goes
through the normal generate→review flow.

**Review**: summarize the profile compactly (one line per experience/project) and
point out gaps: missing dates, bullets with no results/metrics, stale `title`,
and skills in `skills[]` that no bullet anywhere evidences (a screener reads
those as keyword stuffing — either the bullet is missing or the skill is).

## Rules

- Validate against the shape above before writing; `description` entries are
  objects, not bare strings. `text` is the canonical English resume line;
  `textZh` is its optional Chinese translation and may be `null`.
- Never fabricate experience, dates, or metrics. Unknown → omit or ask.
- Never commit `~/.coforce/profile.json` anywhere or paste its contents into
  commits/PRs.

## Skill inventory and policy

- `skills[]` is user-attested resume/coursework truth and needs no public proof.
- `verifiedSkills[]` optionally adds Tier 0 category/source/evidence metadata.
- Campaign also reads `experience-index.json.skills[]`; merging is
  case-insensitive and never uses JD text as a source.
- `resumeSkillPolicy.baseline` and each `rolePack` contain canonical names from
  that merged pool. Everything else remains an optional JD extra.

An Agent may propose policy membership, but only the user may approve it.
Draft, empty, or stale references mean `review_requested`; newly discovered
optional skills do not invalidate an already approved policy. Policy approval
does not approve a resume or application.

## Entries carry their links

Projects should carry `url` (repo) and optionally `demo` (live deployment);
experience entries may carry `url`. The resume assembly renders these as
links on the heading line, and the top-level `website` field joins the
contact header. Employer-side screeners deduct hard for unlinked projects —
a resume should be born with its links, not have them patched in review.

## The profile is the verified bullet pool

Every `description` bullet may carry `textZh: string | null` for bilingual
review plus two optional provenance fields alongside `text`: `source` (URL of
the repo/PR/commit it derives from) and `verifiedAt`
(ISO date the user approved it into the profile). Nothing enters the profile
without explicit user approval — which is exactly why downstream resume
generation (the campaign skill) is allowed to select ONLY from these bullets,
verbatim. English `text` remains the value consumed by resume rendering and
verbatim checks; editors and downstream data files must preserve `textZh` and
all other optional fields on save.
