"""OneAI 本機肉體 worker(反向輪詢)。

設計理由(對齊 docs/12 與雲端橋樑決策):
- 你的電腦在 NAT/防火牆後,故採「只對外連線」模型:本 worker 主動長輪詢雲端
  approval-svc 的任務佇列,**不開任何對外入口**,最安全、NAT 友善。
- 取得任務後交給 executor(政策→手機審核→沙箱執行),再把精簡結果回報雲端。
- 審核護欄在 executor 內完成(executor 會呼叫 approval-svc 送手機),worker 不重複審核。

需要的環境變數:
- APPROVAL_BASE_URL     雲端審核/佇列服務(例: https://oneai-approval.zeabur.app)
- ONEAI_WORKER_TOKEN    worker 專屬密鑰(與 approval-svc 同值;最小權限)
- APPROVAL_TOKEN        executor 送審用(approval_client 會讀);與 approval-svc 同值

啟動:  python hands/antigravity/worker.py
停止:  Ctrl+C
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict
from pathlib import Path

# ── 自動載入 .env（從專案根目錄往上找）────────────────────────────────────────
def _load_dotenv() -> None:
    """找到最近的 .env 並手動解析，不依賴 python-dotenv 套件。"""
    here = Path(__file__).resolve()
    for parent in [here.parent, here.parent.parent, here.parent.parent.parent]:
        env_file = parent / ".env"
        if env_file.exists():
            with open(env_file, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:   # 不覆蓋已有的環境變數
                        os.environ[key] = val
            print(f"[worker] 已載入 .env ← {env_file}", flush=True)
            return

_load_dotenv()

# 與 executor 同目錄,確保可 import 其相依(policy / approval_client / cli_bridge)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from executor import run_command, run_task, TaskResult  # noqa: E402

BASE = os.getenv("APPROVAL_BASE_URL", "http://localhost:8787").rstrip("/")
WORKER_TOKEN = os.getenv("ONEAI_WORKER_TOKEN", "")
AGENT_ID = os.getenv("ONEAI_AGENT_ID", "personal/desktop-worker")
AGENT_DISPLAY = os.getenv("ONEAI_AGENT_DISPLAY", "桌上電腦")
AGENT_ORG = os.getenv("ONEAI_AGENT_ORG", "personal")
# 長輪詢:伺服器約 25s 才回 204,故連線逾時要比它長
POLL_HTTP_TIMEOUT = 40
RESULT_HTTP_TIMEOUT = 15
HEARTBEAT_INTERVAL = 30  # 秒
# 連線失敗時的退避(秒),指數成長到上限
BACKOFF_START = 2
BACKOFF_MAX = 30


def _headers() -> dict:
    return {"Authorization": f"Bearer {WORKER_TOKEN}", "Content-Type": "application/json"}


def _heartbeat(status: str = "idle", current_task: str | None = None) -> None:
    payload = json.dumps({
        "agent_id": AGENT_ID, "display": AGENT_DISPLAY, "org": AGENT_ORG,
        "status": status, "current_task": current_task,
    }).encode()
    req = urllib.request.Request(f"{BASE}/agents/heartbeat", data=payload, headers=_headers(), method="POST")
    try:
        urllib.request.urlopen(req, timeout=8).close()
    except Exception:
        pass  # 心跳失敗不影響主流程


def _claim_next() -> dict | None:
    """長輪詢認領 shell/agent 任務（?type=shell,agent 不搶 cursor_agent 任務）。"""
    req = urllib.request.Request(
        f"{BASE}/tasks/next?type=shell,agent",
        headers=_headers(), method="GET",
    )
    with urllib.request.urlopen(req, timeout=POLL_HTTP_TIMEOUT) as resp:
        if resp.status == 204:
            return None
        body = resp.read().decode("utf-8")
        return json.loads(body) if body else None


def _report(task_id: str, result: TaskResult) -> None:
    payload = json.dumps(asdict(result)).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/tasks/{task_id}/result", data=payload, headers=_headers(), method="POST"
    )
    try:
        urllib.request.urlopen(req, timeout=RESULT_HTTP_TIMEOUT).close()
    except urllib.error.URLError as e:
        print(f"[worker] 回報結果失敗(任務 {task_id}): {e}", flush=True)


def _execute(task: dict) -> TaskResult:
    """依任務型別交給 executor(內含審核護欄)。未知型別/壞參數 → error。"""
    ttype = task.get("type")
    payload = task.get("payload") or {}
    try:
        if ttype == "shell":
            cmd = payload.get("cmd")
            if not cmd:
                return TaskResult("error", "缺少 cmd")
            return run_command(cmd, payload.get("cwd"))
        if ttype == "agent":
            prompt = payload.get("prompt")
            if not prompt:
                return TaskResult("error", "缺少 prompt")
            return run_task(payload.get("task_type", "general"), prompt, payload.get("cwd"))
        return TaskResult("error", f"未知任務型別: {ttype}")
    except Exception as e:  # 執行器任何例外都不該讓 worker 崩潰
        return TaskResult("error", f"執行器例外: {e}")


def main() -> int:
    if not WORKER_TOKEN:
        print("[worker] 未設定 ONEAI_WORKER_TOKEN,無法連線任務佇列。", flush=True)
        return 2
    print(f"[worker] OneAI 本機肉體 worker 啟動 → {BASE}(Ctrl+C 停止)", flush=True)

    backoff = BACKOFF_START
    last_heartbeat = 0.0
    while True:
        try:
            # 心跳(每 HEARTBEAT_INTERVAL 秒一次,不阻塞主迴圈)
            now = time.time()
            if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                _heartbeat("idle")
                last_heartbeat = now

            task = _claim_next()
            backoff = BACKOFF_START  # 成功連線即重置退避
            if not task:
                continue  # 204:沒任務,馬上再長輪詢
            tid = task.get("id")
            print(f"[worker] 認領任務 {tid} ({task.get('type')})", flush=True)
            _heartbeat("running", task.get("payload", {}).get("cmd") or task.get("payload", {}).get("prompt", "")[:60])
            result = _execute(task)
            print(f"[worker] 任務 {tid} → {result.status}", flush=True)
            _heartbeat("idle")
            _report(tid, result)
        except KeyboardInterrupt:
            print("\n[worker] 已停止。", flush=True)
            return 0
        except urllib.error.HTTPError as e:
            # 401/503 等:設定問題,不該瘋狂重試
            print(f"[worker] HTTP {e.code}:{e.reason}(檢查 token / 服務是否啟用佇列)", flush=True)
            time.sleep(backoff)
            backoff = min(backoff * 2, BACKOFF_MAX)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print(f"[worker] 連線問題,{backoff}s 後重試: {e}", flush=True)
            time.sleep(backoff)
            backoff = min(backoff * 2, BACKOFF_MAX)


if __name__ == "__main__":
    raise SystemExit(main())
