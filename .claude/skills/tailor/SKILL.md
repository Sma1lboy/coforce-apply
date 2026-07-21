---
name: tailor
description: Generate a tailored resume for a specific job description from the user's local profile — reads the JD (URL, file, or pasted text), selects and reorders the most relevant experience/projects/skills, and emits the resume as LaTeX/PDF or Word (.docx), optionally following a user-provided template or reference resume. Use for "给这个 JD 出一份简历", "tailor my resume for X", or "/tailor <jd>".
---

# Tailor — JD → resume

Input: a job description (URL to fetch, file path, or pasted text), optionally a
format ("docx", "pdf", "tex") and/or a template/reference file.
Read `profile/instructions.md` first if present — standing user preferences
(tone, emphasis, format defaults) override this skill's defaults.
Profile source: `profile/profile.json` (fall back to asking the user to run the
`profile` skill if missing).

## Template / reference resolution (first match wins)

1. A file the user names explicitly.
2. Files in `templates/` at the repo root (gitignored — may carry personal style
   or data). If several, ask once which to use.
3. Default: `src/templates/resume_template.tex`.

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
3. Render to `out/resume-<company>-<role>.<ext>` (kebab-case; `out/` is
   gitignored):
   - **tex/pdf** (default): write `.tex`, escape LaTeX-special characters
     (`& % $ # _ { } ~ ^`), compile with `pdflatex -interaction=nonstopmode`
     (or `tectonic`) if on PATH.
   - **docx**: write clean intermediate Markdown (`#` name header, `##`
     sections, bold company + right-aligned dates on one line, bullet lists),
     then `pandoc resume.md -o resume.docx`. Fallback without pandoc: write
     semantic HTML and `textutil -convert docx resume.html`.
4. Report: file path(s) + a one-paragraph note on what was emphasized and why.

## Rules

- Facts only from the profile. Tailoring reorders and rephrases; it never adds
  employers, titles, dates, metrics, or skills the profile doesn't contain.
- One page unless the profile clearly warrants two (10+ years, many roles).
- Never write into `templates/` — outputs go to `out/` (or the path the user
  asks for).
