---
name: apply
description: Tier-2 fallback for job applications — given a job posting URL, complete and submit the application form via browser automation using the user's ~/.coforce/profile.json and resume PDF. Invoked as "/apply <url>", typically copied from the extension's "Claude fallback" button when scripted auto-fill failed or stalled.
---

# Apply — browser-use job application (Tier 2 fallback)

Input: a job posting / application URL (from args). This skill exists because
Tier 1 (the extension's scripted form-fill) failed on this page — expect a
non-trivial form: multi-step wizard, custom widgets, an ATS (Workday,
Greenhouse, Lever, Ashby…), or login walls.

## Setup (first run, answers persist in ~/.coforce/apply-config.json)

Before the first application, ask ONCE and save to `~/.coforce/apply-config.json`:

```json
{
  "email": "user@gmail.com",          // account email for ATS registrations
  "autoRegister": true,               // may I create ATS accounts for you?
  "mailboxAccess": "browser | paste", // how to fetch verification codes
  "resumePdf": "path/to/resume.pdf",
  "workAuthorization": "...", "needsSponsorship": false
}
```

Subsequent runs read this file and only ask about gaps.

## Preconditions

0. Read `~/.coforce/instructions.md` — standing user instructions (never-apply
   companies, preferences). It overrides everything below; a never-apply
   company means stop and tell the user, not apply anyway.
1. Read `~/.coforce/profile.json`. Missing → run the `profile` skill's init
   first; don't guess values.
2. Read `~/.coforce/apply-config.json`; missing → run Setup above. Batch any
   remaining per-job questions up front; don't drip.

## Flow

1. Open the URL with the available browser automation (prefer the `/browse`
   skill per workspace convention; visible browser if login is needed).
2. Navigate to the actual application form (click "Apply" through interstitials).
   **If the ATS demands an account (Workday, iCIMS, SuccessFactors…)** and
   `autoRegister` is true, register one — see Account registration below.
3. Fill every field mappable from the profile: contact info, links, education,
   experience. Upload the resume PDF where a file input exists.
4. Free-text questions ("why us", cover letter): draft 2–4 sentences from the
   profile tailored to the posting — factual, no invented experience. Show
   drafts to the user before submitting if they're required fields.
5. **Stop before the final submit** and show a summary of what was entered.
   Submit only after the user confirms. Submission is irreversible.
6. Report the outcome (confirmation page / email signal), record it in the
   local tracker (`~/.coforce/applications.json`, per the `tracker` skill — add or
   update the entry with the final status), then serve/refresh the board per
   the `tracker` skill and open it so the user sees the updated state without
   asking.

## Account registration (Workday & co.)

When the ATS requires an account and `autoRegister` is consented:

1. **Reuse first**: check `~/.coforce/accounts.json` for an existing account on
   this ATS domain (Workday tenants are per-company — match the full host,
   e.g. `acme.wd5.myworkdayjobs.com`).
2. **Register**: username/email = `email` from apply-config. Password:
   generate locally, never reuse across sites:
   ```sh
   PW="$(openssl rand -base64 15 | tr '+/' '-_')Aa1!"
   ```
3. **Store the password in macOS Keychain** (never in a plaintext file):
   ```sh
   security add-generic-password -s "coforce:<ats-host>" -a "<email>" -w "$PW"
   # retrieve later: security find-generic-password -s "coforce:<ats-host>" -w
   ```
   Append the metadata (NO password) to `~/.coforce/accounts.json`:
   `{"host", "email", "keychain": "coforce:<ats-host>", "createdAt"}`.
4. **Email verification**: per `mailboxAccess` —
   - `browser`: open the mailbox in the browser (user's logged-in session;
     `/browse` cookie import or a visible handoff), find the newest mail from
     the ATS, read the code/link, continue.
   - `paste`: ask the user to paste the code, then continue.
5. Record `"registered <ats-host> account"` in the application's tracker
   history. On later applications to the same tenant, log in with the stored
   credentials instead of re-registering.

## Headless protocol (spawned by the console, no interactive user)

The console's Apply button spawns this skill via `claude -p` with a fixed
`--session-id` when the user granted the standing `headlessApply` consent in
apply-config.json. In that mode:

1. Run the normal flow (profile, instructions, registration, filling,
   uploads) without asking questions — use apply-config answers; anything
   unanswerable is a blocker.
2. **Never submit in the first run.** When everything is filled, print exactly
   `COFORCE_STATUS: READY_TO_SUBMIT` plus a short summary of what was entered
   (fields, resume used, screening answers). The console shows this to the
   user with a Confirm button.
3. On an unrecoverable blocker (captcha, login wall needing the user, missing
   required data), print `COFORCE_STATUS: FAILED` plus the reason, and record
   `needsFallback` + a history event in the tracker.
4. The user's confirmation resumes THIS session (`claude -p --resume`) with a
   submit instruction: submit, verify (confirmation page/email), print
   `COFORCE_STATUS: SUBMITTED`, and update `~/.coforce/applications.json`
   (status `applied` + history event). If submission fails, print
   `COFORCE_STATUS: FAILED` with the reason.

The sentinels must be printed verbatim on their own line — the console parses
them mechanically.

## Rules

- Never fabricate answers to screening questions (visa, years of experience,
  salary). Unknown → ask.
- Stuck twice on the same widget → tell the user what's blocking instead of
  looping.
- Account creation requires the standing `autoRegister` consent (or a per-run
  yes); accepting non-obvious terms (background checks, data sharing beyond
  the application) still needs an explicit ask.
- Passwords live only in Keychain; never print them into the conversation,
  files, or logs. `~/.coforce/accounts.json` holds metadata only.
- In the mailbox, open ONLY the verification email for the ATS at hand —
  never read, summarize, or act on anything else in the inbox.
