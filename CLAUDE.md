# CoForce Apply

Skill-first job application agent. **The canonical product is the shared skill
set under `.agents/skills/`; `.claude/skills` is a project-local compatibility
symlink to that same tree. Clone the repository and run Claude Code from the
checkout—no global skill installation is required.** The repo also contains
the harness and optional Chrome extension.

- User data home: `~/.coforce/` by default — profile.json (schema canonical
  in the `profile` skill), applications.json, instructions.md,
  apply-config.json, accounts.json, applications/<id>/ archives, out/.
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
- Onboarding: `setup` skill; operating cycle: `start` skill. The
  form-filling/submission modules (extension tier-1, agent browser-use) all
  implement `docs/OPERATOR.md` — the operator contract (inputs, COFORCE_STATUS
  events, confirmation-gate iron laws, cost-ladder escalation).
- Brand theme: kobe "Hallmark" tokens (`/Users/jacksonc/i/kobe/packages/
  kobe-landing/tokens.css`) — terracotta on warm dark, Space Grotesk +
  JetBrains Mono. Board and any UI follow it.
- Extension (tier-1 form-fill, `src/`): `yarn build:chrome`; dev
  `yarn dev:chrome`. Mock E2E: `yarn harness` (fixtures in `harness/`).
- Architecture & design invariants: `docs/ARCHITECTURE.md` (living mermaid
  doc — edit incrementally, never redraw; review-round history on the share
  server series `coforce-arch`). Roadmap: `docs/ROADMAP.md`; CoForce merge
  plan: `docs/MIGRATION.md`.
