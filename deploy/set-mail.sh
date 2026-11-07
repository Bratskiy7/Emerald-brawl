#!/usr/bin/env bash
# Подключение почты для писем Кадра (коды подтверждения и сброса пароля). Запускать на сервере от root:
#   bash /root/Emerald-brawl-kadr/deploy/set-mail.sh
# Данные хранятся в /opt/kadr/data/mail.json (доступ только root). Нужен «пароль приложения», а не обычный пароль ящика.
set -euo pipefail
FILE=/opt/kadr/data/mail.json

echo "Почтовый сервис:"
echo "  1) Яндекс (smtp.yandex.ru)"
echo "  2) Mail.ru (smtp.mail.ru)"
echo "  3) Gmail (smtp.gmail.com)"
echo "  4) Другой"
read -rp "Номер [1]: " N
case "${N:-1}" in
  1) HOST=smtp.yandex.ru ;;
  2) HOST=smtp.mail.ru ;;
  3) HOST=smtp.gmail.com ;;
  *) read -rp "SMTP-сервер (например smtp.example.ru): " HOST ;;
esac
read -rp "Адрес ящика, с которого пойдут письма: " USER_EMAIL
echo "Пароль приложения для этого ящика (символы не будут видны):"
read -rs PASS; echo
PASS="$(echo -n "$PASS" | tr -d '[:space:]')"
[ -n "$USER_EMAIL" ] && [ -n "$PASS" ] || { echo "Пустой адрес или пароль, ничего не изменено."; exit 1; }

echo "Отправляю тестовое письмо на $USER_EMAIL…"
TMP="$(mktemp)"
printf 'From: Kadr <%s>\r\nTo: <%s>\r\nSubject: Kadr: test\r\n\r\nPochta dlya Kadra podklyuchena.\r\n' "$USER_EMAIL" "$USER_EMAIL" > "$TMP"
if ! curl -s --max-time 30 --ssl-reqd --url "smtps://$HOST:465" --user "$USER_EMAIL:$PASS" \
     --mail-from "$USER_EMAIL" --mail-rcpt "$USER_EMAIL" --upload-file "$TMP"; then
  rm -f "$TMP"
  echo "!! Не получилось отправить письмо. Проверьте адрес и пароль приложения."
  echo "   Для Яндекса: id.yandex.ru → Безопасность → Пароли приложений → «Почта»."
  echo "   Также в настройках почты Яндекса включите доступ по протоколу IMAP/SMTP («Почтовые программы»)."
  exit 1
fi
rm -f "$TMP"

umask 077
python3 - "$FILE" "$HOST" "$USER_EMAIL" "$PASS" <<'PY'
import json, sys
f, host, user, pw = sys.argv[1:5]
json.dump({"host": host, "port": 465, "user": user, "pass": pw, "from": user}, open(f, "w"))
PY
chmod 600 "$FILE"
systemctl restart kadr
echo "Готово: Кадр будет отправлять письма с $USER_EMAIL. Тестовое письмо уже в ящике (проверьте «Спам»)."
