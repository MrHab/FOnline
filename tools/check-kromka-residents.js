'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPersonalBase } = require('../src/server/personal-bases');
const { applyResidentAction, calculateResidentBonuses, canAssign, sanitizeResidentState } = require('../src/server/base-residents');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/base-residents.json'), 'utf8'));
const baseCatalog = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/base-building.json'), 'utf8'));

assert.equal(catalog.residents.length, 12, 'All twelve specialist roles must be authored.');
assert.equal(new Set(catalog.residents.map(row => row.role)).size, 12, 'Specialist roles must be unique.');
for (const resident of catalog.residents) {
  assert(resident.displayName && resident.personalQuestId && resident.personalQuestName && resident.bonus && resident.bark);
  assert(resident.questObjective && resident.questRequirement?.itemId && resident.questRequirement?.qty > 0,
    `${resident.id} must have an authoritative personal-quest requirement.`);
}
const base = createPersonalBase('resident-test', 1);
base.rights.granted = true;
base.objects.push({ id: 'generator', typeId: 'generator_small' }, { id: 'storage', typeId: 'storage_crate' });
assert(applyResidentAction(base, 'recruit', 'avenir_key', catalog, baseCatalog, 2).ok);
assert(applyResidentAction(base, 'recruit', 'senya_haul', catalog, baseCatalog, 3).ok, 'Conflicting resident may be recruited as an unassigned candidate.');
assert(!canAssign(base, 'senya_haul', catalog, baseCatalog).ok, 'Conflicting specialists cannot be active together.');
assert.equal(calculateResidentBonuses(base, catalog).repairCostPct, -0.20);
assert(applyResidentAction(base, 'startQuest', 'avenir_key', catalog, baseCatalog, 4).ok);
assert(!applyResidentAction(base, 'startQuest', 'avenir_key', catalog, baseCatalog, 5).ok, 'Personal quest start must be idempotent.');
assert(!applyResidentAction(base, 'completeQuest', 'avenir_key', catalog, baseCatalog, 6).ok,
  'Client action cannot complete a personal quest without authoritative inventory context.');
const inventory = { electronics: 4 };
const completed = applyResidentAction(base, 'completeQuest', 'avenir_key', catalog, baseCatalog, 7, {
  inventoryQty: itemId => Number(inventory[itemId] || 0),
  consumeItem: (itemId, qty) => {
    if (Number(inventory[itemId] || 0) < qty) return false;
    inventory[itemId] -= qty;
    return true;
  }
});
assert(completed.ok && inventory.electronics === 0 && completed.state.loyalty === 75,
  'Authoritative completion must consume the requirement and reward loyalty once.');
assert(!applyResidentAction(base, 'completeQuest', 'avenir_key', catalog, baseCatalog, 8, {
  inventoryQty: () => 99, consumeItem: () => true
}).ok, 'Completed personal quests must remain idempotent.');
sanitizeResidentState(base, catalog);
assert(base.residents.every(id => typeof id === 'string'), 'Residents are assignments, never follower actor payloads.');
// Каждый бонус жителя обязан что-то делать. Раньше половина ключей не читалась
// нигде: игрок платил за личное дело и слот и не получал ничего. Список ниже —
// ключи, у которых есть потребитель в сервере; новый ключ без потребителя
// роняет проверку.
const APPLIED_BONUS_KEYS = {
  repairCostPct: 'residentBonuses.repairCostPct',
  weaponWearPct: 'serverCachedResidentBonuses(p).weaponWearPct',
  medicineOutputPct: 'bonuses.medicineOutputPct',
  filterOutputPct: 'bonuses.filterOutputPct',
  foodOutputPct: 'bonuses.foodOutputPct',
  injuryRecoveryPct: '.injuryRecoveryPct',
  maxHpFlat: 'serverCachedResidentBonuses(p).maxHpFlat',
  artifactPenaltyPct: 'residentBonuses.artifactPenaltyPct',
  shiftWarningLeadSeconds: 'residentBonuses.shiftWarningLeadSeconds',
  commonTradePricePct: '.commonTradePricePct',
  extraOrders: 'bonuses.extraOrders',
  storageCapacityPct: 'residentBonuses.storageCapacityPct',
  productionSpeedPct: 'bonuses.productionSpeedPct',
  guestPermissionSlots: '.guestPermissionSlots',
  waterUsePct: 'bonuses.waterUsePct',
  scrapPerHour: 'bonuses.scrapPerHour'
};
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
for (const [key, consumer] of Object.entries(APPLIED_BONUS_KEYS))
  assert(server.includes(consumer), `Resident bonus ${key} has no consumer in server.js (${consumer}).`);
for (const resident of catalog.residents) {
  const keys = Object.keys(resident.bonus || {});
  assert(keys.length > 0, `${resident.id} must give something.`);
  for (const key of keys)
    assert(APPLIED_BONUS_KEYS[key], `${resident.id}: bonus ${key} is not applied anywhere — remove it or give it a consumer.`);
}
const baseCanvas = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaPersonalBaseCanvas.cs'), 'utf8');
for (const key of Object.keys(APPLIED_BONUS_KEYS))
  assert(baseCanvas.includes(`case "${key}":`), `The base window does not name the resident bonus ${key}.`);

// Суммы, на которые опираются сервер и окно базы.
function soloBonuses(residentId, objectTypeIds) {
  const solo = createPersonalBase(`solo-${residentId}`, 1);
  solo.rights.granted = true;
  solo.tier = 4;
  solo.objects.push(...objectTypeIds.map((typeId, index) => ({ id: `${typeId}-${index}`, typeId })));
  assert(applyResidentAction(solo, 'recruit', residentId, catalog, baseCatalog, 10).ok, `${residentId} can be recruited`);
  assert(applyResidentAction(solo, 'assign', residentId, catalog, baseCatalog, 11).ok, `${residentId} can be assigned`);
  return calculateResidentBonuses(solo, catalog);
}
assert.equal(soloBonuses('platon_bolt', ['repair_bench']).weaponWearPct, -0.2, 'The gunsmith reduces weapon wear.');
const trader = soloBonuses('veniamin_credit', ['storage_crate']);
assert.equal(trader.commonTradePricePct, 0.08, 'The trader improves ordinary trade.');
assert.equal(trader.extraOrders, 2, 'The trader adds two production orders, not a boolean one.');
assert.equal(soloBonuses('zoya_splint', ['bed_fold', 'water_collector']).maxHpFlat, 10, 'The doctor adds maximum health.');
assert.equal(soloBonuses('taisa_pass', ['door_scrap']).guestPermissionSlots, 2, 'The security chief adds guest records.');
assert.equal(soloBonuses('lida_notch', ['radio_table']).shiftWarningLeadSeconds, 120, 'The scout forecasts the shift earlier.');
{
  const idle = createPersonalBase('solo-idle', 1);
  idle.rights.granted = true;
  idle.objects.push({ id: 'bench', typeId: 'repair_bench' });
  assert(applyResidentAction(idle, 'recruit', 'platon_bolt', catalog, baseCatalog, 10).ok);
  assert(applyResidentAction(idle, 'assign', 'platon_bolt', catalog, baseCatalog, 11).ok);
  idle.objects = [];
  const bonuses = calculateResidentBonuses(idle, catalog);
  assert.deepEqual(bonuses.activeResidentIds, [], 'Without the required object an assigned resident idles.');
  assert.equal(bonuses.weaponWearPct, undefined, 'An idle resident gives nothing.');
}

console.log('Kromka base residents check passed: capacity, conflicts, loyalty bonuses, every bonus applied and named, and no party followers.');
