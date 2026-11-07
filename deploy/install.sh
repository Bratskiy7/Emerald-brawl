#!/usr/bin/env bash
# Установка и обновление «Кадра» на VDS. Запускать от root:
#   bash /root/kadr/deploy/install.sh
# Повторный запуск безопасен: данные (/opt/kadr/data) не трогаются, перед обновлением делается копия data.json.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/kadr
# Домен запоминается в /opt/kadr/domain. Сменить: KADR_DOMAIN=ваш-домен.ru bash install.sh
SAVED_DOMAIN="$(cat /opt/kadr/domain 2>/dev/null || true)"
DOMAIN="${KADR_DOMAIN:-${SAVED_DOMAIN:-kadr.193-247-73-123.sslip.io}}"
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/*}"
OLD_PORT="$(sed -n 's/^Environment=PORT=//p' /etc/systemd/system/kadr.service 2>/dev/null || true)"
PORT="${KADR_PORT:-${OLD_PORT:-3200}}"

command -v node >/dev/null || { echo "Нет Node.js. Он должен быть уже установлен для S-Message."; exit 1; }

mkdir -p "$APP/data" "$APP/backups"
if [ "$DOMAIN" != "kadr.193-247-73-123.sslip.io" ]; then
  IP="$(curl -s --max-time 10 https://api.ipify.org || true)"
  RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)"
  if [ -z "$RESOLVED" ] || { [ -n "$IP" ] && [ "$RESOLVED" != "$IP" ]; }; then
    echo "!! Домен $DOMAIN пока не указывает на этот сервер (${RESOLVED:-не найден}, а сервер ${IP:-?})."
    echo "   Добавьте у регистратора A-запись: $DOMAIN → ${IP:-IP сервера}. Обычно она начинает работать за 15–60 минут."
    exit 1
  fi
fi
echo "$DOMAIN" > "$APP/domain"
if [ -f "$APP/data/data.json" ]; then
  cp "$APP/data/data.json" "$APP/backups/data-$(date +%Y%m%d-%H%M%S).json"
  ls -1t "$APP/backups"/data-*.json | tail -n +31 | xargs -r rm --
fi
cp "$SRC"/*.js "$APP/"
rm -rf "$APP/public" && cp -r "$SRC/public" "$APP/public"

cat > /etc/systemd/system/kadr.service <<EOF
[Unit]
Description=Kadr photo social network
After=network.target

[Service]
WorkingDirectory=$APP
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=KADR_DATA=$APP/data
Environment=KADR_URL=https://$DOMAIN/
ExecStart=$(command -v node) $APP/server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
# входящая почта для своего домена: порт 25
if [ "$DOMAIN" != "kadr.193-247-73-123.sslip.io" ]; then
  if ss -ltn 2>/dev/null | grep -q ':25 ' && ! ss -ltnp 2>/dev/null | grep ':25 ' | grep -q node; then
    echo "!! Порт 25 уже занят другой почтовой программой — приём писем Кадра не будет запущен."
  fi
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 25/tcp >/dev/null && echo "Файрвол: порт 25 открыт для входящей почты"; fi
fi
systemctl daemon-reload
systemctl enable kadr >/dev/null 2>&1
systemctl restart kadr

NAME=kadr; [ "$DOMAIN" = "kadr.193-247-73-123.sslip.io" ] || NAME="kadr-$DOMAIN"
if [ -d /etc/nginx/sites-available ]; then CONF=/etc/nginx/sites-available/$NAME; LINK=/etc/nginx/sites-enabled/$NAME; else CONF=/etc/nginx/conf.d/$NAME.conf; LINK=""; fi
if [ ! -f "$CONF" ]; then
  cat > "$CONF" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 100m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
    }
}
EOF
  [ -n "$LINK" ] && ln -sf "$CONF" "$LINK"
  nginx -t && systemctl reload nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect \
    || echo "!! certbot не выдал сертификат. Запустите вручную: certbot --nginx -d $DOMAIN"
fi

sleep 1
systemctl is-active --quiet kadr && echo "Кадр работает: https://$DOMAIN" || { echo "!! Служба не запустилась:"; journalctl -u kadr -n 30 --no-pager; exit 1; }
if [ -f "$APP/data/ADMIN_PASSWORD.txt" ]; then echo; cat "$APP/data/ADMIN_PASSWORD.txt"; fi
