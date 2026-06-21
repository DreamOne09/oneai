"""執行器:政策判斷 → (必要時)審核 → 執行 → 回傳精簡結果。

這是 ruflo node 在本機調用的進入點。對應 docs/12-antigravity-hands.md。
"""
from __future__ import annotations
from dataclasses import dataclass, asdict

from policy import classify_command, classify_task
from approval_client import request_approval
from cli_bridge import run_shell, run_agent_task, ExecResult


@dataclass
class TaskResult:
    status: str           # 'done' | 'rejected' | 'error'
    summary: str
    code: int | None = None
    stdout_tail: str | None = None
    stderr_tail: str | None = None


def _tail(s: str, n: int = 2000) -> str:
    return s[-n:] if s and len(s) > n else (s or "")


def _to_result(r: ExecResult) -> TaskResult:
    return TaskResult(
        status="done" if r.ok else "error",
        summary="執行完成" if r.ok else f"執行失敗 (code={r.code})",
        code=r.code,
        stdout_tail=_tail(r.stdout),
        stderr_tail=_tail(r.stderr),
    )


def run_command(cmd: str, cwd: str | None = None) -> TaskResult:
    """執行 shell 指令,危險指令先審核。"""
    v = classify_command(cmd)
    if v.needs_approval:
        decision = request_approval(v.action or "run_command", f"執行指令: {cmd}", {"cmd": cmd, "cwd": cwd})
        if decision != "approved":
            return TaskResult("rejected", f"指令未獲授權 ({v.reason})")
    return _to_result(run_shell(cmd, cwd))


def run_task(task_type: str, prompt: str, cwd: str | None = None) -> TaskResult:
    """高層任務:編碼/測試/重構等交給 Antigravity;敏感型別先審核。"""
    v = classify_task(task_type)
    if v.needs_approval:
        decision = request_approval(v.action or "run_command", f"{task_type}: {prompt}", {"prompt": prompt})
        if decision != "approved":
            return TaskResult("rejected", f"任務未獲授權 ({task_type})")
    return _to_result(run_agent_task(prompt, cwd))


if __name__ == "__main__":
    import sys, json
    if len(sys.argv) < 2:
        print("用法: python executor.py <cmd>  |  python executor.py --task <type> <prompt>")
        raise SystemExit(2)
    if sys.argv[1] == "--task":
        res = run_task(sys.argv[2], " ".join(sys.argv[3:]))
    else:
        res = run_command(" ".join(sys.argv[1:]))
    print(json.dumps(asdict(res), ensure_ascii=False, indent=2))
