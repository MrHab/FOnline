#!/usr/bin/env node
'use strict';

// Залы боковых лабораторий под управляемым временем: шкала угрозы копится,
// объявленный удар бьёт по секторам и смещается, узлы на стенах её сбрасывают
// и снимают объявление, охранная машина «Цепи» защищена питанием, а перегретые
// противники «Сплава» получают больше урона. Плюс авторские данные и серверные
// крючки: тик, урон по секторам, появление машины и сокет узла.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const lab = require('../src/server/lab-mechanics');
const territory = JSON.parse(read('data/kromka/territory.json'));

// --- авторские данные -------------------------------------------------------
const labs = territory.labs;
assert.equal(labs.length, 4, 'Four side laboratories carry their own hall mechanics.');
const kinds = new Set();
for (const row of labs) {
  const mechanics = lab.normalizeLabMechanics(row.mechanics);
  assert(mechanics, `${row.id}: the hall mechanics are authored.`);
  kinds.add(mechanics.hazard.kind);
  assert(mechanics.hazard.buildMs >= 20000 && mechanics.hazard.buildMs <= 90000,
    `${row.id}: the meter fills in a readable time, not instantly.`);
  assert(mechanics.hazard.telegraphMs >= 2000, `${row.id}: the strike is announced before it lands.`);
  assert(mechanics.hazard.active < mechanics.hazard.sectors,
    `${row.id}: at least one sector stays safe, so the hall can be crossed.`);
  assert(mechanics.nodes.length >= 2, `${row.id}: the hall has nodes to relieve the meter.`);

  // Каждый узел механики существует в локации как объект с тем же именем,
  // иначе игрок увидит в HUD одно, а в зале другое.
  const loc = JSON.parse(read(`data/locations/${row.id}.json`));
  for (const node of mechanics.nodes) {
    const prop = (loc.objects || []).find(entry => entry.id === node.id);
    assert(prop, `${row.id}: node ${node.id} exists in the hall.`);
    assert.equal(prop.interactive?.kind, 'labNode', `${row.id}: node ${node.id} is interactive.`);
    assert.equal(prop.name, node.displayName, `${row.id}: node ${node.id} is called the same in the hall and in the HUD.`);
  }
}
assert.deepEqual([...kinds].sort(), ['discharge', 'heat', 'pulse', 'spores'], 'Every laboratory threatens in its own way.');

const byId = Object.fromEntries(labs.map(row => [row.id, lab.normalizeLabMechanics(row.mechanics)]));
assert(byId.coreLabCircuit.guard, 'The Chain keeps a guard machine.');
assert(byId.coreLabCircuit.nodes.every(node => node.effectMs > 0), 'Chain nodes cut the machine off power for a while.');
assert(byId.coreLabAlloy.overheat, 'The Alloy overheats its dwellers.');
assert(byId.coreLabSpectrum.nodes.every(node => node.action === 'shift'), 'Spectrum emitters move the sequence.');
assert.equal(lab.normalizeLabMechanics({}), null, 'Without a hazard there is no hall mechanic.');
assert.equal(lab.normalizeLabMechanics(null), null);

// --- шкала, объявление и удар -----------------------------------------------
const mechanics = byId.coreLabSprout;
const t0 = 4000000;
const state = lab.normalizeLabState({});
assert.deepEqual(lab.tickLab(state, mechanics, t0), [], 'The first tick only remembers the time.');
assert.equal(state.meter, 0);
assert.deepEqual(lab.tickLab(state, mechanics, t0 + mechanics.hazard.buildMs / 2), [], 'Halfway the hall only grows tense.');
assert(Math.abs(state.meter - 0.5) < 0.01, `The meter grows with time: ${state.meter}`);
const telegraph = lab.tickLab(state, mechanics, t0 + mechanics.hazard.buildMs);
assert.equal(telegraph.length, 1);
assert.equal(telegraph[0].type, 'telegraph');
assert.equal(telegraph[0].displayName, mechanics.hazard.displayName);
assert(telegraph[0].sectors.length === mechanics.hazard.active, 'The announcement names the sectors that will burn.');
assert.deepEqual(lab.tickLab(state, mechanics, t0 + mechanics.hazard.buildMs + 500), [],
  'Inside the announcement window nothing happens yet.');
