---
name: experience
description: Maintain and refresh the Tier 0 experience index for CoForce Apply — accept a pasted GitHub repository, PR, or commit URL, infer the repository and whose work should count, fetch only those authors' commits and PRs on explicit refresh, and build a compact tagged index for local JD matching. Use for "$experience <github-url>", "$experience refresh", "构建经历标签", "更新 GitHub 经历", or when the user sends a GitHub URL as experience evidence.
---

# Experience — Tier 0 source of truth

Tier 0 is the **only** CoForce layer allowed to scan GitHub. It runs once during
setup and again only when the user explicitly asks to refresh. `$start`,
`$campaign`, and per-JD matching must never call GitHub or refresh this index.

> **Position in the two-module design:** the evidence this skill collects is
> **Module-1 raw material** — context for generating truthful bullets
> (repo-bullets skill) that the user then reviews into profile.json. The
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

## Contract for downstream skills

- Input: `~/.coforce/experience/experience-index.json` only.
- Tier 1 may rank/rephrase evidence but cannot mutate or refresh Tier 0.
- Every GitHub-derived claim must cite an evidence ID from the index.
- `generatedAt` and `sourceFingerprint` must be copied into match artifacts so
  reviewers can tell exactly which Tier 0 snapshot produced a resume.
- A stale index is acceptable until the user explicitly refreshes it; silently
  rescanning is not.
