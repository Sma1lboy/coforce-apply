---
name: experience
description: Turn the user's real repository work into verified resume material (Module 1) — maintain and refresh the Tier 0 experience index (accept a pasted GitHub repository, PR, or commit URL, infer the repo and whose work counts, fetch only those authors' history on explicit refresh, build a compact tagged index for local JD matching), and generate JD-free STAR bullets from a repo's real commits for the user to review into profile.json. Use for "/experience <github-url>", "/experience refresh", "构建经历标签", "更新 GitHub 经历", "把这个 repo 写成简历上的项目", "generate bullets for X", or when the user sends a GitHub URL or a local repo path as experience evidence.
---

# Experience — Tier 0 source of truth

Tier 0 is the **only** CoForce layer allowed to scan GitHub. It runs once during
setup and again only when the user explicitly asks to refresh. `/start`,
`/campaign`, and per-JD matching must never call GitHub or refresh this index.

> **Position in the two-module design:** the evidence this skill collects is
> **Module-1 raw material** — context for generating truthful bullets
> (see "Repo → STAR bullets" below) that the user then reviews into profile.json. The
> tagged index is no longer on the campaign matching path: Module 2 selects
> from the profile's verified bullet pool directly (`campaign.mjs pool`).

All output stays under `~/.coforce/experience/`:

```text
experience/
├── sources.json
├── github-evidence/
│   ├── raw/
│   └── library/
├── experience-index.json
└── manifest.json
```

## Commands

The CLI lives at `scripts/experience.mjs` relative to this skill.

### Add a source from a URL — normal user flow

When the user sends a GitHub repository, PR, or commit URL, process it directly.
Do not ask the user to fill in `repo`, `author`, or edit `sources.json`.

```sh
node "<experience-skill>/scripts/experience.mjs" source add "https://github.com/owner/repository"
node "<experience-skill>/scripts/experience.mjs" source add "https://github.com/owner/repository/pull/42"
node "<experience-skill>/scripts/experience.mjs" source add "https://github.com/owner/repository/commit/abc123"
```

Author inference is intentionally small and predictable:

- repository URL → the currently authenticated `gh` user;
- pull-request URL → that PR's author;
- commit URL → the linked GitHub commit author, falling back to the authenticated
  `gh` user when GitHub has no linked account.

After adding, tell the user the inferred `owner/repo ← author` mapping. Ask for
a correction only if that inference is wrong. An explicit override is available
for the agent or advanced use, and does not call GitHub:

```sh
node "<experience-skill>/scripts/experience.mjs" source add "<github-url>" \
  --author github-login \
  --author alternate-login \
  --project "Product name" \
  --tag domain:developer-tools
```

`source add` performs at most the lightweight metadata lookup needed to infer
one author. It does not enumerate commits or PR history. The internal maintenance
commands are:

```sh

node "<experience-skill>/scripts/experience.mjs" source list
node "<experience-skill>/scripts/experience.mjs" source remove "<github-url>"
```

The agent owns `sources.json`; treat it as internal state unless the user asks
to inspect or debug it. It remains deliberately small:

```json
{
  "repositories": [
    {
      "repo": "owner/repository",
      "authors": ["github-login"],
      "project": "Product name",
      "tags": ["domain:developer-tools"]
    }
  ]
}
```

Do not import old auto-discovered `github-sources.json` files automatically;
that would silently restore repositories the user did not provide.

### First build or explicit full refresh

```sh
node "<experience-skill>/scripts/experience.mjs" refresh
```

This is the only command that enumerates GitHub history. It:

1. Validates `sources.json`; a missing or empty allowlist stops the refresh.
2. Fetches PR/commit history only from those repositories and only for each
   repository's declared `authors`, through authenticated `gh`.
3. Merges those source-linked entries with curated
   `~/.coforce/profile.json` skills, experience, and projects.
4. Atomically writes a compact `experience-index.json` with stable evidence
   IDs, author, matching text/tags, one source URL, counts, and a fingerprint.

