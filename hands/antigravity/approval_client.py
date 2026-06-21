"""審核服務客戶端。零外部相依(urllib)。

設計修正(對齊上線必修三項):
- **非阻塞**:POST /request 立即取得 approval_id,改用短連線輪詢 GET /status/:id,
  避免單一連線阻塞數十分鐘被反向代理掐斷。
- **鑑權**:若設定 APPROVAL_TOKEN,所有對服務的呼叫帶 Bearer token。
- 服務不可達 / 逾時 → 一律視為「拒絕」(fail-safe)。
"""
from __future__ import annotations
import hashlib
import json
import os
import time
import urllib.request
import urllib.error

APPROVAL_BASE = os.getenv("APPROVAL_BASE_URL", "http://localhost:8787")
APPROVAL_TOKEN = os.getenv("APPROVAL_TOKEN", "")
DEFAULT_TIMEOUT = int(os.getenv("APPROVAL_DEFAULT_TIMEOUT_SEC", "1800"))
POLL_INTERVAL = float(os.getenv("APPROVAL_POLL_INTERVAL_SEC", "3"))
HTTP_TIMEOUT = 15  # 每次連線都短,靠輪詢累積等待


def _headers(extra: dict | None = None) -> dict:
    h = {"Content-Type": "application/json"}
    if APPROVAL_TOKEN:
        h["Authorization"] = f"Bearer {APPROVAL_TOKEN}"
    if extra:
        h.update(extra)
    return h


def _params_hash(action: str, details: dict | None) -> str:
    """對「動作 + 參數」算 sha256;批准後比對,確保『批准的 == 將執行的』(防 TOCTOU)。"""
    canon = json.dumps({"action": action, "details": details or {}},
                       sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def _create(action: str, summary: str, details: dict | None,
            timeout_sec: int, params_hash: str) -> str | None:
    payload = json.dumps({
        "action": action,
        "summary": summary,
        "details": details or {},
        "timeout_sec": timeout_sec,
        "params_hash": params_hash,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{APPROVAL_BASE.rstrip('/')}/request",
        data=payload, headers=_headers(), method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("approval_id")
    except urllib.error.URLError as e:
        print(f"[approval] 建立審核失敗,視為拒絕: {e}")
        return None


def _poll(approval_id: str, timeout_sec: int, expected_hash: str) -> str:
    deadline = time.time() + timeout_sec + 15  # 略多於服務端逾時
    url = f"{APPROVAL_BASE.rstrip('/')}/status/{approval_id}"
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        req = urllib.request.Request(url, headers=_headers(), method="GET")
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if not data.get("settled"):
                    continue
                decision = data.get("decision", "rejected")
                # 防 TOCTOU:批准必須對應到當初送審的同一份參數雜湊
                if decision == "approved" and data.get("params_hash") != expected_hash:
                    print("[approval] 參數雜湊不符,視為拒絕(防 TOCTOU)")
                    return "rejected"
                return decision
        except urllib.error.URLError:
            continue  # 暫時性失敗,繼續輪詢
    return "rejected"  # 逾時 fail-safe


def request_approval(action: str, summary: str, details: dict | None = None,
                     timeout_sec: int | None = None) -> str:
    """建立審核並輪詢結果。回傳 'approved' 或 'rejected'。"""
    timeout_sec = timeout_sec or DEFAULT_TIMEOUT
    phash = _params_hash(action, details)
    approval_id = _create(action, summary, details, timeout_sec, phash)
    if not approval_id:
        return "rejected"
    return _poll(approval_id, timeout_sec, phash)
