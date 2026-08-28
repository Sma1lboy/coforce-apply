# Privacy

CoForce Apply is a local tool, not a service. There is no CoForce server, no
account, and no telemetry. Nothing in this repository transmits your data
anywhere.

## Where your data lives

Everything personal sits in the data home on your own machine — `~/.coforce/`
by default, or `<checkout>/.coforce/` in private-fork mode, or wherever
`$COFORCE_HOME` points:

- `profile.json` — your background, the verified bullet pool
- `config.json`, `instructions.md` — your intent, standing rules, and consents
- `applications.json` + `applications/<id>/` — the tracker and per-application
  archives
- `out/` — generated resumes, ZIPs, and apply-run logs

The complete file-by-file table, and what is safe to delete, is in
[docs/DATA.md](docs/DATA.md).

ATS account passwords are generated locally and stored in the macOS Keychain,
never in a file. `accounts.json` holds metadata only (host, email, Keychain
service name).

In private-fork mode the data home is committed to **your own private fork**.
Never enable it on a public checkout; setup verifies the fork is private
before offering it.

## What leaves your machine

Three things, all of them at your direction:

1. **Your agent runtime.** CoForce runs inside Claude Code, so the parts of
   your profile, job descriptions, and files the agent reads become prompt
   context sent to Anthropic under [Anthropic's own
   terms](https://www.anthropic.com/legal/privacy). This is the same exposure
   as using Claude Code on any file — CoForce adds no separate transmission.
2. **Job sources.** Discovery fetches public job lists (GitHub repositories,
   job boards) and job description pages. Those sites see an ordinary request.
   The explicit Tier 0 refresh calls the GitHub API with your `gh` credentials
   to read your own commits and PRs.
3. **The applications you approve.** `/apply` fills a form in your own visible,
   logged-in Chrome and stops before the final submit. Nothing is submitted
   without your explicit confirmation for that specific application.

The console (http://localhost:4517) binds to localhost and serves only your
own data home.

## Deleting your data

Delete the data home. There is nowhere else to look, and nothing to request
from anyone.

## Changes

This file is versioned in the repository; its history is the change log.
Questions: open an issue.
