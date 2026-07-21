---
name: start
description: Run one discover→resume-campaign cycle — fetch job sources, diff against the tracker, hydrate full JDs, match against the local Tier 0 experience index, render tailored PDFs, and refresh the Review console. Use for "开始", "跑一轮", "$start" in Codex, or "/start" in Claude Code; use the host's scheduled-task capability for recurring runs.
---

# Start — one discover→resume-review cycle

Setup must exist (`~/.coforce/apply-config.json`); missing → run the `setup`
skill first. **Read `~/.coforce/instructions.md` before anything else** — it
overrides every default below.

The console's **Discover** tab is the interactive twin of discovery: postings
queued there become pending tracker entries and campaign dossiers. Treat them as
first in line for resume generation.

## Cycle

1. **Discover** (the script ships with this skill, path relative to this
   skill's base directory):
   ```sh
   node "<skill-dir>/scripts/hunt.mjs" --track
   ```
   Fetches all configured sources, skips anything already tracked (URL or
   company+role match — never double-apply) and every `never-apply` company,
   tracks the rest as `pending` with a discovery history event. Report the
   summary (new / already-tracked / blocked).
2. **Filter for fit**: from the new `pending` entries, drop ones that clearly
   contradict `instructions.md` preferences (location, role type) — mark those
   `rejected` with a history note "filtered: <reason>" so they don't resurface.
3. **Build the resume campaign**: invoke the sibling `campaign` skill. Sync
   pending jobs, verify the existing Tier 0 experience index, fetch every full
   JD, create the grounded match report, fill the user's LaTeX template, compile
   and visually check the PDF. Process revision-requested jobs before new jobs.
   This cycle must never scan GitHub. If Tier 0 is missing, stop matching and
   direct the user to the separate `$experience refresh` command.
4. **Finish according to the review setting**: when
   `requireResumeReview !== false`, ensure the console is serving on 4517 and
   open `http://localhost:4517/#review`; report ready / needs Chrome / needs
   revision / approved counts. When it is `false`, successfully rendered jobs
   auto-approve and the last completed job refreshes the campaign ZIP; report
   the ZIP path without forcing Review open. Do not run the `apply` skill in
   this cycle. Final application submission is always a separate confirmation
   gate, regardless of the resume-review setting.

## Recurring

Offer recurring execution once. In Codex, use its scheduled-task capability if
available; otherwise tell the user to run `$start` again. In Claude Code, offer
`/loop 30m /start`. Respect a `cadence` note in instructions.md if present.

## Rules

- `instructions.md` is standing user instruction — when it conflicts with
  anything here, instructions.md wins.
- Never create duplicate campaign jobs for the same posting or company+role;
  when unsure whether an entry is the same job, skip and note it.
- A cycle with no new jobs and no pending revision work ends silently fast — no
  busywork.
