from __future__ import annotations

import argparse
import html
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .common import ensure_dir, markdown_table, read_text_sample, write_json, write_text


EXCLUDED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "node_modules",
    "dist",
    "build",
    ".idea",
    ".vscode",
    "wandb",
    "mlruns",
}

DEPENDENCY_NAMES = {
    "requirements.txt",
    "requirements-dev.txt",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "environment.yml",
    "environment.yaml",
    "conda.yml",
    "conda.yaml",
    "package.json",
    "poetry.lock",
    "pipfile",
    "pipfile.lock",
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "makefile",
    "go.mod",
    "go.sum",
    "pom.xml",
    "build.gradle",
    "settings.gradle",
    "gradlew",
    "cargo.toml",
    "cargo.lock",
    "gemfile",
    "composer.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "tsconfig.json",
    "vite.config.ts",
    "next.config.js",
}

LANGUAGE_SUFFIXES = {
    ".py": "Python",
    ".ipynb": "Notebook",
    ".cpp": "C++",
    ".cc": "C++",
    ".cxx": "C++",
    ".c": "C/C++",
    ".h": "C/C++",
    ".hpp": "C++",
    ".cu": "CUDA",
    ".rs": "Rust",
    ".go": "Go",
    ".java": "Java",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".kt": "Kotlin",
    ".kts": "Kotlin",
    ".swift": "Swift",
    ".rb": "Ruby",
    ".php": "PHP",
    ".sql": "SQL",
    ".tf": "Terraform",
    ".sh": "Shell",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".toml": "TOML",
}

SIGNAL_PATTERNS = {
    "api_backend": ("api", "main", "controller", "route", "router", "handler", "endpoint", "service", "middleware", "server"),
    "frontend_mobile": ("component", "page", "view", "screen", "activity", "fragment", "widget", "store", "redux", "router"),
    "database_state": ("schema", "migration", "repository", "dao", "entity", "model", "database", "db", "sql", "redis", "cache"),
    "async_jobs": ("worker", "queue", "job", "task", "scheduler", "cron", "consumer", "producer", "kafka", "rabbit"),
    "devops_deploy": ("docker", "k8s", "kubernetes", "helm", "terraform", "deploy", "ci", "workflow", "pipeline", "nginx"),
    "security_auth": ("auth", "jwt", "oauth", "permission", "role", "acl", "csrf", "xss", "encrypt", "audit"),
    "testing_quality": ("test", "spec", "mock", "fixture", "coverage", "benchmark", "loadtest", "e2e"),
    "training": ("train", "trainer", "finetune", "fine_tune", "pretrain", "fit"),
    "evaluation": ("eval", "evaluate", "benchmark", "metric", "score", "test"),
    "inference_demo": ("infer", "inference", "predict", "demo", "serve", "server", "app", "gradio", "streamlit", "api"),
    "model": ("model", "network", "net", "module", "architecture", "backbone", "encoder", "decoder"),
    "data_pipeline": ("dataset", "dataloader", "data_loader", "preprocess", "prepare_data", "tokenizer", "loader"),
    "config": ("config", "configs", "yaml", "hydra", "argparse", "settings"),
}

DATA_MODEL_DIR_NAMES = {
    "data",
    "dataset",
    "datasets",
    "models",
    "checkpoints",
    "checkpoint",
    "weights",
    "ckpt",
    "pretrained",
    "artifacts",
    "db",
    "migrations",
    "schemas",
    "seeds",
    "uploads",
    "static",
    "public",
    "assets",
    "logs",
}


def collect_files(repo: Path, max_files: int = 8000) -> list[Path]:
    files: list[Path] = []
    for root, dirs, filenames in os.walk(repo):
        dirs[:] = [name for name in dirs if name.lower() not in EXCLUDED_DIRS]
        rel_root = Path(root).relative_to(repo)
        if any(part.lower() in EXCLUDED_DIRS for part in rel_root.parts):
            continue
        for filename in sorted(filenames):
            rel = (Path(root) / filename).relative_to(repo)
            if any(part.lower() in EXCLUDED_DIRS for part in rel.parts):
                continue
            files.append(rel)
            if len(files) >= max_files:
                return files
    return files


