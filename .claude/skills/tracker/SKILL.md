---
name: tracker
description: Maintain the local job-application tracker (~/.coforce/applications.json) and its kanban board — add applications, update pipeline statuses (pending/applied/interviewing/offer/rejected), record delivery events and the needsFallback flag, attach notes, serve the board, and sync with the extension's Apply tab via JSON export/import. Use for "记录一下投了 X", "更新申请状态", "看板/board", "application tracker".
---

# Tracker — local application board

Read `~/.coforce/instructions.md` first if present — standing user instructions
(e.g. never-apply companies must not be added as pending).

Local truth: `~/.coforce/applications.json` — a JSON array of applications:
`{id, url, title, status, createdAt, updatedAt, company?, position?, notes?,
needsFallback?, description?, history?: [{date, event}]}`. Missing file →
start with `[]`.

## Operations

**Add / update**: read the JSON, apply the change, write back. `id` = epoch ms
string; always bump `updatedAt` (ISO). `status` is the pipeline stage ONLY:
`pending → applied → interviewing → offer | rejected`. How delivery went is
never a status — tier-1 failures and Claude handoffs are `history` events plus
`needsFallback: true` (cleared when the application eventually goes out). Put
recruiter emails, interview dates, and contacts in `notes`. When adding an
application, save the JD text into `description` if you have it. Every status
change appends to `history`: `{date, event}` (e.g.
`"status: applied → interviewing — recruiter email"`); record submissions and
interviews there too.

**Console (看板 + 面板)** — ships with this skill at `scripts/board.mjs`
(relative to this skill's base directory, shown when the skill loads). Prefer
serve mode; it's interactive and persists:
```sh
node "<skill-dir>/scripts/board.mjs" --serve   # http://localhost:4517
open http://localhost:4517
```
One kobe-Hallmark-themed local site, three tabs:
- **Board** — kanban: full-height status columns, drag & drop moves an
  application (appends a history event, saves to the JSON), cards open a
  detail view (JD link, saved info, files, history timeline, description).
- **Profile** — resume-style live preview of `~/.coforce/profile.json` beside
  a structured form editor (basics, skill chips, add/remove
  experience/project/education cards and bullets — no raw JSON), plus
  "Import resume (AI)": pasted text is parsed by local headless Claude
  (`claude -p`, override binary via `COFORCE_CLAUDE_BIN`) and fills the form
  for review before Save.
- **Instructions** — edit `~/.coforce/instructions.md` in place.

**Launch it at the start of every working session** (any tracker/apply/start
activity): if port 4517 isn't already serving, start it and `open` the URL —
the console is how the user watches everything. Without `--serve` it renders a
static read-only `~/.coforce/out/board.html` (drags show a "Copy JSON" bar).

**Always end a mutation by showing the board.** After any add / status change /
import — even when the user didn't ask for the board — regenerate it and `open`
it (or say the path if a browser can't be opened), plus a one-line diff summary
("Initech → interviewing"). The board is the product surface, not a debug
artifact; the user should never have to ask to see it.

**Sync with the extension**: the extension keeps its own copy in
`browser.storage.local` (`jobApplications`). The Apply tab has Export (copies
JSON to clipboard) and Import (reads a JSON file). To pull extension state
into the local tracker: Export in the popup → paste/save over
`~/.coforce/applications.json` (merge by `url`, newest `updatedAt` wins). To push:
tell the user to Import `~/.coforce/applications.json` in the Apply tab.

**Per-application archive (filesystem)**: each application owns a folder,
siblings are global:

```
~/.coforce/applications/
  interview-cheatsheet.md      ← global (shared across all applications)
  salary-research.md           ← global
  <id>/                        ← one folder per application, named by its id
    interview-prep.md
    offer-letter.pdf
    resume-<company>-<role>.pdf
```

- Entering `interviewing`? Offer to create `<id>/interview-prep.md` (role,
  known interviewers, likely topics from `description`, questions to ask).
- Reached `offer`? Archive the offer letter into `<id>/` and note key terms.
- Resumes tailored for that JD belong in `<id>/` too (copy from `~/.coforce/out/`).
- The board's detail dialog lists these files (clickable in serve mode);
  no extra registration needed — the folder IS the source of truth.

**Report**: when asked "what's the state of my search", summarize counts per
status and list stale `pending`/`applied` entries (no update in 14+ days).

## Future (do not build yet)

Email-feedback auto-marking: scan mailbox for ATS confirmations/rejections and
update statuses automatically. Design it as a separate skill writing to the
same `~/.coforce/applications.json`.

## Rules

- `~/.coforce/applications.json` is personal data — never commit or share it.
- Merge conflicts between local and extension copies: keep the entry with the
  newer `updatedAt`; never silently drop entries.
