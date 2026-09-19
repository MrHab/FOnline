'use strict';

// Порталы зоны мира. Точки мира симуляции — публичное событие, бой отрядов,
// угодья обитателей — живут на карте координатами, а игрок ходит по зонам.
// Точка, лежащая в зоне, становится в ней порталом у якоря событий: шаг в
// него — вход в комнату точки по серверному билету. Угодья шире одной зоны, их
// следы стоят в каждой зоне, чей центр внутри контура. Модуль чистый: строки
// симуляции, зона, её якоря и проверка локаций приходят снаружи.

const PORTAL_RADIUS = 3.2;

function cleanId(value = '', limit = 64) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, limit);
}

function stableHash(text = '') {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/** Точка открыта игрокам: активна, не скрыта и не засада на самого игрока. */
function worldZoneOpen(zone = null) {
  return !!zone
    && String(zone.status || '') === 'active'
    && zone.details?.hidden !== true
    && zone.details?.visible !== false
    && zone.details?.playerAmbush !== true;
}

function portalKind(zone = {}) {
  if (zone.details?.publicEvent === true) return 'publicEvent';
  if (zone.details?.pveArea === true) return 'grounds';
  return 'encounter';
}

/**
 * Порталы зоны `zoneId`. options: zoneIdAt(x, y) → id зоны по точке карты,
 * centre {x, y} — центр зоны в точках карты, anchors [{tx, tz}] — якоря событий
 * зоны, fallback {tx, tz} — куда ставить портал без якорей, locationExists(id).
 * Порядок и места детерминированы: у одной точки всегда тот же якорь.
 */
function zonePortals(zoneId = '', worldZones = [], options = {}) {
  const zoneIdAt = typeof options.zoneIdAt === 'function' ? options.zoneIdAt : () => '';
  const locationExists = typeof options.locationExists === 'function' ? options.locationExists : () => true;
  const centre = options.centre || { x: 0, y: 0 };
  const anchors = (Array.isArray(options.anchors) ? options.anchors : [])
    .filter(row => Number.isFinite(Number(row?.tx)) && Number.isFinite(Number(row?.tz)));
  const fallback = options.fallback || { tx: 0, tz: 0 };
  const rows = [];
  for (const zone of Array.isArray(worldZones) ? worldZones : []) {
    if (!worldZoneOpen(zone)) continue;
    const id = cleanId(zone.id);
    const locationId = cleanId(zone.locationId);
    if (!id || !locationId || !locationExists(locationId)) continue;
    const x = Number(zone.x);
    const y = Number(zone.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const kind = portalKind(zone);
    const inside = kind === 'grounds'
      ? Math.hypot(Number(centre.x) - x, Number(centre.y) - y) <= Math.max(0, Number(zone.radius || 0))
      : zoneIdAt(x, y) === zoneId;
    if (!inside) continue;
    rows.push({ id, zone, kind, locationId, point: { x, y } });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const taken = new Set();
  return rows.map(({ id, zone, kind, locationId, point }, index) => {
    let spot = { tx: Number(fallback.tx) || 0, tz: Number(fallback.tz) || 0 };
    if (anchors.length) {
      let slot = stableHash(id) % anchors.length;
      for (let step = 0; step < anchors.length && taken.has(slot); step += 1) slot = (slot + 1) % anchors.length;
      const reuse = taken.has(slot);
      taken.add(slot);
      const anchor = anchors[slot];
      // Якорей меньше, чем точек: лишний портал встаёт рядом, а не поверх.
      spot = { tx: Number(anchor.tx) + (reuse ? 3 * (1 + (index % 3)) : 0), tz: Number(anchor.tz) };
    } else if (index > 0) {
      spot = { tx: spot.tx + 3 * index, tz: spot.tz };
    }
    const title = String(zone.title || '').slice(0, 64);
    return {
      id: `wz_${id}`.slice(0, 72),
      worldZoneId: id,
      kind,
      to: locationId,
      roomId: String(zone.roomId || '').replace(/[^a-zA-Z0-9_:#-]/g, '').slice(0, 120),
      name: kind === 'grounds' ? `Следы: ${title || 'угодья'}` : (title || 'Событие'),
      areaId: kind === 'grounds' ? cleanId(zone.details?.areaId || zone.sourceId) : '',
      encounterId: String(zone.encounterId || '').slice(0, 40),
      pvpMode: String(zone.pvpMode || 'pvp').slice(0, 24),
      tx: Math.round(spot.tx),
      tz: Math.round(spot.tz),
      radius: PORTAL_RADIUS,
      point
    };
  });
}

/** Подпись набора порталов: по ней сервер решает, пора ли разослать новое состояние зоны. */
function portalSignature(portals = []) {
  return (Array.isArray(portals) ? portals : []).map(row => `${row.id}@${row.tx},${row.tz}`).join('|');
}

module.exports = { PORTAL_RADIUS, portalSignature, worldZoneOpen, zonePortals };
