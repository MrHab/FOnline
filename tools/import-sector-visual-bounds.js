'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const input=process.argv[2];
if(!input)throw new Error('Pass the JSON measured by RoaSectorVisualClearanceProbe.');
const measured=JSON.parse(fs.readFileSync(input,'utf8'));
if(measured.schema!=='roa.sectorVisualEnvelopes.v1'||measured.profiles.length!==196)
  throw new Error('Incomplete native visual envelope measurement.');
const round=value=>Number(value.toFixed(5));
const profiles=measured.profiles.map(p=>({locationId:p.locationId,objects:p.objects
  .filter(row=>row.role!=='terrain')
  .map(row=>({id:row.id,centerX:round(row.centerX),centerZ:round(row.centerZ),halfX:round(row.halfX),halfZ:round(row.halfZ),minY:round(row.minY),maxY:round(row.maxY)}))
  .sort((a,b)=>a.id.localeCompare(b.id))})).sort((a,b)=>a.locationId.localeCompare(b.locationId));
for(const p of profiles)for(const row of p.objects)
  if(!Object.values(row).every(v=>typeof v==='string'||Number.isFinite(v))||row.halfX<0||row.halfZ<0||row.maxY<row.minY)
    throw new Error('Invalid native visual bounds '+p.locationId+' '+row.id);
const catalog={schema:'roa.sectorVisualBounds.v1',profiles};
catalog.sourceHash=crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
fs.writeFileSync(path.join(root,'data/kromka/sector-visual-bounds.json'),JSON.stringify(catalog)+'\n');
console.log('Native visual envelopes: '+profiles.length+' sectors; '+profiles.reduce((n,p)=>n+p.objects.length,0)+' scenery and infrastructure objects.');
