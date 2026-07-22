---
name: coforce
description: CoForce Apply entry point and skill router — use when a request is about job hunting, applications, or resumes but does not clearly match one specific CoForce skill, when the user asks what CoForce can do, where to start, or what to do next ("我想找工作", "开始求职", "接下来干嘛", "怎么用这个工具", "help me get a job", "what's next", "job hunt"), or when you are unsure which CoForce skill fits. Routes to the right skill by intent, or by pipeline state when the intent is vague. Invoke as "$coforce" in Codex or "/coforce" in Claude Code.
---

# CoForce — entry point & router

CoForce Apply is a skill-first job application agent. This skill is the front
door: it never does the work itself — it decides which skill should, then
invokes it. It ships with the skill set, so routing works whether the user
runs from a repo checkout (where AGENTS.md/CLAUDE.md carry the same table) or
installed only the skills.

## Route by intent

First action for a matched intent is invoking that skill — never answer ad
hoc or improvise the workflow inline.

| The user is talking about… | Go to |
|---|---|
| First run, onboarding, 初始化, "set me up", missing data-home files | `setup` |
| Changing job-search preferences (level, directions, H1B/sponsorship, work mode, locations, salary) | `setup` (stage 2 only) or the console Settings tab |
| Their background: work history, projects, education, skills, **awards/honors, certificates**, "add X to my resume/record" | `profile` (Supplement flow takes raw material — a story, a link, a PDF) |
| Turning a GitHub URL / local repo into evidence or bullets | `experience` (index) + `repo-bullets` (STAR bullets) |
| "Run a cycle", "find new jobs", "start hunting", recurring discovery | `start` |
| A batch of resumes for tracked jobs; reviewing/approving generated PDFs; ZIP export | `campaign` |
| One specific JD → one tailored resume (no tracker involvement) | `tailor` |
| Submitting an application to a posting URL | `apply` |
| "Where are my applications", board, statuses, notes, archives | `tracker` |
| Testing/recording a skill's conversation flow | `skill-story` |
| JD → find/adapt a real GitHub project to fill an experience gap | `shushu-internship-tool` |

## Route by state (when the intent is vague)

"我想找工作" / "what next" / "continue" → inspect the data home (resolve it
as `$COFORCE_HOME` → `<checkout>/.coforce/` if present → `~/.coforce`) and
pick the FIRST stage that is incomplete:

1. No `profile.json` or no `apply-config.json` → `setup` (full onboarding).
2. Profile has no reviewed bullets (empty pool) or no experience index →
   `experience` + `repo-bullets`, review results into the profile.
3. No/empty `applications.json` → `start` (first discovery cycle).
4. Campaign jobs sitting in `rendered` awaiting review → open the console
   Review tab (tracker skill) and tell the user resumes are waiting.
5. Approved jobs not yet applied → offer `apply` per job (submit still gated
   on the user's explicit Confirm — never skip it).
6. Everything flowing → `start` for another cycle, or `tracker` to check
   statuses; suggest a scheduler (`/loop 30m /start` in Claude Code, a
   scheduled task in Codex) if the user wants it recurring.

State never overrides an explicit ask: if the user names a job URL, route to
`apply`/`campaign` regardless of missing earlier stages — those skills guard
their own prerequisites and will send the user back to `setup` themselves.

## Rules

- `~/.coforce/instructions.md` (in the resolved data home) overrides
  everything — read it before routing side-effectful work.
- Never chain more than one side-effectful skill without telling the user
  the plan first; routing is one hop, not an autopilot.
- If nothing here fits, say what CoForce covers (the intent table above) and
  ask which the user meant — do not guess into an irreversible flow.
