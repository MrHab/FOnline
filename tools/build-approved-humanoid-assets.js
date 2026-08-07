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
const APPROVED_EQUIPMENT_REVIEWS = Object.freeze([
  {
    itemId: 'leather',
    slot: 'armor',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-leather-jacket-v1', 'jacket'],
    sourcePrefix: 'equipment_leather_jacket_unified_v1',
    runtimePrefix: 'equipment_leather_jacket',
    meshCount: 2,
    fitReportSha256: 'BFF4F9D493A61D0B93B3996E3EC307477D9CB6224C23BA2B68DCAC5EDB117BCF'
  },
  {
    itemId: 'reinforcedBoots',
    slot: 'boots',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-reinforced-boots-v1', 'boots'],
    sourcePrefix: 'equipment_reinforced_boots_unified_v1',
    runtimePrefix: 'equipment_reinforced_boots',
    meshCount: 1,
    fitReportSha256: 'C5389AB78639F29DC60C083244221F441CF108CD4AF73642A19B3533B35D6BA7'
  },
  {
    itemId: 'helmet',
    slot: 'helmet',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-steel-helmet-v1', 'helmet'],
    sourcePrefix: 'equipment_steel_helmet_unified_v1',
    runtimePrefix: 'equipment_steel_helmet',
    meshCount: 1,
    fitReportSha256: '4B77FD82FA6D19C0D29F8D612AF156F5E612688F96677F79E73D2C7680BB447E'
  },
  {
    itemId: 'tacticalHelmet',
    slot: 'helmet',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-tactical-helmet-v1', 'helmet'],
    sourcePrefix: 'equipment_tactical_helmet_unified_v1',
    runtimePrefix: 'equipment_tactical_helmet',
    meshCount: 1,
    fitReportSha256: '2C8548BC1E8222528070B14C0D96585264ED36E5C509645084AD6253ABD59895'
  },
  {
    itemId: 'assaultHelmet',
    slot: 'helmet',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-assault-helmet-v1', 'helmet'],
    sourcePrefix: 'equipment_assault_helmet_unified_v1',
    runtimePrefix: 'equipment_assault_helmet',
    meshCount: 2,
    fitReportSha256: '0C07FFDDA768B952B9D844D2561F0BA8A96D7860C20834BB083F44C0B4E895A5'
  },
  {
    itemId: 'hazmatSuit',
    slot: 'armor',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-hazmat-suit-v1', 'suit'],
    sourcePrefix: 'equipment_hazmat_suit_unified_v1',
    runtimePrefix: 'equipment_hazmat_suit',
    meshCount: 3,
    fitReportSha256: 'CE377C96F63DD4C9336315EA402C5ECE78E71C6BF70505E3AD966958A13049F4'
  },
  {
    itemId: 'energySuit',
    slot: 'armor',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-energy-suit-v1', 'suit'],
    sourcePrefix: 'equipment_energy_suit_unified_v1',
    runtimePrefix: 'equipment_energy_suit',
    meshCount: 2,
    fitReportSha256: '066FACF879B9BBFBFE44CF1CB717BF6B3428BA30A381F19DB05CCB748F757A0A'
  }
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
  if (metadata.equipmentItemId) {
    const sceneRootIndex = json.scenes?.[json.scene || 0]?.nodes?.[0];
    const sceneRoot = Number.isInteger(sceneRootIndex) ? nodes[sceneRootIndex] : null;
    const runtimeNodes = new Set([
      root,
      sceneRoot,
      ...nodes.filter(node => Number.isInteger(node?.mesh))
    ].filter(Boolean));
    json.asset.extras.realm_schema = 'realm.equipment-runtime.approved.v1';
    json.asset.extras.realm_item_id = metadata.equipmentItemId;
    json.asset.extras.realm_equipment_slot = metadata.equipmentSlot;
    json.asset.extras.realm_body_id = metadata.bodyId;
    for (const node of runtimeNodes) {
      node.extras = {
        ...(node.extras || {}),
        realm_preview_only: false,
        realm_review_only: false,
        realm_runtime_integration_allowed: true,
        realm_approval_status: 'approved',
        realm_approved_review_sha256: metadata.approvedReviewSha256,
        realm_runtime_asset_id: metadata.runtimeAssetId,
        realm_item_id: metadata.equipmentItemId,
        realm_equipment_slot: metadata.equipmentSlot,
        realm_body_id: metadata.bodyId
      };
    }
  }
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

function verifyEquipmentReviews(onlyItemIds = null) {
  const variants = [];
  for (const definition of APPROVED_EQUIPMENT_REVIEWS) {
    if (onlyItemIds && !onlyItemIds.has(definition.itemId)) continue;
    const directory = fromRoot(...definition.reviewDirectory);
    const fitReportFile = path.join(directory, 'fit-report-all.json');
    assertFile(`${definition.itemId} fit report`, fitReportFile);
    if (sha256(fitReportFile) !== definition.fitReportSha256) {
      throw new Error(`${definition.itemId} fit report differs from the integration-approved bytes`);
    }
    const fitReport = JSON.parse(fs.readFileSync(fitReportFile, 'utf8'));
    const reportedBodyIds = Array.isArray(fitReport.bodyIds)
      ? fitReport.bodyIds
      : (Array.isArray(fitReport.variants) ? fitReport.variants.map(row => row?.bodyId) : []);
    if (reportedBodyIds.length !== BODY_IDS.length || BODY_IDS.some(bodyId => !reportedBodyIds.includes(bodyId))) {
      throw new Error(`${definition.itemId} fit report does not cover all six body variants`);
    }
    for (const bodyId of BODY_IDS) {
      const filename = `${definition.sourcePrefix}_${bodyId}`;
      const glb = path.join(directory, `${filename}.glb`);
      const reportFile = path.join(directory, `${filename}.report.json`);
      assertFile(`${definition.itemId} ${bodyId} GLB`, glb);
      assertFile(`${definition.itemId} ${bodyId} report`, reportFile);
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      if (String(report.bodyId || '') !== bodyId || String(report.sha256 || '') !== sha256(glb)) {
        throw new Error(`${definition.itemId} ${bodyId} report does not describe its GLB`);
      }
      if (report.itemId && String(report.itemId) !== definition.itemId) {
        throw new Error(`${definition.itemId} ${bodyId} report names another game item`);
      }
      if (report.reviewOnly !== true || report.runtimeIntegrationAllowed !== false) {
        throw new Error(`${definition.itemId} ${bodyId} source must remain an immutable review asset`);
      }
      const parsed = parseGlb(glb);
      if (parsed.json.skins?.length !== 1 || parsed.json.skins[0].joints?.length !== 65) {
        throw new Error(`${definition.itemId} ${bodyId} does not use the current 65-bone rig`);
      }
      if (parsed.json.meshes?.length !== definition.meshCount) {
        throw new Error(`${definition.itemId} ${bodyId} mesh count changed`);
      }
      variants.push({
        ...definition,
        bodyId,
        glb,
        approvedReviewSha256: String(report.sha256)
      });
    }
  }
  return variants;
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
  if (process.argv.includes('--equipment-only')) {
    const changedItemIds = new Set(['leather', 'hazmatSuit', 'energySuit']);
    const equipment = verifyEquipmentReviews(changedItemIds);
    const manifestFile = fromRoot('public', 'assets', 'models', 'approved-humanoid-assets.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const replacements = new Map();
    for (const asset of equipment) {
      const output = fromRoot(
        'public', 'assets', 'models', 'equipment', asset.slot,
        `${asset.runtimePrefix}_${asset.bodyId}.glb`
      );
      const runtimeAssetId = `${asset.itemId}_${asset.bodyId}`;
      const row = {
        id: runtimeAssetId,
        itemId: asset.itemId,
        slot: asset.slot,
        bodyId: asset.bodyId,
        file: `/assets/models/equipment/${asset.slot}/${asset.runtimePrefix}_${asset.bodyId}.glb`,
        ...makeRuntimeGlb(asset.glb, output, {
          approvedReviewSha256: asset.approvedReviewSha256,
          runtimeAssetId,
          sourceRootName: asset.sourcePrefix,
          equipmentItemId: asset.itemId,
          equipmentSlot: asset.slot,
          bodyId: asset.bodyId
        })
      };
      replacements.set(runtimeAssetId, {
        ...row,
        bytes: fs.statSync(output).size
      });
    }
    manifest.files = manifest.files.map(row => replacements.get(row.id) || row);
    const missing = [...replacements.keys()].filter(id => !manifest.files.some(row => row.id === id));
    for (const id of missing) manifest.files.push(replacements.get(id));
    manifest.approval.equipmentFitReports ||= {};
    for (const definition of APPROVED_EQUIPMENT_REVIEWS) {
      if (changedItemIds.has(definition.itemId)) {
        manifest.approval.equipmentFitReports[definition.itemId] = definition.fitReportSha256;
      }
    }
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Approved equipment assets built: ${replacements.size} files`);
    return manifest;
  }

  const npcSource = verifyNpcReview();
  const boots = verifyBootReviews();
  const equipment = verifyEquipmentReviews();
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

  for (const asset of equipment) {
    const output = fromRoot(
      'public', 'assets', 'models', 'equipment', asset.slot,
      `${asset.runtimePrefix}_${asset.bodyId}.glb`
    );
    const runtimeAssetId = `${asset.itemId}_${asset.bodyId}`;
    rows.push({
      id: runtimeAssetId,
      itemId: asset.itemId,
      slot: asset.slot,
      bodyId: asset.bodyId,
      file: `/assets/models/equipment/${asset.slot}/${asset.runtimePrefix}_${asset.bodyId}.glb`,
      ...makeRuntimeGlb(asset.glb, output, {
        approvedReviewSha256: asset.approvedReviewSha256,
        runtimeAssetId,
        sourceRootName: asset.sourcePrefix,
        equipmentItemId: asset.itemId,
        equipmentSlot: asset.slot,
        bodyId: asset.bodyId
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
    schema: 'realm.approved-humanoid-assets.v2',
    artDirection: 'geometry_b_materials_c',
    approval: {
      humanoidNpc: NPC_REVIEW_SHA256,
      bootsFitReport: BOOTS_FIT_REPORT_SHA256,
      equipmentFitReports: Object.fromEntries(APPROVED_EQUIPMENT_REVIEWS.map(definition => (
        [definition.itemId, definition.fitReportSha256]
      ))),
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
  APPROVED_EQUIPMENT_REVIEWS,
  NPC_REVIEW_SHA256,
  RIFLE_REVIEW_SHA256,
  BOOTS_FIT_REPORT_SHA256,
  GRIP_RUNTIME_SHA256,
  parseGlb,
  makeRuntimeGlb,
  main
};
