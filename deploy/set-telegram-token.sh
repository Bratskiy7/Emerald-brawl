#!/usr/bin/env bash
# Подключение Telegram-бота к Кадру. Запускать на сервере от root:
#   bash /root/Emerald-brawl-kadr/deploy/set-telegram-token.sh
# Токен вводится здесь, на сервере, и хранится в /opt/kadr/data/telegram.json (доступ только root).
set -euo pipefail
FILE=/opt/kadr/data/telegram.json

echo "Вставьте токен бота от @BotFather (символы не будут видны) и нажмите Enter:"
read -rs TOKEN
echo
TOKEN="$(echo -n "$TOKEN" | tr -d '[:space:]')"
[ -n "$TOKEN" ] || { echo "Токен пустой, ничего не изменено."; exit 1; }

RESP="$(curl -s --max-time 15 "https://api.telegram.org/bot${TOKEN}/getMe" || true)"
USERNAME="$(printf '%s' "$RESP" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"
if [ -z "$USERNAME" ]; then
  echo "!! Telegram не принял токен. Проверьте, что скопировали его целиком."
  echo "   Ответ Telegram: $(printf '%s' "$RESP" | head -c 200)"
  exit 1
fi

# webhook would block getUpdates — make sure it is off
curl -s --max-time 15 "https://api.telegram.org/bot${TOKEN}/deleteWebhook" >/dev/null || true

umask 077
printf '{"token":"%s","username":"%s"}\n' "$TOKEN" "$USERNAME" > "$FILE"
chmod 600 "$FILE"
systemctl restart kadr
echo "Готово: бот @$USERNAME подключён к Кадру."
echo "Теперь в Кадре: Профиль → шестерёнка → «Подключить Telegram»."
