---
name: tailor
description: Generate a tailored resume for a specific job description from the user's local profile — reads the JD (URL, file, or pasted text), selects and reorders the most relevant experience/projects/skills, and emits the resume as LaTeX/PDF or Word (.docx), optionally following a user-provided template or reference resume. Use for "给这个 JD 出一份简历", "tailor my resume for X", "$tailor <jd>" in Codex, or "/tailor <jd>" in Claude Code.
---

# Tailor — JD → resume

Input: a job description (URL to fetch, file path, or pasted text), optionally a
format ("docx", "pdf", "tex") and/or a template/reference file.
Read `~/.coforce/instructions.md` first if present — standing user preferences
(tone, emphasis, format defaults) override this skill's defaults.
Profile source: `~/.coforce/profile.json` (fall back to asking the user to run the
`profile` skill if missing).

When invoked by the `campaign` skill for a campaign job ID, the campaign
contract wins: read that job's saved JD/match/feedback, use the configured
`latexTemplate`, write `resume.tex` and `resume.pdf` into that job's existing
campaign folder, and leave approval to the Review tab. Do not also write a
duplicate resume under `~/.coforce/out/`.

## Template / reference resolution (first match wins)

1. A file the user names explicitly.
2. Files in `~/.coforce/templates/` (may carry personal style or data). If
   several, ask once which to use.
3. Default: `assets/resume_template.tex` inside this skill's base directory —
   Jake's-resume style (letterpaper 11pt, `\resumeSubheading` macros, section
   order Education → Experience → Projects → Skills). Keep its macros and
   spacing intact; only fill the placeholder slots.

How to use it depends on its type:
- **`.tex` / `.html`** — a fillable template: keep its packages, layout, and
  section order; replace the `{placeholder}` / `{{#each}}` slots with content.
- **`.pdf`** — a reference: Read it (the Read tool renders PDFs), then mimic its
  section order, heading style, and density in the output format.
- **`.docx`** — a reference: extract text with `pandoc <file> -t plain`
  (fallback `textutil -convert txt`), then mimic as above.

## Steps

1. Read the JD; extract company, role, and the ranked key requirements/skills.
2. Select from the profile — never invent:
   - Skills: intersect profile skills with JD requirements first, then the
     strongest remainder. Order by JD relevance.
   - Experience/projects: reverse-chronological; reorder each entry's bullets so
     JD-relevant ones lead; drop the weakest bullets if over one page. Respect
     `weight` fields (higher = keep first) when present.
   - Summary: 2–3 sentences positioning the user for THIS role, facts only.
   - Custom sections (`customSections[]`: Awards, Publications, Leadership…):
     include after Education as `\section{<title>}` — entries use
     `\resumeSubheading` (heading/date/subheading) with `\resumeItem` bullets.
     Include only when JD-relevant or high-`weight`; they are the FIRST cut in
     the one-page gate unless the JD asks for them (e.g. research roles keep
     Publications).
3. Render to `~/.coforce/out/resume-<company>-<role>.<ext>` (kebab-case):
   - **tex/pdf** (default): write `.tex`, escape LaTeX-special characters
     (`& % $ # _ { } ~ ^`), compile with `pdflatex -interaction=nonstopmode`
     (or `tectonic`) if on PATH.
   - **docx**: write clean intermediate Markdown (`#` name header, `##`
     sections, bold company + right-aligned dates on one line, bullet lists),
     then `pandoc resume.md -o resume.docx`. Fallback without pandoc: write
     semantic HTML and `textutil -convert docx resume.html`.
4. **One-page review gate (mandatory for tex/pdf)**: after compiling, check
   the page count (pdflatex log says `Output written on … (N pages` — or
   `pdfinfo`/`mdls`). If N > 1: cut the lowest-weight bullets first (respect
   `weight`), then the least JD-relevant project, and recompile until it is
   exactly 1 page. Never shrink font size or margins to force a fit. Report
   what was cut. For docx, sanity-check length the same way (≈45 lines of
   content) before delivering.
5. Report: file path(s) + a one-paragraph note on what was emphasized and why.

## Rules

- Facts only from the profile. Tailoring reorders and rephrases; it never adds
  employers, titles, dates, metrics, or skills the profile doesn't contain.
- One page unless the profile clearly warrants two (10+ years, many roles).
- Never write into `~/.coforce/templates/` — outputs go to `~/.coforce/out/`
  (or the path the user asks for).
