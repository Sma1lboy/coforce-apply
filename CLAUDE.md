# CoForce Apply

Skill-first job application agent. **The canonical product is the shared skill
set under `.agents/skills/`; `.claude/skills` is a project-local compatibility
symlink to that same tree. Clone the repository and run Claude Code from the
checkout—no global skill installation is required.** The repo also contains
the harness. `AGENTS.md` is a symlink to this file — one set of rules, two
names, no drift.

- User data home: `~/.coforce/` by default — profile.json (schema canonical
  in the `profile` skill), config.json (intent + runtime config + consents,
  one flat object, `.agents/lib/config.mjs`; it replaced the overlapping
  preferences.json + apply-config.json pair and migrates them on first read),
  instructions.md, applications.json, accounts.json, campaigns/,
  applications/<id>/ archives. `experience/` and `out/` are regenerable
  caches, not contract files.
  Resolution rule (shared via `.agents/lib/data-home.mjs`): `$COFORCE_HOME`
  env -> `<checkout>/.coforce/` if present (private-fork mode — user's PRIVATE
  fork syncs data in-repo; setup verifies privacy first) -> `~/.coforce`.
  Never commit user data to the public repo.
- `~/.coforce/instructions.md` = standing user instructions (never-apply list,
  preferences). EVERY skill/action touching applications reads it first and
  treats it as overriding metadata.
- Skills own their runtime assets: `tracker/scripts/board.mjs` (kanban,
  serve/static), `start/scripts/hunt.mjs` (job discovery + dedup),
  `tailor/assets/resume_template.tex`. Keep skills self-contained — no
  repo-relative references from skill instructions (only `harness` is
  repo-dev-only and exempt).
- Data files are the contract BETWEEN skills: each schema is canonical in its
  owning SKILL.md (profile → profile skill, preferences → setup,
  applications.json → tracker, campaign manifest → campaign, experience index
  → experience) and carries a schema version. Skill playbooks program against
  schemas, never against another skill's code; `.agents/lib/` holds shared
  low-level script utilities (e.g. the atomic JSON writer), and the console
  server may import sibling skill libs as glue.
- Two-module pipeline: Module 1 (supply) generates bullets JD-free from repo
  contexts and the user reviews them INTO profile.json (`source`+`verifiedAt`
  provenance) — the profile IS the verified pool. Module 2 (demand) follows a
  JD and strictly SELECTS verbatim bullets from that pool (`campaign.mjs
  pool`/`select`, out-of-pool ids rejected); rewording always goes back
  through Module 1's review gate.
  **Bullet ids are content hashes** — `sha256(text)[:8]`, computed at read
  time (`campaign-lib.mjs`) and then persisted as `evidenceIds` in the
  campaign manifest. So a bullet's id is stable only while its text is
  byte-identical: never reformat, trim, re-wrap, or unicode-normalize
  `description[].text` in profile.json. Doing so silently detaches every
  already-matched job ("outside the verified pool").
- Onboarding: `setup` skill; operating cycle: `start` skill. Submission runs
  through the `apply` skill, the one operator, against `docs/OPERATOR.md` —
  the operator contract (inputs, COFORCE_STATUS events, confirmation-gate
  iron laws). Claude Code is the only implemented runtime; the console spawns
  it via `tracker/scripts/agent-runner.mjs`, the single adapter seam.
## Skill routing

When a request matches a CoForce workflow, the FIRST action is invoking the
matching skill -- never answer ad hoc or improvise the workflow inline.
Canonical router (full intent table + state-based next-step logic) is the
`coforce` skill, which also ships to skills-only installs; this summary must
stay in sync with it:

- onboarding / 初始化 / missing data-home files -> `setup`
- preference changes (level, H1B, work mode, locations) -> `setup` stage 2 or console Settings
- background, work history, awards, certificates, "add X to my record" -> `profile`
- GitHub URL / local repo into evidence or bullets -> `experience` + `repo-bullets`
- "run a cycle" / find new jobs -> `start`
- batch resumes, review/approve PDFs, ZIP -> `campaign`
- one specific JD -> one resume -> `tailor`
- submit an application URL -> `apply`
- application statuses / board / archives -> `tracker`
- vague job-hunt intent, "where do I start", "what next" -> `coforce` (routes by pipeline state)

- Brand theme: kobe "Hallmark" tokens (`/Users/jacksonc/i/kobe/packages/
  kobe-landing/tokens.css`) — terracotta on warm dark, Space Grotesk +
  JetBrains Mono. Board and any UI follow it.
- Mock E2E: `npm run harness` (fixtures in `harness/`). The repo has no
  npm dependencies — every script runs on Node builtins; the console
  (`tracker/web/`) carries its own.
- Architecture & design invariants: `docs/ARCHITECTURE.md` (living mermaid
  doc — edit incrementally, never redraw; review-round history on the share
  server series `coforce-arch`). CoForce merge plan: `docs/MIGRATION.md`.
