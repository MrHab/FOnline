# Работа с Realm of Ashes через Codex

- Репозиторий проекта: <https://github.com/MrHab/FOnline>
- Основная ветка: `main`
- Публичная игра: <https://rangir.ru>

## Codex Cloud: работа с любого компьютера

Codex Cloud удобнее всего для перехода между компьютерами: исходники, ветки и
результаты работы хранятся в GitHub, а выполнение происходит в отдельной
облачной среде.

Один раз в настройках Codex:

1. Подключите GitHub-аккаунт `MrHab`.
2. Создайте облачную среду для репозитория `MrHab/FOnline`.
3. Выберите Node.js 22.
4. Укажите setup-команду `npm ci`.
5. Для обновления кешированной среды используйте maintenance-команду `npm ci`.

После этого на любом компьютере достаточно войти в тот же аккаунт, открыть
Codex, выбрать `MrHab/FOnline`, нужную ветку и режим **Cloud**. Корневой
`AGENTS.md` автоматически сообщает Codex структуру проекта и обязательные
проверки.

Не добавляйте в облачную среду production-пароли или содержимое
`/var/lib/realm-of-ashes`. Для обычной разработки проекту секреты не нужны.

## Локальная работа на новом компьютере

Установите Git и Node.js 22, затем выполните:

```bash
git clone https://github.com/MrHab/FOnline.git
cd FOnline
npm ci
npm run check
npm start
```

Откройте клонированную папку `FOnline` как проект Codex. Локальный сервер будет
доступен по адресу <http://127.0.0.1:3000>.

Перед началом новой задачи:

```bash
git switch main
git pull --ff-only origin main
git switch -c agent/short-description
```

После проверки изменений:

```bash
npm run check
git status
git add <нужные-файлы>
git commit -m "Краткое описание"
git push -u origin HEAD
```

После этого создайте pull request в `main`. Не работайте с одной незапушенной
веткой попеременно на нескольких компьютерах: сначала отправьте изменения в
GitHub, затем получите их на другом устройстве.

## Что не должно попадать в GitHub

- `.env` и любые секреты;
- `data/users.json`, `data/saves.json`, `data/wasteland-sim.json`;
- журналы `*.log`;
- `node_modules/`;
- локальные резервные копии;
- production-данные из `/var/lib/realm-of-ashes`.

Эти пути уже исключены правилами `.gitignore`.

## Ручное обновление production-сервера

Обновляйте VPS только после того, как нужные изменения прошли проверки и
попали в `main`.

Подключитесь:

```powershell
ssh root@104.171.132.170
```

На VPS проверьте отсутствие локальных изменений и обновите код:

```bash
runuser -u realm -- git -C /opt/realm-of-ashes status --short
runuser -u realm -- git -C /opt/realm-of-ashes pull --ff-only origin main
runuser -u realm -- env HOME=/var/lib/realm-of-ashes \
  npm --prefix /opt/realm-of-ashes ci --omit=dev
runuser -u realm -- env HOME=/var/lib/realm-of-ashes \
  npm --prefix /opt/realm-of-ashes run check:server
systemctl restart realm-of-ashes
systemctl is-active realm-of-ashes
curl -fsS https://rangir.ru/health
```

Первая команда не должна выводить изменённые файлы. Если вывод есть, остановите
обновление и сначала разберитесь с локальными изменениями на VPS.

Аккаунты, персонажи и симуляция хранятся отдельно:

```text
/var/lib/realm-of-ashes/data
```

Обычный `git pull` их не затрагивает.
