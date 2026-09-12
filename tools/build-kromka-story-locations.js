'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/locations.json'), 'utf8'));
const outDir = path.join(root, 'data/locations');
const wanted = new Set(['sluiceCity', 'secondHaven', 'vectorLab', 'balanceBunker', 'cascadeRegenerator']);

function prop(id, name, file, x, z, scale = 1, tags = [], rotationY = 0) {
  return {
    id, model: path.basename(file, '.glb').replace(/_([a-z])/g, (_, c) => c.toUpperCase()), name,
    position: { x, y: 0, z }, rotation: { x: 0, y: rotationY, z: 0 },
    scale: { x: scale, y: scale, z: scale }, collision: 'none', vision: { mode: 'block' }, tags
  };
}

for (const [index, lore] of catalog.locations.filter(row => wanted.has(row.id)).entries()) {
  const settlement = lore.locationType === 'faction_capital';
  const industrial = !settlement;
  const objects = [
    prop('landmark', lore.displayName, lore.id === 'sluiceCity' ? 'water_tank.glb' : 'relay_antenna.glb', 0, 12, 2.2, ['landmark', ...(lore.landmarkTags || [])]),
    prop('west_shell', industrial ? 'Западная оболочка' : 'Западный жилой блок', industrial ? 'concrete_wall.glb' : 'wasteland_shack.glb', -14, 5, industrial ? 3.5 : 1.5, ['district', lore.visualProfile]),
    prop('east_shell', industrial ? 'Восточная оболочка' : 'Восточный жилой блок', industrial ? 'concrete_wall.glb' : 'wasteland_shack.glb', 14, 5, industrial ? 3.5 : 1.5, ['district', lore.visualProfile]),
    prop('service', industrial ? 'Служебный пульт' : 'Общий фильтр', industrial ? 'workshop_bench.glb' : 'water_tank.glb', -7, -3, 1.25, ['service', 'interaction']),
    prop('records', industrial ? 'Архивный терминал' : 'Доска пайков', 'storage_lean_to.glb', 7, -3, 1.25, ['lore', 'quest']),
    prop('watch_a', 'Пост А', 'watch_post.glb', -18, -15, 1.1, ['guard-post']),
    prop('watch_b', 'Пост Б', 'watch_post.glb', 18, -15, 1.1, ['guard-post']),
    prop('entry_left', 'Входной пилон', 'utility_pole.glb', -5, -24, 1, ['entrance']),
    prop('entry_right', 'Входной пилон', 'utility_pole.glb', 5, -24, 1, ['entrance'])
  ];
  if (settlement) {
    objects.push(prop('home_a', 'Жилой блок А', 'wasteland_shack.glb', -11, 16, 1.2, ['home']));
    objects.push(prop('home_b', 'Жилой блок Б', 'wasteland_shack.glb', 11, 16, 1.2, ['home']));
  } else {
    objects.push(prop('inner_gate', 'Герметичная секция', 'cargo_stack.glb', 0, 22, 2.0, ['story-gate', 'interior']));
  }
  const location = {
    schema: 'realm.location.v1', version: 1, id: lore.id, name: lore.displayName,
    seed: 2026091200 + index, safe: settlement, pvpMode: settlement ? 'peaceful' : 'pvp',
    kind: lore.locationType, respawnAllowed: settlement, enemyCap: settlement ? 0 : 12, spawnCount: 0,
    ground: { preset: lore.macroRegion === 'chalk_lowland' ? 'chalkMud' : lore.macroRegion === 'glasslands' ? 'glassAsh' : 'industrialDust', label: lore.displayName },
    map: { width: 72, depth: 72, origin: 'center' }, grid: { snap: true, step: 2 },
    spawn: { tx: 36, tz: 8, x: 0, y: 0, z: -28, rotationY: 0 }, entryFromWorld: { tx: 36, tz: 8 },
    objects, anomalyFields: lore.anomalyFields || [],
    visualProfile: { id: lore.visualProfile, macroRegion: lore.macroRegion, ambientProfile: lore.ambientProfile, fogDensityDay: settlement ? 0.0016 : 0.0025, exposureDay: settlement ? 1.02 : 0.9 },
    lore: `${lore.displayName}: ${lore.ambientProfile}. ${lore.landmarkTags.join(', ')}.`
  };
  fs.writeFileSync(path.join(outDir, `${lore.id}.json`), JSON.stringify(location, null, 2) + '\n');
}
console.log(`Generated ${wanted.size} lore-first story and faction locations.`);
