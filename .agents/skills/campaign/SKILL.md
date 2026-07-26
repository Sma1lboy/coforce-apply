---
name: campaign
description: Build and review a batch of job-specific resumes — sync discovered jobs, fetch full JDs, strictly select verbatim bullets from the verified pool in profile.json, render the user's LaTeX template to PDF, collect feedback/approval in the CoForce Review console, and export approved job folders as one ZIP. Use for "/campaign", "批量岗位匹配", "生成岗位简历", "review resumes", or when start finds queued/revision-requested campaign jobs.
---

# Campaign — jobs → grounded resumes → review → ZIP

This skill owns the resume-review stage. It does **not** submit applications.
Application submission remains a later `apply`-skill action with its own explicit
final-submit confirmation.

Read `~/.coforce/instructions.md` first. It overrides all defaults below. All
personal data and generated files stay under `~/.coforce/`; never copy them into
the CoForce repository.

The bundled scripts live relative to this skill directory:

```sh
node "<campaign-skill>/scripts/campaign.mjs" <command>
```

## Campaign state schema (canonical)

`~/.coforce/campaigns/current/manifest.json` is the campaign's contract file —
skills and the console both program against this schema, never against each
other's code:

```json
{
  "schemaVersion": "1.0",
  "updatedAt": "ISO-8601",
  "jobs": [{
    "id": "stable hash", "applicationId": "tracker id | null",
    "company": "…", "role": "…", "location": "…", "source": "…", "url": "…",
    "folder": "slug of the jobs/<folder>/ dir",
    "status": "queued | needs_browser_jd | jd_ready | matched | rendered | render_failed | revision_requested | approved",
    "matchScore": 0, "evidenceIds": [], "selectedSkillIds": [],
    "selectedSkillPack": "agentDev | backend | generalSWE | null",
    "experienceIndexGeneratedAt": "ISO | null", "experienceIndexFingerprint": "sha | null",
    "approvedAt": "ISO | null", "approvalMode": "manual | automatic | null",
    "reviewDeliveryProof": {
      "pageCoverage": {
        "status": "passed", "actualPercent": 97.2, "minimumPercent": 96,
        "judgedAt": "ISO", "artifact": "judge.json"
      }
    },
    "feedback": [{
      "reasonCode": "page_coverage_insufficient | null",
      "visibility": "internal | human",
      "text": "…", "status": "open | resolved",
      "resolutionEvidence": "pageCoverage proof | null"
    }],
    "error": null, "createdAt": "ISO", "updatedAt": "ISO"
  }],
  "lastExport": { "path": "…", "exportedAt": "ISO", "jobCount": 0 }
}
```

Every write goes through the library's locked, atomic writer; each job also has
a `jobs/<folder>/job.json` snapshot of its record. Bump `schemaVersion` on any
breaking field change and keep a migration shim for one version back.

## One-time inputs

Require these values in `~/.coforce/config.json`:

- `latexTemplate`: absolute path to the user's `.tex` template. Never modify the
  template in place.
- `requireResumeReview`: optional boolean, defaulting to `true`. When `false`,
  a complete successfully rendered resume is automatically approved and the
  ZIP is refreshed after the full batch completes.
- `resumePageCoverageMinimumPercent`: optional number from 0–100, defaulting to
  `93`. This is the minimum vertical page coverage for every generated resume.
  A resume below the configured threshold must select more reviewed pool
  bullets; never change template typography or spacing to satisfy it.

Require a non-empty **verified bullet pool** and skill inventory. Bullets are
reviewed into `~/.coforce/profile.json` (Module 1: the `experience` /
`profile` skills generate bullets JD-free from repo contexts and the user
approves them into the profile). Skills merge from all user-attested
`profile.skills[]`, optional `profile.verifiedSkills[]` evidence enrichments,
and the current local `experience-index.json.skills[]`. If
`campaign.mjs pool` reports no bullets, stop and send the user to Module 1
first. If `campaign.mjs skills` is empty, stop for profile setup. A campaign
must never discover repositories, invoke `gh`, refresh Tier 0, or generate new
bullet text — it only *selects* from local data.

