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
const lighting = read('public/js/game/02b_lighting_time.js');
const materials = read('public/js/game/02a_materials_static_models.js');
const characterRuntime = read('public/js/game/04b_character_glb_runtime.js');
const remoteLocomotion = read('public/js/game/05b_remote_player_locomotion.js');
const enemyFlow = read('public/js/game/05f_enemy_models_location_flow.js');
const weaponRuntime = read('public/js/game/04c_weapon_glb_runtime.js');
const approvedHumanoidRuntime = read('public/js/game/04d_approved_humanoid_assets_runtime.js');
const globalMap = read('public/js/game/11b_global_map_static_scene_camera.js');
const hudLoop = read('public/js/game/13_minimap_hud_loop.js');
const modelBuilder = read('tools/build-wasteland-models.js');

requireText(renderer, 'const REAL_SHADOWS_TEMP_DISABLED = false;', 'desktop real shadows must not be emergency-disabled');
const numericConst = (source, name) => {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9._]+)`));
  if (!match) fail(`missing numeric constant ${name}`);
  return Number(match[1].replaceAll('_', ''));
};
const maxRenderFps = numericConst(hudLoop, 'MAX_RENDER_FPS');
const adaptiveDownFps = numericConst(renderer, 'ADAPTIVE_RENDER_SCALE_DOWN_FPS');
const adaptiveUpFps = numericConst(renderer, 'ADAPTIVE_RENDER_SCALE_UP_FPS');
const adaptiveRecoverySeconds = numericConst(renderer, 'ADAPTIVE_RENDER_SCALE_RECOVERY_SECONDS');
if (adaptiveUpFps > maxRenderFps) fail('adaptive render scale cannot recover above the render-loop FPS cap');
if (adaptiveDownFps >= adaptiveUpFps) fail('adaptive render scale must retain an FPS hysteresis band');
if (adaptiveRecoverySeconds < 2) fail('adaptive render scale recovery must require a sustained healthy frame rate');
requireText(renderer, 'adaptiveRenderScaleRecoveryTimer += sampleSeconds;', 'adaptive render scale recovery dwell is missing');
requireText(renderer, 'applyMainRendererPixelRatio(next <= floor + 0.002 || next >= 0.999)', 'adaptive scale can stop above its exact floor');
requireText(renderer, 'function updateUltraRenderPressure', 'sustained Ultra crowd-pressure tier is missing');
requireText(renderer, 'const ULTRA_RENDER_PRESSURE_NATIVE_RATIO = 0.92;', 'Ultra emergency tier is too aggressive or missing');
const ultraPressurePolicy = new Function([
  'const IS_MOBILE_DEVICE = false;',
  "let graphicsQuality = 'ultra';",
  'let fpsValue = 30;',
  'let actorCount = 8;',
  'let ultraRenderPressureElapsed = 0;',
  'let ultraRenderPressureRecoveryElapsed = 0;',
  'let ultraRenderPressureActive = false;',
  `const ULTRA_RENDER_PRESSURE_ACTORS = ${numericConst(renderer, 'ULTRA_RENDER_PRESSURE_ACTORS')};`,
  `const ULTRA_RENDER_PRESSURE_FPS = ${numericConst(renderer, 'ULTRA_RENDER_PRESSURE_FPS')};`,
  `const ULTRA_RENDER_PRESSURE_SECONDS = ${numericConst(renderer, 'ULTRA_RENDER_PRESSURE_SECONDS')};`,
  `const ULTRA_RENDER_PRESSURE_RECOVERY_FPS = ${numericConst(renderer, 'ULTRA_RENDER_PRESSURE_RECOVERY_FPS')};`,
  `const ULTRA_RENDER_PRESSURE_RECOVERY_SECONDS = ${numericConst(renderer, 'ULTRA_RENDER_PRESSURE_RECOVERY_SECONDS')};`,
  'function shadowActorRosterSize() { return actorCount; }',
  functionSource(renderer, 'updateUltraRenderPressure'),
  `return {
    sample(dt, nextFps = fpsValue, nextActors = actorCount) {
      fpsValue = nextFps;
      actorCount = nextActors;
      updateUltraRenderPressure(dt);
      return ultraRenderPressureActive;
    }
  };`
].join('\n'))();
for (let index = 0; index < 18; index++) ultraPressurePolicy.sample(0.1, 30, 8);
if (ultraPressurePolicy.sample(0.1, 30, 8)) fail('Ultra emergency tier activates before sustained pressure');
if (!ultraPressurePolicy.sample(0.1, 30, 8)) fail('Ultra emergency tier ignores sustained crowded pressure');
for (let index = 0; index < 49; index++) {
  if (!ultraPressurePolicy.sample(0.1, 60, 8)) fail('Ultra emergency tier recovers without a stable dwell');
}
ultraPressurePolicy.sample(0.1, 60, 8);
if (ultraPressurePolicy.sample(0.1, 60, 8)) fail('Ultra emergency tier never recovers after sustained healthy FPS');
requireText(renderer, '!gameStarted || !renderer || document.hidden', 'inactive/hidden adaptive sampling guard is missing');
requireText(renderer, "document.body.classList.contains('global-map-mode')", 'global-map adaptive sampling guard is missing');
requireText(renderer, 'const ULTRA_RENDER_PIXEL_BUDGET = 4_000_000;', 'Ultra viewport pixel budget is missing');
requireText(renderer, 'function graphicsViewportBasePixelRatio', 'Ultra viewport-aware pixel ratio is missing');
requireText(renderer, 'const DESKTOP_MSAA_BACKBUFFER_PIXEL_BUDGET = 2_500_000;', 'large-canvas MSAA budget is missing');
requireText(renderer, 'antialias: desktopMsaaEnabled', 'renderer bypasses the large-canvas MSAA budget');
const desktopMsaaPolicy = new Function([
  'let IS_MOBILE_DEVICE = false;',
  `const DESKTOP_MSAA_BACKBUFFER_PIXEL_BUDGET = ${numericConst(renderer, 'DESKTOP_MSAA_BACKBUFFER_PIXEL_BUDGET')};`,
  `const ULTRA_RENDER_PIXEL_BUDGET = ${numericConst(renderer, 'ULTRA_RENDER_PIXEL_BUDGET')};`,
  `const DESKTOP_PIXEL_RATIO_LIMIT = ${numericConst(renderer, 'DESKTOP_PIXEL_RATIO_LIMIT')};`,
  'let canvas = { clientWidth: 800, clientHeight: 600 };',
  'const window = { innerWidth: 800, innerHeight: 600, screen: { width: 800, height: 600, availWidth: 800, availHeight: 600 } };',
  functionSource(renderer, 'desktopMsaaEnabledForViewport'),
  `return (width, height, screenWidth, screenHeight, mobile = false) => {
    canvas.clientWidth = width;
    canvas.clientHeight = height;
    window.innerWidth = width;
    window.innerHeight = height;
    window.screen.width = screenWidth;
    window.screen.availWidth = screenWidth;
    window.screen.height = screenHeight;
    window.screen.availHeight = screenHeight;
    IS_MOBILE_DEVICE = mobile;
    return desktopMsaaEnabledForViewport();
  };`
].join('\n'))();
if (!desktopMsaaPolicy(800, 600, 800, 600)
  || desktopMsaaPolicy(1280, 720, 1280, 720)
  || desktopMsaaPolicy(800, 600, 2560, 1080)
  || desktopMsaaPolicy(844, 390, 844, 390, true)) {
  fail('large-canvas MSAA policy no longer protects expensive backbuffers');
}
const ultraViewportPolicy = new Function([
  'const IS_MOBILE_DEVICE = false;',
  `const ULTRA_RENDER_PIXEL_BUDGET = ${numericConst(renderer, 'ULTRA_RENDER_PIXEL_BUDGET')};`,
  "let graphicsQuality = 'ultra';",
  'let ultraRenderPressureActive = false;',
  `const ULTRA_RENDER_PRESSURE_NATIVE_RATIO = ${numericConst(renderer, 'ULTRA_RENDER_PRESSURE_NATIVE_RATIO')};`,
  'let adaptiveRenderScale = 1;',
  'let canvas = { clientWidth: 2048, clientHeight: 1024 };',
  'const window = { innerWidth: 2048, innerHeight: 1024 };',
  'function graphicsPixelRatio() { return 2; }',
  functionSource(renderer, 'adaptiveRenderScaleFloor'),
  functionSource(renderer, 'graphicsViewportBasePixelRatio'),
  functionSource(renderer, 'effectiveGraphicsPixelRatio'),
  `return (width, height, scale = 1, pressure = false) => {
    canvas.clientWidth = width;
    canvas.clientHeight = height;
    adaptiveRenderScale = scale;
    ultraRenderPressureActive = pressure;
    const base = graphicsViewportBasePixelRatio();
    const floor = adaptiveRenderScaleFloor();
    return { base, floor, effective: effectiveGraphicsPixelRatio() };
  };`
].join('\n'))();
const ultra2k = ultraViewportPolicy(2048, 1024, 0.01);
if (Math.abs(ultra2k.base - Math.sqrt(4_000_000 / (2048 * 1024))) > 1e-6
  || Math.abs(ultra2k.base * ultra2k.floor - 1) > 1e-6
  || Math.abs(ultra2k.effective - 1) > 1e-6) {
  fail('Ultra 2K pressure tier does not preserve native resolution');
}
const ultraSmall = ultraViewportPolicy(1280, 720, 0.01);
if (ultraSmall.base !== 2 || ultraSmall.floor !== 0.60 || ultraSmall.effective !== 1.2) {
  fail('Ultra small-window pressure tier no longer retains modest supersampling');
}
const ultra4k = ultraViewportPolicy(3840, 2160, 0.01);
if (ultra4k.base !== 1 || ultra4k.floor !== 1 || ultra4k.effective !== 1) {
  fail('Ultra 4K viewport is allowed to render below native resolution');
}
const ultraPressure2k = ultraViewportPolicy(2560, 1080, 0.01, true);
if (Math.abs(ultraPressure2k.effective - 0.92) > 1e-6) {
  fail('Ultra sustained crowd-pressure tier does not stop at 0.92x native');
}
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
requireText(lighting, 'function actorShadowCasterAllowlist', 'crowded actor shadow-caster budget is missing');
requireText(lighting, 'actorRosterSize > actorShadowCasterLimit()', 'crowded shadow budget does not refresh as actors change');
requireText(lighting, 'fpsValue < 36) fps *= 0.36', 'overloaded desktop shadow refresh is not capped');
requireText(lighting, 'fpsValue < 30) limit = Math.min(limit, 1)', 'overloaded actor shadow-caster budget is not capped');
requireText(lighting, 'remote?.id || remote?.data?.id', 'remote-player shadow ownership ignores the real row shape');
requireText(lighting, 'function shadowMapSizeForSceneLoad', 'Ultra shadow-map load tier is missing');
requireText(lighting, 'baseSize * 0.75', 'crowded Ultra keeps the full 4096 shadow-map cost');
requireText(lighting, 'allowUltraMicroDetail', 'crowded Ultra micro shadow casters are not budgeted');
const shadowResize = functionSource(lighting, 'updateAdaptiveShadowMapSize');
if (!shadowResize.includes('sun.shadow.needsUpdate = true')
  || !shadowResize.includes('renderer.shadowMap.needsUpdate = true')) {
  fail('Ultra shadow-map resize can leave a frame without a replacement shadow texture');
}
const adaptiveShadowBudgetSource = functionSource(lighting, 'updateAdaptiveShadowBudget');
if (!adaptiveShadowBudgetSource.includes('if (shadowMapSizeChanged)')
  || !adaptiveShadowBudgetSource.includes('adaptiveShadowBudget.pending = false')
  || !adaptiveShadowBudgetSource.includes('adaptiveShadowBudget.elapsed = 0')
  || !adaptiveShadowBudgetSource.includes('if (!shadowMapSizeChanged && !adaptiveShadowBudget.pending && dynamicMoved)')) {
  fail('Ultra shadow-map resize schedules a duplicate full shadow pass');
}
const shadowLoadPolicy = new Function([
  'const IS_MOBILE_DEVICE = false;',
  `const ULTRA_SHADOW_PRESSURE_ACTORS = ${numericConst(lighting, 'ULTRA_SHADOW_PRESSURE_ACTORS')};`,
  `const ULTRA_SHADOW_PRESSURE_FPS = ${numericConst(lighting, 'ULTRA_SHADOW_PRESSURE_FPS')};`,
  `const ULTRA_SHADOW_RECOVERY_FPS = ${numericConst(lighting, 'ULTRA_SHADOW_RECOVERY_FPS')};`,
  functionSource(lighting, 'ultraShadowLoadPressure'),
  functionSource(lighting, 'shadowMapSizeForSceneLoad'),
  'return shadowMapSizeForSceneLoad;'
].join('\n'))();
if (shadowLoadPolicy({ id: 'ultra', shadowMap: 4096 }, 8, 34, 4096) !== 3072) {
  fail('crowded 34 FPS Ultra scene does not enter the 3072 shadow tier');
}
if (shadowLoadPolicy({ id: 'ultra', shadowMap: 4096 }, 2, 34, 4096) !== 4096) {
  fail('uncrowded Ultra scene loses its full shadow tier');
}
if (shadowLoadPolicy({ id: 'ultra', shadowMap: 4096 }, 8, 59, 3072, true) !== 3072
  || shadowLoadPolicy({ id: 'ultra', shadowMap: 4096 }, 5, 59, 3072, false) !== 3072
  || shadowLoadPolicy({ id: 'ultra', shadowMap: 4096 }, 5, 59, 3072, true) !== 4096) {
  fail('Ultra shadow tier recovery hysteresis is unstable');
}
requireText(lighting, 'const ULTRA_SHADOW_RECOVERY_SECONDS = 3;', 'Ultra shadow tier lacks sustained recovery dwell');
const adaptiveShadowResize = functionSource(lighting, 'updateAdaptiveShadowMapSize');
if (!adaptiveShadowResize.includes('adaptiveShadowBudget.ultraRecoveryElapsed')
  || !adaptiveShadowResize.includes('>= ULTRA_SHADOW_RECOVERY_SECONDS')) {
  fail('Ultra shadow tier can resize repeatedly from one-frame FPS samples');
}
requireText(characterRuntime, 'function enableConservativeCharacterFrustumCulling', 'conservative character frustum culling is missing');
requireText(characterRuntime, 'geometry.userData.realmCharacterCullBaseRadius', 'shared character bounds can grow on every instance');
requireText(characterRuntime, 'function configureCharacterGlbScene(root, options = {})', 'authored GLB scene preparation is missing');
requireText(characterRuntime, 'enableConservativeCharacterFrustumCulling(obj);', 'authored GLB body, hair and face meshes bypass actor frustum culling');
requireText(characterRuntime, 'state.footIk !== false', 'distant character foot IK cannot be suspended');
requireText(characterRuntime, 'setCharacterFootIkEnabled(runtime, footIkEnabled)', 'foot IK suspension does not reset stale locks');
requireText(characterRuntime, 'state.facial !== false', 'distant character facial animation cannot be suspended');
requireText(characterRuntime, 'setCharacterFacialAnimationEnabled(runtime.root, facialEnabled)', 'facial suspension does not restore a neutral pose');
requireText(characterRuntime, 'function characterLegIkSolveScratch', 'character leg IK does not reuse solve scratch');
requireText(characterRuntime, 'directionalPoseOffsetCount', 'character directional pose still allocates offsets per frame');
requireText(characterRuntime, 'characterFaceShapeHead', 'character face bone lookup is not cached');
requireText(renderer, 'actorAnimationNearInterval: 1 / 30', 'Low/Medium presets do not reduce nearby actor CPU cost');
requireText(renderer, 'actorAnimationCrowdIdleInterval: 0.10', 'Low preset lacks a crowded idle animation budget');
requireText(renderer, 'actorFacialDistance: 5', 'Low preset lacks facial-animation distance budgeting');
requireText(enemyFlow, "actorAnimationDetailEnabled('footIk', distanceToPlayer, heavyImportant, animationBudget)", 'distant enemy foot IK is not quality-budgeted');
requireText(enemyFlow, "actorAnimationDetailEnabled('facial', distanceToPlayer, heavyImportant, animationBudget)", 'distant enemy facial animation is not quality-budgeted');
requireText(remoteLocomotion, "actorAnimationDetailEnabled('footIk', distance, important, animationBudget)", 'distant remote-player foot IK is not quality-budgeted');
requireText(remoteLocomotion, "actorAnimationDetailEnabled('facial', distance, important, animationBudget)", 'distant remote-player facial animation is not quality-budgeted');
requireText(remoteLocomotion, 'function actorAnimationInView', 'actor animation lacks camera-frustum budgeting');
requireText(weaponRuntime, 'enableConservativeCharacterFrustumCulling(part, 2.4)', 'runtime weapons bypass actor frustum culling');
requireText(approvedHumanoidRuntime, 'enableConservativeCharacterFrustumCulling(mesh, 2.4)', 'approved equipment bypasses actor frustum culling');
requireText(approvedHumanoidRuntime, 'mesh.userData.enemy = characterRoot.userData.enemy', 'approved equipment is missing enemy shadow ownership');
requireText(approvedHumanoidRuntime, 'function approvedArmSolveRuntime', 'approved weapon arm IK does not reuse solve scratch');
requireText(approvedHumanoidRuntime, 'approvedGripTargetTransforms', 'approved weapon grip targets are rebuilt per frame');

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
