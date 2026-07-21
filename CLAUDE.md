# CoForce Apply (repo: jd-resume-fitter, pending rename)

Skill-first resume tooling; the Chrome extension is the application-delivery
manager (Apply tab: tier-1 scripted auto-fill, tier-2 `claude "/apply <url>"`
browser-use fallback). See `docs/ROADMAP.md`; merge plan in `docs/MIGRATION.md`.

- User background data: `profile/profile.json` (gitignored, never commit), schema =
  `userProfileSchema` in `src/types.ts`. Maintain it via the `profile` skill.
- `profile/instructions.md` = standing user instructions (never-apply list,
  preferences). EVERY skill/action touching applications reads it first and
  treats it as overriding metadata. Onboarding: `setup` skill; operating
  cycle: `start` skill (discover via `scripts/hunt.mjs` → apply → board).
- Repo → resume bullets: `repo-bullets` skill (STAR format, evidence-based).
- JD → resume: `tailor` skill (tex/pdf/docx; templates/references in
  `templates/`, gitignored). Applications: `tracker` skill →
  `profile/applications.json` (gitignored) + `yarn board` kanban.
- Mock E2E: `harness` skill (`yarn harness` runs apply/format/board checks;
  fixtures in `harness/`).
- Brand theme: kobe "Hallmark" tokens (`/Users/jacksonc/i/kobe/packages/
  kobe-landing/tokens.css`) — terracotta accent on warm dark paper, Space
  Grotesk display + JetBrains Mono body. Board and any future UI follow it.
- Extension (legacy core, future delivery manager): `src/`, build with
  `yarn build:chrome`, dev with `yarn dev:chrome`.
