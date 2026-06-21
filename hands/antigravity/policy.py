"""政策引擎:判斷任務/指令是否需要人工審核。

設計原則(KISS + 安全優先 + Allowlist 白名單):
- **預設拒絕**:唯有「整條指令」完全命中白名單(SAFE/DEPLOY)且不含 shell 串接
  字元時才自動放行;其餘一律送審核(fail-safe)。
- 仍保留危險樣式黑名單作為「縱深防禦」(命中→直接歸類對應 action 送審)。
- 關鍵修正:舊版用 ``SAFE.match()`` 只比對開頭,``ls && rm -rf /`` 會被誤放行;
  現在只要偵測到 shell 串接/重導向(; & | ` $() > <),就一律不視為安全。
"""
from __future__ import annotations
import re
from dataclasses import dataclass

# 命中即需審核,並對應到審核服務的 action(縱深防禦,非唯一防線)
DANGEROUS = [
    (re.compile(r"\brm\s+-rf\b|\brmdir\b|\bdel\s+/|Remove-Item", re.I), "delete_file"),
    (re.compile(r"\bgit\s+push\b.*(--force|-f)\b", re.I), "publish"),
    (re.compile(r"\b(drop|truncate)\s+(table|database)\b", re.I), "delete_file"),
    (re.compile(r"\bformat\b|\bmkfs\b", re.I), "delete_file"),
    (re.compile(r"\bcurl\b.*\|\s*(sh|bash)\b", re.I), "run_command"),
]

# shell 串接 / 重導向 / 命令替換字元 — 出現任一即視為複合指令,不得自動放行
SHELL_META = re.compile(r"[;&|`\n\r<>]|\$\(")

# 明確安全(唯讀/測試),整條完全比對才放行(用 fullmatch 而非 match)
SAFE = re.compile(
    r"\s*(ls|dir|cat|type|pwd|git\s+(status|log|diff|branch)|npm\s+(test|run\s+test|ci|install)|"
    r"pytest|python\s+-m\s+pytest|playwright\s+test|node\s+--version|echo)\b[^;&|`<>]*",
    re.I,
)

# 部署相關:免審核(使用者明確要求),同樣需整條乾淨
DEPLOY = re.compile(r".*(\b(zeabur|vercel|netlify)\b|\bdeploy\b|docker\s+(build|push)).*", re.I)


@dataclass
class Verdict:
    needs_approval: bool
    action: str | None  # 對應審核服務 action
    reason: str


def classify_command(cmd: str) -> Verdict:
    # 1) 黑名單縱深防禦:命中危險樣式 → 需審核
    for pat, action in DANGEROUS:
        if pat.search(cmd):
            return Verdict(True, action, f"命中危險樣式 → {action}")

    # 2) 含 shell 串接/重導向 → 一律送審(防止白名單被前綴繞過)
    has_meta = bool(SHELL_META.search(cmd))
    if has_meta:
        return Verdict(True, "run_command", "含 shell 串接/重導向,保守需審核")

    # 3) 白名單(整條乾淨):部署或唯讀/測試 → 自動放行
    if DEPLOY.fullmatch(cmd.strip()):
        return Verdict(False, None, "部署類(單一乾淨指令),免審核")
    if SAFE.fullmatch(cmd.strip()):
        return Verdict(False, None, "唯讀/測試(單一乾淨指令),自動放行")

    # 4) 其餘任意指令:預設拒絕 → 需審核
    return Verdict(True, "run_command", "未列入白名單,保守需審核")


# 高層任務型別 → 是否需審核
TASK_NEEDS_APPROVAL = {
    "send_email": True,
    "spend_money": True,
    "publish": True,
    "delete_file": True,
    "run_command": True,  # 視實際指令再用 classify_command 細判
    "code_test": False,
    "research": False,
    "draft": False,
}


def classify_task(task_type: str) -> Verdict:
    need = TASK_NEEDS_APPROVAL.get(task_type, True)
    action = task_type if need and task_type in (
        "send_email", "spend_money", "publish", "delete_file", "run_command"
    ) else None
    return Verdict(need, action, f"task_type={task_type}")
