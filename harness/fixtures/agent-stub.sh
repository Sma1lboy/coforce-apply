#!/bin/sh
# Harness stand-in for the Codex and Claude CLIs.
#  - Chrome-backed "$apply"/"/apply" prompt → background first run: READY_TO_SUBMIT
#  - resume "confirmed"   → submit run: SUBMITTED
#  - anything else        → resume-import parse (fixed profile JSON)
cat > /dev/null
if [ "$1" = "exec" ]; then
  case "$*" in
    *--ask-for-approval*)
      echo "codex exec does not accept --ask-for-approval" >&2
      exit 64
      ;;
    *"/apply"*)
      echo "Codex must invoke the skill as \$apply" >&2
      exit 64
      ;;
  esac
  case "$*" in
    *'@Chrome'*)
      echo "Codex apply commands should let the apply skill initialize Chrome internally" >&2
      exit 64
      ;;
  esac
else
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
fi
case "$*" in
  *'$apply'*|*"/apply"*)
    if [ "$1" = "exec" ]; then
      echo '{"type":"thread.started","thread_id":"019d-stub-codex-thread"}'
      echo '{"type":"item.completed","item":{"type":"reasoning","text":"Do not print COFORCE_STATUS: SUBMITTED before confirmation."}}'
      echo '{"type":"item.completed","item":{"type":"agent_message","text":"COFORCE_STATUS: READY_TO_SUBMIT\\nSummary: name/email/resume filled."}}'
    else
      echo "[stub] filling application forms…"
      echo "COFORCE_STATUS: READY_TO_SUBMIT"
      echo "Summary: name/email/resume filled, 1 screening question answered."
    fi
    ;;
  *confirmed*)
    if [ "$1" = "exec" ]; then
      echo '{"type":"item.completed","item":{"type":"agent_message","text":"COFORCE_STATUS: SUBMITTED"}}'
    else
      echo "[stub] submitting…"
      echo "COFORCE_STATUS: SUBMITTED"
    fi
    ;;
  *)
    printf '%s' '{"name":"Stub Person","email":"stub@example.com","skills":["Go","Kubernetes"],"experience":[{"company":"Stub Corp","title":"Engineer","date":"2024","description":[{"text":"Did the thing end to end"}]}]}'
    ;;
esac
