# Application progress acceptance

Baseline: `6c388092b004e12f9a38b4f5958b1a1d46d8a9b4`.
Full source: [UX Writing skill](https://github.com/content-designer/ux-writing-skill/blob/98cacde4ba2dd10ed28df43a8d53eef1e321c539/SKILL.md). Principles: accurate verbs, success only after acknowledgment, explain the problem and the recovery step, serious copy for consequential submission.

| Before | After |
|---|---|
| “Agent is applying — autopilot on” | “Preparing your application…” plus separate final approval and upload disclosure |
| “Hit turbulence” | “Application needs your help” plus check-log/site recovery |
| “Command copied” even when clipboard rejects | Show copied only on success; otherwise select/copy the visible command |
| Failed run shows form filling completed | Completion depends on acknowledged preparation, not a terminal phase |
| Generic “Done” / “Cancel” | “Close” / “Stop preparation”; failed stop stays visible for retry |
| Lost confirm response offers another submit | Keep the submission pending and require checking its outcome |
| Silent polling failure | Explain status is unavailable and reconnect without a duplicate submit |

Reproduce with `node harness/ux-application.mjs` after installing the console and Playwright as in `.github/workflows/ux-application.yml`. It renders the real ApplyDialog from the exact base and current source, replacing only network/clipboard responses with synthetic fixtures. Before/after screenshots, exact SHAs and raw assertions are uploaded by CI. It covers clipboard success/failure, failure progress, per-application review, submission success, duplicate clicks, uncertain confirmation, failed cancellation/retry, dismissal while queueing, and polling recovery.

No actual agent, employer, application, account, resume upload, personal data or permission grant is used. The existing backend approval contract is unchanged. Prebuilt console assets are rebuilt because they are distributed with this skill.

The console now emits deterministic React, motion and PDF vendor chunks so tracked prebuilt files can be published within artifact transport limits. Runtime features and dependency versions are unchanged. CI also opens the actual production build and checks it for page errors.
