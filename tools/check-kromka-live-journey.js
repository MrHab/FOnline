#!/usr/bin/env node
'use strict';

const assert = require('assert');
const http = require('http');
const { io: createSocketClient } = require('socket.io-client');

const port = Number(process.env.KROMKA_QA_PORT || 3000);
const login = String(process.env.KROMKA_QA_LOGIN || '');
const password = String(process.env.KROMKA_QA_PASSWORD || '');
const deviceId = String(process.env.KROMKA_QA_DEVICE || 'kromka_live_journey_device');
const clientInstanceId = String(process.env.KROMKA_QA_CLIENT || 'kromka_live_journey_client');
const characterId = String(process.env.KROMKA_QA_CHARACTER || 'qa_campaign_journey');
const journeyScope = String(process.env.KROMKA_QA_SCOPE || 'all');
const characterName = String(process.env.KROMKA_QA_NAME || 'Путник Испытатель');
const world = require('../data/generated/kromka/world.json');
const onboarding = require('../data/kromka/onboarding.json');
const questCatalog = require('../data/kromka/quests.json');
const npcCatalog = require('../data/kromka/npcs.json');
const kromkaLocationCatalog = require('../data/kromka/locations.json');
const locationCatalog = Object.fromEntries((world.nodes || [])
  .map(node => String(node.locationId || node.id || ''))
  .filter(Boolean)
  .map(id => [id, require(`../data/locations/${id}.json`)]));

assert(login && password, 'Set KROMKA_QA_LOGIN and KROMKA_QA_PASSWORD.');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = (pathname, options = {}) => new Promise((resolve, reject) => {
  const body = options.json ? JSON.stringify(options.json) : '';
  const headers = { ...(options.headers || {}) };
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method: options.method || 'GET', headers, timeout: 5000 }, res => {
    let responseBody = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { responseBody += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, json: responseBody ? JSON.parse(responseBody) : {} }));
  });
  req.on('timeout', () => req.destroy(new Error(`HTTP timeout: ${pathname}`)));
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

const ack = (socket, event, payload = {}, timeoutMs = 8000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), timeoutMs);
  socket.emit(event, payload, result => {
    clearTimeout(timer);
    resolve(result || {});
  });
});

function assertOk(result, label) {
  assert(result?.ok, `${label}: ${result?.error || JSON.stringify(result)}`);
  return result;
}

function worldPoint(locationId) {
  const node = (world.nodes || []).find(row => String(row.locationId || row.id || '') === locationId);
  assert(node, `Global map point is missing: ${locationId}`);
  return { x: Number(node.x), y: Number(node.y) };
}

function questRow(self, questId) {
  const journal = self?.kromkaQuestJournal || {};
  for (const section of ['campaign', 'mechanic', 'personal']) {
    const row = (journal[section] || []).find(entry => entry.id === questId);
    if (row) return row;
  }
  for (const rows of Object.values(journal.factions || {})) {
    const row = (rows || []).find(entry => entry.id === questId);
    if (row) return row;
  }
  return null;
}

function assertQuestDialogue(self, questId, state) {
  const expected = String(questCatalog.questDialogues?.[questId]?.[state] || '');
  assert(expected, `${questId}: authored ${state} dialogue is missing.`);
  assert.equal(questRow(self, questId)?.dialogue, expected, `${questId}: ${state} dialogue did not reach the real client state.`);
}

function questGiverNpc(quest = {}) {
  const owner = String(quest.giverNpcId || quest.npcId || '');
  const npc = (npcCatalog.npcs || []).find(row => [row.id, ...(row.questAliases || [])].map(String).includes(owner));
  assert(npc, `${quest.id}: world NPC for giver ${owner} is missing.`);
  return npc;
}

async function connect() {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'], forceNew: true, reconnection: false, timeout: 5000
    });
    const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 7000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
  });
}

