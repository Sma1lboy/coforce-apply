# Resume Judge v1 — one spec, run context-free

Unified judge for every rendered resume: our craft rubric + the employer-side
screening rubric (adapted from HackerRank's hiring-agent, MIT © 2025
HackerRank — attribution preserved; their multi-prompt extraction + GitHub
enrichment pipeline deliberately dropped) folded into ONE prompt, ONE output.

## How to run — context isolation is the point

Spawn a **fresh subagent** (Claude Code: Task tool; Codex: a new `codex exec`)
whose entire context is exactly three things:

1. the resume text (extract from the rendered PDF, not the .tex),
2. the target JD (role + company + full text),
3. this spec.

Give it NOTHING else — not the bullet pool, not the selection rationale, not
the conversation. The agent that assembled the resume never judges it. Run 3×
and take the median when the number drives a decision.

Isolation is **two-way**: the generation side (Module 1 bullet writing,
Module 2 selection/assembly) must never read this spec while producing — a
generator that sees the rubric optimizes for the score instead of the truth.
Generation prompts live in their skills; this file is loaded only into judge
subagents and improvement-loop reviews.

Machine gates run BEFORE this and are not the judge's job: `judge.json` must
already show `onePage: true`, `fullPage: true`, `verbatim: true`.

## The prompt

> You are screening resumes for **{role} at {company}** — JD below. You are
> SCORING, not summarizing. Fairness is absolute: name, gender, school, GPA,
> location never affect a score. Score conservatively from the resume text
> alone; unverifiable claims earn low scores, not benefit of the doubt.
>
> **Substance (0–100)**
> - open_source (0–35): 25–35 real contributions to popular (1000+ star)
>   projects; 15–24 genuine external contributions; 5–10 personal repos only;
>   personal repos are NOT open-source contribution.
> - self_projects (0–30): 20–30 complex + real-world impact/users; 10–19 some
>   complexity; 1–9 tutorial tier (todo/calculator/basic CRUD scores ~0).
> - production (0–25): internships/work; extra for founder or early-stage
>   startup roles.
> - technical_skills (0–10): breadth + problem-solving evidence in bullets.
>
> **Presentation (0–20)** — recruiter 6-second + engineer 6-minute pass:
> top third answers the JD's headline requirements (0–8); strongest bullets
> first within entries (0–4); section balance, no orphan entries (0–4);
> clean layout, aligned dates, no widows (0–4).
>
> **Bonus (≤10)**: founder +3–5, portfolio site +2, LinkedIn +1, quality
> tech blog +1–3.
>
> **Deductions (open-ended)**: −3 to −5 per project with no repo/demo link;
> −2 to −3 repo link but no live demo; −1 to −2 broken link; −1 generic
> project names; −2 to −5 skills listed but never evidenced in any bullet,
> or JD keyword-stuffing without substance.
>
> Output JSON only:
> {substance:{open_source,self_projects,production,technical_skills — each
> {score,max,evidence}}, presentation:{score,max:20,notes},
> bonus:{total,breakdown}, deductions:{total,reasons[]},
> total (= substance + presentation + bonus − deductions, cap 130),
> jd_fit_note, key_strengths[≤5], fixes[≤3]}

## Acting on the verdict

`deductions.reasons` + `fixes` are the regenerate loop's work list. Bullets
are verbatim pool material — fixes land in selection, ordering, headings,
links, or go back through Module 1 (generate → review → profile). Structural
findings (e.g. "projects need repo links") are sedimented into Module 1's
generation rules, not patched per-resume.
