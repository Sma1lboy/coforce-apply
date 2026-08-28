# Installing CoForce Apply

CoForce Apply is a set of agent skills plus the scripts they call. There is no
package to install and no service to sign up for: you clone a repository, start
Claude Code inside it, and run `/setup`.

- [Prerequisites](#prerequisites) — what to install first, per platform
- [Choose an install mode](#choose-an-install-mode) — clone, private fork, or skills-only
- [Verify the install](#verify-the-install)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Install troubleshooting](#install-troubleshooting)

---

## Prerequisites

Only the first two are needed to get a tailored PDF out of `/tailor`. Everything
else buys you a specific feature, and nothing silently degrades — a skill that
needs a missing binary says so.

| What | Needed for | Notes |
|---|---|---|
| **Claude Code** | everything | The runtime the skills run in. It is the only implemented runtime today. |
| **Node ≥ 22** | every script | `package.json` sets the floor. The repo has **no npm dependencies** — every script runs on Node builtins. |
| **A LaTeX engine** | rendering any resume | Tried in order: `latexmk` → `pdflatex` → `tectonic`. Chinese resumes need `xelatex` or `tectonic` specifically. |
| **poppler-utils** (`pdfinfo`, `pdftotext`) | approving any resume | Not optional in practice — see the warning below. |
| **`gh`, authenticated** | `/experience`, private-fork setup | `gh auth login` once. Used read-only, through `gh api`. |
| **Python 3** | `/experience refresh` only | No pip packages; the evidence scripts are dependency-free. |
| **Chrome + Claude in Chrome** | `/apply` only | `/apply` drives your own visible, logged-in browser. |
| **`pandoc`** | `.docx` output only | macOS falls back to `textutil`; other platforms do not. |
| **`openssl`** | ATS auto-registration only | Generates the account password. |

> [!IMPORTANT]
> **Install poppler-utils, not just a LaTeX engine.** The review gate runs three
> machine checks — one page, page actually filled, text extractable by an ATS —
> and all three are computed with `pdfinfo` and `pdftotext`. Without those
> binaries the checks never return true, so a resume renders fine and can then
> never be approved or exported, with nothing obviously pointing at the cause.

### macOS

```sh
brew install node gh poppler
brew install --cask mactex-no-gui   # or: brew install tectonic  (much smaller)
brew install pandoc                 # optional, for .docx output
```

### Debian / Ubuntu

```sh
sudo apt install nodejs npm gh poppler-utils \
     texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended latexmk
sudo apt install pandoc             # optional, for .docx output
```

`texlive-latex-extra` and `texlive-fonts-recommended` are not optional padding:
the bundled resume template pulls in `fullpage`, `titlesec`, `marvosym`,
`enumitem`, `fancyhdr` and `tabularx`, and a `texlive-latex-base`-only install
fails at compile time with `File 'fullpage.sty' not found`. If you would rather
not install a full TeX distribution, install [Tectonic](https://tectonic-typesetting.github.io/)
instead — it is one binary and fetches the packages a document needs on first
run.

### Windows

Not supported today. Binary detection looks for `/usr/bin/which`, so on Windows
every LaTeX and poppler binary reads as missing even when it is installed. Use
**WSL2** and follow the Debian/Ubuntu instructions inside it.

---

## Choose an install mode

|  | Best for | Data lives in |
|---|---|---|
| **1. Clone** | trying it out, one machine | `~/.coforce/` |
| **2. Private fork** *(recommended)* | using it for a real search, across machines | `<checkout>/.coforce/`, synced through your private fork |
| **3. Skills only** | you already have an agent skills directory and no interest in a checkout | `~/.coforce/` |

Every skill resolves the data home the same way, in this order:

```
$COFORCE_HOME  →  <checkout>/.coforce/  (if that directory exists)  →  ~/.coforce
```

### 1. Clone

```sh
git clone https://github.com/Sma1lboy/coforce-apply
cd coforce-apply
claude
```

Then run `/setup` in the session. The canonical skill tree is `.agents/skills`;
`.claude/skills` is a symlink to it, so Claude Code picks the skills up with no
global installation and no second copy.

### 2. Private fork (recommended)

Your profile, tracker, standing instructions, and per-application archives live
*inside the checkout* at `.coforce/` and travel with your fork — supplement your
profile on the laptop, apply from the desktop, everything follows.

```sh
gh repo fork Sma1lboy/coforce-apply --clone --fork-name my-coforce
cd my-coforce
gh repo edit --visibility private --accept-visibility-change-consequences
claude   # then run /setup and choose "private-fork sync"
```

Setup will not create the in-repo data home until it has verified two things:
that `origin` is not the public upstream, and that `gh repo view --json isPrivate`
prints `true`. If `gh` is unavailable or there is no remote yet, it stops and
asks rather than guessing — refusal is the default.

> [!WARNING]
> The privacy check lives in the setup flow, not in the path resolver. If you
> create `.coforce/` by hand inside a **public** checkout, every skill will
> happily write your personal data there and nothing will stop you from
> committing it. Let `/setup` create it.

Syncing is your normal git flow: `git pull` / `git push` on your fork, and
`git pull upstream main` to take new versions of the tool. Generated artifacts
under `out/` are never synced, and ATS passwords stay in the macOS Keychain —
never in a file.

### 3. Skills only (no checkout)

Copy the skill tree into your agent's own skills directory:

```sh
git clone --depth 1 https://github.com/Sma1lboy/coforce-apply
cp -R coforce-apply/.agents/skills/* ~/.claude/skills/   # Claude Code
cp -R coforce-apply/.agents/lib     ~/.claude/lib        # shared script utils
```

The layout rule is the whole requirement: the skill directories and a sibling
`lib/` one level above them, because scripts import `../../../lib/…`. The same
recipe works for any agent runtime with a global skills directory.

In this mode the data home is always `~/.coforce` (or `$COFORCE_HOME`), so
private-fork sync is not available. The `coforce` router skill ships with the
set, so intent routing works without the repo's `CLAUDE.md`. Skip `harness` —
it is repo-development only and needs the fixtures.

---

## Verify the install

```sh
node -v                  # ≥ 22
python3 -V               # any 3.x
gh auth status           # logged in
pdfinfo -v               # poppler present
latexmk -v || pdflatex --version || tectonic -V
```

From a checkout you can also run the full mock end-to-end suite, which touches
no network, makes no LLM calls, and never reads your real data home:

```sh
npm run harness
```

Then, in Claude Code, the smallest real test — one job description in, one
tailored PDF out:

```
/tailor https://some-job-posting-url
```

---

## Updating

| Mode | How |
|---|---|
| Clone | `git pull` |
| Private fork | `git pull upstream main` (your `.coforce/` data is untouched) |
| Skills only | re-run the two `cp -R` commands from a fresh `--depth 1` clone |

Updating never migrates away your data. `config.json` is versioned and the
config loader migrates the older `preferences.json` + `apply-config.json` pair
on first read.

---

## Uninstalling

Everything personal is in one directory, so removal is exact:

```sh
rm -rf ~/.coforce                      # or <checkout>/.coforce in fork mode
rm -rf ~/.claude/skills/{apply,campaign,coforce,experience,profile,setup,start,tailor,tracker}
rm -rf ~/.claude/lib                   # skills-only installs
rm -rf coforce-apply                   # the checkout, if you made one
```

If you let `/apply` register ATS accounts, the passwords are in the macOS
Keychain under service names of the form `coforce:<ats-host>`. The hosts are
listed in `~/.coforce/accounts.json`, so read that file **before** deleting the
data home, then remove each entry:

```sh
security delete-generic-password -s "coforce:<ats-host>"
```

---

## Install troubleshooting

**`File 'fullpage.sty' not found` (or `titlesec`, `marvosym`, …)**
A LaTeX engine is installed but the template's packages are not. The engine
fallback chain does not skip an engine that exists but is incomplete, so
installing the missing packages — or `tectonic`, and removing `latexmk` from
`PATH` — is the fix. See the Debian/Ubuntu package list above.

**A resume renders but can never be approved**
`pdfinfo` / `pdftotext` are missing. Install poppler-utils and re-run the
campaign; the one-page, page-coverage, and extractability checks all depend on
them.

**`No compatible LaTeX compiler found` although one is installed**
Binary lookup shells out to `/usr/bin/which`. If your system has no binary at
exactly that path (Windows, some minimal or Nix-style Linux images), every
engine reads as missing. Use WSL2, or a distribution with a standard layout.

**`gh auth login` needed / `/experience` cannot infer the author**
The Tier 0 refresh reads GitHub through `gh api`. Authenticate once; no extra
scopes are requested beyond what `gh auth login` grants.

**Port 4517 already in use**
The console picks up a port argument: `node .agents/skills/tracker/scripts/board.mjs ~/.coforce/applications.json --serve 4600`, or `PORT=4600 .agents/skills/tracker/scripts/start_web.sh`.

**The console shows an empty board**
That is the correct first-run state. Run `/start` (or use Discover → *Build
resume*) to put postings on it.