(async () => {
  const auth = await request('/api/auth/login', {
    method: 'POST',
    json: { login, password, deviceId, deviceType: 'desktop', controlType: 'keyboard_mouse' }
  });
  assert.equal(auth.status, 200, `QA login failed: ${JSON.stringify(auth.json)}`);
  const token = auth.json.token;
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Device-Id': deviceId,
    'X-Client-Instance-Id': clientInstanceId,
    'X-Device-Type': 'desktop',
    'X-Control-Type': 'keyboard_mouse'
  };
  const locations = await request('/api/locations', { headers });
  assert.equal(locations.status, 200, 'Could not load the Unity location catalog.');
  assert.equal(locations.json.locations?.[onboarding.tutorialLocationId]?.allowGlobalMapExit, false,
    'Unity location catalog exposed a global-map exit in the tutorial yard.');
  const list = await request('/api/characters', { headers });
  assert.equal(list.status, 200, 'Could not list QA characters.');
  if ((list.json.characters || []).some(row => row.id === characterId)) {
    const removed = await request(`/api/characters/${encodeURIComponent(characterId)}`, {
      method: 'DELETE', headers, json: { confirmCharacterId: characterId }
    });
    assert.equal(removed.status, 200, `Could not reset QA character: ${JSON.stringify(removed.json)}`);
  }

  const socket = await connect();
  let self = null;
  let sequence = 1;
  let enemies = [];
  let containers = [];
  let currentLocationId = '';
  let worldMap = [];
  let latestWorldTransfer = null;
  const navigationBlocks = new Map();
  socket.on('authoritativePlayerState', payload => { if (payload) self = payload; });
  socket.on('enemySnapshot', payload => {
    if (Array.isArray(payload?.enemies)) enemies = payload.enemies;
  });
  socket.on('worldContainersSnapshot', payload => { if (Array.isArray(payload?.containers)) containers = payload.containers; });
  socket.on('worldState', payload => {
    if (Array.isArray(payload?.map)) worldMap = payload.map;
  });
  socket.on('serverWorldTransfer', payload => { latestWorldTransfer = payload || null; });

  const update = result => {
    if (result?.self) self = result.self;
    if (Array.isArray(result?.worldState?.map)) worldMap = result.worldState.map;
    if (result?.locationId) currentLocationId = result.locationId;
    else if (result?.self?.locationId) currentLocationId = result.self.locationId;
    return result;
  };
  const refresh = async () => update(await ack(socket, 'state', { profileOnly: true }));
  const movementFrame = async (x, z, extra = {}) => {
    const dx = x - Number(self?.x || 0);
    const dz = z - Number(self?.z || 0);
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const result = await ack(socket, 'state', {
      seq: sequence++, x, z,
      angle: Math.atan2(dx, dz), moving: extra.moving !== false,
      turning: false, crouching: extra.crouching === true,
      vx: 5.5 * dx / length, vz: 5.5 * dz / length
    });
    update(result);
    await delay(58);
    return result;
  };
  const driveTo = async (x, z, radius = 1.25, maxFrames = 180) => {
    let stalled = 0;
    let previous = Infinity;
    for (let frame = 0; frame < maxFrames; frame++) {
      const distance = Math.hypot(Number(self?.x || 0) - x, Number(self?.z || 0) - z);
      if (distance <= radius) return true;
      await movementFrame(x, z);
      const next = Math.hypot(Number(self?.x || 0) - x, Number(self?.z || 0) - z);
      stalled = next >= previous - 0.015 ? stalled + 1 : 0;
      previous = next;
      if (stalled >= 14) return false;
    }
    return false;
  };
  const worldToTile = (x, z) => ({ tx: Math.floor(Number(x) / 2 + 19), tz: Math.floor(Number(z) / 2 + 19) });
  const tileToWorld = (tx, tz) => ({ x: (tx - 19 + 0.5) * 2, z: (tz - 19 + 0.5) * 2 });
  const navigationPath = (targetX, targetZ, targetRadius = 0) => {
    if (!Array.isArray(worldMap) || !worldMap.length) return [];
    const height = worldMap.length;
    const width = Math.max(0, ...worldMap.map(row => Array.isArray(row) ? row.length : 0));
    const start = worldToTile(self?.x, self?.z);
    const blocked = navigationBlocks.get(currentLocationId) || new Set();
    navigationBlocks.set(currentLocationId, blocked);
    const solid = new Set([1, 3, 6, 7, 8]);
    const key = (tx, tz) => `${tx},${tz}`;
    const open = (tx, tz) => tx >= 1 && tz >= 1 && tx < width - 1 && tz < height - 1
      && Array.isArray(worldMap[tz]) && !solid.has(Number(worldMap[tz][tx]))
      && !blocked.has(key(tx, tz));
    const closeEnough = node => {
      const point = tileToWorld(node.tx, node.tz);
      return Math.hypot(point.x - targetX, point.z - targetZ) <= Math.max(0.72, Number(targetRadius || 0));
    };
    const queue = [start];
    const previous = new Map([[key(start.tx, start.tz), null]]);
    let reached = null;
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index];
      if (closeEnough(node)) { reached = node; break; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { tx: node.tx + dx, tz: node.tz + dz };
        const nextKey = key(next.tx, next.tz);
        if (previous.has(nextKey) || !open(next.tx, next.tz)) continue;
        previous.set(nextKey, node);
        queue.push(next);
      }
    }
    if (!reached) return [];
    const reverse = [];
    for (let node = reached; node; node = previous.get(key(node.tx, node.tz))) reverse.push(node);
    return reverse.reverse();
  };
  const moveNear = async (x, z, radius = 1.25, label = 'target') => {
    if (await driveTo(x, z, radius, 90)) return;
    // Dynamic actors and doors can vacate a tile between objectives. Keep
    // discovered blocks only for this route so a temporary obstruction does
    // not make a later NPC or exit permanently unreachable in the QA run.
    const blocked = new Set();
    navigationBlocks.set(currentLocationId, blocked);
    for (let replan = 0; replan < 140; replan++) {
      const path = navigationPath(x, z, radius);
      if (!path.length) break;
      let routeBlocked = false;
      for (const tile of path.slice(1)) {
        const point = tileToWorld(tile.tx, tile.tz);
        if (await driveTo(point.x, point.z, 0.72, 40)) continue;
        blocked.add(`${tile.tx},${tile.tz}`);
        routeBlocked = true;
        break;
      }
      if (!routeBlocked && await driveTo(x, z, radius, 90)) return;
      if (Math.hypot(Number(self?.x || 0) - x, Number(self?.z || 0) - z) <= radius) return;
    }
    assert.fail(`${label}: could not reach ${x},${z}; stopped at ${self?.x},${self?.z}; dynamically blocked tiles=${blocked.size}`);
  };

  const joined = assertOk(await ack(socket, 'join', {
    token, deviceId, clientInstanceId, deviceType: 'desktop', controlType: 'keyboard_mouse',
    characterId, name: characterName,
    appearance: { schema: 'realm.character-appearance.v1', sex: 'male', bodyType: 'medium', faceId: 'male_01', hairId: 'short_crop', skinToneId: 'skin_03', hairColorId: 'hair_01' },
    special: { str: 5, per: 7, end: 6, cha: 5, int: 5, agi: 7, luck: 5 },
    traits: ['trainedEye', 'scavengerStart'], taggedSkills: ['lightWeapons', 'stealth']
  }), 'create and join QA character');
  update(joined);
  assert.equal((self.inventory || []).length, 0, 'New character started with equipment instead of collecting it');
  assert.equal(self.equipment.weapon, 'fists');
  currentLocationId = joined.locationId;
  assert.equal(self?.name, characterName, 'Unicode QA character name was corrupted.');
  console.log(`CHARACTER ${characterName} (${characterId}) created in ${currentLocationId}`);

  const tutorialExit = await ack(socket, 'globalTravelEnterWorld', {});
  assert.equal(tutorialExit.ok, false, 'Tutorial yard allowed a direct global-map exit request.');
  assert.match(String(tutorialExit.error || ''), /после завершения обучения/i,
    'Tutorial yard returned the wrong global-map exit rejection.');
  assert.equal(currentLocationId, onboarding.tutorialLocationId,
    'Rejected global-map exit moved the player out of the tutorial yard.');

  const performOnboardingAction = async (step, choiceId = '', expectBlocked = false) => {
    let actor = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      actor = enemies.find(row => row.kromkaOnboardingNpcId === step.npcId && !row.dead);
      if (actor) break;
      await delay(100);
    }
    assert(actor, `onboarding ${step.id}: NPC ${step.npcId} was not spawned.`);
    assert.equal(actor.kromkaOnboardingProtected, true,
      `onboarding ${step.id}: story NPC ${step.npcId} is not protected from removal.`);
    if (step.npcId === 'ambush_guide') {
      const authoredNpc = onboarding.npcs.find(row => row.id === step.npcId);
      assert(authoredNpc, `onboarding ${step.id}: guide Asya has no authored exit anchor.`);
      assert(Math.hypot(Number(actor.x) - Number(authoredNpc.x), Number(actor.z) - Number(authoredNpc.z)) <= 0.05,
        `onboarding ${step.id}: guide Asya moved away from the exit anchor (${actor.x},${actor.z}).`);
    }
    await moveNear(Number(actor.x), Number(actor.z), 2.4, `onboarding NPC ${step.npcId}`);
    assertOk(await ack(socket, 'npcDialogueFocus', { enemyId: actor.id, active: true }), `talk to onboarding NPC ${step.npcId}`);
    const result = await ack(socket, 'kromkaOnboardingAction', {
      action: step.action,
      choiceId,
      enemyId: actor.id
    });
    if (expectBlocked) {
      assert.equal(result.ok, false, `${step.id}: dialogue completed an unperformed mechanic`);
      await ack(socket, 'npcDialogueFocus', { enemyId: actor.id, active: false });
      await refresh();
      assert.equal(self.kromkaOnboarding.stepId, step.id);
      return result;
    }
    assertOk(result, `onboarding ${step.id}`);
    update(result);
    if (step.cinematicId) {
      await delay(20);
      assert.equal(result.transition?.cinematicId, step.cinematicId,
        `onboarding ${step.id}: acknowledgement lost its cinematic id.`);
      assert.equal(latestWorldTransfer?.cinematicId, step.cinematicId,
        `onboarding ${step.id}: world transfer lost its cinematic id.`);
      assert.equal(latestWorldTransfer?.locationId, onboarding.firstMissionLocationId,
        `onboarding ${step.id}: cinematic transfer entered the wrong location.`);
      const invalidFinish = await ack(socket, 'kromkaOnboardingAction', {
        action: 'finish_cinematic', cinematicId: 'wrong-cinematic'
      });
      assert.equal(invalidFinish.ok, false, 'an unrelated cinematic must not release protection');
      const objectiveBeforeFinish = self?.kromkaOnboarding?.step?.id;
      for (let replay = 0; replay < 2; replay++) {
        assertOk(await ack(socket, 'kromkaOnboardingAction', {
          action: 'finish_cinematic', cinematicId: step.cinematicId
        }), 'finish/skip cinematic idempotently');
      }
      assert.equal(self?.kromkaOnboarding?.step?.id, objectiveBeforeFinish,
        'finishing a cinematic must not complete a quest objective');
    }
    await ack(socket, 'npcDialogueFocus', { enemyId: actor.id, active: false });
    await refresh();
    return result;
  };

  const practice = require('./check-practical-onboarding-steps')({
    call: async (event, payload) => update(await ack(socket, event, payload)),
    state: () => self, actors: () => enemies, containers: () => containers,
    moveNear, movementFrame, refresh, delay
  });
  for (const step of onboarding.tutorial.steps) {
    if (step.requirements?.length) await performOnboardingAction(step, '', true);
    await practice(step);
    await performOnboardingAction(step);
    if (step.id === 'equipment') {
      const evidence = JSON.stringify(self.kromkaOnboarding.evidence);
      socket.disconnect();
      await delay(600);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Tutorial reconnect timed out')), 6000);
        socket.once('connect', () => { clearTimeout(timer); resolve(); });
        socket.connect();
      });
      update(assertOk(await ack(socket, 'join', { token, deviceId, clientInstanceId,
        characterId, name: characterName, deviceType: 'desktop', controlType: 'keyboard_mouse' }), 'resume tutorial'));
      assert.equal(JSON.stringify(self.kromkaOnboarding.evidence), evidence, 'Practice evidence was lost on reconnect');
      assert.equal(self.kromkaOnboarding.stepId, 'reload', 'Reconnect reset the current lesson');
    }
    console.log(`PRACTICE ${step.id}: real action checked; dialogue turn-in accepted`);
  }
  assert.equal(currentLocationId, onboarding.firstMissionLocationId, 'Tutorial did not transfer into the first mission.');
  const prologueExit = await ack(socket, 'globalTravelEnterWorld', {});
  assert.equal(prologueExit.ok, false, 'Broken Tract allowed a direct global-map exit during the prologue.');
  assert.match(String(prologueExit.error || ''), /пролога/i,
    'Broken Tract returned the wrong prologue exit rejection.');
  assert.equal(currentLocationId, onboarding.firstMissionLocationId,
    'Rejected global-map exit moved the player out of Broken Tract.');
  console.log('TUTORIAL complete; caravan ambush entered');

  for (const step of onboarding.firstMission.steps) {
    if (step.action === 'cross_ambush_anomaly') {
      await moveNear(step.x, step.z, 3, `first mission ${step.id}`);
      const bolt = assertOk(await ack(socket, 'throwBolt', { x: step.x, z: step.z }), `first mission ${step.id} bolt`);
      assert(bolt.hit, 'Ambush bolt did not discharge the visible anomaly.');
      assert.equal(bolt.anomaly?.id, 'twelve-seam-01', 'The prologue bolt discharged the wrong anomaly.');
      assert.equal(bolt.anomaly?.permanentlyDischarged, true,
        'The prologue Seam did not enter its permanent discharged state.');
      await delay(4000);
      await performOnboardingAction(step);
    } else if (step.action === 'reach_keys') {
      await moveNear(5, 28, 1.2, 'prologue north boundary approach');
      for (let frame = 0; frame < 32; frame++) await movementFrame(5, 40);
      assert(Number(self?.z || 0) <= 33.55,
        `Broken Tract movement escaped its locked north boundary at z=${self?.z}.`);
      await performOnboardingAction(step, step.choices?.[0]?.id || '');
    } else {
      await performOnboardingAction(step, step.choices?.[0]?.id || '');
    }
  }
  assert.equal(currentLocationId, onboarding.arrivalLocationId, 'First mission did not arrive in Keys.');
  assert.equal(self.kromkaOnboarding?.phase, 'complete', 'Onboarding state did not complete.');
  assert(questRow(self, 'campaign_prologue_twelfth')?.status === 'completed', 'Campaign prologue was not recorded.');
  console.log('FIRST MISSION complete; Keys reached and prologue recorded');

  if (journeyScope === 'onboarding') {
    console.log('ONBOARDING JOURNEY PASSED: departure, private ambush and arrival at Keys');
    socket.close();
    return;
  }

  const waitForNpc = async npcId => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const actor = enemies.find(row => row.kromkaNamedNpcId === npcId && !row.dead);
      if (actor) return actor;
      await delay(100);
    }
    assert.fail(`${currentLocationId}: named NPC ${npcId} was not spawned.`);
  };
  const approachNpc = async npcId => {
    let actor = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      actor = await waitForNpc(npcId);
      // Friendly actors have physical capsules and may follow a daily routine.
      // Stop inside the authoritative range, then reacquire their live position.
      await moveNear(Number(actor.x), Number(actor.z), 4, `NPC ${npcId}`);
      await delay(80);
      const fresh = enemies.find(row => row.kromkaNamedNpcId === npcId && !row.dead) || actor;
      const distance = Math.hypot(Number(fresh.x || 0) - Number(self?.x || 0), Number(fresh.z || 0) - Number(self?.z || 0));
      actor = fresh;
      if (distance <= 5.5) return actor;
    }
    assert.fail(`NPC ${npcId}: live position could not be approached; stopped at ${self?.x},${self?.z}.`);
  };
  const openNpcDialogue = async (npcId, label) => {
    let last = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      let actor = await waitForNpc(npcId);
      if (attempt === 0) {
        actor = await approachNpc(npcId);
      } else {
        const angle = (attempt - 1) * Math.PI * 2 / 11;
        const point = {
          x: Number(actor.x || 0) + Math.cos(angle) * 3.2,
          z: Number(actor.z || 0) + Math.sin(angle) * 3.2
        };
        try { await moveNear(point.x, point.z, 0.85, `visible approach to NPC ${npcId}`); } catch (_) { continue; }
      }
      last = await ack(socket, 'npcDialogueFocus', { enemyId: actor.id, active: true });
      if (last.ok) return { actor, result: last };
      if (!/(ближе|препятствием)/i.test(String(last.error || ''))) assertOk(last, label);
    }
    assertOk(last, label);
  };
  const startQuest = async (questId, npcId) => {
    assert.equal(questRow(self, questId)?.status, 'available', `${questId} was not available before its NPC briefing.`);
    assertQuestDialogue(self, questId, 'briefing');
    const { actor } = await openNpcDialogue(npcId, `open quest dialogue ${npcId}`);
    const result = assertOk(await ack(socket, 'kromkaQuestAction', {
      requestId: `qa_start_${questId}_${Date.now()}`, mode: 'start', questId, enemyId: actor.id, outcomeId: ''
    }), `start ${questId}`);
    update(result);
    await ack(socket, 'npcDialogueFocus', { enemyId: actor.id, active: false });
    assert.equal(questRow(self, questId)?.status, 'active', `${questId} did not become active.`);
    assertQuestDialogue(self, questId, 'progress');
  };
  const turnInQuest = async (questId, npcId) => {
    assert.equal(questRow(self, questId)?.status, 'turnin', `${questId} was not ready for its NPC resolution.`);
    assertQuestDialogue(self, questId, 'resolution');
    const { actor } = await openNpcDialogue(npcId, `open turn-in dialogue ${npcId}`);
    const result = assertOk(await ack(socket, 'kromkaQuestAction', {
      requestId: `qa_turnin_${questId}_${Date.now()}`, mode: 'turnin', questId, enemyId: actor.id, outcomeId: ''
    }), `turn in ${questId}`);
    update(result);
    await ack(socket, 'npcDialogueFocus', { enemyId: actor.id, active: false });
    assert.equal(questRow(self, questId)?.status, 'completed', `${questId} did not complete after turn-in.`);
    assertQuestDialogue(self, questId, 'after');
  };
  const chooseQuestOutcomeAtNpc = async (questId, npcId, outcomeId) => {
    assert.equal(questRow(self, questId)?.status, 'choice', `${questId}: outcome dialogue is not ready.`);
    assertQuestDialogue(self, questId, 'resolution');
    const { actor } = await openNpcDialogue(npcId, `resolve ${questId}`);
    const result = assertOk(await ack(socket, 'kromkaQuestAction', {
      requestId: `qa_outcome_${questId}_${Date.now()}`,
      mode: 'outcome', questId, enemyId: actor.id, outcomeId
    }), `resolve ${questId}`);
    update(result);
    await ack(socket, 'npcDialogueFocus', { enemyId: actor.id, active: false });
    assert.equal(questRow(self, questId)?.status, 'completed', `${questId}: outcome did not complete the quest.`);
    assertQuestDialogue(self, questId, 'after');
  };
  const talkTo = async (npcId, expectedObjective = '') => {
    const { actor, result } = await openNpcDialogue(npcId, `talk to ${npcId}`);
    update(result);
    if (expectedObjective) {
      assert((result.questProgress || []).some(row => row.objective === expectedObjective), `${npcId} did not advance ${expectedObjective}.`);
    }
    await ack(socket, 'npcDialogueFocus', { enemyId: actor.id, active: false });
    return result;
  };
  const useQuestObject = async (locationId, objectId, expectedObjective, expectedPartial = false) => {
    assert.equal(currentLocationId, locationId, `${objectId}: wrong location.`);
    const row = (locationCatalog[locationId].objects || []).find(object => object.id === objectId);
    assert(row?.position, `${objectId}: authored position missing.`);
    await moveNear(Number(row.position.x), Number(row.position.z), 2.5, `quest object ${objectId}`);
    const result = assertOk(await ack(socket, 'kromkaQuestObjectInteract', { objectId }), `use ${objectId}`);
    update(result);
    const progress = (result.questProgress || []).find(entry => entry.objective === expectedObjective);
    assert(progress, `${objectId} did not advance ${expectedObjective}.`);
    assert.equal(progress.partial === true, expectedPartial, `${objectId}: partial state mismatch.`);
    return result;
  };
  const exitToWorld = async () => {
    const loc = locationCatalog[currentLocationId] || {};
    const preferred = loc.exit?.x != null
      ? { x: Number(loc.exit.x), z: Number(loc.exit.z) }
      : { x: 0, z: -35 };
    const candidates = [preferred, { x: -35, z: 0 }, { x: 35, z: 0 }, { x: 0, z: 35 }];
    let result = null;
    for (const point of candidates) {
      try { await moveNear(point.x, point.z, 1.4, `exit ${currentLocationId}`); } catch (_) { continue; }
      result = await ack(socket, 'globalTravelEnterWorld', {});
      if (result.ok) break;
    }
    assertOk(result, `exit ${currentLocationId} to global map`);
    self.onGlobalMap = true;
  };
  const travelTo = async locationId => {
    if (currentLocationId === locationId) return;
    await exitToWorld();
    const point = worldPoint(locationId);
    const travel = assertOk(await ack(socket, 'globalTravelStart', {
      worldPoint: point, targetLocationId: locationId, siteId: locationId
    }), `travel to ${locationId}`);
    console.log(`TRAVEL ${currentLocationId} -> ${locationId}: ${(travel.durationMs / 1000).toFixed(1)}s`);
    await delay(Math.max(150, Number(travel.durationMs || 0) + 550));
    const arrived = assertOk(await ack(socket, 'globalTravelArrive', {
      worldPoint: point, targetLocationId: locationId, siteId: locationId
    }), `arrive at ${locationId}`);
    assert(!arrived.stayOnWorldMap, `${locationId}: destination resolved as empty world point.`);
    enemies = [];
    const changed = assertOk(await ack(socket, 'changeLocation', {
      locationId,
      worldZoneId: arrived.worldZoneId || '', partyId: arrived.partyId || '',
      siteId: arrived.siteId || '', encounterId: arrived.encounterId || ''
    }), `enter ${locationId}`);
    update(changed);
    currentLocationId = locationId;
    await delay(250);
  };

  const arriveForQuest = async locationId => {
    if (currentLocationId === locationId) {
      const detour = locationId === 'settlement' ? 'roadOutpost' : 'settlement';
      await travelTo(detour);
    }
    await travelTo(locationId);
  };

  const completeConditionedObjective = async (questId, objectiveId) => {
    const binding = questCatalog.objectiveBindings?.[objectiveId] || {};
    const required = Math.max(1, Number(binding.required || 1));
    if (binding.type === 'location') {
      const targets = [binding.locationId, ...(binding.locationIds || [])].filter(Boolean).slice(0, required);
      assert.equal(targets.length, required, `${questId}/${objectiveId}: not enough location conditions.`);
      for (const locationId of targets) await arriveForQuest(String(locationId));
    } else if (binding.type === 'dialogue' || binding.type === 'allies') {
      const targets = (binding.npcIds || []).slice(0, required);
      assert.equal(targets.length, required, `${questId}/${objectiveId}: not enough dialogue conditions.`);
      for (const npcId of targets) {
        const npc = (npcCatalog.npcs || []).find(row => String(row.id || '') === String(npcId));
        assert(npc, `${questId}/${objectiveId}: NPC ${npcId} is missing.`);
        await travelTo(String(npc.homeLocationId));
        await talkTo(String(npcId), objectiveId);
      }
    } else if (binding.type === 'object' || binding.type === 'objects') {
      await travelTo(String(binding.locationId));
      const targets = (binding.objectIds || []).slice(0, required);
      assert.equal(targets.length, required, `${questId}/${objectiveId}: not enough quest objects.`);
      for (let index = 0; index < targets.length; index++) {
        await useQuestObject(String(binding.locationId), String(targets[index]), objectiveId, index < required - 1);
      }
    } else if (binding.type === 'anomaly') {
      const location = (kromkaLocationCatalog.locations || []).find(row => (row.anomalyFields || [])
        .some(field => (binding.anomalyTypes || []).includes(String(field.type || ''))));
      const field = (location?.anomalyFields || []).find(row => (binding.anomalyTypes || []).includes(String(row.type || '')));
      assert(location && field, `${questId}/${objectiveId}: authored anomaly condition is missing.`);
      await travelTo(String(location.id));
      await moveNear(Number(field.x), Number(field.z), 3, `${objectiveId} anomaly`);
      const bolt = assertOk(await ack(socket, 'throwBolt', { x: field.x, z: field.z }), `${objectiveId} bolt`);
      assert(bolt.hit, `${questId}/${objectiveId}: bolt did not hit the authored anomaly.`);
      await refresh();
    } else {
      assert.fail(`${questId}/${objectiveId}: live journey cannot perform condition type ${binding.type}.`);
    }
    const row = questRow(self, questId);
    assert(row?.currentObjective !== objectiveId || row?.status !== 'active', `${questId}/${objectiveId}: world condition did not advance.`);
  };

  const assertAktovBaseUnlocked = async () => {
    const baseState = assertOk(await ack(socket, 'requestPersonalBaseState'), 'request personal base after Aktov quest');
    assert.equal(baseState.state?.available, true, 'Aktov quest completed, but the personal base is still unavailable.');
    assert.equal(baseState.state?.rights?.granted, true, 'Aktov quest did not grant personal-base rights.');
    assert.equal(baseState.state?.rights?.questId, 'personal_aktov_air_rights', 'Personal-base rights were not attributed to Aktov quest.');
    assert.equal(baseState.state?.rights?.outcomeId, 'official', 'Personal-base rights did not preserve the selected quest outcome.');
    console.log('PERSONAL BASE unlocked by Aktov quest and confirmed through authoritative state');
  };

  if (journeyScope === 'aktov_base') {
    const quest = (questCatalog.personalQuests || []).find(row => row.id === 'personal_aktov_air_rights');
    const giver = questGiverNpc(quest);
    await travelTo(String(giver.homeLocationId));
    await startQuest(quest.id, String(giver.id));
    await travelTo('balanceBunker');
    assert.equal(questRow(self, quest.id)?.objectiveProgressCurrent, 1, 'First law archive did not record 1/3 progress.');
    await travelTo('settlement');
    await travelTo('balanceBunker');
    assert.equal(questRow(self, quest.id)?.objectiveProgressCurrent, 1, 'Repeated law archive counted twice.');
    await travelTo('oldDepot');
    assert.equal(questRow(self, quest.id)?.objectiveProgressCurrent, 2, 'Second distinct law archive did not record 2/3 progress.');
    await travelTo('relayWorkshop');
    assert.equal(questRow(self, quest.id)?.currentObjective, 'compare_incompatible_seals', 'Three distinct law archives did not satisfy Aktov condition.');
    await travelTo(String(giver.homeLocationId));
    await talkTo(String(giver.id), 'compare_incompatible_seals');
    await chooseQuestOutcomeAtNpc(quest.id, String(giver.id), 'official');
    await assertAktovBaseUnlocked();
    console.log('AKTOV PERSONAL-BASE JOURNEY PASSED');
    socket.close();
    return;
  }

  if (journeyScope === 'initial_conditions') {
    const questId = 'side_quiet_squeak';
    await startQuest(questId, 'rada_menshova');
    const before = questRow(self, questId);
    assert.equal(before?.currentObjective, 'reach_damaged_post');
    const { actor } = await openNpcDialogue('rada_menshova', 'reopen Quiet Squeak giver');
    const bypass = await ack(socket, 'kromkaQuestAction', {
      requestId: `qa_reject_bypass_${Date.now()}`,
      mode: 'dialogue', questId, enemyId: actor.id, outcomeId: ''
    });
    assert.equal(bypass.ok, false, 'Repeated giver dialogue bypassed the first world condition.');
    assert(String(bypass.error || '').includes('Один разговор его не заменяет'), `Unexpected bypass rejection: ${bypass.error}`);
    await ack(socket, 'npcDialogueFocus', { enemyId: actor.id, active: false });
    await refresh();
    assert.equal(questRow(self, questId)?.currentObjective, 'reach_damaged_post', 'Rejected dialogue changed quest progress.');

    await travelTo('relayOutpost');
    assert.equal(questRow(self, questId)?.currentObjective, 'recover_measurement_block', 'Arrival at the damaged post did not confirm the first condition.');
    await useQuestObject('relayOutpost', 'relay_outpost_antenna', 'recover_measurement_block');
    assert.equal(questRow(self, questId)?.currentObjective, 'return_to_menshova', 'Measurement block interaction did not confirm the second condition.');
    await travelTo('settlement');
    await talkTo('rada_menshova', 'return_to_menshova');
    assert.equal(questRow(self, questId)?.status, 'turnin', 'Return dialogue did not unlock the quest turn-in.');
    await turnInQuest(questId, 'rada_menshova');
    console.log('INITIAL QUEST CONDITIONS PASSED: dialogue bypass rejected, travel and quest object required');
    socket.close();
    return;
  }

  if (journeyScope === 'uprava_conditions') {
    const quest = (questCatalog.factionQuests || []).find(row => row.id === 'uprava_ration_unit');
    const giver = questGiverNpc(quest);
    await travelTo(String(giver.homeLocationId));
    await startQuest(quest.id, String(giver.id));
    while (questRow(self, quest.id)?.status === 'active') {
      const objective = String(questRow(self, quest.id)?.currentObjective || '');
      await completeConditionedObjective(quest.id, objective);
    }
    await travelTo(String(giver.homeLocationId));
    await chooseQuestOutcomeAtNpc(quest.id, String(giver.id), String(quest.outcomes[0]));
    console.log('UPRAVA INITIAL QUEST CONDITIONS PASSED: location, witness dialogue and interception required');
    socket.close();
    return;
  }

  if (journeyScope === 'severov_projection') {
    await travelTo('cascadeRegenerator');
    const { actor } = await openNpcDialogue('nikolai_severov', 'open Cascade Severov projection');
    await ack(socket, 'npcDialogueFocus', { enemyId: actor.id, active: false });
    console.log('SEVEROV PROJECTION APPROACH PASSED: reachable position with direct line of sight');
    socket.close();
    return;
  }

  if (journeyScope === 'named_npc_access') {
    for (const npc of npcCatalog.npcs || []) {
      await travelTo(String(npc.homeLocationId));
      const { actor } = await openNpcDialogue(String(npc.id), `open dialogue with ${npc.id}`);
      await ack(socket, 'npcDialogueFocus', { enemyId: actor.id, active: false });
    }
    await travelTo('cascadeRegenerator');
    const { actor } = await openNpcDialogue('nikolai_severov', 'open Cascade Severov projection');
    await ack(socket, 'npcDialogueFocus', { enemyId: actor.id, active: false });
    console.log('NAMED NPC ACCESS PASSED: all quest givers and the Severov projection are reachable with line of sight');
    socket.close();
    return;
  }

  await startQuest('campaign_ch1_water_owes_none', 'rada_menshova');
  await useQuestObject('settlement', 'story-keys-filter-inspection', 'inspect_keys_filter');
  await useQuestObject('settlement', 'story-keys-filter-feed', 'restore_filter_feed');
  await useQuestObject('settlement', 'story-keys-filter-defense', 'defend_filter');
  await talkTo('arkady_aktov', 'resolve_air_rights');
  assert.equal(questRow(self, 'campaign_ch1_water_owes_none')?.status, 'turnin');
  await turnInQuest('campaign_ch1_water_owes_none', 'rada_menshova');
  console.log('CHAPTER I complete');

  await startQuest('campaign_ch2_right_to_ruins', 'irena_versta_belova');
  await travelTo('sluiceCity');
  await talkTo('marina_velskaya', 'gain_uprava_key');
  await travelTo('scrapTown');
  await talkTo('nika_reznik', 'gain_artels_key');
  await travelTo('relayStation');
  await talkTo('timur_arsenyev', 'gain_contour_key');
  await travelTo('settlement');
  await talkTo('irena_versta_belova', 'trace_ambush_payment');
  assert.equal(questRow(self, 'campaign_ch2_right_to_ruins')?.status, 'turnin');
  await turnInQuest('campaign_ch2_right_to_ruins', 'irena_versta_belova');
  console.log('CHAPTER II complete');

  await travelTo('relayStation');
  await startQuest('campaign_ch3_inventory_living', 'timur_arsenyev');
  await travelTo('balanceBunker');
  assert.equal(questRow(self, 'campaign_ch3_inventory_living')?.currentObjective, 'restore_census_core', 'Arrival did not open Balance objective.');
  await useQuestObject('balanceBunker', 'story-balance-census-core', 'restore_census_core');
  await useQuestObject('balanceBunker', 'story-balance-selection-protocol', 'read_selection_protocol');
  await useQuestObject('balanceBunker', 'story-balance-emergency-exit', 'escape_balance');
  assert.equal(questRow(self, 'campaign_ch3_inventory_living')?.status, 'turnin');
  await travelTo('relayStation');
  await turnInQuest('campaign_ch3_inventory_living', 'timur_arsenyev');
  console.log('CHAPTER III complete');

  await travelTo('secondHaven');
  await startQuest('campaign_ch4_future_entitlement', 'yara_koval');
  await travelTo('sluiceCity');
  let allies = await talkTo('marina_velskaya', 'secure_two_allies');
  let allyProgress = (allies.questProgress || []).find(row => row.objective === 'secure_two_allies');
  assert(allyProgress.partial && allyProgress.current === 1 && allyProgress.target === 2, 'First ally progress is wrong.');
  allies = await talkTo('marina_velskaya', 'secure_two_allies');
  allyProgress = (allies.questProgress || []).find(row => row.objective === 'secure_two_allies');
  assert(allyProgress.duplicate && allyProgress.current === 1, 'Repeated ally dialogue counted twice.');
  await travelTo('relayStation');
  allies = await talkTo('timur_arsenyev', 'secure_two_allies');
  allyProgress = (allies.questProgress || []).find(row => row.objective === 'secure_two_allies');
  assert(!allyProgress.partial && allyProgress.current === 2, 'Second distinct ally did not complete the objective.');
  await travelTo('cascadeRegenerator');
  assert.equal(questRow(self, 'campaign_ch4_future_entitlement')?.currentObjective, 'disable_committee_lock', 'Arrival did not open Cascade route.');
  await useQuestObject('cascadeRegenerator', 'story-cascade-committee-lock', 'disable_committee_lock');
  await useQuestObject('cascadeRegenerator', 'story-cascade-regenerator-access', 'reach_regenerator');
  assert.equal(questRow(self, 'campaign_ch4_future_entitlement')?.status, 'turnin');
  await travelTo('secondHaven');
  await turnInQuest('campaign_ch4_future_entitlement', 'yara_koval');
  console.log('CHAPTER IV complete');

  await travelTo('cascadeRegenerator');
  await startQuest('campaign_final_rain', 'nikolai_severov');
  await useQuestObject('cascadeRegenerator', 'story-cascade-shift-shelter', 'survive_artificial_shift');
  let links = await useQuestObject('cascadeRegenerator', 'story-cascade-link-north', 'break_three_control_links', true);
  let linkProgress = (links.questProgress || []).find(row => row.objective === 'break_three_control_links');
  assert(linkProgress.current === 1 && linkProgress.target === 3);
  links = await useQuestObject('cascadeRegenerator', 'story-cascade-link-north', 'break_three_control_links', true);
  linkProgress = (links.questProgress || []).find(row => row.objective === 'break_three_control_links');
  assert(linkProgress.duplicate && linkProgress.current === 1, 'Repeated control link counted twice.');
  await useQuestObject('cascadeRegenerator', 'story-cascade-link-west', 'break_three_control_links', true);
  links = await useQuestObject('cascadeRegenerator', 'story-cascade-link-east', 'break_three_control_links', false);
  linkProgress = (links.questProgress || []).find(row => row.objective === 'break_three_control_links');
  assert(linkProgress.current === 3, 'Third control link did not complete the objective.');
  await talkTo('nikolai_severov', 'confront_severov');
  assert.equal(questRow(self, 'campaign_final_rain')?.status, 'choice', 'Final choice did not open.');
  assertQuestDialogue(self, 'campaign_final_rain', 'resolution');
  const { actor: severov } = await openNpcDialogue('nikolai_severov', 'open finale dialogue');
  const outcome = assertOk(await ack(socket, 'kromkaQuestAction', {
    requestId: `qa_final_${Date.now()}`, mode: 'outcome', questId: 'campaign_final_rain',
    enemyId: severov.id, outcomeId: 'distributed'
  }), 'choose campaign finale');
  update(outcome);
  await ack(socket, 'npcDialogueFocus', { enemyId: severov.id, active: false });
  assert.equal(questRow(self, 'campaign_final_rain')?.status, 'completed', 'Final quest did not complete.');
  assertQuestDialogue(self, 'campaign_final_rain', 'after');
  assert(self.kromkaQuestJournal?.outcomeTags?.includes('final_distributed_nodes'), 'Final outcome tag did not persist.');
  const completedCampaign = (self.kromkaQuestJournal?.campaign || []).filter(row => row.status === 'completed');
  assert.equal(completedCampaign.length, questCatalog.campaign.length, 'Not every campaign stage is complete.');
  console.log(`FINALE complete; ${completedCampaign.length}/${questCatalog.campaign.length} campaign stages finished`);

  const conditionedQuestById = new Map([
    ...(questCatalog.factionQuests || []),
    ...(questCatalog.mechanicQuests || []),
    ...(questCatalog.personalQuests || [])
  ].map(quest => [quest.id, quest]));
  const conditionedQuestIds = [
    ...(questCatalog.factionQuests || []),
    ...(questCatalog.mechanicQuests || []),
    ...(questCatalog.personalQuests || [])
  ].map(quest => quest.id);
  const conditionedStartIndex = Math.max(0, Math.min(conditionedQuestIds.length - 1,
    Number(process.env.KROMKA_QA_CONDITIONED_FROM || 0)));
  const executedConditionedQuestIds = conditionedQuestIds.slice(conditionedStartIndex);
  let completedConditionedQuests = 0;
  for (const questId of executedConditionedQuestIds) {
    const quest = conditionedQuestById.get(questId);
    const giver = questGiverNpc(quest);
    await travelTo(String(giver.homeLocationId));
    await startQuest(quest.id, String(giver.id));
    while (questRow(self, quest.id)?.status === 'active') {
      const objective = String(questRow(self, quest.id)?.currentObjective || '');
      assert(objective, `${quest.id}: active quest has no objective.`);
      await completeConditionedObjective(quest.id, objective);
    }
    if ((quest.outcomes || []).length) {
      const outcome = quest.outcomes[0];
      await travelTo(String(giver.homeLocationId));
      await chooseQuestOutcomeAtNpc(quest.id, String(giver.id), String(typeof outcome === 'string' ? outcome : outcome.id));
    } else {
      await travelTo(String(giver.homeLocationId));
      await turnInQuest(quest.id, String(giver.id));
    }
    if (quest.id === 'personal_aktov_air_rights') await assertAktovBaseUnlocked();
    completedConditionedQuests++;
    console.log(`CONDITIONED QUEST ${completedConditionedQuests}/${executedConditionedQuestIds.length}: ${quest.id}`);
  }
  const finalJournal = self.kromkaQuestJournal || {};
  const allCompleted = [
    ...(finalJournal.campaign || []),
    ...(finalJournal.mechanic || []),
    ...(finalJournal.personal || []),
    ...Object.values(finalJournal.factions || {}).flat()
  ].filter(row => row.status === 'completed');
  const expectedCompleted = questCatalog.campaign.length + executedConditionedQuestIds.length;
  assert.equal(allCompleted.length, expectedCompleted, `The real character completed ${allCompleted.length}/${expectedCompleted} quests in this journey scope.`);
  if (conditionedStartIndex === 0) console.log(`ALL AUTHORED QUESTS complete; ${allCompleted.length}/36 finished by one real character`);
  else console.log(`SCOPED AUTHORED QUESTS complete; ${allCompleted.length}/${expectedCompleted} campaign and selected conditioned quests finished`);
  console.log('LIVE JOURNEY PASSED');
  socket.close();
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