The profile skill also owns the human-reviewed `profile.resumeSkillPolicy`
baseline and role packs. Before selecting for any JD, require:

```sh
node "<campaign-skill>/scripts/campaign.mjs" skill-review
```

It must report `status: "approved"` with a non-empty baseline, at least one
non-empty role pack, and no stale referenced skill names. Otherwise stop at
`review_requested`; campaign must not invent or approve defaults.

## Cycle

1. **Sync tracked jobs into the campaign**:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" sync
   node "<campaign-skill>/scripts/campaign.mjs" show
   ```

   Work on `queued`, `needs_browser_jd`, `jd_ready`, `matched`, `render_failed`,
   and `revision_requested` jobs. Existing approved jobs are left alone; reuse
   any valid artifacts already present instead of starting over.

2. **Load the verified bullet pool and merged skill pool**:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" pool
   node "<campaign-skill>/scripts/campaign.mjs" skills
   node "<campaign-skill>/scripts/campaign.mjs" skill-review
   ```

   Every bullet the user has reviewed into profile.json, with a stable 8-char
   content id, its origin (which experience/project it belongs to) and
   provenance (`source`, `verifiedAt` when present) and nullable Chinese
   translation (`textZh`). IDs are derived only from canonical English `text`,
   so translating a bullet does not invalidate saved selections. The pool is
   small — read it whole; there is no tag index and no relevance pre-filter.

   Every skill has a stable id and canonical `name`. The merged record preserves
   its resume `category`, `origins` (`resume` and/or `experience`),
   `attested`, `evidenceBacked`, and any Tier 0 `source` / `evidenceIds`.
   Resume/coursework skills are eligible without GitHub proof; experience
   evidence strengthens provenance and adds new candidates. JD keywords alone
   never add to this pool. Each item also reports whether it belongs to the
   human-reviewed `baseline` and which `rolePacks` reference it. Skills in
   neither remain valid JD extras; new optional skills do not invalidate an
   approved strategy.

3. **Hydrate the full JD** for each queued job:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" hydrate --id <job-id>
   ```

   This tries direct HTTP first. If it reports `needs_browser_jd`, use the
   runtime's visible Chrome integration to open the posting, capture the actual
   rendered job description, save it to a temporary local text file, then run:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" hydrate --id <job-id> --file <captured-jd.txt>
   ```

   Do not substitute a search snippet, company careers index, or guessed JD.

