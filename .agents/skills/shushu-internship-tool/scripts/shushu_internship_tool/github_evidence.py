from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Sequence

from .common import ensure_dir, load_json, write_json, write_text


SCHEMA_VERSION = "1.0"

PULL_REQUEST_QUERY = """
query($searchQuery: String!, $endCursor: String) {
  search(query: $searchQuery, type: ISSUE, first: 100, after: $endCursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        title
        body
        url
        state
        isDraft
        createdAt
        updatedAt
        mergedAt
        additions
        deletions
        changedFiles
        commits(first: 100) {
          totalCount
          nodes {
            commit {
              oid
              url
              message
              authoredDate
              committedDate
              author { user { login } }
            }
          }
        }
        author { login }
        labels(first: 30) { nodes { name } }
        files(first: 100) {
          nodes { path additions deletions changeType }
        }
      }
    }
  }
}
""".strip()

PULL_COMMIT_QUERY = """
query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(first: 100, after: $endCursor) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          commit {
            oid
            url
            message
            authoredDate
            committedDate
            author { user { login } }
          }
        }
      }
    }
  }
}
""".strip()

LANGUAGE_BY_SUFFIX = {
    ".c": "c",
    ".cc": "cpp",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".css": "css",
    ".go": "go",
    ".html": "html",
    ".java": "java",
    ".js": "javascript",
    ".jsx": "javascript",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".m": "objective-c",
    ".md": "markdown",
    ".php": "php",
    ".proto": "protobuf",
    ".py": "python",
    ".rb": "ruby",
    ".rs": "rust",
    ".scss": "scss",
    ".sh": "shell",
    ".sql": "sql",
    ".swift": "swift",
    ".tsx": "typescript",
    ".ts": "typescript",
    ".vue": "vue",
    ".yaml": "yaml",
    ".yml": "yaml",
}

WORK_TAG_RULES = {
    "work:agent-ai": ("agent", "llm", "model", "prompt", "rag", "mcp", "inference"),
    "work:api-backend": (
        "api",
        "backend",
        "server",
        "grpc",
        "graphql",
        "endpoint",
        "websocket",
    ),
    "work:ci-cd": ("ci", "workflow", "pipeline", "github actions", "release", "deploy"),
    "work:data-storage": (
        "database",
        "postgres",
        "mysql",
        "sqlite",
        "redis",
        "migration",
        "schema",
    ),
    "work:developer-experience": (
        "cli",
        "developer",
        "tooling",
        "devtools",
        "workflow",
        "worktree",
    ),
    "work:documentation": ("docs", "documentation", "readme", ".md"),
    "work:frontend": (
        "frontend",
        "component",
        "react",
        "solidjs",
        "next.js",
        "ui",
        "ux",
        ".tsx",
    ),
    "work:mobile": ("android", "ios", "expo", "react native", "swift", "kotlin"),
    "work:observability": (
        "log*",
        "metric*",
        "trace",
        "monitor*",
        "telemetry",
        "debug*",
    ),
    "work:performance": (
        "performance",
        "latency",
        "cach*",
        "optimiz*",
        "throughput",
        "memory",
    ),
    "work:reliability": (
        "reliab*",
        "recover*",
        "retry",
        "fallback",
        "resume",
        "crash*",
        "race",
        "timeout",
    ),
    "work:security": (
        "auth*",
        "security",
        "token",
        "permission",
        "secret",
        "privacy",
        "sanitiz*",
    ),
    "work:testing": ("test*", "spec", "fixture", "e2e", "regression", "coverage"),
}

CHANGE_TAG_RULES = {
    "work:feature": ("feat", "feature", "add", "implement", "introduce", "support"),
    "work:fix": ("fix", "bug", "correct", "resolve", "repair", "harden"),
    "work:refactor": ("refactor", "rework", "cleanup", "simplify", "migrate"),
    "work:test": ("test", "spec", "coverage", "regression"),
    "work:docs": ("docs", "documentation", "readme"),
}


def utc_now() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "unknown"


