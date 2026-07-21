# GitHub Evidence Library

## Boundary

This stage is independent from JD matching and resume rendering. It produces a reusable profile of source-backed engineering activity:

`GitHub repositories -> raw API snapshots -> tagged evidence entries -> external-writer batches`

The raw and normalized layers never depend on a language model. A model may propose reusable achievement candidates, but each candidate must cite existing evidence IDs.

## Configuration

```json
{
  "github_login": "candidate",
  "projects": [
    {
      "id": "product-suite",
      "name": "Product Suite",
      "repositories": [
        "example/frontend",
        "example/backend"
      ],
      "tags": ["org:example", "domain:developer-tools"]
    }
  ]
}
```

Multiple repositories in the same project are aggregated into one project directory and share `project:<id>` tags.

## Commands

Fetch the complete authored PR history plus authored commits reachable from the default branch or the authored PRs, then build the library:

```bash
python -m shushu_internship_tool.github_evidence sync \
  --config materials/github-sources.json \
  --out private-output/github-profile
```

Rebuild deterministic tags and views without calling GitHub again:

```bash
python -m shushu_internship_tool.github_evidence build \
  --config materials/github-sources.json \
  --raw private-output/github-profile/raw \
  --out private-output/github-profile/library
```

## Output

```text
github-profile/
├── raw/
│   ├── manifest.json
│   └── repositories/<owner>__<repo>/
│       ├── repository.json
│       ├── languages.json
│       ├── pull_requests.json
│       └── commits.json
└── library/
    ├── library.json
    ├── overview.md
    ├── tag-index.json
    ├── writer-contract.json
    └── projects/<project-id>/
        ├── project.json
        ├── evidence.json
        ├── summary.md
        └── writer-inputs/batch-001.json
```

Every normalized entry has namespaced tags such as:

- `project:product-suite`
- `repo:example-frontend`
- `artifact:pull-request`
- `status:merged`
- `tech:typescript`
- `scope:packages-api`
- `work:reliability`
- `label:performance`

Every entry also contains itemized `sources`, including the exact PR or commit URL and its repository URL.

GitHub caps a single PR's commit listing at 250 records. Affected PR entries retain `commit_list_truncated: true`; the PR itself and all other available evidence remain indexed. Do not claim complete per-commit coverage for such a PR without checking its local git graph.

## Outsourcing Bullet Writing

The generated `writer-inputs` are vendor-neutral JSON requests. An external command reads a request from stdin and returns contract-compliant JSON. For Claude Code:

```bash
python -m shushu_internship_tool.github_evidence run-writer \
  --library private-output/github-profile/library/library.json \
  --batch private-output/github-profile/library/projects/product-suite/writer-inputs/batch-001.json \
  --command-json '["claude", "-p", "--model", "opus", "--tools", "", "--no-session-persistence", "--max-budget-usd", "1.00", "--output-format", "json"]' \
  --out private-output/github-profile/library/projects/product-suite/writer-output-001.json
```

The same interface can call Gemini, OpenRouter wrappers, a hosted writing service, or a human-editor bridge. The validator rejects output that cites nonexistent evidence IDs:

```bash
python -m shushu_internship_tool.github_evidence validate-writer \
  --library private-output/github-profile/library/library.json \
  --input writer-output.json
```

`run-writer` refuses batches containing private repository evidence by default. Sending private PR text, titles, or file paths to an external model requires an explicit `--allow-private-sources` flag and should only be done when the repository's confidentiality rules allow it. Local evidence generation does not send data to a model.
