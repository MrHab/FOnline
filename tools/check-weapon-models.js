const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modelDirectory = path.join(root, 'public', 'assets', 'models', 'weapons');
const liteModelDirectory = path.join(root, 'public', 'assets', 'models-lite', 'weapons');
const manifestPath = path.join(modelDirectory, 'manifest.json');
const itemsPath = path.join(root, 'data', 'kromka', 'items.json');
const unityWeaponDataPath = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaWeaponData.cs');
const unityWeaponViewPath = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaWeaponView.cs');
const unityModelUrlPath = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaModelUrl.cs');

const expected = new Map([
  ['pistol', { family: 'sidearm', scale: 0.34, length: [0.24, 0.38], nodes: ['muzzle', 'breech_cap'], reloadKind: 'shells', reloadPart: 'breech_cap' }],
  ['rifle', { family: 'long_gun', scale: 0.52, length: [0.90, 1.20], nodes: ['muzzle', 'bolt'], reloadKind: 'bolt_clip', reloadPart: 'cartridge_clip' }],
  ['assaultRifle', {
    family: 'long_gun',
    scale: 1,
    length: [1.04, 1.06],
    nodes: ['socket_muzzle', 'socket_grip_l', 'socket_grip_r'],
    reloadKind: 'magazine',
    reloadPart: 'magazine',
    approved: true,
    minMeshes: 3,
    maxBytes: 600_000
  }],
  ['machineGun', { family: 'heavy', scale: 0.56, length: [1.00, 1.28], nodes: ['muzzle', 'ammo_box'], reloadKind: 'ammo_box', reloadPart: 'ammo_box' }],
  ['laserPistol', { family: 'energy_sidearm', scale: 0.40, length: [0.32, 0.48], nodes: ['muzzle', 'energy_core'], reloadKind: 'energy_cell', reloadPart: 'energy_core' }],
  ['flamethrower', { family: 'heavy', scale: 0.55, length: [0.90, 1.22], nodes: ['pilot', 'fuel_tank'], reloadKind: 'fuel_tank', reloadPart: 'fuel_tank' }],
  ['plasmaRifle', { family: 'energy_long_gun', scale: 0.54, length: [0.88, 1.18], nodes: ['muzzle', 'energy_core'], reloadKind: 'energy_cell', reloadPart: 'energy_core' }],
  ['shotgun', { family: 'long_gun', scale: 0.52, length: [0.90, 1.20], nodes: ['muzzle', 'pump'], reloadKind: 'shells', reloadPart: 'reload_shell' }],
  ['rocketLauncher', { family: 'launcher', scale: 0.58, length: [1.00, 1.26], nodes: ['muzzle', 'launcher_tube'], reloadKind: 'rocket', reloadPart: 'rocket_round' }],
  ['revolver', { family: 'sidearm', scale: 0.36, length: [0.27, 0.42], nodes: ['muzzle', 'cylinder'], reloadKind: 'shells', reloadPart: 'cylinder' }],
  ['sawedOffShotgun', { family: 'sidearm', scale: 0.42, length: [0.28, 0.44], nodes: ['muzzle', 'reload_shell'], reloadKind: 'shells', reloadPart: 'reload_shell' }],
  ['smg', { family: 'long_gun', scale: 0.48, length: [0.46, 0.66], nodes: ['muzzle', 'magazine'], reloadKind: 'magazine', reloadPart: 'magazine' }],
  ['knife', { family: 'melee_light', scale: 0.22, length: [0.25, 0.36], nodes: ['blade', 'grip'], reloadKind: 'none', hands: 1 }],
  ['pickaxe', { family: 'melee_heavy', scale: 0.45, length: [0.68, 0.90], nodes: ['head_socket', 'pick_left'], reloadKind: 'none', hands: 2 }],
  ['axe', { family: 'melee_heavy', scale: 0.44, length: [0.68, 0.90], nodes: ['blade', 'handle'], reloadKind: 'none', hands: 2 }],
  ['handPump', { family: 'melee_heavy', scale: 0.50, length: [0.62, 0.84], nodes: ['pump_handle', 'nozzle'], reloadKind: 'none', hands: 2 }]
]);
const requiredAnimations = ['idle', 'attack'];
const reloadAnimationWeapons = [...expected]
  .filter(([, config]) => Boolean(config.reloadPart))
  .map(([id]) => id);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', `${file}: invalid GLB magic`);
  assert.strictEqual(data.readUInt32LE(4), 2, `${file}: glTF 2 is required`);
  assert.strictEqual(data.readUInt32LE(8), data.length, `${file}: stale GLB byte length`);
  let json = null;
  let offset = 12;
  while (offset + 8 <= data.length) {
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 'JSON') {
      json = JSON.parse(chunk.toString('utf8').replace(/\0+$/g, '').trim());
    }
    offset += 8 + chunkLength;
  }
  assert(json, `${file}: JSON chunk is missing`);
  return { data, json };
}

