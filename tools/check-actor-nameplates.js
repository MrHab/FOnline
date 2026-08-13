'use strict';
// Подписи над моделями и шанс попадания по наведению.
//
// Над именными персонажами и другими игроками должно висеть имя и здоровье:
// точное число HP — только с перком «Осведомлённость», иначе словесное
// состояние. При наведении на НПС или игрока показывается шанс попадания,
// выделенный ярко-красным.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const html = read('public', 'index.html');
const bundle = read('public', 'css', 'game.css');
const css = read('public', 'css', 'game', '21_actor_nameplates.css');
const loop = read('public', 'js', 'game', '09_update_fog_movement_ai.js');
const targets = read('public', 'js', 'game', '08d_world_context_targets.js');

// --- Слой подписей ---
assert(html.includes('id="actor-nameplates"'), 'в разметке нет слоя подписей над моделями');
assert(/#actor-nameplates\s*\{[^}]*pointer-events:\s*none/.test(css),
  'слой подписей перехватывает указатель и закроет собой игровое поле');
assert(/\.actor-nameplate\s*\{[^}]*position:\s*absolute/.test(css),
  'плашка без position свалится потоком в угол экрана');
for (const cls of ['.actor-nameplate', '.plate-name', '.plate-health', '.plate-player', '.plate-critical']) {
  assert(css.includes(cls), `нет стиля ${cls}`);
}

// --- Стиль подписей должен обходить кэш браузера ---
// Скрипты подключаются с версией, а безверсионный css остаётся у игрока
// старым: код рисует плашки, стиля для них нет, и они уезжают в угол.
const importLine = /@import url\("\/css\/game\/21_actor_nameplates\.css(\?[^"]*)?"\);/.exec(bundle);
assert(importLine, 'стиль подписей не подключён в game.css');
assert(importLine[1] && /[?&]v=[^&]+/.test(importLine[1]),
  'стиль подписей подключён без версии в адресе — игрок получит его из кэша старым');

// --- Шанс попадания ярко-красный ---
const chanceRule = /#target-hint \.hit-chance[^{]*\{([^}]*)\}/.exec(css);
assert(chanceRule, 'нет стиля шанса попадания');
const colour = /color:\s*(#[0-9a-f]{6})/i.exec(chanceRule[1]);
assert(colour, 'у шанса попадания не задан цвет');
const [r, g, b] = [1, 3, 5].map(offset => parseInt(colour[1].slice(offset, offset + 2), 16));
assert(r > 200 && g < 90 && b < 90,
  `шанс попадания перестал быть ярко-красным: ${colour[1]}`);
assert(targets.includes("const cls = 'hit-chance'"),
  'подсказка снова красит шанс попадания по величине, а не ярко-красным');

// --- Подписи строятся, а не заглушены ---
assert(!/function updateHpBars\(\) \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*\}/.test(loop),
  'подписи над моделями снова заглушены');
assert(loop.includes('function collectNameplateActors('), 'нет сбора актёров для подписей');
assert(loop.includes('multiplayer?.remotePlayers') || loop.includes('multiplayer.remotePlayers'),
  'другие игроки не получают подписей');

// --- Подписи только у важных НПС ---
// Охрана и рабочие стоянки ходят толпами. Отбор идёт строго по роли: торговые
// поля для этого не годятся, потому что у охраны тоже есть traderId,
// traderProfile и dialogueProfile — у неё можно покупать патроны.
const npcFilter = /function isNameplateNpc\([\s\S]*?\n  \}/.exec(loop);
assert(npcFilter, 'нет отбора важных НПС для подписей');
assert(npcFilter[0].includes('NAMEPLATE_ROLES.has('), 'отбор по роли пропал');
for (const tradeField of ['traderId', 'traderProfile', 'tradeProfile', 'dialogueProfile', 'traderQuests']) {
  assert(!npcFilter[0].includes(`enemy.${tradeField}`),
    `отбор снова смотрит на ${tradeField}: это поле есть и у охраны, подписи получит вся толпа`);
}
const roleSet = /const NAMEPLATE_ROLES = new Set\(\[([^\]]*)\]\)/.exec(loop);
assert(roleSet, 'нет списка ролей для подписей');
assert(roleSet[1].includes("'merchant'"), 'торговцы должны быть подписаны');
for (const crowd of ['guard', 'worker', 'civilian', 'scavenger', 'hauler', 'medic', 'craftsman']) {
  assert(!roleSet[1].includes(`'${crowd}'`),
    `роль ${crowd} — это массовка, её подписывать нельзя`);
}
const collect = /function collectNameplateActors\([\s\S]*?\n  \}/.exec(loop);
assert(collect && /!isNameplateNpc\(enemy\)/.test(collect[0]),
  'отбор важных НПС не подключён к сбору подписей');

