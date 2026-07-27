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
    "matchScore": 0, "evidenceIds": [],
    "experienceIndexGeneratedAt": "ISO | null", "experienceIndexFingerprint": "sha | null",
    "approvedAt": "ISO | null", "approvalMode": "manual | automatic | null",
    "feedback": [], "error": null, "createdAt": "ISO", "updatedAt": "ISO"
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

Require a non-empty **verified bullet pool**: the bullet points already
reviewed into `~/.coforce/profile.json` (Module 1: the `experience` /
`profile` skills generate bullets JD-free from repo contexts and the user
approves them into the profile). If `campaign.mjs pool` reports none, stop and
send the user to Module 1 first. A campaign must never discover repositories,
invoke `gh`, or generate new bullet text — it only *selects*. The sibling
`experience` skill's evidence index is Module-1 raw material, not a campaign
input anymore.

## Cycle

1. **Sync tracked jobs into the campaign**:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" sync
   node "<campaign-skill>/scripts/campaign.mjs" show
   ```

   Work on `queued`, `needs_browser_jd`, `jd_ready`, `matched`, `render_failed`,
   and `revision_requested` jobs. Existing approved jobs are left alone; reuse
   any valid artifacts already present instead of starting over.

2. **Load the verified bullet pool**:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" pool
   ```

   Every bullet the user has reviewed into profile.json, with a stable 8-char
   content id, its origin (which experience/project it belongs to) and
   provenance (`source`, `verifiedAt` when present). The pool is small — read
   it whole; there is no tag index and no relevance pre-filter.

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

