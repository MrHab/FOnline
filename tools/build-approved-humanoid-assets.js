#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NPC_REVIEW_SHA256 = 'AE9B8CE96AB89C4C3503543C79F71FDE4E1FC8C22110EBE9DD888F32D86F38E6';
const RIFLE_REVIEW_SHA256 = '322D14E2D07059AB4458C65CB0E6B7019B8F030F3386B05016908E41E6591FC6';
const BOOTS_FIT_REPORT_SHA256 = '6CA7122CB054A5F585CD190AFB1643F26B44C55DE4A4AF17303356DDA8CF9853';
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
    fitReportSha256: 'D2EA208D9DA6B0B7391083010720A993D999C27255428BCC62D2F6FB3349209E'
  },
  {
    itemId: 'metalArmor',
    slot: 'armor',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-metal-armor-v1', 'armor'],
    sourcePrefix: 'equipment_metal_armor_unified_v1',
    runtimePrefix: 'equipment_metal_armor',
    meshCount: 1,
    fitReportSha256: 'B6891D03729BD31CA78FEB730B69AEE148A9DCD6DFD3A6804A69172976D29437'
  },
  {
    itemId: 'ballisticVest',
    slot: 'armor',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-ballistic-vest-v1', 'vest'],
    sourcePrefix: 'equipment_ballistic_vest_unified_v1',
    runtimePrefix: 'equipment_ballistic_vest',
    meshCount: 1,
    fitReportSha256: '54372E09530FF5427FBBD84C162F11B87D7369B096292241D4F9E79659949250'
  },
  {
    itemId: 'combatArmor',
    slot: 'armor',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-combat-armor-v1', 'armor'],
    sourcePrefix: 'equipment_combat_armor_unified_v1',
    runtimePrefix: 'equipment_combat_armor',
    meshCount: 1,
    fitReportSha256: '6D1A7AB3221486022827705119CD6060A6F08D07318481AD64B6D287B1195AB7'
  },
  {
    itemId: 'heavyArmor',
    slot: 'armor',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-heavy-armor-v1', 'armor'],
    sourcePrefix: 'equipment_heavy_armor_unified_v1',
    runtimePrefix: 'equipment_heavy_armor',
    meshCount: 1,
    fitReportSha256: 'D1A9D942A80AB6C1CD742D92D5192CC37D1ED69DCB0B6DBC027F93EE1EA1B257'
  },
  {
    itemId: 'backpack',
    slot: 'backpack',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-backpack-v1', 'backpack'],
    sourcePrefix: 'equipment_backpack_unified_v1',
    runtimePrefix: 'equipment_backpack',
    meshCount: 2,
    fitReportSha256: 'E70691AAE14BBC2CA5CD608567EFFA532EFED46AF3F4B2625DCBAAC281BF5F39'
  },
  {
    itemId: 'assaultBoots',
    slot: 'boots',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-assault-boots-v1', 'boots'],
    sourcePrefix: 'equipment_assault_boots_unified_v1',
    runtimePrefix: 'equipment_assault_boots',
    meshCount: 1,
    fitReportSha256: '46409E0071FE16553B5B921C67495D92561378A53816C391EEB481377BE6B912'
  },
  {
    itemId: 'reinforcedBoots',
    slot: 'boots',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-reinforced-boots-v1', 'boots'],
    sourcePrefix: 'equipment_reinforced_boots_unified_v1',
    runtimePrefix: 'equipment_reinforced_boots',
    meshCount: 1,
    fitReportSha256: '464C7FB32BD4DB740CCB73A81EC2CB9BD14F1374F1593AE92CE409C84A66210E'
  },
  {
    itemId: 'scoutBoots',
    slot: 'boots',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-scout-boots-v1', 'boots'],
    sourcePrefix: 'equipment_scout_boots_unified_v1',
    runtimePrefix: 'equipment_scout_boots',
    meshCount: 1,
    fitReportSha256: '21E7C91E968CBB117392BFC0BED30A7DDD08AA5C588AF7CA60B0DE07D2E14BC4'
  },
  {
    itemId: 'preWarHelmet',
    slot: 'helmet',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-prewar-helmet-v1', 'helmet'],
    sourcePrefix: 'equipment_prewar_helmet_unified_v1',
    runtimePrefix: 'equipment_prewar_helmet',
    meshCount: 2,
    fitReportSha256: 'C7A1564C9D914338E654B7743AD9325C7B643EC3ED402AAF350C1150E6D055B7'
  },
  {
    itemId: 'weldedHelmet',
    slot: 'helmet',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-welded-helmet-v1', 'helmet'],
    sourcePrefix: 'equipment_welded_helmet_unified_v1',
    runtimePrefix: 'equipment_welded_helmet',
    meshCount: 1,
    fitReportSha256: 'FA57E7B38BC237B2D464EB305B237334734229FD105EB905F378A1D29562748A'
  },
  {
    itemId: 'helmet',
    slot: 'helmet',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-steel-helmet-v1', 'helmet'],
    sourcePrefix: 'equipment_steel_helmet_unified_v1',
    runtimePrefix: 'equipment_steel_helmet',
    meshCount: 1,
    fitReportSha256: '26CC38A7A718E7FCB7DA7DDF45512C3DC43D21508BBB148FCA6C1F30DCBF8AE6'
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
    meshCount: 2,
    fitReportSha256: 'B03B659C506DE62E37B15D8F7C980A7174B029B8E1E925FD9389CE110021AD99'
  },
  {
    itemId: 'energySuit',
    slot: 'armor',
    reviewDirectory: ['docs', 'art', 'reviews', 'unified-equipment-energy-suit-v1', 'suit'],
    sourcePrefix: 'equipment_energy_suit_unified_v1',
    runtimePrefix: 'equipment_energy_suit',
    meshCount: 2,
    fitReportSha256: '2545298E8590047243AC7DED3817EDA4C58886CA0BD41BFC5203C7EFF3BB7BA8'
  }
]);

