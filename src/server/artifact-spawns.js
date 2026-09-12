'use strict';

const { artifactIndexes, calculateArtifactEffects } = require('./artifact-effects');
const { RULES } = require('./artifact-runtime');
const { hash32 } = require('./shift-cycle');

function weightedPick(weights = {}, seed = '') {
  const rows = Object.entries(weights).filter(([, weight]) => Number(weight) > 0);
  const total = rows.reduce((sum, [, weight]) => sum + Number(weight), 0);
  if (!rows.length || total <= 0) return '';
  let cursor = (hash32(seed) / 0xffffffff) * total;
  for (const [id, weight] of rows) {
    cursor -= Number(weight);
    if (cursor <= 0) return id;
  }
  return rows[rows.length - 1][0];
}

function reconcileArtifactSpawns(room = {}, location = {}, shift = {}, catalog = {}, anomalyFields = [], now = Date.now(), options = {}) {
  if (!room.kromkaArtifactState || typeof room.kromkaArtifactState !== 'object') {
    room.kromkaArtifactState = { shiftId: '', artifacts: [] };
  }
  const state = room.kromkaArtifactState;
  if (!['active', 'afterglow'].includes(String(shift.phase || ''))) return state;
  const opportunity = options?.opportunity && typeof options.opportunity === 'object'
    ? options.opportunity
    : null;
  if (options?.causalArtifactRequired === true
    && (!opportunity
      || String(opportunity.shiftId || '') !== String(shift.shiftId || '')
      || String(opportunity.locationId || '') !== String(location.id || room.locationId || ''))) {
    state.shiftId = String(shift.shiftId || '');
    state.causeCode = 'shift_wave';
    state.artifacts = [];
    return state;
  }
  if (state.shiftId === shift.shiftId) return state;
  const indexes = artifactIndexes(catalog);
  const table = catalog.spawnTables?.[String(location.macroRegion || location.regionId || '')]
    || catalog.spawnTables?.default || {};
  const fields = (Array.isArray(anomalyFields) ? anomalyFields : []).filter(row => row && Number.isFinite(Number(row.x)) && Number.isFinite(Number(row.z)));
  const requestedCount = opportunity
    ? Math.max(0, Math.floor(Number(opportunity.artifactCount || 0)))
    : Math.max(1, Math.floor(Number(shift.strength || 1)));
  const count = Math.min(fields.length, requestedCount);
  const artifacts = [];
  for (let index = 0; index < count; index += 1) {
    const field = fields[index % Math.max(1, fields.length)] || { x: 0, z: 0, radius: 1.5, id: `fallback_${index}` };
    const typeId = weightedPick(table, `${shift.shiftId}:${location.id || room.locationId}:${field.id}:${index}`);
    const type = indexes.byId[typeId];
    if (!type) continue;
    const angle = (hash32(`${shift.shiftId}:${field.id}:angle`) % 628) / 100;
    const radius = Math.max(0.35, Math.min(Number(field.radius || 1.5) * 0.62, 2.2));
    artifacts.push({
      id: `artifact:${shift.shiftId}:${String(location.id || room.locationId || 'room')}:${index}`,
      typeId,
      itemId: type.itemId,
      x: Number((Number(field.x || 0) + Math.cos(angle) * radius).toFixed(3)),
      z: Number((Number(field.z || 0) + Math.sin(angle) * radius).toFixed(3)),
      hot: true,
      stabilized: false,
      pickedUp: false,
      ownerCharacterId: '',
      spawnedAt: Number(now),
      spawnedByShiftId: String(shift.shiftId)
    });
  }
  state.shiftId = String(shift.shiftId || '');
  state.causeCode = opportunity?.causeCode || 'shift_wave';
  state.regionId = opportunity?.regionId || String(location.macroRegion || location.regionId || '');
  state.artifacts = artifacts;
  return state;
}

function detectorProfile(player = {}, catalog = {}) {
  return artifactIndexes(catalog).detectors[String(player.equipment?.detector || '')] || null;
}

