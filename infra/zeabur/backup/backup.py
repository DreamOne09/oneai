"""OneAI 自動備份服務。

備份策略:
  - MongoDB (LibreChat 對話/設定): 每日 03:00 mongodump → tar.gz → 保留 BACKUP_KEEP_DAYS 天
  - approval.json 已在 Zeabur 持久卷,不另備份(重啟不遺失)
  - Vault/Obsidian 以 git 為 SSOT,不另備份

備份存放: Zeabur 持久卷 /data/backups/(需在 Dashboard 掛卷)
Offsite 備份: 設 GITHUB_BACKUP_TOKEN + GITHUB_BACKUP_REPO 則額外推到 GitHub private repo

需要的環境變數:
  MONGO_URI             MongoDB 連線字串(已在 librechat 服務有,此處另外設)
  APPROVAL_BASE_URL     審核服務網址(發完成/失敗通知)
  APPROVAL_TOKEN        審核服務密鑰
  BACKUP_KEEP_DAYS      本地保留天數(預設 7)
  BACKUP_HOUR           每日幾點跑(預設 3,即 03:00 伺服器時間)
  GITHUB_BACKUP_TOKEN   (選填) GitHub PAT,有則推 offsite
  GITHUB_BACKUP_REPO    (選填) 形如 user/oneai-backups
"""
from __future__ import annotations
import os, subprocess, datetime, shutil, schedule, time, pathlib, sys

try:
    import requests
    _HAVE_REQUESTS = True
except ImportError:
    _HAVE_REQUESTS = False

MONGO_URI = os.environ["MONGO_URI"]  # 必填,缺失直接崩潰以利排查
APPROVAL_BASE = os.environ.get("APPROVAL_BASE_URL", "").rstrip("/")
APPROVAL_TOKEN = os.environ.get("APPROVAL_TOKEN", "")
BACKUP_DIR = pathlib.Path("/data/backups")
KEEP_DAYS = int(os.environ.get("BACKUP_KEEP_DAYS", "7"))
BACKUP_HOUR = int(os.environ.get("BACKUP_HOUR", "3"))
GH_TOKEN = os.environ.get("GITHUB_BACKUP_TOKEN", "")
GH_REPO = os.environ.get("GITHUB_BACKUP_REPO", "")


# ── 通知 ────────────────────────────────────────────────────────────────────
def _notify(title: str, body: str) -> None:
    if not (APPROVAL_BASE and APPROVAL_TOKEN and _HAVE_REQUESTS):
        print(f"[backup] 通知(無法發送): {title} — {body}", flush=True)
        return
    try:
        requests.post(
            f"{APPROVAL_BASE}/notify",
            json={"title": title, "body": body},
            headers={"Authorization": f"Bearer {APPROVAL_TOKEN}"},
            timeout=10,
        )
    except Exception as e:
        print(f"[backup] 通知失敗(非致命): {e}", flush=True)


# ── Offsite:推到 GitHub private repo ────────────────────────────────────────
def _github_upload(archive: pathlib.Path) -> None:
    if not (GH_TOKEN and GH_REPO and _HAVE_REQUESTS):
        return
    ts = archive.stem.replace("mongo_", "")
    # 上傳到 GitHub Releases(用日期當 tag)
    tag = f"backup-{ts[:8]}"
    api = f"https://api.github.com/repos/{GH_REPO}"
    headers = {"Authorization": f"token {GH_TOKEN}", "Accept": "application/vnd.github+json"}
    # 建立 release(若已存在則跳過)
    rel = requests.post(f"{api}/releases", headers=headers, json={
        "tag_name": tag, "name": f"Backup {ts[:8]}", "draft": False, "prerelease": True,
    }, timeout=20)
    if rel.status_code not in (201, 422):  # 422 = 已存在
        print(f"[backup] GitHub release 建立失敗: {rel.status_code}", flush=True)
        return
    # 取 release id
    if rel.status_code == 422:
        existing = requests.get(f"{api}/releases/tags/{tag}", headers=headers, timeout=10)
        release_id = existing.json().get("id")
    else:
        release_id = rel.json().get("id")
    if not release_id:
        return
    # 上傳 asset
    upload_url = f"https://uploads.github.com/repos/{GH_REPO}/releases/{release_id}/assets?name={archive.name}"
    with open(archive, "rb") as f:
        up = requests.post(upload_url, headers={**headers, "Content-Type": "application/gzip"}, data=f, timeout=120)
    if up.status_code == 201:
        print(f"[backup] GitHub offsite 上傳成功: {archive.name}", flush=True)
    else:
        print(f"[backup] GitHub offsite 上傳失敗: {up.status_code}", flush=True)


# ── 清理舊備份 ───────────────────────────────────────────────────────────────
def _rotate() -> None:
    cutoff = datetime.datetime.now().timestamp() - KEEP_DAYS * 86400
    for f in BACKUP_DIR.glob("mongo_*.tar.gz"):
        if f.stat().st_mtime < cutoff:
            f.unlink()
            print(f"[backup] 刪除舊備份 {f.name}", flush=True)


# ── 主備份流程 ───────────────────────────────────────────────────────────────
def backup() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    out_dir = BACKUP_DIR / f"mongo_{ts}"
    archive = BACKUP_DIR / f"mongo_{ts}.tar.gz"

    print(f"[backup] === 開始備份 {ts} ===", flush=True)
    try:
        # mongodump
        result = subprocess.run(
            ["mongodump", f"--uri={MONGO_URI}", f"--out={out_dir}"],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode != 0:
            raise RuntimeError(f"mongodump 失敗:\n{result.stderr[-500:]}")

        # 壓縮
        subprocess.run(
            ["tar", "-czf", str(archive), "-C", str(BACKUP_DIR), f"mongo_{ts}"],
            check=True, timeout=120,
        )
        shutil.rmtree(out_dir, ignore_errors=True)

        size_mb = archive.stat().st_size / 1024 / 1024
        print(f"[backup] 完成 → {archive.name} ({size_mb:.2f} MB)", flush=True)

        # Offsite(選填)
        _github_upload(archive)

        # 清理
        _rotate()

        remaining = sorted(BACKUP_DIR.glob("mongo_*.tar.gz"))
        _notify(
            "✅ OneAI 備份完成",
            f"{ts[:8]} · {size_mb:.1f} MB · 保留 {len(remaining)} 個備份",
        )

    except Exception as e:
        print(f"[backup] !!! 備份失敗: {e}", flush=True)
        _notify("❌ OneAI 備份失敗", str(e)[:250])
        shutil.rmtree(out_dir, ignore_errors=True)


# ── 排程 ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"[backup] 備份服務啟動 — 每日 {BACKUP_HOUR:02d}:00 UTC 執行,保留 {KEEP_DAYS} 天", flush=True)
    backup()  # 啟動時立即跑一次確認連線正常
    schedule.every().day.at(f"{BACKUP_HOUR:02d}:00").do(backup)
    while True:
        schedule.run_pending()
        time.sleep(60)
