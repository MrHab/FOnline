# Realm of Ashes

Текущая версия проекта: **7.76.6-approved-humanoid-assets**.

Публичная версия: [rangir.ru](https://rangir.ru).

Игра — это авторитетный Node.js-сервер (`server.js`, `src/server/`) и
**Unity-клиент** (`unity-client/`, Unity 6000.5.8f1, URP). Для игроков игра
поставляется как Unity WebGL с корня сайта; Windows-сборка собирается
`unity-client/Tools/build-windows.ps1`. Unity — единственный клиент: прежний
браузерный Three.js-клиент удалён из репозитория.

Для работы с проектом через Codex на локальном компьютере или в облачной среде
используйте [инструкцию Codex](docs/CODEX_WORKFLOW.md). Постоянные правила для
агента находятся в [`AGENTS.md`](AGENTS.md).

Актуальное техническое описание проекта находится в `docs/wiki/`. Вики описывает текущее состояние систем, а не историю патчей.

Основные страницы для ориентира:

- `docs/wiki/PROJECT_OVERVIEW.md` — общая структура проекта;
- `docs/wiki/CLIENT_FILES.md` — структура Unity-клиента;
- `docs/wiki/CAMERA_AND_VISION.md` — камера, fog-of-war и line-of-sight;
- `docs/wiki/GRAPHICS_SETTINGS.md` — пресеты качества URP и WebGL-поставка;
- `docs/wiki/SERVER_FILES.md` — структура серверного кода;
- `unity-client/README.md` — запуск, сборка и редакторские пробы клиента.

История релизов — в [`docs/wiki/CHANGELOG.md`](docs/wiki/CHANGELOG.md).
