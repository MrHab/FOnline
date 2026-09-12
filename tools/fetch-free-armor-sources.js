#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'Build', 'SourceDownloads', 'free-armor-replacements-20260908');
const QUATERNIUS_COMMIT = 'db3df04d1e4714298a09510b26fb6de6645138a2';
const RAW_ROOT = `https://raw.githubusercontent.com/agentkaerf/FreeModels/${QUATERNIUS_COMMIT}`;

const SOURCES = Object.freeze([
  {
    file: 'quaternius_male_punk.gltf',
    url: `${RAW_ROOT}/Ultimate%20Modular%20Men-%20Feb%202022/Individual%20Characters/glTF/Punk.gltf`,
    sha256: 'F9224072F5E6CBB207ECA250FAA7F1868614A1A984074FE79C7B2862DF4FEB42'
  },
  {
    file: 'quaternius_male_swat.gltf',
    url: `${RAW_ROOT}/Ultimate%20Modular%20Men-%20Feb%202022/Individual%20Characters/glTF/Swat.gltf`,
    sha256: '622B3F36FCAC90539EF8F7121EC1F11B5E1AE603A085019B3FA96EBA20DDDFD3'
  },
  {
    file: 'quaternius_male_spacesuit.gltf',
    url: `${RAW_ROOT}/Ultimate%20Modular%20Men-%20Feb%202022/Individual%20Characters/glTF/Spacesuit.gltf`,
    sha256: '33E0E0FBC6140FFC936A099FD84A274BE406115C4B32AA0A697641710B67392A'
  },
  {
    file: 'quaternius_female_punk.gltf',
    url: `${RAW_ROOT}/Ultimate%20Modular%20Women%20-%20April%202022/Individual%20Characters/glTF/Punk.gltf`,
    sha256: '61CC7F85A8E9B700CDB92AE8EBD6E3BDD1E8A510B57027F6C7D8C2B6FF3B0E0F'
  },
  {
    file: 'quaternius_female_soldier.gltf',
    url: `${RAW_ROOT}/Ultimate%20Modular%20Women%20-%20April%202022/Individual%20Characters/glTF/Soldier.gltf`,
    sha256: '37112E60AF92FF84D882A34E21F0F78A2AFC14282E950FB0E3652E51D06E0B2D'
  },
  {
    file: 'quaternius_female_scifi.gltf',
    url: `${RAW_ROOT}/Ultimate%20Modular%20Women%20-%20April%202022/Individual%20Characters/glTF/SciFi.gltf`,
    sha256: '86BCB11A1BC18C744A23ABE5E7BD4CC95E636BA1F405CECDBD5A0E2F7214B802'
  },
  {
    file: 'quaternius_mech_stan.gltf',
    url: `${RAW_ROOT}/Animated%20Mech%20Pack%20-%20March%202021/Flat%20Colors/glTF/Stan.gltf`,
    sha256: 'C9A87E0DFE4E39E0C8D7DEE7696758AFFC5B13D011D94A60ACB1600A49045FE7'
  },
  {
    file: 'quaternius_mech_george.gltf',
    url: `${RAW_ROOT}/Animated%20Mech%20Pack%20-%20March%202021/Flat%20Colors/glTF/George.gltf`,
    sha256: '6D4696D1D79FCCBC7B011023439599CD147EC66BD4A870AEF87497A073807E25'
  },
  {
    file: 'quaternius_modular_characters_license.txt',
    url: `${RAW_ROOT}/Ultimate%20Modular%20Men-%20Feb%202022/License.txt`,
    sha256: 'E8DBF915A2B82229913E301A0787696611241BDEFEC4832BC084F54161DB1EFE'
  },
  {
    file: 'quaternius_animated_mech_license.txt',
    url: `${RAW_ROOT}/Animated%20Mech%20Pack%20-%20March%202021/License.txt`,
    sha256: '83D8959F9FC56353ED571FBE2DC52E4BCD64508E2399501CD45AC2CE3DF0BF8C'
  },
  {
    file: 'poly_pizza_scifi_soldier.glb',
    url: 'https://static.poly.pizza/7e8c7379-ade5-4693-86ef-df70299909d3.glb',
    sha256: '0B612C75C5A6E22282219C4C38C035CBB2AC9A8562EAF466A10172288E5F4B6C'
  }
]);

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

async function download(source) {
  const destination = path.join(OUTPUT, source.file);
  if (fs.existsSync(destination)) {
    const bytes = fs.readFileSync(destination);
    if (digest(bytes) === source.sha256) return { ...source, bytes: bytes.length, cached: true };
  }

  const response = await fetch(source.url, {
    headers: { 'User-Agent': 'RealmOfAshesAssetPipeline/1.0' },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${source.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = digest(bytes);
  if (actual !== source.sha256) {
    throw new Error(`SHA-256 mismatch for ${source.file}: expected ${source.sha256}, got ${actual}`);
  }
  fs.writeFileSync(destination, bytes);
  return { ...source, bytes: bytes.length, cached: false };
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const rows = [];
  for (const source of SOURCES) rows.push(await download(source));
  const manifest = {
    schema: 'realm.free-armor-source-downloads.v1',
    quaterniusCommit: QUATERNIUS_COMMIT,
    files: rows.map(({ file, url, sha256, bytes }) => ({ file, url, sha256, bytes }))
  };
  fs.writeFileSync(path.join(OUTPUT, 'download-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const downloaded = rows.filter(row => !row.cached).length;
  console.log(`Free armor sources ready: ${rows.length} files (${downloaded} downloaded, ${rows.length - downloaded} cached).`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { OUTPUT, SOURCES, main };
