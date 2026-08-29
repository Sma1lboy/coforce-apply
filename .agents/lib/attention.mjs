// What in the tracker wants the user RIGHT NOW.
//
// tracker/SKILL.md states these rules in prose, which means an agent follows
// them when it remembers to. A student's pipeline fails between stages, not
// inside them: a resume built and never sent, a deadline that passed while the
// entry sat in `pending`, an `applied` entry nobody ever chased. Prose cannot
// go red. This can.
//
// Two clocks, deliberately not mixed:
//   - deadline urgency: the only clock that applies to `pending` — nothing was
//     sent, so nobody is late replying, but the window still closes.
//   - quiet days: applied/interviewing only — days since the newest dated
//     history event (updatedAt as fallback).
const DAY = 86_400_000;

const DEADLINE_SOON_DAYS = 7;
const QUIET_FOLLOWUP_DAYS = 10;
const MAX_FOLLOWUPS = 2;
const SILENT_REJECTION_DAYS = 21;

const startOfDayUTC = value => {
  const t = new Date(value);
  return Number.isNaN(t.getTime())
    ? null
    : Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
};

// A deadline is a calendar day, not an instant: "2026-08-29" is not overdue
// until 2026-08-30, wherever the user is. Comparing a date-only string against
// Date.now() would call it passed from midnight UTC, which is the middle of the
// previous afternoon in the US — the exact moment a student is still applying.
export const daysUntilDeadline = (deadline, now = Date.now()) => {
  const due = startOfDayUTC(deadline);
  if (due === null) return null;
  return Math.round((due - startOfDayUTC(now)) / DAY);
};

export const daysQuiet = (app, now = Date.now()) => {
  const dates = (app.history || [])
    .map(h => new Date(h.date).getTime())
    .filter(t => !Number.isNaN(t));
  const latest = dates.length ? Math.max(...dates) : new Date(app.updatedAt || app.createdAt || 0).getTime();
  if (!latest) return null;
  return Math.floor((now - latest) / DAY);
};

export const followUpCount = app =>
  (app.history || []).filter(h => /^followed up\b/i.test(h.event || '')).length;

// Ordered by how much each wants a human, worst first. `reason` is a full
// sentence because the caller renders it verbatim — a nudge the user cannot act
// on without opening the entry is not a nudge.
export const attentionFor = (app, now = Date.now()) => {
  const flags = [];
  const until = app.deadline == null ? null : daysUntilDeadline(app.deadline, now);
  const quiet = daysQuiet(app, now);

  if (until !== null && app.status === 'pending') {
    // The failure this field exists to catch: documents built, never sent, now
    // unsendable. Louder than "deadline passed" alone, because there is
    // finished work behind it.
    if (until < 0) {
      flags.push({
        kind: 'deadline-passed',
        severity: 1,
        reason: `Deadline was ${app.deadline} (${-until}d ago) and this was never submitted.`,
      });
    } else if (until <= DEADLINE_SOON_DAYS) {
      flags.push({
        kind: 'deadline-soon',
        severity: 2,
        reason: `Deadline ${app.deadline} is ${until === 0 ? 'today' : `in ${until}d`} and this is still unsent.`,
      });
    }
  }

  if (app.status === 'applied' && quiet !== null) {
    if (quiet >= SILENT_REJECTION_DAYS) {
      flags.push({
        kind: 'silent-rejection',
        severity: 3,
        reason: `No reply in ${quiet}d — count this as a rejection when you look at what to fix.`,
      });
    } else if (quiet >= QUIET_FOLLOWUP_DAYS && followUpCount(app) < MAX_FOLLOWUPS) {
      flags.push({
        kind: 'follow-up',
        severity: 4,
        reason: `Quiet for ${quiet}d — worth one short follow-up.`,
      });
    }
  }

  return flags.sort((a, b) => a.severity - b.severity);
};

export const attentionQueue = (apps, now = Date.now()) =>
  apps
    .flatMap(app => attentionFor(app, now).map(flag => ({ ...flag, id: app.id, company: app.company })))
    .sort((a, b) => a.severity - b.severity);
