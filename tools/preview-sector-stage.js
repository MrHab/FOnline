'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {sectorSourceDefinition}=require('./lib/sector-source-definition');
const {processPipes}=require('./lib/sector-process-pipes');
const {attachObstacles}=require('./lib/sector-obstacles');
const {visibleShore}=require('./lib/sector-shore');
const {planPlacements}=require('./lib/sector-placement');
const {siteWaterFilms}=require('./lib/sector-site-water');
const root=path.resolve(__dirname,'..');
const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: preview-sector-stage input output');
const catalog=JSON.parse(fs.readFileSync(input,'utf8'));
for(const p of catalog.profiles) {
  const definition=sectorSourceDefinition(JSON.parse(fs.readFileSync(path.join(root,p.locationId===p.zoneId?'data/zones/authored/'+p.zoneId+'.json':'data/locations/'+p.locationId+'.json'),'utf8')));
  attachObstacles(p,definition,catalog.relief);
  p.processPipes=processPipes(p,catalog.relief,definition,root,catalog.profiles);
  siteWaterFilms(p,definition,root);
  p.visibleShore=visibleShore(p,catalog.relief);
  p.placements=planPlacements(p,catalog.relief,definition);
}
delete catalog.sourceHash;
catalog.sourceHash=crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
fs.writeFileSync(output,JSON.stringify(catalog)+'\n');
console.log('Engineering preview: '+catalog.profiles.length+' profiles, authored utility pipes and shoreline.');
