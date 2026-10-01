# Landing promise and privacy acceptance

Baseline: `6c388092b004e12f9a38b4f5958b1a1d46d8a9b4`.

Method: source audit using the complete [UX Writing skill](https://github.com/content-designer/ux-writing-skill/blob/98cacde4ba2dd10ed28df43a8d53eef1e321c539/SKILL.md) and its content-usability checklist. Focus: purposeful, concise, conversational, clear; serious and transparent language around submission and privacy. No invented comprehension or conversion results.

| Before | After | Acceptance |
|---|---|---|
| “Your job hunt on autopilot” | “Your job hunt. You approve.” | Hero and summary explain separate approval for every submission |
| “from clone to a tailored PDF” | “to open the project in Claude Code” | One command no longer promises an output it does not create |
| “accounts · telemetry” | “CoForce accounts · CoForce telemetry” | Scope does not hide Claude/ATS accounts |
| `needsFallback` and “gave up” | “Needs your help” plus a next step | User knows to open the application history |
| “All data stays on your machine” / “nothing transmits” | Local tracker storage plus Claude and application-site disclosure | Form entries/uploads can reach ATS before final submission |
| Delete locally and “nowhere else to look” | Local removal distinguished from external copies | Does not promise deletion from other services |

Run `node harness/ux-landing.mjs` after installing the site and Playwright as in `.github/workflows/ux-landing.yml`. It starts the exact original and changed landing sources with Vite, asserts both states, and captures desktop/mobile pairs. The workflow uploads captures, source SHAs, and a raw test log. No production service, account, application, or real personal data is involved.

Local production build passed. Original aggregate harness fails in this container while initializing its LaTeX engine; the unmodified existing `harness` CI remains the full regression gate. The UI evidence workflow has read-only repository permissions.
