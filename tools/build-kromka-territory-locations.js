'use strict';

// Генерирует авторские определения Сердцевины: одну большую сцену `coreZone`,
// четыре базы фракций, четыре боковые лаборатории и три уровня «Объекта Ноль».
// Источник — data/kromka/territory.json. Результат детерминирован; Unity
// пересобирает сцены только для новых id и дописывает объекты при экспорте.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const territory = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/territory.json'), 'utf8'));
const outDir = path.join(root, 'data/locations');
const TILE = 2;
const ANOMALY_TYPES = ['pull', 'seam', 'carousel', 'glass', 'dew', 'sink', 'chime', 'mute'];
const ANOMALY_DISCHARGE = { seam: 3000, pull: 4000, glass: 4000, sink: 4000, carousel: 5000, dew: 5000, mute: 5000, chime: 6000 };

function tileOf(value, sizeMeters) {
  return Math.max(0, Math.min(Math.round(sizeMeters / TILE) - 1, Math.floor(value / TILE + sizeMeters / TILE / 2)));
}

function point(x, z, width, depth, extra = {}) {
  return { tx: tileOf(x, width), tz: tileOf(z, depth), x, y: 0.1, z, rotationY: 0, ...extra };
}

function modelKey(file) {
  return path.basename(file, '.glb').replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// Видимость записывается в формате экспортёра Unity ({ blocks }): режим
// «block»/«cover» закрывает обзор, «none» — нет. Ключ `model` (camelCase от
// имени файла) билдер сцен сопоставляет с восстановленным префабом
// Assets/Prefabs/Kromka/RecoveredEnvironment/<snake_case>.prefab.
function visionField(vision) {
  const mode = String(vision?.mode || (typeof vision?.blocks === 'boolean' ? (vision.blocks ? 'block' : 'none') : 'block'));
  return { blocks: mode !== 'none' };
}

function prop(id, name, file, x, z, scale = 1, tags = [], extra = {}) {
  const s = typeof scale === 'number' ? { x: scale, y: scale, z: scale } : scale;
  return {
    id, model: modelKey(file), name,
    position: { x, y: 0, z }, rotation: { x: 0, y: extra.rotationY || 0, z: 0 },
    scale: s, collision: extra.collision || 'none', vision: visionField(extra.vision),
    tags, role: extra.role || 'scenery', ...(extra.fields || {})
  };
}

function guard(id, name, factionId, x, z, rotationY = 0) {
  return {
    id, model: 'caravanGuard', name,
    position: { x, y: 0, z }, rotation: { x: 0, y: rotationY, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    collision: 'solid', tags: ['npc', 'friendly', 'guard', 'territory-guard'],
    entity: {
      kind: 'npc', role: 'guard', faction: factionId, hostileToPlayer: false,
      equipmentProfile: 'guard', statProfile: 'guard', stationary: true, territoryFactionId: factionId
    }
  };
}

function serviceNpc(id, name, factionId, service, x, z, extra = {}) {
  return {
    id, model: extra.model || 'wastelandSettler', name,
    position: { x, y: 0, z }, rotation: { x: 0, y: extra.rotationY || 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    collision: 'solid', tags: ['npc', 'friendly', 'service', `service-${service}`, ...(extra.tags || [])],
    entity: {
      kind: 'npc', role: extra.role || 'npc', faction: factionId, hostileToPlayer: false,
      stationary: true, service, territoryFactionId: factionId, ...(extra.entity || {})
    }
  };
}

function raider(id, name, x, z, rotationY = 0) {
  return {
    id, model: 'enemyRaider', name, url: '/assets/models/wasteland/npc_raider.glb',
    position: { x, y: 0, z }, rotation: { x: 0, y: rotationY, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    collision: 'solid', tags: ['npc', 'enemy', 'hostile', 'raider'],
    entity: {
      kind: 'npc', role: 'raider', species: 'raider', faction: 'raiders', enemyType: 'raider',
      hostileToPlayer: true, profile: 'raider', statProfile: 'raider', equipmentProfile: 'raider', lootProfile: 'raider'
    }
  };
}

// Kromka mutants keep their legacy alias in `species` so the authored spawner
// resolves the right creature and `creatureTypeId` names the canonical kind.
const MUTANTS = {
  gari: { alias: 'ashWolf', model: 'enemyAshWolf', name: 'Гарь', faction: 'wild' },
  rykhlyak: { alias: 'radScorpion', model: 'enemyRadscorpion', name: 'Рыхляк', faction: 'wild' },
  listener: { alias: 'gecko', model: 'enemyGecko', name: 'Слухач', faction: 'wild' },
  dustling: { alias: 'mutantAnt', model: 'enemyMutantAnt', name: 'Пыльник', faction: 'wild' },
  burned: { alias: 'ghoul', model: 'enemyGhoul', name: 'Выжженный', faction: 'mutants' },
  fold: { alias: 'superMutant', model: 'enemySuperMutant', name: 'Складень', faction: 'mutants' },
  mourner: { alias: 'fireGecko', model: 'enemyFireGecko', name: 'Плакальщик', faction: 'wild' }
};

function mutant(id, kind, x, z, rotationY = 0, extra = {}) {
  const def = MUTANTS[kind];
  return {
    id, model: def.model, name: extra.name || def.name,
    position: { x, y: 0, z }, rotation: { x: 0, y: rotationY, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    collision: 'solid', tags: ['npc', 'enemy', 'hostile', 'monster', def.alias.toLowerCase()],
    entity: {
      kind: 'npc', role: 'monster', species: def.alias, creatureTypeId: kind, faction: def.faction,
      enemyType: def.alias, hostileToPlayer: true, ...(extra.entity || {})
    }
  };
}

function container(id, name, x, z, width, depth, tier = 'basic', extra = {}) {
  return { id, name, tier, ...point(x, z, width, depth), ...extra };
}

function anomalyField(id, type, x, z, radius, belt, tierRange) {
  return {
    id, type, x: Number(x.toFixed(2)), z: Number(z.toFixed(2)), radius,
    dischargeMs: ANOMALY_DISCHARGE[type] || 4000, training: false, placement: 'unity-authored',
    belt, tierRange
  };
}

function polar(radius, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  return { x: Math.cos(rad) * radius, z: Math.sin(rad) * radius };
}

function visualProfile(id, sky, fog, ground) {
  return {
    id, skyDay: sky, fogDay: fog, hemiSkyDay: '#a5a8a0', hemiGroundDay: ground,
    fillDay: '#9aa08e', sunDay: '#d6c797', rimDay: '#c9b98d'
  };
}

function baseDefinition(faction, index) {
  const width = 76;
  const depth = 76;
  const platform = { x: 0, z: 24 };
  const objects = [
    prop('perimeter_n', 'Северный периметр', 'concrete_wall.glb', 0, 34, { x: 8, y: 1, z: 1 }, ['territory-base', 'perimeter']),
    prop('perimeter_s', 'Южный периметр', 'concrete_wall.glb', 0, -34, { x: 8, y: 1, z: 1 }, ['territory-base', 'perimeter']),
    prop('perimeter_w', 'Западный периметр', 'concrete_wall.glb', -34, 0, { x: 1, y: 1, z: 8 }, ['territory-base', 'perimeter']),
    prop('perimeter_e', 'Восточный периметр', 'concrete_wall.glb', 34, 0, { x: 1, y: 1, z: 8 }, ['territory-base', 'perimeter']),
    prop('command', `Штаб: ${faction.baseDisplayName}`, 'wasteland_shack.glb', -12, 6, 2.0, ['territory-base', 'command-core', 'landmark']),
    prop('metro_hall', 'Зал платформы метро', 'concrete_wall.glb', 0, 18, { x: 5, y: 1.4, z: 1 }, ['territory-base', 'metro']),
    prop('metro_car', 'Вагон метро — в Сердцевину', 'cargo_stack.glb', 0, 26, { x: 2.6, y: 1.6, z: 1.2 }, ['territory-base', 'metro', 'metro-car', 'landmark'],
      { fields: { interactive: { kind: 'transition', role: 'metro', to: 'coreZone' } } }),
    // Казарма: личная койка каждому из 9 NPC базы (5 сервисов + 4 охранника).
    ...Array.from({ length: 9 }, (_, k) => prop(`bunk_${k + 1}`, 'Койка казармы', 'cot_bed.glb', -26 + k * 2, -22, 1, ['territory-base', 'barracks', 'personal-bed'], { vision: { mode: 'none' } })),
    prop('storage_shed', 'Личное хранилище', 'storage_lean_to.glb', 14, 4, 1.4, ['interactive', 'storage', 'container', 'personal-storage', 'territory-storage'], {
      vision: { mode: 'cover' },
      fields: {
        interactive: { kind: 'container', role: 'storage', containerType: 'storage', storageFaction: faction.id },
        footprint: { x: 2, z: 2 }
      }
    }),
    prop('lab_terminal', 'Терминал стабилизации артефактов', 'workshop_bench.glb', 14, -8, 1.2, ['interactive', 'terminal', 'artifact-lab', 'territory-service'], {
      vision: { mode: 'cover' },
      fields: { interactive: { kind: 'terminal', role: 'artifactLab', service: 'artifactLab', storageFaction: faction.id } }
    }),
    prop('watch_w', 'Пост охраны Запад', 'watch_post.glb', -26, -26, 1.1, ['guard-post']),
    prop('watch_e', 'Пост охраны Восток', 'watch_post.glb', 26, -26, 1.1, ['guard-post']),
    prop('gate_left', 'Входной пилон', 'utility_pole.glb', -4, -30, 1, ['entrance']),
    prop('gate_right', 'Входной пилон', 'utility_pole.glb', 4, -30, 1, ['entrance']),
    serviceNpc('registrar', 'Регистратор фракции', faction.id, 'registrar', -12, 1, { role: 'npc', tags: ['registrar'] }),
    serviceNpc('auctioneer', 'Аукционист', faction.id, 'auction', -2, 4, { role: 'npc', tags: ['auction'] }),
    serviceNpc('medic', 'Медик базы', faction.id, 'medic', 6, -14, { role: 'npc', tags: ['medic'] }),
    serviceNpc('trader', 'Снабженец базы', faction.id, 'trade', 8, 4, {
      role: 'merchant', model: 'traderNpc', tags: ['merchant', 'trader'],
      entity: { traderProfile: faction.traderProfile, tradeProfile: faction.traderProfile, dialogueProfile: faction.traderProfile }
    }),
    serviceNpc('researcher', 'Исследователь аномалий', faction.id, 'artifactLab', 18, -10, { role: 'npc', tags: ['researcher'] }),
    guard('guard_gate_a', faction.guardName, faction.id, -6, -27, 3.14),
    guard('guard_gate_b', faction.guardName, faction.id, 6, -27, 3.14),
    guard('guard_metro_a', faction.guardName, faction.id, -6, 22, 0),
    guard('guard_metro_b', faction.guardName, faction.id, 6, 22, 0)
  ];
  return {
    schema: 'realm.location.v1', version: 1, id: faction.baseLocationId, name: faction.baseDisplayName,
    seed: 2026091500 + index, safe: true, pvpMode: 'peaceful', kind: 'settlement', respawnAllowed: true,
    // База — не отдельная метка глобальной карты: попасть на неё можно только
    // через узел Сердцевины, подписав контракт с фракцией. Выход воротами в
    // пустошь остаётся.
    enemyCap: 0, spawnCount: 0, noRespawn: true, allowGlobalMapExit: true, noGlobalMapEntry: true,
    territoryId: territory.id, territoryRole: 'base', factionAccess: faction.id,
    territoryBase: { factionId: faction.id, capitalLocationId: faction.capitalLocationId, zoneLocationId: territory.zoneLocationId },
    ground: { preset: 'industrialDust', label: faction.baseDisplayName },
    map: { width, depth, origin: 'center' }, grid: { snap: true, step: 2 },
    spawn: point(0, -22, width, depth),
    entryFromWorld: point(0, -22, width, depth),
    entryFromCore: point(platform.x, platform.z - 6, width, depth, { rotationY: 3.14 }),
    transitions: [
      {
        id: 'metro_platform', type: 'location', label: 'Платформа метро — Сердцевина',
        to: territory.zoneLocationId, entryKey: faction.platform.entryKey, ...point(platform.x, platform.z, width, depth), radius: 3.2
      },
      { id: 'gate_out', type: 'globalMap', label: 'Ворота — выход на глобальную карту', to: 'wasteland', ...point(0, -33, width, depth), radius: 3 }
    ],
    worldZones: [
      { id: 'world_exit_gate', label: 'Ворота базы', tx: tileOf(0, width), tz: tileOf(-33, depth), radius: 4 }
    ],
    containers: [],
    objects,
    anomalyFields: [],
    visualProfile: visualProfile(`kromka-territory-base-${faction.id}-v1`, '#5b6266', '#6f7576', '#3b3f3c'),
    worldRevision: 'kromka-1', runtimeMode: 'unity-authored', macroRegion: territory.macroRegion,
    kromkaVisualProfile: `territory-base-${faction.id}-v1`, ambientProfile: 'guarded-metro-yard', anomalyDensity: 0,
    unityScene: `Assets/Scenes/Kromka/Locations/${faction.baseLocationId}.unity`
  };
}

function zoneDefinition() {
  const width = territory.zone.widthMeters;
  const depth = territory.zone.depthMeters;
  const objects = [];
  const transitions = [];
  const worldZones = [];
  const containers = [];
  const anomalyFields = [];
  const entries = {};

  territory.factions.forEach((faction, index) => {
    const p = faction.platform;
    const sign = { x: Math.sign(p.x), z: Math.sign(p.z) };
    const inward = { x: -sign.x, z: -sign.z };
    entries[p.entryKey] = point(p.x + inward.x * 6, p.z + inward.z * 6, width, depth, { rotationY: Math.atan2(inward.x, inward.z) });
    objects.push(prop(`${p.id}_hall`, `${p.displayName}: навес`, 'concrete_wall.glb', p.x, p.z, { x: 5, y: 1.2, z: 1 }, ['territory-platform', faction.id], { rotationY: sign.x !== 0 ? Math.PI / 2 : 0 }));
    objects.push(prop(`${p.id}_car`, 'Вагон метро — на базу', 'cargo_stack.glb', p.x - inward.x * 3, p.z - inward.z * 3, { x: 2.4, y: 1.5, z: 1.1 }, ['territory-platform', 'metro-car', faction.id], {
      fields: { interactive: { kind: 'transition', role: 'metro', to: faction.baseLocationId } }
    }));
    objects.push(prop(`${p.id}_barrier_a`, 'Ограждение платформы', 'concrete_wall.glb', p.x + (sign.x !== 0 ? 0 : -10), p.z + (sign.z !== 0 ? 0 : -10), { x: 2, y: 1, z: 1 }, ['territory-platform', 'barrier']));
    objects.push(prop(`${p.id}_barrier_b`, 'Ограждение платформы', 'concrete_wall.glb', p.x + (sign.x !== 0 ? 0 : 10), p.z + (sign.z !== 0 ? 0 : 10), { x: 2, y: 1, z: 1 }, ['territory-platform', 'barrier']));
    objects.push(prop(`${p.id}_post`, 'Пост платформы', 'watch_post.glb', p.x + inward.x * 12 + (sign.x !== 0 ? 0 : 8), p.z + inward.z * 12 + (sign.z !== 0 ? 0 : 8), 1.1, ['guard-post', faction.id]));
    for (let g = 0; g < 4; g++) {
      const side = g % 2 === 0 ? -1 : 1;
      const depthOffset = g < 2 ? 4 : 10;
      const gx = p.x + inward.x * depthOffset + (sign.x !== 0 ? 0 : side * 5);
      const gz = p.z + inward.z * depthOffset + (sign.z !== 0 ? 0 : side * 5);
      objects.push(guard(`${p.id}_guard_${g + 1}`, faction.guardName, faction.id, gx, gz, Math.atan2(inward.x, inward.z)));
    }
    transitions.push({
      id: `metro_${faction.id}`, type: 'location', label: `Платформа метро — ${faction.baseDisplayName}`,
      to: faction.baseLocationId, entryKey: 'entryFromCore', factionAccess: faction.id,
      ...point(p.x, p.z, width, depth), radius: 3.2
    });
    worldZones.push({
      id: p.id, label: p.displayName, type: 'factionPlatform', factionId: faction.id,
      tx: tileOf(p.x, width), tz: tileOf(p.z, depth), radius: territory.rules.platformProtectionRadius
    });
    void index;
  });

  territory.outposts.forEach((outpost, index) => {
    const o = outpost.position;
    objects.push(prop(`${outpost.id}_flag`, `${outpost.displayName}: флагшток`, 'utility_pole.glb', o.x, o.z, 1.3, ['territory-outpost', 'outpost-flag', outpost.id], {
      fields: { interactive: { kind: 'outpost', role: 'flag', outpostId: outpost.id } }
    }));
    objects.push(prop(`${outpost.id}_landmark`, outpost.displayName, `${outpost.landmark.replace(/([A-Z])/g, '_$1').toLowerCase()}.glb`, o.x + 6, o.z + 5, 1.6, ['territory-outpost', 'landmark', outpost.id]));
    objects.push(prop(`${outpost.id}_wall_n`, 'Укрытие', 'concrete_wall.glb', o.x, o.z + 9, { x: 2.5, y: 1, z: 1 }, ['territory-outpost', 'cover']));
    objects.push(prop(`${outpost.id}_wall_s`, 'Укрытие', 'concrete_wall.glb', o.x, o.z - 9, { x: 2.5, y: 1, z: 1 }, ['territory-outpost', 'cover']));
    objects.push(prop(`${outpost.id}_wall_w`, 'Укрытие', 'concrete_wall.glb', o.x - 9, o.z, { x: 1, y: 1, z: 2.5 }, ['territory-outpost', 'cover']));
    objects.push(prop(`${outpost.id}_stack`, 'Ящики', 'cargo_stack.glb', o.x - 5, o.z + 4, 1.2, ['territory-outpost', 'cover']));
    worldZones.push({
      id: `capture_${outpost.id}`, label: `Область контроля: ${outpost.displayName}`, type: 'outpostCapture', outpostId: outpost.id,
      tx: tileOf(o.x, width), tz: tileOf(o.z, depth), radius: outpost.captureRadius
    });
    containers.push(container(`${outpost.id}_cache`, `Тайник: ${outpost.displayName}`, o.x + 4, o.z - 4, width, depth, 'rare', { locked: true, lockDifficulty: 'medium' }));
    void index;
  });

  territory.labs.forEach(lab => {
    const e = lab.entrance;
    const dirX = Math.sign(e.x);
    const dirZ = Math.sign(e.z);
    objects.push(prop(`${lab.id}_shell`, `${lab.displayName}: вход`, 'concrete_wall.glb', e.x, e.z, { x: 3.5, y: 2.2, z: 3.5 }, ['territory-lab', 'lab-entrance', 'landmark', lab.theme]));
    objects.push(prop(`${lab.id}_door`, 'Гермодверь', 'cargo_stack.glb', e.x - dirX * 5, e.z - dirZ * 5, { x: 1.4, y: 1.6, z: 1 }, ['territory-lab', 'lab-door', lab.theme], {
      fields: { interactive: { kind: 'transition', role: 'labDoor', to: lab.id } }
    }));
    objects.push(prop(`${lab.id}_vent`, 'Вентиляционная шахта', 'utility_pole.glb', e.x + 7, e.z + 7, 1.1, ['territory-lab', 'vent']));
    transitions.push({
      id: `enter_${lab.id}`, type: 'location', label: `${lab.displayName} — вход`, to: lab.id, entryKey: 'entryFromCore',
      ...point(e.x - dirX * 6, e.z - dirZ * 6, width, depth), radius: 3
    });
    entries[lab.entryKey] = point(e.x - dirX * 9, e.z - dirZ * 9, width, depth, { rotationY: Math.atan2(-dirX, -dirZ) });
  });

  const c = territory.centralLab;
  objects.push(prop('center_core', `${c.displayName}: надземный блок`, 'concrete_wall.glb', 0, 0, { x: 4.5, y: 3, z: 4.5 }, ['territory-center', 'landmark', 'central-lab']));
  objects.push(prop('center_antenna', 'Мачта установки', 'relay_antenna.glb', 6, 6, 1.8, ['territory-center', 'landmark']));
  objects.push(prop('center_lift', 'Служебный лифт', 'cargo_stack.glb', 0, -8, { x: 1.6, y: 1.8, z: 1.2 }, ['territory-center', 'lab-door'], {
    fields: { interactive: { kind: 'transition', role: 'labDoor', to: c.levels[0].id } }
  }));
  transitions.push({
    id: 'enter_coreLabCenter', type: 'location', label: `${c.displayName} — служебный лифт`, to: c.levels[0].id, entryKey: 'entryFromCore',
    ...point(0, -10, width, depth), radius: 3
  });
  entries[c.entryKey] = point(0, -14, width, depth, { rotationY: Math.PI });

  for (const ring of territory.anomalyRings) {
    const belt = territory.belts.find(row => row.id === ring.belt);
    ANOMALY_TYPES.forEach((type, index) => {
      const pos = polar(ring.radius, ring.startAngle + index * 45);
      anomalyFields.push(anomalyField(`core-${ring.belt}-${type}`, type, pos.x, pos.z, ring.fieldRadius, ring.belt, belt.tierRange));
    });
  }

  // Окраины: лагеря рейдеров и стаи между платформами и лабораториями.
  [22.5, 112.5, 202.5, 292.5].forEach((angle, index) => {
    const pos = polar(124, angle);
    objects.push(prop(`raider_camp_${index + 1}_tent`, 'Лагерь налётчиков', 'wasteland_shack.glb', pos.x, pos.z, 1.2, ['territory-outskirts', 'raider-camp']));
    for (let r = 0; r < 3; r++) {
      const off = polar(4 + r, angle + 120 * r);
      objects.push(raider(`raider_camp_${index + 1}_${r + 1}`, 'Налётчик окраин', pos.x + off.x, pos.z + off.z, (angle * Math.PI) / 180));
    }
    containers.push(container(`outskirts_cache_${index + 1}`, 'Тайник окраин', pos.x + 6, pos.z - 6, width, depth, 'basic'));
  });
  [67.5, 157.5, 247.5, 337.5].forEach((angle, index) => {
    const pos = polar(118, angle);
    const kinds = ['gari', 'gari', 'listener'];
    kinds.forEach((kind, k) => {
      const off = polar(3 + k * 2, angle + 90 * k);
      objects.push(mutant(`pack_${index + 1}_${k + 1}`, kind, pos.x + off.x, pos.z + off.z));
    });
    containers.push(container(`outskirts_cache_${index + 5}`, 'Тайник окраин', pos.x - 6, pos.z + 6, width, depth, 'basic'));
  });
  // Промежуточный пояс: более опасные стаи у лабораторий.
  territory.labs.forEach((lab, index) => {
    const e = lab.entrance;
    const kinds = ['rykhlyak', 'rykhlyak', 'listener', 'dustling'];
    kinds.forEach((kind, k) => {
      const off = polar(12 + k * 2, index * 90 + 45 + 70 * k);
      objects.push(mutant(`lab_watch_${index + 1}_${k + 1}`, kind, e.x + off.x, e.z + off.z));
    });
    containers.push(container(`middle_cache_${index + 1}`, `Тайник у входа: ${lab.displayName}`, e.x + 12, e.z - 12, width, depth, 'rare', { locked: true, lockDifficulty: 'medium' }));
  });
  // Центр: элитные противники вокруг Объекта Ноль.
  [0, 90, 180, 270].forEach((angle, index) => {
    const pos = polar(32, angle + 20);
    objects.push(mutant(`center_fold_${index + 1}`, 'fold', pos.x, pos.z));
    const burnedPos = polar(36, angle + 50);
    objects.push(mutant(`center_burned_${index + 1}`, 'burned', burnedPos.x, burnedPos.z));
  });
  containers.push(container('center_cache_a', 'Сейф установки', 14, 14, width, depth, 'rare', { locked: true, lockDifficulty: 'hard', terminalLocked: true, terminalDifficulty: 'hard', terminalUnlocksLock: true, terminalName: 'Терминал Объекта Ноль' }));
  containers.push(container('center_cache_b', 'Сейф установки', -14, -14, width, depth, 'rare', { locked: true, lockDifficulty: 'hard' }));

  const first = territory.factions[0];
  return {
    schema: 'realm.location.v1', version: 1, id: territory.zoneLocationId, name: territory.displayName,
    seed: 2026091510, safe: false, pvpMode: territory.zone.pvpMode, kind: 'territoryZone', respawnAllowed: false,
    enemyCap: territory.zone.enemyCap, spawnCount: 0, noRespawn: true, allowGlobalMapExit: false, noGlobalMapEntry: true,
    territoryId: territory.id, territoryRole: 'zone', factionAccess: 'territory',
    ground: { preset: 'glassAsh', label: territory.displayName },
    map: { width, depth, origin: 'center' }, grid: { snap: true, step: 2 },
    spawn: entries[first.platform.entryKey],
    entryFromWorld: entries[first.platform.entryKey],
    ...entries,
    transitions,
    worldZones,
    containers,
    objects,
    anomalyFields,
    visualProfile: visualProfile('kromka-territory-core-v1', '#4d5560', '#5f6670', '#2f3336'),
    worldRevision: 'kromka-1', runtimeMode: 'unity-authored', macroRegion: territory.macroRegion,
    kromkaVisualProfile: 'territory-core-v1', ambientProfile: 'contested-central-field', anomalyDensity: 0.8,
    unityScene: `Assets/Scenes/Kromka/Locations/${territory.zoneLocationId}.unity`
  };
}

function labDefinition(lab, index) {
  const width = 76;
  const depth = 76;
  const theme = lab.theme;
  const themeEnemies = {
    bio: [['dustling', -10, 6], ['dustling', 10, 6], ['gari', 0, 14], ['listener', -14, 18], ['listener', 14, 18]],
    energy: [['listener', -10, 6], ['listener', 10, 6], ['fold', 0, 16], ['burned', -14, 18]],
    materials: [['fold', -10, 8], ['fold', 10, 8], ['burned', 0, 16], ['rykhlyak', -14, 18], ['rykhlyak', 14, 18]],
    anomalous: [['mourner', -10, 6], ['mourner', 10, 6], ['burned', 0, 16], ['listener', -14, 18]]
  }[theme];
  const themeFields = {
    bio: [['dew', -20, 20], ['dew', 20, 22]],
    energy: [['chime', -20, 20], ['chime', 20, 22], ['seam', 0, 26]],
    materials: [['glass', -20, 20], ['glass', 20, 22]],
    anomalous: [['pull', -18, 18], ['carousel', 18, 18], ['sink', 0, 26], ['mute', 0, 12]]
  }[theme];
  const objects = [
    prop('outer_shell_w', 'Внешний корпус', 'concrete_wall.glb', -24, 0, { x: 1, y: 1.4, z: 9 }, ['lab', theme]),
    prop('outer_shell_e', 'Внешний корпус', 'concrete_wall.glb', 24, 0, { x: 1, y: 1.4, z: 9 }, ['lab', theme]),
    prop('outer_shell_n', 'Внешний корпус', 'concrete_wall.glb', 0, 32, { x: 12, y: 1.4, z: 1 }, ['lab', theme]),
    prop('inner_gate', 'Герметичная секция', 'cargo_stack.glb', 0, 10, { x: 3, y: 1.8, z: 1 }, ['lab', 'inner-gate', theme]),
    prop('inner_wall_w', 'Внутренняя переборка', 'concrete_wall.glb', -12, 10, { x: 4, y: 1.4, z: 1 }, ['lab', theme]),
    prop('inner_wall_e', 'Внутренняя переборка', 'concrete_wall.glb', 12, 10, { x: 4, y: 1.4, z: 1 }, ['lab', theme]),
    prop('bench_a', 'Лабораторный стол', 'workshop_bench.glb', -14, -8, 1.2, ['lab', 'bench']),
    prop('bench_b', 'Лабораторный стол', 'workshop_bench.glb', 14, -8, 1.2, ['lab', 'bench']),
    prop('node_a', theme === 'bio' ? 'Питательный узел' : theme === 'energy' ? 'Распределительный щит' : theme === 'materials' ? 'Клапан давления' : 'Импульсный излучатель', 'utility_pole.glb', -10, 22, 1.2, ['lab', 'mechanic-node', theme], {
      fields: { interactive: { kind: 'labNode', role: 'mechanic', labId: lab.id, nodeId: 'node_a', theme } }
    }),
    prop('node_b', theme === 'bio' ? 'Питательный узел' : theme === 'energy' ? 'Распределительный щит' : theme === 'materials' ? 'Клапан давления' : 'Импульсный излучатель', 'utility_pole.glb', 10, 22, 1.2, ['lab', 'mechanic-node', theme], {
      fields: { interactive: { kind: 'labNode', role: 'mechanic', labId: lab.id, nodeId: 'node_b', theme } }
    }),
    prop('landmark', lab.displayName, theme === 'energy' ? 'relay_antenna.glb' : theme === 'bio' ? 'water_tank.glb' : 'cargo_stack.glb', 0, 26, 1.8, ['lab', 'landmark', theme])
  ];
  themeEnemies.forEach(([kind, x, z], k) => objects.push(mutant(`${theme}_guardian_${k + 1}`, kind, x, z)));
  return {
    schema: 'realm.location.v1', version: 1, id: lab.id, name: lab.displayName,
    seed: 2026091520 + index, safe: false, pvpMode: territory.zone.pvpMode, kind: 'territoryLab', respawnAllowed: false,
    enemyCap: 0, spawnCount: 0, noRespawn: true, allowGlobalMapExit: false, noGlobalMap: true,
    territoryId: territory.id, territoryRole: 'lab', factionAccess: 'territory',
    lab: { id: lab.id, theme, summary: lab.summary, rewardComponents: lab.rewardComponents, innerGateContainerId: 'inner_vault' },
    ground: { preset: 'concreteFloor', label: lab.displayName },
    map: { width, depth, origin: 'center' }, grid: { snap: true, step: 2 },
    spawn: point(0, -30, width, depth),
    entryFromWorld: point(0, -30, width, depth),
    entryFromCore: point(0, -30, width, depth),
    transitions: [
      { id: 'exit_to_core', type: 'location', label: 'Выход в Сердцевину', to: territory.zoneLocationId, entryKey: lab.entryKey, ...point(0, -34, width, depth), radius: 3 }
    ],
    worldZones: [],
    containers: [
      container('outer_vault', 'Внешний шкаф', -18, -2, width, depth, 'rare', { locked: true, lockDifficulty: 'medium' }),
      container('inner_vault', `Сейф: ${lab.displayName}`, 0, 28, width, depth, 'rare', { locked: true, lockDifficulty: 'hard', terminalLocked: true, terminalDifficulty: 'medium', terminalUnlocksLock: true, terminalName: `Терминал: ${lab.displayName}` }),
      container('inner_cabinet', 'Внутренний шкаф', 16, 24, width, depth, 'rare', { locked: true, lockDifficulty: 'medium' })
    ],
    objects,
    anomalyFields: themeFields.map(([type, x, z], k) => anomalyField(`${lab.id}-${type}-${k + 1}`, type, x, z, 3.2, 'lab', [2, 4])),
    visualProfile: visualProfile(`kromka-territory-lab-${theme}-v1`, '#3f4650', '#4d545c', '#26292c'),
    worldRevision: 'kromka-1', runtimeMode: 'unity-authored', macroRegion: territory.macroRegion,
    kromkaVisualProfile: `territory-lab-${theme}-v1`, ambientProfile: `sealed-${theme}-laboratory`, anomalyDensity: 0.6,
    unityScene: `Assets/Scenes/Kromka/Locations/${lab.id}.unity`
  };
}

function centralLevelDefinition(level, index) {
  const width = 76;
  const depth = 76;
  const c = territory.centralLab;
  const prev = index > 0 ? c.levels[index - 1] : null;
  const next = index + 1 < c.levels.length ? c.levels[index + 1] : null;
  const objects = [
    prop('shell_w', 'Бетонная стена', 'concrete_wall.glb', -26, 0, { x: 1, y: 1.4, z: 10 }, ['central-lab', level.role]),
    prop('shell_e', 'Бетонная стена', 'concrete_wall.glb', 26, 0, { x: 1, y: 1.4, z: 10 }, ['central-lab', level.role]),
    prop('shell_n', 'Бетонная стена', 'concrete_wall.glb', 0, 32, { x: 13, y: 1.4, z: 1 }, ['central-lab', level.role])
  ];
  const containers = [];
  const enemies = [];
  const transitions = [
    prev
      ? { id: 'lift_up', type: 'location', label: `Лифт наверх: ${prev.displayName}`, to: prev.id, entryKey: 'entryFromBelow', ...point(0, -34, width, depth), radius: 3 }
      : { id: 'lift_out', type: 'location', label: 'Служебный лифт — в Сердцевину', to: territory.zoneLocationId, entryKey: c.entryKey, ...point(0, -34, width, depth), radius: 3 }
  ];
  if (next) {
    transitions.push({ id: 'lift_down', type: 'location', label: `Спуск: ${next.displayName}`, to: next.id, entryKey: 'entryFromAbove', ...point(0, 34, width, depth), radius: 3 });
  }
  if (level.role === 'service') {
    objects.push(prop('store_a', 'Складская стойка', 'storage_lean_to.glb', -14, 6, 1.3, ['central-lab', 'stockpile']));
    objects.push(prop('store_b', 'Складская стойка', 'storage_lean_to.glb', 14, 6, 1.3, ['central-lab', 'stockpile']));
    objects.push(prop('checkpoint', 'Пост охраны', 'watch_post.glb', 0, 12, 1.2, ['central-lab', 'guard-post']));
    ['burned', 'burned', 'fold', 'listener', 'listener'].forEach((kind, k) => enemies.push(mutant(`service_guard_${k + 1}`, kind, -16 + k * 8, 14 + (k % 2) * 6)));
    containers.push(container('service_locker_a', 'Складской шкаф', -18, 4, width, depth, 'basic'));
    containers.push(container('service_locker_b', 'Складской шкаф', 18, 4, width, depth, 'rare', { locked: true, lockDifficulty: 'medium' }));
  } else if (level.role === 'research') {
    objects.push(prop('wing_divider', 'Разделительная переборка', 'concrete_wall.glb', 0, 8, { x: 1, y: 1.4, z: 7 }, ['central-lab', 'divider']));
    objects.push(prop('bench_w', 'Исследовательский стенд', 'workshop_bench.glb', -14, 10, 1.2, ['central-lab', 'bench']));
    objects.push(prop('bench_e', 'Исследовательский стенд', 'workshop_bench.glb', 14, 10, 1.2, ['central-lab', 'bench']));
    objects.push(prop('emergency_lift', 'Аварийный подъёмник', 'cargo_stack.glb', -22, -28, { x: 1.4, y: 1.6, z: 1 }, ['central-lab', 'lab-door'], {
      fields: { interactive: { kind: 'transition', role: 'labDoor', to: territory.zoneLocationId } }
    }));
    transitions.push({ id: 'emergency_lift', type: 'location', label: 'Аварийный подъёмник — в Сердцевину', to: territory.zoneLocationId, entryKey: c.entryKey, ...point(-22, -30, width, depth), radius: 3 });
    ['fold', 'fold', 'mourner', 'mourner', 'dustling', 'dustling'].forEach((kind, k) => enemies.push(mutant(`research_threat_${k + 1}`, kind, (k < 3 ? -1 : 1) * (10 + (k % 3) * 5), 6 + (k % 3) * 7)));
    containers.push(container('research_vault_w', 'Западный архив', -20, 24, width, depth, 'rare', { locked: true, lockDifficulty: 'hard' }));
    containers.push(container('research_vault_e', 'Восточный архив', 20, 24, width, depth, 'rare', { terminalLocked: true, terminalDifficulty: 'hard', terminalUnlocksLock: true, terminalName: 'Архивный терминал' }));
  } else {
    objects.push(prop('reactor_core', 'Основная установка', 'relay_antenna.glb', 0, 12, 2.4, ['central-lab', 'landmark', 'reactor']));
    ['nw', 'ne', 'sw', 'se'].forEach((corner, k) => {
      const x = corner.endsWith('w') ? -18 : 18;
      const z = corner.startsWith('n') ? 24 : 2;
      objects.push(prop(`shield_node_${corner}`, `Защитный узел ${corner.toUpperCase()}`, 'utility_pole.glb', x, z, 1.3, ['central-lab', 'boss-node', 'shield-node'], {
        fields: { interactive: { kind: 'bossNode', role: 'shield', bossId: c.worldBoss.id, nodeId: `shield_node_${corner}` } }
      }));
      void k;
    });
    enemies.push(mutant('zero_custodian', 'fold', 0, 6, Math.PI, {
      name: c.worldBoss.displayName,
      entity: { bossId: c.worldBoss.id, worldBoss: true, hp: 1800, atk: 34 }
    }));
    ['burned', 'burned', 'fold'].forEach((kind, k) => enemies.push(mutant(`custodian_escort_${k + 1}`, kind, -8 + k * 8, 14)));
    containers.push(container('boss_vault_a', 'Контейнер установки', -12, 26, width, depth, 'rare', { bossLoot: c.worldBoss.id, locked: true, lockDifficulty: 'hard' }));
    containers.push(container('boss_vault_b', 'Контейнер установки', 12, 26, width, depth, 'rare', { bossLoot: c.worldBoss.id, locked: true, lockDifficulty: 'hard' }));
  }
  return {
    schema: 'realm.location.v1', version: 1, id: level.id, name: level.displayName,
    seed: 2026091530 + index, safe: false, pvpMode: territory.zone.pvpMode, kind: 'territoryLab', respawnAllowed: false,
    enemyCap: 0, spawnCount: 0, noRespawn: true, allowGlobalMapExit: false, noGlobalMap: true,
    territoryId: territory.id, territoryRole: 'centralLab', factionAccess: 'territory',
    lab: { id: c.id, level: level.role, levelIndex: index, worldBoss: level.role === 'reactor' ? c.worldBoss : null },
    ground: { preset: 'concreteFloor', label: level.displayName },
    map: { width, depth, origin: 'center' }, grid: { snap: true, step: 2 },
    spawn: point(0, -30, width, depth),
    entryFromWorld: point(0, -30, width, depth),
    entryFromCore: point(0, -30, width, depth),
    entryFromAbove: point(0, -30, width, depth),
    entryFromBelow: point(0, 30, width, depth, { rotationY: Math.PI }),
    transitions,
    worldZones: [],
    containers,
    objects: [...objects, ...enemies],
    anomalyFields: level.role === 'reactor'
      ? [anomalyField(`${level.id}-glass-1`, 'glass', -14, 8, 3.4, 'lab', [3, 5]), anomalyField(`${level.id}-chime-1`, 'chime', 14, 8, 3.4, 'lab', [3, 5])]
      : level.role === 'research'
        ? [anomalyField(`${level.id}-seam-1`, 'seam', -12, 20, 3.0, 'lab', [3, 5]), anomalyField(`${level.id}-sink-1`, 'sink', 12, 20, 3.0, 'lab', [3, 5])]
        : [],
    visualProfile: visualProfile('kromka-territory-center-v1', '#363c46', '#444b54', '#202326'),
    worldRevision: 'kromka-1', runtimeMode: 'unity-authored', macroRegion: territory.macroRegion,
    kromkaVisualProfile: 'territory-center-v1', ambientProfile: 'buried-installation', anomalyDensity: 0.7,
    unityScene: `Assets/Scenes/Kromka/Locations/${level.id}.unity`
  };
}

const definitions = [
  zoneDefinition(),
  ...territory.factions.map(baseDefinition),
  ...territory.labs.map(labDefinition),
  ...territory.centralLab.levels.map(centralLevelDefinition)
];

// При повторном запуске сохраняем экспортированные Unity объекты и точки.
for (const definition of definitions) {
  const file = path.join(outDir, `${definition.id}.json`);
  if (fs.existsSync(file)) {
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (previous.runtimeMode === 'unity-authored' && Array.isArray(previous.objects)) {
      const generatedIds = new Set(definition.objects.map(row => row.id));
      const unityOnly = previous.objects.filter(row => row?.unityAuthored === true && !generatedIds.has(row.id));
      definition.objects = [...definition.objects, ...unityOnly];
      for (const key of ['unitySpawns', 'migrationArrival']) if (previous[key] !== undefined) definition[key] = previous[key];
    }
  }
  fs.writeFileSync(file, JSON.stringify(definition, null, 2) + '\n');
}
console.log(`Generated ${definitions.length} territory locations: ${definitions.map(row => row.id).join(', ')}.`);
