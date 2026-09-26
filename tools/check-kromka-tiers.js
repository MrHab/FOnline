#!/usr/bin/env node
'use strict';

// Тиры мира (src/server/kromka-tiers.js, data/kromka/tiers.json): полный каталог
// во всех тирах, цепочка переработки, рецепты по тирам, прокачка профессий,
// сила вариантов, враги по тиру зоны и кусты волокна.

const assert = require('assert/strict');
const path = require('path');
const tiers = require('../src/server/kromka-tiers');
const { itemCatalogIndexes, fieldRecipeCatalogIndexes } = require('../src/server/kromka-items');

const ROOT = path.resolve(__dirname, '..');
const { config, itemCatalog, recipeCatalog } = tiers.readTieredCatalogs(path.join(ROOT, 'data'));
const items = itemCatalogIndexes(itemCatalog).byId;
const recipes = fieldRecipeCatalogIndexes(recipeCatalog).byId;
const T = tiers.TIER_COUNT;

// --- каталог: каждая группа снаряжения есть во всех пяти тирах -----------------------------
const groups = new Map();
for (const item of itemCatalog.items) {
  if (!item.tierGroup) continue;
  if (!groups.has(item.tierGroup)) groups.set(item.tierGroup, []);
  groups.get(item.tierGroup).push(item);
}
let equipmentGroups = 0;
for (const [group, rows] of groups) {
  const byTier = rows.map(row => row.tier).sort();
  assert.deepEqual(byTier, [1, 2, 3, 4, 5], `${group}: must exist in every tier, got ${byTier}`);
  const sorted = [...rows].sort((a, b) => a.tier - b.tier);
  for (let i = 1; i < T; i += 1) {
    assert(sorted[i].basePrice > sorted[i - 1].basePrice, `${group}: T${i + 1} must cost more than T${i}`);
    assert.equal(sorted[i].weight, sorted[i - 1].weight, `${group}: tiers must weigh the same`);
    assert.equal(sorted[i].category, sorted[0].category, `${group}: tiers share the category`);
  }
  for (const row of rows) {
    if (row.variantOf) assert.equal(row.variantOf, group, `${row.id}: variant of the wrong group`);
    else assert.equal(row.id, group, `${row.id}: only the authored tier keeps the group id`);
  }
  if (!sorted[0].materialKind) equipmentGroups += 1;
}
// Всё оружие, вся броня и инструменты добычи — во всех тирах.
const authoredWeapons = require(path.join(ROOT, 'data/kromka/items.json')).items
  .filter(item => item.category === 'weapons' && item.id !== 'fists');
assert(authoredWeapons.length >= 73, 'the whole authored arsenal is tiered');
for (const weapon of authoredWeapons) assert(groups.has(weapon.id), `${weapon.id}: has no tier variants`);
for (const tool of ['pickaxe', 'axe', 'handPump', 'sickle', 'skinningKnife']) {
  assert(groups.has(tool), `${tool}: gathering tool has no tier variants`);
}
assert.equal(items.smgT1.modificationSlots.length, 1, 'T1 opens one modification slot');
assert.equal(items.smgT5.modificationSlots.length, 4, 'T5 opens every modification slot');
assert.equal(items.smgT5.visualId, 'smg', 'a variant looks like its authored item');
assert.equal(items.oreT4.visualId, 'ore', 'a raw variant looks like its T1 material');
assert.equal(items.metalBarT3.visualId, 'scrap', 'refined metal borrows the authored scrap visual');

// --- материалы и цепочка переработки ------------------------------------------------------
for (const family of config.families) {
  for (let tier = 1; tier <= T; tier += 1) {
    const raw = items[family.raw.ids[tier - 1]];
    const refined = items[family.refined.ids[tier - 1]];
    assert(raw && raw.materialKind === 'raw' && raw.tier === tier, `${family.id}: raw T${tier} is missing`);
    assert(refined && refined.materialKind === 'refined' && refined.tier === tier, `${family.id}: refined T${tier} is missing`);
    const refine = recipes[`${refined.id}refine`];
    assert(refine, `${refined.id}: no refining recipe`);
    assert.equal(refine.station, family.refineStation);
    assert.equal(refine.inputs[raw.id], config.refining.rawPerTier[tier - 1], `${refine.id}: raw input`);
    if (tier > 1) assert.equal(refine.inputs[family.refined.ids[tier - 2]], 1, `${refine.id}: needs the previous refined tier`);
    else assert.equal(Object.keys(refine.inputs).length, 1, `${refine.id}: T1 refines raw only`);
    assert.equal(refine.tier, tier);
    assert.equal(refine.profession, `refine${family.id[0].toUpperCase()}${family.id.slice(1)}`);
  }
}

