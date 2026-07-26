---
name: campaign
description: Build and review a batch of job-specific resumes from local reviewed bullets and skills, render the managed LaTeX template, collect review, and export approved packages.
---

# Campaign — JD → grounded resume → review → ZIP

Campaign owns resume generation and review, never application submission.
Read `~/.coforce/instructions.md` first. Keep all personal and generated data
under `~/.coforce/`.

```sh
node "<campaign-skill>/scripts/campaign.mjs" <command>
```

## Inputs and ownership

- `~/.coforce/config.json` is the only runtime config.
- `latexTemplate` points to one managed file under `<dataHome>/templates/`.
  External templates are import-only; setup copies them into that location.
- `requireResumeReview` defaults to `true`.
- `resumePageCoverageMinimumPercent` defaults to `93`.
- `profile.json` owns reviewed bullets, attested skills, and
  `resumeSkillPolicy`.
- `experience/experience-index.json` may add sourced skill candidates.
- Campaign never calls GitHub, refreshes Tier 0, invents a bullet, or creates a
  skill from JD text.

The manifest is `campaigns/current/manifest.json` (`schemaVersion: "1.0"`).
Each job records identity, folder, status, selected bullet/skill IDs, selected
role pack, approval metadata, feedback, and error. Valid statuses are:

`queued`, `needs_browser_jd`, `jd_ready`, `matched`, `rendered`,
`render_failed`, `revision_requested`, `approved`.

Writes are locked and atomic. Each job also has `jobs/<folder>/job.json`.

## Cycle

### 1. Sync and hydrate

```sh
node "<campaign-skill>/scripts/campaign.mjs" sync
node "<campaign-skill>/scripts/campaign.mjs" show
node "<campaign-skill>/scripts/campaign.mjs" hydrate --id <job-id>
```

If hydration returns `needs_browser_jd`, capture the actual visible JD with the
runtime browser and provide it as a file:

```sh
node "<campaign-skill>/scripts/campaign.mjs" hydrate --id <job-id> --file <jd.txt>
```

Never substitute a search snippet or guessed description.

### 2. Load reviewed pools

```sh
node "<campaign-skill>/scripts/campaign.mjs" pool
node "<campaign-skill>/scripts/campaign.mjs" skills
node "<campaign-skill>/scripts/campaign.mjs" skill-review
```

Bullet IDs derive from canonical English text; nullable `textZh` is metadata.
Skill records preserve source-owned category and provenance. Profile skills are
eligible without GitHub proof; Tier 0 can enrich or add candidates.

`skill-review` must be approved with a non-empty baseline and role packs. An
Agent may propose policy membership, but only the user approves it.

### 3. Select for one JD

Read the full JD and both complete pools, then choose:

- the strongest reviewed bullets covering the role's important requirements;
- the reviewed baseline;
- one complete approved role pack;
- any genuinely useful JD-relevant extras from the pool.

Use judgment for quantity and ordering. Prefer evidence and diversity; do not
dump the pool or chase a fixed keyword count. Every included entry must start
with its reviewed introductory bullet.

```sh
node "<campaign-skill>/scripts/campaign.mjs" select --id <job-id> \
  --bullets <bullet-ids> \
  --skills <skill-ids> \
  --skill-pack <approved-pack>
```

The command rejects IDs outside either pool and rejects missing baseline/pack
members. It writes `match.json` and `match-report.md`; a new selection
invalidates prior judges.

Also flag hard preference conflicts from config (sponsorship, location,
work-mode, salary) in the match report.

### 4. Assemble and render

Tailoring is selection, ordering, and cutting:

- Render bullet English text verbatim, apart from LaTeX escaping.
- Render each selected skill name exactly once. Group by source-owned category;
  sparse categories may use a neutral combined label.
- Never retain unselected template skills.
- Preserve template preamble, macros, contact header, section order, wrappers,
  and spacing. Replace only semantic content.
- Use `\resumeItem{}{<bullet>}`; the first argument is a bold label.
- For feedback, update the same resume rather than creating parallel drafts.

```sh
node "<campaign-skill>/scripts/campaign.mjs" render --id <job-id>
node "<campaign-skill>/scripts/campaign.mjs" judge --id <job-id>
```

Machine review must pass:

- exactly one page and configured page coverage;
- selected bullets and skills are verbatim and complete;
- compact section transitions;
- template preamble, contact header, Skills leading spacing, Project entry
  scaffolding/transitions/tail, and resume-item argument placement match the
  managed template.

Coverage failure uses internal reason `page_coverage_insufficient`, keeps the
job in `revision_requested`, and is hidden from the Human Review API. A passing
newer judge records `reviewDeliveryProof.pageCoverage` and resolves that
internal feedback. Fix low coverage with better reviewed content, never by
changing typography or spacing.

Render the latest PDF to PNG and inspect it for collisions, clipping, awkward
wraps, and inconsistent spacing. Machine checks do not replace visual review.

Then run the context-free LLM judge from `references/resume-judge.md` in a
fresh agent using only the JD and resume. Run three times, save the median in
`llm-judge.json`, and use its fixes to reselect or return upstream for reviewed
source improvements. The generator must not read the judge rubric.

### 5. Review and export

With `requireResumeReview: true`, the Review tab handles feedback and approval.
With it disabled, a complete passing render can auto-approve. Neither mode
authorizes submitting an application.

Export only when every job is approved:

```sh
node "<campaign-skill>/scripts/campaign.mjs" export
```

Output: `campaigns/current/exports/resume-applications.zip`, containing one
folder per job with the PDF, TeX, JD, job snapshot, and match report.

## Invariants

- Profile is curated truth; campaign only selects from it and the local Tier 0
  skill index.
- Policy approval, resume approval, and final application submission are three
  different gates.
- Only the experience skill may scan GitHub.
- Re-running is idempotent by job URL; do not reopen approved jobs without an
  explicit request.
- One blocked job must not stop other campaign jobs from reaching Review.
- `campaign.mjs outcomes` joins bullet IDs to tracker results; always report
  its caveat because correlation is not causation.
