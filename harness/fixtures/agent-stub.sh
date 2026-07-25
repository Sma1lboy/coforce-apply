#!/bin/sh
# Harness stand-in for the Claude Code CLI.
#  - Chrome-backed "/apply" prompt → background first run: READY_TO_SUBMIT
#  - resume "confirmed"            → submit run: SUBMITTED
#  - "Additive only" prompt        → profile-add proposal
#  - anything else                 → resume-import parse (fixed profile JSON)
cat > /dev/null

# contract guards: the console must drive Claude with /apply, with Chrome enabled
case "$*" in
  *'$apply'*)
    echo "Claude Code must invoke the skill as /apply" >&2
    exit 64
    ;;
esac
case "$*" in
  *"/apply"*|*confirmed*)
    case "$*" in
      *--chrome*) ;;
      *)
        echo "Claude apply runs must enable --chrome" >&2
        exit 64
        ;;
    esac
    ;;
esac

case "$*" in
  *"/apply"*)
    echo "[stub] filling application forms…"
    echo "COFORCE_STATUS: READY_TO_SUBMIT"
    echo "Summary: name/email/resume filled, 1 screening question answered."
    ;;
  *confirmed*)
    echo "[stub] submitting…"
    echo "COFORCE_STATUS: SUBMITTED"
    ;;
  *'Additive only'*)
    printf '%s' '{"customSections":[{"title":"Awards","entries":[{"heading":"Stub Hackathon — 1st Place","date":"2025","description":[{"text":"Won 1st place among 200 teams","source":"https://example.com/results"}]}]}],"skills":["Rust"],"notes":"team size not stated"}'
    ;;
  *)
    printf '%s' '{"name":"Stub Person","email":"stub@example.com","skills":["Go","Kubernetes"],"experience":[{"company":"Stub Corp","title":"Engineer","date":"2024","description":[{"text":"Did the thing end to end"}]}]}'
    ;;
esac
