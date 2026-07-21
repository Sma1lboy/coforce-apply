# Migration: jd-resume-fitter → CoForce

Phase 4 of the [roadmap](ROADMAP.md). In-repo rebrand (name, logo, manifest,
README) is done. The two remaining steps touch GitHub / another repo, so they are
run by the owner, not automated:

## 1. Rename the GitHub repo ✅ (done 2026-07-20)

Repo is now `Sma1lboy/coforce-apply`; GitHub redirects the old
`jd-resume-fitter` URLs. Local remote already points at the new URL.

## 2. Merge into the CoForce repo (once it exists)

The CoForce repo does not exist locally or on GitHub yet. When it does, import
this repo with history preserved as a subdirectory:

```sh
cd /path/to/CoForce
git subtree add --prefix=apply https://github.com/Sma1lboy/coforce-apply.git main
```

After the subtree merge:

- Move the skill set into CoForce's own `.agents/skills/` (skills are
  discovered per-repo).
- Keep `profile/profile.json` gitignored in CoForce too.
- Archive the old repo (`gh repo archive Sma1lboy/coforce-apply`).
