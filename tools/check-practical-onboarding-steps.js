'use strict';

// Runs real gameplay requests against the isolated journey character. No save
// edits, admin grants, evidence injection or direct quest progress are used.
const assert = require('assert');
module.exports = function practicalSteps({ call, state, actors, containers, moveNear, movementFrame, refresh, delay }) {
  const qty = id => (state().inventory || []).filter(row => row.id === id).reduce((n, row) => n + row.qty, 0);
  const fact = key => Number(state().kromkaOnboarding?.evidence?.[key] || 0);
  const ok = (result, label) => { assert(result?.ok, `${label}: ${JSON.stringify(result)}`); return result; };
  const action = async (event, payload) => {
    for (let attempt = 0; attempt < 22; attempt++) {
      const result = await call(event, { requestId: `practice_${Date.now()}_${attempt}`, ...payload });
      if (result.ok) return result;
      if (!/не хватает ОД|нужно [\d.]+ ОД|Слишком частая|ещё не готов|cooldown/i.test(result.error || '')) return ok(result, event);
      await delay(500);
    }
    throw new Error(`${event}: action did not become available`);
  };
  const equip = async (id, slot = 'weapon') => action('equipmentAction', {
    slot, itemRuntimeId: id, expectedRevision: Number(state().equipmentRevision || 0)
  });
  const target = () => { const row = actors().find(row => row.trainingTarget); assert(row, 'Real training target is missing'); return row; };
  const shot = (row, override = {}) => ({ weapon: 'pistol', enemyId: row.id,
    attackToken: `practice_shot_${Date.now()}`, mode: 'single',
    shotDirX: row.x - state().x, shotDirZ: row.z - state().z, ...override });
  const reload = () => action('reloadWeapon', { weapon: 'pistol' });
  return async function practice(step) {
    if (step.id === 'equipment') {
      const crate = containers().find(row => row.defId === 'yard_supply');
      assert(crate, 'Supply crate beside Gleb is missing');
      const gleb = actors().find(row => row.kromkaOnboardingNpcId === step.npcId);
      assert(Math.hypot(crate.x - gleb.x, crate.z - gleb.z) <= 4, 'Supplies are not beside the quest giver');
      assert.equal((await call('lootWorldContainer', { id: crate.id, mode: 'all' })).ok, false, 'Remote looting was accepted');
      await moveNear(crate.x, crate.z, 2, 'supply crate');
      const opened = ok(await call('openWorldContainer', { id: crate.id }), 'open supply crate');
      assert(opened.container.loot.some(row => row.id === 'pistol'), 'No issued pistol');
      ok(await call('lootWorldContainer', { id: crate.id, mode: 'all' }), 'take real equipment');
      assert.equal(fact('suppliesTaken'), 1);
      assert.equal(qty('pistol'), 1);
      assert.equal(qty('ammo9'), 24);
      const reopened = ok(await call('openWorldContainer', { id: crate.id }), 'reopen crate');
      assert.equal(reopened.container.loot.length, 0, 'Crate duplicated supplies');
      await equip('pistol'); await equip('leather', 'armor'); await equip('boots', 'boots');
      assert.equal(fact('equipmentWorn'), 1);
    } else if (step.id === 'reload') {
      const dummy = target();
      await moveNear(dummy.x, dummy.z - 6, 1, 'target firing line');
      const emptyShot = await call('enemyHit', shot(dummy));
      assert.equal(emptyShot.ok, false, 'Empty gun hit the target');
      assert.equal(fact('targetHit'), 0);
      const reserve = qty('ammo9');
      const loaded = await reload();
      assert(loaded.take > 0 && loaded.combat.loaded > 0);
      assert.equal(qty('ammo9'), reserve - loaded.take, 'Reload did not consume reserve ammunition');
      assert.equal(fact('weaponReloaded'), 1);
    } else if (step.id === 'range') {
      const dummy = target();
      await moveNear(dummy.x, dummy.z - 6, 1, 'target firing line');
      const miss = await call('enemyHit', shot(dummy, { shotDirX: 1, shotDirZ: 0 }));
      assert.equal(miss.ok, false, 'Shot away from target counted');
      assert.equal(fact('targetHit'), 0);
      const firedPayload = shot(dummy);
      const hit = await action('enemyHit', firedPayload);
      assert(hit.hit && hit.shots > 0 && hit.combat.loaded === 0, 'Target did not consume an actual bullet');
      assert.equal((await call('enemyHit', firedPayload)).ok, false, 'A shot token was reused');
      assert.equal(fact('targetHit'), 1);
      const npc = actors().find(row => row.kromkaOnboardingNpcId === step.npcId);
      assert.equal((await call('enemyHit', shot(npc))).ok, false, 'Peaceful instructor became damageable');
    } else if (step.id === 'cover') {
      await movementFrame(state().x, state().z, { moving: false, crouching: true });
      assert.equal(fact('coverUsed'), 0, 'Crouching far from cover counted');
      await moveNear(0, 12, 0.9, 'south side of cover');
      await movementFrame(state().x, state().z, { moving: false, crouching: true });
      await refresh();
      assert.equal(fact('coverUsed'), 1, 'Actual crouch behind cover was not recorded');
    } else if (step.id === 'first_aid') {
      const wounded = actors().find(row => row.kromkaOnboardingNpcId === 'yard_casualty_shurik');
      assert(wounded && wounded.hp < wounded.maxHp, 'Shurik must actually be injured');
      await moveNear(wounded.x, wounded.z, 2.3, 'wounded Shurik');
      const payload = { targetId: wounded.id, itemId: 'medkit' };
      assert.equal((await call('healPlayer', payload)).ok, false, 'Medicine worked without being held');
      await equip('medkit');
      const before = qty('medkit');
      const healed = await action('healPlayer', payload);
      assert(healed.healed > 0 && healed.enemy.hp > wounded.hp, 'NPC received no real healing');
      assert.equal(qty('medkit'), before - 1, 'Healing did not consume a medkit');
      assert.equal(fact('npcHealed'), 1);
    } else if (step.id === 'resources') {
      for (const [id, tool, x, z, key] of [['yard_ore', 'pickaxe', 21, 7, 'oreGathered'], ['yard_wood', 'axe', 23, -1, 'woodGathered']]) {
        await moveNear(x, z, 2, id);
        assert.equal((await call('harvestResource', { id, toolId: tool })).ok, false, 'Resource harvested without its held tool');
        await equip(tool);
        while (fact(key) < 2) {
          const harvested = await action('harvestResource', { id, toolId: tool });
          assert(harvested.item.qty > 0 && harvested.apCost > 0);
          await delay(350);
        }
      }
      assert(qty('ore') >= 2 && qty('wood') >= 2);
    } else if (step.id === 'craft_repair') {
      await moveNear(17, 5, 2.5, 'repair bench');
      const before = { ore: qty('ore'), wood: qty('wood'), silver: qty('silver') };
      const crafted = await action('craftingStationUsed', { recipeId: 'repairkitcraft', station: 'repair_bench',
        stationObjectId: 'yard_repair_bench', locationId: 'tutorialCaravanYard', fee: 1 });
      assert.equal(crafted.output.id, 'repairKit');
      assert.equal(qty('ore'), before.ore - 2); assert.equal(qty('wood'), before.wood - 2);
      assert.equal(qty('silver'), before.silver - 1);
      assert.equal(fact('kitCrafted'), 1);
    } else if (step.id === 'repair') {
      const before = qty('repairKit');
      const repaired = await action('inventoryItemAction', { action: 'repair', itemId: 'pistol' });
      assert.equal(repaired.mode, 'repairKit');
      assert(repaired.condition > 55, 'Weapon condition did not improve');
      assert.equal(qty('repairKit'), before - 1);
      assert.equal(fact('weaponRepaired'), 1);
      await equip('pistol');
      await reload();
    } else if (step.id === 'anomaly') {
      await moveNear(8, 0, 3, 'training anomaly');
      const bolt = ok(await call('throwBolt', { x: 8, z: 0 }), 'discharge training anomaly');
      assert(bolt.hit);
      await refresh(); assert.equal(fact('chimeDischarged'), 1);
    }
    await refresh();
    assert.equal(state().kromkaOnboarding.stepId, step.id, `${step.id}: practice must still be turned in through dialogue`);
  };
};