// --- Свой персонаж тоже подписан ---
assert(/kind: 'plate-player',\s*\n\s*self: true/.test(collect[0]),
  'над своим персонажем нет подписи');
assert(collect[0].includes("characterProfile?.name || player.name"),
  'своя подпись берёт имя не из профиля персонажа');
const healthSelf = /function nameplateHealthText\([\s\S]*?\n  \}/.exec(loop);
assert(healthSelf && /actor\?\.self === true/.test(healthSelf[0]),
  'своё точное здоровье не должно требовать перка «Осведомлённость»');

// --- Раскладка не должна зависеть только от таблицы стилей ---
const acquire = /function acquireNameplate\([\s\S]*?\n  \}/.exec(loop);
assert(acquire, 'нет создания плашки');
assert(/node\.style\.position = 'absolute'/.test(acquire[0]),
  'плашка полагается только на css: со старым кэшем она уедет в левый верхний угол');
const layerFn = /function nameplateLayerElement\([\s\S]*?\n  \}/.exec(loop);
assert(layerFn && /style\.position = 'fixed'/.test(layerFn[0]) && /style\.pointerEvents = 'none'/.test(layerFn[0]),
  'слой подписей полагается только на css и без него перекроет игровое поле');

// --- Точное HP только по перку ---
const healthFn = /function nameplateHealthText\([\s\S]*?\n  \}/.exec(loop);
assert(healthFn, 'нет расчёта строки здоровья для подписи');
assert(healthFn[0].includes("talentLevel('awareness')"),
  'подпись показывает здоровье без учёта перка «Осведомлённость»');
assert(healthFn[0].includes('enemyHealthStateText'),
  'без перка подпись должна показывать словесное состояние здоровья');
const awareIndex = healthFn[0].indexOf("talentLevel('awareness')");
const exactIndex = healthFn[0].indexOf('${hp}/${maxHp}');
const stateIndex = healthFn[0].indexOf('enemyHealthStateText');
assert(exactIndex > awareIndex && stateIndex > exactIndex,
  'точное HP должно выдаваться под перком, а состояние — как запасной вариант');

// --- Наведение видит других игроков ---
assert(targets.includes('function findRemotePlayerFromPointer('),
  'курсор снова не видит других игроков');
assert(targets.includes('function remotePlayerHintTarget('),
  'нет приведения игрока к виду цели для подсказки');
assert(/const remotePlayer = findRemotePlayerFromPointer\(\);\s*\n\s*if \(remotePlayer\) return remotePlayer;/.test(targets),
  'поиск игрока не подключён к выбору цели курсором');
const hintTarget = /function remotePlayerHintTarget\([\s\S]*?\n  \}/.exec(targets);
assert(hintTarget, 'не найдено приведение игрока к цели');
for (const field of ['name', 'hp', 'maxHp', 'x', 'z', 'hostileToPlayer']) {
  assert(hintTarget[0].includes(`${field}:`), `у цели-игрока нет поля ${field}, подсказка его ждёт`);
}

// --- Подсказка стоит у цели, а не в углу экрана ---
// Осмотр запускают наведением, клавишей и пунктом меню. В половине этих путей
// координат курсора нет вовсе, поэтому позиция считается от самой цели.
const hintFn = /function showTargetHint\([\s\S]*?\n  \}/.exec(targets);
assert(hintFn, 'нет вывода подсказки');
assert(hintFn[0].includes('targetHintScreenAnchor(enemy, clientX, clientY)'),
  'подсказка снова позиционируется мимо привязки к цели');
const anchorFn = /function targetHintScreenAnchor\([\s\S]*?\n  \}\n/.exec(targets);
assert(anchorFn, 'нет привязки подсказки к цели');
assert(anchorFn[0].includes('.project(camera)'),
  'нет проекции цели на экран для подсказки');
const projectIndex = anchorFn[0].indexOf('.project(camera)');
const pointerIndex = anchorFn[0].indexOf('Number.isFinite(clientX)');
assert(pointerIndex > projectIndex,
  'позиция цели должна идти первой, курсор — только запасной вариант');
// Number(null) — это ноль, а не NaN: проверка через Number() пропускает
// отсутствующий курсор, и подсказка возвращается в левый верхний угол.
assert(!/Number\.isFinite\(Number\(client[XY]\)\)/.test(anchorFn[0]),
  'проверка курсора через Number() принимает null за ноль и вернёт подсказку в угол');
assert(/window\.innerWidth \* 0\.5/.test(anchorFn[0]),
  'у подсказки нет запасной точки, если нет ни цели на экране, ни курсора');

console.log('Actor nameplates OK: подписи только у важных ролей, своя подпись, подсказка привязана к цели, шанс попадания ярко-красный.');
