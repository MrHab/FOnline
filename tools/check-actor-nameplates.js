'use strict';
// Подписи над моделями и шанс попадания по наведению.
//
// Над каждым живым актёром висит здоровье, имя — только у важных персонажей
// и игроков. Точное число HP видно с перком «Осведомлённость», иначе словесное
// состояние. У прицела показывается имя цели и ярко-красный шанс попадания.
// Ни у плашек, ни у подсказки нет подложки.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

// Сколько сплошных чёрных теней в правиле: ими и держится читаемость без
// подложки. Полупрозрачные и размытые в счёт не идут.
function countBlackRing(rule = '') {
  return (rule.match(/-?\d+(?:px)?\s+-?\d+(?:px)?\s+0(?:px)?\s+#000/g) || []).length;
}

const html = read('public', 'index.html');
const bundle = read('public', 'css', 'game.css');
const css = read('public', 'css', 'game', '21_actor_nameplates.css');
// Вид подсказки прицела живёт в том же версионном файле. Старый безверсионный
// остаётся у игрока в кэше, и описания панели в нём быть не должно.
const legacyCss = read('public', 'css', 'game', '04_mobile_inventory_trade_quality.css');
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

// --- Плашка без подложки ---
// Здоровье висит над каждым живым актёром: полтора десятка тёмных
// прямоугольников закрывают поле боя сильнее, чем помогают. Читаемость держит
// обводка текста.
const plateRule = /\.actor-nameplate\s*\{([^}]*)\}/.exec(css);
assert(plateRule, 'нет правила плашки');
for (const prop of ['background', 'border', 'border-radius', 'padding']) {
  assert(!new RegExp(`(^|;|\\s)${prop}\\s*:`).test(plateRule[1]),
    `у плашки снова есть ${prop}: за именами и здоровьем вернулась подложка`);
}
// Читаемость держится на чёрном ореоле из теней. Обводки быть не должно:
// -webkit-text-stroke идёт по центру контура глифа и половиной уходит внутрь
// буквы. На таком кегле от тела буквы оставался процент исходного цвета, и
// надписи выглядели тонкими, тусклыми и мыльными.
assert(!/-webkit-text-stroke/.test(plateRule[1]),
  'обводка съедает тело буквы: имена и здоровье снова станут тусклыми и мыльными');
assert(countBlackRing(plateRule[1]) >= 8,
  'ореол имён и здоровья реже восьми направлений — на светлом песке буквы поплывут');

// --- Плашки не должны дёргаться при движении ---
// Позиция берётся из самой модели и обновляется каждый кадр. Сетевая точка
// врага обновляется реже кадра, а меш идёт по сглаженной: плашка по сетевой
// точке плывёт относительно модели, за которой висит.
assert(!loop.includes('NAMEPLATE_UPDATE_MS'),
  'подписи снова обновляются реже кадра и будут отставать от камеры при движении');
const collectMotion = /function collectNameplateActors\([\s\S]*?\n  \}/.exec(loop);
assert(collectMotion && collectMotion[0].includes('enemy.mesh.position'),
  'подпись врага считается от сетевой точки, а не от нарисованной модели');
assert(collectMotion[0].includes('row.group.position'),
  'подпись другого игрока считается от сетевой точки, а не от нарисованной модели');
const update = /function updateHpBars\([\s\S]*?\n  \}/.exec(loop);
assert(update, 'нет обновления подписей');
assert(!/Math\.round\(left\)|Math\.round\(top\)/.test(update[0]),
  'позиция подписи округляется до пикселя — при медленном движении текст идёт ступеньками');
assert(/translate3d\(/.test(update[0]),
  'подпись двигается через left/top: это пересчёт раскладки на каждый кадр');

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
assert(targets.includes('<span class="hit-chance">') && !/hitChanceClass\(/.test(targets),
  'подсказка снова красит шанс попадания по величине, а не ярко-красным');

// --- Подписи строятся, а не заглушены ---
assert(!/function updateHpBars\(\) \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*\}/.test(loop),
  'подписи над моделями снова заглушены');
assert(loop.includes('function collectNameplateActors('), 'нет сбора актёров для подписей');
assert(loop.includes('multiplayer?.remotePlayers') || loop.includes('multiplayer.remotePlayers'),
  'другие игроки не получают подписей');

// --- Имена только у важных НПС, здоровье у всех ---
// Охрана и рабочие стоянки ходят толпами, и имена у них вида «Караванный двор
// Старого Клима: охрана» — стена такого текста закрывает игру. Отбор имён идёт
// строго по роли: торговые поля для этого не годятся, потому что у охраны тоже
// есть traderId, traderProfile и dialogueProfile — у неё можно покупать патроны.
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
assert(collect, 'нет сбора актёров для подписей');
// Здоровье видно у всех живых, включая зверьё и рядовых врагов: отбор важности
// решает только, будет ли над плашкой имя.
assert(!/\|\| !isNameplateNpc\(enemy\)\) continue/.test(collect[0]),
  'важность снова решает, показывать ли здоровье, — у зверья и рядовых врагов плашки пропадут');
assert(/name: isNameplateNpc\(enemy\) \? String\(enemy\.name \|\| ''\) : ''/.test(collect[0]),
  'имя больше не ограничено важными персонажами — над массовкой встанет стена текста');
const plateNode = /function acquireNameplate\([\s\S]*?\n  \}/.exec(loop);
assert(plateNode && plateNode[0].includes('nameBreak'),
  'нет управления переносом строки: без имени плашка повиснет над пустой строкой');
assert(/const nameDisplay = row\.name \? 'inline' : 'none'/.test(loop),
  'пустое имя не скрывается, и плашка со здоровьем поднимется над пустотой');

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

// --- Подсказка стоит у прицела, а не в углу экрана ---
// Прицел — это курсор: шанс попадания читают не отводя глаз от точки, куда
// целятся. Осмотр запускают ещё клавишей и пунктом меню, где курсора нет
// вовсе, — там позиция считается от самой цели.
const hintFn = /function showTargetHint\([\s\S]*?\n  \}/.exec(targets);
assert(hintFn, 'нет вывода подсказки');
assert(hintFn[0].includes('targetHintScreenAnchor(enemy, clientX, clientY)'),
  'подсказка снова позиционируется мимо привязки к прицелу');
const anchorFn = /function targetHintScreenAnchor\([\s\S]*?\n  \}\n/.exec(targets);
assert(anchorFn, 'нет привязки подсказки к прицелу');
assert(anchorFn[0].includes('.project(camera)'),
  'нет проекции цели на экран — при осмотре без курсора подсказке некуда встать');
const projectIndex = anchorFn[0].indexOf('.project(camera)');
const pointerIndex = anchorFn[0].indexOf('Number.isFinite(clientX)');
assert(pointerIndex < projectIndex,
  'подсказка должна вставать у прицела, а позиция цели — только запасной вариант');

// --- Подсказка стоит справа от прицела, шанс — над именем ---
assert(/anchorX \+ 18/.test(hintFn[0]),
  'подсказка больше не отступает вправо от курсора и попадёт под иконку прицела');
assert(/anchorY - height \* 0\.5/.test(hintFn[0]),
  'подсказка не центрируется по прицелу: шанс попадания должен вставать над остриём курсора');

// --- Чёрный ореол у шанса попадания ---
// Одно красное свечение размывало цифры на песке и на крови, а обводка съедала
// их так же, как съедала имена.
const chanceOutline = /#target-hint \.hit-chance,[\s\S]*?\{([^}]*)\}/.exec(css);
assert(chanceOutline, 'нет стиля шанса попадания');
assert(!/-webkit-text-stroke/.test(chanceOutline[1]),
  'обводка съедает цифры шанса попадания так же, как съедала имена');
assert(countBlackRing(chanceOutline[1]) >= 8,
  'ореол шанса попадания реже восьми направлений');

// --- В подсказке только имя и шанс попадания ---
// Всё остальное закрывало то, во что целишься: здоровье и состояние теперь
// видны над самой моделью, отношение читается по цвету плашки.
const hintHtml = /function buildTargetHintHtml\([\s\S]*?\n  \}/.exec(targets);
assert(hintHtml, 'нет сборки подсказки');
assert(/return `<span class="hit-chance">\$\{info\.chance\}%<\/span><br><b>\$\{safe\(enemy\.name\)\}<\/b>`/.test(hintHtml[0]),
  'подсказка прицела должна показывать шанс попадания первой строкой и имя под ним');
for (const [needle, what] of [
  ['Состояние', 'состояние здоровья'],
  ['SPECIAL', 'SPECIAL'],
  ['Фракция', 'фракцию'],
  ['Занят', 'занятие'],
  ['Предп. урон', 'предполагаемый урон'],
  ['info.note', 'заметку о выстреле']
]) {
  assert(!hintHtml[0].includes(needle), `подсказка прицела снова показывает ${what}`);
}
for (const leftover of ['min-width: 160px', 'max-width: 220px', 'padding: 8px 10px', 'background: rgba(8,10,10']) {
  assert(!legacyCss.includes(leftover),
    `в безверсионном файле снова описана панель подсказки (${leftover}) — она всплывёт из кэша`);
}
const hintRule = /#target-hint \{([^}]*)\}/.exec(css);
assert(hintRule, 'нет стиля подсказки прицела');
assert(/background:\s*none/.test(hintRule[1]) && /border:\s*0/.test(hintRule[1]) && /padding:\s*0/.test(hintRule[1]),
  'подложка подсказки не погашена явно и всплывёт из кэша старого файла');
assert(/text-shadow:[^;]*rgba\(0, 0, 0/.test(hintRule[1]),
  'без подложки подсказка держится на обводке, а её нет');
// Number(null) — это ноль, а не NaN: проверка через Number() пропускает
// отсутствующий курсор, и подсказка возвращается в левый верхний угол.
assert(!/Number\.isFinite\(Number\(client[XY]\)\)/.test(anchorFn[0]),
  'проверка курсора через Number() принимает null за ноль и вернёт подсказку в угол');
assert(/window\.innerWidth \* 0\.5/.test(anchorFn[0]),
  'у подсказки нет запасной точки, если нет ни цели на экране, ни курсора');

// --- Посчитанная позиция обязана доходить до элемента ---
// Кэш «где подсказка стоит сейчас» сравнивается с новой позицией, чтобы не
// трогать стиль зря. Если завести его как NaN, Math.abs(x - NaN) даёт NaN,
// любое сравнение с числом ложно, и left/top не запишутся ни разу: подсказка
// навсегда останется в левом верхнем углу, что бы код ни посчитал.
const hintCache = /var targetHintRenderCache = \{[\s\S]*?\n  \};/.exec(targets);
assert(hintCache, 'нет кэша позиции подсказки');
assert(!/left:\s*NaN/.test(hintCache[0]) && !/top:\s*NaN/.test(hintCache[0]),
  'кэш позиции подсказки заведён как NaN — первая запись позиции будет пропущена');
assert(/left:\s*null/.test(hintCache[0]) && /top:\s*null/.test(hintCache[0]),
  'непонятно, чем обозначено «позиция ещё не записана»');
assert(/!Number\.isFinite\(targetHintRenderCache\.left\) \|\| Math\.abs/.test(hintFn[0])
  && /!Number\.isFinite\(targetHintRenderCache\.top\) \|\| Math\.abs/.test(hintFn[0]),
  'подсказка не записывает позицию, пока она не подтверждена числом');

console.log('Actor nameplates OK: имена у важных, здоровье у всех, плашки без подложки и вровень с кадром, подсказка прицела — имя и ярко-красный шанс попадания.');
