# OneAI RAG 服務(雲端大腦)— build context = brain/(在 brain/ 執行 `zeabur deploy`)
# 輕量:雲端走 OpenRouter 嵌入(設 EMBEDDING_API_KEY),免 torch。
# 本機要用免費 bge 請直接跑 rag/service.py(裝 rag/requirements-local.txt),不走此映像。
FROM python:3.11-slim

WORKDIR /app
COPY rag/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY rag/ ./rag/
COPY vault/ ./vault/

# vault 與索引路徑;索引(.chroma)建議掛 Zeabur 持久卷,避免重啟重建。
ENV OBSIDIAN_VAULT_PATH=/app/vault \
    CHROMA_DIR=/app/.chroma
VOLUME ["/app/.chroma"]

# Zeabur 會注入 PORT(=${WEB_PORT});綁定 $PORT 才能被正確路由,本機預設 8000。
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD python -c "import os,urllib.request,sys; p=os.environ.get('PORT','8000'); sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{p}/health').getcode()==200 else 1)" || exit 1

# 啟動:先建索引(個人 vault 量小,雲端嵌入秒級),再起常駐服務(綁 $PORT)。
WORKDIR /app/rag
CMD ["sh", "-c", "python index_vault.py && python -m uvicorn service:app --host 0.0.0.0 --port ${PORT:-8000}"]
