---
name: setup
description: One-time onboarding for CoForce Apply — create ~/.coforce, build the user's profile, configure the runtime, build the Tier 0 experience index, set the LaTeX template, application consents, and job sources, write standing instructions, then show the console. Use for "帮我 set up", "初始化", "onboarding", "$setup" in Codex, "/setup" in Claude Code, or when any other skill finds ~/.coforce files missing.
---

# Setup — one-time onboarding

Everything lands in `~/.coforce/` (create it first: `mkdir -p ~/.coforce`).
Run stages in order, skip any that are already complete. Batch questions per
stage — don't drip.

## 1. Profile

`~/.coforce/profile.json` missing → run the `profile` skill's init (interview or
import an existing resume PDF/JSON).

## 2. Apply config → `~/.coforce/apply-config.json`

Set `agent` to the current runtime (`"codex"` when this skill is running in
Codex, `"claude"` in Claude Code). Then ask once: absolute path to the user's
LaTeX resume template (`latexTemplate`) · whether each generated resume must
wait for manual review (`requireResumeReview`, default `true`; `false` enables
automatic approval and ZIP export after successful rendering) · account
email (Gmail) for ATS registrations · `autoRegister` consent
· `mailboxAccess` (`browser`/`paste`) · resume PDF path · work authorization /
sponsorship · **`headlessApply` consent** — "may the console's Apply button run
the configured agent in the background and control your visible Chrome (fills
everything, always stops for your confirmation before submitting)?" This is
what makes one-click Apply work; it runs the configured agent non-interactively
with broad local access (`codex exec`, where `$apply` initializes Chrome
internally, or `claude --chrome -p`), so
it needs an explicit yes. Keep the `headlessApply` property name for existing
configs. Make clear that `requireResumeReview: false` never removes the final
application-submit confirmation. Seed job sources with the
defaults (user can add/remove):

```json
"sources": [
  { "name": "2027-SWE-College-Jobs",
    "url": "https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md" },
  { "name": "Summer2027-Internships",
    "url": "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/main/README.md" },
  { "name": "jobright-SWE-Internship",
    "url": "https://raw.githubusercontent.com/jobright-ai/2026-Software-Engineer-Internship/master/README.md" }
]
```

jobright-ai has one repo per track (2026-Software-Engineer-Internship,
2026-Engineer-Internship, 2026-Product-Management-New-Grad, Daily-H1B-Jobs-In-
Tech…) — swap/add the ones matching the user's target roles.

## 3. Tier 0 experience index

Ask the user to paste the GitHub repository, PR, or commit URLs that represent
their experience. Pass each URL to `$experience`; the experience agent infers
the repository and author and updates its internal source state. Summarize the
inferred mappings as `owner/repo ← author` and ask for correction only when one
is wrong—do not ask the user to maintain `sources.json` or provide author fields
up front. Then run `$experience refresh` once. It reads only those accepted
sources, combines source-backed commits/PRs with `profile.json`, and writes the
compact tagged index. Future job campaigns read it without network access;
profile-only edits use `$experience build`.

## 4. Standing instructions → `~/.coforce/instructions.md`

The user's will, injected into every skill run. Ask for: companies to NEVER
apply to, location/role preferences, anything else they want respected. Write:

```md
# My Application Instructions

<freeform preferences: roles, locations, salary floor, tone…>

## never-apply

- <Company A>
- <Company B>
```

`## never-apply` must keep this exact structure — the start skill's
`hunt.mjs` parses it mechanically; the rest is freeform for skills to read.

## 5. Done — show, don't tell

Serve and open the console per the `tracker` skill — the Profile tab should
now show the freshly built profile as a resume preview, Instructions the rules
just written. Explain the operating loop:
In Codex, `$experience` owns experience refresh/tagging, `$start` runs discovery through resume review, and `$campaign`,
`$tailor`, `$apply`, and `$tracker` work
standalone; use Codex scheduled tasks when recurring execution is available.
In Claude Code, the equivalent commands are `/experience`, `/start`, `/campaign`, `/tailor`,
`/apply`, and `/tracker`, with `/loop 30m /start` for a session loop.
