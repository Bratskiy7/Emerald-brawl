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
echo "  4) Unisender Go (smtp.go1.unisender.ru)"
echo "  5) SendPulse (smtp-pulse.com)"
echo "  6) Brevo (smtp-relay.brevo.com)"
echo "  7) Другой"
read -rp "Номер [1]: " N
case "${N:-1}" in
  1) HOST=smtp.yandex.ru ;;
  2) HOST=smtp.mail.ru ;;
  3) HOST=smtp.gmail.com ;;
  4) HOST=smtp.go1.unisender.ru ;;
  5) HOST=smtp-pulse.com ;;
  6) HOST=smtp-relay.brevo.com ;;
  *) read -rp "SMTP-сервер (например smtp.example.ru): " HOST ;;
esac
read -rp "Адрес отправителя (например noreply@getkadr.space): " FROM_EMAIL
read -rp "Логин SMTP [${FROM_EMAIL}]: " USER_EMAIL
USER_EMAIL="${USER_EMAIL:-$FROM_EMAIL}"
read -rp "Куда отправить тестовое письмо [${FROM_EMAIL}]: " TEST_TO
TEST_TO="${TEST_TO:-$FROM_EMAIL}"
echo "Пароль SMTP / пароль приложения (символы не будут видны):"
read -rs PASS; echo
PASS="$(echo -n "$PASS" | tr -d '[:space:]')"
[ -n "$FROM_EMAIL" ] && [ -n "$USER_EMAIL" ] && [ -n "$PASS" ] || { echo "Пустой адрес или пароль, ничего не изменено."; exit 1; }

echo "Отправляю тестовое письмо на $TEST_TO…"
TMP="$(mktemp)"
printf 'From: Kadr <%s>\r\nTo: <%s>\r\nSubject: Kadr: test\r\n\r\nPochta dlya Kadra podklyuchena.\r\n' "$FROM_EMAIL" "$TEST_TO" > "$TMP"
if ! curl -s --max-time 30 --ssl-reqd --url "smtps://$HOST:465" --user "$USER_EMAIL:$PASS" \
     --mail-from "$FROM_EMAIL" --mail-rcpt "$TEST_TO" --upload-file "$TMP"; then
  rm -f "$TMP"
  echo "!! Не получилось отправить письмо. Проверьте логин, пароль и что домен отправителя подтверждён в сервисе."
  echo "   Для Яндекса: id.yandex.ru → Безопасность → Пароли приложений → «Почта»."
  echo "   Также в настройках почты Яндекса включите доступ по протоколу IMAP/SMTP («Почтовые программы»)."
  exit 1
fi
rm -f "$TMP"

umask 077
python3 - "$FILE" "$HOST" "$USER_EMAIL" "$PASS" "$FROM_EMAIL" <<'PY'
import json, sys
f, host, user, pw, frm = sys.argv[1:6]
json.dump({"host": host, "port": 465, "user": user, "pass": pw, "from": frm}, open(f, "w"))
PY
chmod 600 "$FILE"
systemctl restart kadr
echo "Готово: Кадр будет отправлять письма с $FROM_EMAIL. Тестовое письмо отправлено на $TEST_TO (проверьте «Спам»)."