// --- облик по тирам: префабы PolygonApocalypse (visuals в tiers.json) ------------------------
const rawTiers = require(path.join(ROOT, 'data/kromka/tiers.json'));
const packRoot = path.join(ROOT, 'unity-client/Assets/Synty/PolygonApocalypse/Prefabs');
const packInstalled = require('fs').existsSync(packRoot);
for (const family of rawTiers.families) {
  const visuals = family.visuals || {};
  for (const kind of ['raw', 'refined']) {
    assert.equal((visuals[kind] || []).length, T, `${family.id}: ${kind} needs a pack prefab per tier`);
    assert.equal(new Set(visuals[kind]).size, T, `${family.id}: ${kind} tiers must look different`);
  }
  // Шкуры снимаются с убитого зверя — своей точки добычи у них нет.
  assert.equal((visuals.nodes || []).length, family.resourceType === 'hide' ? 0 : T, `${family.id}: node prefab per tier`);
  if (packInstalled) {
    for (const prefab of [...visuals.nodes, ...visuals.raw, ...visuals.refined]) {
      assert(require('fs').existsSync(path.join(packRoot, `${prefab}.prefab`)), `${family.id}: missing pack prefab ${prefab}`);
    }
  }
}

// --- рецепты снаряжения: пять тиров, материалы своего тира, профессия и уровень ------------
const smg = [1, 2, 3, 4, 5].map(tier => recipes[tiers.tierVariantId('smgcraft', tier, items.smg.tier)]);
smg.forEach((recipe, index) => {
  const tier = index + 1;
  assert(recipe, `smgcraft: tier ${tier} recipe is missing`);
  assert.equal(recipe.output.id, tiers.tierVariantId('smg', tier, items.smg.tier));
  assert.equal(recipe.inputs[config.families.find(f => f.id === 'metal').refined.ids[tier - 1]], 4, 'smg eats metal of its own tier');
  assert.equal(recipe.inputs.weaponParts, 3, 'untiered parts stay untiered');
  assert.equal(recipe.profession, 'craftFirearms');
  assert.equal(recipe.level, tiers.tierRow(config, tier).level);
});
assert.equal(recipes.leathercraftT5.profession, 'craftArmor');
assert.equal(recipes.polygonGrenade01craftT5.profession, 'craftThrowing');
assert.equal(recipes.machineguncraftT1.profession, 'craftHeavy');
assert.equal(recipes.knifecraftT3.profession, 'craftMelee');
assert.equal(recipes.sicklecraftT4.profession, 'craftTools');
for (const recipe of recipeCatalog.recipes) {
  if (!recipe.tier) continue;
  for (const inputId of Object.keys(recipe.inputs)) {
    const input = items[inputId];
    if (!input?.materialKind) continue;
    // Переработка берёт ещё и полуфабрикат прошлого тира; изделие — только свой тир.
    const previousAllowed = recipe.recipeGroup.endsWith('refine') && input.materialKind === 'refined';
    assert(input.tier === recipe.tier || (previousAllowed && input.tier === recipe.tier - 1),
      `${recipe.id}: ${inputId} is from another tier`);
  }
  // Изделие не дешевле своих материалов, иначе высокий тир продавали бы в убыток сырью.
  const cost = Object.entries(recipe.inputs)
    .reduce((sum, [id, qty]) => sum + (id === 'silver' ? 1 : items[id].basePrice) * qty, 0) / recipe.output.qty;
  assert(items[recipe.output.id].basePrice >= Math.floor(cost), `${recipe.id}: output is cheaper than its materials`);
}