assert(fs.existsSync(manifestPath), 'weapon model manifest is missing');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.strictEqual(manifest.schema, 'realm.weapon-model-catalog.v1');
assert.strictEqual(manifest.version, 2);
assert.strictEqual(manifest.artDirection, 'geometry_b_materials_c');
assert.strictEqual(manifest.interactionProfile, 'physical_grips_reload_v2');
assert.deepStrictEqual(manifest.requiredAnimations, requiredAnimations);
assert.deepStrictEqual(manifest.reloadAnimationWeapons, reloadAnimationWeapons);
assert.strictEqual(manifest.files?.length, expected.size);

const manifestById = new Map(manifest.files.map(row => [row.id, row]));
const attachmentReport = JSON.parse(fs.readFileSync(path.join(modelDirectory, 'attachment-report.json'), 'utf8'));
assert.strictEqual(attachmentReport.toleranceMetres, 0.002, 'attachment gap tolerance must remain 2 mm');
const attachmentsById = new Map(attachmentReport.weapons.map(row => [row.weapon, row]));
assert.strictEqual(attachmentsById.size, expected.size, 'attachment audit must cover the complete catalog');
const movingAttachments = {
  laserPistol: { emitter_ring: 'muzzle' },
  rifle: { bolt_knob: 'bolt' },
  machineGun: { ammo_box_lid: 'ammo_box', ammo_box_latch: 'ammo_box' },
  smg: { magazine_base: 'magazine' },
  flamethrower: { pressure_gauge: 'fuel_tank', gauge_face: 'pressure_gauge', fuel_valve: 'fuel_tank', pilot: 'muzzle' }
};
function checkAttachments(json, id, label) {
  const parents = new Map();
  (json.nodes || []).forEach(node => (node.children || []).forEach(index => parents.set(index, node.name)));
  for (const [child, parent] of Object.entries(movingAttachments[id] || {})) {
    const index = json.nodes.findIndex(node => node.name === child);
    assert(index >= 0, `${id}/${label}: attachment missing: ${child}`);
    assert.strictEqual(parents.get(index), parent, `${id}/${label}: ${child} must follow ${parent}`);
  }
}
assert.deepStrictEqual(
  [...manifestById.keys()].sort(),
  [...expected.keys()].sort(),
  'weapon manifest does not match the complete physical weapon catalog'
);
const expectedPilots = new Map([...expected]
  .filter(([id]) => id !== 'pickaxe' && id !== 'handPump')
  .map(([id, config]) => [id, config.family]));
const pilotRows = manifest.files.filter(row => row.pilotFamily);
assert.strictEqual(pilotRows.length, expectedPilots.size,
  'every firearm, knife and axe must use a replacement, not just one representative per family');
