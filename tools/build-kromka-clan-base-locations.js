'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/clan-bases.json'), 'utf8'));
const outDir = path.join(root, 'data/locations');

const model = (id, name, file, x, z, sx = 1, sz = 1, tags = []) => ({
  id, model: path.basename(file, '.glb').replace(/_([a-z])/g, (_, c) => c.toUpperCase()), name,
  position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 },
  scale: { x: sx, y: 1, z: sz }, collision: 'none', vision: { mode: 'block' }, tags
});

for (const [index, base] of catalog.bases.entries()) {
  const objects = [
    model('perimeter_n', 'Северный периметр', 'concrete_wall.glb', 0, 23, 8, 1, ['clan-base', 'perimeter']),
    model('perimeter_s', 'Южный периметр', 'concrete_wall.glb', 0, -23, 8, 1, ['clan-base', 'perimeter']),
    model('perimeter_w', 'Западный периметр', 'concrete_wall.glb', -23, 0, 1, 8, ['clan-base', 'perimeter']),
    model('perimeter_e', 'Восточный периметр', 'concrete_wall.glb', 23, 0, 1, 8, ['clan-base', 'perimeter']),
    model('command', `Командный узел: ${base.displayName}`, index === 6 ? 'relay_antenna.glb' : 'wasteland_shack.glb', 0, 8, 2.2, 2.2, ['clan-base', 'command-core']),
    model('storage', 'Клановый склад', 'storage_lean_to.glb', -10, 7, 1.5, 1.5, ['clan-base', 'clan-storage']),
    model('workshop', 'Модульный двор', 'workshop_bench.glb', 10, 7, 1.4, 1.4, ['clan-base', 'module-yard']),
    model('tower_a', 'Башня А', 'watch_post.glb', -16, 16, 1.2, 1.2, ['clan-base', 'module-socket', 'tower_a']),
    model('tower_b', 'Башня Б', 'watch_post.glb', 16, 16, 1.2, 1.2, ['clan-base', 'module-socket', 'tower_b']),
    model('outer_relay_a', 'Внешний передатчик А', 'utility_pole.glb', -18, -12, 1.2, 1.2, ['clan-base', 'siege-relay', 'relay-a']),
    model('outer_relay_b', 'Внешний передатчик Б', 'utility_pole.glb', 0, -18, 1.2, 1.2, ['clan-base', 'siege-relay', 'relay-b']),
    model('outer_relay_c', 'Внешний передатчик В', 'utility_pole.glb', 18, -12, 1.2, 1.2, ['clan-base', 'siege-relay', 'relay-c']),
    model('landmark', base.displayName, base.landmark.includes('tank') ? 'water_tank.glb' : base.landmark.includes('relay') || base.landmark.includes('dish') ? 'relay_antenna.glb' : 'cargo_stack.glb', 0, 0, 2.2, 2.2, ['clan-base', 'landmark', base.landmark])
  ];
  const data = {
    schema: 'realm.location.v1', version: 1, id: base.locationId, name: base.displayName,
    seed: 2026091400 + index, safe: false, pvpMode: 'pvp', kind: 'clanBase', clanBaseId: base.id,
    respawnAllowed: false, enemyCap: 0, spawnCount: 0,
    ground: { preset: base.macroRegion === 'chalk_lowland' ? 'chalkMud' : base.macroRegion === 'glasslands' ? 'glassAsh' : 'industrialDust', label: base.displayName },
    map: { width: 80, depth: 80, origin: 'center' }, grid: { snap: true, step: 2 },
    spawn: { tx: 19, tz: 3, x: 1, y: 0, z: -31, rotationY: 0 },
    entryFromWorld: { tx: 19, tz: 3 },
    objects,
    visualProfile: { id: `kromka-clan-${base.id}-v1`, skyDay: '#5d625f', fogDay: '#6d716c', hemiSkyDay: '#a9aca0', hemiGroundDay: '#3c403d', fillDay: '#9fa58e', sunDay: '#d4c28f', rimDay: '#7b9c98', fogDensityDay: 0.0018 + index * 0.00008, exposureDay: 0.98, colorGrade: `kromka-${base.macroRegion}` }
  };
  fs.writeFileSync(path.join(outDir, `${base.locationId}.json`), JSON.stringify(data, null, 2) + '\n');
}
console.log(`Generated ${catalog.bases.length} lore-first clan base locations.`);
