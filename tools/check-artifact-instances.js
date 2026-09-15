#!/usr/bin/env node
'use strict';

// Экземпляры артефактов: тиры и цвета, детерминированные свойства по seed,
// скрытие свойств до стабилизации, миграция старых записей, стоимость услуг,
// подбор без контейнера и правила сложения эффектов.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const catalog = JSON.parse(read('data/artifacts.json'));
const anomalies = JSON.parse(read('data/anomalies.json'));
const items = JSON.parse(read('data/kromka/items.json'));
const itemById = Object.fromEntries(items.items.map(row => [row.id, row]));
const inst = require('../src/server/artifact-instances');
const {
  calculateArtifactEffects, previewArtifactEffects, sanitizeArtifactLoadout, sanitizeArtifactRecords
} = require('../src/server/artifact-effects');
const { pickupArtifact, publicArtifactsForPlayer } = require('../src/server/artifact-spawns');

const close = (a, b, message) => assert(Math.abs(Number(a) - Number(b)) < 1e-6, message || `${a} != ${b}`);

// --- каталог v2 -------------------------------------------------------------
assert.equal(catalog.schema, 'kromka.artifacts.v2');
assert.equal(catalog.version, 2);
assert.equal(catalog.types.length, 13, 'Thirteen authored kinds stay in the catalog.');
const tiers = inst.tierRows(catalog);
assert.deepEqual(tiers.map(row => row.color), ['#8a939b', '#d8d2c0', '#efd078', '#9fd7ff', '#ff9a54'],
  'Artifact tier colors must be the shared equipment scale.');
assert.deepEqual(tiers.map(row => row.tier), [1, 2, 3, 4, 5]);
for (let i = 1; i < tiers.length; i += 1) {
  assert(tiers[i].benefitScale > tiers[i - 1].benefitScale, 'Benefit grows with tier.');
  assert(tiers[i].drawbackScale <= tiers[i - 1].drawbackScale, 'Drawback shrinks with tier.');
  assert(Number(tiers[i].stabilization.silver) > Number(tiers[i - 1].stabilization.silver), 'Stabilization price grows with tier.');
}
for (const type of catalog.types) {
  assert(type.baseTier >= 1 && type.baseTier <= 5, `${type.id}: base tier`);
  assert(catalog.families[type.family], `${type.id}: unknown family ${type.family}`);
  assert(itemById[type.itemId], `${type.id}: unknown item ${type.itemId}`);
}
for (const family of Object.values(catalog.families)) assert(itemById[family.componentItemId], `family component ${family.componentItemId} missing`);
for (const row of tiers) {
  for (const item of [...row.stabilization.items, ...row.salvage.items]) assert(itemById[item.id], `tier ${row.tier}: unknown item ${item.id}`);
}
for (const type of anomalies.types) {
  const sources = catalog.anomalySources[type.id];
  assert(Array.isArray(sources) && sources.length, `Anomaly ${type.id} has no artifact kinds.`);
  for (const id of sources) assert(catalog.types.some(row => row.id === id), `Anomaly ${type.id} references unknown kind ${id}.`);
}
const sourced = new Set(Object.values(catalog.anomalySources).flat());
for (const type of catalog.types) assert(sourced.has(type.id), `${type.id} is born by no anomaly type.`);
assert.deepEqual(Object.keys(catalog.anomalySources).sort(), anomalies.types.map(row => row.id).sort());

// --- цвета тиров совпадают с Unity RoaGearData.TierColor --------------------
const gearSource = read('unity-client/Assets/Scripts/Game/RoaGearData.cs');
const colorBlock = gearSource.slice(gearSource.indexOf('TierColor ='), gearSource.indexOf('};', gearSource.indexOf('TierColor =')));
const unityColors = [...colorBlock.matchAll(/new Color\(([\d.]+)f, ([\d.]+)f, ([\d.]+)f\)/g)]
  .map(match => '#' + [match[1], match[2], match[3]].map(v => Math.round(Number(v) * 255).toString(16).padStart(2, '0')).join(''));
assert.deepEqual(unityColors, tiers.map(row => row.color), 'Unity tier tints drifted from the artifact tier colors.');

