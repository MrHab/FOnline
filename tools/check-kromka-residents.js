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
console.log('Kromka base residents check passed: capacity, conflicts, loyalty bonuses and no party followers.');
