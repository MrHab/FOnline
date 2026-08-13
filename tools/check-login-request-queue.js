'use strict';
// Экран входа не должен тянуть игровые ресурсы.
//
// Сервер отдаёт статику по HTTP/1.1, а браузер держит к одному хосту около
// шести соединений. Пока страница качает тяжёлые ресурсы, запрос входа встаёт
// к ним в очередь: сам вход на сервере занимает меньше сотни миллисекунд, но
// игроку это выглядит как зависание на несколько секунд. До входа не должно
// грузиться ничего, что нужно только в игре.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const boot = read('public', 'js', 'game', '13_minimap_hud_loop.js');
const creation = read('public', 'js', 'game', '08_character_creation_save.js');
const hudCss = read('public', 'css', 'game', '17_player_frame_hud.css');

// --- Создание персонажа не рендерится на старте ---
// renderCharacterCreator заводит превью и тянет тело персонажа на несколько
// мегабайт. На экране входа это превью не видно.
assert(!/\n  renderCharacterCreator\(\);/.test(boot),
  'создание персонажа снова рендерится на старте и тянет модель тела до входа');
assert(read('public', 'js', 'game', '01_bootstrap_online_save.js').includes('renderCharacterCreator();'),
  'создание персонажа больше не рендерится при открытии своего экрана');

// --- Тяжёлый фон панели игрока ждёт запуска игры ---
const panelAsset = 'player-name-panel-transparent.png';
const panelBytes = fs.statSync(path.join(ROOT, 'public', 'assets', 'ui', 'hud', panelAsset)).size;
assert(panelBytes > 200 * 1024,
  'картинка панели похудела — правило ниже можно упростить, проверьте вручную');
const gatedRules = hudCss
  .split('}')
  .filter(block => block.includes(panelAsset));
assert(gatedRules.length > 0, 'фон панели игрока пропал совсем');
for (const block of gatedRules) {
  assert(/body\.game-running/.test(block),
    'фон панели игрока грузится до входа и занимает соединение, за которым ждёт запрос входа');
}
assert(creation.includes("document.body.classList.add('game-running')"),
  'класс game-running не выставляется, и фон панели не появится в игре');

console.log(`Login request queue OK: до входа не грузятся ни модель тела, ни панель HUD (${Math.round(panelBytes / 1024)} КБ), запрос входа не стоит за ними в очереди.`);
