'use strict';

// Миграция сохранений на мир зон. Глобальной карты больше нет: персонаж,
// сохранённый «на карте» или в сцене мелкой клетки карты (`#cell_`), встаёт в
// зону своей точки карты. Из красной и чёрной зоны — в ближайшую синюю или
// мирную: переключение мира не должно убивать и грабить. Персонаж в месте
// (поселение, логово, база) остаётся там — его край и так выводит в зону.
// Та же функция работает при входе (восстановленные бэкапы) и в инструменте
// tools/migrate-saves-to-zones.js. Модуль чистый.

const { zoneAtPoint } = require('./zone-graph');

const SAFE_MODES = Object.freeze(['peaceful', 'pve']);
const HARSH_MODES = Object.freeze(['pvpFullDrop', 'pvpBlack']);

function finitePoint(value) {
  const x = Number(value?.x ?? value?.playerX);
  const y = Number(value?.y ?? value?.playerY);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Зона точки карты; из красной и чёрной — ближайшая синяя или мирная. */
function zoneForMigration(graph, point) {
  const zone = zoneAtPoint(graph, point.x, point.y);
  if (!zone || !HARSH_MODES.includes(zone.mode)) return zone;
  let best = null;
  let bestD = Infinity;
  for (const other of graph.zones) {
    if (!SAFE_MODES.includes(other.mode)) continue;
    const d = Math.hypot(other.col - zone.col, other.row - zone.row);
    if (d < bestD) { bestD = d; best = other; }
  }
  return best || zone;
}

/**
 * Перевести сохранённое состояние персонажа на мир зон. Возвращает
 * {changed, zoneId, reason}; состояние меняется на месте.
 */
function migrateSaveStateToZones(state, graph) {
  const result = { changed: false, zoneId: '', reason: '' };
  if (!state || typeof state !== 'object' || !graph?.zones) return result;
  const context = state.serverLocationContext && typeof state.serverLocationContext === 'object' ? state.serverLocationContext : null;
  const onMap = state.globalMap?.onWorldMap === true;
  const inCell = !onMap && String(context?.roomId || '').includes('#cell_');
  const point = onMap ? finitePoint(state.globalMap) : inCell ? finitePoint(context.worldPoint) : null;
  if (point) {
    const zone = zoneForMigration(graph, point);
    if (zone) {
      state.currentLocationId = zone.id;
      // Центр зоны: сервер при входе найдёт свободное место рядом.
      state.player = { ...(state.player || {}), x: 0, z: 0 };
      delete state.serverLocationContext;
      Object.assign(result, { changed: true, zoneId: zone.id, reason: onMap ? 'globalMap' : 'dangerCell' });
    }
  }
  // Следы путешествия по карте больше ничего не значат.
  for (const key of ['globalMap', 'pendingWorldDrop', 'attachedPartyId']) {
    if (key in state) {
      delete state[key];
      result.changed = true;
    }
  }
  return result;
}

module.exports = { migrateSaveStateToZones, zoneForMigration };
