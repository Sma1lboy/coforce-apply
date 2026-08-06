---
name: campaign
description: Build and review a batch of job-specific resumes from local reviewed bullets and skills, render the managed LaTeX template, collect review, and export approved packages.
---

# Campaign — JD → grounded resume → review → ZIP

Campaign owns resume generation and review, never application submission. Read
`~/.coforce/instructions.md` first. Keep personal data under `~/.coforce/`.

```sh
node "<campaign-skill>/scripts/campaign.mjs" <command>
```

## Inputs and ownership

- `~/.coforce/config.json` is the only runtime config. Its managed
  `latexTemplate` is under `<dataHome>/templates/`; external files are
  import-only. Review defaults on and page coverage defaults to 93%.
- `profile.json` owns reviewed bullets, attested skills, and
  `resumeSkillPolicy`.
- `experience/experience-index.json` may add sourced skill candidates.
- Campaign never calls GitHub, refreshes Tier 0, or invents resume content.

`campaigns/current/manifest.json` is atomic state; each job also has
`jobs/<folder>/job.json`.

## Cycle

### 1. Sync and hydrate

```sh
node "<campaign-skill>/scripts/campaign.mjs" sync
node "<campaign-skill>/scripts/campaign.mjs" show
node "<campaign-skill>/scripts/campaign.mjs" hydrate --id <job-id>
```

If hydration returns `needs_browser_jd`, capture the visible JD and provide it:

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

Bullet IDs derive from English text; nullable `textZh` is metadata. Skill
records preserve source category and provenance. Profile skills need no public
proof; Tier 0 can enrich or add candidates.

`skill-review` must be approved with a non-empty baseline and role packs. An
Agent may propose policy membership, but only the user approves it.

### 3. Select for one JD

Read the full JD and pools. Choose strong, diverse bullets plus the baseline,
one complete role pack, and useful JD extras. Use judgment for quantity and
ordering; never dump the pool or omit an entry's reviewed introductory bullet.
Avoid two bullets in one entry opening with the same verb when the pool offers
an alternative.

**Name what the pool cannot cover.** List the JD's headline requirements that no
pool bullet can serve. That list is the gap report: give it to the user with the
selection, and keep it for the judge loop, which otherwise spends three
regenerate rounds rediscovering it. A gap is Module 1 work (one more repo through
`/experience`), never a reason to reword or stretch a bullet here.

```sh
node "<campaign-skill>/scripts/campaign.mjs" select --id <job-id> \
  --bullets <bullet-ids> \
  --skills <skill-ids> \
  --skill-pack <approved-pack> \
  [--language <en-US|zh-CN>]
```

The command rejects pool violations and missing policy members, writes
`match.json` plus `match-report.md`, and invalidates prior judges.
The command detects the resume language from the JD (`zh-CN` for Chinese text,
otherwise `en-US`); `--language` is an explicit override. The selected language
is persisted with the match. Contact details use
`profile.localizedContacts[language]` when present and otherwise fall back to
the profile's top-level `email` and `phone`.

Also flag hard preference conflicts from config (sponsorship, location,
work-mode, salary) in the match report.

### 4. Assemble and render

Tailoring is selection, ordering, and cutting. The deterministic assembler
rebuilds the body from profile metadata plus `match.json`; project-specific
names, dates, ordering, and keyword weights never live in campaign code:

- Render English `text` for `en-US` and reviewed `textZh` for `zh-CN`, verbatim.
  A selected Chinese bullet without `textZh` is a hard Module 1 gap.
- Render each selected skill name exactly once. Group by source-owned category;
  sparse categories may use a neutral combined label.
- Never retain unselected template skills.
- Preserve template preamble, macros, contact header, section order, wrappers,
  and spacing. Replace only semantic content.
- Use `\resumeItem{}{<bullet>}`; the first argument is a bold label.
- For feedback, update the same resume rather than creating parallel drafts.

```sh
node "<campaign-skill>/scripts/campaign.mjs" assemble --id <job-id> [--language <en-US|zh-CN>]
node "<campaign-skill>/scripts/campaign.mjs" render --id <job-id>
node "<campaign-skill>/scripts/campaign.mjs" judge --id <job-id>
```

`render` runs the assembler automatically whenever `match.json` exists. Entry
metadata comes from profile fields, including optional `role`, `url`, `demo`,
and `localized[language]` overrides. Metadata may fall back to the canonical
entry; bullets never fall back because mixing languages is not acceptable.
Chinese rendering uses `config.resumeCjkFont` when set, otherwise `Songti SC`
on macOS or `Noto Serif CJK SC` elsewhere, and requires XeLaTeX or Tectonic.

Machine review must pass:

- exactly one page and configured page coverage;
- selected bullets and skills are verbatim and complete;
- every bullet survives `pdftotext`, in order (`extractable`). Every ATS starts
  from that text layer, so a bullet that does not extract is a bullet no
  screener sees. A failure here is almost always the configured
  `latexTemplate` — report it as a template problem, not a resume problem;
- compact section transitions;
- template preamble, contact header, Skills leading spacing, Project entry
  scaffolding/transitions/tail, and resume-item argument placement match the
  managed template.

Coverage failure uses internal reason `page_coverage_insufficient` and remains
hidden from Human Review. A newer pass records delivery proof and resolves it.
Fix coverage with reviewed content, never typography or spacing.

Render the latest PDF to PNG and inspect it for collisions, clipping, awkward
wraps, and inconsistent spacing. Machine checks do not replace visual review.

Run the context-free LLM judge from `references/resume-judge.md` in a fresh
agent using only the JD and resume. The generator must not read the rubric. Run
it once — median-of-3 only before acting on a fail or an automatic approval.
Record it only through the schema-validating command; legacy or hand-written
verdict files remain visible as stale and cannot auto-approve:

```sh
node "<campaign-skill>/scripts/campaign.mjs" record-judge --id <job-id> --file <verdict.json>
# A failed first run must be repeated twice; pass all three files and the CLI
# validates each run, computes numeric medians, and records one envelope.
node "<campaign-skill>/scripts/campaign.mjs" record-judge --id <job-id> \
  --file <run-1.json> --file <run-2.json> --file <run-3.json>
```

The gate is only what a re-render can change (presentation, JD fit, deductions,
critical fixes); the rubric's `total` measures the candidate's evidence, so it
is reported to the user as advice and never blocks a resume. Exact thresholds
live in the spec.

Classify a failure before spending a second round:

- *selection problem* (wrong bullets, ordering, sparse page) → reselect,
  re-render, re-judge.
- *pool gap* (the JD needs a capability no pool bullet carries) → stop looping.
  Reselecting cannot conjure material. Name the missing capability and the repo
  or experience that would evidence it, and send that through Module 1.
- *generation-rule problem* (a whole class of resumes fails the same way) →
  sediment the rule into Module 1 (`experience` / `profile`), never into the
  judge spec.

A fix that reappears unchanged after a reselection is a gap or a rule problem,
not a selection problem.

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

- Profile and the local Tier 0 skill index are the only selection sources.
- Policy, resume, and final submission are separate approval gates.
- Only the experience skill may scan GitHub.
- Re-running is idempotent by job URL; do not reopen approved jobs without an
  explicit request.
- One blocked job must not stop other campaign jobs from reaching Review.
- `campaign.mjs outcomes` joins bullet IDs to tracker results; always report
  its caveat because correlation is not causation.