// --- профессии -------------------------------------------------------------------------------
assert.equal(tiers.professionLevel(config, 0), 0);
assert.equal(tiers.professionLevel(config, tiers.professionXpForLevel(config, 10)), 10);
assert.equal(tiers.professionLevel(config, tiers.professionXpForLevel(config, 10) - 1), 9);
assert.equal(tiers.professionLevel(config, 1e12), config.professions.maxLevel);
for (let tier = 1; tier <= T; tier += 1) {
  const need = tiers.professionXpForLevel(config, tiers.tierRow(config, tier).level);
  assert(tiers.professionAllowsTier(config, need, tier), `T${tier}: its level opens it`);
  if (need > 0) assert(!tiers.professionAllowsTier(config, need - 1, tier), `T${tier}: one xp short keeps it closed`);
  assert.equal(tiers.professionMaxTier(config, need), tier);
}
const ledger = {};
const first = tiers.grantProfessionXp(config, ledger, 'gatherMetal', tiers.professionXpForWork(config, 1, 5));
assert.equal(first.gained, 100, 'five T1 units give 100 xp');
assert.equal(ledger.gatherMetal, 100);
assert.equal(tiers.grantProfessionXp(config, ledger, 'noSuchSkill', 10), null);
assert.deepEqual(tiers.sanitizeProfessionXp(config, { gatherMetal: 5.7, bogus: 99, gatherWood: -3 }), { gatherMetal: 5 });
const view = tiers.publicProfessions(config, { craftArmor: tiers.professionXpForLevel(config, 55) });
const armor = view.find(row => row.id === 'craftArmor');
assert.equal(armor.level, 55);
assert.equal(armor.maxTier, 4);
assert.equal(view.length, config.professions.skills.length);

// --- сила вариантов --------------------------------------------------------------------------
const rig = { id: 'smg', dmg: [12, 17] };
const t1 = tiers.scaleWeaponForTier(rig, config, 3, 1, 'smgT1');
const t5 = tiers.scaleWeaponForTier(rig, config, 3, 5, 'smgT5');
assert(t1.dmg[0] < 12 && t5.dmg[1] > 17, 'damage grows with the tier');
assert.equal(t5.id, 'smgT5');
const vest = tiers.scaleArmorForTier({ protection: { ballistic: 0.26 }, thresholds: { ballistic: 4 } }, config, 3, 5);
assert(vest.protection.ballistic > 0.26 && vest.thresholds.ballistic > 4, 'armour grows with the tier');
assert(tiers.tierWearMultiplier(config, 5) < tiers.tierWearMultiplier(config, 1), 'higher tiers wear slower');

// --- враги -----------------------------------------------------------------------------------
const gari1 = tiers.enemyTierScale(config, 'gari', 1);
const gari3 = tiers.enemyTierScale(config, 'gari', 3);
assert.equal(gari1.hp, 1);
assert(gari3.hp > gari1.hp && gari3.attack > 1 && gari3.xp > 1, 'a zone above the base tier strengthens the species');
assert(!tiers.speciesLivesInTier(config, 'fold', 1), 'folds do not nest in T1 zones');
assert.equal(tiers.enemyTierScale(config, 'fold', 1).hp, 1, 'a species never weakens below its base tier');
assert(tiers.speciesLivesInTier(config, 'fold', 5));
assert(tiers.speciesLivesInTier(config, 'raider', 1) && tiers.speciesLivesInTier(config, 'raider', 5));
for (let tier = 1; tier <= T; tier += 1) {
  const living = Object.keys(config.enemies.species).filter(id => tiers.speciesLivesInTier(config, id, tier));
  assert(living.length >= 3, `T${tier} zones need several species, got ${living}`);
}

// --- волокно ---------------------------------------------------------------------------------
const bushes = Array.from({ length: 400 }, (_, i) => ({ id: `bush_${i}`, prefab: 'dry_bush', tags: ['scatter'] }));
const zone = { objects: [...bushes, { id: 'tree', prefab: 'dead_tree_a', resourceType: 'wood' }] };
const marked = tiers.designateFiberNodes(zone);
const fiber = marked.objects.filter(row => row.resourceType === 'fiber');
assert(fiber.length >= 8 && fiber.length <= 40, `about one bush in twenty gives fibre, got ${fiber.length}`);
assert(fiber.every(row => row.tags.includes('resource') && row.hp > 0));
assert.deepEqual(tiers.designateFiberNodes(zone).objects.map(row => row.resourceType || ''),
  marked.objects.map(row => row.resourceType || ''), 'fibre bushes are chosen deterministically');
assert.equal(marked.objects.at(-1).resourceType, 'wood', 'other resource nodes stay untouched');

console.log(`Kromka tiers OK: ${itemCatalog.items.length} items (${equipmentGroups} equipment groups × ${T} tiers), `
  + `${recipeCatalog.recipes.length} recipes, ${config.families.length} material families, `
  + `${config.professions.skills.length} professions.`);
