---
name: setup
description: One-time onboarding for CoForce Apply — choose the data home (local-only ~/.coforce or private-fork in-repo sync), build the user's profile, collect job-search preferences up front (level, directions, sponsorship/H1B, work mode/days, locations, salary floor → canonical preferences.json), configure the runtime, build the verified bullet pool (evidence + JD-free bullets reviewed into the profile), set the LaTeX template, application consents, and job sources, write standing instructions, then show the console. Use for "帮我 set up", "初始化", "onboarding", "$setup" in Codex, "/setup" in Claude Code, or when any other skill finds ~/.coforce files missing.
---

# Setup — one-time onboarding

Everything lands in the CoForce data home — `~/.coforce/` by default (create
it first: `mkdir -p ~/.coforce`). Run stages in order, skip any that are
already complete. Batch questions per stage — don't drip.

## 0. Data home — local-only or private-fork sync

Wherever this skill (or any skill) says `~/.coforce`, the actual home is
resolved as: `$COFORCE_HOME` env override → `<checkout>/.coforce/` if it
exists → `~/.coforce`. Two supported modes; ask which the user wants (default
local-only):

- **Local-only** (default): `~/.coforce/` on this machine. Nothing to do.
- **Private-fork sync**: the user forked this repository, made the fork
  PRIVATE, and keeps their data inside the checkout at `.coforce/` — profile,
  tracker, instructions, and archives then sync across machines through their
  fork (`git pull` on the other machine), and `git pull upstream main` keeps
  the tool itself current.

Enabling private-fork mode has an IRON GATE — verify before creating anything:
1. `git remote get-url origin` must NOT be the canonical public repo
   (`Sma1lboy/coforce-apply`) — data in a clone of the public repo can never
   be pushed anywhere safe.
2. `gh repo view --json isPrivate -q .isPrivate` must print `true`. If `gh`
   is unavailable or there is no remote yet, STOP and make the user confirm
   explicitly that the remote is (or will be) private before continuing.
Refusal is the default: when in doubt, stay local-only.

Once verified: `mkdir -p .coforce` in the checkout, then append exactly this
block to the END of the repo's `.gitignore` (later patterns override the
public-checkout guard above them):

```
# coforce private-fork mode — fork verified private; data home syncs in-repo
!/.coforce/
/.coforce/out/
```

Tell the user what does NOT sync: `out/` (regenerable artifacts) and ATS
passwords (macOS Keychain only, never files — re-register or re-enter
credentials per machine). Committing and pushing the data home is the user's
normal git flow afterwards; skills never auto-push.

**Every question to the user goes through the AskUserQuestion tool** (Claude
Code) — one call per stage with the stage's questions batched, concrete
options where they exist (level, work mode, consents), free-text via "Other"
otherwise. Never ask as prose paragraphs when the tool is available; in
runtimes without it (codex, headless -p) fall back to a numbered question
list and WAIT for the reply.

## 1. Profile

`~/.coforce/profile.json` missing → run the `profile` skill's init (interview or
import an existing resume PDF/JSON).

## 2. Preferences → `~/.coforce/preferences.json`

The user's job-search intent, collected ONCE here, up front. This file is the
**canonical preference schema** — every downstream skill (start/discovery,
campaign matching, apply screening answers) reads it; the console's Discover
wizard and Settings tab only *edit* these values, they are not the collection
point. Ask in one batch and write:

```json
{
  "version": 1,
  "level": "internship | newgrad | any",
  "directions": ["frontend", "backend", "ml", "…"],
  "needsSponsorship": false,
  "workAuthorization": "e.g. F-1 OPT / citizen / H-1B transfer",
  "workMode": "remote | hybrid | onsite | any",
  "workDays": "optional free text, e.g. no weekends, 4-day week OK",
  "locations": ["Bay Area", "Remote US"],
  "salaryFloor": null
}
```

Omit what the user declines to answer; never invent values. `needsSponsorship`
and `workAuthorization` live HERE (not in apply-config — older installs may
still carry them there; skills fall back for compatibility). If
`needsSponsorship` is true, offer to add a sponsorship-focused job source
(e.g. jobright-ai `Daily-H1B-Jobs-In-Tech`) when seeding sources below.

## 3. Apply config → `~/.coforce/apply-config.json`

Runtime configuration and consents ONLY — user intent belongs in
`preferences.json` above. Set `agent` to the current runtime (`"codex"` when
this skill is running in Codex, `"claude"` in Claude Code).

LaTeX template — ask the user which they want:

1. **Their own template** → record the absolute path in `latexTemplate`.
2. **The bundled base template** (default when they have none) → copy
   `assets/resume_template.tex` from the `tailor` skill directory
   (Jake's-resume style: letterpaper 11pt, `\resumeSubheading` macros) to
   `~/.coforce/templates/resume_template.tex` and point `latexTemplate` at
   that copy. The copy belongs to the user — they may edit or replace it
   later; never modify the skill's bundled original.

Then ask once: whether
each generated resume must wait for manual review (`requireResumeReview`,
default `true`; `false` enables automatic approval and ZIP export after
successful rendering) · account email (Gmail) for ATS registrations
· `autoRegister` consent · `mailboxAccess` (`browser`/`paste`) · resume PDF
path · **`headlessApply` consent** — "may the console's Apply button run
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

## 4. Verified bullet pool (Module 1)

The campaign selects resume lines ONLY from bullets the user has reviewed into
`profile.json` — so build that pool now. Ask the user to paste the GitHub
repository/PR/commit URLs that represent their experience. Feed each to
`$experience` (evidence collection) and `$repo-bullets` (full-context, JD-free
bullet generation), then walk the user through approving the generated bullets
into the profile — each approved bullet stamped with `source` and `verifiedAt`.
A profile imported from an existing resume already counts as reviewed. If the
user skips this stage, campaigns will stop at `campaign.mjs pool` and send
them back here.

## 5. Standing instructions → `~/.coforce/instructions.md`

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

## 6. Done — show, don't tell

Serve and open the console per the `tracker` skill — the Profile tab should
now show the freshly built profile as a resume preview, Instructions the rules
just written. Explain the operating loop:
In Codex, `$experience` owns experience refresh/tagging, `$start` runs discovery through resume review, and `$campaign`,
`$tailor`, `$apply`, and `$tracker` work
standalone; use Codex scheduled tasks when recurring execution is available.
In Claude Code, the equivalent commands are `/experience`, `/start`, `/campaign`, `/tailor`,
`/apply`, and `/tracker`, with `/loop 30m /start` for a session loop.
