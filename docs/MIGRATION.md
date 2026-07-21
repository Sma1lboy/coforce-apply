# Migration: jd-resume-fitter → CoForce

Phase 4 of the [roadmap](ROADMAP.md). In-repo rebrand (name, logo, manifest,
README) is done. The two remaining steps touch GitHub / another repo, so they are
run by the owner, not automated:

## 1. Rename the GitHub repo

```sh
gh repo rename coforce-apply --repo Sma1lboy/jd-resume-fitter
```

GitHub redirects the old URL. Then update the local remote:

```sh
git remote set-url origin https://github.com/Sma1lboy/coforce-apply.git
```

## 2. Merge into the CoForce repo (once it exists)

The CoForce repo does not exist locally or on GitHub yet. When it does, import
this repo with history preserved as a subdirectory:

```sh
cd /path/to/CoForce
git subtree add --prefix=apply https://github.com/Sma1lboy/coforce-apply.git main
```

After the subtree merge:

- Move `.claude/skills/*` into CoForce's own `.claude/skills/` (skills are
  discovered per-repo).
- Keep `profile/profile.json` gitignored in CoForce too.
- Archive the old repo (`gh repo archive Sma1lboy/coforce-apply`).