// --- детерминизм и масштаб тиров --------------------------------------------
const spring = catalog.types.find(row => row.id === 'spring');
const record = (tier, seed, extra = {}) => sanitizeArtifactRecords([{
  id: `rec-${tier}-${seed}`, typeId: 'spring', itemId: spring.itemId, tier, seed, stabilized: true, recordVersion: 2, ...extra
}], catalog)[0];
const a = inst.instanceProperties(record(3, 'seed-a'), catalog);
const b = inst.instanceProperties(record(3, 'seed-a'), catalog);
assert.deepEqual(a, b, 'Same kind, tier and seed must produce identical properties.');
const distinct = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map(seed => inst.instanceProperties(record(3, seed), catalog).effects.speedPct));
assert(distinct.size >= 3, 'Different seeds must produce different rolls.');
for (let tier = 1; tier <= 5; tier += 1) {
  const props = inst.instanceProperties(record(tier, 'seed-z'), catalog);
  assert.equal(props.tier, tier);
  assert(props.effects.speedPct > 0 && props.effects.resistances.electric < 0);
}
const t1 = inst.instanceProperties(record(1, 'same'), catalog);
const t5 = inst.instanceProperties(record(5, 'same'), catalog);
assert(t5.effects.speedPct > t1.effects.speedPct, 'Tier five benefit exceeds tier one.');
assert(Math.abs(t5.effects.resistances.electric) < Math.abs(t1.effects.resistances.electric), 'Tier five drawback is lighter than tier one.');
assert.equal(t5.primary.key, 'speedPct');
assert.equal(t5.drawback[0].key, 'resistances.electric');
// Спред пользы ограничен: ±15% вокруг масштаба тира (на базовом тире вида масштаб = 1).
for (const seed of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']) {
  const props = inst.instanceProperties(record(1, seed), catalog);
  assert(props.benefitMul >= 0.85 - 1e-9 && props.benefitMul <= 1.15 + 1e-9, `benefit multiplier out of range: ${props.benefitMul}`);
  assert(props.drawbackMul >= 0.85 - 1e-9 && props.drawbackMul <= 1.15 + 1e-9, `drawback multiplier out of range: ${props.drawbackMul}`);
}
// Полярность: у Молчуна отрицательный шум — польза и растёт по модулю с тиром.
const husherT1 = inst.instanceProperties({ typeId: 'husher', tier: 2, seed: 'h', stabilized: true }, catalog);
const husherT5 = inst.instanceProperties({ typeId: 'husher', tier: 5, seed: 'h', stabilized: true }, catalog);
assert(husherT5.effects.movementNoisePct < husherT1.effects.movementNoisePct, 'Negative-is-benefit keys scale as benefits.');
assert(Math.abs(husherT5.effects.hearingRangePct) < Math.abs(husherT1.effects.hearingRangePct), 'Hearing drawback shrinks with tier.');
const dropT5 = inst.instanceProperties({ typeId: 'drop', tier: 5, seed: 'd', stabilized: true }, catalog);
assert(dropT5.effects.waterUsePct < 0.30 && dropT5.effects.regenDelaySeconds < 6, 'Positive-is-cost keys shrink with tier.');
assert.equal(inst.instanceProperties({ typeId: 'dew', tier: 3, seed: 'x', stabilized: true }, catalog).effects.foodHealingDisabled, true, 'Boolean flags survive.');

// --- миграция старых записей ------------------------------------------------
const legacy = sanitizeArtifactRecords([
  { id: 'old-hot', itemId: 'artifactSpring', hot: true, stabilized: false, containerId: 'artifactContainer:1' },
  { id: 'old-stable', typeId: 'warmer', stabilized: true },
  { id: 'old-rare', typeId: 'memory', stabilized: true },
  { id: 'tampered', typeId: 'node', stabilized: false, revealed: true, recordVersion: 2, tier: 9, seed: 's' }
], catalog);
assert.deepEqual(legacy.map(row => [row.id, row.tier, row.revealed, row.stabilized, row.hot, row.recordVersion]), [
  ['old-hot', 1, false, false, true, 2],
  ['old-stable', 2, true, true, false, 2],
  ['old-rare', 3, true, true, false, 2],
  ['tampered', 1, false, false, true, 2]
], 'Legacy rarity maps to tier, stabilized maps to revealed, tampered revealed flags are dropped.');
assert(legacy.every(row => row.containerId === ''), 'Containers are no longer part of the record.');