4. **Select bullets for this JD — strictly from the pool.** Read the full JD
   and the full pool, pick the bullets that genuinely fit (typically 6–14),
   then record the selection:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" select --id <job-id> --bullets <id1,id2,…>
   ```

   The command **rejects any id outside the pool** — fabrication is
   structurally impossible, not just discouraged. It writes `match-report.md`
   (human-readable selection) and `match.json` (`mode: "selection"`, verbatim
   bullets with provenance) and sets the job to `matched`.

   **Best-fit selection prompt** — run the choice with this rubric, not vibes:

   > You are selecting resume bullets for ONE job. Inputs: the full JD, the
   > full verified pool (id + text + origin), and config.json. Rules:
   > (1) cover the JD's top 3–5 required capabilities first — every one of
   > them should have at least one bullet if the pool has it; (2) prefer
   > bullets with concrete, verifiable outcomes over activity descriptions;
   > (3) diversity beats repetition — max ~2 bullets making the same point,
   > and avoid two bullets in one entry opening with the same verb when the
   > pool offers an alternative;
   > (4) respect entry coherence: bullets you pick determine which
   > experience/project entries appear, so avoid orphan entries with one weak
   > bullet; (5) 6–14 bullets total, one page after layout; (6) every entry
   > you include MUST lead with its introductory bullet — the one that says
   > what the project/product IS (type, purpose, scale) — before any detail
   > bullets; an entry whose intro bullet doesn't fit doesn't fit; (7) output
   > ONLY pool ids in display order — you cannot edit text, and ids outside
   > the pool will be rejected.

   **Name what you could not cover.** Rule (1) is capped by the pool: list the
   JD's headline requirements that NO pool bullet can serve. That list is the
   gap report — say it to the user with the selection, and keep it for the
   judge loop below, which otherwise spends three regenerate rounds
   rediscovering it. A gap is Module 1 work (one more repo through
   `/experience`), never a reason to reword or stretch a bullet here.

   Alongside the selection, check the JD against `~/.coforce/config.json`
   (canonical user intent — `needsSponsorship`, `workMode`, `locations`,
   `salaryFloor`; schema in the setup skill): a posting that violates a hard
   preference (e.g. "no sponsorship" while `needsSponsorship` is true, or
   onsite-only against `workMode: remote`) gets flagged in `match-report.md`
   so the user sees the conflict at review time instead of after applying.

5. **Assemble the job-specific resume from the selection — verbatim.** Copy
   the template into the job folder as `resume.tex`; preserve its packages,
   macros, typography, spacing, and section order. Every resume bullet must be
   one of the selected bullets, **word for word** (LaTeX escaping aside);
   tailoring means choosing, ordering, and cutting — never rewriting. If a
   bullet should be phrased better, that is Module 1 work: regenerate →
   user review → profile, then reselect. The one-page cut drops the
   least-relevant selected bullets first, never edits them.

   For a revision-requested job, read every open feedback item first and
   regenerate the existing `resume.tex`; do not create parallel drafts.

   **Judge every render before it reaches review.** Machine metrics first:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" judge --id <job-id>
   ```

   `judge.json` must show `onePage: true` (exactly one page), `fullPage: true`
   (content reaches ≥93% down the page — a half-empty page is as much a failed
   product as a second page; fix by selecting MORE pool bullets, never by
   inflating text), `verbatim: true` (every `\resumeItem` is one of the
   selected bullets, word for word), and `extractable: true` (every bullet
   survives `pdftotext`, in order — every ATS reads that same text layer, so a
   bullet that does not extract is a bullet no screener sees; a failure here
   is almost always the user's own `latexTemplate`, so report it as a template
   problem, not a resume problem). A failed metric blocks automatic approval
   in code; fix and re-render, don't argue.

   Then the LLM judge — **one spec, run context-free**: spawn a fresh
   subagent (Task tool) whose entire context is the resume text, the JD,
   and `references/resume-judge.md`.
   The agent that assembled the resume never judges it; do not pass it the
   pool or your selection rationale. Run it once; median-of-3 only before
   acting on a fail or an automatic approval (rule in the spec). Record the
   verdict as `llm-judge.json` in the job
   folder (schema + gate in the spec): **automatic approval is code-gated
   on a recorded passing verdict**, and a failing gate loops — apply the
   fixes, re-render, re-judge, at most 3 rounds, then escalate to the user
   with the verdicts. The gate covers only what a re-render can change
   (presentation, JD fit, deductions); the spec's `total` measures the
   candidate's evidence, so it is reported to the user as advice and never
   blocks a resume. Isolation is two-way — the selection/assembly
   steps above must never read the judge spec: a generator that sees the
   rubric games the score instead of telling the truth.

   Its `deductions.reasons` + `fixes` are the regenerate work list, split by
   root cause into the **improvement loop**:

   - *selection problem* (wrong bullets, ordering, sparse page) → fix this
     resume: reselect/reorder, re-render, re-judge.
   - *pool gap* (the JD needs a capability no pool bullet carries — the
     uncovered list from step 4 usually named it already) → **stop looping**.
     Reselecting cannot conjure material; three rounds against a gap just
     burn tokens and end in the same escalation. Tell the user which
     capability is missing and which repo or experience would evidence it,
     and send that one through Module 1.
   - *generation-rule problem* (a whole class of resumes would fail the same
     way: missing project links, unevidenced skills, no demo URLs) → sediment
     a rule change into Module 1's prompts (experience / profile SKILL.md)
     with the user's sign-off, then regenerate downstream. Judge findings are
     how the generation prompts iterate — never edit the judge to make a
     finding go away.

   Classify BEFORE spending round 2. A fix that reappears unchanged after a
   reselection is a gap or a rule problem, not a selection problem.

   Already-sedimented examples: full page ⇒ select more bullets (never
   inflate text); projects are born with repo/demo links.

6. **Render and inspect**:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" render --id <job-id>
   ```

   Rendering requires `latexmk`, `pdflatex`, or `tectonic` and enforces the
   one-page gate when `pdfinfo` is available. If `pdftoppm` is available, render
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
   only when every campaign job is approved. In auto mode the state machine
   performs the same export automatically when the final job completes. The
   equivalent CLI is:

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

- `profile.json` remains curated user truth. Tier 0 experience tags and per-JD
  matches are separate, reviewable data.
- Only the `experience` skill may scan GitHub. Campaign work is a local index
  read, no matter how many jobs are matched.
- Re-running is idempotent by job URL. Do not rebuild approved jobs unless the
  user explicitly reopens them.
- A campaign approval approves only the resume package, never the irreversible
  application submit.
- Resume review may be automatic; final application submission may not.
- Report blockers per job; one blocked listing must not prevent other resumes
  from reaching Review.
