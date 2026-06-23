"""Antigravity CLI 橋接(headless / 非 TTY)+ 執行沙箱。

v0 用 subprocess 包裝。真實 CLI 名稱/參數請依你電腦上的 antigravity 安裝調整
(見 README 的 ANTIGRAVITY_CMD)。也保留直接執行 shell 指令的能力供測試。

沙箱(縱深防禦,非容器級隔離):
- **環境刷洗**:不把含 KEY/TOKEN/SECRET/PASSWORD/CRED 的變數傳給被執行指令,
  避免被執行的指令竊取 OPENAI_API_KEY / APPROVAL_TOKEN / VAPID 私鑰等。
- **工作目錄監牢**:cwd 必須落在 ONEAI_SANDBOX_ROOT(預設 repo 根)之內,擋路徑逃逸。
- **逾時 + 不使用 shell**:subprocess shell=False,搭配 shlex 解析,杜絕 shell 注入。
"""
from __future__ import annotations
import os
import re
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path

ANTIGRAVITY_CMD = os.getenv("ANTIGRAVITY_CMD", "agy")  # 例: agy / antigravity
BRIDGE_TIMEOUT = int(os.getenv("AGY_BRIDGE_TIMEOUT", "600"))

# 沙箱根目錄:預設 repo 根(此檔在 hands/antigravity/ 之下)
SANDBOX_ROOT = Path(os.getenv("ONEAI_SANDBOX_ROOT", Path(__file__).resolve().parents[2])).resolve()

# 機密變數樣式:這些不傳給被執行的子行程
_SECRET_HINT = re.compile(r"(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CRED|VAPID)", re.I)


@dataclass
class ExecResult:
    ok: bool
    code: int
    stdout: str
    stderr: str


def _safe_env() -> dict:
    """刷洗環境:移除機密變數,避免被執行指令外洩金鑰。"""
    return {k: v for k, v in os.environ.items() if not _SECRET_HINT.search(k)}


def _safe_cwd(cwd: str | None) -> tuple[str | None, str | None]:
    """把 cwd 限制在沙箱根內。回傳 (解析後路徑, 錯誤訊息);錯誤時路徑為 None。"""
    base = SANDBOX_ROOT
    if not cwd:
        return str(base), None
    target = Path(cwd)
    resolved = (target if target.is_absolute() else base / target).resolve()
    try:
        resolved.relative_to(base)
    except ValueError:
        return None, f"工作目錄超出沙箱根目錄: {resolved}"
    return str(resolved), None


def _run(args: list[str], cwd: str | None, timeout: int) -> ExecResult:
    safe_cwd, err = _safe_cwd(cwd)
    if err:
        return ExecResult(False, -1, "", err)
    try:
        proc = subprocess.run(
            args, cwd=safe_cwd, capture_output=True, text=True,
            timeout=timeout, shell=False, env=_safe_env(),
        )
        return ExecResult(proc.returncode == 0, proc.returncode, proc.stdout, proc.stderr)
    except subprocess.TimeoutExpired:
        return ExecResult(False, -1, "", f"逾時 (>{timeout}s)")
    except FileNotFoundError as e:
        return ExecResult(False, -1, "", f"找不到執行檔: {e}")


def run_shell(cmd: str, cwd: str | None = None, timeout: int | None = None) -> ExecResult:
    """執行一般 shell 指令(已通過政策審核才呼叫)。"""
    if os.name == "nt":
        return _run(["cmd.exe", "/c", cmd], cwd, timeout or BRIDGE_TIMEOUT)
    args = shlex.split(cmd, posix=True)
    if not args:
        return ExecResult(False, -1, "", "空指令")
    return _run(args, cwd, timeout or BRIDGE_TIMEOUT)


def run_agent_task(prompt: str, cwd: str | None = None, timeout: int | None = None) -> ExecResult:
    """把高層任務交給 Antigravity CLI（agy -p 非互動模式）。"""
    args = [ANTIGRAVITY_CMD, "-p", prompt]
    return _run(args, cwd, timeout or BRIDGE_TIMEOUT)
