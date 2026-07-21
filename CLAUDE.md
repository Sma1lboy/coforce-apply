# CoForce Apply

Skill-first job application agent. **The canonical product is the shared skill
set under `.agents/skills/`; `.claude/skills` is a project-local compatibility
symlink to that same tree. Clone the repository and run Claude Code from the
checkout—no global skill installation is required.** The repo also contains
the harness and optional Chrome extension.

- User data home: `~/.coforce/` — profile.json (schema canonical in the
  `profile` skill), applications.json, instructions.md, apply-config.json,
  accounts.json, applications/<id>/ archives, out/. Never commit user data.
- `~/.coforce/instructions.md` = standing user instructions (never-apply list,
  preferences). EVERY skill/action touching applications reads it first and
  treats it as overriding metadata.
- Skills own their runtime assets: `tracker/scripts/board.mjs` (kanban,
  serve/static), `start/scripts/hunt.mjs` (job discovery + dedup),
  `tailor/assets/resume_template.tex`. Keep skills self-contained — no
  repo-relative references from skill instructions (only `harness` is
  repo-dev-only and exempt).
- Onboarding: `setup` skill; operating cycle: `start` skill.
- Brand theme: kobe "Hallmark" tokens (`/Users/jacksonc/i/kobe/packages/
  kobe-landing/tokens.css`) — terracotta on warm dark, Space Grotesk +
  JetBrains Mono. Board and any UI follow it.
- Extension (tier-1 form-fill, `src/`): `yarn build:chrome`; dev
  `yarn dev:chrome`. Mock E2E: `yarn harness` (fixtures in `harness/`).
- Roadmap: `docs/ROADMAP.md`; CoForce merge plan: `docs/MIGRATION.md`.
