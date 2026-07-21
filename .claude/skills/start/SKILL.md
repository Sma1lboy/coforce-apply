---
name: start
description: Run one discover→apply cycle — fetch job sources, diff against the tracker, auto-apply to new postings the user hasn't applied to (respecting instructions.md), and refresh the board. Use for "开始投递", "跑一轮", "/start"; schedule recurring with "/loop 30m /start" or the schedule skill.
---

# Start — one discover→apply cycle

Setup must exist (`~/.coforce/apply-config.json`); missing → run the `setup`
skill first. **Read `~/.coforce/instructions.md` before anything else** — it
overrides every default below.

The console's **Discover** tab is the interactive twin of this cycle: postings
queued there land as `pending` entries with a "queued for apply" history event
— treat them as first in line in step 3.

## Cycle

1. **Discover** (the script ships with this skill, path relative to this
   skill's base directory):
   ```sh
   node "<skill-dir>/scripts/hunt.mjs" --track
   ```
   Fetches all configured sources, skips anything already tracked (URL or
   company+role match — never double-apply) and every `never-apply` company,
   tracks the rest as `pending` with a discovery history event. Report the
   summary (new / already-tracked / blocked).
2. **Filter for fit**: from the new `pending` entries, drop ones that clearly
   contradict `instructions.md` preferences (location, role type) — mark those
   `rejected` with a history note "filtered: <reason>" so they don't resurface.
3. **Apply**: for the remainder, run the `apply` skill flow per job, oldest
   first, capped at **3 per cycle** (override via instructions.md). Each job's
   apply-skill confirmation gate still applies — batch the confirmations
   ("apply to these 3?") instead of asking one by one. Update statuses +
   history as each finishes.
4. **Show the console** (per tracker skill rules): ensure it's serving on
   4517, open it, give a one-line cycle summary. Launch it at cycle start too
   if it isn't up — the user should watch the cycle land on the board live.

## Recurring

Offer once: `/loop 30m /start` for this session, or the `schedule` skill for a
cloud cron. Respect a `cadence` note in instructions.md if present.

## Rules

- `instructions.md` is standing user instruction — when it conflicts with
  anything here, instructions.md wins.
- Never apply twice to the same posting or company+role; when unsure whether
  an entry is the same job, skip and note it.
- A cycle that discovers nothing new ends silently fast — no busywork.
