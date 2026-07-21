from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any

from .common import ensure_dir, is_probably_text, markdown_table, read_text_sample, write_json, write_text


METRIC_PATTERN = re.compile(
    r"(?i)\b("
    r"accuracy|acc|f1|auc|loss|latency|throughput|qps|tokens/s|tok/s|speedup|"
    r"precision|recall|map|bleu|rouge|slo|violation|gpu|epoch|runtime|cost|fps|"
    r"coverage|p95|p99|error rate|rps|requests/s|ms|mb|gb|cpu|memory"
    r")\b[^\n]{0,90}?[-+]?\d+(?:\.\d+)?%?"
)

CLAIM_HINT_PATTERN = re.compile(
    r"(?i)\b(improve|improved|reduce|reduced|increase|increased|faster|slower|better|"
    r"accuracy|latency|throughput|speedup|coverage|baseline|ablation|experiment|"
    r"result|api|cache|database|deploy|test|auth|monitor|pipeline)\b"
)


def collect_note_files(project_notes: str | Path, max_files: int = 200) -> list[Path]:
    root = Path(project_notes)
    if not root.exists():
        return []
    if root.is_file():
        return [root] if is_probably_text(root) else []
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and is_probably_text(path):
            files.append(path)
        if len(files) >= max_files:
            break
    return files


def extract_project_clues(project_notes: str | Path) -> dict[str, Any]:
    root = Path(project_notes)
    files = collect_note_files(root)
    metric_hits: list[dict[str, str]] = []
    claim_lines: list[dict[str, str]] = []
    for path in files:
        text = read_text_sample(path, max_chars=20000)
        rel = path.name if root.is_file() else path.relative_to(root).as_posix()
        for match in METRIC_PATTERN.finditer(text):
            metric_hits.append({"source": rel, "text": match.group(0).strip()})
        for line in text.splitlines():
            clean = line.strip()
            if clean and CLAIM_HINT_PATTERN.search(clean):
                claim_lines.append({"source": rel, "text": clean[:260]})
    return {
        "notes_root": str(root),
        "source_files": [path.name if root.is_file() else path.relative_to(root).as_posix() for path in files],
        "metric_hits": metric_hits[:80],
        "claim_lines": claim_lines[:80],
    }


def render_resume_star(project_clues: dict[str, Any]) -> str:
    metric_lines = project_clues["metric_hits"][:8]
    metrics = "\n".join(f"- `{item['source']}`: {item['text']}" for item in metric_lines)
    if not metrics:
        metrics = "- 暂无明确指标线索：简历先写工程产出、方法理解、实验设计或 demo，后续再补数字。"
    return f"""# STAR 简历项目草稿

> 使用规则：先帮候选人产出能投递的 4-5 行版本。没有指标时，不要卡住，改写成工程产出、方法理解、系统设计、实验设计和下一步计划。

## Profile Header

- 目标岗位：TODO
- 用户水平：TODO
- 技术栈偏好：TODO
- 时间预算：TODO
- 资源条件：TODO
- 运行深度：TODO: interview-only / smoke-test / local-full-run / remote-full-run
- 当前项目状态：TODO

## 4-5 行版本

1. S/T：围绕 TODO: target JD / target scenario，复现并理解 TODO: project，用于解决 TODO: concrete problem。
2. A：快速完成项目摸底、环境配置或最小 baseline run，梳理请求流/数据流/状态流/任务流/模型流。
3. A：设计并推进 TODO: your modification，例如加 API/页面/测试/缓存/部署/数据处理/AI demo。
4. R：产出 TODO: demo/report/code walkthrough/interview pack；有指标则补 TODO: metric result。
5. R：能在面试中讲清 input/output、核心方法、失败原因和下一步优化方向。

## 可用指标线索

{metrics}
"""


def render_interview_qa(project_clues: dict[str, Any]) -> str:
    claim_lines = project_clues["claim_lines"][:10]
    claim_section = "\n".join(f"- `{item['source']}`: {item['text']}" for item in claim_lines)
    if not claim_section:
        claim_section = "- 暂无结果线索：先围绕项目结构、核心代码、可讲改造点和失败定位准备回答。"
    return f"""# 面试拷问 Q&A

## 可讲线索

{claim_section}

## 高频拷问

### 1. 这个项目原本解决什么问题？你为什么选它？

- 回答要点：JD 匹配点、项目来源、问题定义、输入输出。
- 准备材料：TODO: README/audit report path。

### 2. 你选择的运行深度是什么？为什么？

- 回答要点：解释 interview-only / smoke-test / local-full-run / remote-full-run 的选择，以及时间、资源、投递节奏的取舍。
- 准备材料：TODO: profile header / run plan。

### 3. 这个项目的核心链路是什么？

- 回答要点：请求入口、页面事件、数据读写、状态变化、任务调度、模型/算法步骤和输出。
- 准备材料：TODO: core file path and line notes。

### 4. 你做了什么调整？为什么面试官应该关心？

- 回答要点：API、页面、数据库、缓存、测试、部署、数据处理、模型/算法、demo 或工程整理里最能贴 JD 的增量。
- 准备材料：TODO: changed files / design notes / demo path。

### 5. baseline 是怎么跑的？复现失败时你如何定位？

- 回答要点：环境、依赖、命令、数据、随机种子、日志、错误定位过程。
- 准备材料：TODO: command / error / fix notes。

### 6. 如果没有完整指标，你怎么讲这个项目？

- 回答要点：讲清已跑通部分、卡点、资源估算、完整实验设计和预期对比口径。
- 准备材料：TODO: smoke test result / experiment plan / cost estimate。

### 7. 如果继续做，你会怎么改？

- 回答要点：优先说低风险、一天内能推进的改动，再说中高风险探索。
- 准备材料：TODO: modification design doc path。
"""


