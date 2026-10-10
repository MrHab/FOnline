'use strict';
// Prepare a deterministic Unity export request and verify its Float32 result.
// This tool never derives native lattice heights from the analytic JS field.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {visibleShore}=require('./lib/sector-shore');
const lattice=require('../src/server/sector-ground-lattice');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function argsOf(argv){
 const mode=argv[2],args={};
 if(!['prepare','apply'].includes(mode))throw Error('Usage: prepare|apply --input catalog.json --zones six,ids --output file [--request file --export file]');
 const allowed=new Set(mode==='prepare'?['input','zones','output']:['input','request','export','output']);
 for(let i=3;i<argv.length;i+=2){
  const name=argv[i];if(!name?.startsWith('--')||!argv[i+1])throw Error('Missing option value '+name);
  const key=name.slice(2);
  if(!allowed.has(key)||Object.hasOwn(args,key))throw Error('Unknown or duplicate option '+name);
  args[key]=argv[i+1];
 }
 for(const key of mode==='prepare'?['input','zones','output']:['input','request','export','output'])
  if(!args[key])throw Error('Missing --'+key);
 const output=path.resolve(args.output).toLowerCase();
 for(const key of mode==='prepare'?['input']:['input','request','export'])
  if(output===path.resolve(args[key]).toLowerCase())throw Error('Ground lattice output would overwrite --'+key);
 return {mode,args};
}
function prepared(input,zoneIds){
 const catalog=JSON.parse(input);
 if(!catalog||!Array.isArray(catalog.profiles)||catalog.profiles.length!==197||!catalog.relief)
  throw Error('Ground lattice export needs relief and all 197 profiles');
 for(const p of catalog.profiles){delete p.groundLattice;delete p.hasGroundLattice;}
 const profiles=new Map(catalog.profiles.map(p=>[p.zoneId,p]));
 if(profiles.size!==197)throw Error('Duplicate ground lattice zone');
 for(const id of zoneIds){
  const p=profiles.get(id);if(!p)throw Error('Unknown ground lattice zone '+id);
  const fresh=visibleShore(p,catalog.relief);
  if(p.visibleShore!==undefined&&JSON.stringify(p.visibleShore)!==JSON.stringify(fresh))
   throw Error('Stale input visibleShore '+id);
  p.visibleShore=fresh;
 }
 return catalog;
}
function zoneIds(raw){
 const ids=raw.split(',').map(s=>s.trim()).filter(Boolean);
 if(ids.length!==6||new Set(ids).size!==6||ids.some(id=>!/^z_\d{2}_\d{2}$/.test(id)))
  throw Error('Exactly six unique sector zone IDs are required');
 return ids;
}
function requestFor(inputBytes,ids){
 const catalog=prepared(inputBytes.toString('utf8'),ids);
 const geometryHash=lattice.geometryHash(catalog),codeHash=lattice.codeHash();
 const zones=ids.map(zoneId=>{
  const p=catalog.profiles.find(row=>row.zoneId===zoneId),segments=p.terrainSegments===256?256:128;
  return {zoneId,segments,profileGeometryHash:lattice.profileGeometryHash(p,geometryHash)};
 });
 return {schema:lattice.REQUEST_SCHEMA,inputSha256:sha(inputBytes),geometryHash,codeHash,
  zoneIds:ids,zones,relief:catalog.relief,profiles:catalog.profiles};
}
function assertRequest(inputBytes,request){
 if(request.schema!==lattice.REQUEST_SCHEMA||!Array.isArray(request.zoneIds)||request.zoneIds.length!==6||
  request.inputSha256!==sha(inputBytes)||request.codeHash!==lattice.codeHash())
  throw Error('Stale ground lattice export request input/code');
 const regenerated=requestFor(inputBytes,request.zoneIds);
 if(JSON.stringify(regenerated)!==JSON.stringify(request))throw Error('Ground lattice export request differs from prepared source');
 return regenerated;
}
function cacheFor(request,exported){
 if(exported.schema!==lattice.EXPORT_SCHEMA||exported.inputSha256!==request.inputSha256||
  exported.geometryHash!==request.geometryHash||exported.codeHash!==request.codeHash||
  !Array.isArray(exported.zones)||exported.zones.length!==request.zoneIds.length)
  throw Error('Ground lattice Unity export metadata mismatch');
 const seen=new Set(),rows=[];
 for(const item of exported.zones){
  const expected=request.zones.find(row=>row.zoneId===item.zoneId);
  if(!expected||seen.has(item.zoneId)||item.segments!==expected.segments||
    item.profileGeometryHash!==expected.profileGeometryHash||
    !Array.isArray(item.vertexBits)||item.vertexBits.length!==3*(item.segments+1)**2)
   throw Error('Ground lattice Unity export row mismatch '+item.zoneId);
  seen.add(item.zoneId);
  const row={schema:lattice.SCHEMA,zoneId:item.zoneId,segments:item.segments,
   profileGeometryHash:item.profileGeometryHash,geometryHash:request.geometryHash,
   codeHash:request.codeHash,vertexBits:item.vertexBits};
  lattice.decode({zoneId:item.zoneId,terrainSegments:item.segments,hasGroundLattice:true,groundLattice:row});
  rows.push(row);
 }
 rows.sort((a,b)=>request.zoneIds.indexOf(a.zoneId)-request.zoneIds.indexOf(b.zoneId));
 return {schema:lattice.CACHE_SCHEMA,inputSha256:request.inputSha256,
  geometryHash:request.geometryHash,codeHash:request.codeHash,zoneIds:request.zoneIds,zones:rows};
}
function writeAtomic(file,value){
 const absolute=path.resolve(file),temporary=absolute+'.tmp-'+process.pid;
 fs.mkdirSync(path.dirname(absolute),{recursive:true});
 fs.writeFileSync(temporary,JSON.stringify(value));fs.renameSync(temporary,absolute);
}
function main(argv=process.argv){
 const {mode,args}=argsOf(argv),inputBytes=fs.readFileSync(args.input);
 if(mode==='prepare'){
  const request=requestFor(inputBytes,zoneIds(args.zones));
  if(sha(fs.readFileSync(args.input))!==request.inputSha256||lattice.codeHash()!==request.codeHash)
   throw Error('Ground lattice source changed during prepare');
  writeAtomic(args.output,request);
  console.log(JSON.stringify({mode,zones:request.zoneIds,geometryHash:request.geometryHash,codeHash:request.codeHash}));
  return request;
 }
 const requestBytes=fs.readFileSync(args.request),exportBytes=fs.readFileSync(args.export);
 const request=JSON.parse(requestBytes),exported=JSON.parse(exportBytes);
 assertRequest(inputBytes,request);
 const cache=cacheFor(request,exported);
 if(sha(fs.readFileSync(args.input))!==request.inputSha256||lattice.codeHash()!==request.codeHash||
    sha(fs.readFileSync(args.request))!==sha(requestBytes)||
    sha(fs.readFileSync(args.export))!==sha(exportBytes))
  throw Error('Ground lattice source/export changed during apply');
 writeAtomic(args.output,cache);
 console.log(JSON.stringify({mode,zones:cache.zoneIds,geometryHash:cache.geometryHash,codeHash:cache.codeHash}));
 return cache;
}
if(require.main===module){try{main();}catch(error){console.error(error.stack);process.exitCode=1;}}
module.exports={argsOf,prepared,zoneIds,requestFor,assertRequest,cacheFor,main};