function fromRoot(...segments) {
  return path.join(ROOT, ...segments);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function writeFileWithRetry(file, data) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.writeFileSync(file, data);
      return;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EPERM', 'UNKNOWN'].includes(error?.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
  throw lastError;
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
    root.extras.realm_source_license = 'CC0-1.0';
    root.extras.realm_source_creator = 'Quaternius';
    root.extras.realm_source_pack = 'Zombie Apocalypse Kit';
    root.extras.realm_source_page = 'https://quaternius.com/packs/zombieapocalypse.html';
    root.extras.realm_pilot_family = 'long_gun';
    root.scale = [1, 1, 1];
    if (metadata.weaponId === 'assaultRifle') {
      // Preserve the approved source bytes and grip geometry. Only seat the
      // two authored repair plates against the stock in the runtime adapter;
      // the old 5 mm air gap is not an intentional detachable assembly.
      for (const [name, x] of [['stock_repair_plate_l', 0.006], ['stock_repair_plate_r', -0.006]]) {
        const plate = nodes.find(node => node.name === name);
        if (!plate || plate.matrix) throw new Error(`Cannot seat rifle attachment: ${name}`);
        plate.translation = [...(plate.translation || [0, 0, 0])];
        plate.translation[0] += x;
        plate.extras = { ...(plate.extras || {}), realm_mount_surface: 'rifle_rebuilt_body' };
      }
      root.extras.realm_attachment_revision = 1;
    }
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  writeFileWithRetry(destination, encodeGlb(json, chunks));
  return { sourceSha256: sha256(source), runtimeSha256: sha256(destination) };
}