def build_tree(repo: Path, max_depth: int = 3, max_entries: int = 40) -> list[str]:
    lines = [f"{repo.name}/"]
    for root, dirs, filenames in os.walk(repo):
        dirs[:] = [name for name in sorted(dirs) if name.lower() not in EXCLUDED_DIRS]
        rel_root = Path(root).relative_to(repo)
        depth = 0 if str(rel_root) == "." else len(rel_root.parts)
        if depth >= max_depth:
            dirs[:] = []
            continue
        visible_dirs = dirs[:max_entries]
        visible_files = sorted(filenames)[:max_entries]
        indent = "  " * (depth + 1)
        for dirname in visible_dirs:
            lines.append(f"{indent}{dirname}/")
        if len(dirs) > max_entries:
            lines.append(f"{indent}... {len(dirs) - max_entries} more dirs")
        for filename in visible_files:
            lines.append(f"{indent}{filename}")
        if len(filenames) > max_entries:
            lines.append(f"{indent}... {len(filenames) - max_entries} more files")
    return lines


def classify_signals(files: list[Path]) -> dict[str, list[str]]:
    signals: dict[str, list[str]] = defaultdict(list)
    for rel in files:
        rel_text = rel.as_posix().lower()
        stem_text = rel.stem.lower()
        for category, patterns in SIGNAL_PATTERNS.items():
            if any(pattern in rel_text or pattern in stem_text for pattern in patterns):
                signals[category].append(rel.as_posix())
    return {key: sorted(value)[:40] for key, value in sorted(signals.items())}


def audit_repo(repo: str | Path, name: str | None = None) -> dict[str, Any]:
    repo_path = Path(repo).resolve()
    if not repo_path.exists() or not repo_path.is_dir():
        raise FileNotFoundError(f"repo path does not exist or is not a directory: {repo_path}")

    files = collect_files(repo_path)
    ext_counts = Counter(path.suffix.lower() or "[no extension]" for path in files)
    language_counts = Counter(LANGUAGE_SUFFIXES.get(path.suffix.lower(), "Other") for path in files)

    readmes = [path.as_posix() for path in files if path.name.lower().startswith("readme")]
    dependency_files = [
        path.as_posix()
        for path in files
        if path.name.lower() in DEPENDENCY_NAMES or path.name.lower().startswith("requirements")
    ]
    notebooks = [path.as_posix() for path in files if path.suffix.lower() == ".ipynb"]
    tests = [
        path.as_posix()
        for path in files
        if "test" in path.name.lower() or any(part.lower() in {"tests", "test"} for part in path.parts)
    ]
    docker = [
        path.as_posix()
        for path in files
        if "docker" in path.as_posix().lower() or path.name.lower() == "dockerfile"
    ]
    data_model_paths = [
        path.as_posix()
        for path in files
        if any(part.lower() in DATA_MODEL_DIR_NAMES for part in path.parts)
    ][:60]

    readme_samples: dict[str, str] = {}
    for rel in readmes[:3]:
        readme_samples[rel] = read_text_sample(repo_path / rel, max_chars=3000)

    total_size = 0
    for rel in files:
        try:
            total_size += (repo_path / rel).stat().st_size
        except OSError:
            pass

    return {
        "name": name or repo_path.name,
        "repo_path": str(repo_path),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "file_count_scanned": len(files),
            "approx_total_bytes": total_size,
            "top_extensions": ext_counts.most_common(15),
            "language_counts": language_counts.most_common(),
        },
        "readme_files": readmes[:20],
        "dependency_files": sorted(dependency_files)[:40],
        "notebooks": notebooks[:40],
        "docker_files": sorted(docker)[:40],
        "test_files": sorted(tests)[:60],
        "signals": classify_signals(files),
        "potential_data_or_model_paths": sorted(data_model_paths),
        "tree": build_tree(repo_path),
        "readme_samples": readme_samples,
    }


