'use strict';
const fs=require('node:fs'),path=require('node:path');

// Layouts for locations that still exist as separate scenes do not affect a
// sector surface. Follow the saved sector definitions, not the directory list.
function activeLayoutFiles(root) {
  const graph=JSON.parse(fs.readFileSync(path.join(root,'data/kromka/zone-graph.json')));
  const files=new Set();
  for(const zone of graph.zones) {
    const locationId=zone.city||zone.id;
    const source=zone.city?`data/locations/${locationId}.json`:`data/zones/authored/${zone.id}.json`;
    const definition=JSON.parse(fs.readFileSync(path.join(root,source)));
    for(const site of [...definition.sites||[],...definition.facilities||[]]) {
      for(const directory of ['site-layouts','facility-layouts']) {
        const file=`data/kromka/${directory}/${site.id}.json`;
        if(fs.existsSync(path.join(root,file)))files.add(file);
      }
    }
    if(zone.city) {
      const file=`data/kromka/city-appearance-layouts/${locationId}.json`;
      if(fs.existsSync(path.join(root,file)))files.add(file);
    }
  }
  return [...files].sort();
}
module.exports={activeLayoutFiles};