function verifyEquipmentReviews() {
  const variants = [];
  for (const definition of APPROVED_EQUIPMENT_REVIEWS) {
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
  const directory = fromRoot('docs', 'art', 'reviews', 'unified-humanoid-npc-v6', 'base');
  const glb = path.join(directory, 'npc_humanoid_base_unified_v6.glb');
  const reportFile = path.join(directory, 'npc_humanoid_base_unified_v6-report.json');
  const approvalFile = path.join(directory, 'CRITIC_APPROVAL_V6.md');
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
  const directory = fromRoot('docs', 'art', 'reviews', 'unified-style-v6', 'rifle');
  const gripDirectory = fromRoot('docs', 'art', 'reviews', 'unified-style-v5', 'rifle');
  const glb = path.join(directory, 'rifle_unified_v6.glb');
  const reportFile = path.join(directory, 'technical-report.json');
  const approvalFile = path.join(directory, 'RUNTIME_APPROVAL_RU.md');
  const heldFitFile = path.join(gripDirectory, 'held-fit-report.json');
  const gripRuntime = path.join(gripDirectory, 'assault_rifle_grip_runtime.glb');
  const gripReportFile = path.join(gripDirectory, 'assault_rifle_grip_runtime-report.json');
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
  const reload = report.actualGlb?.animations?.find(animation => animation.name === 'reload');
  if (
    report.interactionProfile !== 'physical_grips_reload_v2'
    || report.reloadPart !== 'magazine'
    || !reload?.targets?.includes('magazine')
    || !report.actualGlb?.nodes?.includes('socket_reload')
  ) {
    throw new Error('Assault-rifle v6 has no verified physical magazine reload');
  }
  if (heldFit.supportHandPose?.palmRollDeltaFromPreviousDegrees !== 180) {
    throw new Error('Approved 180-degree support-wrist correction is missing');
  }
  if (sha256(gripRuntime) !== GRIP_RUNTIME_SHA256 || gripReport.sha256 !== GRIP_RUNTIME_SHA256) {
    throw new Error('Runtime grip donor differs from the exported approved held pose');
  }
  return { glb, gripRuntime };
}

function refreshApprovedWeaponManifest() {
  const file = fromRoot('public', 'assets', 'models', 'approved-humanoid-assets.json');
  if (!fs.existsSync(file)) throw new Error('Approved humanoid manifest must be built first');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const updates = [];
  for (const [id, approval] of [['assaultRifle', RIFLE_REVIEW_SHA256], ['assaultRifleGrip', GRIP_RUNTIME_SHA256]]) {
    const row = manifest.files.find(entry => entry.id === id);
    if (!row || row.sourceSha256 !== approval) throw new Error(`Unapproved weapon manifest row: ${id}`);
    const runtime = fromRoot('public', row.file.replace(/^\//, ''));
    if (id === 'assaultRifle') {
      const { json } = parseGlb(runtime);
      const approved = json.nodes?.find(node => node.extras?.realm_weapon_id === id);
      if (approved?.extras?.realm_approved_review_sha256 !== approval) throw new Error('Rifle approval mismatch');
    } else if (sha256(runtime) !== approval) throw new Error('Grip approval mismatch');
    updates.push([row, { bytes: fs.statSync(runtime).size, runtimeSha256: sha256(runtime) }]);
  }
  for (const [row, stats] of updates) Object.assign(row, stats);
  writeFileWithRetry(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('Approved weapon manifest synchronized; runtime models unchanged.');
}

function main(options = {}) {
  const weaponsOnly = options.weaponsOnly === true;
  const npcSource = weaponsOnly ? null : verifyNpcReview();
  const boots = weaponsOnly ? [] : verifyBootReviews();
  const equipment = weaponsOnly ? [] : verifyEquipmentReviews();
  const rifle = verifyRifleReview();
  const rows = [];

  if (!weaponsOnly) {
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

  }

  const rifleOutput = fromRoot('public', 'assets', 'models', 'weapons', 'weapon_assaultRifle.glb');
  rows.push({
    id: 'assaultRifle',
    file: '/assets/models/weapons/weapon_assaultRifle.glb',
    ...makeRuntimeGlb(rifle.glb, rifleOutput, {
      approvedReviewSha256: RIFLE_REVIEW_SHA256,
      runtimeAssetId: 'assaultRifle',
      sourceRootName: 'weapon_rifle_unified_v6',
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
    meshes: 4,
    runtimeScale: 1,
    boundsMeters: {
      min: [-0.037, -0.395, -0.1],
      max: [0.037, 0.655, 0.22]
    },
    animations: ['idle', 'attack', 'reload'],
    gripSockets: ['socket_grip_r', 'socket_grip_l', 'socket_reload'],
      reloadKind: 'magazine',
      reloadPart: 'magazine',
      pilotFamily: 'long_gun',
      approvedReviewSha256: RIFLE_REVIEW_SHA256,
      source: {
        creator: 'Quaternius',
        pack: 'Zombie Apocalypse Kit',
        page: 'https://quaternius.com/packs/zombieapocalypse.html',
        license: 'CC0-1.0',
        sourceFile: null,
        sha256: null,
        note: 'Rifle.gltf rebuilt and critic-approved; approval hash is the integration gate.'
      }
  });
  writeFileWithRetry(weaponManifestFile, `${JSON.stringify(weaponManifest, null, 2)}\n`);

  const gripOutput = fromRoot('public', 'assets', 'models', 'weapons', 'approved_assault_rifle_grip.glb');
  fs.mkdirSync(path.dirname(gripOutput), { recursive: true });
  fs.copyFileSync(rifle.gripRuntime, gripOutput);
  rows.push({
    id: 'assaultRifleGrip',
    file: '/assets/models/weapons/approved_assault_rifle_grip.glb',
    sourceSha256: GRIP_RUNTIME_SHA256,
    runtimeSha256: sha256(gripOutput)
  });

  if (weaponsOnly) {
    refreshApprovedWeaponManifest();
    console.log(`Approved weapon assets built: ${rows.length} files`);
    return { files: rows };
  }

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
  writeFileWithRetry(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Approved humanoid assets built: ${rows.length} files`);
  return manifest;
}

if (require.main === module) {
  try {
    if (process.argv.includes('--refresh-weapon-manifest')) refreshApprovedWeaponManifest();
    else main();
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
  refreshApprovedWeaponManifest,
  main
};
