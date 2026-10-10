'use strict';
// Native Float32 regular ground vertices are a derived, fingerprinted build
// input. Refined cells replace this lattice only after the regular mesh exists.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const SCHEMA='roa.groundLattice.v1';
const CACHE_SCHEMA='roa.groundLatticeCache.v1';
const REQUEST_SCHEMA='roa.groundLatticeRequest.v1';
const EXPORT_SCHEMA='roa.groundLatticeExport.v1';
// Fail closed when a new profile field is introduced: it might affect Height.
const BASE_FIELDS=[
 'zoneId','locationId','title','region','width','depth','mapMinX','mapMinY','mapSpan','gain','datum','legacyDam',
 'foundations','facilities','hydroCuts','waterVertices','waterIndices','waterEdges','roads','bridges',
 'naturalWaterIndexCount','hub','gates','corridors','railInfrastructure','railSupports','railBarriers',
 'spawnOverride','terrainSegments','waterPollution','roadBankTreatments','roadBankWalls','retainingFinish','bridgeBankRevetments'
];
const DERIVED_FIELDS=new Set(['processPipes','visibleShore','surfacePatches','physicalShore','placements',
 'interactionApproaches','functionalPlacements','navigation','groundLattice','hasGroundLattice',
 'roadBankContactWalls','hasRoadBankContactWalls','roadBankContactFootings','hasRoadBankContactFootings','bridgeBankRevetmentMeshes']);
