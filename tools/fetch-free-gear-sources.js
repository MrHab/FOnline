'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const root = path.resolve(__dirname,'..');
const output = path.join(root,'source-assets/equipment/free-gear-v2');
const cache = path.join(root,'Build/SourceDownloads/free-gear-v2');
const raw = 'https://raw.githubusercontent.com/agentkaerf/FreeModels/db3df04d1e4714298a09510b26fb6de6645138a2';
const men = 'https://quaternius.com/packs/ultimatemodularcharacters.html';
const women = 'https://quaternius.com/packs/ultimatemodularwomen.html';
const hash = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const sources = [
  {id:'swat',file:'swat.gltf',creator:'Quaternius',page:men,url:raw+'/Ultimate%20Modular%20Men-%20Feb%202022/Individual%20Characters/glTF/Swat.gltf',sha256:'622B3F36FCAC90539EF8F7121EC1F11B5E1AE603A085019B3FA96EBA20DDDFD3'},
  {id:'spacesuit',file:'spacesuit.gltf',creator:'Quaternius',page:men,url:raw+'/Ultimate%20Modular%20Men-%20Feb%202022/Individual%20Characters/glTF/Spacesuit.gltf',sha256:'33E0E0FBC6140FFC936A099FD84A274BE406115C4B32AA0A697641710B67392A'},
  {id:'soldier-boots',file:'soldier-boots.gltf',creator:'Quaternius',page:women,url:raw+'/Ultimate%20Modular%20Women%20-%20April%202022/Individual%20Characters/glTF/Soldier.gltf',sha256:'37112E60AF92FF84D882A34E21F0F78A2AFC14282E950FB0E3652E51D06E0B2D'},
  {id:'scifi-boots',file:'scifi-boots.gltf',creator:'Quaternius',page:women,url:raw+'/Ultimate%20Modular%20Women%20-%20April%202022/Individual%20Characters/glTF/SciFi.gltf',sha256:'86BCB11A1BC18C744A23ABE5E7BD4CC95E636BA1F405CECDBD5A0E2F7214B802'},
  {id:'soldier-helmet',file:'soldier-helmet.glb',creator:'Quaternius',page:'https://poly.pizza/m/PpLF4rt4ah',url:'https://static.poly.pizza/1083c1d3-d1d4-4682-adf6-bc516d06ac84.glb',sha256:'06597E2CD20840EEE8BED03790F32138E379BA3D6C7F61EB87E29F0C672D4D54'},
  {id:'bucket-helmet',file:'bucket-helmet.fbx',creator:'Lucian Pavel',page:'https://opengameart.org/content/bucket-helmet',url:'https://opengameart.org/sites/default/files/Bucket%20Helmet.zip',archiveSha256:'7315ED94C410F21E8F9235274A4CABCD52CFB55C1933246F24A038E3F36B44A4',member:'Bucket Helmet.fbx'},
];

function unzipMember(zip,wanted) {
  let end=zip.length-22;
  while(end>=Math.max(0,zip.length-65557)&&zip.readUInt32LE(end)!==0x06054b50) end--;
  if(end<Math.max(0,zip.length-65557)) throw new Error('Invalid ZIP directory');
  let cursor=zip.readUInt32LE(end+16);
  for(let i=0;i<zip.readUInt16LE(end+10);i++) {
    if(zip.readUInt32LE(cursor)!==0x02014b50) throw new Error('Invalid ZIP member');
    const n=zip.readUInt16LE(cursor+28),x=zip.readUInt16LE(cursor+30),comment=zip.readUInt16LE(cursor+32);
    const name=zip.toString('utf8',cursor+46,cursor+46+n);
    if(name===wanted) {
      const offset=zip.readUInt32LE(cursor+42),size=zip.readUInt32LE(cursor+20),method=zip.readUInt16LE(cursor+10);
      const start=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28);
      const compressed=zip.subarray(start,start+size);
      if(method===0) return compressed;
      if(method===8) return zlib.inflateRawSync(compressed,{maxOutputLength:16000000});
      throw new Error('Unsupported ZIP compression');
    }
    cursor+=46+n+x+comment;
  }
  throw new Error('ZIP member missing: '+wanted);
}

async function main() {
  fs.mkdirSync(output,{recursive:true});fs.mkdirSync(cache,{recursive:true});
  const rows=[];
  for(const source of sources) {
    const cacheFile=path.join(cache,source.id+(source.member?'.zip':path.extname(source.file)));
    let bytes=fs.existsSync(cacheFile)?fs.readFileSync(cacheFile):null;
    const expected=source.archiveSha256||source.sha256;
    if(!bytes||hash(bytes)!==expected) {
      const response=await fetch(source.url,{signal:AbortSignal.timeout(120000)});
      if(!response.ok) throw new Error(`${source.id}: HTTP ${response.status}`);
      bytes=Buffer.from(await response.arrayBuffer());
      if(hash(bytes)!==expected) throw new Error(source.id+': source hash changed');
      fs.writeFileSync(cacheFile,bytes);
    }
    const model=source.member?unzipMember(bytes,source.member):bytes;
    fs.writeFileSync(path.join(output,source.file),model);
    const dependencies=[];
    if(source.member) {
      const texture=unzipMember(bytes,'Bucket Helmet.png');
      fs.writeFileSync(path.join(output,'Bucket Helmet.png'),texture);
      dependencies.push({file:'Bucket Helmet.png',sha256:hash(texture)});
    }
    rows.push({...source,license:'CC0-1.0',sha256:hash(model),bytes:model.length,dependencies});
  }
  fs.writeFileSync(path.join(output,'sources.json'),JSON.stringify({schema:'realm.free-gear-sources.v2',verifiedDate:'2026-09-09',sources:rows},null,2)+'\n');
  console.log(`Pinned free equipment sources: ${rows.length} CC0 models`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
