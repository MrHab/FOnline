const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fail = message => {
  console.error(`Graphics upgrade check failed: ${message}`);
  process.exit(1);
};
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) fail(label);
};
const functionSource = (source, name) => {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  return '';
};

const renderer = read('public/js/game/02_renderer_world_map.js');
const materials = read('public/js/game/02a_materials_static_models.js');
const globalMap = read('public/js/game/11b_global_map_static_scene_camera.js');
const hudLoop = read('public/js/game/13_minimap_hud_loop.js');
const modelBuilder = read('tools/build-wasteland-models.js');

requireText(renderer, 'const REAL_SHADOWS_TEMP_DISABLED = false;', 'desktop real shadows must not be emergency-disabled');
const numericConst = (source, name) => {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9.]+)`));
  if (!match) fail(`missing numeric constant ${name}`);
  return Number(match[1]);
};
const maxRenderFps = numericConst(hudLoop, 'MAX_RENDER_FPS');
const adaptiveDownFps = numericConst(renderer, 'ADAPTIVE_RENDER_SCALE_DOWN_FPS');
const adaptiveUpFps = numericConst(renderer, 'ADAPTIVE_RENDER_SCALE_UP_FPS');
const adaptiveRecoverySeconds = numericConst(renderer, 'ADAPTIVE_RENDER_SCALE_RECOVERY_SECONDS');
if (adaptiveUpFps > maxRenderFps) fail('adaptive render scale cannot recover above the render-loop FPS cap');
if (adaptiveDownFps >= adaptiveUpFps) fail('adaptive render scale must retain an FPS hysteresis band');
if (adaptiveRecoverySeconds < 2) fail('adaptive render scale recovery must require a sustained healthy frame rate');
requireText(renderer, 'adaptiveRenderScaleRecoveryTimer += sampleSeconds;', 'adaptive render scale recovery dwell is missing');
requireText(renderer, '!gameStarted || !renderer || document.hidden', 'inactive/hidden adaptive sampling guard is missing');
requireText(renderer, "document.body.classList.contains('global-map-mode')", 'global-map adaptive sampling guard is missing');
const samplingResetSource = functionSource(renderer, 'resetAdaptiveRenderScaleSampling');
const resetSamplingTimers = new Function(`${samplingResetSource}
  let adaptiveRenderScaleTimer = 2.5;
  let adaptiveRenderScaleRecoveryTimer = 2.5;
  resetAdaptiveRenderScaleSampling();
  return [adaptiveRenderScaleTimer, adaptiveRenderScaleRecoveryTimer];`);
if (resetSamplingTimers().some(value => value !== 0)) {
  fail('paused adaptive sampling carries stale local/global FPS dwell');
}
const highStart = renderer.indexOf("    high: {");
const ultraStart = renderer.indexOf("    ultra: {");
const presetsEnd = renderer.indexOf("\n  };", ultraStart);
const highBlock = highStart >= 0 && ultraStart > highStart ? renderer.slice(highStart, ultraStart) : '';
const ultraBlock = ultraStart >= 0 && presetsEnd > ultraStart ? renderer.slice(ultraStart, presetsEnd) : '';
if (!/shadows:\s*true/.test(highBlock)) fail('High preset must enable real shadows');
if (!/shadows:\s*true/.test(ultraBlock)) fail('Ultra preset must enable real shadows');
if (!/mobileShadows:\s*false/.test(highBlock) || !/mobileShadows:\s*false/.test(ultraBlock)) {
  fail('mobile presets must retain the scalable contact-shadow path');
}

requireText(materials, 'wasteland_ground_albedo_v777.webp', 'new wasteland albedo is not integrated');
requireText(materials, "normalMap: useReliefPbrMaps", 'wasteland ground must retain a normal map');
requireText(materials, 'function enhanceStaticModelMaterial', 'static GLB material enhancement is missing');
requireText(materials, "'v7.76-rich'", 'rich static-model material tier is missing');
requireText(materials, 'function refreshStaticModelVisualQuality', 'runtime model quality refresh is missing');

requireText(globalMap, 'new THREE.MeshStandardMaterial({', 'global map terrain must use PBR material');
requireText(globalMap, 'THREE.ACESFilmicToneMapping', 'global map ACES tone mapping is missing');
requireText(globalMap, 'function globalMapRichShadowsEnabled', 'global map shadow quality gate is missing');
requireText(globalMap, 'GLOBAL_MAP_3D.renderer.shadowMap.type = THREE.PCFSoftShadowMap;', 'global map soft shadows are missing');

requireText(modelBuilder, 'function beveledUnitBoxGeometry', 'beveled hard-surface geometry builder is missing');
requireText(modelBuilder, 'bevelSegments: 2', 'model bevel quality regressed');
requireText(modelBuilder, 'Math.max(12, Number(segments || 12))', 'cylinder smoothing floor regressed');
requireText(modelBuilder, 'new THREE.SphereBufferGeometry(radius, 20, 14)', 'sphere smoothing quality regressed');

const pngPath = path.join(root, 'source-assets/wasteland/wasteland_ground_albedo_v777.png');
const webpPath = path.join(root, 'public/assets/textures/wasteland/wasteland_ground_albedo_v777.webp');
const provenancePath = path.join(root, 'public/assets/textures/wasteland/GENERATED_TEXTURES.md');
for (const file of [pngPath, webpPath, provenancePath]) {
  if (!fs.existsSync(file)) fail(`missing asset: ${path.relative(root, file)}`);
}

const png = fs.readFileSync(pngPath);
if (png.length < 24 || png.toString('hex', 0, 8) !== '89504e470d0a1a0a') fail('ground source is not a valid PNG');
const pngWidth = png.readUInt32BE(16);
const pngHeight = png.readUInt32BE(20);
if (pngWidth < 1024 || pngHeight < 1024 || pngWidth !== pngHeight) fail(`ground source must be square and at least 1K, got ${pngWidth}x${pngHeight}`);

const webp = fs.readFileSync(webpPath);
if (webp.length < 200000 || webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') {
  fail('runtime ground asset is not a valid high-detail WebP');
}

const rebuiltModels = [
  'car_wreck.glb',
  'trade_machine.glb',
  'craft_station_ammo.glb',
  'craft_station_weapon.glb',
  'craft_station_tools.glb',
  'craft_station_repair.glb',
  'craft_station_energy.glb',
  'craft_station_chem.glb'
];
for (const file of rebuiltModels) {
  const model = path.join(root, 'public/assets/models/wasteland', file);
  if (!fs.existsSync(model) || fs.statSync(model).size < 30000) fail(`rebuilt model is missing or unexpectedly small: ${file}`);
}

console.log(`Graphics upgrade OK: ${pngWidth}x${pngHeight} source, ${Math.round(webp.length / 1024)} KiB runtime texture, desktop High/Ultra shadows, PBR global map, beveled GLBs.`);