const BASE_SET=new Set(BASE_FIELDS);
function baseProfile(profile){
 for(const key of Object.keys(profile))if(!BASE_SET.has(key)&&!DERIVED_FIELDS.has(key))
  throw new Error(`Unknown ground geometry field ${profile.zoneId||'?'}:${key}`);
 const result={};for(const key of BASE_FIELDS)if(profile[key]!==undefined)result[key]=profile[key];
 return result;
}
function geometryHash(catalog){
 if(!catalog||!Array.isArray(catalog.profiles)||catalog.profiles.length!==197||!catalog.relief)
  throw new Error('Ground lattice requires complete 197-profile relief catalogue');
 const seen=new Set(),profiles=[];
 for(const p of catalog.profiles){
  if(!p||typeof p.zoneId!=='string'||seen.has(p.zoneId))throw new Error('Duplicate or missing ground lattice zone');
  seen.add(p.zoneId);profiles.push(baseProfile(p));
 }
 profiles.sort((a,b)=>a.zoneId<b.zoneId?-1:a.zoneId>b.zoneId?1:0);
 return sha(JSON.stringify({schema:'roa.groundGeometryFingerprint.v1',relief:catalog.relief,profiles}));
}
function profileGeometryHash(profile,worldHash){
 if(!/^[0-9a-f]{64}$/.test(worldHash)||!Array.isArray(profile?.visibleShore))
  throw new Error(`Ground lattice needs prepared visibleShore ${profile?.zoneId||'?'}`);
 const segments=profile.terrainSegments===256?256:128;
 return sha(JSON.stringify({schema:'roa.groundProfileFingerprint.v1',geometryHash:worldHash,
  zoneId:profile.zoneId,segments,visibleShore:profile.visibleShore}));
}
const CODE_FILES=[
 'src/server/sector-ground-lattice.js','src/server/sector-mesh-patches.js','src/server/sector-surface.js',
 'src/server/sector-utilities.js',
 'src/server/sector-terrain.js','tools/lib/sector-access.js','tools/lib/sector-placement.js',
 'tools/lib/sector-shore.js','tools/lib/sector-finalization.js','tools/lib/sector-surface-refinements.js',
 'tools/lib/sector-wet-contour.js','tools/lib/sector-wet-retained.js','tools/build-sector-ground-lattices.js',
 'tools/lib/sector-road-bank.js',
 'unity-client/Assets/Scripts/World/RoaSectorSurface.cs',
 'unity-client/Assets/Scripts/World/RoaSurfaceCellPatches.cs',
 'unity-client/Assets/Scripts/World/RoaSectorWaterMesh.cs',
 'unity-client/Assets/Scripts/World/RoaSectorRailInfrastructure.cs',
 'unity-client/Assets/Scripts/World/RoaGlobalMapRelief.cs',
 'unity-client/Assets/Scripts/World/RoaDamRoadWaterProjection.cs',
 'unity-client/Assets/Editor/RoaWorldSurfaceGround.cs'
];
function codeHash(repo=root){
 const files=[...CODE_FILES];
 const editor=path.join(repo,'unity-client/Assets/Editor');
 for(const name of fs.readdirSync(editor))if(/GroundLattice.*\.cs$/i.test(name))
  files.push('unity-client/Assets/Editor/'+name);
 const rows=[...new Set(files)].sort().map(file=>[file,sha(fs.readFileSync(path.join(repo,file)))]);
 return sha(JSON.stringify(rows));
}
const decoded=new WeakMap();
function active(profile){
 const marker=profile?.hasGroundLattice,cache=profile?.groundLattice;
 if(marker!==undefined&&typeof marker!=='boolean')throw new Error(`Invalid ground lattice marker ${profile?.zoneId||'?'}`);
 if(marker===true){
  if(!cache||typeof cache!=='object'||Array.isArray(cache))throw new Error(`Missing marked ground lattice ${profile.zoneId}`);
  return true;
 }
 // Unity JsonUtility may instantiate an empty placeholder on a dry sector.
 // Any populated cache without the explicit marker remains a hard error.
 if(cache!==undefined&&cache!==null&&
    (typeof cache!=='object'||Array.isArray(cache)||Object.keys(cache).length))
  throw new Error(`Ground lattice data without marker ${profile?.zoneId||'?'}`);
 return false;
}
function decode(profile){
 if(!active(profile))return null;
 const lattice=profile.groundLattice,n=profile.terrainSegments===256?256:128;
 const saved=decoded.get(lattice);if(saved&&saved.profile===profile)return saved.vertices;
 if(lattice.schema!==SCHEMA||lattice.zoneId!==profile.zoneId||lattice.segments!==n||
  !/^[0-9a-f]{64}$/.test(lattice.geometryHash)||
  !/^[0-9a-f]{64}$/.test(lattice.profileGeometryHash)||
  !/^[0-9a-f]{64}$/.test(lattice.codeHash)||
  !Array.isArray(lattice.vertexBits)||lattice.vertexBits.length!==3*(n+1)*(n+1))
  throw new Error(`Malformed ground lattice ${profile.zoneId}`);
 const view=new DataView(new ArrayBuffer(4)),vertices=new Array((n+1)*(n+1));
 for(let i=0;i<vertices.length;i++){
  const values=[];
  for(let j=0;j<3;j++){
   const bits=lattice.vertexBits[i*3+j];
   if(!Number.isInteger(bits)||bits<0||bits>0xffffffff)throw new Error(`Invalid Float32 bits ${profile.zoneId}:${i}:${j}`);
   view.setUint32(0,bits,true);const value=view.getFloat32(0,true);
   if(!Number.isFinite(value))throw new Error(`Non-finite ground lattice vertex ${profile.zoneId}:${i}:${j}`);
   values.push(value);
  }
  vertices[i]={x:values[0],h:values[1],z:values[2]};
 }
 decoded.set(lattice,{profile,vertices});return vertices;
}
function regularVertex(profile,ix,iz,fallback){
 if(!active(profile))return fallback(ix,iz);
 const n=profile.terrainSegments===256?256:128;
 if(!Number.isInteger(ix)||!Number.isInteger(iz)||ix<0||iz<0||ix>n||iz>n)
  throw new Error(`Ground lattice vertex outside ${profile.zoneId}:${ix},${iz}`);
 return decode(profile)[iz*(n+1)+ix];
}
function assertCatalog(catalog,{expectedZones,expectedCodeHash}={}){
 for(const p of catalog.profiles)active(p);
 const zones=expectedZones||catalog.profiles.filter(p=>p.hasGroundLattice).map(p=>p.zoneId);
 const ids=[...new Set(zones)].sort();
 if(ids.length!==zones.length)throw new Error('Duplicate expected ground lattice zone');
 const worldHash=geometryHash(catalog);
 for(const id of ids){
  const p=catalog.profiles.find(row=>row.zoneId===id);
  if(!p||!active(p))throw new Error(`Missing ground lattice ${id}`);
  const lattice=p.groundLattice;
  if(lattice.geometryHash!==worldHash||lattice.profileGeometryHash!==profileGeometryHash(p,worldHash))
   throw new Error(`Stale ground lattice geometry ${id}`);
  if(expectedCodeHash&&lattice.codeHash!==expectedCodeHash)throw new Error(`Stale ground lattice code ${id}`);
  decode(p);
 }
 return {geometryHash:worldHash,zones:ids};
}
module.exports={SCHEMA,CACHE_SCHEMA,REQUEST_SCHEMA,EXPORT_SCHEMA,geometryHash,profileGeometryHash,
 codeHash,active,decode,regularVertex,assertCatalog};
