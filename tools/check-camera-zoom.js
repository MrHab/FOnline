'use strict';
// Приближение камеры колесом мыши.
//
// Камера ортографическая, поэтому приближение задаётся высотой кадра, а не
// расстоянием до модели. Проверяем сами границы, шаг, сохранение выбора и то,
// что отдалить дальше базовой высоты нельзя — иначе по краям экрана появится
// туман войны.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'public', 'js', 'game', '02_renderer_world_map.js'), 'utf8');

function matchingBrace(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}' && --depth === 0) return index;
  }
  return -1;
}

function functionSource(name) {
  const match = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(source);
  assert(match, `не найдена функция ${name}`);
  const open = source.indexOf('{', match.index);
  const close = matchingBrace(source, open);
  assert(open >= 0 && close > open, `не удалось вырезать ${name}`);
  return source.slice(match.index, close + 1);
}

const constants = {};
for (const name of ['CAMERA_ZOOM_MIN_SCALE', 'CAMERA_ZOOM_MAX_SCALE', 'CAMERA_ZOOM_STEP']) {
  const match = new RegExp(`const ${name} = ([^;]+);`).exec(source);
  assert(match, `не найдена константа ${name}`);
  constants[name] = eval(match[1]);
}

assert.strictEqual(constants.CAMERA_ZOOM_MAX_SCALE, 1,
  'камера снова может отдаляться дальше базовой высоты — по краям экрана появится туман');
assert(constants.CAMERA_ZOOM_MIN_SCALE > 0.4 && constants.CAMERA_ZOOM_MIN_SCALE < 0.55,
  `предел приближения ${constants.CAMERA_ZOOM_MIN_SCALE} вышел за разумные рамки`);
assert(constants.CAMERA_ZOOM_STEP > 1 && constants.CAMERA_ZOOM_STEP < 1.5,
  'шаг колеса должен быть плавным множителем');

// --- Поведение ограничителя и шага ---
const sandbox = {
  CAMERA_ZOOM_MIN_SCALE: constants.CAMERA_ZOOM_MIN_SCALE,
  CAMERA_ZOOM_MAX_SCALE: constants.CAMERA_ZOOM_MAX_SCALE
};
const clamp = new Function(
  'CAMERA_ZOOM_MIN_SCALE', 'CAMERA_ZOOM_MAX_SCALE',
  `${functionSource('clampCameraZoomScale')}\nreturn clampCameraZoomScale;`
)(sandbox.CAMERA_ZOOM_MIN_SCALE, sandbox.CAMERA_ZOOM_MAX_SCALE);

assert.strictEqual(clamp(5), 1, 'приближение не ограничено сверху');
assert.strictEqual(clamp(0.01), constants.CAMERA_ZOOM_MIN_SCALE, 'приближение не ограничено снизу');
assert.strictEqual(clamp('не число'), 1, 'мусорное значение не сбрасывается к базовому');
assert.strictEqual(clamp(0.7), 0.7, 'допустимое значение изменено');

// Колесо доходит до предела за разумное число щелчков и не проскакивает его.
let scale = 1;
let notches = 0;
while (scale > constants.CAMERA_ZOOM_MIN_SCALE + 1e-6 && notches < 100) {
  scale = clamp(scale / constants.CAMERA_ZOOM_STEP);
  notches += 1;
}
assert.strictEqual(scale, constants.CAMERA_ZOOM_MIN_SCALE, 'колесо не доводит до предела приближения');
assert(notches >= 3 && notches <= 15, `предел достигается за ${notches} щелчков — неудобно`);

// --- Высота кадра на пределах ---
const desktopBase = 15;
const closest = desktopBase * constants.CAMERA_ZOOM_MIN_SCALE;
const elevation = Math.atan2(29, Math.hypot(20, 20));
const figureAt = (viewHeight) => 1.8 * Math.cos(elevation) / viewHeight;
assert(Math.abs(closest - 7) < 0.2, `ближний предел даёт высоту кадра ${closest.toFixed(2)}, ожидалось около 7`);
assert(figureAt(closest) > 0.16 && figureAt(closest) < 0.2,
  'на ближнем пределе фигура должна занимать около 18% высоты экрана');
assert(Math.abs(figureAt(desktopBase) - 0.084) < 0.005,
  'базовая высота кадра перестала соответствовать эталону');

// --- Проводка ---
assert(source.includes("canvas.addEventListener('wheel', handleCameraZoomWheel, { passive: false })"),
  'колесо не подписано на канвас или не может отменить прокрутку страницы');
assert(/function resize\(\)[\s\S]*?applyCameraViewport\(\)/.test(source),
  'изменение размера окна больше не пересчитывает кадр камеры');
assert(source.includes("localStorage.setItem(CAMERA_ZOOM_STORAGE_KEY"),
  'выбранное приближение не сохраняется между сессиями');
assert(/if \(event\.target && event\.target !== canvas\) return;/.test(source),
  'колесо над панелями интерфейса снова крутит камеру вместо прокрутки');

console.log(
  `Camera zoom OK: высота кадра ${closest.toFixed(1)}–${desktopBase} `
  + `(фигура ${(figureAt(closest) * 100).toFixed(0)}%–${(figureAt(desktopBase) * 100).toFixed(1)}% экрана), `
  + `${notches} щелчков до предела, выбор сохраняется.`
);