4. **Select bullets and skills for this JD — strictly from their pools.** Read
   the full JD and both pools, pick the bullets that genuinely fit (typically
   6–14), then select only the skills supported by those entries and the JD:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" select --id <job-id> \
     --bullets <bullet-id1,bullet-id2,…> \
     --skills <skill-id1,skill-id2,…> \
     --skill-pack <approved-role-pack>
   ```

   The command **rejects any bullet or skill id outside its pool** — fabrication is
   structurally impossible, not just discouraged. It writes `match-report.md`
   (human-readable selection) and `match.json` (`mode: "selection"`, verbatim
   bullets plus verbatim skills with provenance) and sets the job to `matched`.
   Any new selection or render invalidates the prior machine and LLM verdicts;
   judges must evaluate the exact current artifact.

   **Best-fit selection prompt** — run the choice with this rubric, not vibes:

   > You are selecting resume bullets for ONE job. Inputs: the full JD, the
   > full verified pool (id + text + origin), and config.json. Rules:
   > (1) cover the JD's top 3–5 required capabilities first — every one of
   > them should have at least one bullet if the pool has it; (2) prefer
   > bullets with concrete, verifiable outcomes over activity descriptions;
   > (3) diversity beats repetition — max ~2 bullets making the same point;
   > (4) respect entry coherence: bullets you pick determine which
   > experience/project entries appear, so avoid orphan entries with one weak
   > bullet; (5) 6–14 bullets total, one page after layout; (6) every entry
   > you include MUST lead with its introductory bullet — the one that says
   > what the project/product IS (type, purpose, scale) — before any detail
   > bullets; an entry whose intro bullet doesn't fit doesn't fit; (7) output
   > ONLY pool ids in display order — you cannot edit text, and ids outside
   > the pool will be rejected.

   Skill selection is three-layered: always include the full human-reviewed
   `baseline`; choose and include one complete human-reviewed role pack for the
   job direction; then fill the remaining capacity from the eligible pool by
   JD relevance. If the job direction does not clearly map to one approved
   pack, stop at `review_requested` and ask the human instead of guessing.
   There is no percentage gate: baseline and role-pack membership define
   defaults; the pool defines what may be selected dynamically.

   For JD extras, prioritize exact requirements, then skills supported by
   the user's attested inventory or experience; choose and order only, never
   rename or synthesize. Preserve the template's intentionally
   dense skill inventory: when the eligible merged pool contains at least 18 skills,
   select **18–26** across roughly 5–6 useful categories (and more when the JD
   genuinely supports them). "Avoid keyword stuffing" means omit unrelated or
   undefendable terms — it does not mean collapsing a strong sourced inventory
   to 9–12 keywords. The CLI rejects a selection below
   `min(18, mergedSkillPoolSize)` so this cannot silently regress.

   Alongside the selection, check the JD against `~/.coforce/config.json`
   (canonical user intent — `needsSponsorship`, `workMode`, `locations`,
   `salaryFloor`; schema in the setup skill): a posting that violates a hard
   preference (e.g. "no sponsorship" while `needsSponsorship` is true, or
   onsite-only against `workMode: remote`) gets flagged in `match-report.md`
   so the user sees the conflict at review time instead of after applying.

5. **Assemble the job-specific resume from the selection — verbatim.** Copy
   the template into the job folder as `resume.tex`; preserve its packages,
   macros, typography, spacing, and section order. Every resume bullet must be
   one of the selected English `text` bullets, **word for word** (LaTeX
   escaping aside); `textZh` is review/localization metadata and is not mixed
   into an English resume. Tailoring means choosing, ordering, and cutting —
   never rewriting. If a
   bullet should be phrased better, that is Module 1 work: regenerate →
   user review → profile, then reselect. The one-page cut drops the
   least-relevant selected bullets first, never edits them.

   Replace the template's Skills **contents** with the selected skills while
   preserving the template's section wrapper, `\resumeSubItem` scaffolding,
   and spacing. Saved `category` remains provenance in `match.json`; the resume
   display consolidates related source categories into dense groups such as
   **Languages & Frameworks**, **Backend, APIs & Data**, and
   **Infrastructure & Distributed Systems**. No displayed group may contain
   fewer than `min(5, selectedSkillCount)` skills: a sparse AI or infrastructure
   group is merged into its closest related group instead of consuming a whole
   line. Render each selected `name` verbatim exactly once. Do not retain static
   template skills that were not selected, and do not add a JD keyword outside
   `match.json.skills`. The
   renderer performs this replacement from `match.json` immediately before
   compilation, preventing a valid selection from leaving stale sparse Skills
   text in `resume.tex`.

   Template spacing is data, not a hint. Preserve the template's entry
   scaffolding byte-for-byte, including each `itemize` boundary, `\vspace`
   value, and section-adjacent spacer. Replace only semantic fields (entry
   heading, metadata, link, and selected bullet bodies). When another entry is
   needed, clone the nearest same-kind experience/project block and retain its
   exact wrapper and spacing tokens; do not rebuild wrappers from generic
   defaults or normalize values such as `-9mm` to `-8mm`.

   The contact header is locked template content. Never append job-specific
   location, work-mode, relocation, visa, CPT, or sponsorship labels to it.
   Those values belong in preferences, tracker notes, and application-form
   answers; they do not belong in the resume contact line.

   Preserve the template preamble exactly. For this template,
   `\resumeItem{label}{body}` bolds the label argument; resume bullets therefore
   go in the body argument as `\resumeItem{}{<verbatim bullet>}` so only the
   bullet's reviewed, explicit `\textbf{...}` spans are bold. Never rewrite the
   macro to compensate for incorrect argument placement.

   For a revision-requested job, read every open feedback item first and
   regenerate the existing `resume.tex`; do not create parallel drafts.

   **Judge every render before it reaches review.** Machine metrics first:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" judge --id <job-id>
   ```

   `judge.json` must show `onePage: true` (exactly one page), `fullPage: true`
   (content reaches the configured `resumePageCoverageMinimumPercent`; the
   record includes both `fullness` and `minimumPageCoveragePercent` — a sparse
   page is as much a failed product as a second page; fix by selecting MORE
   pool bullets, never by inflating text), and `verbatim: true` (every
   `\resumeItem` is one of the
   selected bullets, word for word), `skillsDense: true` (at least
   `min(18, skillPoolSize)` rendered skills), `skillGroupsDense: true` (every
   displayed group has at least `min(5, selectedSkillCount)` entries), and
   `skillsVerbatim: true` whenever a
   Skills section or skill selection exists (every rendered skill is selected
   and every selected skill is rendered). It must also show
   `sectionTransitionsCompact: true`: the rendered `Working Experience` →
   `Projects` boundary may not contain a visible blank row (the machine limit
   is a 13-point baseline-to-baseline gap). A failed metric blocks automatic
   approval in code; fix and re-render, don't argue.

   The template-contract metrics must also pass:
   `templatePreambleExact`, `templateContactHeaderExact`,
   `projectTransitionSpacingExact`, and `resumeItemsUseBodyArgument`. These
   prevent per-resume macro forks, job-specific contact-line additions,
   normalized project spacers, and accidental whole-bullet bolding.
   `campaign.mjs render` normalizes these locked surfaces from the configured
   template before compiling; the judge independently verifies the result.

   `page_coverage_insufficient` is the canonical machine-readable revision
   reason. A failed coverage judge writes that open feedback reason and keeps
   the job in `revision_requested`; it is not a successful render. The job may
   return to `rendered` (Ready to Review) only after a newer judge passes and
   the job records `reviewDeliveryProof.pageCoverage` with actual percentage,
   configured minimum, timestamp, and `judge.json` artifact. The earlier
   feedback remains in history as `resolved` with the same proof attached.
   This reason, its actual/minimum values, and `reviewDeliveryProof` are
   **internal Agent QA only**. Mark them `visibility: "internal"` and never
   expose them through the Human Review console/API. Human reviewers see only
   a generic revision-in-progress state until the resume is ready.

   Render the latest PDF to PNG and visually inspect every section boundary at
   readable resolution before review. The machine gap metric prevents the known
   blank-row regression, but it does not replace checking for collisions,
   clipping, awkward wraps, or inconsistent spacing. A contact sheet may be
   used for batch triage; inspect any anomaly at full resolution.

   Then the LLM judge — **one spec, run context-free**: spawn a fresh
   subagent (Task tool) whose entire context is the resume text, the JD,
   and `references/resume-judge.md`.
   The agent that assembled the resume never judges it; do not pass it the
   pool or your selection rationale. Run 3× and take the median when the
   score drives a decision. Record the verdict as `llm-judge.json` in the job
   folder (schema + pass bar in the spec): **automatic approval is code-gated
   on a recorded passing verdict**, and a failing score loops — apply the
   fixes, re-render, re-judge, at most 3 rounds, then escalate to the user
   with the verdicts. Isolation is two-way — the selection/assembly
   steps above must never read the judge spec: a generator that sees the
   rubric games the score instead of telling the truth.

   Its `deductions.reasons` + `fixes` are the regenerate work list, split by
   root cause into the **improvement loop**:

   - *selection problem* (wrong bullets, ordering, sparse page) → fix this
     resume: reselect/reorder, re-render, re-judge.
   - *generation-rule problem* (a whole class of resumes would fail the same
     way: missing project links, unevidenced skills, no demo URLs) → sediment
     a rule change into Module 1's prompts (experience / profile SKILL.md)
     with the user's sign-off, then regenerate downstream. Judge findings are
     how the generation prompts iterate — never edit the judge to make a
     finding go away.

   Already-sedimented examples: full page ⇒ select more bullets (never
   inflate text); projects are born with repo/demo links.

