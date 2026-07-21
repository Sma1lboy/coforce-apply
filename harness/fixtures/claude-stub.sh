#!/bin/sh
# Harness stand-in for the claude CLI: consumes stdin, emits a fixed parse.
cat > /dev/null
printf '%s' '{"name":"Stub Person","email":"stub@example.com","skills":["Go","Kubernetes"],"experience":[{"company":"Stub Corp","title":"Engineer","date":"2024","description":[{"text":"Did the thing end to end"}]}]}'
