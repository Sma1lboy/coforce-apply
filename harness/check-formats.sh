#!/bin/sh
# Format harness: docx reference reading + md → docx generation round-trip.
# Run: sh harness/check-formats.sh  (or via `yarn harness`)
set -e
cd "$(dirname "$0")"

if ! command -v pandoc >/dev/null; then
  echo "SKIP: pandoc not installed (tailor falls back to textutil on macOS)"
  exit 0
fi

# Reference-reading path — how the tailor skill consumes a .docx reference
text=$(pandoc fixtures/reference.docx -t plain)
for needle in "John Doe" "john.doe@example.com" "TypeScript"; do
  echo "$text" | grep -q "$needle" || {
    echo "FAIL: reference.docx extraction missing \"$needle\""
    exit 1
  }
done
echo "formats: docx reference extraction ✓"

# Generation path — markdown intermediate → docx → plain text round-trip
mkdir -p out
printf '# Round Trip\n\n- TypeScript resume check\n' > out/roundtrip.md
pandoc out/roundtrip.md -o out/roundtrip.docx
pandoc out/roundtrip.docx -t plain | grep -q "TypeScript resume check" || {
  echo "FAIL: md -> docx round-trip"
  exit 1
}
echo "formats: md -> docx generation round-trip ✓"
echo "harness: format check passed"
