#!/usr/bin/env node
'use strict';

// Перевод сохранений на мир зон: каждый персонаж, сохранённый на глобальной
// карте или в сцене её мелкой клетки, встаёт в зону своей точки (из красной и
// чёрной — в ближайшую синюю или мирную), следы карты стираются. Без --write —
// только отчёт; с --write рядом кладётся резервная копия saves.json.
//
//   node tools/migrate-saves-to-zones.js [путь/к/saves.json] [--write]
//
// Та же функция работает при входе персонажа, так что восстановленный старый
// бэкап тоже попадёт в мир зон.

const fs = require('node:fs');
const path = require('node:path');
const { migrateSaveStateToZones } = require('../src/server/zone-migration');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const file = path.resolve(args.find(arg => !arg.startsWith('--')) || path.join(process.env.DATA_DIR || path.join(root, 'data'), 'saves.json'));
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));

if (!fs.existsSync(file)) {
  console.error(`No saves file at ${file}`);
  process.exit(1);
}
const saves = JSON.parse(fs.readFileSync(file, 'utf8'));
const tally = { characters: 0, changed: 0, globalMap: 0, dangerCell: 0, cleaned: 0 };
const byZone = new Map();
for (const store of Object.values(saves.characters || {})) {
  for (const record of Object.values(store || {})) {
    if (!record?.state) continue;
    tally.characters += 1;
    const out = migrateSaveStateToZones(record.state, graph);
    if (!out.changed) continue;
    tally.changed += 1;
    if (out.reason) {
      tally[out.reason] += 1;
      byZone.set(out.zoneId, (byZone.get(out.zoneId) || 0) + 1);
    } else {
      tally.cleaned += 1;
    }
  }
}

console.log(`${write ? 'Migrated' : 'Would migrate'} ${file}: ${tally.characters} characters, ${tally.changed} changed `
  + `(${tally.globalMap} from the map, ${tally.dangerCell} from cell scenes, ${tally.cleaned} only cleaned).`);
for (const [zoneId, count] of [...byZone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${zoneId}: ${count}`);
if (write && tally.changed) {
  const backup = `${file}.pre-zones-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, backup);
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(saves));
  fs.renameSync(temp, file);
  console.log(`Backup: ${backup}`);
}
