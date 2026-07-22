---
name: campaign
description: Build and review a batch of job-specific resumes — sync discovered jobs, fetch full JDs, match them against the local Tier 0 experience index, render the user's LaTeX template to PDF, collect feedback/approval in the CoForce Review console, and export approved job folders as one ZIP. Use for "$campaign", "批量岗位匹配", "生成岗位简历", "review resumes", or when start finds queued/revision-requested campaign jobs.
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

Require these values in `~/.coforce/apply-config.json`:

- `latexTemplate`: absolute path to the user's `.tex` template. Never modify the
  template in place.
- `requireResumeReview`: optional boolean, defaulting to `true`. When `false`,
  a complete successfully rendered resume is automatically approved and the
  ZIP is refreshed after the full batch completes.

Require `~/.coforce/experience/experience-index.json`, produced by the sibling
`experience` skill. If it is missing, stop and tell the user to run
`$experience refresh` (Codex) or `/experience refresh` (Claude Code). A campaign
must never discover repositories, invoke `gh`, refresh evidence, or silently
replace a stale index. Profile-only changes use `$experience build`, which is
network-free.

## Cycle

1. **Sync tracked jobs into the campaign**:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" sync
   node "<campaign-skill>/scripts/campaign.mjs" show
   ```

   Work on `queued`, `needs_browser_jd`, `jd_ready`, `matched`, `render_failed`,
   and `revision_requested` jobs. Existing approved jobs are left alone; reuse
   any valid artifacts already present instead of starting over.

2. **Verify Tier 0 is readable** without refreshing it:

   ```sh
   node "<experience-skill>/scripts/experience.mjs" status
   ```

   `ready` continues. `profile_changed` or `evidence_changed` requires the
   network-free `$experience build`. `sources_changed` or `missing` requires
   the explicit, separate `$experience refresh` action.

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

4. **Build a deterministic evidence shortlist from Tier 0 only**:

   ```sh
   node "<campaign-skill>/scripts/campaign.mjs" match --id <job-id>
   ```

   This reads only `~/.coforce/experience/experience-index.json` and writes
   `match-report.md` plus machine-readable `match.json`. Both preserve the Tier
   0 generation timestamp and source fingerprint. Treat the numeric score as
   keyword coverage, not a hiring probability.

   Alongside the score, check the JD against `~/.coforce/preferences.json`
   (canonical user intent — `needsSponsorship`, `workMode`, `locations`,
   `salaryFloor`; schema in the setup skill): a posting that violates a hard
   preference (e.g. "no sponsorship" while `needsSponsorship` is true, or
   onsite-only against `workMode: remote`) gets flagged in `match-report.md`
   so the user sees the conflict at review time instead of after applying.

5. **Write the job-specific resume**. Read the JD, match report, curated
   `~/.coforce/profile.json`, the cited evidence records, and the user's
   template. Copy the template into the job folder as `resume.tex`; preserve its
   packages, macros, typography, spacing, and section order. Tailor by selecting,
   reordering, and evidence-bounded rewriting. Never invent metrics, outcomes,
   ownership, dates, employers, or technologies. Every GitHub-derived claim
   must be traceable to an evidence ID included in the match report.

   For a revision-requested job, read every open feedback item first and
   regenerate the existing `resume.tex`; do not create parallel drafts.

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
   Feedback changes the job to `revision_requested`; the next `$start` or
   `$campaign` cycle consumes it. With the setting off, Review remains available
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