for (const [id, family] of expectedPilots) {
  const row = manifestById.get(id);
  assert.strictEqual(row?.pilotFamily, family, `${family}: wrong pilot representative`);
  assert.strictEqual(row?.source?.license, 'CC0-1.0', `${id}: pilot license is not pinned`);
  assert(/^https:\/\//.test(row?.source?.page || ''), `${id}: pilot source page is missing`);
  if (row.source.sourceFile) {
    const sourceFile = path.join(root, 'source-assets', 'weapons', 'pilot', row.source.sourceFile);
    assert(fs.existsSync(sourceFile), `${id}: selected source file is missing`);
    assert.strictEqual(sha256(sourceFile), row.source.sha256, `${id}: selected source hash drifted`);
  } else {
    assert(row.approvedReviewSha256, `${id}: approved pilot has neither a source file nor a review gate`);
  }
}

let totalBytes = 0;
let totalMeshes = 0;
let totalAnimationChannels = 0;
let checkedLiteModels = 0;
for (const [id, config] of expected) {
  const row = manifestById.get(id);
  assert(row, `${id}: manifest row is missing`);
  const attachment = attachmentsById.get(id);
  assert(attachment && attachment.sha256 === row.sha256, `${id}: attachment audit is stale`);
  assert.deepStrictEqual(attachment.detached, [], `${id}: visible parts float outside the assembly`);
  assert(attachment.animationPoseChecks >= 16, `${id}: attachment animation sampling is missing`);
  assert.strictEqual(row.family, config.family, `${id}: wrong animation family`);
  assert.strictEqual(row.runtimeScale, config.scale, `${id}: wrong runtime scale`);
  assert(
    row.boundsMeters && Array.isArray(row.boundsMeters.min) && Array.isArray(row.boundsMeters.max),
    `${id}: scaled bounds are missing`
  );
  const runtimeLength = row.boundsMeters.max[1] - row.boundsMeters.min[1];
  assert(
    Number.isFinite(runtimeLength)
      && runtimeLength >= config.length[0]
      && runtimeLength <= config.length[1],
    `${id}: runtime length ${runtimeLength}m is outside ${config.length[0]}-${config.length[1]}m`
  );
  const expectedAnimations = config.reloadPart ? [...requiredAnimations, 'reload'] : requiredAnimations;
  assert.deepStrictEqual(row.animations, expectedAnimations, `${id}: manifest animations drifted`);
  const expectedGripSockets = config.reloadPart
    ? ['socket_grip_r', 'socket_grip_l', 'socket_reload']
    : (config.hands === 2 ? ['socket_grip_r', 'socket_grip_l'] : ['socket_grip_r']);
  assert.deepStrictEqual(row.gripSockets, expectedGripSockets, `${id}: manifest grip sockets drifted`);
  assert.strictEqual(row.reloadKind, config.reloadKind, `${id}: manifest reload kind drifted`);
  assert.strictEqual(row.reloadPart ?? null, config.reloadPart || null, `${id}: manifest reload part drifted`);
  const file = path.join(root, 'public', row.file.replace(/^\//, ''));
  assert(fs.existsSync(file), `${id}: GLB file is missing`);
  assert.strictEqual(fs.statSync(file).size, row.bytes, `${id}: manifest byte size is stale`);
  assert.strictEqual(sha256(file), row.sha256, `${id}: manifest hash is stale`);
  assert(
    row.bytes > 40_000 && row.bytes < Number(config.maxBytes || 420_000),
    `${id}: unexpected runtime model weight ${row.bytes}`
  );

  const { data, json } = parseGlb(file);
  totalBytes += data.length;
  totalMeshes += json.meshes?.length || 0;
  assert.strictEqual(json.scenes?.length, 1, `${id}: GLB must have one scene`);
  assert((json.meshes?.length || 0) >= Number(config.minMeshes || 5), `${id}: silhouette is too simple`);
  assert((json.materials?.length || 0) >= 4, `${id}: B+C material separation is missing`);
  assert((json.images?.length || 0) >= 4, `${id}: embedded wear textures are missing`);
  assert((json.buffers || []).every(buffer => !buffer.uri), `${id}: external buffers are not allowed`);
  json.images.forEach(image => {
    assert(Number.isInteger(image.bufferView), `${id}: texture is not embedded`);
    assert(!image.uri, `${id}: external texture URI is not allowed`);
    assert.strictEqual(image.mimeType, 'image/png', `${id}: texture must be PNG`);
  });

  const names = new Set((json.nodes || []).map(node => node.name));
  config.nodes.forEach(name => assert(names.has(name), `${id}: required animated/readable part is missing: ${name}`));
  expectedGripSockets.forEach(name => assert(names.has(name), `${id}: interaction socket is missing: ${name}`));
  if (config.reloadPart) assert(names.has(config.reloadPart), `${id}: physical reload part is missing: ${config.reloadPart}`);
  const rootNode = (json.nodes || []).find(node => node.extras?.realm_weapon_id === id);
  assert(rootNode, `${id}: runtime root metadata is missing`);
  assert.strictEqual(rootNode.extras.realm_attachment_revision, 1, `${id}: attachment repair is missing`);
  checkAttachments(json, id, 'original');
  if (!config.approved) {
    assert.strictEqual(row.modelRevision, 3, `${id}: old model catalog entry`);
    assert.strictEqual(rootNode.extras.realm_model_revision, 3, `${id}: old geometry is still shipped`);
    if (row.source) {
      assert.strictEqual(rootNode.extras.realm_source_sha256, row.source.sha256,
        `${id}: source hash must describe the actual runtime mesh`);
      assert(json.meshes.some(mesh => mesh.name?.includes('_CC0')),
        `${id}: imported replacement geometry is missing`);
    }
  }
  assert.strictEqual(
    rootNode.extras.realm_schema,
    config.approved ? 'realm.weapon-runtime.approved.v1' : 'realm.weapon-runtime.v1'
  );
  assert.strictEqual(rootNode.extras.realm_animation_family, config.family);
  assert.strictEqual(rootNode.extras.realm_art_direction, 'geometry_b_materials_c');
  assert.strictEqual(rootNode.extras.realm_runtime_scale, config.scale);
  assert.strictEqual(rootNode.extras.realm_interaction_profile, 'physical_grips_reload_v2');
  assert.strictEqual(rootNode.extras.realm_reload_kind, config.reloadKind);
  if (row.pilotFamily) {
    assert.strictEqual(rootNode.extras.realm_pilot_family, row.pilotFamily, `${id}: pilot metadata drifted`);
    assert.strictEqual(rootNode.extras.realm_source_license, 'CC0-1.0', `${id}: root license metadata drifted`);
  }
  assert(Array.isArray(rootNode.scale) && rootNode.scale.length === 3, `${id}: root scale is missing`);
  rootNode.scale.forEach(value => {
    assert(Math.abs(value - config.scale) < 1e-6, `${id}: exported root scale drifted`);
  });

  const animations = new Map((json.animations || []).map(animation => [animation.name, animation]));
  assert.deepStrictEqual([...animations.keys()].sort(), [...expectedAnimations].sort(), `${id}: GLB clips drifted`);
  expectedAnimations.forEach(name => {
    const animation = animations.get(name);
    assert((animation.channels?.length || 0) >= 2, `${id}/${name}: animation has no useful channels`);
    totalAnimationChannels += animation.channels.length;
  });
  if (config.reloadPart) {
    const reloadTargets = new Set((animations.get('reload')?.channels || []).map(channel => (
      json.nodes[channel.target.node]?.name
    )));
    assert(reloadTargets.has(config.reloadPart), `${id}: reload clip does not move ${config.reloadPart}`);
  }

  const materialNames = (json.materials || []).map(material => String(material.name || ''));
  assert(
    config.approved
      ? materialNames.some(name => name.includes('old_gunmetal') || name.includes('weathered_walnut'))
      : materialNames.some(name => name.startsWith('WPN_') && name.endsWith('_WORN')),
    `${id}: worn B+C material naming is missing`
  );
  if (config.approved) {
    assert.strictEqual(
      row.approvedReviewSha256,
      '322D14E2D07059AB4458C65CB0E6B7019B8F030F3386B05016908E41E6591FC6'
    );
    assert.strictEqual(rootNode.extras.realm_runtime_integration_allowed, true);
    assert.strictEqual(rootNode.extras.realm_approved_review_sha256, row.approvedReviewSha256);
  }

  // Unity requests /assets/models-lite/* first. Those files are generated and
  // gitignored, so a local build can otherwise keep showing an older weapon
  // even after the authoritative GLB was replaced. Missing lite files are OK:
  // server.js falls back to /assets/models/*. Existing ones must describe the
  // same pilot revision and interaction contract as the authoritative model.
  const liteFile = path.join(liteModelDirectory, `weapon_${id}.glb`);
  if (fs.existsSync(liteFile)) {
    checkedLiteModels++;
    const { json: liteJson } = parseGlb(liteFile);
    const liteRoot = (liteJson.nodes || []).find(node => node.extras?.realm_weapon_id === id);
    assert(liteRoot, `${id}: models-lite copy is stale (runtime root metadata is missing)`);
    assert.strictEqual(liteRoot.extras.realm_attachment_revision, 1, `${id}: models-lite attachment repair is stale`);
    checkAttachments(liteJson, id, 'lite');
    assert.strictEqual(liteRoot.extras.realm_schema, rootNode.extras.realm_schema,
      `${id}: models-lite schema is stale`);
    if (!config.approved) {
      assert.strictEqual(liteRoot.extras.realm_model_revision, row.modelRevision,
        `${id}: models-lite geometry revision is stale`);
    }
    assert.strictEqual(liteRoot.extras.realm_animation_family, row.family,
      `${id}: models-lite family is stale`);
    assert.strictEqual(liteRoot.extras.realm_interaction_profile, manifest.interactionProfile,
      `${id}: models-lite interaction profile is stale`);
    assert.strictEqual(liteRoot.extras.realm_reload_kind, row.reloadKind,
      `${id}: models-lite reload kind is stale`);

    const liteNames = new Set((liteJson.nodes || []).map(node => node.name));
    expectedGripSockets.forEach(name => assert(liteNames.has(name),
      `${id}: models-lite interaction socket is missing: ${name}`));
    assert.deepStrictEqual(
      (liteJson.animations || []).map(animation => animation.name).sort(),
      [...expectedAnimations].sort(),
      `${id}: models-lite clips are stale`
    );

    if (row.pilotFamily) {
      assert.strictEqual(liteRoot.extras.realm_pilot_family, row.pilotFamily,
        `${id}: models-lite still contains the pre-pilot weapon`);
      assert.strictEqual(liteRoot.extras.realm_source_license, row.source.license,
        `${id}: models-lite source license is stale`);
      assert.strictEqual(liteRoot.extras.realm_source_page, row.source.page,
        `${id}: models-lite source page is stale`);
      assert.strictEqual(liteRoot.extras.realm_source_sha256 || null, row.source.sha256 || null,
        `${id}: models-lite source revision is stale`);
      if (config.approved) {
        assert.strictEqual(liteRoot.extras.realm_approved_review_sha256, row.approvedReviewSha256,
          `${id}: models-lite approved revision is stale`);
      }
    }
  }
}
assert(totalBytes < 5_000_000, `weapon library exceeds the 5 MB budget: ${totalBytes}`);

// Every hand-held weapon or tool in the item catalog must have a physical GLB.
const kromkaItems = JSON.parse(fs.readFileSync(itemsPath, 'utf8')).items || [];
const physicalItemIds = kromkaItems
  .filter(item => item.slot === 'weapon' && ['weapons', 'tools'].includes(item.category))
  .map(item => item.id)
  .filter(id => id !== 'fists');
assert.deepStrictEqual(
  [...new Set(physicalItemIds)].sort(),
  [...expected.keys()].sort(),
  'a weapon/tool item has no physical GLB model'
);

// Unity loads /assets/models/weapons/weapon_<id>.glb for every weapon id in
// its catalog, so the catalog and the physical library must stay identical.
const unityWeaponData = fs.readFileSync(unityWeaponDataPath, 'utf8');
const unityWeaponIds = [...unityWeaponData.matchAll(/^\s*Add\("([A-Za-z][A-Za-z0-9]*)"/gm)]
  .map(match => match[1])
  .filter(id => id !== 'fists');
assert.deepStrictEqual(
  [...new Set(unityWeaponIds)].sort(),
  [...expected.keys()].sort(),
  'a Unity weapon catalog entry has no physical GLB model'
);
const unityWeaponView = fs.readFileSync(unityWeaponViewPath, 'utf8');
assert(unityWeaponView.includes('"/assets/models/weapons/weapon_" + weaponId + ".glb"'),
  'Unity weapon view no longer loads the physical weapon GLB library');

// Nginx отдаёт модели с max-age 30 дней и immutable, а Unity версионирует URL
// оружия только строкой WeaponCatalogVersion (RoaModelUrl.Lite добавляет
// ?v=weapon-catalog-…). Пересборка GLB без её подъёма оставляет игрокам старые
// модели: так после добавления socket_muzzle доворот оружия месяц работал бы
// только на автомате, чей файл не изменился. Поэтому строка обязана содержать
// отпечаток самих моделей — его публикует tools/build-weapon-runtime-models.js.
const weaponModelDigest = (() => {
  const hash = crypto.createHash('sha256');
  for (const file of fs.readdirSync(modelDirectory).filter(name => /^weapon_.*\.glb$/.test(name)).sort()) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(modelDirectory, file)));
  }
  return hash.digest('hex').slice(0, 8);
})();
const unityModelUrl = fs.readFileSync(unityModelUrlPath, 'utf8');
const unityAssetVersion = unityModelUrl.match(/WeaponCatalogVersion\s*=\s*"([^"]+)"/)?.[1] || '';
assert.strictEqual(unityAssetVersion, `3-${weaponModelDigest}`,
  'Unity must request the current content fingerprint, not a fixed catalog version');

console.log(
  `Weapon models OK: ${expected.size} GLB, ${totalMeshes} meshes, `
  + `${totalAnimationChannels} animation channels, ${totalBytes} bytes`
  + (checkedLiteModels > 0 ? `; ${checkedLiteModels} models-lite copies aligned` : '')
);
