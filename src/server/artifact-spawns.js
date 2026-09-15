'use strict';

const { artifactIndexes, calculateArtifactEffects } = require('./artifact-effects');
const { RECORD_VERSION, baseTierOfType, pickBirthType, tierRow } = require('./artifact-instances');
const { RULES } = require('./artifact-runtime');
const { hash32 } = require('./shift-cycle');

function fieldTierRange(field = {}) {
  const range = Array.isArray(field?.tierRange) && field.tierRange.length >= 2 ? field.tierRange : null;
  return range ? [Number(range[0]), Number(range[1])] : null;
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
    state.artifacts = (state.artifacts || []).filter(row => row?.birth === true);
    return state;
  }
  if (state.shiftId === shift.shiftId) return state;
  const indexes = artifactIndexes(catalog);
  const fields = (Array.isArray(anomalyFields) ? anomalyFields : []).filter(row => row && Number.isFinite(Number(row.x)) && Number.isFinite(Number(row.z)));
  const requestedCount = opportunity
    ? Math.max(0, Math.floor(Number(opportunity.artifactCount || 0)))
    : Math.max(1, Math.floor(Number(shift.strength || 1)));
  const count = Math.min(fields.length, requestedCount);
  // Поле с неподобранной находкой пропускается: в одной аномалии одновременно
  // лежит не больше одного артефакта, включая рождённые между выбросами.
  const occupiedFields = new Set((state.artifacts || [])
    .filter(row => row && row.pickedUp !== true)
    .map(row => String(row.sourceFieldId || '')));
  const instanceSalt = typeof options.instanceSalt === 'function'
    ? options.instanceSalt
    : () => String(options.instanceSalt || '');
  const artifacts = [];
  for (let index = 0; index < count; index += 1) {
    const field = fields[index % Math.max(1, fields.length)] || { x: 0, z: 0, radius: 1.5, id: `fallback_${index}` };
    if (occupiedFields.has(String(field.id || ''))) continue;
    // Вид определяется типом аномалии, а не региональной таблицей: у каждого
    // артефакта единственный природный источник. Тир задаёт опасность поля,
    // сила выброса влияет только на частоту появления.
    const fieldSeed = `${shift.shiftId}:${location.id || room.locationId}:${field.id}:${index}`;
    const range = fieldTierRange(field);
    const pick = pickBirthType(String(field.type || ''), range, catalog, fieldSeed);
    if (!pick) continue;
    const type = pick.type;
    const typeId = type.id;
    const angle = (hash32(`${shift.shiftId}:${field.id}:angle`) % 628) / 100;
    const radius = Math.max(0.35, Math.min(Number(field.radius || 1.5) * 0.62, 2.2));
    const id = `artifact:${shift.shiftId}:${String(location.id || room.locationId || 'room')}:${index}`;
    const salt = instanceSalt();
    occupiedFields.add(String(field.id || ''));
    artifacts.push({
      id,
      typeId,
      itemId: type.itemId,
      tier: pick.tier,
      // Зерно не выводится из публичного id: иначе скрытый ролл считается на
      // клиенте до стабилизации.
      seed: salt ? `${fieldSeed}:${salt}` : id,
      sourceAnomalyType: String(field.type || ''),
      sourceFieldId: String(field.id || ''),
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
  state.artifacts = [...(state.artifacts || []).filter(row => row?.birth === true), ...artifacts];
  return state;
}

// Рождённые аномалиями артефакты (см. anomaly-artifact-births) добавляются к
// состоянию комнаты поверх волновых; исчезнувшие из хранилища — убираются.
function mergeBirthArtifacts(room = {}, births = []) {
  if (!room.kromkaArtifactState || typeof room.kromkaArtifactState !== 'object') {
    room.kromkaArtifactState = { shiftId: '', artifacts: [] };
  }
  const state = room.kromkaArtifactState;
  const live = new Map((Array.isArray(births) ? births : []).map(row => [String(row.id), row]));
  const kept = (state.artifacts || []).filter(row => row?.birth !== true || live.has(String(row.id)));
  const present = new Set(kept.map(row => String(row.id)));
  let changed = kept.length !== (state.artifacts || []).length;
  for (const row of live.values()) {
    if (present.has(String(row.id))) continue;
    kept.push({
      id: String(row.id),
      typeId: String(row.typeId),
      itemId: String(row.itemId),
      tier: Math.max(1, Math.min(5, Math.floor(Number(row.tier || 1)))),
      seed: String(row.seed || row.id),
      sourceAnomalyType: String(row.sourceAnomalyType || ''),
      sourceFieldId: String(row.fieldId || ''),
      x: Number(row.x || 0),
      z: Number(row.z || 0),
      hot: true,
      stabilized: false,
      pickedUp: false,
      birth: true,
      ownerCharacterId: '',
      spawnedAt: Number(row.bornAt || 0),
      spawnedByShiftId: String(row.emissionId || '')
    });
    changed = true;
  }
  state.artifacts = kept;
  return changed;
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
    const visible = revealed || traced;
    const tierVisible = visible && detector.tierHint === true;
    const tier = tierVisible ? tierRow(catalog, artifact.tier || baseTierOfType(type || {})) : null;
    out.push({
      id: artifact.id,
      hot: artifact.hot === true,
      birth: artifact.birth === true,
      revealed: visible,
      trace: !revealed && traced,
      traceSeconds: traced ? Math.max(0, (memory.traces[artifact.id] + duration - now) / 1000) : 0,
      signal: Math.max(0, Math.min(1, 1 - distance / Number(detector.signalRange || 1))),
      distanceBand: distance <= 3 ? 'near' : distance <= 7 ? 'close' : 'far',
      x: visible ? artifact.x : null,
      z: visible ? artifact.z : null,
      typeId: visible && detector.identifiesBeforePickup ? artifact.typeId : '',
      displayName: visible && detector.identifiesBeforePickup ? String(type?.displayName || '') : '',
      tier: tier ? tier.tier : 0,
      tierColor: tier ? tier.color : '',
      sourceAnomalyType: visible ? String(artifact.sourceAnomalyType || '') : ''
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
      out.push({ id: `echo:${epoch}`, hot: false, birth: false, revealed: false,
        signal: 1 - distance / Number(detector.signalRange), distanceBand: distance <= 7 ? 'close' : 'far',
        x: null, z: null, typeId: '', displayName: '', tier: 0, tierColor: '', sourceAnomalyType: '' });
  } else delete memory.echo;
  return out;
}

// Подбор: найденный артефакт ложится в обычный инвентарь как «сырой»
// экземпляр (контейнер не нужен). Свойства раскроет только стабилизация.
function pickupArtifact(room = {}, player = {}, artifactId = '', catalog = {}, now = Date.now()) {
  const detector = detectorProfile(player, catalog);
  if (!detector) return { ok: false, error: 'Нужен активный детектор артефактов.' };
  const artifact = (room.kromkaArtifactState?.artifacts || []).find(row => row.id === String(artifactId || ''));
  if (!artifact || artifact.pickedUp) return { ok: false, error: 'Артефакт уже исчез из пятна.' };
  const distance = Math.hypot(Number(artifact.x || 0) - Number(player.x || 0), Number(artifact.z || 0) - Number(player.z || 0));
  if (distance > Number(detector.revealRange || 0) + 0.35) return { ok: false, error: 'Подойдите ближе: сигнал ещё не собрался в предмет.' };
  const indexes = artifactIndexes(catalog);
  const type = indexes.byId[String(artifact.typeId || '')];
  if (!type) return { ok: false, error: 'Неизвестный вид артефакта.' };
  const tier = Math.max(1, Math.min(5, Math.floor(Number(artifact.tier || baseTierOfType(type)))));
  const record = {
    id: artifact.id,
    typeId: artifact.typeId,
    itemId: artifact.itemId,
    hot: true,
    stabilized: false,
    revealed: false,
    tier,
    seed: String(artifact.seed || artifact.id),
    sourceAnomalyType: String(artifact.sourceAnomalyType || ''),
    sourceFieldId: String(artifact.sourceFieldId || ''),
    containerId: '',
    ownerCharacterId: String(player.characterId || ''),
    spawnedByShiftId: String(artifact.spawnedByShiftId || ''),
    spawnedAtMs: Math.max(0, Math.floor(Number(artifact.spawnedAt || 0))),
    acquiredAt: Number(now),
    recordVersion: RECORD_VERSION
  };
  artifact.pickedUp = true;
  artifact.ownerCharacterId = record.ownerCharacterId;
  player.artifactRecords = [...(player.artifactRecords || []), record];
  return { ok: true, record, birth: artifact.birth === true };
}

module.exports = {
  detectorProfile,
  mergeBirthArtifacts,
  pickupArtifact,
  publicArtifactsForPlayer,
  reconcileArtifactSpawns
};
