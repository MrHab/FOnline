'use strict';
const fs=require('node:fs'),path=require('node:path');
const {activeLayoutFiles}=require('./lib/sector-active-layouts');
const root=path.resolve(__dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const map=read('data/global-map.json'),seed=read('data/kromka/world-layout.seed.json'),graph=read('data/kromka/zone-graph.json');
const changes=[];
const active=activeLayoutFiles(root);
const layouts=active.filter(file=>file.includes('/site-layouts/')).map(file=>read(file).site);
for(const file of active.filter(file=>file.includes('/facility-layouts/'))) {
  const facility=read(file);layouts.push({...facility,exterior:true});
}
for(const site of layouts) {
  const node=map.nodes.find(n=>n.locationId===site.id),point=seed.locations.find(n=>n.id===site.id);
  if(!node&&!point)continue;
  if(!node||!point)throw new Error('Missing canonical world node '+site.id);
  const zone=graph.zones.find(z=>z.id===site.zone);if(!zone)throw new Error('Unknown sector '+site.zone);
  const definition=read('data/zones/authored/'+site.zone+'.json');
  if(site.exterior) {
    if(!definition.facilities?.some(s=>s.id===site.id)||!definition.objects.some(o=>(o.tags||[]).includes('facility-'+site.id)))throw new Error('Native exterior not yet saved in sector '+site.id);
  } else if(!definition.sites.some(s=>s.id===site.id))throw new Error('Place not yet saved in sector '+site.id);
  const x=Number((zone.col*20+10+site.center.x/definition.map.width*20).toFixed(6));
  const y=Number((zone.row*20+10-site.center.z/definition.map.depth*20).toFixed(6));
  if(node.x!==x||node.y!==y||point.x!==x||point.z!==y)changes.push({id:site.id,x,y});
  node.x=point.x=x;node.y=point.z=y;
  if(site.worldAccessRoute) {
    const route=seed.routes.find(r=>r.id===site.worldAccessRoute.routeId),exported=map.infrastructure.find(r=>r.id===site.worldAccessRoute.routeId);
    if(!route||!exported||!site.entrance)throw new Error('Missing authored facility access route '+site.id);
    const entrance=[Number((zone.col*20+10+site.entrance.x/definition.map.width*20).toFixed(6)),Number((zone.row*20+10-site.entrance.z/definition.map.depth*20).toFixed(6))];
    route.facilityAccess ||= {locationId:site.id,sourcePoints:route.points.map(p=>[...p])};
    if(route.facilityAccess.locationId!==site.id)throw new Error('Conflicting facility route binding '+route.id);
    const points=[...route.facilityAccess.sourcePoints.map(p=>[...p]),entrance];
    if(JSON.stringify(route.points)!==JSON.stringify(points)||JSON.stringify(exported.points.map(p=>[p.x,p.y]))!==JSON.stringify(points))changes.push({route:route.id,entrance});
    route.points=points;exported.points=points.map(([x,y])=>({x,y}));
  }
}
if(process.argv.includes('--check')){if(changes.length)throw new Error('World nodes differ from saved sector sites: '+JSON.stringify(changes));}
else for(const [file,data] of [['data/global-map.json',map],['data/kromka/world-layout.seed.json',seed]])fs.writeFileSync(path.join(root,file),JSON.stringify(data,null,2)+'\n');
console.log('Canonical site/map positions:',changes.length,'updated; IDs retained.');
