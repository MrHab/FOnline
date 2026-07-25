# Быстрая загрузка rangir.ru

Клиент загружает части игрового кода параллельно, а production-сервер отдаёт
версионированные ресурсы с долгим кешированием. Для полного эффекта Nginx должен
раздавать каталог `public` напрямую, не отправляя каждый файл в Node.js.

## Настройка Nginx на VPS

После обновления репозитория скопируйте готовый набор `location` в каталог Nginx:

```bash
install -m 644 \
  /opt/realm-of-ashes/deploy/nginx/realm-of-ashes.locations.conf \
  /etc/nginx/snippets/realm-of-ashes.locations.conf
```

Внутри существующего HTTPS-блока `server` для `rangir.ru` удалите старый общий
`location /` с `proxy_pass` и подключите:

```nginx
include /etc/nginx/snippets/realm-of-ashes.locations.conf;
```

Проверьте и примените конфигурацию:

```bash
nginx -t
systemctl reload nginx
curl -fsSI https://rangir.ru/js/game/01_bootstrap_online_save.js?v=7.76.1-combat-integrity
curl -fsS https://rangir.ru/health
```

У первого ответа должны появиться долгий `max-age` и `immutable`, а `/health`
должен вернуть JSON с `"ok":true`.

## Нагрузка фоновой симуляции

По умолчанию глобальная симуляция обновляется раз в 5 секунд и сохраняется не
чаще раза в 15 секунд. При необходимости интервалы можно изменить в
`/etc/realm-of-ashes.env`:

```text
WASTELAND_SIM_TICK_MS=5000
WASTELAND_SIM_SAVE_INTERVAL_MS=15000
```

После изменения выполните:

```bash
systemctl restart realm-of-ashes
journalctl -u realm-of-ashes -n 50 --no-pager
```
