#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NPC_REVIEW_SHA256 = 'EAC5248C381FD457E93A04094DAC51FA22C60EDE138C88E00EEFBB3EB4E6091E';
const RIFLE_REVIEW_SHA256 = '81CE3D1AAC6FAF252CF523217154BFFCFF219DC91FFCB98135F128E603480B28';
const BOOTS_FIT_REPORT_SHA256 = 'D02C6E45C7D88BAE2D02056E770D6DE611351EED01452D6D2B0E3D5D594F2CA1';
const GRIP_RUNTIME_SHA256 = '7B96493E5D26DCF12D10B03526036DCD529A74C26FD031BFE8DCBBA986FD4FE8';
const BODY_IDS = Object.freeze([
  'female_slim',
  'female_medium',
  'female_large',
  'male_slim',
  'male_medium',
  'male_large'
]);

function fromRoot(...segments) {
  return path.join(ROOT, ...segments);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function assertFile(label, file) {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing: ${file}`);
}

function parseGlb(file) {
  const data = fs.readFileSync(file);
  if (data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2) {
    throw new Error(`${path.basename(file)} is not a glTF 2 GLB`);
  }
  const chunks = [];
  let json = null;
  let offset = 12;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    const body = Buffer.from(data.subarray(offset + 8, offset + 8 + length));
    if (type === 0x4E4F534A) {
      json = JSON.parse(body.toString('utf8').replace(/\0+$/g, '').trim());
    }
    chunks.push({ type, body });
    offset += 8 + length;
  }
  if (!json) throw new Error(`${path.basename(file)} has no JSON chunk`);
  return { json, chunks };
}

function encodeGlb(json, chunks) {
  const jsonText = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadding = (4 - (jsonText.length % 4)) % 4;
  const jsonBody = Buffer.concat([jsonText, Buffer.alloc(jsonPadding, 0x20)]);
  const outputChunks = [{ type: 0x4E4F534A, body: jsonBody }];
  chunks.filter(chunk => chunk.type !== 0x4E4F534A).forEach(chunk => outputChunks.push(chunk));
  const totalLength = 12 + outputChunks.reduce((sum, chunk) => sum + 8 + chunk.body.length, 0);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const bodies = outputChunks.map(chunk => {
    const chunkHeader = Buffer.alloc(8);
    chunkHeader.writeUInt32LE(chunk.body.length, 0);
    chunkHeader.writeUInt32LE(chunk.type, 4);
    return Buffer.concat([chunkHeader, chunk.body]);
  });
  return Buffer.concat([header, ...bodies]);
}

function makeRuntimeGlb(source, destination, metadata = {}) {
  const { json, chunks } = parseGlb(source);
  json.asset = json.asset || { version: '2.0' };
  json.asset.extras = {
    ...(json.asset.extras || {}),
    realm_runtime_integration_allowed: true,
    realm_approved_review_sha256: metadata.approvedReviewSha256,
    realm_runtime_asset_id: metadata.runtimeAssetId
  };
  const nodes = json.nodes || [];
  let root = nodes.find(node => node.extras?.realm_asset_id)
    || nodes.find(node => String(node.name || '') === metadata.sourceRootName)
    || nodes.find(node => String(node.name || '').includes(metadata.sourceRootName || '__missing__'));
  if (!root) {
    const sceneRootIndex = json.scenes?.[json.scene || 0]?.nodes?.[0];
    root = Number.isInteger(sceneRootIndex) ? nodes[sceneRootIndex] : null;
  }
  if (!root) throw new Error(`${path.basename(source)} has no runtime root node`);
  root.extras = {
    ...(root.extras || {}),
    realm_review_only: false,
    realm_runtime_integration_allowed: true,
    realm_approved_review_sha256: metadata.approvedReviewSha256,
    realm_runtime_asset_id: metadata.runtimeAssetId
  };
  if (metadata.weaponId) {
    root.extras.realm_schema = 'realm.weapon-runtime.approved.v1';
    root.extras.realm_weapon_id = metadata.weaponId;
    root.extras.realm_animation_family = 'long_gun';
    root.extras.realm_art_direction = 'geometry_b_materials_c';
    root.extras.realm_runtime_scale = 1;
    root.scale = [1, 1, 1];
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, encodeGlb(json, chunks));
  return { sourceSha256: sha256(source), runtimeSha256: sha256(destination) };
}

function verifyNpcReview() {
  const directory = fromRoot('docs', 'art', 'reviews', 'unified-humanoid-npc-v5', 'base');
  const glb = path.join(directory, 'npc_humanoid_base_unified_v5.glb');
  const reportFile = path.join(directory, 'npc_humanoid_base_unified_v5-report.json');
  const approvalFile = path.join(directory, 'CRITIC_APPROVAL_V5.md');
  [glb, reportFile, approvalFile].forEach(file => assertFile('humanoid NPC review asset', file));
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const approval = fs.readFileSync(approvalFile, 'utf8');
  if (sha256(glb) !== NPC_REVIEW_SHA256 || String(report.sha256 || '') !== NPC_REVIEW_SHA256) {
    throw new Error('Humanoid NPC review bytes differ from the approved SHA-256');
  }
  if (!approval.includes('APPROVE') || !approval.includes(NPC_REVIEW_SHA256)) {
    throw new Error('Humanoid NPC critic approval is missing or stale');
  }
  return glb;
}

function verifyBootReviews() {
  const directory = fromRoot('docs', 'art', 'reviews', 'unified-equipment-v21', 'boots');
  const approvalFile = path.join(directory, 'CRITIC_APPROVAL_V21.md');
  const fitReportFile = path.join(directory, 'fit-report-all.json');
  assertFile('boots critic approval', approvalFile);
  assertFile('boots fit report', fitReportFile);
  const approval = fs.readFileSync(approvalFile, 'utf8');
  if (!approval.includes('APPROVE') || !approval.includes(BOOTS_FIT_REPORT_SHA256)) {
    throw new Error('Boots critic approval is missing or stale');
  }
  if (sha256(fitReportFile) !== BOOTS_FIT_REPORT_SHA256) {
    throw new Error('Boots fit report differs from the critic-approved bytes');
  }
  return BODY_IDS.map(bodyId => {
    const glb = path.join(directory, `equipment_boots_unified_v21_${bodyId}.glb`);
    const reportFile = path.join(directory, `equipment_boots_unified_v21_${bodyId}-report.json`);
    assertFile(`${bodyId} boots GLB`, glb);
    assertFile(`${bodyId} boots report`, reportFile);
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    if (String(report.bodyId || '') !== bodyId || String(report.sha256 || '') !== sha256(glb)) {
      throw new Error(`${bodyId} boots report does not describe the approved GLB`);
    }
    if (report.actualGlb?.skins !== 1 || report.actualGlb?.positionVertices !== 2532) {
      throw new Error(`${bodyId} boots rig or topology changed`);
    }
    return { bodyId, glb, approvedReviewSha256: String(report.sha256) };
  });
}

function verifyRifleReview() {
  const directory = fromRoot('docs', 'art', 'reviews', 'unified-style-v5', 'rifle');
  const glb = path.join(directory, 'rifle_unified_v5.glb');
  const reportFile = path.join(directory, 'technical-report.json');
  const approvalFile = path.join(directory, 'CRITIC_APPROVAL_GRIP_V5.md');
  const heldFitFile = path.join(directory, 'held-fit-report.json');
  const gripRuntime = path.join(directory, 'assault_rifle_grip_runtime.glb');
  const gripReportFile = path.join(directory, 'assault_rifle_grip_runtime-report.json');
  [glb, reportFile, approvalFile, heldFitFile, gripRuntime, gripReportFile].forEach(file => (
    assertFile('approved assault-rifle asset', file)
  ));
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const heldFit = JSON.parse(fs.readFileSync(heldFitFile, 'utf8'));
  const gripReport = JSON.parse(fs.readFileSync(gripReportFile, 'utf8'));
  const approval = fs.readFileSync(approvalFile, 'utf8');
  if (sha256(glb) !== RIFLE_REVIEW_SHA256 || String(report.sha256 || '') !== RIFLE_REVIEW_SHA256) {
    throw new Error('Assault-rifle review bytes differ from the approved SHA-256');
  }
  if (!approval.includes('APPROVE') || !approval.includes(RIFLE_REVIEW_SHA256)) {
    throw new Error('Assault-rifle critic approval is missing or stale');
  }
  if (heldFit.supportHandPose?.palmRollDeltaFromPreviousDegrees !== 180) {
    throw new Error('Approved 180-degree support-wrist correction is missing');
  }
  if (sha256(gripRuntime) !== GRIP_RUNTIME_SHA256 || gripReport.sha256 !== GRIP_RUNTIME_SHA256) {
    throw new Error('Runtime grip donor differs from the exported approved held pose');
  }
  return { glb, gripRuntime };
}

function main() {
  const npcSource = verifyNpcReview();
  const boots = verifyBootReviews();
  const rifle = verifyRifleReview();
  const rows = [];

  const npcOutput = fromRoot('public', 'assets', 'models', 'characters', 'npc', 'npc_humanoid_animations.glb');
  rows.push({
    id: 'npc_humanoid_animations',
    file: '/assets/models/characters/npc/npc_humanoid_animations.glb',
    ...makeRuntimeGlb(npcSource, npcOutput, {
      approvedReviewSha256: NPC_REVIEW_SHA256,
      runtimeAssetId: 'npc_humanoid_animations',
      sourceRootName: 'npc_humanoid_root'
    })
  });

  for (const boot of boots) {
    const output = fromRoot(
      'public', 'assets', 'models', 'equipment', 'boots', `equipment_boots_${boot.bodyId}.glb`
    );
    rows.push({
      id: `boots_${boot.bodyId}`,
      bodyId: boot.bodyId,
      file: `/assets/models/equipment/boots/equipment_boots_${boot.bodyId}.glb`,
      ...makeRuntimeGlb(boot.glb, output, {
        approvedReviewSha256: boot.approvedReviewSha256,
        runtimeAssetId: `boots_${boot.bodyId}`,
        sourceRootName: 'character_root'
      })
    });
  }

  const rifleOutput = fromRoot('public', 'assets', 'models', 'weapons', 'weapon_assaultRifle.glb');
  rows.push({
    id: 'assaultRifle',
    file: '/assets/models/weapons/weapon_assaultRifle.glb',
    ...makeRuntimeGlb(rifle.glb, rifleOutput, {
      approvedReviewSha256: RIFLE_REVIEW_SHA256,
      runtimeAssetId: 'assaultRifle',
      sourceRootName: 'weapon_rifle_unified_v5',
      weaponId: 'assaultRifle'
    })
  });

  const weaponManifestFile = fromRoot('public', 'assets', 'models', 'weapons', 'manifest.json');
  const weaponManifest = JSON.parse(fs.readFileSync(weaponManifestFile, 'utf8'));
  const assaultRow = weaponManifest.files?.find(row => row.id === 'assaultRifle');
  if (!assaultRow) throw new Error('Weapon manifest has no assaultRifle row');
  const rifleRuntime = rows.find(row => row.id === 'assaultRifle');
  Object.assign(assaultRow, {
    family: 'long_gun',
    file: '/assets/models/weapons/weapon_assaultRifle.glb',
    bytes: fs.statSync(rifleOutput).size,
    sha256: String(rifleRuntime.runtimeSha256 || '').toLowerCase(),
    meshes: 3,
    runtimeScale: 1,
    boundsMeters: {
      min: [-0.037, -0.395, -0.1],
      max: [0.037, 0.655, 0.22]
    },
    animations: ['idle', 'attack', 'reload'],
    approvedReviewSha256: RIFLE_REVIEW_SHA256,
    source: 'Quaternius Zombie Apocalypse Kit / Rifle.gltf (CC0), rebuilt and critic-approved'
  });
  fs.writeFileSync(weaponManifestFile, `${JSON.stringify(weaponManifest, null, 2)}\n`);

  const gripOutput = fromRoot('public', 'assets', 'models', 'weapons', 'approved_assault_rifle_grip.glb');
  fs.mkdirSync(path.dirname(gripOutput), { recursive: true });
  fs.copyFileSync(rifle.gripRuntime, gripOutput);
  rows.push({
    id: 'assaultRifleGrip',
    file: '/assets/models/weapons/approved_assault_rifle_grip.glb',
    sourceSha256: GRIP_RUNTIME_SHA256,
    runtimeSha256: sha256(gripOutput)
  });

  const manifest = {
    schema: 'realm.approved-humanoid-assets.v1',
    artDirection: 'geometry_b_materials_c',
    approval: {
      humanoidNpc: NPC_REVIEW_SHA256,
      bootsFitReport: BOOTS_FIT_REPORT_SHA256,
      assaultRifle: RIFLE_REVIEW_SHA256,
      assaultRifleGrip: GRIP_RUNTIME_SHA256
    },
    files: rows.map(row => ({
      ...row,
      bytes: fs.statSync(fromRoot('public', row.file.replace(/^\//, ''))).size
    }))
  };
  const manifestFile = fromRoot('public', 'assets', 'models', 'approved-humanoid-assets.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Approved humanoid assets built: ${rows.length} files`);
  return manifest;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = {
  BODY_IDS,
  NPC_REVIEW_SHA256,
  RIFLE_REVIEW_SHA256,
  BOOTS_FIT_REPORT_SHA256,
  GRIP_RUNTIME_SHA256,
  parseGlb,
  makeRuntimeGlb,
  main
};
