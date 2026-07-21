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
sponsorship. Seed job sources with the defaults (user can add/remove):

```json
"sources": [
  { "name": "2027-SWE-College-Jobs",
    "url": "https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md" },
  { "name": "Summer2027-Internships",
    "url": "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/main/README.md" }
]
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

Serve and open the (empty) board per the `tracker` skill, and explain the
loop: `/start` runs one discover→apply cycle; `/loop 30m /start` keeps it
running; individual skills (`/tailor`, `/apply`, `/tracker`) work standalone
too.
