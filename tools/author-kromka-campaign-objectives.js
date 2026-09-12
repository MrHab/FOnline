'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCATION_DIR = path.join(ROOT, 'data', 'locations');

const DEFINITIONS = {
  settlement: [
    ['story-keys-filter-inspection', 'Диагностический люк фильтра Ключей', 'waterTank', 'water_tank.glb', -12, 14, 'inspect_keys_filter'],
    ['story-keys-filter-feed', 'Панель подачи фильтра Ключей', 'workshopBench', 'workshop_bench.glb', 0, 14, 'restore_filter_feed'],
    ['story-keys-filter-defense', 'Пульт обороны фильтра Ключей', 'relayAntenna', 'relay_antenna.glb', 0, 18, 'defend_filter']
  ],
  balanceBunker: [
    ['story-balance-census-core', 'Ядро переписи «Баланса»', 'workshopBench', 'workshop_bench.glb', -12, -18, 'restore_census_core'],
    ['story-balance-selection-protocol', 'Терминал протокола отбора', 'storageLeanTo', 'storage_lean_to.glb', 12, -18, 'read_selection_protocol'],
    ['story-balance-emergency-exit', 'Аварийный шлюз «Баланса»', 'utilityPole', 'utility_pole.glb', -8, 18, 'escape_balance']
  ],
  cascadeRegenerator: [
    ['story-cascade-committee-lock', 'Блокировка Комитета', 'relayAntenna', 'relay_antenna.glb', -12, -18, 'disable_committee_lock'],
    ['story-cascade-regenerator-access', 'Сервисный пульт Регенератора Р-12', 'workshopBench', 'workshop_bench.glb', -8, 18, 'reach_regenerator'],
    ['story-cascade-shift-shelter', 'Аварийный контур защиты от Сдвига', 'storageLeanTo', 'storage_lean_to.glb', 12, -18, 'survive_artificial_shift'],
    ['story-cascade-link-north', 'Северная линия управления', 'utilityPole', 'utility_pole.glb', 0, -10, 'break_three_control_links'],
    ['story-cascade-link-west', 'Западная линия управления', 'utilityPole', 'utility_pole.glb', -12, 18, 'break_three_control_links'],
    ['story-cascade-link-east', 'Восточная линия управления', 'utilityPole', 'utility_pole.glb', 12, 18, 'break_three_control_links']
  ]
};

function authoredQuestObject(row) {
  const [id, name, model, file, x, z, questObjective] = row;
  return {
    id,
    model,
    name,
    position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 0.85, y: 0.85, z: 0.85 },
    collision: 'none',
    role: 'quest',
    tags: ['quest-object', 'story-objective', 'kromka-campaign'],
    footprint: { x: 0.3, z: 0.3 },
    vision: { blocks: false },
    interactive: {
      kind: 'questObject',
      questObjective
    },
    worldRevision: 'kromka-1'
  };
}

let authored = 0;
for (const [locationId, rows] of Object.entries(DEFINITIONS)) {
  const file = path.join(LOCATION_DIR, `${locationId}.json`);
  const location = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = new Set(rows.map(row => row[0]));
  location.objects = (Array.isArray(location.objects) ? location.objects : [])
    .filter(row => !ids.has(String(row?.id || '')));
  location.objects.push(...rows.map(authoredQuestObject));
  fs.writeFileSync(file, `${JSON.stringify(location, null, 2)}\n`);
  authored += rows.length;
}

console.log(`Authored ${authored} campaign objective objects in ${Object.keys(DEFINITIONS).length} locations.`);
