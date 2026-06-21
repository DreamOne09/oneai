# OneAI 自動備份服務
# 基於 mongo:7 映像(內建 mongodump),加輕量 Python 排程。
# build context = infra/zeabur/backup/
FROM mongo:7

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends python3 python3-pip && \
    pip3 install --no-cache-dir schedule requests --break-system-packages && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY backup.py /backup.py

# 備份存放路徑;在 Zeabur Dashboard 掛 Volume → /data/backups 以持久化
VOLUME ["/data/backups"]

ENV BACKUP_KEEP_DAYS=7 \
    BACKUP_HOUR=3

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD pgrep -f backup.py || exit 1

CMD ["python3", "-u", "/backup.py"]