Private evidence stays local; the underlying writer guard still requires
explicit permission before private material can be sent to an external writer.

### Rebuild tags after editing profile — zero GitHub calls

```sh
node "<experience-skill>/scripts/experience.mjs" build
```

This recombines the already cached GitHub evidence with the latest profile. Use
it after profile edits; it never invokes `gh`.

### Read-only status

```sh
node "<experience-skill>/scripts/experience.mjs" status
```

Statuses:

- `missing`: run `refresh` once.
- `ready`: all JD campaigns may match locally.
- `profile_changed`: run `build`; no GitHub scan is needed.
- `evidence_changed`: cached evidence changed; run `build`, without a scan.
- `sources_changed`: repo/author allowlist changed; run `refresh` explicitly.
- `invalid`: repair or explicitly refresh Tier 0.

## Repo → STAR bullets (Module 1 generation)

The index above is *evidence*. This is how that evidence becomes resume lines
the user can approve into the pool. Input: a git repository — local path or
GitHub URL. Output: 3–6 bullets grounded in commits, diffs and code, never in
the README's marketing copy.

1. **Locate**: local path → use directly. GitHub URL → clone shallowly into
   the scratchpad (`git clone --depth 50`).
2. **Scope to the user**: `git log --author=<user> --stat` (author name from
   `git config user.name`/`user.email`, or ask). If the user authored the whole
   repo, the scope is the whole repo.
3. **Evidence pass**: from their commits and the key source files, identify
   3–6 concrete contributions — architecture decisions, features, performance
   or reliability work, tooling. Note tech stack and scale signals (LOC, users,
   throughput, CI time) only where actually observable.
4. **Write bullets**, each STAR-compressed into one line:
   - Action verb + the concrete thing built + how (tech) + outcome.
   - Metrics come from evidence or from the user — ask once for numbers
     (users, %, latency); with none, write a qualitative outcome rather than
     inventing one.
   - ≤ ~28 words per bullet.
5. **Merge on confirmation**: append to `~/.coforce/profile.json` `projects[]`
   as `{name, url, description: [{text, source, verifiedAt}...], technologies,
   dateRange}` (dateRange from first/last commit dates). Schema rules live in
   the `profile` skill.

Rules: no fabricated metrics, users, or impact. Bullets describe what the USER
did, not what the project is.

### The five generation invariants

1. **Generate JD-free.** Bullets are written from the FULL repo context, never
   from a job description. A JD is one employer's lens, not a standard;
   generating against it biases and narrows the bullet. Give the model
   everything and write the best truthful version of what was actually done.
2. **The user is the gate.** Nothing enters `profile.json` without the user
   approving it. On merge, stamp each bullet with `source` (the repo/PR URL it
   came from) and `verifiedAt` (ISO date of the approval).
3. **Born with an intro bullet.** Every project entry's bullet set must include
   one bullet establishing what the project IS: its type, what it does, its
   scale ("Developed a microservice-based platform for sharing 50,000+
   songs…"). Detail bullets are meaningless to a reader who doesn't know what
   the thing is, and the selection layer must lead with this bullet whenever
   the entry appears.
4. **Born with links.** Record the repo URL as the entry's `url` (and a live
   deployment as `demo`). Screeners hard-deduct unlinked projects; capturing
   the link is generation work, not review patching.
5. **The profile is the verified pool.** `campaign` (Module 2, demand side) may
   only *select* from these bullets, verbatim, per JD. It can never write new
   ones. Rewording a bullet means coming back here, through the gate.

## Contract for downstream skills

- Input: `~/.coforce/experience/experience-index.json` only.
- Downstream skills may rank/rephrase evidence but cannot mutate or refresh
  Tier 0.
- Every GitHub-derived claim must cite an evidence ID from the index.
- `generatedAt` and `sourceFingerprint` must be copied into match artifacts so
  reviewers can tell exactly which Tier 0 snapshot produced a resume.
- A stale index is acceptable until the user explicitly refreshes it; silently
  rescanning is not.
