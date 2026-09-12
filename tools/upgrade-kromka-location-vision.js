'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const files = ['tutorialCaravanYard', 'personalBase', 'clanSiege'];
for (const id of files) {
  const file = path.join(root, 'data/locations', `${id}.json`);
  const location = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const object of location.objects || []) {
    const collision = String(object.collision || '').toLowerCase();
    if (!['solid', 'block', 'blocked', 'wall', 'resource', 'cover'].includes(collision)) continue;
    object.vision = { mode: collision === 'cover' || collision === 'resource' ? 'cover' : 'block' };
  }
  fs.writeFileSync(file, JSON.stringify(location, null, 2) + '\n');
}
console.log(`Updated explicit line-of-sight metadata for ${files.length} Kromka locations.`);
