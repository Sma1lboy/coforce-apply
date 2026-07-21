#!/usr/bin/env python3
"""Dependency-free regression checks for the vendored GitHub evidence layer."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(
    0,
    str(
        ROOT
        / ".agents"
        / "skills"
        / "shushu-internship-tool"
        / "scripts"
    ),
)

from shushu_internship_tool.common import write_json  # noqa: E402
from shushu_internship_tool.github_evidence import (  # noqa: E402
    GitHubClient,
    build_library,
    commit_entry,
    fetch_raw,
    load_config,
    merge_commit_history,
    pull_request_entry,
    repo_slug,
    run_external_writer,
    validate_writer_output,
)
from shushu_internship_tool.github_sources import discover_config  # noqa: E402


def sample_pull(
    repository: str = "example/app", number: int = 7, author: str = "candidate"
) -> dict:
    return {
        "number": number,
        "title": "fix: add retry recovery for agent API",
        "body": "Adds regression tests and timeout recovery.",
        "url": f"https://github.com/{repository}/pull/{number}",
        "state": "MERGED",
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-01-02T00:00:00Z",
        "mergedAt": "2026-01-02T00:00:00Z",
        "additions": 120,
        "deletions": 30,
        "changedFiles": 2,
        "commits": {"totalCount": 3, "nodes": [{}, {}, {}]},
        "author": {"login": author},
        "labels": {"nodes": [{"name": "reliability"}]},
        "files": {
            "nodes": [
                {"path": "packages/api/retry.ts"},
                {"path": "packages/api/retry.test.ts"},
            ]
        },
    }


def sample_commit(
    repository: str = "example/app", sha: str = "a" * 40, author: str = "candidate"
) -> dict:
    return {
        "sha": sha,
        "html_url": f"https://github.com/{repository}/commit/{sha}",
        "commit": {
            "message": "feat: add cache (#7)",
            "author": {"date": "2026-01-01T00:00:00Z"},
            "committer": {"date": "2026-01-01T00:00:00Z"},
        },
        "parents": [{"sha": "b" * 40}],
        "author": {"login": author},
    }


def expect_error(fragment: str, fn) -> None:
    try:
        fn()
    except ValueError as error:
        assert fragment in str(error), error
    else:
        raise AssertionError(f"expected ValueError containing {fragment!r}")


with tempfile.TemporaryDirectory(prefix="coforce-evidence-") as temp:
    root = Path(temp)
    config_path = root / "sources.json"
    write_json(
        config_path,
        {
            "github_login": "candidate",
            "projects": [
                {
                    "id": "codefox",
                    "name": "CodeFox",
                    "repositories": [
                        "https://github.com/example/frontend",
                        "example/backend",
                    ],
                    "tags": ["org:codefox"],
                }
            ],
        },
    )
    config = load_config(config_path)
    assert config["projects"][0]["repositories"] == [
        "example/frontend",
        "example/backend",
    ]

    scoped_config_path = root / "maintained-sources.json"
    write_json(
        scoped_config_path,
        {
            "repositories": [
                {
                    "repo": "example/app",
                    "authors": ["candidate", "candidate-alt"],
                    "project": "Agent Runtime",
                    "tags": ["domain:agents"],
                }
            ]
        },
    )
    scoped_config = load_config(scoped_config_path)
    assert scoped_config["sources"] == [
        {
            "repo": "example/app",
            "authors": ["candidate", "candidate-alt"],
            "project": "Agent Runtime",
            "tags": ["domain:agents"],
        }
    ]
    assert scoped_config["projects"][0]["repository_authors"] == {
        "example/app": ["candidate", "candidate-alt"]
    }

    class ScopedClient:
        calls: list[tuple[str, str]] = []

        @staticmethod
        def repository(repository: str) -> dict:
            assert repository == "example/app"
            return {"visibility": "public", "default_branch": "main"}

        @staticmethod
        def languages(repository: str) -> dict:
            assert repository == "example/app"
            return {"TypeScript": 100}

        @classmethod
        def pull_requests(cls, repository: str, login: str) -> list[dict]:
            cls.calls.append(("pulls", login))
            return [sample_pull(repository, 7 if login == "candidate" else 8, login)]

        @classmethod
        def commits(cls, repository: str, login: str) -> list[dict]:
            cls.calls.append(("commits", login))
            return [sample_commit(repository, ("a" if login == "candidate" else "c") * 40, login)]

        @staticmethod
        def pull_commit_nodes(repository: str, number: int) -> list[dict]:
            return []

    scoped_raw = root / "scoped-raw"
    fetch_raw(scoped_config, scoped_raw, ScopedClient())
    assert ScopedClient.calls == [
        ("pulls", "candidate"),
        ("commits", "candidate"),
        ("pulls", "candidate-alt"),
        ("commits", "candidate-alt"),
    ]
    scoped_library = build_library(scoped_config, scoped_raw, root / "scoped-library")
    assert scoped_library["sources"] == scoped_config["sources"]
    assert {entry["author"] for entry in scoped_library["entries"]} == {
        "candidate",
        "candidate-alt",
    }

    class FakeSourceClient:
        @staticmethod
        def login() -> str:
            return "candidate"

        @staticmethod
        def accessible_repositories() -> list[str]:
            return ["candidate/app", "example/shared"]

        @staticmethod
        def authored_pr_repositories(login: str) -> tuple[list[str], bool]:
            assert login == "candidate"
            return ["outside/contribution", "candidate/app"], True

    discovered = discover_config(FakeSourceClient())
    assert [
        project["repositories"][0] for project in discovered["projects"]
    ] == ["candidate/app", "example/shared", "outside/contribution"]
    assert discovered["discovery"]["authored_pr_search_capped"] is True

    project = config["projects"][0]
    pull = pull_request_entry(
        project, "example/frontend", sample_pull("example/frontend"), {"TypeScript": 100}
    )
    assert "artifact:pull-request" in pull["tags"]
    assert "work:reliability" in pull["tags"]
    assert "work:testing" in pull["tags"]
    assert pull["sources"][0]["url"].endswith("/pull/7")

    commit = commit_entry(
        project, "example/frontend", sample_commit("example/frontend"), {"TypeScript": 100}
    )
    assert commit["relations"][0]["url"].endswith("/pull/7")

    pulls = [
        {
            "number": 9,
            "commits": {
                "nodes": [
                    {
                        "commit": {
                            "oid": "b" * 40,
                            "url": "https://github.com/example/app/commit/" + "b" * 40,
                            "message": "fix: preserve unmerged work",
                            "authoredDate": "2026-02-01T00:00:00Z",
                            "committedDate": "2026-02-01T00:00:00Z",
                            "author": {"user": {"login": "candidate"}},
                        }
                    }
                ]
            },
        }
    ]
    merged = merge_commit_history([sample_commit()], pulls, "candidate")
    assert {item["sha"] for item in merged} == {"a" * 40, "b" * 40}
    assert next(item for item in merged if item["sha"] == "b" * 40)[
        "history_sources"
    ] == ["pull_request"]

    def runner(args, **kwargs):
        second = any(item == "endCursor=cursor-1" for item in args)
        payload = {
            "data": {
                "repository": {
                    "pullRequest": {
                        "commits": {
                            "nodes": [
                                {"commit": {"oid": ("b" if second else "a") * 40}}
                            ],
                            "pageInfo": {
                                "hasNextPage": not second,
                                "endCursor": None if second else "cursor-1",
                            },
                        }
                    }
                }
            }
        }
        return subprocess.CompletedProcess(args, 0, json.dumps(payload), "")

    nodes = GitHubClient(runner=runner).pull_commit_nodes("example/app", 9)
    assert [node["commit"]["oid"] for node in nodes] == ["a" * 40, "b" * 40]

    raw = root / "raw"
    for index, repository in enumerate(project["repositories"], start=1):
        repo_dir = raw / "repositories" / repo_slug(repository)
        repo_dir.mkdir(parents=True)
        write_json(repo_dir / "repository.json", {"visibility": "public"})
        write_json(repo_dir / "languages.json", {"TypeScript": 100})
        write_json(repo_dir / "pull_requests.json", [sample_pull(repository, index)])
        write_json(repo_dir / "commits.json", [sample_commit(repository, str(index) * 40)])
    library = build_library(config, raw, root / "library")
    assert library["entry_count"] == 4
    assert len(library["projects"]) == 1
    assert (root / "library/projects/codefox/writer-inputs/batch-001.json").exists()

    errors = validate_writer_output(
        {"entries": [{"id": "known"}]},
        {"candidates": [{"bullet": "Built it.", "evidence_ids": ["missing"]}]},
    )
    assert errors == ["candidates[0] references unknown evidence IDs: ['missing']"]

    private = {
        "id": "private:pr:1",
        "repository": "example/private",
        "source_visibility": "private",
    }
    expect_error(
        "explicit private-source approval",
        lambda: run_external_writer(
            {"entries": [private]},
            {"evidence": [{"id": private["id"]}]},
            ["writer"],
        ),
    )

print("github evidence: attribution, pagination, aggregation, writer guardrails ✓")
