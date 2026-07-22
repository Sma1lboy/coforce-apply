---
name: repo-bullets
description: Read a git repository (local path or GitHub URL) and generate resume-ready STAR bullet points from the user's actual contributions, then optionally merge them into ~/.coforce/profile.json as a project entry. Use when the user wants resume bullets for a repo/project, e.g. "把这个 repo 写成简历上的项目", "generate bullets for X", or invokes "$repo-bullets" in Codex.
---

# Repo → STAR resume bullets

Turn real contributions in a repo into 3–6 resume bullet points, grounded in
evidence (commits, diffs, code) — never in the README's marketing copy alone.

## Steps

1. **Locate**: local path → use directly. GitHub URL → clone shallowly into the
   scratchpad (`git clone --depth 50`).
2. **Scope to the user**: `git log --author=<user> --stat` (get the author name
   from `git config user.name`/`user.email` or ask). If the user authored the
   whole repo, scope is the whole repo.
3. **Evidence pass**: from their commits and the key source files, identify
   3–6 concrete contributions — architecture decisions, features, performance
   or reliability work, tooling. Note tech stack and scale signals (LOC, users,
   throughput, CI time) only where actually observable.
4. **Write bullets**, each STAR-compressed into one line:
   - Start with a strong action verb, name the concrete thing built, end with a
     result. Format: *Action + what + how (tech) + outcome*.
   - Metrics must come from evidence or from the user — ask once for numbers
     (users, %, latency); if none, write a qualitative outcome instead of
     inventing one.
   - ≤ ~28 words per bullet.
5. **Merge (on confirmation)**: append to `~/.coforce/profile.json` `projects[]` as
   `{name, description: [{text}...], technologies, dateRange}` (dateRange from
   first/last commit dates). Follow the schema rules in the `profile` skill.

## Rules

- No fabricated metrics, users, or impact. Evidence or user-supplied only.
- Bullets describe what the user did, not what the project is.

## Module 1 of the two-module pipeline

This skill is the **supply side** of CoForce's two-module design:

1. **Generate (this skill)** — bullets are written from the FULL repo context,
   never from a job description. A JD is one employer's lens, not a standard;
   generating against it biases and narrows the bullet. Give the model
   everything and write the best truthful version of what was actually done.
2. **Review gate (the user)** — nothing enters `profile.json` without the
   user approving it. On merge, stamp each bullet with `source` (the repo/PR
   URL it came from) and `verifiedAt` (ISO date of the user's approval).
3. **The profile is the verified pool** — the campaign skill (Module 2,
   demand side) may only *select* from these bullets, verbatim, per JD. It can
   never write new ones. Rewording a bullet means coming back here through the
   review gate.
