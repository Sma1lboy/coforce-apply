# Third-party skill review: shushu-internship-tool

Upstream: <https://github.com/LiuMengxuan04/shushu-internship-tool> (Apache-2.0)
Vendored at `.claude/skills/shushu-internship-tool/` with a CoForce integration
layer appended. This is the first sample of the Phase-2 "third-party skills"
contract — reviewed before adoption, judged below.

## What it does

JD → find 2-3 real GitHub projects → score/rank them (Python, stdlib-only) →
audit the repo → run a minimal path → build an interview-worthy modification →
emit 4-5 STAR resume lines + interview Q&A pack. It fills the gap our skills
don't cover: the candidate who has **no** suitable project for a JD.
`repo-bullets` extracts from what you built; this builds something worth
extracting.

## Judgement

**Take (what earns it a place):**

- Scoring design is right: the agent does all semantic judgement and writes
  explicit numeric fields (`jd_match_score`, `runnable_score`…); the script
  only does arithmetic. No hidden NLP in Python — same philosophy as our
  hunt.mjs (mechanical dedup, agentic judgement).
- Honesty rules match ours: no invented metrics; missing numbers become
  "engineering output + next steps". Compatible with our no-fabrication rule.
- The taste gate insists on structured input controls (maps cleanly to
  AskUserQuestion) instead of fake option lists in prose.
- Deliverables (STAR lines, interview pack) slot directly into our
  `profile.json` projects and `applications/<id>/` archives.

**Friction (accepted, worked around in the integration layer):**

- Its intake re-asks background we already keep in `~/.coforce/profile.json` —
  integration layer redirects it to read the profile.
- Community-specific context (group-chat naming rules) is irrelevant outside
  the community; harmless, left untouched to keep the upstream diff minimal.
- Python 3.9+ required — our own scripts are Node-only; acceptable for a
  third-party sample, verified stdlib-only.
- Chinese-first output; fine for our primary users.

**Watch (would upstream or revisit):**

- "Build a project for the resume" needs the modification to actually be done
  before the bullets are written — our integration layer routes finished repos
  through `repo-bullets` for evidence-based extraction, which keeps it honest.
- Scoring denominators (104/114) are magic numbers; fine while vendored,
  would propose named weights upstream.

**Verdict: adopted as the third-party sample.** Integration cost was one
appended SKILL.md section; zero changes to its scripts. The Phase-2 contract
held: read/write `~/.coforce` data, respect `instructions.md`, STAR output.

## Integration layer (our additions only)

Provenance notice at top + "CoForce Apply Integration" section at bottom of
its SKILL.md: profile-driven intake, AskUserQuestion for the taste gate,
never-apply/instructions respected, outputs written back to profile/tracker
archives, division of labor with `repo-bullets`.