const beforeOffset = state.sectorOffset;
const strike = lab.tickLab(state, mechanics, t0 + mechanics.hazard.buildMs + mechanics.hazard.telegraphMs);
assert.equal(strike.length, 1);
assert.equal(strike[0].type, 'hazard');
assert.equal(state.meter, 0, 'The strike relieves the hall.');
assert.equal(state.telegraphedAt, 0);
assert.notEqual(state.sectorOffset, beforeOffset, 'The next strike lands elsewhere.');
assert.deepEqual(lab.tickLab({}, null, t0), [], 'A hall without mechanics never strikes.');

// Сектора расходятся вокруг центра зала, оставляя проход.
const sectors = lab.labHazardSectors(state, mechanics, { x: 10, z: -4 });
assert.equal(sectors.length, mechanics.hazard.active);
assert.equal(new Set(sectors.map(row => row.sector)).size, sectors.length, 'The burning sectors never overlap.');
for (const sector of sectors) {
  const distance = Math.hypot(sector.x - 10, sector.z + 4);
  assert(Math.abs(distance - mechanics.hazard.distance) < 0.05, 'Sectors stand at the authored distance from the centre.');
  assert.equal(sector.damage, mechanics.hazard.damage);
}
assert.deepEqual(lab.labHazardSectors(state, null), [], 'No mechanics means no sectors.');

// --- узлы -------------------------------------------------------------------
const relief = lab.normalizeLabState({});
lab.tickLab(relief, mechanics, t0);
lab.tickLab(relief, mechanics, t0 + mechanics.hazard.buildMs * 0.9);
const used = lab.activateLabNode(relief, mechanics, 'node_a', t0 + 30000);
assert(used.ok && used.relieved > 0, 'A node relieves the meter.');
assert(relief.meter < 0.2, `The hall calms down: ${relief.meter}`);
const again = lab.activateLabNode(relief, mechanics, 'node_a', t0 + 31000);
assert(!again.ok && /перезаряж/i.test(again.error), `A node on cooldown refuses: ${again.error}`);
assert(lab.activateLabNode(relief, mechanics, 'node_b', t0 + 31000).ok, 'The second node works on its own cooldown.');
assert(!lab.activateLabNode(relief, mechanics, 'node_zzz', t0 + 31000).ok, 'An unknown node is refused.');
assert(lab.activateLabNode(relief, mechanics, 'node_a', t0 + 30000 + mechanics.nodes[0].cooldownMs).ok,
  'After the cooldown the node works again.');

// Узел, сработавший в окне объявления, снимает удар.
const saved = lab.normalizeLabState({});
lab.tickLab(saved, mechanics, t0);
assert.equal(lab.tickLab(saved, mechanics, t0 + mechanics.hazard.buildMs)[0].type, 'telegraph');
assert(lab.activateLabNode(saved, mechanics, 'node_a', t0 + mechanics.hazard.buildMs + 1000).ok);
assert.deepEqual(lab.tickLab(saved, mechanics, t0 + mechanics.hazard.buildMs + mechanics.hazard.telegraphMs), [],
  'A node used in time cancels the announced strike.');

// «Спектр»: излучатель сдвигает последовательность и открывает проход.
const spectrum = lab.normalizeLabState({});
const spectrumMechanics = byId.coreLabSpectrum;
const shifted = lab.activateLabNode(spectrum, spectrumMechanics, 'node_a', t0);
assert(shifted.ok && spectrum.sectorOffset === 1, 'An emitter moves the pulse sequence.');

