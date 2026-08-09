const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modelDirectory = path.join(root, 'public', 'assets', 'models', 'weapons');
const manifestPath = path.join(modelDirectory, 'manifest.json');
const clientItemsPath = path.join(root, 'public', 'js', 'game', '03_items_inventory_core.js');
const runtimePath = path.join(root, 'public', 'js', 'game', '04c_weapon_glb_runtime.js');
const visualsPath = path.join(root, 'public', 'js', 'game', '04_player_model_visuals.js');
const modernRuntimePath = path.join(root, 'public', 'js', 'game', '04a_player_model_modern_runtime.js');
const remotePath = path.join(root, 'public', 'js', 'game', '05a_remote_actor_equipment.js');
const loaderPath = path.join(root, 'public', 'js', 'game.js');
const loadingPath = path.join(root, 'public', 'js', 'game', '13_minimap_hud_loop.js');

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
assert.deepStrictEqual(
  [...manifestById.keys()].sort(),
  [...expected.keys()].sort(),
  'weapon manifest does not match the complete physical weapon catalog'
);

let totalBytes = 0;
let totalMeshes = 0;
let totalAnimationChannels = 0;
for (const [id, config] of expected) {
  const row = manifestById.get(id);
  assert(row, `${id}: manifest row is missing`);
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
  assert.strictEqual(
    rootNode.extras.realm_schema,
    config.approved ? 'realm.weapon-runtime.approved.v1' : 'realm.weapon-runtime.v1'
  );
  assert.strictEqual(rootNode.extras.realm_animation_family, config.family);
  assert.strictEqual(rootNode.extras.realm_art_direction, 'geometry_b_materials_c');
  assert.strictEqual(rootNode.extras.realm_runtime_scale, config.scale);
  assert.strictEqual(rootNode.extras.realm_interaction_profile, 'physical_grips_reload_v2');
  assert.strictEqual(rootNode.extras.realm_reload_kind, config.reloadKind);
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
}
assert(totalBytes < 5_000_000, `weapon library exceeds the 5 MB budget: ${totalBytes}`);

const clientItems = fs.readFileSync(clientItemsPath, 'utf8');
const physicalClientIds = [...clientItems.matchAll(
  /^\s{4}([A-Za-z][A-Za-z0-9]*): \{[^\n]+(?:type: 'weapon'|equipSlot: 'weapon')[^\n]+dmg: \[[^\n]+\},$/gm
)].map(match => match[1]).filter(id => id !== 'fists');
assert.deepStrictEqual(
  [...new Set(physicalClientIds)].sort(),
  [...expected.keys()].sort(),
  'a client weapon/tool has no physical GLB model'
);

const runtime = fs.readFileSync(runtimePath, 'utf8');
for (const [id, config] of expected) {
  assert(runtime.includes(`${id}: { file: '/assets/models/weapons/weapon_${id}.glb', family: '${config.family}' }`),
    `${id}: runtime catalog entry is missing`);
}
[
  'function preloadWeaponModelLibrary()',
  'function makeWeaponModelMesh(',
  'function triggerWeaponModelAction(',
  'function updateWeaponModelAnimation(',
  "const WEAPON_MODEL_ASSET_VERSION = '7.93.0-deterministic-weapons-v1-b13d09c0';",
  "function triggerWeaponModelAction(weaponGroup, actionName = 'attack', options = {})",
  'Number(clip.duration) / requestedDuration',
  "action.setLoop(THREE.LoopOnce, 1)"
].forEach(marker => assert(runtime.includes(marker), `weapon runtime integration is missing: ${marker}`));

const visuals = fs.readFileSync(visualsPath, 'utf8');
assert(visuals.includes("triggerWeaponModelAction(weaponGroup, 'attack')"));
assert(visuals.includes('updateWeaponModelAnimation(weaponGroup, dt)'));
assert(visuals.includes('makeWeaponModelMesh(weaponId)'));
const modernRuntime = fs.readFileSync(modernRuntimePath, 'utf8');
assert(modernRuntime.includes("triggerWeaponModelAction(weaponGroup, 'reload', { duration: reloadDuration })"));
assert(modernRuntime.includes('applyApprovedWeaponGrip(actor, weaponId)'));
const remote = fs.readFileSync(remotePath, 'utf8');
assert(remote.includes('makeWeaponModelMesh(weaponId)'));
assert(remote.includes('!obj.userData?.weaponSharedAsset'));
const loader = fs.readFileSync(loaderPath, 'utf8');
assert(loader.includes("'/js/game/04c_weapon_glb_runtime.js'"));
const loading = fs.readFileSync(loadingPath, 'utf8');
assert(loading.includes('await preloadWeaponModelLibrary();'));

// Nginx отдаёт модели с max-age 30 дней и immutable, а URL версионируется
// только строкой WEAPON_MODEL_ASSET_VERSION. Пересборка GLB без её подъёма
// оставляет игрокам старые модели: так после добавления socket_muzzle доворот
// оружия месяц работал бы только на автомате, чей файл не изменился. Поэтому
// строка обязана содержать отпечаток самих моделей — забыть его нельзя.
const weaponModelDigest = (() => {
  const hash = crypto.createHash('sha256');
  for (const file of fs.readdirSync(modelDirectory).filter(name => /^weapon_.*\.glb$/.test(name)).sort()) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(modelDirectory, file)));
  }
  return hash.digest('hex').slice(0, 8);
})();
const declaredAssetVersion = runtime.match(/WEAPON_MODEL_ASSET_VERSION\s*=\s*'([^']+)'/)?.[1] || '';
assert(
  declaredAssetVersion.endsWith(`-${weaponModelDigest}`),
  `WEAPON_MODEL_ASSET_VERSION должна оканчиваться отпечатком моделей -${weaponModelDigest}, `
  + `сейчас '${declaredAssetVersion}'. Модели пересобраны — поднимите версию в `
  + `public/js/game/04c_weapon_glb_runtime.js и в этой проверке, иначе браузеры `
  + `продолжат брать старые GLB из immutable-кэша.`
);

console.log(
  `Weapon models OK: ${expected.size} GLB, ${totalMeshes} meshes, `
  + `${totalAnimationChannels} animation channels, ${totalBytes} bytes`
);