def render_core_code_walkthrough(project_clues: dict[str, Any]) -> str:
    sources = project_clues["source_files"][:20]
    source_section = "\n".join(f"- `{source}`" for source in sources) or "- TODO: add project notes or audit output"
    return f"""# 核心代码讲解稿

## 已收集资料

{source_section}

## 讲解顺序

1. 入口命令：TODO: start/test/build/deploy/train/eval command。
2. 参数和配置：TODO: env/config/CLI/framework settings。
3. 核心输入：TODO: HTTP request、页面事件、DB row、message、file、dataset 或 tensor。
4. 核心模块：TODO: controller/service/repository/component/store/job/model。
5. 状态变化：TODO: database/cache/queue/page state/task state/model output。
6. 测试和指标：TODO: unit/integration/e2e/log/monitor/metrics。
7. 你的修改：TODO: changed files，说明动机、实现和影响。

## 不要硬背的细节

- 不需要逐行背所有工具函数。
- 必须能讲清 input/output、关键字段/状态/接口/张量、核心流程和自己准备的改动方向。
- 不确定的地方写成“待验证/下一步”，不要在面试中硬编具体数字。
"""


def render_ppt_prompt(project_clues: dict[str, Any]) -> str:
    del project_clues
    return """# PPT 生成提示词

请根据以下项目资料生成一份 6-8 页中文技术面试展示 PPT 大纲。要求：

1. 目标是帮助候选人快速讲清项目，适合实习面试展示。
2. 不要卡在完整复现实验；没有指标时，用实验设计、工程产出和失败定位替代。
3. 每页给出标题、三到五个要点、建议配图或表格。
4. 风格适合计算机行业实习面试，重点讲问题、架构/方法、代码流程、改造点和后续计划。

项目资料：

- JD：TODO
- 项目来源：TODO
- 用户水平 / 时间预算 / 运行深度：TODO
- Baseline 命令、启动命令或 smoke test：TODO
- 我的改造/准备改造：TODO
- 指标/效果：TODO，有就写；没有就写实验计划、系统设计或工程产出
- Demo/报告：TODO

建议页：

1. 项目背景与 JD 匹配
2. 项目结构和核心流程
3. 最小运行路径
4. 我的改造点和面试亮点
5. 结果、指标或工程产出
6. 失败 case 与限制
7. 面试可讲亮点
8. 后续工作
"""


def render_application_checklist(project_clues: dict[str, Any]) -> str:
    rows = [
        ["JD 命中项目标题", "TODO: one-line project title", "TODO"],
        ["用户画像和运行深度", "TODO: level / stack / time / resources / run depth", "TODO"],
        ["项目来源", "TODO: repo URL / paper / tutorial", "TODO"],
        ["最小运行路径", "TODO: start/test/build/deploy/train/eval command or blocker", "TODO"],
        ["核心代码讲解", "TODO: key files and input/output notes", "TODO"],
        ["可面试改造点", "TODO: modification idea or changed files", "TODO"],
        ["指标或替代表达", "TODO: metric result, demo, report, or experiment plan", "TODO"],
        ["资源/时间/成本估算", "TODO: local/Docker/cloud/GPU estimate", "TODO"],
        ["面试拷问通过", "TODO: QA doc reviewed", "TODO"],
    ]
    metric_rows = [
        [f"指标线索: {item['text']}", item["source"], "可写入简历前先统一口径"]
        for item in project_clues["metric_hits"][:12]
    ]
    return "\n".join(
        [
            "# 投递检查表",
            "",
            "目标是快速判断这个项目是否已经能投、能面、能讲。",
            "",
            markdown_table(["项目项", "准备材料", "状态"], [*rows, *metric_rows]),
        ]
    )


def write_interview_pack(project_clues: dict[str, Any], out_dir: str | Path) -> dict[str, str]:
    out = ensure_dir(out_dir)
    paths = {
        "project_clues_json": str(write_json(out / "project_clues.json", project_clues)),
        "resume_star": str(write_text(out / "resume_star.md", render_resume_star(project_clues))),
        "interview_qa": str(write_text(out / "interview_qa.md", render_interview_qa(project_clues))),
        "core_code_walkthrough": str(write_text(out / "core_code_walkthrough.md", render_core_code_walkthrough(project_clues))),
        "ppt_prompt": str(write_text(out / "ppt_prompt.md", render_ppt_prompt(project_clues))),
        "application_checklist": str(write_text(out / "application_checklist.md", render_application_checklist(project_clues))),
    }
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create a resume and interview pack skeleton for a computer-industry internship project.")
    parser.add_argument("--project-notes", required=True, help="Directory or file containing project notes, logs, reports, or audit output.")
    parser.add_argument("--out", required=True, help="Output directory.")
    args = parser.parse_args(argv)

    project_clues = extract_project_clues(args.project_notes)
    paths = write_interview_pack(project_clues, args.out)
    for label, path in paths.items():
        print(f"{label}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