def render_markdown(audit: dict[str, Any]) -> str:
    summary = audit["summary"]
    signal_rows = []
    for category, paths in audit["signals"].items():
        signal_rows.append([category, len(paths), "<br>".join(paths[:8])])

    parts = [
        f"# {audit['name']} 项目摸底报告",
        "",
        "## 基本信息",
        "",
        markdown_table(
            ["字段", "值"],
            [
                ["repo_path", audit["repo_path"]],
                ["generated_at", audit["generated_at"]],
                ["file_count_scanned", summary["file_count_scanned"]],
                ["approx_total_bytes", summary["approx_total_bytes"]],
            ],
        ),
        "",
        "## 语言和文件类型",
        "",
        markdown_table(["语言", "文件数"], summary["language_counts"]),
        "",
        "## 依赖和环境线索",
        "",
        "\n".join(f"- `{path}`" for path in audit["dependency_files"]) or "- TODO: 没有识别到常见依赖文件。",
        "",
        "## README",
        "",
        "\n".join(f"- `{path}`" for path in audit["readme_files"]) or "- TODO: 没有识别到 README。",
        "",
        "## 核心链路线索",
        "",
        markdown_table(["类别", "命中文件数", "代表路径"], signal_rows),
        "",
        "## Notebook / Docker / Test 线索",
        "",
        "### Notebooks",
        "\n".join(f"- `{path}`" for path in audit["notebooks"][:20]) or "- 无",
        "",
        "### Docker",
        "\n".join(f"- `{path}`" for path in audit["docker_files"][:20]) or "- 无",
        "",
        "### Tests",
        "\n".join(f"- `{path}`" for path in audit["test_files"][:30]) or "- 无",
        "",
        "## 潜在数据/状态/模型/资源路径",
        "",
        "\n".join(f"- `{path}`" for path in audit["potential_data_or_model_paths"][:30]) or "- 无",
        "",
        "## 目录树摘要",
        "",
        "```text",
        "\n".join(audit["tree"][:250]),
        "```",
        "",
        "## 下一步人工确认",
        "",
        "- 找到最小可运行命令：API、页面、CLI、worker、测试、训练或 demo 至少一个。",
        "- 确认依赖、环境变量、数据库/数据文件、端口和外部服务。",
        "- 确认 baseline/demo 是否能在本地、Docker、云服务器或 GPU 环境上跑通。",
        "- 确认自己要做的面试亮点：改造点、demo、测试、报告或实验计划。",
    ]
    return "\n".join(parts)


