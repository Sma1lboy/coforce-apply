#!/bin/sh
# Harness stand-in for the claude CLI.
#  - "/apply" prompt      → headless-apply first run: fills, then READY_TO_SUBMIT
#  - resume "confirmed"   → submit run: SUBMITTED
#  - anything else        → resume-import parse (fixed profile JSON)
cat > /dev/null
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
  *)
    printf '%s' '{"name":"Stub Person","email":"stub@example.com","skills":["Go","Kubernetes"],"experience":[{"company":"Stub Corp","title":"Engineer","date":"2024","description":[{"text":"Did the thing end to end"}]}]}'
    ;;
esac
