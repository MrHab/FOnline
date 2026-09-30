#!/usr/bin/env node
'use strict';

// Текстуры земли зон (source-assets/ground-textures, tools/build-ground-textures.js).
// Каждый набор — CC0 с Poly Haven и своей страницей; цвет и нормали в Unity — те самые
// файлы Poly Haven (md5 совпадает с каталогом), маска собрана из высоты и arm и растянута
// по высоте на весь диапазон; каталог клиента совпадает с тем, что собрал бы генератор;
// у каждого пресета грунта, который встречается в зонах, городах и местах, есть свой набор.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { runtimeCatalog, MASK_SIZE } = require('./build-ground-textures');

const ROOT = path.resolve(__dirname, '..');
const sources = JSON.parse(fs.readFileSync(path.join(ROOT, 'source-assets', 'ground-textures', 'sources.json'), 'utf8'));
const OUTPUT = path.join(ROOT, 'unity-client', 'Assets', 'Resources', 'RealmOfAshes', 'Ground');
const md5 = file => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');

function presetsInData() {
  const found = new Map();
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.json')) {
        const preset = JSON.parse(fs.readFileSync(file, 'utf8'))?.ground?.preset;
        if (preset) found.set(preset, path.relative(ROOT, file));
      }
    }
  };
  visit(path.join(ROOT, 'data', 'zones'));
  visit(path.join(ROOT, 'data', 'locations'));
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
  for (const zone of graph.zones) if (zone.ground) found.set(zone.ground, 'data/kromka/zone-graph.json');
  return found;
}

(async () => {
  const ids = Object.keys(sources.sets);
  assert(ids.length >= 8, 'every zone ground needs its own set');
  assert.equal(sources.license, 'CC0-1.0');
  for (const id of [sources.defaultSet, sources.pathSet, sources.mudSet]) assert(sources.sets[id], `${id} is a set`);

  for (const [id, set] of Object.entries(sources.sets)) {
    assert.equal(set.license, 'CC0-1.0', `${id} is CC0`);
    assert.match(set.page, /^https:\/\/polyhaven\.com\/a\//, `${id} names its Poly Haven page`);
    assert(Array.isArray(set.authors) && set.authors.length, `${id} credits its authors`);
    assert(set.tilingMeters >= 1 && set.tilingMeters <= 8, `${id} repeats every 1–8 m`);
    for (const role of ['diff', 'nor', 'arm', 'disp']) {
      assert.match(set.maps[role]?.md5 || '', /^[0-9a-f]{32}$/, `${id}/${role} is pinned by md5`);
      assert.match(set.maps[role]?.url || '', /^https:\/\/dl\.polyhaven\.org\//, `${id}/${role} comes from Poly Haven`);
    }
    // Цвет и нормали лежат в Unity без пересжатия: это ровно файлы Poly Haven.
    const albedo = path.join(OUTPUT, `${id}_albedo.jpg`);
    const normal = path.join(OUTPUT, `${id}_normal.jpg`);
    const mask = path.join(OUTPUT, `${id}_mask.png`);
    assert.equal(md5(albedo), set.maps.diff.md5, `${id}_albedo.jpg is the Poly Haven diffuse`);
    assert.equal(md5(normal), set.maps.nor.md5, `${id}_normal.jpg is the Poly Haven OpenGL normal`);
    for (const file of [albedo, normal, mask]) assert(fs.existsSync(`${file}.meta`), `${path.basename(file)} is imported by Unity`);
    const meta = await sharp(mask).metadata();
    assert.equal(meta.width, MASK_SIZE);
    assert.equal(meta.height, MASK_SIZE);
    const { data, info } = await sharp(mask).raw().toBuffer({ resolveWithObject: true });
    let low = 255;
    let high = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      low = Math.min(low, data[i]);
      high = Math.max(high, data[i]);
    }
    assert(low === 0 && high === 255, `${id}: mask height spans the full range (${low}..${high})`);
  }

  const catalog = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'ground-textures.json'), 'utf8'));
  assert.deepEqual(catalog, JSON.parse(JSON.stringify(runtimeCatalog(sources))),
    'the client catalog is what tools/build-ground-textures.js writes');

  const used = presetsInData();
  for (const [preset, where] of used) {
    assert(sources.presets[preset], `ground preset ${preset} (${where}) has a texture set`);
  }
  for (const [preset, id] of Object.entries(sources.presets)) assert(sources.sets[id], `${preset} → ${id} exists`);
  const zoneGrounds = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kromka', 'zone-graph.json'), 'utf8'))
    .zones.map(zone => zone.ground));
  const zoneSets = new Set([...zoneGrounds].map(ground => sources.presets[ground]));
  assert.equal(zoneSets.size, zoneGrounds.size, 'every zone ground looks different');
  assert(!zoneSets.has(sources.pathSet), 'paths stand out from every zone ground');

  console.log(`Ground textures OK: ${ids.length} CC0 sets from Poly Haven, ${used.size} ground presets in data, `
    + `${zoneGrounds.size} zone grounds with distinct sets, masks ${MASK_SIZE}px with full height range.`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
