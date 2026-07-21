from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Sequence

from .common import write_json


def utc_now() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


class GitHubSourceClient:
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

    def login(self) -> str:
        payload = self._json(["api", "user"])
        login = str(payload.get("login") or "").strip()
        if not login:
            raise ValueError("Authenticated GitHub login is unavailable; run gh auth login")
        return login

    def accessible_repositories(self) -> list[str]:
        repositories: list[str] = []
        page = 1
        while True:
            payload = self._json(
                [
                    "api",
                    "--method",
                    "GET",
                    "user/repos",
                    "-f",
                    "affiliation=owner,collaborator,organization_member",
                    "-F",
                    "per_page=100",
                    "-F",
                    f"page={page}",
                ]
            )
            if not isinstance(payload, list):
                raise ValueError("Unexpected repository response from GitHub")
            repositories.extend(
                str(item.get("full_name"))
                for item in payload
                if isinstance(item, dict) and item.get("full_name")
            )
            if len(payload) < 100:
                return repositories
            page += 1

    def authored_pr_repositories(self, login: str) -> tuple[list[str], bool]:
        repositories: list[str] = []
        page = 1
        total = 0
        while page <= 10:
            payload = self._json(
                [
                    "api",
                    "--method",
                    "GET",
                    "search/issues",
                    "-f",
                    f"q=type:pr author:{login}",
                    "-F",
                    "per_page=100",
                    "-F",
                    f"page={page}",
                ]
            )
            if not isinstance(payload, dict):
                raise ValueError("Unexpected authored-PR response from GitHub")
            total = int(payload.get("total_count") or 0)
            items = payload.get("items") or []
            for item in items:
                url = str((item or {}).get("repository_url") or "")
                match = re.search(r"/repos/([^/]+/[^/]+)$", url)
                if match:
                    repositories.append(match.group(1))
            if len(items) < 100:
                break
            page += 1
        return repositories, total > 1000


def discover_config(
    client: GitHubSourceClient, login: str | None = None
) -> dict[str, Any]:
    github_login = login or client.login()
    accessible = client.accessible_repositories()
    authored, capped = client.authored_pr_repositories(github_login)
    repositories = sorted(set(accessible) | set(authored), key=str.lower)
    if not repositories:
        raise ValueError("No accessible or authored-PR repositories found")
    return {
        "github_login": github_login,
        "projects": [
            {
                "id": repository.replace("/", "-").lower(),
                "name": repository.split("/", 1)[1],
                "repositories": [repository],
                "tags": [],
            }
            for repository in repositories
        ],
        "discovery": {
            "generated_at": utc_now(),
            "accessible_repository_count": len(set(accessible)),
            "authored_pr_repository_count": len(set(authored)),
            "authored_pr_search_capped": capped,
        },
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Discover repositories for the local GitHub evidence library."
    )
    parser.add_argument("--out", required=True)
    parser.add_argument("--login")
    parser.add_argument("--gh-binary", default="gh")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = discover_config(
        GitHubSourceClient(gh_binary=args.gh_binary), login=args.login
    )
    write_json(Path(args.out), config)
    print(
        json.dumps(
            {
                "out": str(args.out),
                "github_login": config["github_login"],
                "repositories": len(config["projects"]),
                **config["discovery"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
