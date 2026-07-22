---
name: skill-story
description: Meta-skill for developing other skills — turn a skill's black-box interaction flow into a visible, testable, re-renderable story. Dive into a target skill, derive its expected conversation script, run it as a REAL agent session in a sandbox, capture every frame with true colors, verify the outcome, and sediment findings back into the target skill's prompts. Use for "给 X skill 录个 story", "测一下这个 skill 的交互流", "构建 skill 交互测试集", "dive in 这个 skill", or when developing any skill whose value lives in its conversation (setup interviews, adversarial/against agents, review loops).
---

# skill-story — interaction flows are product surface; test them like code

Most skills are described by their FEATURES, but their real product surface is
an interaction flow: an onboarding interview, an adversarial reviewer that
keeps pushing back, a confirm-gated pipeline. Prompts are black boxes — you
cannot see whether the flow actually runs the way the SKILL.md intends, and
human-testing every change does not scale. This skill makes the flow visible,
repeatable, and verifiable: **capture once, render many, assert always.**

The loop (mirrors how kobe records product videos: script first, then film):

```
dive in → expected script → sandboxed REAL session → drive & capture →
verify outcome → findings → sediment into the target skill → re-record
```

## 1. Dive in — write the expected script FIRST

Read the target skill's SKILL.md and scripts. Before recording anything,
write `harness/stories/<name>/story.md` with:

- **Expected script**: the stages, what questions the user should be asked at
  each stage (and how — e.g. batched AskUserQuestion per stage), what files /
  state each stage must produce.
- **Cast**: the scripted user answers you will give (real data where the
  owner provides it; fixture persona otherwise).

This document is the test spec. A recording that deviates from it is either
a finding about the skill or an update to the spec — decide which, explicitly.

## 2. Record — a REAL session in a sandbox

```sh
npm run story:record -- <name> --kickoff <prompt-file>
```

Starts a real interactive agent session in tmux running the target skill and
snapshots the terminal (with ANSI colors, `capture-pane -e`) into
`harness/stories/<name>/frames.json`. The kickoff prompt MUST include a
sandbox data-home override ("use <dir> instead of ~/.coforce; never touch the
real one") — real inputs are fine, real state is not.

The recorder only records. Drive the session either by `tmux attach` (human)
or agent-driven `tmux send-keys`.

## 3. Driving playbook (hard-won; ignore at your peril)

- **Debounce every navigation**: `Down`, wait ≥1s, then `Enter`. Rapid
  Down+Enter races the TUI and silently selects the wrong option.
- Multi-select lists: `Enter` toggles the highlighted row; re-check the
  `[✔]` states after every toggle before advancing with `Tab`.
- **Multi-line pasted messages do not auto-submit** — send a separate `Enter`
  and confirm the composer cleared.
- Poll with `tmux capture-pane -p` between keys; never fire blind sequences.
- Answers drifted anyway? Use the conversational-correction path (one message
  listing all fixes) — that path is itself part of the flow under test.

## 4. Verify — the capture is a test, not a screenshot

After the session ends, assert the outcome mechanically: the sandbox files
the expected script demanded (schemas, values from your scripted answers),
plus any skill-specific invariants. Record every deviation in `story.md`
under **Findings** with a root-cause class:

- *prompt gap* → the target SKILL.md needs a rule (sediment it);
- *option factuality / behavior bug* → fix the skill or its scripts;
- *spec wrong* → update the expected script;
- *driver ergonomics* → update this playbook.

Never fix a finding by weakening the expected script silently.

## 5. Render & share — capture once, render many

```sh
npm run story:render -- <name> [--speed 1.5]
```

Re-renders `frames.json` (true-color SGR translation) into `replay.html`
(self-contained animated replay — shareable to the share server or GitHub)
and `story.mp4`. Rendering never requires re-running the session; restyle and
re-cut freely.

## 6. The test set

Each story directory (spec + frames + findings) is one entry in the target
skill's interaction test set. Re-record after every meaningful prompt change
and diff the conversation against the spec — that is the regression test for
prompt work. Stories live in `harness/stories/` (gitignored: local dev
material); the tooling and this methodology are the committed product.
