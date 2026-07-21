---
name: harness
description: End-to-end mock-environment test of the whole pipeline — fixture profile + mock JD → tailored resume, then the two-tier apply check (tier-1 autofill assertions + tier-2 fallback trigger) against the mock ATS form. Use for "跑一遍 harness", "端到端测试", "run the e2e harness", or after changing autofill logic, the profile schema, or the tailor flow.
---

# Harness — mock E2E

**Repo-development skill** — it needs the coforce-apply repo checkout
(`harness/` fixtures, `yarn`), so installers skip it; end users don't need it.

Everything runs against fixtures; the user's real `~/.coforce/profile.json` is
never touched. Mock environment lives in `harness/`:

- `harness/fixtures/profile.json` — John Doe fixture (schema: `src/types.ts`)
- `harness/fixtures/reference.docx` — reference resume for the docx path
- `harness/fixtures/applications.json` — tracker fixture (5 apps across statuses)
- `harness/mock/jd.html` — mock job posting (Nimbus Analytics, Senior Full-Stack)
- `harness/mock/apply-form.html` — mock ATS application form (Greenhouse-style)
- `harness/check-autofill.mjs` / `check-formats.sh` / `check-board.mjs` —
  deterministic checks (all three run via `yarn harness`)
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

**2. Deterministic checks (apply two-tier + formats + tracker board).**
```sh
yarn harness
```
Asserts: tier-1 fills 8/9 mock-form fields with exact fixture values and leaves
the screening question alone; that exact condition triggers the tier-2
`claude "/apply <url>"` fallback; docx reference extraction and md→docx
round-trip work; the board generator renders all 7 status columns and fixture
cards from `harness/fixtures/applications.json`. Exit code 0 = pass.

**3. Extension build still green.**
```sh
yarn build:chrome
```

## Report

One line per stage (pass/fail + evidence path), then overall verdict. On any
failure: stop, diagnose root cause before touching the mock to make it pass —
the mock is the spec, the code is the suspect.