6. **Render and inspect**:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" render --id <job-id>
   ```

   Rendering requires `latexmk`, `pdflatex`, or `tectonic` and enforces the
   one-page and configured page-coverage gates when the corresponding PDF tools
   are available. If `pdftoppm` is available, render
   the PDF to PNG at 150 DPI and visually inspect it for clipping, overlap,
   missing glyphs, broken links, and accidental blank space before marking it
   ready. Iterate until the output is clean. With `requireResumeReview: false`,
   this successful completion automatically records approval mode `automatic`;
   failures and incomplete artifact sets never auto-approve.

7. **Review when required**. With the default `requireResumeReview: true`, serve
   the tracker and open the **Review** tab. It shows the job link, match evidence,
   zoomable PDF, prior feedback, revision request, and approval controls.
   Feedback changes the job to `revision_requested`; the next `/start` or
   `/campaign` cycle consumes it. With the setting off, Review remains available
   for optional inspection but does not block approval or export.

8. **Export after approval**. The Review tab enables **Export approved ZIP**
   only when every campaign job is approved. Export revalidates the current
   page-coverage setting, so changing the threshold cannot leave old approvals
   eligible under a stale judge. In auto mode the state machine performs the
   same export automatically when the final job completes. The equivalent CLI
   is:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" export
   ```

   Output: `~/.coforce/campaigns/current/exports/resume-applications.zip`.
   It contains a root `manifest.json` and one `<company>-<role>/` folder per job
   with `resume.pdf`, `resume.tex`, `job-description.md`, `job.json`, and
   `match-report.md`.