// --- охранная машина и перегрев ---------------------------------------------
const circuit = lab.normalizeLabState({ meter: 0.8 });
const circuitMechanics = byId.coreLabCircuit;
assert(lab.labGuardShielded(circuit, circuitMechanics, t0), 'With the power on the machine is protected.');
assert(lab.activateLabNode(circuit, circuitMechanics, 'node_a', t0).ok);
circuit.meter = 0.9;
assert(!lab.labGuardShielded(circuit, circuitMechanics, t0 + 1000), 'A used shield cuts the machine off power.');
assert(lab.labGuardShielded(circuit, circuitMechanics, t0 + circuitMechanics.nodes[0].effectMs + 1000),
  'When the effect ends the power returns.');
assert(!lab.labGuardShielded({ meter: 0.2, nodes: {} }, circuitMechanics, t0), 'A calm hall leaves the machine unprotected.');
assert(!lab.labGuardShielded({ meter: 1, nodes: {} }, mechanics, t0), 'The Sprout has no guard machine at all.');

const alloyMechanics = byId.coreLabAlloy;
assert.equal(lab.labOverheatDamageMultiplier({ meter: 0.2 }, alloyMechanics), 1, 'A cold hall gives no bonus.');
assert(lab.labOverheatDamageMultiplier({ meter: 0.9 }, alloyMechanics) > 1, 'Overheated dwellers take more damage.');
assert.equal(lab.labOverheatDamageMultiplier({ meter: 1 }, mechanics), 1, 'Other halls do not overheat.');

// --- снимок для клиента ------------------------------------------------------
const snapshot = lab.publicLabState(circuit, circuitMechanics, { x: 0, z: 0 }, t0 + 1000);
assert.equal(snapshot.meterLabel, 'Перегрузка');
assert.equal(snapshot.hazardName, circuitMechanics.hazard.displayName);
assert.equal(snapshot.telegraph, false);
assert.equal(snapshot.nodes.length, circuitMechanics.nodes.length);
assert(snapshot.nodes[0].readyInSeconds > 0, 'The snapshot shows the node cooldown.');
// Снятое питание держится считаные секунды, и это окно решает, успеют ли
// добить машину: снимок обязан называть остаток, а не только перезарядку.
assert.equal(snapshot.nodes[0].effectSeconds, Math.round((circuitMechanics.nodes[0].effectMs - 1000) / 1000),
  'The snapshot shows how long the machine stays without power.');
assert.equal(snapshot.nodes[1].effectSeconds, 0, 'An untouched node has no effect window.');
// Окно снимает щит только с охранной машины, поэтому снимок и называет её:
// в зале без машины показывать по этому окну нечего.
assert.equal(snapshot.guardName, circuitMechanics.guard.displayName, 'The snapshot names the guard machine of the hall.');
assert.equal(lab.publicLabState(lab.normalizeLabState({}), byId.coreLabSpectrum, { x: 0, z: 0 }, t0).guardName, '',
  'A hall without a guard machine names none.');
assert.equal(lab.publicLabState(circuit, circuitMechanics, { x: 0, z: 0 }, t0 + circuitMechanics.nodes[0].effectMs + 1000)
  .nodes[0].effectSeconds, 0, 'When the power returns the window closes.');
assert(snapshot.sectors.length === circuitMechanics.hazard.active);
assert.equal(lab.publicLabState({}, null), null, 'Without mechanics there is no snapshot.');
{
  const announced = lab.normalizeLabState({ meter: 1, telegraphedAt: t0 });
  const view = lab.publicLabState(announced, circuitMechanics, { x: 0, z: 0 }, t0 + 1000);
  assert.equal(view.telegraph, true);
  assert.equal(view.telegraphInSeconds, Math.round((circuitMechanics.hazard.telegraphMs - 1000) / 1000),
    'The countdown to the strike is honest.');
}

