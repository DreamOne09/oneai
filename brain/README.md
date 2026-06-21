# brain — 數位孿生知識庫 (The Brain)

Obsidian vault（語氣/知識來源）+ ChromaDB（向量檢索）。Agent 產出前先檢索，達成「李孟一式、去 AI 味」。

## 結構

```
brain/
├─ vault/                 # Obsidian 庫 (local-first, obsidian-git 同步到私有 repo)
│  ├─ AGENTS.md           # vault 操作守則 (給 Agent,跨工具通用)
│  ├─ .obsidian/          # Obsidian 設定 (開資料夾即為 vault)
│  ├─ persona/            # 語氣側寫 (唯讀)
│  ├─ raw/ wiki/ insights/ templates/
└─ rag/                   # 索引/檢索腳本
   ├─ config.py  chunker.py  index_vault.py  query_vault.py  reindex_hook.py
   └─ requirements.txt
```

## 快速開始

```bash
cd brain/rag
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt

# 指向你的 Obsidian 庫 (可選,預設用 repo 內 vault)
set OBSIDIAN_VAULT_PATH=C:\path\to\your\vault
set OPENAI_API_KEY=sk-...        # 沒有則用內建本地嵌入模型

python index_vault.py            # 全量索引
python query_vault.py "提案怎麼開頭" 5
```

## 記憶寫回（自我進化的核心）

> 「不會忘 + 會進化」靠這個迴圈：互動 → 萃取 → `remember()` → markdown → 索引 → 下次檢索得到。

```bash
# 寫回一則記憶（會存進 insights/agent/ 並立即索引）
python remember.py --kind preference "孟一偏好提案開頭用痛點直球，不要寒暄"
```

- 寫進 `insights/agent/` 命名空間，與人工筆記分流，避免 git 衝突。
- 記憶是 **markdown（人可讀/可攜）+ git（版本/備份）+ 向量（檢索）** 三重保險。
- 邊界：自我進化 = 結構化記憶成長，**不改程式、不重訓模型**。
- Agent 可透過 MCP 工具 `remember` 直接寫回（見 `bridge/`）。

## 永不遺忘：git / GitHub 同步

vault 本身已是 git repo（`brain/vault/.git`）。推上私有 GitHub：

```bash
cd brain/vault
# 用 GitHub 網站或 gh 建一個「私有」repo 後：
git remote add origin git@github.com:<你>/limengyi-vault.git
git push -u origin main
```

之後在 Obsidian 裝 `obsidian-git` 自動 commit/push；雲端大腦讀同一 repo。

> 不變量：**markdown 在 git 是唯一事實來源；向量索引只是可隨時重建的快取。**

## 自動重索引

- `obsidian-git` 同步後或排程器定時跑 `python reindex_hook.py`。
- 單檔增量：`python index_vault.py path\to\note.md`。

## 在 Obsidian 開啟此 vault

1. 下載 Obsidian → 「Open folder as vault」→ 選 `brain/vault`（已內含 `.obsidian/`，會直接被辨識為 vault）。
2. 日常就在這裡寫筆記；Agent 也讀同一份。

## 讓 Agent 讀寫 vault（obsidian-mcp，選配）

1. Obsidian 裝社群外掛 **Local REST API**，啟用並取得 API key。
2. 跑 `obsidian-mcp` server，環境變數填 `OBSIDIAN_API_KEY` / `OBSIDIAN_API_URL`（見根 `.env.example`）。
3. 在 Cursor / Antigravity 的 MCP 設定掛上它，Agent 即可 `vault_read/write/patch/search`。

> 註：本 repo 的 `bridge/mcp-core` 已提供 `vault_query` 工具（走 RAG 檢索）；obsidian-mcp 則補上「直接讀寫原始筆記」的能力，兩者互補。

## 自動同步（obsidian-git，選配）

Obsidian 裝 **obsidian-git** → 設定每 N 分鐘 auto-commit/push 到**私有** GitHub repo。雲端可 pull 同一 repo 後再索引。

## 嵌入模型（重要）

`config.py` 自動偵測：有 `OPENAI_API_KEY` 用 `text-embedding-3-small`，否則用 chromadb 內建本地模型 `all-MiniLM-L6-v2`（首次下載 ~80MB）。

> ⚠️ **中文檢索品質**：內建 `all-MiniLM-L6-v2` 以英文為主，中文語意排序較弱（實測首頁會排在提案筆記之前）。**正式使用請設 `OPENAI_API_KEY`** 改用 OpenAI 嵌入，中文準度明顯較好；或改用多語模型（如 `paraphrase-multilingual-MiniLM-L12-v2`）。

## 待辦

- [ ] 把電腦中的 `MENG_YI_PROFILE.md` / `SAM_AI_EXPORT.md` 整理進 `persona/` 與 `raw/`。
- [ ] 設 `OPENAI_API_KEY` 後重跑 `python index_vault.py` 以提升中文檢索準度。
