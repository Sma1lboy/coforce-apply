# CoForce Apply

CoForce Apply is a skill-first job application agent. The canonical, Codex-
discoverable product lives under `.agents/skills/`. Users clone the repository
and run Codex or Claude Code from that checkout; no global skill installation
is required.

- User data lives in the CoForce data home. Wherever docs say `~/.coforce`,
  resolve it as: `$COFORCE_HOME` env override -> `<checkout>/.coforce/` if it
  exists (private-fork mode: the user's PRIVATE fork syncs data in-repo; the
  setup skill verifies privacy before enabling) -> `~/.coforce`. Scripts share
  this rule via `.agents/lib/data-home.mjs`. Outside private-fork mode, never
  commit profile, application, account, resume, or instruction data -- and
  never push the data home to the canonical public repo in any mode.
- `.claude/skills` is a project-local compatibility symlink to
  `.agents/skills`, so both Codex and Claude Code discover the same canonical
  files without maintaining two copies.
- `~/.coforce/instructions.md` is standing user instruction and overrides
  defaults in every application workflow.
- `apply-config.json` selects `agent: "codex" | "claude"`. The tracker server
  owns the CLI adapter (`tracker/scripts/agent-runner.mjs`); keep discovery,
  profile, tracker, and resume logic agent-neutral.
- Data files are the contract between skills: schemas are canonical in the
  owning SKILL.md and versioned; playbooks program against schemas, never
  against another skill's code. `.agents/lib/` holds shared low-level script
  utilities; the console server may import sibling skill libs as glue.
- The final application submit is irreversible. Every runtime must stop before
  submission and resume only after explicit user confirmation. The full
  operator contract (inputs, COFORCE_STATUS events, iron laws, tier ladder)
  is `docs/OPERATOR.md`.
- Two-module pipeline: Module 1 generates bullets JD-free and the user
  reviews them into profile.json (the verified pool); Module 2 follows a JD
  and strictly selects verbatim pool bullets (`campaign.mjs pool`/`select`).
  No module ever writes resume lines that skipped the review gate.
- Run `npm run harness` for the deterministic pipeline checks.

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
- record/test a skill's conversation -> `skill-story`
- vague job-hunt intent, "where do I start", "what next" -> `coforce` (routes by pipeline state)

