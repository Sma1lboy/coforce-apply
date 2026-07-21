---
name: setup
description: One-time onboarding for CoForce Apply — create ~/.coforce, build the user's profile, apply-config (email, consents, resume, job sources), and instructions.md (standing preferences incl. the never-apply list), then show the board. Use for "帮我 set up", "初始化", "onboarding", "/setup", or when any other skill finds ~/.coforce files missing.
---

# Setup — one-time onboarding

Everything lands in `~/.coforce/` (create it first: `mkdir -p ~/.coforce`).
Run stages in order, skip any that are already complete. Batch questions per
stage — don't drip.

## 1. Profile

`~/.coforce/profile.json` missing → run the `profile` skill's init (interview or
import an existing resume PDF/JSON).

## 2. Apply config → `~/.coforce/apply-config.json`

Ask once: account email (Gmail) for ATS registrations · `autoRegister` consent
· `mailboxAccess` (`browser`/`paste`) · resume PDF path · work authorization /
sponsorship · **`headlessApply` consent** — "may the console's Apply button run
Claude headlessly on your machine (fills everything, always stops for your
confirmation before submitting)?" This is what makes one-click Apply work; it
runs `claude -p --dangerously-skip-permissions` locally, so it needs an
explicit yes. Seed job sources with the defaults (user can add/remove):

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
```json
```

## 3. Standing instructions → `~/.coforce/instructions.md`

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

## 4. Done — show, don't tell

Serve and open the console per the `tracker` skill — the Profile tab should
now show the freshly built profile as a resume preview, Instructions the rules
just written. Explain the loop: `/start` runs one discover→apply cycle;
`/loop 30m /start` keeps it running; individual skills (`/tailor`, `/apply`,
`/tracker`) work standalone too.