def normalize_repo(value: str) -> str:
    text = value.strip().rstrip("/")
    text = re.sub(r"^https?://github\.com/", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\.git$", "", text, flags=re.IGNORECASE)
    if not re.fullmatch(r"[^/\s]+/[^/\s]+", text):
        raise ValueError(f"Invalid GitHub repository: {value}")
    return text


def repo_slug(repository: str) -> str:
    return repository.replace("/", "__")


def load_config(path: str | Path) -> dict[str, Any]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise ValueError("GitHub evidence config must be a JSON object")
    source_repositories = payload.get("repositories")
    if isinstance(source_repositories, list):
        if not source_repositories:
            raise ValueError("repositories must be a non-empty array")
        projects_by_id: dict[str, dict[str, Any]] = {}
        seen_repositories: set[str] = set()
        normalized_sources: list[dict[str, Any]] = []
        for raw in source_repositories:
            if not isinstance(raw, dict):
                raise ValueError("Each source repository must be a JSON object")
            repository = normalize_repo(str(raw.get("repo") or ""))
            if repository.lower() in seen_repositories:
                raise ValueError(f"Duplicate source repository: {repository}")
            seen_repositories.add(repository.lower())
            authors = sorted(
                {
                    str(author).strip()
                    for author in raw.get("authors", [])
                    if str(author).strip()
                },
                key=str.lower,
            )
            if not authors:
                raise ValueError(f"Source {repository} must declare authors")
            project_name = str(raw.get("project") or repository.split("/", 1)[1]).strip()
            project_id = slugify(project_name)
            tags = sorted(
                {
                    str(tag).strip().lower()
                    for tag in raw.get("tags", [])
                    if str(tag).strip()
                }
            )
            project = projects_by_id.setdefault(
                project_id,
                {
                    "id": project_id,
                    "name": project_name,
                    "repositories": [],
                    "repository_authors": {},
                    "tags": [],
                },
            )
            project["repositories"].append(repository)
            project["repository_authors"][repository] = authors
            project["tags"] = sorted(set(project["tags"]) | set(tags))
            source = {"repo": repository, "authors": authors}
            if raw.get("project"):
                source["project"] = project_name
            if tags:
                source["tags"] = tags
            normalized_sources.append(source)
        normalized_sources.sort(key=lambda item: item["repo"].lower())
        logins = sorted(
            {author for source in normalized_sources for author in source["authors"]},
            key=str.lower,
        )
        return {
            "github_login": logins[0],
            "github_logins": logins,
            "sources": normalized_sources,
            "projects": list(projects_by_id.values()),
        }
    login = str(payload.get("github_login") or "").strip()
    if not login:
        raise ValueError("github_login is required")
    projects = payload.get("projects")
    if not isinstance(projects, list) or not projects:
        raise ValueError("projects must be a non-empty array")

    normalized_projects: list[dict[str, Any]] = []
    project_ids: set[str] = set()
    repositories: set[str] = set()
    for raw in projects:
        if not isinstance(raw, dict):
            raise ValueError("Each project must be a JSON object")
        project_id = slugify(str(raw.get("id") or raw.get("name") or ""))
        if project_id in project_ids:
            raise ValueError(f"Duplicate project id: {project_id}")
        project_ids.add(project_id)
        raw_repositories = raw.get("repositories")
        if not isinstance(raw_repositories, list) or not raw_repositories:
            raise ValueError(f"Project {project_id} must contain repositories")
        project_repositories = [normalize_repo(str(item)) for item in raw_repositories]
        overlap = repositories.intersection(project_repositories)
        if overlap:
            raise ValueError(
                f"Repositories assigned to multiple projects: {sorted(overlap)}"
            )
        repositories.update(project_repositories)
        normalized_projects.append(
            {
                "id": project_id,
                "name": str(raw.get("name") or project_id).strip(),
                "repositories": project_repositories,
                "tags": sorted(
                    {
                        str(tag).strip().lower()
                        for tag in raw.get("tags", [])
                        if str(tag).strip()
                    }
                ),
            }
        )
    sources = [
        {"repo": repository, "authors": [login]}
        for project in normalized_projects
        for repository in project["repositories"]
    ]
    for project in normalized_projects:
        project["repository_authors"] = {
            repository: [login] for repository in project["repositories"]
        }
    return {
        "github_login": login,
        "github_logins": [login],
        "sources": sources,
        "projects": normalized_projects,
    }


class GitHubClient:
    def __init__(
        self,
        gh_binary: str = "gh",
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    ):
        self.gh_binary = gh_binary
        self.runner = runner

    def _json(self, args: Sequence[str]) -> Any:
        completed = self.runner(
            [self.gh_binary, *args],
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(completed.stdout)

    def repository(self, repository: str) -> dict[str, Any]:
        return self._json(["api", f"repos/{repository}"])

    def languages(self, repository: str) -> dict[str, int]:
        return self._json(["api", f"repos/{repository}/languages"])

    def pull_requests(self, repository: str, login: str) -> list[dict[str, Any]]:
        cursor: str | None = None
        results: list[dict[str, Any]] = []
        while True:
            args = [
                "api",
                "graphql",
                "-f",
                f"query={PULL_REQUEST_QUERY}",
                "-F",
                f"searchQuery=repo:{repository} is:pr author:{login}",
            ]
            if cursor:
                args.extend(["-F", f"endCursor={cursor}"])
            payload = self._json(args)
            search = payload["data"]["search"]
            results.extend(
                node
                for node in search.get("nodes", [])
                if isinstance(node, dict) and node.get("url")
            )
            page_info = search["pageInfo"]
            if not page_info.get("hasNextPage"):
                return results
            cursor = str(page_info["endCursor"])

    def commits(self, repository: str, login: str) -> list[dict[str, Any]]:
        return self._paginated_rest_commits(
            f"repos/{repository}/commits", ["-f", f"author={login}"]
        )

    def pull_commit_nodes(self, repository: str, number: int) -> list[dict[str, Any]]:
        owner, name = repository.split("/", 1)
        cursor: str | None = None
        nodes: list[dict[str, Any]] = []
        while True:
            args = [
                "api",
                "graphql",
                "-f",
                f"query={PULL_COMMIT_QUERY}",
                "-F",
                f"owner={owner}",
                "-F",
                f"name={name}",
                "-F",
                f"number={number}",
            ]
            if cursor:
                args.extend(["-F", f"endCursor={cursor}"])
            payload = self._json(args)
            connection = payload["data"]["repository"]["pullRequest"]["commits"]
            nodes.extend(
                item for item in connection.get("nodes", []) if isinstance(item, dict)
            )
            page_info = connection["pageInfo"]
            if not page_info.get("hasNextPage"):
                return nodes
            cursor = str(page_info["endCursor"])

    def _paginated_rest_commits(
        self, endpoint: str, extra_args: list[str]
    ) -> list[dict[str, Any]]:
        page = 1
        results: list[dict[str, Any]] = []
        while True:
            payload = self._json(
                [
                    "api",
                    "--method",
                    "GET",
                    endpoint,
                    *extra_args,
                    "-F",
                    "per_page=100",
                    "-F",
                    f"page={page}",
                ]
            )
            if not isinstance(payload, list):
                raise ValueError(f"Unexpected commit response for {endpoint}")
            results.extend(item for item in payload if isinstance(item, dict))
            if len(payload) < 100:
                return results
            page += 1


def fetch_raw(
    config: dict[str, Any], raw_dir: Path, client: GitHubClient
) -> dict[str, Any]:
    repositories = [
        (project, repository)
        for project in config["projects"]
        for repository in project["repositories"]
    ]
    manifest: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "github_logins": config["github_logins"],
        "fetched_at": utc_now(),
        "repositories": [],
    }
    for project, repository in repositories:
        target = ensure_dir(raw_dir / "repositories" / repo_slug(repository))
        metadata = client.repository(repository)
        languages = client.languages(repository)
        authors = project["repository_authors"][repository]
        pulls_by_number: dict[int, dict[str, Any]] = {}
        commits_by_sha: dict[str, dict[str, Any]] = {}
        for login in authors:
            author_pulls = client.pull_requests(repository, login)
            _expand_truncated_pull_commits(repository, author_pulls, client)
            for pull in author_pulls:
                number = int(pull.get("number") or 0)
                if not number:
                    continue
                existing = pulls_by_number.get(number)
                if existing is None:
                    existing = dict(pull)
                    existing["_coforce_authors"] = []
                    pulls_by_number[number] = existing
                if login not in existing["_coforce_authors"]:
                    existing["_coforce_authors"].append(login)
            default_branch_commits = client.commits(repository, login)
            for commit in merge_commit_history(default_branch_commits, author_pulls, login):
                sha = str(commit.get("sha") or "")
                if not sha:
                    continue
                existing = commits_by_sha.get(sha)
                if existing is None:
                    existing = dict(commit)
                    existing["_coforce_authors"] = []
                    commits_by_sha[sha] = existing
                if login not in existing["_coforce_authors"]:
                    existing["_coforce_authors"].append(login)
                existing["history_sources"] = sorted(
                    set(existing.get("history_sources") or [])
                    | set(commit.get("history_sources") or [])
                )
                existing["pull_request_numbers"] = sorted(
                    set(existing.get("pull_request_numbers") or [])
                    | set(commit.get("pull_request_numbers") or [])
                )
        pulls = sorted(pulls_by_number.values(), key=lambda item: int(item["number"]))
        commits = sorted(
            commits_by_sha.values(),
            key=lambda item: str(
                ((item.get("commit") or {}).get("author") or {}).get("date") or ""
            ),
            reverse=True,
        )
        write_json(target / "repository.json", metadata)
        write_json(target / "languages.json", languages)
        write_json(target / "pull_requests.json", pulls)
        write_json(target / "commits.json", commits)
        manifest["repositories"].append(
            {
                "repository": repository,
                "authors": authors,
                "visibility": metadata.get("visibility")
                or ("private" if metadata.get("private") else "public"),
                "default_branch": metadata.get("default_branch"),
                "pull_request_count": len(pulls),
                "commit_count": len(commits),
                "commit_scope": "maintained_authors_default_branch_plus_pull_requests",
                "path": f"repositories/{repo_slug(repository)}",
            }
        )
    write_json(raw_dir / "manifest.json", manifest)
    return manifest


def _expand_truncated_pull_commits(
    repository: str, pulls: list[dict[str, Any]], client: GitHubClient
) -> None:
    for pull in pulls:
        connection = pull.get("commits") or {}
        nodes = connection.get("nodes") or []
        if int(connection.get("totalCount") or 0) <= len(nodes):
            continue
        connection["nodes"] = client.pull_commit_nodes(repository, int(pull["number"]))
        connection["apiTruncated"] = int(connection.get("totalCount") or 0) > len(
            connection["nodes"]
        )
        pull["commits"] = connection


def merge_commit_history(
    default_branch_commits: list[dict[str, Any]],
    pulls: list[dict[str, Any]],
    login: str,
) -> list[dict[str, Any]]:
    by_sha: dict[str, dict[str, Any]] = {}
    for raw in default_branch_commits:
        commit = dict(raw)
        sha = str(commit.get("sha") or "")
        if not sha:
            continue
        commit["history_sources"] = ["default_branch"]
        commit["pull_request_numbers"] = []
        by_sha[sha] = commit

    for pull in pulls:
        number = int(pull.get("number") or 0)
        commit_connection = pull.get("commits") or {}
        for node in commit_connection.get("nodes") or []:
            raw = (node or {}).get("commit") or {}
            author_login = ((raw.get("author") or {}).get("user") or {}).get("login")
            if not author_login or str(author_login).lower() != login.lower():
                continue
            sha = str(raw.get("oid") or "")
            if not sha:
                continue
            commit = by_sha.get(sha)
            if commit is None:
                commit = {
                    "sha": sha,
                    "html_url": raw.get("url"),
                    "commit": {
                        "message": raw.get("message") or "",
                        "author": {"date": raw.get("authoredDate")},
                        "committer": {"date": raw.get("committedDate")},
                    },
                    "author": {"login": author_login} if author_login else None,
                    "parents": [],
                    "history_sources": [],
                    "pull_request_numbers": [],
                }
                by_sha[sha] = commit
            if "pull_request" not in commit["history_sources"]:
                commit["history_sources"].append("pull_request")
            if number and number not in commit["pull_request_numbers"]:
                commit["pull_request_numbers"].append(number)
    return sorted(
        by_sha.values(),
        key=lambda item: str(
            ((item.get("commit") or {}).get("author") or {}).get("date") or ""
        ),
        reverse=True,
    )


def _repo_url(repository: str) -> str:
    return f"https://github.com/{repository}"


def _source(source_type: str, source_id: str, url: str, label: str) -> dict[str, str]:
    return {"id": source_id, "type": source_type, "url": url, "label": label}


def _file_tags(paths: list[str]) -> set[str]:
    tags: set[str] = set()
    scopes: Counter[str] = Counter()
    for raw_path in paths:
        path = Path(raw_path)
        language = LANGUAGE_BY_SUFFIX.get(path.suffix.lower())
        if language:
            tags.add(f"tech:{language}")
        parts = [part for part in path.parts if part not in {".", ".."}]
        if parts:
            scope = parts[0]
            if scope in {"apps", "crates", "packages", "services"} and len(parts) > 1:
                scope = f"{scope}-{parts[1]}"
            scopes[slugify(scope)] += 1
    tags.update(f"scope:{scope}" for scope, _ in scopes.most_common(4))
    return tags


def _semantic_tags(text: str) -> set[str]:
    lowered = text.lower()

    def matches(term: str) -> bool:
        if term.startswith(".") or " " in term:
            return term in lowered
        if term.endswith("*"):
            stem = re.escape(term[:-1])
            return re.search(rf"(?<![a-z0-9]){stem}[a-z0-9_-]*", lowered) is not None
        escaped = re.escape(term)
        return re.search(rf"(?<![a-z0-9]){escaped}(?![a-z0-9])", lowered) is not None

    tags = {
        tag
        for tag, terms in WORK_TAG_RULES.items()
        if any(matches(term) for term in terms)
    }
    first_line = lowered.splitlines()[0] if lowered else ""
    for tag, terms in CHANGE_TAG_RULES.items():
        if any(
            re.search(rf"(?:^|\W){re.escape(term)}(?:\W|$)", first_line)
            for term in terms
        ):
            tags.add(tag)
    return tags


def _base_tags(project: dict[str, Any], repository: str, artifact: str) -> set[str]:
    return {
        f"project:{project['id']}",
        f"repo:{slugify(repository)}",
        f"artifact:{artifact}",
        *project.get("tags", []),
    }


def _repo_language_tags(languages: dict[str, Any]) -> set[str]:
    ranked = sorted(languages.items(), key=lambda item: int(item[1]), reverse=True)
    return {f"repo-tech:{slugify(str(language))}" for language, _ in ranked[:5]}


def pull_request_entry(
    project: dict[str, Any],
    repository: str,
    pull: dict[str, Any],
    languages: dict[str, Any],
    visibility: str = "public",
) -> dict[str, Any]:
    number = int(pull["number"])
    files = [
        item
        for item in (pull.get("files") or {}).get("nodes", [])
        if isinstance(item, dict)
    ]
    paths = [str(item.get("path") or "") for item in files if item.get("path")]
    status = (
        "merged"
        if pull.get("mergedAt")
        else str(pull.get("state") or "unknown").lower()
    )
    tags = _base_tags(project, repository, "pull-request")
    tags.add(f"status:{status}")
    tags.update(_file_tags(paths))
    tags.update(
        _semantic_tags(
            "\n".join(
                [str(pull.get("title") or ""), str(pull.get("body") or ""), *paths]
            )
        )
    )
    tags.update(
        f"label:{slugify(str(item.get('name')))}"
        for item in (pull.get("labels") or {}).get("nodes", [])
        if item.get("name")
    )
    if not any(tag.startswith("tech:") for tag in tags):
        tags.update(_repo_language_tags(languages))
    pr_source_id = f"{repository}#pr-{number}"
    attributed_authors = sorted(
        {str(item) for item in pull.get("_coforce_authors") or [] if str(item)}
    )
    author = str((pull.get("author") or {}).get("login") or "").strip()
    if not author and len(attributed_authors) == 1:
        author = attributed_authors[0]
    return {
        "id": f"{project['id']}:pr:{slugify(repository)}:{number}",
        "project_id": project["id"],
        "project_name": project["name"],
        "repository": repository,
        "author": author or None,
        "source_visibility": visibility,
        "artifact": "pull_request",
        "title": str(pull.get("title") or "").strip(),
        "body": str(pull.get("body") or "").strip(),
        "status": status,
        "authored_at": pull.get("createdAt"),
        "updated_at": pull.get("updatedAt"),
        "merged_at": pull.get("mergedAt"),
        "stats": {
            "additions": int(pull.get("additions") or 0),
            "deletions": int(pull.get("deletions") or 0),
            "changed_files": int(pull.get("changedFiles") or 0),
            "commits": int((pull.get("commits") or {}).get("totalCount") or 0),
        },
        "files": paths,
        "files_truncated": int(pull.get("changedFiles") or 0) > len(paths),
        "commit_list_truncated": bool((pull.get("commits") or {}).get("apiTruncated"))
        or int((pull.get("commits") or {}).get("totalCount") or 0)
        > len((pull.get("commits") or {}).get("nodes") or []),
        "tags": sorted(tags),
        "sources": [
            _source(
                "pull_request",
                pr_source_id,
                str(pull["url"]),
                f"{repository} PR #{number}",
            ),
            _source(
                "repository",
                f"{repository}#repository",
                _repo_url(repository),
                repository,
            ),
        ],
    }


def commit_entry(
    project: dict[str, Any],
    repository: str,
    commit: dict[str, Any],
    languages: dict[str, Any],
    visibility: str = "public",
) -> dict[str, Any]:
    sha = str(commit.get("sha") or "")
    commit_data = commit.get("commit") or {}
    message = str(commit_data.get("message") or "").strip()
    title = message.splitlines()[0] if message else sha[:12]
    author = commit_data.get("author") or {}
    tags = _base_tags(project, repository, "commit")
    tags.update(_semantic_tags(message))
    tags.update(_repo_language_tags(languages))
    parents = commit.get("parents") or []
    if len(parents) > 1 or title.lower().startswith("merge "):
        tags.add("work:merge")
    relation_match = re.search(r"\(#(\d+)\)\s*$", title)
    relation_numbers = {
        int(item) for item in commit.get("pull_request_numbers") or [] if int(item) > 0
    }
    if relation_match:
        relation_numbers.add(int(relation_match.group(1)))
    relations: list[dict[str, Any]] = []
    for number in sorted(relation_numbers):
        relations.append(
            {
                "type": "pull_request",
                "number": number,
                "url": f"{_repo_url(repository)}/pull/{number}",
            }
        )
    url = str(commit.get("html_url") or f"{_repo_url(repository)}/commit/{sha}")
    attributed_authors = sorted(
        {str(item) for item in commit.get("_coforce_authors") or [] if str(item)}
    )
    author_login = str((commit.get("author") or {}).get("login") or "").strip()
    if not author_login and len(attributed_authors) == 1:
        author_login = attributed_authors[0]
    return {
        "id": f"{project['id']}:commit:{slugify(repository)}:{sha}",
        "project_id": project["id"],
        "project_name": project["name"],
        "repository": repository,
        "author": author_login or None,
        "source_visibility": visibility,
        "artifact": "commit",
        "title": title,
        "body": message,
        "status": "committed",
        "authored_at": author.get("date"),
        "updated_at": (commit_data.get("committer") or {}).get("date"),
        "merged_at": None,
        "stats": {"parents": len(parents)},
        "files": [],
        "files_truncated": False,
        "tags": sorted(tags),
        "relations": relations,
        "history_sources": sorted(
            {str(item) for item in commit.get("history_sources") or []}
        ),
        "sources": [
            _source(
                "commit", f"{repository}@{sha}", url, f"{repository} commit {sha[:12]}"
            ),
            _source(
                "repository",
                f"{repository}#repository",
                _repo_url(repository),
                repository,
            ),
        ],
    }


def _project_markdown(project: dict[str, Any], entries: list[dict[str, Any]]) -> str:
    pulls = [item for item in entries if item["artifact"] == "pull_request"]
    commits = [item for item in entries if item["artifact"] == "commit"]
    merged = [item for item in pulls if item["status"] == "merged"]
    tag_counts = Counter(
        tag
        for item in entries
        for tag in item["tags"]
        if not tag.startswith(("project:", "repo:", "artifact:", "status:"))
    )
    lines = [
        f"# {project['name']}",
        "",
        f"Project ID: `{project['id']}`",
        f"Repositories: {', '.join(f'[`{repo}`]({_repo_url(repo)})' for repo in project['repositories'])}",
        "",
        f"- Pull requests: {len(pulls)} ({len(merged)} merged)",
        f"- Commits: {len(commits)}",
        f"- Evidence entries: {len(entries)}",
        "",
        "## Top Tags",
        "",
    ]
    lines.extend(f"- `{tag}`: {count}" for tag, count in tag_counts.most_common(20))
    lines.extend(["", "## Pull Request Sources", ""])
    for item in sorted(
        pulls, key=lambda row: str(row.get("authored_at") or ""), reverse=True
    ):
        source = item["sources"][0]
        lines.append(
            f"- [{item['title']}]({source['url']}) - `{item['status']}` - {', '.join(f'`{tag}`' for tag in item['tags'][:8])}"
        )
    return "\n".join(lines)


def _writer_contract() -> dict[str, Any]:
    return {
        "version": "1.0",
        "purpose": "Generate reusable achievement candidates from source-backed GitHub evidence.",
        "rules": [
            "Do not invent metrics, scope, ownership, or outcomes.",
            "Every candidate must cite one or more input evidence IDs.",
            "Keep technical keywords that are supported by sources.",
            "Cluster related work before writing; do not turn every PR into a resume bullet.",
            "Write concise, impact-oriented English bullets with useful interview hooks.",
            "Return JSON only and preserve namespaced tags.",
        ],
        "output_schema": {
            "project_id": "string",
            "candidates": [
                {
                    "id": "string",
                    "bullet": "string",
                    "tags": ["string"],
                    "evidence_ids": ["string"],
                    "confidence": "number between 0 and 1",
                    "needs_user_confirmation": ["string"],
                }
            ],
        },
    }


def _library_markdown(
    login: str,
    generated_at: str,
    projects: list[dict[str, Any]],
    entry_count: int,
) -> str:
    lines = [
        "# GitHub Evidence Library",
        "",
        f"GitHub account: [`{login}`](https://github.com/{login})",
        f"Generated at: `{generated_at}`",
        f"Evidence entries: {entry_count}",
        "",
        "| Project | Repositories | PRs | Commits | Entries | Evidence |",
        "|---|---|---:|---:|---:|---|",
    ]
    for project in projects:
        repositories = "<br>".join(
            f"[`{repository}`]({_repo_url(repository)})"
            for repository in project["repositories"]
        )
        lines.append(
            f"| {project['name']} | {repositories} | {project['pull_request_count']} | "
            f"{project['commit_count']} | {project['entry_count']} | "
            f"[summary](projects/{project['id']}/summary.md) |"
        )
    lines.extend(
        [
            "",
            "Each evidence entry contains namespaced tags and itemized PR, commit, and repository source URLs.",
            "Private repository records remain local unless an external writer is run with explicit private-source approval.",
        ]
    )
    return "\n".join(lines)


def _writer_batches(
    project: dict[str, Any], entries: list[dict[str, Any]], batch_size: int = 40
) -> list[dict[str, Any]]:
    high_signal = [
        item
        for item in entries
        if item["artifact"] == "pull_request" and item["status"] in {"merged", "open"}
    ]
    high_signal.sort(key=lambda item: str(item.get("authored_at") or ""), reverse=True)
    batches: list[dict[str, Any]] = []
    for offset in range(0, len(high_signal), batch_size):
        batches.append(
            {
                "contract": _writer_contract(),
                "project": project,
                "batch": {
                    "index": len(batches) + 1,
                    "size": len(high_signal[offset : offset + batch_size]),
                },
                "evidence": high_signal[offset : offset + batch_size],
            }
        )
    return batches


def build_library(
    config: dict[str, Any], raw_dir: Path, out_dir: Path
) -> dict[str, Any]:
    ensure_dir(out_dir)
    all_entries: list[dict[str, Any]] = []
    project_summaries: list[dict[str, Any]] = []
    for project in config["projects"]:
        entries: list[dict[str, Any]] = []
        for repository in project["repositories"]:
            source_dir = raw_dir / "repositories" / repo_slug(repository)
            metadata = load_json(source_dir / "repository.json")
            languages = load_json(source_dir / "languages.json")
            pulls = load_json(source_dir / "pull_requests.json")
            commits = load_json(source_dir / "commits.json")
            visibility = str(
                metadata.get("visibility")
                or ("private" if metadata.get("private") else "public")
            )
            entries.extend(
                pull_request_entry(project, repository, item, languages, visibility)
                for item in pulls
            )
            entries.extend(
                commit_entry(project, repository, item, languages, visibility)
                for item in commits
            )
        entries.sort(
            key=lambda item: (str(item.get("authored_at") or ""), item["id"]),
            reverse=True,
        )
        all_entries.extend(entries)
        project_dir = ensure_dir(out_dir / "projects" / project["id"])
        write_json(
            project_dir / "project.json", {**project, "entry_count": len(entries)}
        )
        write_json(project_dir / "evidence.json", entries)
        write_text(project_dir / "summary.md", _project_markdown(project, entries))
        writer_dir = ensure_dir(project_dir / "writer-inputs")
        writer_batches = _writer_batches(project, entries)
        for batch in writer_batches:
            write_json(writer_dir / f"batch-{batch['batch']['index']:03d}.json", batch)
        pulls = [item for item in entries if item["artifact"] == "pull_request"]
        project_summaries.append(
            {
                **project,
                "entry_count": len(entries),
                "pull_request_count": len(pulls),
                "merged_pull_request_count": sum(
                    item["status"] == "merged" for item in pulls
                ),
                "commit_count": sum(item["artifact"] == "commit" for item in entries),
                "writer_batch_count": len(writer_batches),
                "path": f"projects/{project['id']}",
            }
        )
    generated_at = utc_now()
    tag_index: defaultdict[str, list[str]] = defaultdict(list)
    for entry in all_entries:
        for tag in entry["tags"]:
            tag_index[tag].append(entry["id"])
    library = {
        "schema_version": SCHEMA_VERSION,
        "github_logins": config["github_logins"],
        "sources": config["sources"],
        "generated_at": generated_at,
        "projects": project_summaries,
        "entry_count": len(all_entries),
        "entries": all_entries,
        "writer_contract": _writer_contract(),
    }
    write_json(out_dir / "library.json", library)
    write_json(
        out_dir / "tag-index.json",
        {tag: sorted(evidence_ids) for tag, evidence_ids in sorted(tag_index.items())},
    )
    write_json(out_dir / "writer-contract.json", _writer_contract())
    write_text(
        out_dir / "overview.md",
        _library_markdown(
            config["github_login"], generated_at, project_summaries, len(all_entries)
        ),
    )
    return library


def validate_writer_output(
    library: dict[str, Any], payload: dict[str, Any]
) -> list[str]:
    errors: list[str] = []
    known_ids = {item["id"] for item in library.get("entries", [])}
    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        return ["candidates must be an array"]
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            errors.append(f"candidates[{index}] must be an object")
            continue
        bullet = str(candidate.get("bullet") or "").strip()
        if not bullet:
            errors.append(f"candidates[{index}].bullet is required")
        evidence_ids = candidate.get("evidence_ids")
        if not isinstance(evidence_ids, list) or not evidence_ids:
            errors.append(f"candidates[{index}].evidence_ids must be a non-empty array")
            continue
        unknown = sorted({str(item) for item in evidence_ids} - known_ids)
        if unknown:
            errors.append(
                f"candidates[{index}] references unknown evidence IDs: {unknown}"
            )
    return errors


def _decode_writer_stdout(stdout: str) -> dict[str, Any]:
    payload = json.loads(stdout)
    if isinstance(payload, dict) and isinstance(payload.get("result"), str):
        result = payload["result"].strip()
        result = re.sub(r"^```(?:json)?\s*", "", result, flags=re.IGNORECASE)
        result = re.sub(r"\s*```$", "", result)
        payload = json.loads(result)
    if not isinstance(payload, dict):
        raise ValueError("Writer output must be a JSON object")
    return payload


def run_external_writer(
    library: dict[str, Any],
    batch: dict[str, Any],
    command: Sequence[str],
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    allow_private_sources: bool = False,
) -> dict[str, Any]:
    if not command:
        raise ValueError("Writer command cannot be empty")
    library_by_id = {str(item.get("id")): item for item in library.get("entries", [])}
    batch_ids = {
        str(item.get("id"))
        for item in batch.get("evidence", [])
        if isinstance(item, dict) and item.get("id")
    }
    unknown_batch_ids = sorted(batch_ids - library_by_id.keys())
    if unknown_batch_ids:
        raise ValueError(
            f"Writer batch references unknown evidence IDs: {unknown_batch_ids}"
        )
    batch_entries = [library_by_id[evidence_id] for evidence_id in sorted(batch_ids)]
    private_entries = [
        item
        for item in batch_entries
        if str(item.get("source_visibility") or "public").lower() != "public"
    ]
    if private_entries and not allow_private_sources:
        repositories = sorted(
            {str(item.get("repository") or "unknown") for item in private_entries}
        )
        raise ValueError(
            "Writer batch contains private sources. Re-run with explicit private-source approval for: "
            + ", ".join(repositories)
        )
    prompt = (
        "Follow the contract in this request. Return JSON only. "
        "Every claim must cite evidence_ids from the request.\n\n"
        + json.dumps(batch, ensure_ascii=False, indent=2)
    )
    completed = runner(
        command, input=prompt, check=True, capture_output=True, text=True
    )
    payload = _decode_writer_stdout(completed.stdout)
    errors = validate_writer_output({"entries": batch_entries}, payload)
    if errors:
        raise ValueError("Invalid writer output: " + "; ".join(errors))
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build a reusable, source-backed GitHub evidence library."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    sync_parser = subparsers.add_parser(
        "sync", help="Fetch GitHub history and rebuild the evidence library."
    )
    sync_parser.add_argument("--config", required=True)
    sync_parser.add_argument("--out", required=True)
    sync_parser.add_argument("--gh-binary", default="gh")

    build_parser_command = subparsers.add_parser(
        "build", help="Rebuild the library from previously fetched raw data."
    )
    build_parser_command.add_argument("--config", required=True)
    build_parser_command.add_argument("--raw", required=True)
    build_parser_command.add_argument("--out", required=True)

    validate_parser = subparsers.add_parser(
        "validate-writer", help="Validate external writer output against evidence IDs."
    )
    validate_parser.add_argument("--library", required=True)
    validate_parser.add_argument("--input", required=True)

    writer_parser = subparsers.add_parser(
        "run-writer", help="Run an external JSON writer against one evidence batch."
    )
    writer_parser.add_argument("--library", required=True)
    writer_parser.add_argument("--batch", required=True)
    writer_parser.add_argument(
        "--command-json",
        required=True,
        help='JSON array, for example ["claude", "-p", "--output-format", "json"]',
    )
    writer_parser.add_argument("--out", required=True)
    writer_parser.add_argument(
        "--allow-private-sources",
        action="store_true",
        help="Explicitly allow private repository evidence to be sent to the external writer command.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "sync":
        config = load_config(args.config)
        root = ensure_dir(args.out)
        raw_dir = ensure_dir(root / "raw")
        manifest = fetch_raw(config, raw_dir, GitHubClient(gh_binary=args.gh_binary))
        library = build_library(config, raw_dir, ensure_dir(root / "library"))
        print(
            json.dumps(
                {
                    "raw": manifest,
                    "library": {
                        "entry_count": library["entry_count"],
                        "projects": library["projects"],
                    },
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    if args.command == "build":
        config = load_config(args.config)
        library = build_library(config, Path(args.raw), ensure_dir(args.out))
        print(
            json.dumps(
                {
                    "entry_count": library["entry_count"],
                    "projects": library["projects"],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    if args.command == "validate-writer":
        errors = validate_writer_output(load_json(args.library), load_json(args.input))
        if errors:
            print(
                json.dumps(
                    {"valid": False, "errors": errors}, ensure_ascii=False, indent=2
                )
            )
            return 1
        print(json.dumps({"valid": True, "errors": []}, ensure_ascii=False, indent=2))
        return 0
    if args.command == "run-writer":
        command = json.loads(args.command_json)
        if not isinstance(command, list) or not all(
            isinstance(item, str) and item for item in command
        ):
            raise ValueError("--command-json must be a non-empty JSON array of strings")
        library = load_json(args.library)
        payload = run_external_writer(
            library,
            load_json(args.batch),
            command,
            allow_private_sources=args.allow_private_sources,
        )
        write_json(args.out, payload)
        print(
            json.dumps(
                {"valid": True, "output": str(args.out)}, ensure_ascii=False, indent=2
            )
        )
        return 0
    raise AssertionError(f"Unhandled command: {args.command}")


__all__ = [
    "GitHubClient",
    "build_library",
    "commit_entry",
    "fetch_raw",
    "load_config",
    "main",
    "merge_commit_history",
    "pull_request_entry",
    "run_external_writer",
    "validate_writer_output",
]


if __name__ == "__main__":
    raise SystemExit(main())
