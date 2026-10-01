#!/usr/bin/env node
'use strict';

// Места, стоящие площадкой прямо в зоне (src/server/zone-sites.js), на настоящем
// сервере. Берётся каждое безопасное место графа (overrides.sites с safe):
//   - сектор отдаёт строку площадки, портала в место и точки выхода из него нет;
//   - стоящий на островке видит его в self.zone.site, стоящий у входа — нет;
//   - шаг за черту — подсказка «безопасная зона» и прибытие в место для квеста
//     (цель type: "location" засчитывается входом, как раньше порталом);
//   - шаг обратно — подсказка о правилах зоны;
//   - именной житель места стоит на площадке;
//   - сохранение, сделанное в месте до переноса, просыпается в его секторе у места.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const { createLocationCollision, circleBlockerPenalty } = require('../src/server/location-collision');
const { normalizeSite, siteContains } = require('../src/server/zone-sites');

const root = path.resolve(__dirname, '..');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));
const graph = readJson('data', 'kromka', 'zone-graph.json');
const quests = readJson('data', 'kromka', 'quests.json');
const npcs = readJson('data', 'kromka', 'npcs.json');
const accounts = {};

const zone = graph.zones.find(row => (row.places || []).some(place => place.site && place.safe));
assert.ok(zone, 'no safe site in the zone graph yet (overrides.sites)');
const place = zone.places.find(row => row.site && row.safe);
const definition = readJson('data', 'zones', 'authored', `${zone.id}.json`);
const site = normalizeSite(definition.sites.find(row => row.id === place.locationId));
const { locationObjectBlockers } = createLocationCollision({ tile: 2 });
const blockers = (definition.objects || []).flatMap(row => locationObjectBlockers(row));
const clear = (x, z) => blockers.every(blocker => circleBlockerPenalty(x, z, 0.8, blocker) <= 0);

// Свободная точка площадки у её центра и точка входа снаружи — узел тропы к месту.
function freeSpot(inside) {
  for (let ring = 0; ring < 40; ring++) {
    for (let step = 0; step < Math.max(1, ring * 8); step++) {
      const angle = step / Math.max(1, ring * 8) * Math.PI * 2;
      const x = site.x + Math.cos(angle) * ring * 0.5;
      const z = site.z + Math.sin(angle) * ring * 0.5;
      if (inside(x, z) && clear(x, z)) return { x, z };
    }
  }
  throw new Error(`${site.id}: no free spot on the site`);
}
const insideSpot = freeSpot((x, z) => siteContains(site, x, z, -2));
const approachNode = (definition.zone?.nav?.nodes || []).find(node => node.id === `place_${site.id}`);
assert.ok(approachNode, `${zone.id}: the zone trail must still lead to ${site.id}`);
const outsideSpot = zoneWalk.world(approachNode);
assert.ok(!siteContains(site, outsideSpot.x, outsideSpot.z), 'the trail ends outside the safe line');

// Цель квеста, которую засчитывает прибытие в это место.
const allQuests = [...(quests.campaign || []), ...(quests.factionQuests || []), ...(quests.mechanicQuests || []), ...(quests.personalQuests || [])];
const bound = Object.entries(quests.objectiveBindings || {})
  .filter(([, binding]) => binding.type === 'location' && !binding.required && (binding.locationIds || []).includes(site.id))
  .map(([objective]) => objective);
const quest = allQuests.find(row => bound.includes((row.objectives || [])[0]));
const resident = (npcs.npcs || []).find(npc => npc.homeLocationId === site.id);

const getJson = route => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + route, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(body) }); } catch (error) { reject(error); } });
  }).on('error', reject);
});

function editSave(role, edit) {
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  edit(saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state);
  fs.writeFileSync(savesPath, JSON.stringify(saves));
}

function collect(socket, event) {
  const rows = [];
  socket.on(event, payload => rows.push(payload));
  return rows;
}

