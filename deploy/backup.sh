#!/usr/bin/env bash
# Бэкап Кадра. Ставится install.sh как служба kadr-backup (каждую ночь в 4:30). Вручную:
#   bash /opt/kadr/backup.sh            — бэкап базы и настроек (+ фото/видео по воскресеньям)
#   bash /opt/kadr/backup.sh --full     — то же + фото/видео прямо сейчас
set -euo pipefail
APP=/opt/kadr
DATA=$APP/data
DST=$APP/backups
mkdir -p "$DST"
chmod 700 "$DST"
TS=$(date +%Y%m%d-%H%M)

[ -f "$DATA/data.json" ] || { echo "Нет $DATA/data.json — нечего сохранять"; exit 1; }

# 1. база: копия data.json (сервер пишет её атомарно, копия всегда целая)
gzip -c "$DATA/data.json" > "$DST/data-$TS.json.gz.tmp" && mv "$DST/data-$TS.json.gz.tmp" "$DST/data-$TS.json.gz"

# 2. настройки и ключи (бот, почта, DKIM, секрет отписки, пароль @kadr если ещё не сменён)
tar -czf "$DST/config-$TS.tar.gz" -C "$DATA" $(cd "$DATA" && ls -1 telegram.json mail.json dkim.pem secret.key ADMIN_PASSWORD.txt 2>/dev/null || true) 2>/dev/null || true
[ -s "$DST/config-$TS.tar.gz" ] || rm -f "$DST/config-$TS.tar.gz"
cp /opt/kadr/domain "$DST/domain-$TS.txt" 2>/dev/null || true

# 3. фото и видео: по воскресеньям или с --full
if [ "${1:-}" = "--full" ] || [ "$(date +%u)" = "7" ]; then
  NEED=$(du -sk "$DATA/uploads" 2>/dev/null | awk '{print $1}')
  FREE=$(df -Pk "$DST" | awk 'NR==2{print $4}')
  if [ -n "$NEED" ] && [ "$FREE" -gt $((NEED * 2 + 1048576)) ]; then
    tar -cf "$DST/uploads-$TS.tar.tmp" -C "$DATA" uploads && mv "$DST/uploads-$TS.tar.tmp" "$DST/uploads-$TS.tar"
    echo "Фото и видео сохранены: $DST/uploads-$TS.tar"
  else
    echo "!! Мало места на диске для копии фото и видео (нужно ~$((NEED*2/1024)) МБ, свободно $((FREE/1024)) МБ) — пропускаю"
  fi
fi

# 4. чистка старого: база и настройки — 30 дней, фото/видео — 2 последние копии
ls -1t "$DST"/data-*.json.gz 2>/dev/null | tail -n +31 | xargs -r rm --
ls -1t "$DST"/config-*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm --
ls -1t "$DST"/domain-*.txt 2>/dev/null | tail -n +31 | xargs -r rm --
ls -1t "$DST"/uploads-*.tar 2>/dev/null | tail -n +3 | xargs -r rm --
rm -f "$DST"/*.tmp

echo "Бэкап готов: $DST/data-$TS.json.gz"

# 5. копия базы вне сервера — в Telegram админам (если бот подключён и файл меньше 45 МБ)
if [ -f "$DATA/telegram.json" ]; then
  TOKEN=$(node -e "try{process.stdout.write(require('$DATA/telegram.json').token||'')}catch(e){}")
  CHATS=$(node -e "
    try{const d=JSON.parse(require('fs').readFileSync('$DATA/data.json','utf8'));
    console.log(Object.values(d.users).filter(u=>u.role==='admin'&&u.tg&&u.tg.chatId).map(u=>u.tg.chatId).join(' '));}catch(e){}")
  SIZE=$(stat -c %s "$DST/data-$TS.json.gz")
  if [ -n "$TOKEN" ] && [ -n "$CHATS" ] && [ "$SIZE" -lt 47185920 ]; then
    for C in $CHATS; do
      curl -s --max-time 120 -F "chat_id=$C" -F "document=@$DST/data-$TS.json.gz" \
        -F "caption=🗄 Бэкап базы Кадра $(date '+%d.%m.%Y %H:%M'). Храните в секрете: внутри почты пользователей и хэши паролей." \
        "https://api.telegram.org/bot$TOKEN/sendDocument" >/dev/null && echo "Копия отправлена в Telegram ($C)" || echo "!! Не удалось отправить копию в Telegram"
    done
  fi
fi
