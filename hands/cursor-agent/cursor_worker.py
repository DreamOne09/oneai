"""OneAI Cursor Agent Worker — 方向 B。

功能:從 approval-svc 任務佇列認領 type=cursor_agent 的任務，
     用 Cursor SDK 在本機跑一個 Cursor Agent，把結果回報。
     只認領 cursor_agent 型別的任務（?type=cursor_agent），不搶 agy 的 shell 任務。

啟動:  python hands/cursor-agent/cursor_worker.py

環境變數:
  CURSOR_API_KEY          必填,Cursor 使用者 API key
  APPROVAL_BASE_URL       OneAI approval-svc 網址
  ONEAI_WORKER_TOKEN      worker 認領任務的 token
  CURSOR_AGENT_CWD        Cursor Agent 預設工作目錄(預設 repo 根目錄)
  CURSOR_AGENT_MODEL      使用的 Cursor 模型(預設 composer-2.5)
"""
from __future__ import annotations
import json, os, sys, time, threading, urllib.error, urllib.request
from pathlib import Path

def _load_dotenv() -> None:
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
                    key, val = key.strip(), val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
            return

_load_dotenv()

# ── 依賴確認 ────────────────────────────────────────────────────────────────
try:
    from cursor_sdk import Agent, AgentOptions, LocalAgentOptions, CursorAgentError
except ImportError:
    print("[cursor-worker] 缺少 cursor-sdk:  python -m pip install cursor-sdk", file=sys.stderr)
    sys.exit(1)

# ── 環境變數 ─────────────────────────────────────────────────────────────────
BASE          = os.environ.get("APPROVAL_BASE_URL", "http://localhost:8787").rstrip("/")
WORKER_TOKEN  = os.environ.get("ONEAI_WORKER_TOKEN", "")
CURSOR_KEY    = os.environ.get("CURSOR_API_KEY", "")
DEFAULT_CWD   = os.environ.get("CURSOR_AGENT_CWD", str(Path(__file__).resolve().parents[2]))
DEFAULT_MODEL = os.environ.get("CURSOR_AGENT_MODEL", "composer-2.5")

POLL_TIMEOUT      = 35   # 長輪詢秒數(伺服器最多等 25s)
HEARTBEAT_INTERVAL = 30  # 心跳間隔秒數
BACKOFF_START = 2
BACKOFF_MAX   = 30

AGENT_ID      = os.environ.get("CURSOR_AGENT_ID", "personal/cursor-worker")
AGENT_DISPLAY = os.environ.get("CURSOR_AGENT_DISPLAY", "Cursor IDE")
AGENT_ORG     = os.environ.get("CURSOR_AGENT_ORG", "personal")


def _headers() -> dict:
    return {"Authorization": f"Bearer {WORKER_TOKEN}", "Content-Type": "application/json"}


def _heartbeat(status: str = "idle", current_task: str | None = None) -> None:
    """每 HEARTBEAT_INTERVAL 秒向 approval-svc 回報心跳，讓 PWA Agent 面板顯示在線。"""
    payload = json.dumps({
        "agent_id": AGENT_ID, "display": AGENT_DISPLAY, "org": AGENT_ORG,
        "status": status, "current_task": current_task,
    }).encode()
    req = urllib.request.Request(
        f"{BASE}/agents/heartbeat", data=payload, headers=_headers(), method="POST"
    )
    try:
        urllib.request.urlopen(req, timeout=8).close()
    except Exception:
        pass  # 心跳失敗不影響主流程


def _start_heartbeat_thread(get_status) -> None:
    """背景執行緒持續送心跳（不阻塞任務輪詢迴圈）。"""
    def loop():
        while True:
            try:
                st, task = get_status()
                _heartbeat(st, task)
            except Exception:
                pass
            time.sleep(HEARTBEAT_INTERVAL)
    t = threading.Thread(target=loop, daemon=True)
    t.start()


def _claim_next() -> dict | None:
    """長輪詢認領下一個 cursor_agent 類型的任務（不搶 agy 的 shell 任務）。"""
    req = urllib.request.Request(
        f"{BASE}/tasks/next?type=cursor_agent",
        headers=_headers(), method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=POLL_TIMEOUT) as resp:
            if resp.status == 204:
                return None
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 204:
            return None
        raise