// --- сохранение состояния ----------------------------------------------------
const restored = lab.normalizeLabState(JSON.parse(JSON.stringify(circuit)));
assert.equal(restored.meter, circuit.meter);
assert.deepEqual(Object.keys(restored.nodes).sort(), Object.keys(circuit.nodes).sort());
assert.equal(lab.normalizeLabState({ meter: 5 }).meter, 1, 'The meter never leaves its range.');
assert.equal(lab.normalizeLabState({ meter: -3 }).meter, 0);

// --- серверные крючки --------------------------------------------------------
const serverSource = read('server.js');
for (const needle of [
  "require('./src/server/lab-mechanics')",
  'function serverTickLabRoom(room, now = Date.now()) {',
  'for (const room of rooms.values()) serverTickLabRoom(room, now);',
  'function serverApplyLabHazard(room, sector, now = Date.now()) {',
  'function serverEnsureLabGuard(room, mechanics) {',
  "socket.on('labNodeAction', (data = {}, ack) => {",
  "if (distance > 3.2) return fail('Подойдите к узлу.');",
  'labHall: serverLabPayload(room, {}, Date.now()),',
  'dmgInfo.damage = serverLabDamageModifier(room, enemy, dmgInfo.damage);'
]) assert(serverSource.includes(needle), `server.js must run the hall mechanics: ${needle}`);
assert.equal(serverSource.split('dmgInfo.damage = serverLabDamageModifier(room, enemy, dmgInfo.damage);').length - 1, 2,
  'Both damage paths respect the shielded machine and the overheat bonus.');

// --- клиент -------------------------------------------------------------------
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');
assert(interaction.includes('TargetKind.LabNode'), 'Unity knows the hall node as a target.');
assert(interaction.includes('Socket.EmitWithAck("labNodeAction"'), 'Unity uses the node through the socket.');
const socketClient = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
assert(socketClient.includes('_connection.On("labHallState"') && socketClient.includes('OnLabHallState?.Invoke(payload)'),
  'Unity must route labHallState.');
const presentation = read('unity-client/Assets/Scripts/Game/RoaWorldEventsPresentation.cs');
assert(presentation.includes('_socket.OnLabHallState += ApplyLabHall;'), 'The HUD subscribes to the hall state.');
assert(presentation.includes('DescribeLabHall('), 'The HUD shows the hall state.');
assert(presentation.includes('_labHall = world?["labHall"] as JObject;'), 'The HUD reads the hall from the room snapshot.');
// Объявленный удар обязан называть стороны, по которым придёт: сектора
// сервер шлёт, и игрок должен знать, куда уходить.
for (const token of [
  'public static string HazardSides(JArray sectors, float centerX = 0f, float centerZ = 0f)',
  'public static string CompassSide(float x, float z)',
  'string sides = HazardSides(payload["sectors"] as JArray);'
]) assert(presentation.includes(token), `The hall line must name the sides of the announced strike: ${token}`);
// Окно побочного эффекта узла сервер публикует; без него игрок не знает,
// сколько секунд у него есть на охранную машину.
for (const token of [
  'public static string NodeEffectLine(JArray nodes, bool hasGuard)',
  'row["effectSeconds"]?.Value<int>() ?? 0',
  'string effect = NodeEffectLine(payload["nodes"] as JArray,'
]) assert(presentation.includes(token), `The hall line must show the node effect window: ${token}`);

const probe = read('unity-client/Assets/Editor/RoaWorldZonesUiProbe.cs');
assert(probe.includes('DescribeLabHall(lab, "coreLabCircuit")'), 'The editor probe checks the hall line.');
assert(probe.includes('ПИТАНИЕ СНЯТО: 14 с'), 'The editor probe checks the node effect window.');

console.log('Laboratory halls OK: meter, announced strike over shifting sectors, relieving nodes, guard machine power, overheat bonus, snapshot and server/client hooks.');