## Closing the loop (outcomes)

The pipeline optimises for producing resumes; nothing else looks back at which
ones worked. `outcomes` joins the bullets selected per job (`evidenceIds` in
the manifest) with where that application ended up in the tracker:

```sh
node "<campaign-skill>/scripts/campaign.mjs" outcomes
```

Returns each bullet with `advanced` (interviewing/offer) and `rejected`
counts, the jobs it rode on, a `neverUsed` list of pool bullets that have
never made it onto a resume, and `detached` — ids that were used but no longer
match any pool bullet, which means the profile text was edited afterwards
(bullet ids are content hashes).

**Report the `caveat` field verbatim whenever you show this.** A person applies
to tens of jobs, and the same bullets ride along on nearly every resume, so
these counts cannot separate cause from correlation. Use it as a reading aid
when selecting for the next batch, or to spot pool bullets nobody ever picks —
never as proof a bullet works. Do not compute rates or rank "best bullets".

## State rules

- `profile.json` remains curated user truth for bullets and attested skills.
  Tier 0 experience-derived skills, optional evidence enrichments, and per-JD
  matches remain separate, reviewable data.
- `profile.resumeSkillPolicy` is a human-owned reusable review gate. Missing or
  stale baseline/role-pack defaults are effectively `review_requested`;
  neither campaign nor Tier 0 may promote skills into defaults or approve the
  strategy. New optional pool skills remain JD extras without invalidating it.
- Only the `experience` skill may scan GitHub. Campaign work is a local index
  read, no matter how many jobs are matched.
- Re-running is idempotent by job URL. Do not rebuild approved jobs unless the
  user explicitly reopens them.
- A campaign approval approves only the resume package, never the irreversible
  application submit.
- Resume review may be automatic; final application submission may not.
- Report blockers per job; one blocked listing must not prevent other resumes
  from reaching Review.
