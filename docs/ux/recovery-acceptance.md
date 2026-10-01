# Save and load recovery acceptance

Baseline: `cb343e54a6e7451e05b845b9ab8e0f8cc284de84`.
Source: complete [UX Writing skill](https://github.com/content-designer/ux-writing-skill/blob/98cacde4ba2dd10ed28df43a8d53eef1e321c539/SKILL.md) and usability checklist. Applied principles: acknowledge success only after persistence; explain failures and recovery; preserve the user's work.

| Before | After |
|---|---|
| Wizard says “Saved locally” before saving | “Save your choices on this machine” |
| “Start discovering” dismisses wizard even after rejected save | “Save and discover”; wait for success, keep selections and show retry guidance on failure |
| Filter save failures disappear | Explain view-only filters and offer “Save filters again” |
| Board drag save failures disappear | Card stays put; visible error identifies the application and how to retry |
| Unreachable API dead-end; error never clears | “Could not load your console” plus “Try loading again”; clear the error after successful reload |
| “needs you” flag | “Needs your help” |

`node harness/ux-recovery.mjs` uses the actual App, Discover, and Board components from the exact original and changed sources. Synthetic API responses reject and then accept saves, preserving source-derived state in the test. CI uploads actual paired screenshots, a SHA manifest and raw test log. No real profile, employer, account or application is touched. Built assets are refreshed because this repository distributes the console prebuilt.

Stacked on application-feedback PR #20. This PR contains only saved-state recovery and its rebuilt assets; merge #20 first. The existing application acceptance suite also runs on this combined source tree, including production-bundle startup.
