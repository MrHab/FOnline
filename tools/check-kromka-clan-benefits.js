'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  WEEK_MS,
  benefitOrdersForProfile,
  claimWeeklyBaseGrant,
  clanFastTravelFeeMultiplier,
  commitClanCraftBenefit,
  markBenefitOrderCompleted,
  ownedClanBaseContext,
  previewClanCraftBenefit,
  weeklyGrantForProfile
} = require('../src/server/kromka-clan-benefits');
const {
  claimBase,
  ensureBaseStates,
  ensureClan,
  releaseInactiveBases,
  sanitizeClanStore
} = require('../src/server/kromka-clans');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/clan-bases.json'), 'utf8'));
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const unitySource = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaPipboyCanvas.KromkaClans.cs'), 'utf8');

const knownItems = new Set([
  'oil', 'weaponParts', 'blue', 'water', 'ore', 'chemicals', 'electronics',
  'silver', 'wood', 'medicine', 'ammoParts'
]);
const implementedBenefitKeys = new Set([
  'clanStationFuelCostPct', 'weeklyGrant', 'weeklySine', 'filterCostPct',
  'processedOreOutputPct', 'reagentOutputPct', 'specialOrders', 'clanStoragePct',
  'clanFastTravelDiscountPct', 'medicalRawOutputPct', 'productionWaterCostPct',
  'earlyShiftForecastMinutes', 'eventDetectionPct', 'militaryContracts', 'protectedRally'
]);

assert.equal(catalog.bases.length, 8, 'Every strategic holding must participate in the benefit contract.');
for (const profile of catalog.bases) {
  const grant = weeklyGrantForProfile(profile);
  assert(Object.keys(grant).length > 0, `${profile.id} needs a tangible weekly economic grant.`);
  for (const [itemId, qty] of Object.entries(grant)) {
    assert(knownItems.has(itemId), `${profile.id} grants unknown item ${itemId}.`);
    assert(Number.isInteger(qty) && qty > 0, `${profile.id} weekly grant must be a positive integer.`);
  }
  for (const key of Object.keys(profile.benefit || {})) {
    assert(implementedBenefitKeys.has(key), `${profile.id} advertises unimplemented benefit key ${key}.`);
  }
}

const now = 1_900_000_000_000;
for (const profile of catalog.bases) {
  const store = sanitizeClanStore({});
  ensureBaseStates(store, catalog, now);
  const clanId = `clan-${profile.id}`;
  const characterId = `char-${profile.id}`;
  const clan = ensureClan(store, { id: clanId, name: profile.displayName, role: 'Основатель' }, { characterId, name: 'Проверяющий' }, now);
  assert(claimBase(store, clan.id, profile.id, characterId, catalog, now).ok);
  const expected = weeklyGrantForProfile(profile);
  const first = claimWeeklyBaseGrant(store, catalog, clan.id, now + 1);
  assert(first.ok && !first.duplicate, `${profile.id} first maintained week must pay its grant.`);
  assert.deepEqual(first.grant, expected);
  const snapshot = { ...clan.storage };
  const duplicate = claimWeeklyBaseGrant(store, catalog, clan.id, now + 2);
  assert(duplicate.ok && duplicate.duplicate, `${profile.id} weekly grant must be idempotent inside the week.`);
  assert.deepEqual(clan.storage, snapshot, `${profile.id} duplicate claim changed storage.`);
  const next = claimWeeklyBaseGrant(store, catalog, clan.id, now + WEEK_MS + 2);
  assert(next.ok && !next.duplicate, `${profile.id} must pay again after a full week.`);
}

function profile(id) {
  return catalog.bases.find(row => row.id === id);
}

function repeatedCraft(baseProfile, recipeId, requirements, output, count) {
  const runtime = {};
  const totals = { saved: {}, bonus: {} };
  for (let index = 0; index < count; index += 1) {
    const preview = previewClanCraftBenefit(baseProfile, runtime, recipeId, requirements, output);
    for (const [id, qty] of Object.entries(preview.applied.saved || {})) totals.saved[id] = Number(totals.saved[id] || 0) + qty;
    for (const [id, qty] of Object.entries(preview.applied.bonus || {})) totals.bonus[id] = Number(totals.bonus[id] || 0) + qty;
    commitClanCraftBenefit(runtime, preview);
  }
  return totals;
}

