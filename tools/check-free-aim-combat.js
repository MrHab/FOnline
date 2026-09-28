#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const harness = require('./check-combat-runtime');

function assert(condition, message, result) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(result)}`);
}

async function main() {
  const accounts = {};
  try {
    await harness.bootstrapCharacters(accounts);
    const locationFile = path.join(harness.DATA_DIR, 'locations', 'combatRuntimeArena.json');
    const location = JSON.parse(fs.readFileSync(locationFile, 'utf8'));
    const source = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'locations', 'oldDepot.json'), 'utf8'));
    const raider = source.objects.find(row => row.id === 'depot_raider_01');
    assert(raider, 'Missing test NPC template', null);
    const actor = (id, name, x, z) => ({
      ...raider, id, name, position: { x, y: 0, z },
      entity: { ...raider.entity, npcId: id, stationary: true, atk: 0, hp: 200 }
    });
    location.objects.push(
      actor('free_aim_front', 'Front interceptor', 0, -17),
      actor('free_aim_rear', 'Rear intended target', 0, -12),
      actor('free_aim_fog', 'Unselected fog target', 7, -17)
    );
    fs.writeFileSync(locationFile, JSON.stringify(location));
    const usersFile = path.join(harness.DATA_DIR, 'users.json');
    const savesFile = path.join(harness.DATA_DIR, 'saves.json');
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const saves = JSON.parse(fs.readFileSync(savesFile, 'utf8'));
    const meleeAccount = accounts.target;
    const meleeState = saves.characters[users.users[meleeAccount.login].id][meleeAccount.characterId].state;
    meleeState.player.x = 7;
    meleeState.player.z = -19;
    meleeState.equipment.weapon = 'knife';
    const coneAccount = accounts.untargeted;
    const coneState = saves.characters[users.users[coneAccount.login].id][coneAccount.characterId].state;
    coneState.inventory.shotgun = 1;
    coneState.inventory.shotgunShell = 12;
    coneState.equipment.weapon = 'shotgun';
    coneState.itemRuntime.shotgun = { baseId: 'shotgun', condition: 100, loaded: 3, createdAt: Date.now() };
    fs.writeFileSync(savesFile, JSON.stringify(saves));

    await harness.startServer();
    const shooter = accounts.cadence;
    await harness.connectAndJoin(shooter);
    const base = {
      weapon: 'laserPistol', mode: 'single',
      x: Number(shooter.join.x), z: Number(shooter.join.z),
      equipment: { weapon: 'laserPistol' }
    };
    const fire = async (targetX, targetZ) => {
      const token = `free_aim_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return harness.socketAck(shooter.socket, 'combatAttack', {
        ...base, targetX, targetZ, attackToken: token
      });
    };

    const intercepted = await fire(0, -12);
    assert(intercepted.ok && intercepted.enemy?.name === 'Front interceptor',
      'Shot passed through the first NPC', intercepted);
    await new Promise(resolve => setTimeout(resolve, 1200));
    const blind = await fire(7, -17);
    assert(blind.ok && blind.enemy?.name === 'Unselected fog target',
      'Free aim could not resolve an NPC without selecting it', blind);
    assert(Number(blind.combat?.loaded) === Number(intercepted.combat?.loaded) - 1,
      'Blind shot did not spend exactly one round', { intercepted, blind });
    harness.closeSocket(shooter);
    await harness.connectAndJoin(meleeAccount);
    const melee = await harness.socketAck(meleeAccount.socket, 'combatAttack', {
      weapon: 'knife', mode: 'single',
      x: Number(meleeAccount.join.x), z: Number(meleeAccount.join.z),
      targetX: 7, targetZ: -17,
      attackToken: `free_aim_melee_${Date.now()}`
    });
    assert(melee.ok && melee.enemy?.name === 'Unselected fog target',
      'Free melee swing did not resolve an unselected NPC', melee);
    await harness.connectAndJoin(coneAccount);
    const cone = await harness.socketAck(coneAccount.socket, 'combatAttack', {
      weapon: 'shotgun', mode: 'single',
      x: Number(coneAccount.join.x), z: Number(coneAccount.join.z),
      targetX: 0, targetZ: -12,
      attackToken: `free_aim_cone_${Date.now()}`
    });
    const coneNames = new Set((cone.enemyResults || []).map(row => row.enemy?.name));
    assert(cone.ok && coneNames.has('Front interceptor') && coneNames.has('Rear intended target'),
      'Shotgun cone omitted unselected NPCs', cone);
    assert(Number(cone.combat?.loaded) === 2, 'Shotgun cone spent more than one shell', cone);
    console.log('Free aim combat OK: first NPC intercepted a shot, unselected NPC resolved in fog for ranged and melee attacks, shotgun cone hit both NPCs and spent one shell.');
  } finally {
    for (const account of Object.values(accounts)) harness.closeSocket(account);
    await harness.stopServer();
    harness.cleanupSync();
  }
}

main().catch(error => {
  console.error(`Free aim combat check failed: ${error.message}`);
  console.error(harness.serverLogs().slice(-4000));
  process.exitCode = 1;
});