// Своя прежняя редкость записи сильнее базового тира вида: редкая находка
// старого мира не обесценивается до обычной.
{
  const promoted = sanitizeArtifactRecords([
    { id: 'old-rare-spring', typeId: 'spring', itemId: 'artifactSpring', rarity: 'rare', stabilized: true },
    { id: 'old-plain-spring', typeId: 'spring', itemId: 'artifactSpring', stabilized: true }
  ], catalog);
  assert.equal(promoted[0].tier, 3, 'A record that was rare stays rare after the migration.');
  assert.equal(promoted[1].tier, 1, 'A record without its own rarity keeps the base tier of its kind.');
  assert.equal(promoted[0].seed, '', 'The migration does not invent a seed: old properties stay as they were.');
  assert.deepEqual(sanitizeArtifactRecords(promoted, catalog).map(row => [row.id, row.tier, row.seed]),
    promoted.map(row => [row.id, row.tier, row.seed]), 'Repeated normalization changes nothing.');
}
for (const type of catalog.types) {
  const migrated = sanitizeArtifactRecords([{ id: type.id, typeId: type.id, stabilized: true }], catalog)[0];
  assert.deepEqual(inst.instanceProperties(migrated, catalog).effects, type.effects,
    `${type.id}: a migrated record keeps exactly its authored base effects.`);
}

// --- скрытые свойства ---------------------------------------------------------
const raw = record(4, 'hidden', { stabilized: false });
const publicRaw = inst.publicArtifactRecord(raw, catalog);
assert(!('seed' in publicRaw), 'Seed never leaves the server.');
assert(!('properties' in publicRaw) && !('benefit' in publicRaw), 'Properties stay hidden before stabilization.');
assert.equal(publicRaw.tier, 4);
assert.equal(publicRaw.tierColor, '#9fd7ff');
assert.equal(publicRaw.displayName, 'Пружина');
assert.deepEqual(publicRaw.stabilizationCost, { silver: 320, items: [{ id: 'stabilizerCatalyst', qty: 2 }, { id: 'circuitModule', qty: 1 }] });
inst.stabilizeRecord(raw);
const publicStable = inst.publicArtifactRecord(raw, catalog);
assert(publicStable.revealed && publicStable.properties && publicStable.properties.effects.speedPct > 0, 'Stabilization reveals the fixed properties.');
assert(!('seed' in publicStable));
assert.deepEqual(publicStable.properties, inst.instanceProperties(raw, catalog), 'Revealed properties are the same deterministic roll.');
assert(inst.publicArtifactRecord(record(2, 'h', { stabilized: false }), catalog, { includeHidden: true }).properties, 'Owner-side tooling may request hidden data explicitly.');
const publicCatalog = inst.publicArtifactCatalog(catalog);
assert.equal(publicCatalog.tiers.length, 5);
assert(!JSON.stringify(publicCatalog).includes('"seed"'));

// --- стоимость стабилизации и разбора -----------------------------------------
const price = rows => rows.reduce((sum, row) => sum + Number(itemById[row.id]?.basePrice || 0) * row.qty, 0);
for (let tier = 1; tier <= 5; tier += 1) {
  for (const type of catalog.types) {
    if (type.baseTier > tier) continue;
    const row = { typeId: type.id, itemId: type.itemId, tier, seed: 'p', stabilized: true };
    const cost = inst.stabilizationCost(row, catalog);
    const yields = inst.salvageYields(row, catalog);
    assert(yields.length >= 1, `${type.id} T${tier}: salvage must yield something.`);
    assert(price(yields) < cost.silver + price(cost.items), `${type.id} T${tier}: salvage value must stay below stabilization cost.`);
    if (tier >= 4) {
      const component = catalog.families[type.family].componentItemId;
      assert(cost.items.some(item => item.id === component), `${type.id} T${tier}: stabilization needs the family component.`);
      assert(yields.some(item => item.id === component), `${type.id} T${tier}: salvage returns the family component.`);
    }
  }
}
assert.deepEqual(inst.stabilizationCost({ typeId: 'vein', tier: 1 }, catalog), { silver: 40, items: [{ id: 'chemicals', qty: 1 }] });
assert.deepEqual(inst.salvageYields({ typeId: 'vein', tier: 1 }, catalog), [{ id: 'chemicals', qty: 1 }]);

