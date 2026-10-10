'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {groundHeight}=require('../src/server/sector-surface');
const {buildFromData,serialize}=require('./build-zone-graph');
const root=path.resolve(__dirname,'..');
const catalog=require('../data/kromka/sector-surfaces.json');
const overridesFile=path.join(root,'data/kromka/zone-graph.overrides.json');
const overrides=JSON.parse(fs.readFileSync(overridesFile,'utf8'));
const check=process.argv.includes('--check');
const changes=[];
const writes=new Map();
function write(file,value,indent=2) {
  const text=JSON.stringify(value,null,indent)+'\n';
  if(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')===text)return;
  changes.push(path.relative(root,file));writes.set(file,text);
}
overrides.gatePositions=Object.fromEntries(catalog.gateBindings.map(g=>{
  if(g.requiresCrossing)throw new Error('Cannot publish submerged gate '+g.a+'|'+g.b);
  return [[g.a,g.b].sort().join('|'),g.along];
}).sort(([a],[b])=>a.localeCompare(b)));
write(overridesFile,overrides);
const graph=buildFromData(overrides);
const graphFile=path.join(root,'data/kromka/zone-graph.json'),graphText=serialize(graph);
if(fs.readFileSync(graphFile,'utf8').replace(/\r\n/g,'\n')!==graphText){changes.push(path.relative(root,graphFile));writes.set(graphFile,graphText);}
const title=s=>s[0].toUpperCase()+s.slice(1);
const round=n=>Number(n.toFixed(5));
for(const p of catalog.profiles) {
  if(p.legacyDam)continue;
  const file=path.join(root,p.locationId===p.zoneId?'data/zones/authored/'+p.zoneId+'.json':'data/locations/'+p.locationId+'.json');
  const definition=JSON.parse(fs.readFileSync(file,'utf8'));
  if(definition.sectorSurfaceVersion!==catalog.sourceHash)throw new Error('Bake the saved Unity scene first: '+p.locationId);
  const point=v=>({tx:Math.max(0,Math.min(p.width/2-1,Math.floor((v.x+p.width/2)/2))),tz:Math.max(0,Math.min(p.depth/2-1,Math.floor((v.z+p.depth/2)/2))),x:round(v.x),y:round(groundHeight(p,catalog.relief,v.x,v.z,true)+.1),z:round(v.z)});
  if(definition.zone) {
    const zone=graph.zones.find(z=>z.id===p.zoneId);
    Object.assign(definition.zone,{col:zone.col,row:zone.row,n:zone.n});
  }
  for(const placement of p.functionalPlacements||[]) {
    const list=placement.kind==='container'?definition.containers:placement.kind==='anomaly'?definition.anomalyFields:placement.kind==='transition'?definition.transitions:definition.zone?.[placement.kind];
    const row=list?.find(r=>r.id===placement.id);
    if(!row)throw new Error('Missing functional anchor '+p.zoneId+' '+placement.kind+' '+placement.id);
    row.surfaceSourcePoint ||= placement.source;
    Object.assign(row,point(placement),{y:placement.y});
  }
  for(const g of p.gates) {
    definition['entryFrom'+title(g.side)]={...definition['entryFrom'+title(g.side)],...point(g.entry)};
    for(const row of definition.transitions||[])if(row.type==='zoneGate' && row.direction===g.side)Object.assign(row,point(g.gate));
    for(const row of definition.zone?.gates||[])if(row.dir===g.side)Object.assign(row,point(g.gate));
  }
  const nav=definition.zone?.nav;
  if(nav) {
    // Retain named anchors used by events and sites; replace only gate paths.
    nav.nodes=nav.nodes.filter(n=>!/^surface_/.test(n.id));
    nav.links=p.navigation?[]:nav.links.filter(link=>!link.some(id=>/^surface_/.test(id)) && !link.every(id=>id==='hub'||/^gate_/.test(id)));
    const byId=new Map(nav.nodes.map(n=>[n.id,n]));
    if(p.navigation) {
      definition.surfaceSource ||= {};
      definition.surfaceSource.navLinks ||= p.navigation.sourceLinks;
      for(const placement of p.navigation.nodes) {
        const row=byId.get(placement.id);
        if(!row)throw new Error('Missing saved named nav node '+p.zoneId+' '+placement.id);
        row.surfaceSourcePoint ||= placement.source;
        Object.assign(row,point(placement));
      }
      for(const connection of p.navigation.connections) {
        const route=[connection.from];
        for(let i=1;i<connection.points.length-1;i++) {
          const id='surface_path_'+connection.id+'_'+i;
          nav.nodes.push({id,...point(connection.points[i])});route.push(id);
        }
        route.push(connection.to);
        for(let i=1;i<route.length;i++)nav.links.push([route[i-1],route[i]]);
      }
    }
    Object.assign(byId.get('hub')||{},point(p.hub));
    for(const road of p.roads.filter(r=>r.type==='track' && r.id.startsWith('gate_'))) {
      if(road.blocked)throw new Error('Unbuilt gate access '+p.zoneId+' '+road.id);
      const vertices=road.points?.length?road.points:[road.a,road.b],route=['hub'];
      for(let i=1;i<vertices.length;i++) {
        const id=i===vertices.length-1?road.id:'surface_'+road.id+'_'+i;
        const existing=byId.get(id);
        if(existing)Object.assign(existing,point(vertices[i]));else nav.nodes.push({id,...point(vertices[i])});
        route.push(id);
      }
      for(let i=1;i<route.length;i++)nav.links.push([route[i-1],route[i]]);
      const turn=byId.get(road.id+'_turn');
      if(turn){Object.assign(turn,point(vertices[Math.min(1,vertices.length-1)]));nav.links.push([turn.id,route[Math.min(1,route.length-1)]]);}
    }
  }
  write(file,definition);
}
console.log('Sector entries, shared gates and authored navigation: '+changes.length+' changed files.');
if(check && changes.length)throw new Error('Sector surface navigation is stale.');
if(!check)for(const [file,text] of writes)fs.writeFileSync(file,text);
