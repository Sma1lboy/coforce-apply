# The Operator Contract

The **operator** is the replaceable module that performs "the hands-on work"
of a job application: fill the form, upload the resume, answer screening
questions, press submit. Everything above it (skills, console, tracker) is
written against THIS contract — not against any particular operator — so
operators can be swapped or stacked by cost without touching the rest of the
system.

## The shipped operator

One: **agent browser-use** — `claude --chrome`, driven by the `apply` skill in
the user's own visible, logged-in Chrome.

A scripted form-filler used to sit below it as a free "tier 1"; it was deleted
(see git history) because the agent handles the same pages and the second
implementation cost more to maintain than the LLM calls it saved. The contract
below is what a cheaper operator would have to satisfy to slot back in — the
skills and console are written against it, not against the agent.

`needsFallback` on a tracker entry means *"the operator gave up; a human has to
take this one"*. It is a hand-back, not a retry ladder.

## Inputs

Every operator receives the same four inputs, all from the data layer:

1. **Job** — the posting URL (and any captured JD text).
2. **Profile** — `~/.coforce/profile.json` (identity, experience; schema in
   the profile skill).
3. **Resume** — the campaign's per-job `resume.pdf` when the job came through a
   campaign; otherwise `resumePdf` from config.json.
4. **Intent** — `~/.coforce/config.json` (sponsorship/work authorization,
   work mode, locations; schema in the setup skill) plus a summary of
   `~/.coforce/instructions.md`, which overrides everything.

## Events

Operators report progress as `COFORCE_STATUS` sentinels on stdout — one per
line, uppercase, exactly:

- `COFORCE_STATUS: READY_TO_SUBMIT` — everything is filled; stopped short of
  the final submit, awaiting the user's confirmation.
- `COFORCE_STATUS: SUBMITTED` — the submission is verifiably in (only after
  confirmation); the operator also records the tracker update.
- `COFORCE_STATUS: FAILED` — unrecoverable blocker (captcha, missing required
  info, dead endpoint), followed by the reason on the same line or the next.

Reserved for future use: `COFORCE_STATUS: NEEDS_INFO` — a structured request
for one missing answer, so a supervisor (or the user) can supply it and resume
the same session. Not yet emitted by any shipped operator.

The console's adapter (`tracker/scripts/agent-runner.mjs`) normalizes each
runtime's output into these marks; the job state machine consumes only marks.
Marks are judged **per run segment**: every spawn/resume starts a fresh
segment, so a retry is never judged by a previous run's sentinels.

## Iron laws

1. **Never cross the confirmation gate.** No operator, at any tier, submits an
   application without an explicit user confirmation for that submission.
   `requireResumeReview: false` and `headlessApply: true` never waive this.
2. **Never fabricate.** Screening answers (visa, sponsorship, years of
   experience) come from preferences/profile or stop the run — an unanswerable
   required question is `FAILED` (future: `NEEDS_INFO`), not a guess.
3. **`instructions.md` overrides everything**, including a job already queued:
   a never-apply company means stop and report, at every tier.
4. **All state lands in the data layer.** An operator's only output channels
   are the sentinel events and writes to `~/.coforce` (tracker entry, history
   event, logs) — no side channels.