def _report(task_id: str, result: dict) -> None:
    payload = json.dumps(result).encode()
    req = urllib.request.Request(
        f"{BASE}/tasks/{task_id}/result",
        data=payload, headers=_headers(), method="POST",
    )
    urllib.request.urlopen(req, timeout=15).close()


def _run_cursor_agent(task: dict) -> dict:
    """執行 Cursor Agent 並回傳結果。"""
    if not CURSOR_KEY:
        return {"status": "error", "output": "未設定 CURSOR_API_KEY,請至 https://cursor.com/dashboard/integrations 取得"}

    payload = task.get("payload", {})
    prompt  = payload.get("prompt", "")
    cwd     = payload.get("cwd") or DEFAULT_CWD
    model   = payload.get("model") or DEFAULT_MODEL

    if not prompt:
        return {"status": "error", "output": "任務缺少 prompt 欄位"}

    print(f"[cursor-worker] 執行 Cursor Agent\n  cwd={cwd}\n  model={model}\n  prompt={prompt[:120]}", flush=True)

    try:
        result = Agent.prompt(
            prompt,
            AgentOptions(
                api_key=CURSOR_KEY,
                model=model,
                local=LocalAgentOptions(cwd=cwd),
            ),
        )
        status = "done" if result.status == "finished" else "error"
        return {
            "status": status,
            "output": result.result or "(Agent 完成,無文字輸出)",
            "agent_id": result.id,
        }
    except CursorAgentError as e:
        return {"status": "error", "output": f"Cursor Agent 啟動失敗:{e.message} (retryable={e.is_retryable})"}
    except Exception as e:
        return {"status": "error", "output": f"未預期錯誤:{e}"}


def main() -> int:
    if not CURSOR_KEY:
        print("[cursor-worker] ⚠️  CURSOR_API_KEY 未設定", flush=True)
        print("[cursor-worker]    → 請至 https://cursor.com/dashboard/integrations 複製 API key", flush=True)
        print("[cursor-worker]    → 在 .env 加上 CURSOR_API_KEY=cursor_... 後重啟", flush=True)
        print("[cursor-worker]    仍然啟動(認領任務時會回報 error,不崩潰)", flush=True)

    print(f"[cursor-worker] 啟動 → {BASE}  (agent_id={AGENT_ID})", flush=True)
    print(f"[cursor-worker] 預設工作目錄: {DEFAULT_CWD}", flush=True)
    print(f"[cursor-worker] 只認領 type=cursor_agent 任務（agy 負責 shell/agent）", flush=True)

    # 共享狀態讓心跳執行緒讀取
    _state = {"status": "idle", "task": None}

    def get_status():
        return _state["status"], _state["task"]

    _start_heartbeat_thread(get_status)

    backoff = BACKOFF_START
    while True:
        try:
            task = _claim_next()
            backoff = BACKOFF_START
            if not task:
                continue
            tid = task.get("id")
            prompt_preview = (task.get("payload", {}).get("prompt") or "")[:60]
            print(f"[cursor-worker] 認領任務 {tid}: {prompt_preview}", flush=True)
            _state["status"] = "running"
            _state["task"] = prompt_preview
            result = _run_cursor_agent(task)
            _state["status"] = "idle"
            _state["task"] = None
            print(f"[cursor-worker] 任務 {tid} → {result['status']}", flush=True)
            _report(tid, result)

        except KeyboardInterrupt:
            print("\n[cursor-worker] 停止", flush=True)
            _heartbeat("offline")
            return 0
        except Exception as e:
            print(f"[cursor-worker] 錯誤 (退避 {backoff}s): {e}", flush=True)
            time.sleep(backoff)
            backoff = min(backoff * 2, BACKOFF_MAX)


def run_once(prompt: str, cwd: str | None = None) -> None:
    """mcp-core 直接呼叫模式(--once):執行單一任務後退出,結果輸出到 stdout。"""
    task = {"id": "direct", "payload": {"prompt": prompt, "cwd": cwd or DEFAULT_CWD}}
    result = _run_cursor_agent(task)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", metavar="PROMPT", help="單次執行模式")
    parser.add_argument("--cwd", default=None)
    args, _ = parser.parse_known_args()

    if args.once:
        run_once(args.once, args.cwd)
    else:
        raise SystemExit(main())
