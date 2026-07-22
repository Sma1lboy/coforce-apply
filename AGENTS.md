# CoForce Apply

CoForce Apply is a skill-first job application agent. The canonical, Codex-
discoverable product lives under `.agents/skills/`. Users clone the repository
and run Codex or Claude Code from that checkout; no global skill installation
is required.

- User data lives under `~/.coforce/`; never commit profile, application,
  account, resume, or instruction data.
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