(async () => {
  await h.bootstrapCharacters(accounts);
  zoneWalk.placeInZone(h, accounts, 'target', zone.id, insideSpot);
  zoneWalk.placeInZone(h, accounts, 'progression', zone.id, outsideSpot);
  if (quest) editSave('progression', state => {
    state.kromkaQuestState = { ...(state.kromkaQuestState || {}), active: { [quest.id]: { objectiveIndex: 0, startedAt: 1 } } };
  });
  // Сохранение из прежней локации места.
  editSave('untargeted', state => {
    state.currentLocationId = site.id;
    state.player = { ...(state.player || {}), x: 0, z: -20 };
    state.globalMap = { ...(state.globalMap || {}), onWorldMap: false };
    delete state.serverLocationContext;
  });

  await h.startServer();
  try {
    const served = await getJson(`/api/locations/${zone.id}`);
    assert.equal(served.status, 200);
    const sector = served.json.location || served.json;
    assert.ok((sector.sites || []).some(row => row.id === site.id && row.safe === true), 'the sector serves its site row');
    assert.ok(!(sector.transitions || []).some(row => row.to === site.id), 'no portal leads into the site');
    assert.ok(!sector[`entryFromPlace_${site.id}`.slice(0, 32)], 'no exit point from the site any more');

    const inside = accounts.target;
    await h.connectAndJoin(inside);
    assert.equal(inside.join.locationId, zone.id);
    assert.equal(inside.join.self.zone?.site?.id, site.id, 'a player on the island sees it in self.zone.site');
    assert.equal(inside.join.self.zone.site.safe, true);
    if (resident) {
      const actor = (inside.join.worldState?.enemies || []).find(row => row.kromkaNamedNpcId === resident.id || row.npcId === resident.id || row.id === resident.id);
      assert.ok(actor, `${resident.id} lives on the site`);
      assert.ok(siteContains(site, Number(actor.x), Number(actor.z), 1), `${resident.id} stands on the site (${actor.x}, ${actor.z})`);
    }

    const walker = accounts.progression;
    await h.connectAndJoin(walker);
    assert.equal(walker.join.self.zone?.site ?? null, null, 'at the trail end the player is outside the line');
    const notices = collect(walker.socket, 'dangerCellNotice');
    const states = collect(walker.socket, 'authoritativePlayerState');
    const position = { x: Number(walker.join.self.x), z: Number(walker.join.self.z) };
    assert.ok(await zoneWalk.driveTo(h, walker, position, insideSpot.x, insideSpot.z, 400), 'the trail leads through the gate onto the island');
    await zoneWalk.delay(200);
    assert.ok(notices.some(row => String(row.text).includes(site.name) && String(row.text).includes('безопасная зона')),
      'stepping over the line names the safe island: ' + JSON.stringify(notices));
    const entered = states.find(row => row.reason === 'site');
    assert.equal(entered?.zone?.site?.id, site.id, 'the new self.zone.site arrives with the step');
    if (quest) {
      assert.ok((entered.questProgress || []).some(row => row.questId === quest.id), `arriving counts for ${quest.id}`);
    }
    assert.ok(await zoneWalk.driveTo(h, walker, position, outsideSpot.x, outsideSpot.z, 400), 'and back out');
    await zoneWalk.delay(200);
    assert.ok(notices.some(row => String(row.text).includes('Вы вышли за черту')), 'leaving the island warns about the zone rules');

    const migrated = accounts.untargeted;
    await h.connectAndJoin(migrated);
    assert.equal(migrated.join.locationId, zone.id, 'a save made inside the former place wakes in its zone');
    assert.ok(Math.hypot(Number(migrated.join.self.x) - site.x, Number(migrated.join.self.z) - site.z) < 60, 'near the site');
    console.log(`Zone sites network OK: ${site.name} (${site.id}) in ${zone.title}: the sector serves the site without a portal, the island shows in self.zone, `
      + `stepping in names it${quest ? ` and counts ${quest.id}` : ''}, stepping out warns, `
      + `${resident ? `${resident.id} lives there, ` : ''}an old save wakes beside it.`);
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
  }
})().catch(error => {
  console.error(`Zone sites network check failed: ${error?.stack || error}`);
  const logs = h.serverLogs().trim();
  if (logs) console.error(logs.slice(-4000));
  process.exitCode = 1;
});
