---
name: tracker
description: Maintain the local job-application tracker (profile/applications.json) and its kanban board — add applications, update pipeline statuses (pending/applied/interviewing/offer/rejected), record delivery events and the needsFallback flag, attach notes, serve the board, and sync with the extension's Apply tab via JSON export/import. Use for "记录一下投了 X", "更新申请状态", "看板/board", "application tracker".
---

# Tracker — local application board

Read `profile/instructions.md` first if present — standing user instructions
(e.g. never-apply companies must not be added as pending).

Local truth: `profile/applications.json` (gitignored, array of `JobApplication`
— shape in `src/types.ts`: `{id, url, title, status, createdAt, updatedAt,
company?, position?, notes?}`). Missing file → start with `[]`.

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

**Board (看板)** — prefer serve mode; it's interactive and persists:
```sh
yarn board:serve   # http://localhost:4517 — drag between columns writes back
open http://localhost:4517
```
Kobe-Hallmark-themed kanban: full-height status columns, drag & drop moves an
application (appends a history event and saves to the JSON), clicking a card
opens its detail view (JD link, saved info, notes, history timeline,
description). `yarn board` renders a static `out/board.html` instead; drags
there can't save — the board shows a "Copy JSON" bar to paste back manually.

**Always end a mutation by showing the board.** After any add / status change /
import — even when the user didn't ask for the board — regenerate it and `open`
it (or say the path if a browser can't be opened), plus a one-line diff summary
("Initech → interviewing"). The board is the product surface, not a debug
artifact; the user should never have to ask to see it.

**Sync with the extension**: the extension keeps its own copy in
`browser.storage.local` (`jobApplications`). The Apply tab has Export (copies
JSON to clipboard) and Import (reads a JSON file). To pull extension state
into the local tracker: Export in the popup → paste/save over
`profile/applications.json` (merge by `url`, newest `updatedAt` wins). To push:
tell the user to Import `profile/applications.json` in the Apply tab.

**Per-application archive (filesystem)**: each application owns a folder,
siblings are global:

```
profile/applications/
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
- Resumes tailored for that JD belong in `<id>/` too (copy from `out/`).
- The board's detail dialog lists these files (clickable in serve mode);
  no extra registration needed — the folder IS the source of truth.

**Report**: when asked "what's the state of my search", summarize counts per
status and list stale `pending`/`applied` entries (no update in 14+ days).

## Future (do not build yet)

Email-feedback auto-marking: scan mailbox for ATS confirmations/rejections and
update statuses automatically. Design it as a separate skill writing to the
same `profile/applications.json`.

## Rules

- Never commit `profile/applications.json`; it's personal data.
- Merge conflicts between local and extension copies: keep the entry with the
  newer `updatedAt`; never silently drop entries.
