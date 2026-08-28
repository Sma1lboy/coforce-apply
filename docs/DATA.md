# Your data home

Everything CoForce Apply knows about you is in one directory. This is the
canonical list of what is in it, which skill owns each file, and which of them
are contracts versus regenerable caches.

Where it lives, resolved identically by every skill and script
(`.agents/lib/data-home.mjs`):

```
$COFORCE_HOME  →  <checkout>/.coforce/  (if that directory exists)  →  ~/.coforce
```

## Contract files

These carry a schema version and are the interface *between* skills. Each schema
is canonical in exactly one place — the owning skill's `SKILL.md` — and every
other skill programs against the schema, never against another skill's code.

| Path | Owner | What it is |
|---|---|---|
| `profile.json` | `profile` | Your background, and **the verified pool**: every bullet you have reviewed, with `source` and `verifiedAt` provenance. Also holds `resumeSkillPolicy` (baseline skills + role packs) and any `textZh` bilingual bullets. |
| `config.json` | `setup` | One flat object: job-search intent (level, directions, sponsorship, work mode, locations, salary floor), runtime config (LaTeX template, page-coverage minimum, resume PDF, job sources), and consents (`autoRegister`, `mailboxAccess`, `headlessApply`, `requireResumeReview`). Version 2; the older `preferences.json` + `apply-config.json` pair is migrated on first read. |
| `instructions.md` | you | Standing instructions in plain prose, including the `## never-apply` company list. Every skill and script reads this first and treats it as overriding metadata. |
| `applications.json` | `tracker` | Every tracked application: status (`pending` → `applied` → `interviewing` → `offer`/`rejected`), `needsFallback`, and a `history[]` of events. |
| `accounts.json` | `apply` | ATS accounts you registered — `{host, email, keychain, createdAt}` **metadata only**. Passwords are in the macOS Keychain, never here. |
| `campaigns/current/manifest.json` | `campaign` | The current batch: per job, the selected `evidenceIds`, skills, render state, review notes, and approval. |
| `experience/sources.json` | `experience` | The allowlist of GitHub repositories and the authors whose history counts. Nothing is scanned that is not listed here. |
| `experience/experience-index.json` | `experience` | The Tier 0 index — compact, tagged, source-backed — that JD matching reads locally. |

> [!IMPORTANT]
> **Bullet ids are content hashes** — `sha256(text)[:8]`, computed when a bullet
> is read and then persisted as `evidenceIds` in a campaign manifest. An id is
> stable only while the text is byte-identical, so never reformat, re-wrap,
> trim, or unicode-normalise `description[].text` in `profile.json`. Doing so
> silently detaches every already-matched job, which then reports its bullets as
> "outside the verified pool".

## Generated artifacts

| Path | Written by | Contents |
|---|---|---|
| `campaigns/current/jobs/<company-role>/` | `campaign` | `job.json`, `job-description.md`, `match.json`, `match-report.md`, `resume.tex`, `resume.pdf` — one folder per job in the batch. |
| `campaigns/current/exports/resume-applications.zip` | `campaign` | Every approved job folder, exported together. |
| `applications/<id>/` | `tracker`, `apply` | Per-application archive: the resume that was sent, screenshots, and anything else the run produced. |
| `templates/resume_template.tex` | `setup` | Your managed copy of the LaTeX template. Editing it changes every future render. |
| `out/` | `tailor` | One-off resumes from `/tailor` outside a campaign. Regenerable; never synced. |
| `experience/github-evidence/` | `experience` | Cached GitHub history, so `build` can rebuild the index offline. Regenerable with `/experience refresh`. |
| `experience/refs/<owner>/<repo>/` | `experience` | Local checkouts used to read real commits when drafting bullets. Regenerable. |
| `intake-judge.json` | `profile` | The quality read taken when a resume is first imported, so its findings route back to your profile rather than gating a render. |

## What is safe to delete

`out/`, `experience/github-evidence/`, `experience/refs/`, and
`campaigns/current/jobs/*/resume.pdf` are caches — deleting them costs a
re-render or a `/experience refresh`.

Everything in the contract table above is not: `profile.json` and
`instructions.md` in particular represent work you did by hand.

## What never leaves your machine

All of it. Job descriptions are fetched from public sources, applications go to
the ATS you chose, and that is the entire outbound surface. See
[PRIVACY.md](../PRIVACY.md).

In private-fork mode the data home lives inside your checkout at `.coforce/`
and syncs through **your private fork** — which is why `/setup` verifies the
fork is actually private before creating it.
