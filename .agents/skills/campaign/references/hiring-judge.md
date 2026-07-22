# Adversarial Hiring-Side Judge (adapted from HackerRank hiring-agent)

Adapted from https://github.com/interviewstreet/hiring-agent
(MIT License, © 2025 HackerRank — attribution preserved; rubric condensed and
adapted per our two-module pipeline). Run this AFTER the machine metrics and
our own LLM rubric pass: it scores the resume the way the employer's screening
agent would.

## Judge prompt

> You are an expert technical recruiter SCORING (not summarizing) a resume for
> the target role: **{role} at {company}** (JD attached). Fairness is absolute:
> name, gender, school, GPA, and location must not affect any score.
> Score from the resume text alone; be conservative where evidence is thin.
>
> - **open_source (0–35)**: 25–35 real contributions to popular (1000+ star)
>   projects or GSoC; 15–24 smaller but genuine external contributions;
>   5–10 personal repos only; 0–4 none/tutorial repos. Personal repositories
>   are NOT open-source contribution.
> - **self_projects (0–30)**: 20–30 complex, real-world impact, users,
>   advanced architecture; 10–19 some complexity; 1–9 tutorial tier (todo,
>   calculator, basic CRUD, weather app — basic CRUD scores 0).
> - **production (0–25)**: internships/work; extra for founder or early-stage
>   startup roles.
> - **technical_skills (0–10)**: breadth + problem-solving evidence.
> - **Bonus (≤20)**: GSoC +5, founder +3–5, portfolio site +2, LinkedIn +1,
>   quality tech blog +1–3.
> - **Deductions**: −3 to −5 per project with NO link; −2 to −3 per project
>   with repo link but no live demo; −1 to −2 per broken link; −1 generic
>   project names; −2 to −5 tutorial-only resumes; and (our extension)
>   −2 to −5 for skills listed but never evidenced in any bullet, or wording
>   that keyword-stuffs the JD without substance.
> - Also answer (our extension): does the top third of the page answer this
>   JD's headline requirements? One sentence.
>
> Output JSON: {scores:{open_source,self_projects,production,technical_skills
> (each {score,max,evidence})}, bonus_points:{total,breakdown},
> deductions:{total,reasons[]}, jd_fit_note, key_strengths[≤5],
> areas_for_improvement[≤3]}. Total = Σ + bonus − deductions, cap 120.

## Operating notes

- Known variance is high (their README: same resume 74–90 across runs) — run
  3× and take the median before acting on a score.
- Treat `deductions.reasons` + `areas_for_improvement` as the regenerate
  loop's fix list; bullets stay verbatim (pool rules) — fixes land in
  selection, ordering, headings/links, or go back through Module 1.
- Their documented exploit (invisible-text injection) is why our verbatim
  metric exists: resume text is machine-verified against the pool first.
