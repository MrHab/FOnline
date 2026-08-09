#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BODY_IDS = [
  'female_slim',
  'female_medium',
  'female_large',
  'male_slim',
  'male_medium',
  'male_large'
];

const FAMILIES = [
  {
    name: 'leather',
    directory: ['docs', 'art', 'reviews', 'unified-equipment-leather-jacket-v1', 'jacket'],
    prefix: 'equipment_leather_jacket_unified_v1'
  },
  {
    name: 'hazmatSuit',
    directory: ['docs', 'art', 'reviews', 'unified-equipment-hazmat-suit-v1', 'suit'],
    prefix: 'equipment_hazmat_suit_unified_v1'
  },
  {
    name: 'weldedHelmet',
    directory: ['docs', 'art', 'reviews', 'unified-equipment-welded-helmet-v1', 'helmet'],
    prefix: 'equipment_welded_helmet_unified_v1'
  },
  {
    name: 'metalArmor',
    directory: ['docs', 'art', 'reviews', 'unified-equipment-metal-armor-v1', 'armor'],
    prefix: 'equipment_metal_armor_unified_v1'
  },
  {
    name: 'ballisticVest',
    directory: ['docs', 'art', 'reviews', 'unified-equipment-ballistic-vest-v1', 'vest'],
    prefix: 'equipment_ballistic_vest_unified_v1'
  },
  {
    name: 'energySuit',
    directory: ['docs', 'art', 'reviews', 'unified-equipment-energy-suit-v1', 'suit'],
    prefix: 'equipment_energy_suit_unified_v1'
  }
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

for (const family of FAMILIES) {
  const directory = path.join(ROOT, ...family.directory);
  const aggregateFile = path.join(directory, 'fit-report-all.json');
  const aggregate = JSON.parse(fs.readFileSync(aggregateFile, 'utf8'));
  const variants = BODY_IDS.map(bodyId => {
    const reportFile = path.join(directory, `${family.prefix}_${bodyId}.report.json`);
    const glbFile = path.join(directory, `${family.prefix}_${bodyId}.glb`);
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    if (report.bodyId !== bodyId || report.sha256 !== sha256(glbFile)) {
      throw new Error(`${family.name} ${bodyId} report does not match its GLB`);
    }
    return report;
  });
  aggregate.bodyIds = [...BODY_IDS];
  aggregate.variantCount = variants.length;
  aggregate.variants = variants;
  fs.writeFileSync(aggregateFile, `${JSON.stringify(aggregate, null, 2)}\n`);
  console.log(`${family.name}: ${sha256(aggregateFile)}`);
}