function publicArtifactsForPlayer(room = {}, player = {}, catalog = {}, now = Date.now()) {
  const detector = detectorProfile(player, catalog);
  if (!detector) { delete player.artifactDetectorMemory; return []; }
  const indexes = artifactIndexes(catalog);
  const effects = calculateArtifactEffects(player, catalog);
  const scope = `${room.id || room.locationId}:${room.kromkaArtifactState?.shiftId}:${detector.itemId}`;
  if (player.artifactDetectorMemory?.scope !== scope)
    player.artifactDetectorMemory = { scope, traces: {} };
  const memory = player.artifactDetectorMemory;
  const duration = RULES.traceDurationMs * (1 + effects.detectorTraceDurationPct);
  const out = [];
  for (const artifact of room.kromkaArtifactState?.artifacts || []) {
    if (!artifact || artifact.pickedUp) continue;
    const distance = Math.hypot(Number(artifact.x || 0) - Number(player.x || 0), Number(artifact.z || 0) - Number(player.z || 0));
    const revealed = distance <= Number(detector.revealRange || 0);
    if (revealed) memory.traces[artifact.id] = now;
    const traced = Number.isFinite(memory.traces[artifact.id]) && now < memory.traces[artifact.id] + duration;
    if (distance > Number(detector.signalRange || 0) && !traced) continue;
    const type = indexes.byId[artifact.typeId];
    out.push({
      id: artifact.id,
      hot: artifact.hot === true,
      revealed: revealed || traced,
      trace: !revealed && traced,
      traceSeconds: traced ? Math.max(0, (memory.traces[artifact.id] + duration - now) / 1000) : 0,
      signal: Math.max(0, Math.min(1, 1 - distance / Number(detector.signalRange || 1))),
      distanceBand: distance <= 3 ? 'near' : distance <= 7 ? 'close' : 'far',
      x: revealed || traced ? artifact.x : null,
      z: revealed || traced ? artifact.z : null,
      typeId: (revealed || traced) && detector.identifiesBeforePickup ? artifact.typeId : '',
      displayName: (revealed || traced) && detector.identifiesBeforePickup ? String(type?.displayName || '') : ''
    });
  }
  const liveIds = new Set((room.kromkaArtifactState?.artifacts || []).filter(row => !row.pickedUp).map(row => row.id));
  for (const id of Object.keys(memory.traces))
    if (!liveIds.has(id) || now >= memory.traces[id] + duration) delete memory.traces[id];
  // Memory's drawback is an intermittent unresolved echo, not fake loot. Keep
  // its position private and fixed for each pulse, so walking can disprove it.
  const epoch = Math.floor(now / 20000);
  if (effects.flags?.falseDetectorSignals && now % 20000 < 4000) {
    if (memory.echo?.epoch !== epoch) {
      const seed = hash32(`${scope}:${player.characterId || player.id}:${epoch}`);
      const angle = seed / 0xffffffff * Math.PI * 2;
      const radius = Number(detector.signalRange) * 0.55;
      memory.echo = { epoch, x: Number(player.x || 0) + Math.cos(angle) * radius,
        z: Number(player.z || 0) + Math.sin(angle) * radius };
    }
    const distance = Math.hypot(memory.echo.x - Number(player.x || 0), memory.echo.z - Number(player.z || 0));
    if (distance > Number(detector.revealRange) && distance < Number(detector.signalRange))
      out.push({ id: `echo:${epoch}`, hot: false, revealed: false,
        signal: 1 - distance / Number(detector.signalRange), distanceBand: distance <= 7 ? 'close' : 'far',
        x: null, z: null, typeId: '', displayName: '' });
  } else delete memory.echo;
  return out;
}

function pickupArtifact(room = {}, player = {}, artifactId = '', catalog = {}, now = Date.now()) {
  const detector = detectorProfile(player, catalog);
  if (!detector) return { ok: false, error: 'Нужен активный детектор артефактов.' };
  const artifact = (room.kromkaArtifactState?.artifacts || []).find(row => row.id === String(artifactId || ''));
  if (!artifact || artifact.pickedUp) return { ok: false, error: 'Артефакт уже исчез из пятна.' };
  const distance = Math.hypot(Number(artifact.x || 0) - Number(player.x || 0), Number(artifact.z || 0) - Number(player.z || 0));
  if (distance > Number(detector.revealRange || 0) + 0.35) return { ok: false, error: 'Подойдите ближе: сигнал ещё не собрался в предмет.' };
  const containerItemId = String(catalog.hotContainerItemId || 'artifactContainer');
  const containerCount = (player.inventory || []).filter(row => row.id === containerItemId).reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const occupied = (player.artifactRecords || []).filter(row => row.hot && !row.stabilized).length;
  if (occupied >= containerCount) return { ok: false, error: 'Нужен свободный защитный контейнер.' };
  const record = {
    id: artifact.id,
    typeId: artifact.typeId,
    itemId: artifact.itemId,
    hot: true,
    stabilized: false,
    containerId: `${containerItemId}:${occupied + 1}`,
    ownerCharacterId: String(player.characterId || ''),
    spawnedByShiftId: artifact.spawnedByShiftId,
    acquiredAt: Number(now)
  };
  artifact.pickedUp = true;
  artifact.ownerCharacterId = record.ownerCharacterId;
  player.artifactRecords = [...(player.artifactRecords || []), record];
  return { ok: true, record };
}

module.exports = {
  detectorProfile,
  pickupArtifact,
  publicArtifactsForPlayer,
  reconcileArtifactSpawns,
  weightedPick
};
