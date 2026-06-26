# 24 - OneAI 版本演進管線（2.0 → 10.0）

> **用途**：每個大版本完成 **診斷 → GTX-100 → 使用者 E2E → 子 Agent 議會辯論 → 文件更新** 的標準週期。  
> **SSOT 路線圖**：[`config/oneai.version-roadmap.json`](../config/oneai.version-roadmap.json)

---

## 週期五步（每版必跑）

| 步驟 | 腳本 | 產出 |
|------|------|------|
| 1 診斷 | `version-evolution-pipeline.py` | health / version / staff / blockers |
| 2 GTX-100 | `oneai-gtx-100.py` | `oneai-gtx-100-results.json` |
| 3 使用者 E2E | `user-scenario-sim.py` + `human-loop-sim.py` | `*-results.json` |
| 4 議會辯論 | `version-council-debate.js` | `docs/evolution/council-{v}.md` |
| 5 文件 | 管線自動 | `docs/evolution/{v}-cycle-report.md` |

---

## 指令

```powershell
cd C:\Users\b1993\.cursor\projects\empty-window

# 單版完整週期（2.0 實測）
python scripts/version-evolution-pipeline.py --version 2.0

# 2.0→10.0 規劃週期（跳過 GTX/E2E，只辯論+文件）
python scripts/version-evolution-pipeline.py --from 2.0 --to 10.0 --plan-only

# 指定範圍、完整實測（耗時長，需雲端 LLM）
python scripts/version-evolution-pipeline.py --from 2.0 --to 3.0
```

---

## 版本路線（摘要）

| 版本 | 代號 | 北極星 |
|------|------|--------|
| 2.0 | digital-office | 數位辦公室：辯論、編制、派工 |
| 3.0 | hands-first | 自動派工、Skill 重用 |
| 4.0 | memory-graph | FAMA 遺忘、偏好圖譜 |
| 5.0 | autopilot | 晨報、監控、主動推送 |
| 6.0 | omnichannel | LINE/TG 薄通道 |
| 7.0 | enterprise-guard | 高風險 HITL 全面化 |
| 8.0 | hermes-247 | VPS worker 24/7 |
| 9.0 | langgraph-hitl | Graph 編排 + 人類節點 |
| 10.0 | singularity-team | GTX 100/100 全綠 |

詳細 GA 門檻見 `oneai.version-roadmap.json`。

---

## 產物目錄

```
docs/evolution/
  00-evolution-log.md          # 索引
  2.0-cycle-report.md          # 週期報告
  council-2.0.md               # 議會紀錄
scripts/evolution/
  2.0-cycle.json               # 機器可讀 artifact
  2.0-council-input.json
```

---

## GA 判定（2.0 範例）

- GTX 自動情境 ≥ 18/22 通過
- 使用者模擬 ≥ 8/15 通過
- `/health` 版本 = `2.0.0`
- 議會定稿 P0 行動已寫入 cycle report

**注意**：3.0→10.0 須先 **實作 wave_deliverables** 再跑完整 GTX；`--plan-only` 僅產出辯論與文件，不代表該版已 GA。

---

## 與 GTX-100 的關係

- **100 loop** = `docs/20-oneai-2.0-day-plan.md` 定義的 100 情境
- 目前自動可測 ~22 項；其餘手動或 Wave 2+ 補齊
- 每版 GA 目標遞增（3.0→35、…、10.0→100 全綠）