assert.equal(repeatedCraft(profile('hydro2'), 'napalmcraft', { oil: 1, silver: 1 }, { id: 'napalm', qty: 1 }, 5).saved.oil, 1,
  'GЭС-2 must save exactly 20% fuel across deterministic fractional credits.');
assert.equal(repeatedCraft(profile('filter_t6'), 'reagentcraft', { chemicals: 1 }, { id: 'chemicals', qty: 1 }, 20).saved.chemicals, 3,
  'Т-6 must save exactly 15% filtration chemicals across repeated work.');
assert.equal(repeatedCraft(profile('ore_exchange'), 'weaponpartscraft', { ore: 6 }, { id: 'weaponParts', qty: 2 }, 4).bonus.weaponParts, 2,
  'Рудный перевал must add 25% processed output.');
assert.equal(repeatedCraft(profile('reverse_cycle'), 'reagentcraft', { oil: 2 }, { id: 'chemicals', qty: 3 }, 4).bonus.chemicals, 3,
  'Цех обратного цикла must add 25% reagent output.');
assert.equal(repeatedCraft(profile('chalk_sluice'), 'medicinecraft', { chemicals: 2, water: 1 }, { id: 'medicine', qty: 3 }, 4).bonus.medicine, 3,
  'Меловой шлюз must add 25% medical raw output.');
assert.equal(repeatedCraft(profile('chalk_sluice'), 'medicinecraft', { chemicals: 2, water: 1 }, { id: 'medicine', qty: 3 }, 10).saved.water, 1,
  'Меловой шлюз must save exactly 10% production water.');
assert.equal(clanFastTravelFeeMultiplier(profile('bypass_depot')), 0.85, 'Депо must cut the capital transfer fee by 15%.');

for (const baseId of ['reverse_cycle', 'fort14']) {
  const baseProfile = profile(baseId);
  const runtime = {};
  const orders = benefitOrdersForProfile(baseProfile, runtime, now);
  assert.equal(orders.length, 1, `${baseId} needs one concrete benefit order.`);
  assert(orders[0].ready && Object.keys(orders[0].cost).length && Object.keys(orders[0].reward).length);
  const readyAt = markBenefitOrderCompleted(runtime, orders[0], now);
  assert(readyAt > now && !benefitOrdersForProfile(baseProfile, runtime, now + 1)[0].ready,
    `${baseId} order cooldown must be server-owned.`);
}

const ownershipStore = sanitizeClanStore({});
ensureBaseStates(ownershipStore, catalog, now);
const ownershipClan = ensureClan(ownershipStore, { id: 'owner', name: 'Владелец', role: 'Основатель' }, { characterId: 'owner-char', name: 'Владелец' }, now);
claimBase(ownershipStore, ownershipClan.id, 'bypass_depot', 'owner-char', catalog, now);
assert(ownedClanBaseContext(ownershipStore, catalog, ownershipClan.id, 'clanDepotBypass'));
releaseInactiveBases(ownershipStore, catalog, now + catalog.inactiveReturnMs + 1);
assert.equal(ownedClanBaseContext(ownershipStore, catalog, ownershipClan.id), null, 'Benefits must stop with ownership.');

for (const needle of [
  "action === 'completeBenefitOrder'",
  "action === 'protectedRally'",
  'serverClaimWeeklyClanBaseGrant',
  'serverPreviewClanCraftBenefit',
  'clanFastTravelFeeMultiplier(serverClanBaseContextForPlayer(p)',
  'serverPlayerHasProtectedClanRally'
]) assert(serverSource.includes(needle), `Server integration is missing ${needle}.`);
for (const needle of ['ОСОБЫЕ ЗАКАЗЫ ВЛАДЕНИЯ', 'ЗАЩИЩЁННЫЙ СБОР', 'completeBenefitOrder']) {
  assert(unitySource.includes(needle), `Unity clan UI is missing ${needle}.`);
}

console.log('Kromka clan benefits passed: eight weekly economies, exact craft modifiers, orders, the transfer discount, rally protection and ownership revocation.');