def render_html(audit: dict[str, Any], markdown: str) -> str:
    del markdown

    def list_items(items: list[str], empty: str = "无") -> str:
        if not items:
            return f"<p class=\"empty\">{html.escape(empty)}</p>"
        return "<ul>" + "".join(f"<li><code>{html.escape(item)}</code></li>" for item in items) + "</ul>"

    def table(headers: list[str], rows: list[list[Any]]) -> str:
        head = "".join(f"<th>{html.escape(str(item))}</th>" for item in headers)
        body = []
        for row in rows:
            body.append("<tr>" + "".join(f"<td>{html.escape(str(item))}</td>" for item in row) + "</tr>")
        return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>"

    summary = audit["summary"]
    lang_rows = [[name, count] for name, count in summary["language_counts"]]
    ext_rows = [[name, count] for name, count in summary["top_extensions"]]
    signal_rows = [
        [category, len(paths), "\n".join(paths[:10]) or "无"]
        for category, paths in audit["signals"].items()
    ]

    body = f"""
    <section class="hero">
      <p class="eyebrow">鼠鼠实习妙妙工具项目摸底报告</p>
      <h1>{html.escape(audit['name'])}</h1>
      <p class="muted">{html.escape(audit['repo_path'])}</p>
    </section>

    <section class="metrics">
      <div><strong>{summary['file_count_scanned']}</strong><span>Files scanned</span></div>
      <div><strong>{summary['approx_total_bytes']}</strong><span>Approx bytes</span></div>
      <div><strong>{len(audit['dependency_files'])}</strong><span>Dependency clues</span></div>
      <div><strong>{len(audit['test_files'])}</strong><span>Test clues</span></div>
    </section>

    <section>
      <h2>语言和文件类型</h2>
      <div class="grid two">
        <div>{table(['Language', 'Files'], lang_rows)}</div>
        <div>{table(['Extension', 'Files'], ext_rows)}</div>
      </div>
    </section>

    <section>
      <h2>核心链路线索</h2>
      {table(['Category', 'Hit Count', 'Representative Paths'], signal_rows)}
    </section>

    <section class="grid two">
      <div>
        <h2>依赖和环境</h2>
        {list_items(audit['dependency_files'], '没有识别到常见依赖文件')}
      </div>
      <div>
        <h2>README</h2>
        {list_items(audit['readme_files'], '没有识别到 README')}
      </div>
    </section>

    <section class="grid three">
      <div>
        <h2>Notebooks</h2>
        {list_items(audit['notebooks'][:20])}
      </div>
      <div>
        <h2>Docker</h2>
        {list_items(audit['docker_files'][:20])}
      </div>
      <div>
        <h2>Tests</h2>
        {list_items(audit['test_files'][:25])}
      </div>
    </section>

    <section>
      <h2>潜在数据 / 状态 / 模型 / 资源路径</h2>
      {list_items(audit['potential_data_or_model_paths'][:30])}
    </section>

    <section>
      <h2>目录树摘要</h2>
      <pre>{html.escape(chr(10).join(audit['tree'][:250]))}</pre>
    </section>

    <section>
      <h2>下一步人工确认</h2>
      <ul>
        <li>找到最小可运行命令：API、页面、CLI、worker、测试、训练或 demo 至少一个。</li>
        <li>确认依赖、环境变量、数据库/数据文件、端口和外部服务。</li>
        <li>确认 baseline/demo 是否能在本地、Docker、云服务器或 GPU 环境上跑通。</li>
        <li>确认自己的面试亮点：改造点、demo、测试、报告或实验计划。</li>
      </ul>
    </section>
    """
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(audit['name'])} 项目摸底报告</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; color: #18202a; background: #f6f7f9; }}
    main {{ max-width: 1080px; margin: 0 auto; padding: 32px 20px 56px; }}
    section {{ margin-top: 24px; }}
    h1, h2 {{ color: #111827; line-height: 1.2; }}
    h1 {{ font-size: 34px; margin: 4px 0 8px; }}
    h2 {{ font-size: 20px; margin: 0 0 12px; }}
    p, li {{ line-height: 1.65; }}
    .hero {{ background: #ffffff; border: 1px solid #d8dee8; border-radius: 8px; padding: 22px; }}
    .eyebrow {{ margin: 0; font-size: 12px; font-weight: 700; letter-spacing: 0; color: #2563eb; text-transform: uppercase; }}
    .muted, .empty {{ color: #5b6778; }}
    .metrics {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }}
    .metrics div {{ background: #ffffff; border: 1px solid #d8dee8; border-radius: 8px; padding: 16px; }}
    .metrics strong {{ display: block; font-size: 24px; color: #111827; }}
    .metrics span {{ color: #5b6778; font-size: 13px; }}
    .grid {{ display: grid; gap: 16px; }}
    .two {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
    .three {{ grid-template-columns: repeat(3, minmax(0, 1fr)); }}
    .grid > div, section:not(.hero):not(.metrics):not(.grid) {{ background: #ffffff; border: 1px solid #d8dee8; border-radius: 8px; padding: 18px; }}
    table {{ width: 100%; border-collapse: collapse; background: #ffffff; }}
    th, td {{ text-align: left; vertical-align: top; border-bottom: 1px solid #e5e9f0; padding: 9px 10px; font-size: 14px; white-space: pre-wrap; word-break: break-word; }}
    th {{ color: #334155; background: #eef2f7; }}
    pre {{ white-space: pre-wrap; word-break: break-word; background: #f8fafc; border: 1px solid #d8dee8; border-radius: 8px; padding: 12px; overflow-x: auto; }}
    code {{ color: #0f172a; }}
    li {{ margin: 4px 0; }}
    ul {{ padding-left: 20px; }}
    @media (max-width: 760px) {{ .metrics, .two, .three {{ grid-template-columns: 1fr; }} main {{ padding: 18px 12px 36px; }} }}
  </style>
</head>
<body>
  <main>
    {body}
  </main>
</body>
</html>
"""


def write_audit_outputs(audit: dict[str, Any], out_dir: str | Path) -> dict[str, str]:
    out = ensure_dir(out_dir)
    markdown = render_markdown(audit)
    html_doc = render_html(audit, markdown)
    paths = {
        "audit_json": str(write_json(out / "audit.json", audit)),
        "overview_md": str(write_text(out / "overview.md", markdown)),
        "overview_html": str(write_text(out / "overview.html", html_doc)),
    }
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan a cloned computer-industry project and generate audit reports.")
    parser.add_argument("--repo", required=True, help="Path to the cloned project.")
    parser.add_argument("--out", required=True, help="Output directory.")
    parser.add_argument("--name", default=None, help="Display name for the project.")
    args = parser.parse_args(argv)

    audit = audit_repo(args.repo, name=args.name)
    paths = write_audit_outputs(audit, args.out)
    for label, path in paths.items():
        print(f"{label}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
