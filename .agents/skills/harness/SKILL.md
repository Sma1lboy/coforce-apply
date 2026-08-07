---
name: harness
description: End-to-end mock-environment test of the whole pipeline — fixture profile + mock JD → tailored resume, then the deterministic checks (formats, evidence, experience, campaign, board + apply lifecycle, hunt). Use for "跑一遍 harness", "端到端测试", "run the e2e harness", or after changing the apply lifecycle, the profile schema, or the tailor flow.
---

# Harness — mock E2E

**Repo-development skill** — it needs the coforce-apply repo checkout
(`harness/` fixtures), so installers skip it; end users don't need it.

Everything runs against fixtures; the user's real `~/.coforce/profile.json` is
never touched. Mock environment lives in `harness/`:

- `harness/fixtures/profile.json` — John Doe fixture (schema: `profile` skill)
- `harness/fixtures/reference.docx` — reference resume for the docx path
- `harness/fixtures/applications.json` — tracker fixture (5 apps across statuses)
- `harness/fixtures/agent-stub.sh` — stand-in for the Claude Code CLI
  (`COFORCE_CLAUDE_BIN`), so apply/import flows run without a real agent
- `harness/mock/jd.html` — mock job posting (Nimbus Analytics, Senior Full-Stack)
- `harness/check-formats.sh` / `check-github-evidence.py` /
  `check-config.mjs` / `check-experience.mjs` / `check-campaign.mjs` /
  `check-board.mjs` / `check-hunt.mjs` — deterministic checks (all seven run
  in order via `npm run harness`; the repo has no npm dependencies, so a bare
  checkout can run them)
- `harness/out/` — run artifacts (gitignored)

## Stages (run all, report per-stage pass/fail)

**1. Resume generation (the "出简历" leg).**
Run the `tailor` skill's steps with `harness/fixtures/profile.json` as the
profile and `harness/mock/jd.html` as the JD, writing to
`harness/out/resume-nimbus-analytics-senior-full-stack.tex`. Then verify, by
reading the output: it is valid-looking LaTeX (`\documentclass` …
`\end{document}`), contains the fixture's name and email, and leads with
JD-relevant skills (TypeScript/React/Node.js/AWS/Kubernetes appear before
unrelated ones). Fail the stage if any check misses.

Also exercise the alternate output/reference paths: regenerate the docx leg
(markdown intermediate → `pandoc` → `.docx` in `harness/out/`) and read
`harness/fixtures/reference.docx` back as a reference (mimic check: extraction
succeeds and output honors its section order).

**2. Deterministic checks (formats, evidence, config, experience, campaign, board, hunt).**
```sh
npm run harness
```
Asserts: docx reference extraction and md→docx round-trip work; the vendored
GitHub evidence layer holds its attribution/pagination/writer guardrails and
the experience index rebuilds offline; config.json migrates off the legacy
settings pair without losing keys and refuses to overwrite a corrupt file;
the campaign pipeline selects verbatim pool bullets and exports the approved
ZIP; when Tectonic is present (always in CI), it also assembles and compiles one
English and one Chinese resume through the real LaTeX→PDF→`pdftotext` path,
requiring localized contacts, complete selected bullets/skills, and ATS reading
order; the board generator renders all 5 status columns and fixture cards from
`harness/fixtures/applications.json`, rejects a never-apply company at
`/api/queue`,
and the console's Chrome-backed apply lifecycle runs consent gate → fill
(`READY_TO_SUBMIT`) → confirm → `SUBMITTED` against the agent stub; hunt
parses, dedups against the tracker, and honors the never-apply list.
Exit code 0 = pass.

## Report

One line per stage (pass/fail + evidence path), then overall verdict. On any
failure: stop, diagnose root cause before touching the mock to make it pass —
the mock is the spec, the code is the suspect.

## Sandbox & setup recording

- `npm run sandbox` — seed a throwaway data home (`harness/out/sandbox/coforce`,
  fixture persona, canonical preferences) and serve the real console on
  http://127.0.0.1:4519. No real user data involved.
- `npm run record:setup` — kobe-quicklook-style recording harness: a scripted
  driver runs the REAL pipeline (hunt → sync → pool → select → judge, plus a
  live out-of-pool rejection) in a fresh sandbox, snapshots the terminal as
  timestamped text frames, and asserts sandbox state after every step — the
  capture is the verification. Outputs `frames.json` (kobe-compatible),
  `replay.html` (self-contained animated replay), and `setup-demo.mp4`
  (qlmanage + ffmpeg, macOS; skipped gracefully elsewhere). Zero npm deps.
- `npm run record:session` — drive a REAL `claude -p` session through /setup in
  a sandbox (session-id + resume, stream-json capture): every agent question,
  tool call and reply lands in `transcript.md/html/json` under
  `harness/out/session-recording/` — the instrument for tuning the skill's
  interaction design. Scripted user answers live at the top of the file; edit
  them to probe different conversation branches. Non-deterministic, opt-in.

## Skill stories

Recording a skill's conversation as a shareable, re-renderable artifact lives
in its own repo now: [Sma1lboy/skill-story](https://github.com/Sma1lboy/skill-story).
The two recorders above stay here as the in-repo tuning loop.