// --- подбор без контейнера, эффекты только после стабилизации -----------------
const room = { id: 'room', locationId: 'test', kromkaArtifactState: { shiftId: 'one', artifacts: [
  { id: 'birth:test:f1:abc', typeId: 'shell', itemId: 'artifactShell', tier: 3, seed: 'birth:test:f1:abc', sourceAnomalyType: 'glass', x: 1, z: 0, birth: true }
] } };
const player = {
  id: 'p', characterId: 'char', roomId: 'room', x: 0, z: 0, inventory: [],
  equipment: { detector: 'artifactDetectorMk2', artifactBelt: 'artifactBelt2' }, artifactRecords: [], artifactSlots: []
};
const seen = publicArtifactsForPlayer(room, player, catalog, 1000).find(row => row.id === 'birth:test:f1:abc');
assert(seen && seen.revealed && seen.tier === 3 && seen.tierColor === '#efd078', 'Mk2 reveals the tier before pickup.');
assert.equal(seen.typeId, '', 'Mk2 does not identify the kind before pickup.');
const pickup = pickupArtifact(room, player, 'birth:test:f1:abc', catalog, 2000);
assert(pickup.ok && pickup.birth, 'Pickup works without any protective container.');
assert(pickup.record.tier === 3 && pickup.record.seed === 'birth:test:f1:abc' && pickup.record.revealed === false && pickup.record.sourceAnomalyType === 'glass');
player.inventory.push({ id: 'artifactShell', qty: 1 });
sanitizeArtifactLoadout(player, catalog);
player.artifactSlots = [pickup.record.id];
sanitizeArtifactLoadout(player, catalog);
assert.deepEqual(calculateArtifactEffects(player, catalog).artifactTypeIds, [], 'A raw artifact grants nothing even when slotted.');
inst.stabilizeRecord(player.artifactRecords[0]);
sanitizeArtifactLoadout(player, catalog);
const effects = calculateArtifactEffects(player, catalog);
assert.deepEqual(effects.artifactTypeIds, ['shell']);
assert.deepEqual(effects.artifactTiers, [3]);
assert(effects.resistances.ballistic > 0.12, 'Tier three Shell protects more than the tier one baseline.');

// --- предпросмотр и сложение «сильнейший полностью, остальные вполовину» ------
const belt = {
  characterId: 'belt', inventory: [{ id: 'artifactVein', qty: 1 }, { id: 'artifactShell', qty: 1 }, { id: 'artifactAnchor', qty: 1 }],
  equipment: { artifactBelt: 'artifactBelt4' },
  artifactRecords: [
    { id: 'v', typeId: 'vein', stabilized: true }, { id: 's', typeId: 'shell', stabilized: true }, { id: 'a', typeId: 'anchor', stabilized: true }
  ],
  artifactSlots: ['v', 's', 'a']
};
sanitizeArtifactLoadout(belt, catalog);
close(calculateArtifactEffects(belt, catalog).speedPct, -0.10 - 0.08 - 0.06,
  'Drawbacks count in full: three speed penalties add up without any discount.');
close(calculateArtifactEffects(belt, catalog).carryKg, 15 + 0.5 * 8,
  'Benefits keep the rule «strongest in full, the rest by half».');
const preview = previewArtifactEffects(belt, catalog, ['v', 's']);
// Было: −0,10 − 0,08 − 0,06 = −0,24; станет: −0,08 − 0,06 = −0,14; дельта +0,10.
close(preview.delta.speedPct, 0.10, 'Preview shows the change of removing Anchor.');
close(preview.delta.knockbackResistance, -0.6);
assert.deepEqual(calculateArtifactEffects(belt, catalog).artifactRecordIds, ['v', 's', 'a'], 'Preview does not mutate the loadout.');
const duplicate = { ...belt, artifactRecords: [{ id: 'v1', typeId: 'vein', stabilized: true }, { id: 'v2', typeId: 'vein', stabilized: true }],
  inventory: [{ id: 'artifactVein', qty: 2 }], artifactSlots: ['v1', 'v2'] };
sanitizeArtifactLoadout(duplicate, catalog);
assert.deepEqual(calculateArtifactEffects(duplicate, catalog).artifactRecordIds, ['v1'], 'Two artifacts of one kind never stack.');

