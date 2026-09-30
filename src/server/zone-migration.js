'use strict';

// Миграция сохранений на мир зон. Глобальной карты больше нет: персонаж,
// сохранённый «на карте» или в сцене мелкой клетки карты (`#cell_`), встаёт в
// зону своей точки карты. Из красной и чёрной зоны — в ближайшую синюю или
// мирную: переключение мира не должно убивать и грабить. Персонаж в месте
// (поселение, логово, база) остаётся там — его край и так выводит в зону.
// Та же функция работает при входе (восстановленные бэкапы) и в инструменте
// tools/migrate-saves-to-zones.js. Модуль чистый.

const { zoneAtPoint, zoneLocationId, zoneOfPlace } = require('./zone-graph');

// Ревизия мест: растёт, когда город перестаёт быть городом. Сервер пишет её в
// каждое сохранение, поэтому зашедший в бывший город уже после перемены там и
// останется, а сохранённый в нём раньше проснётся в безопасной зоне.
const PLACES_REVISION = 1;
// Ревизия раскладки зон: с 1 север зон и городов — +Z, как у компаса (прежде
// содержимое зон было зеркалом карты мира, tools/mirror-zones-north-up.js).
// Сохранённый в зоне или городе раньше отражается вместе с ними и просыпается
// на том же месте, а не в чужой стене.
const ZONE_FRAME_REVISION = 1;

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
  return nearestSafeZone(graph, zone);
}

/** Ближайшая к зоне синяя или мирная зона (сама зона, если она такая). */
function nearestSafeZone(graph, zone) {
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
      // Сектор города — сам город: персонаж просыпается в нём, а не в пустой зоне.
      state.currentLocationId = zoneLocationId(zone);
      // Центр сектора: сервер при входе найдёт свободное место рядом.
      state.player = { ...(state.player || {}), x: 0, z: 0 };
      delete state.serverLocationContext;
      Object.assign(result, { changed: true, zoneId: zoneLocationId(zone), reason: onMap ? 'globalMap' : 'dangerCell' });
    }
  }
  // Сектор, который занял переехавший город (библия, 4.4), больше не зона: кто
  // сохранился в нём, просыпается в этом городе, у его центра.
  const saved = String(state.currentLocationId || '');
  const taken = !result.changed && saved ? graph.zones.find(zone => zone.id === saved && zone.city) : null;
  if (taken) {
    state.currentLocationId = taken.city;
    state.player = { ...(state.player || {}), x: 0, z: 0 };
    delete state.serverLocationContext;
    Object.assign(result, { changed: true, zoneId: taken.id, reason: 'sectorBecameCity' });
  }
  // Город, который стал местом («Баланс» — подземелье с правилами красной зоны,
  // библия 4.4), больше не мирен: сохранённый в нём до перемены просыпается в
  // ближайшей к нему синей или мирной зоне, а не в подземелье.
  const before = Number(state.placesRevision) || 0;
  if (!result.changed && before < PLACES_REVISION && (graph.retiredCities || []).includes(saved)) {
    const home = zoneOfPlace(graph, saved);
    const safe = home ? nearestSafeZone(graph, home) : null;
    if (safe) {
      state.currentLocationId = zoneLocationId(safe);
      state.player = { ...(state.player || {}), x: 0, z: 0 };
      delete state.serverLocationContext;
      Object.assign(result, { changed: true, zoneId: zoneLocationId(safe), reason: 'cityRetired' });
    }
  }
  if (before < PLACES_REVISION) {
    state.placesRevision = PLACES_REVISION;
    result.changed = true;
  }
  if ((Number(state.zoneFrameRevision) || 0) < ZONE_FRAME_REVISION) {
    const home = String(state.currentLocationId || '');
    const zone = result.reason ? null : graph.zones.find(row => zoneLocationId(row) === home);
    const z = Number(state.player?.z);
    // Сектор отражён вокруг своей середины, город — вокруг центра плана (z = +1 м).
    if (zone && Number.isFinite(z)) state.player = { ...state.player, z: Math.round(((zone.city ? 2 : 0) - z) * 1000) / 1000 };
    state.zoneFrameRevision = ZONE_FRAME_REVISION;
    result.changed = true;
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

module.exports = { PLACES_REVISION, ZONE_FRAME_REVISION, migrateSaveStateToZones, nearestSafeZone, zoneForMigration };
