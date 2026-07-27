# Resume Judge v1 — one spec, run context-free

Unified judge for every rendered resume: our craft rubric + the employer-side
screening rubric (adapted from HackerRank's hiring-agent, MIT © 2025
HackerRank — attribution preserved; their multi-prompt extraction + GitHub
enrichment pipeline deliberately dropped) folded into ONE prompt, ONE output.

## How to run — context isolation is the point

Spawn a **fresh subagent** (the Task tool)
whose entire context is exactly three things:

1. the resume text (extract from the rendered PDF, not the .tex),
2. the target JD (role + company + full text),
3. this spec.

Give it NOTHING else — not the bullet pool, not the selection rationale, not
the conversation. The agent that assembled the resume never judges it. Run it
once; median-of-3 only where a wrong call is expensive (rule below).

Isolation is **two-way**: the generation side (Module 1 bullet writing,
Module 2 selection/assembly) must never read this spec while producing — a
generator that sees the rubric optimizes for the score instead of the truth.
Generation prompts live in their skills; this file is loaded only into judge
subagents and improvement-loop reviews.

Machine gates run BEFORE this and are not the judge's job: `judge.json` must
already show `onePage: true`, `fullPage: true`, `verbatim: true`,
`extractable: true`. That last one is why this rubric carries no
"ATS-friendly formatting" section: parseability is measured, not judged.

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
> top third answers the JD's headline requirements (0–8); each entry opens
> with a bullet that says what the project/product IS, then strongest detail
> bullets (0–4); section balance, no orphan entries (0–4);
> clean layout, aligned dates, no widows (0–4).
>
> **JD fit (0–10)** — does THIS resume put THIS job's requirements in front of
> the reader: every headline requirement the candidate can evidence is shown
> (0–5), ranked the way the JD ranks them (0–3), nothing prominent that the JD
> never asked for (0–2). Score the choice of material, not the material.
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
> jd_fit:{score,max:10,note}, bonus:{total,breakdown},
> deductions:{total,reasons[]},
> total (= substance + presentation + bonus − deductions, cap 130 — jd_fit is
> NOT part of it), key_strengths[≤5],
> fixes[≤3 — each {fix, severity:"critical"|"normal"}]}

## Pass bar, recording, and the regenerate loop

**Every rendered resume takes this review — no exceptions.** After the judge
subagent(s) return:

- **The gate is only what a re-render can change.** Substance (0–100) scores
  the candidate's evidence — open-source history, internships, what they have
  actually built. No amount of reselecting moves it, so it must never gate a
  resume:

  ```
  pass =  presentation.score >= 16   (of 20)
      &&  jd_fit.score       >= 7    (of 10)
      &&  deductions.total   <= 3
      &&  no fix with severity "critical"
  ```

  Tune these numbers in this file, never per-resume.

- **`total` is advice, never a gate.** Report it as an employer-side estimate
  alongside the biggest lever ("a screener scores this ~62/130; the lever is not
  the resume — it is an upstream contribution or an internship"). A junior with
  no open-source history and no production experience tops out near 60–80 by
  construction: gating on that number fails every resume this product exists to
  produce, three times over, before escalating. That is what the old
  `medianTotal >= 85` bar did. The category error is worth naming, because the
  bar looks reasonable until you see it: the borrowed rubric grades from the
  **employer's** side (should we interview this person), and it was mounted as a
  **candidate-side** gate (is this document as good as it can be). No shipping
  resume reviewer — VMock, Resume Worded, Rezi, Jobscan — deducts for a missing
  internship; all of them score only what a rewrite can move, and their "good"
  bands sit at 80–90% of a scale made entirely of fixable checks, which is where
  the numbers above come from.

- **Run count**: once. Re-run twice and take the median only before acting on a
  FAIL (a spurious fail burns a whole regenerate cycle) or before an automatic
  approval (`requireResumeReview: false` — no human reads it after).

- **Record the verdict** to the job folder as `llm-judge.json`:
  `{judgedAt, runs, medianTotal, gate:{presentation, jdFit, deductions,
  criticalFixes}, pass, fixes[], verdicts[]}` — automatic approval is code-gated
  on `pass: true` (a resume with no recorded verdict cannot auto-approve), and
  the Review tab reads it for humans. `gate` is what makes a failure legible: it
  says which dimension blocked, not just that one did.
- **Fail → regenerate from the feedback**: apply `fixes` (reselect / reorder /
  cut / heading-links; bullet rewording goes back through Module 1), re-render,
  re-judge. At most 3 loops; still failing → stop and escalate to the user
  with all verdicts instead of shipping a weak resume. **A fix the pool cannot
  satisfy is not a loop — it is a pool gap**: if the same `fix` survives a round
  because no pool bullet can serve it, stop immediately, name the missing
  capability, and send the user to Module 1. Rounds are for choosing better, not
  for wishing material into existence.
- After recording, run `campaign.mjs reconcile` so auto-approval (when review
  is off) picks up the verdict.

## Intake mode — judging the resume the user arrived with

Runs ONCE, when an existing resume lands in the profile (the `profile` skill's
import, which `tailor`'s front door and `setup` stage 1 both route through).
Same spec, same isolation — a fresh subagent, never the agent that just parsed
the resume — with three differences:

- **No JD, so no `jd_fit`** and no "{role} at {company}" framing. Screen for the
  user's target track instead (`level` + `directions` from config.json when set,
  otherwise ask for one line about what they're going for).
- **Judge the material, not the document.** Their layout is about to be replaced
  by the managed template, so skip `presentation` — score substance and
  deductions, which is the part that survives into the pool and shapes every
  resume produced afterwards.
- **It gates nothing, ever.** This is the one place `total` is the right number
  to show a person: at intake the expensive levers are still open (contribute
  upstream, ship the demo, capture the link) — exactly the ones the approval
  gate has to ignore because a re-render cannot move them.

Report three lines, not a dump: where a screener would place them, the single
upstream lever worth the most, and the fixes actionable today. Then route:

- link/generic-name/unevidenced-skill deductions → `profile` edits, now, with
  the user.
- thin `self_projects` or `open_source` evidence → name which repos are worth
  feeding to `/experience`; in `setup` this becomes stage 3's question, asked
  with specifics instead of "paste your repos".
- anything else → drop it. An intake report that produces no action is a wall of
  text that charges the user for the privilege of being judged.

Record it as `~/.coforce/intake-judge.json`
(`{judgedAt, total, breakdown, fixes[]}`) so a later run can show movement
instead of re-judging blind.

## Acting on the verdict

`deductions.reasons` + `fixes` are the regenerate loop's work list. Bullets
are verbatim pool material — fixes land in selection, ordering, headings,
links, or go back through Module 1 (generate → review → profile). Structural
findings (e.g. "projects need repo links") are sedimented into Module 1's
generation rules, not patched per-resume.