// --- предельные значения видны игроку -----------------------------------------
// Без потолка непонятно, почему четвёртый одинаковый артефакт уже ничего не
// даёт, поэтому caps уходят вместе с итогом эффектов.
{
  const effects = calculateArtifactEffects({ artifactRecords: [], artifactSlots: [] }, catalog);
  assert(effects.caps, 'The effect totals carry the ceilings.');
  assert.equal(effects.caps.speedPct, catalog.rules.maxSpeedBonusPct);
  assert.equal(effects.caps.carryKg, catalog.rules.maxCarryBonusKg);
  assert.equal(effects.caps.regenHpPerSecond, catalog.rules.maxRegenHpPerSecond);
  assert.equal(effects.caps.resistancePct, catalog.rules.maxResistancePct);
  assert.equal(effects.caps.secondarySimilarEffectMultiplier, catalog.rules.secondarySimilarEffectMultiplier);
  // Итог пояса с потолками виден в подсказке самого пояса в ПУТНИКе:
  // постоянной панели детектора в клиенте нет.
  const pipboy = read('unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs');
  for (const token of ['public static string BeltTotalsLine(JObject effects)', 'caps?["speedPct"]', 'caps?["carryKg"]'])
    assert(pipboy.includes(token), `The belt tooltip must show the ceilings: ${token}`);
}

// --- серверные контракты ------------------------------------------------------
const server = read('server.js');
for (const needle of [
  "app.get('/api/kromka/artifacts'",
  '...publicArtifactRecord(record, KROMKA_ARTIFACT_CATALOG)',
  "socket.on('salvageArtifact'",
  "beginCriticalAction(p, 'stabilizeArtifact', data, ['recordId'])",
  "beginCriticalAction(p, 'salvageArtifact', data, ['recordId'])",
  'serverArtifactStabilizationPlace(p, loc)',
  'serverArtifactLoadoutCombatLocked(p, Date.now())',
  "if (action === 'preview') {",
  'publicWeaponRuntimeRecord(sanitizeServerWeaponRuntimeRecord(record',
  'stabilizeArtifactRecord(record)'
]) assert(server.includes(needle), `server.js is missing the artifact contract: ${needle}`);
assert(!server.includes('Нужен свободный защитный контейнер'), 'Pickup must not require a container any more.');
// Снять пояс в бою нельзя: иначе правило «смена артефактов вне боя» обходится
// снятием контейнера целиком вместе со всеми штрафами.
assert(server.includes("if (String(data.slot || '') === 'artifactBelt' && serverArtifactLoadoutCombatLocked(p, Date.now()))"),
  'equipmentAction must refuse artifact belt changes during combat.');
// Правила потерь не зависят от причины смерти: самоподрыв роняет то же самое.
assert(server.includes("droppedItems = serverDropPvpLootForMode(room, target, isSelf ? null : p, loc, now);"),
  'A self-inflicted explosion must go through the same loss funnel.');
assert(!server.includes('fullDrop: !isSelf &&'), 'The loss flags of an explosion death must not depend on who caused it.');

// --- пояса и детекторы доступны игроку ---------------------------------------
const recipes = JSON.parse(read('data/economy-recipes.json')).recipes;
const traderProfiles = JSON.parse(read('data/traders.json')).profiles;
const soldItemIds = new Set();
for (const profile of Object.values(traderProfiles)) {
  for (const row of profile.stock || []) soldItemIds.add(row.id);
}
for (const beltRow of catalog.belts) {
  const item = itemById[beltRow.itemId];
  assert(item, `belt ${beltRow.itemId} is missing from the item catalog`);
  assert(Number(item.basePrice) > 0, `belt ${beltRow.itemId} must have a price: without it the belt cannot be traded`);
  assert(recipes[beltRow.itemId], `belt ${beltRow.itemId} must be craftable, otherwise the artifact loop never closes`);
}
assert(soldItemIds.has('artifactBelt2'), 'The smallest belt is sold, so a fresh mercenary can start the artifact loop.');
for (const detector of catalog.detectors) {
  const item = itemById[detector.itemId];
  assert(item && Number(item.basePrice) > 0, `detector ${detector.itemId} must have a price`);
  assert(recipes[detector.itemId], `detector ${detector.itemId} must be craftable`);
}
assert(soldItemIds.has('artifactDetectorMk1'), 'The first detector is sold at a faction base.');
// Старшие ступени тянут лабораторные компоненты: у лабораторий есть спрос.
assert(Object.keys(recipes.artifactBelt4.inputs).some(id => ['alloyPlate', 'circuitModule', 'spectrumSample', 'bioReagent'].includes(id)),
  'The largest belt consumes laboratory components.');
const unityInventory = read('unity-client/Assets/Scripts/Game/RoaInventory.cs');
assert(unityInventory.includes('Socket.EmitWithAck("salvageArtifact", payload, onAck)'), 'Unity must be able to salvage artifacts.');

console.log('Artifact instances OK: 5 tiers with shared colors, deterministic hidden properties, legacy migration, stabilization/salvage prices, container-free pickup, preview and stacking.');
