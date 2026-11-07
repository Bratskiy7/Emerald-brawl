#!/usr/bin/env bash
# Восстановление Кадра из бэкапа. Запускать от root:
#   bash /opt/kadr/restore.sh                       — показать доступные бэкапы
#   bash /opt/kadr/restore.sh data-20261108-0430.json.gz          — вернуть базу
#   bash /opt/kadr/restore.sh uploads-20261108-0430.tar           — вернуть фото и видео
#   bash /opt/kadr/restore.sh config-20261108-0430.tar.gz         — вернуть настройки (бот, почта, DKIM)
# Перед восстановлением текущее состояние сохраняется (before-restore-*).
set -euo pipefail
APP=/opt/kadr; DATA=$APP/data; DST=$APP/backups
if [ -z "${1:-}" ]; then
  echo "Доступные бэкапы (новые сверху):"; ls -1t "$DST" 2>/dev/null | grep -E '^(data|uploads|config)-' | head -40
  echo; echo "Использование: bash $0 <имя файла>"; exit 0
fi
F="$1"; [ -f "$F" ] || F="$DST/$1"
[ -f "$F" ] || { echo "Файл не найден: $1"; exit 1; }
TS=$(date +%Y%m%d-%H%M%S)
case "$(basename "$F")" in
  data-*.json.gz)
    gzip -t "$F" || { echo "Архив повреждён"; exit 1; }
    gunzip -c "$F" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);if(!d.users)process.exit(2)})" 2>/dev/null \
      || { echo "В архиве не база Кадра"; exit 1; }
    systemctl stop kadr
    cp "$DATA/data.json" "$DST/before-restore-$TS.json" 2>/dev/null || true
    gunzip -c "$F" > "$DATA/data.json.tmp" && mv "$DATA/data.json.tmp" "$DATA/data.json"
    systemctl start kadr; echo "База восстановлена из $(basename "$F"). Прежняя сохранена: $DST/before-restore-$TS.json" ;;
  data-*.json)
    node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(!d.users)process.exit(2)" "$F" 2>/dev/null || { echo "В файле не база Кадра"; exit 1; }
    systemctl stop kadr
    cp "$DATA/data.json" "$DST/before-restore-$TS.json" 2>/dev/null || true
    cp "$F" "$DATA/data.json.tmp" && mv "$DATA/data.json.tmp" "$DATA/data.json"
    systemctl start kadr; echo "База восстановлена из $(basename "$F")." ;;
  uploads-*.tar)
    systemctl stop kadr
    [ -d "$DATA/uploads" ] && mv "$DATA/uploads" "$DST/before-restore-uploads-$TS"
    tar -xf "$F" -C "$DATA"
    systemctl start kadr; echo "Фото и видео восстановлены. Прежние: $DST/before-restore-uploads-$TS" ;;
  config-*.tar.gz)
    systemctl stop kadr
    tar -czf "$DST/before-restore-config-$TS.tar.gz" -C "$DATA" $(cd "$DATA" && ls -1 telegram.json mail.json dkim.pem secret.key 2>/dev/null || true) 2>/dev/null || true
    tar -xzf "$F" -C "$DATA"; chmod 600 "$DATA"/*.json "$DATA"/dkim.pem "$DATA"/secret.key 2>/dev/null || true
    systemctl start kadr; echo "Настройки восстановлены." ;;
  *) echo "Не понимаю, что это за файл. Нужен data-*.json.gz, uploads-*.tar или config-*.tar.gz"; exit 1 ;;
esac
