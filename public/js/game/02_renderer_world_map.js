  // ===== BASIC SETUP =====
  const canvas = document.getElementById('webgl');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x19130c);
  scene.fog = new THREE.FogExp2(0x20170f, 0.010);

  const IS_MOBILE_DEVICE = deviceInfo.type === 'mobile';
  const MOBILE_PIXEL_RATIO_LIMIT = 2.00;
  const DESKTOP_PIXEL_RATIO_LIMIT = 2.00;
  // Multisampling a large default framebuffer is redundant once Ultra already
  // renders at (or above) native resolution, and the color/depth resolve alone
  // can dominate an ultrawide frame. Keep hardware MSAA for smaller buffers;
  // high-density canvases retain native/supersampled edge smoothing.
  const DESKTOP_MSAA_BACKBUFFER_PIXEL_BUDGET = 2_500_000;
  // Ultra used to render every desktop canvas at a fixed 2x supersampling
  // target. On a 2K/4K browser window that creates an 8–33 megapixel
  // backbuffer before any shadow pass, even though the extra samples are no
  // longer visible at the isometric camera distance. Keep full 2x on smaller
  // windows, but cap the total Ultra backbuffer so large displays stay sharp
  // without spending most of the frame on fill-rate.
  const ULTRA_RENDER_PIXEL_BUDGET = 4_000_000;

  const GRAPHICS_STORAGE_KEY = 'realmOfAshes.graphicsQuality.v1';
  // v7.76: real sun shadows are back on desktop High/Ultra. Mobile keeps the
  // stable contact-shadow path, while the adaptive caster/update budget below
  // prevents the desktop shadow pass from becoming an every-frame full-scene cost.
  const REAL_SHADOWS_TEMP_DISABLED = false;
  const GRAPHICS_PRESETS = {
    low: {
      id: 'low',
      label: 'Низкая',
      pixelRatioDesktop: 0.80,
      pixelRatioMobile: 1.00,
      shadows: false,
      mobileShadows: false,
      mobileShadowMap: 0,
      shadowMap: 512,
      shadowType: 'basic',
      shadowCameraSpan: 42,
      shadowFar: 96,
      shadowBias: -0.00018,
      shadowNormalBias: 0.060,
      shadowCasterMode: 'major',
      shadowUpdateFps: 6,
      shadowCasterRadius: 18,
      shadowFocusMoveThreshold: 0.80,
      shadowCasterRebudgetDistance: 5.0,
      staticCullExtra: 4,
      // Root transforms and authoritative state still update every frame. These
      // values only budget costly mixers, bones, face layers and foot IK.
      actorAnimationNearDistance: 3.5,
      actorAnimationCloseDistance: 8,
      actorAnimationMidDistance: 15,
      actorAnimationNearInterval: 1 / 30,
      actorAnimationCloseInterval: 0.05,
      actorAnimationMidInterval: 0.08,
      actorAnimationFarInterval: 0.12,
      actorAnimationCrowdMovingInterval: 0.05,
      actorAnimationCrowdIdleInterval: 0.10,
      actorFootIkDistance: 3,
      visionRefresh: 0.18,
      shadeCapacity: 1800,
      fogVisual: 'normal',
      fogDarkOpacity: 0.22,
      fogSeenOpacity: 0.000,
      fogBlockOpacity: 0.045,
      effectLimit: 12,
      bulletBeams: false,
      floatingLabels: false,
      renderEffects: 'minimal',
      muzzleLights: false,
      terrainDetails: 0.28,
      decalDensity: 0.30,
      textureSize: 128
    },
    medium: {
      id: 'medium',
      label: 'Средняя',
      pixelRatioDesktop: 1.15,
      pixelRatioMobile: 1.20,
      shadows: false,
      mobileShadows: false,
      mobileShadowMap: 0,
      shadowMap: 1024,
      shadowType: 'pcf',
      shadowCameraSpan: 56,
      shadowFar: 112,
      shadowBias: -0.00015,
      shadowNormalBias: 0.048,
      shadowCasterMode: 'medium',
      shadowUpdateFps: 10,
      shadowCasterRadius: 28,
      shadowFocusMoveThreshold: 0.55,
      shadowCasterRebudgetDistance: 4.0,
      staticCullExtra: 4,
      actorAnimationNearDistance: 5,
      actorAnimationCloseDistance: 10,
      actorAnimationMidDistance: 17,
      actorAnimationNearInterval: 1 / 30,
      actorAnimationCloseInterval: 0.04,
      actorAnimationMidInterval: 0.0667,
      actorAnimationFarInterval: 0.10,
      actorAnimationCrowdMovingInterval: 0.04,
      actorAnimationCrowdIdleInterval: 0.08,
      actorFootIkDistance: 4.5,
      visionRefresh: 0.12,
      shadeCapacity: 1800,
      fogVisual: 'normal',
      fogDarkOpacity: 0.22,
      fogSeenOpacity: 0.000,
      fogBlockOpacity: 0.045,
      effectLimit: 28,
      bulletBeams: true,
      floatingLabels: true,
      renderEffects: 'normal',
      muzzleLights: false,
      terrainDetails: 0.58,
      decalDensity: 0.56,
      textureSize: 192
    },
    high: {
      id: 'high',
      label: 'Высокая',
      pixelRatioDesktop: 1.50,
      pixelRatioMobile: 1.50,
      shadows: true,
      mobileShadows: false,
      mobileShadowMap: 0,
      shadowMap: 2048,
      shadowType: 'soft',
      shadowCameraSpan: 74,
      shadowFar: 128,
      shadowBias: -0.00012,
      shadowNormalBias: 0.035,
      shadowCasterMode: 'high',
      shadowUpdateFps: 15,
      shadowCasterRadius: 42,
      shadowFocusMoveThreshold: 0.40,
      shadowCasterRebudgetDistance: 3.0,
      staticCullExtra: 4,
      actorAnimationNearDistance: 6,
      actorAnimationCloseDistance: 11,
      actorAnimationMidDistance: 19,
      actorAnimationNearInterval: 0,
      actorAnimationCloseInterval: 1 / 30,
      actorAnimationMidInterval: 0.05,
      actorAnimationFarInterval: 0.08,
      actorAnimationCrowdMovingInterval: 1 / 30,
      actorAnimationCrowdIdleInterval: 0.0667,
      actorFootIkDistance: 6,
      visionRefresh: 0.09,
      shadeCapacity: 1800,
      fogVisual: 'normal',
      fogDarkOpacity: 0.22,
      fogSeenOpacity: 0.000,
      fogBlockOpacity: 0.045,
      effectLimit: 70,
      bulletBeams: true,
      floatingLabels: true,
      renderEffects: 'high',
      muzzleLights: true,
      terrainDetails: 0.88,
      decalDensity: 0.82,
      textureSize: 256
    },
    ultra: {
      id: 'ultra',
      label: 'Ультра',
      pixelRatioDesktop: 2.00,
      pixelRatioMobile: 2.00,
      shadows: true,
      mobileShadows: false,
      mobileShadowMap: 0,
      shadowMap: 4096,
      shadowType: 'soft',
      shadowCameraSpan: 92,
      shadowFar: 150,
      shadowBias: -0.00009,
      shadowNormalBias: 0.026,
      shadowCasterMode: 'ultra',
      shadowUpdateFps: 24,
      shadowCasterRadius: 58,
      shadowFocusMoveThreshold: 0.28,
      shadowCasterRebudgetDistance: 2.4,
      staticCullExtra: 6,
      actorAnimationNearDistance: 8,
      actorAnimationCloseDistance: 14,
      actorAnimationMidDistance: 24,
      actorAnimationNearInterval: 0,
      actorAnimationCloseInterval: 1 / 30,
      actorAnimationMidInterval: 0.05,
      actorAnimationFarInterval: 0.08,
      actorAnimationCrowdMovingInterval: 1 / 30,
      actorAnimationCrowdIdleInterval: 0.05,
      actorFootIkDistance: 6.5,
      visionRefresh: 0.06,
      shadeCapacity: 1800,
      fogVisual: 'normal',
      fogDarkOpacity: 0.22,
      fogSeenOpacity: 0.000,
      fogBlockOpacity: 0.045,
      effectLimit: 110,
      bulletBeams: true,
      floatingLabels: true,
      renderEffects: 'ultra',
      muzzleLights: true,
      terrainDetails: 1.00,
      decalDensity: 1.00,
      textureSize: 256
    }
  };
  let graphicsQuality = localStorage.getItem(GRAPHICS_STORAGE_KEY) || (IS_MOBILE_DEVICE ? 'medium' : 'high');
  if (!GRAPHICS_PRESETS[graphicsQuality]) graphicsQuality = IS_MOBILE_DEVICE ? 'medium' : 'high';
  let graphicsSettings = GRAPHICS_PRESETS[graphicsQuality];
  // v7.65: enable Three's shared cache so preloaded location textures can be reused
  // instead of being fetched/decoded again while the world is rebuilt.
  if (THREE.Cache) THREE.Cache.enabled = true;

  function graphicsPixelRatio() {
    const preset = graphicsSettings || GRAPHICS_PRESETS.medium;
    const raw = IS_MOBILE_DEVICE ? preset.pixelRatioMobile : preset.pixelRatioDesktop;
    const cap = IS_MOBILE_DEVICE ? MOBILE_PIXEL_RATIO_LIMIT : DESKTOP_PIXEL_RATIO_LIMIT;
    // Mobile low quality should still stay playable and readable.
    // FPS on phones is mostly CPU/object/shadow-budget bound here, so dropping
    // the backbuffer below ~0.9 only makes the scene blurry without a real gain.
    return Math.max(IS_MOBILE_DEVICE ? 1.00 : 0.55, Math.min(cap, Number(raw || 1)));
  }

  let adaptiveRenderScale = 1.0;
  let adaptiveRenderScaleTimer = 0;
  let adaptiveRenderScaleRecoveryTimer = 0;
  let appliedRendererPixelRatio = 0;
  let ultraRenderPressureElapsed = 0;
  let ultraRenderPressureRecoveryElapsed = 0;
  let ultraRenderPressureActive = false;
  const ADAPTIVE_RENDER_SCALE_DOWN_FPS = 57;
  const ADAPTIVE_RENDER_SCALE_UP_FPS = 59;
  const ADAPTIVE_RENDER_SCALE_RECOVERY_SECONDS = 3;
  const ULTRA_RENDER_PRESSURE_ACTORS = 6;
  const ULTRA_RENDER_PRESSURE_FPS = 42;
  const ULTRA_RENDER_PRESSURE_SECONDS = 2;
  const ULTRA_RENDER_PRESSURE_RECOVERY_FPS = 58;
  const ULTRA_RENDER_PRESSURE_RECOVERY_SECONDS = 5;
  const ULTRA_RENDER_PRESSURE_NATIVE_RATIO = 0.92;

  function updateUltraRenderPressure(dt = 0) {
    if (IS_MOBILE_DEVICE || String(graphicsQuality || '') !== 'ultra') {
      ultraRenderPressureElapsed = 0;
      ultraRenderPressureRecoveryElapsed = 0;
      ultraRenderPressureActive = false;
      return;
    }
    const actorCount = typeof shadowActorRosterSize === 'function'
      ? Math.max(0, Number(shadowActorRosterSize() || 0))
      : 0;
    const seconds = Math.max(0, Math.min(0.1, Number(dt || 0)));
    if (!ultraRenderPressureActive) {
      ultraRenderPressureRecoveryElapsed = 0;
      ultraRenderPressureElapsed = actorCount >= ULTRA_RENDER_PRESSURE_ACTORS
        && fpsValue > 0
        && fpsValue < ULTRA_RENDER_PRESSURE_FPS
        ? ultraRenderPressureElapsed + seconds
        : 0;
      if (ultraRenderPressureElapsed >= ULTRA_RENDER_PRESSURE_SECONDS) {
        ultraRenderPressureActive = true;
        ultraRenderPressureElapsed = 0;
      }
      return;
    }
    ultraRenderPressureElapsed = 0;
    const recovered = actorCount < ULTRA_RENDER_PRESSURE_ACTORS
      || fpsValue >= ULTRA_RENDER_PRESSURE_RECOVERY_FPS;
    ultraRenderPressureRecoveryElapsed = recovered
      ? ultraRenderPressureRecoveryElapsed + seconds
      : 0;
    if (ultraRenderPressureRecoveryElapsed >= ULTRA_RENDER_PRESSURE_RECOVERY_SECONDS) {
      ultraRenderPressureActive = false;
      ultraRenderPressureRecoveryElapsed = 0;
    }
  }

  function adaptiveRenderScaleFloor() {
    if (IS_MOBILE_DEVICE) return 0.88;
    const id = String(graphicsQuality || 'high');
    if (id === 'ultra') {
      const base = graphicsViewportBasePixelRatio();
      // Stay native in normal play. Only after sustained low FPS with a crowded
      // actor roster may a large canvas use a subtle 0.92x emergency tier; the
      // DOM HUD remains full-resolution and small windows keep supersampling.
      const targetRatio = ultraRenderPressureActive ? ULTRA_RENDER_PRESSURE_NATIVE_RATIO : 1;
      return Math.max(0.60, Math.min(1.0, targetRatio / Math.max(1, base)));
    }
    if (id === 'high') return 0.74;
    if (id === 'medium') return 0.84;
    return 0.92;
  }

  function graphicsViewportBasePixelRatio() {
    const base = graphicsPixelRatio();
    if (IS_MOBILE_DEVICE || String(graphicsQuality || '') !== 'ultra') return base;
    const width = Math.max(1, Number(canvas?.clientWidth || window.innerWidth || 1));
    const height = Math.max(1, Number(canvas?.clientHeight || window.innerHeight || 1));
    const cap = Math.max(1, Math.sqrt(ULTRA_RENDER_PIXEL_BUDGET / Math.max(1, width * height)));
    return Math.min(base, cap);
  }

  function effectiveGraphicsPixelRatio() {
    const base = graphicsViewportBasePixelRatio();
    const scale = Math.max(adaptiveRenderScaleFloor(), Math.min(1.0, Number(adaptiveRenderScale || 1)));
    return Math.max(IS_MOBILE_DEVICE ? 0.92 : 0.55, base * scale);
  }

  function desktopMsaaEnabledForViewport() {
    if (IS_MOBILE_DEVICE) return false;
    // WebGL antialias is immutable after context creation. Choose it against
    // the largest stable viewport known at boot and the prospective Ultra
    // ratio, independently of the current window size/preset. Otherwise a
    // small Low window could keep MSAA after switching to fullscreen Ultra.
    const stableWidth = Math.max(
      1,
      Number(canvas?.clientWidth || 0),
      Number(window.innerWidth || 0),
      Number(window.screen?.availWidth || 0),
      Number(window.screen?.width || 0)
    );
    const stableHeight = Math.max(
      1,
      Number(canvas?.clientHeight || 0),
      Number(window.innerHeight || 0),
      Number(window.screen?.availHeight || 0),
      Number(window.screen?.height || 0)
    );
    const stablePixels = stableWidth * stableHeight;
    const prospectiveUltraRatio = Math.min(
      DESKTOP_PIXEL_RATIO_LIMIT,
      Math.max(1, Math.sqrt(ULTRA_RENDER_PIXEL_BUDGET / Math.max(1, stablePixels)))
    );
    return stablePixels * prospectiveUltraRatio * prospectiveUltraRatio
      < DESKTOP_MSAA_BACKBUFFER_PIXEL_BUDGET;
  }

  function applyMainRendererPixelRatio(force = false) {
    if (!renderer) return;
    const next = effectiveGraphicsPixelRatio();
    if (!force && Math.abs(next - appliedRendererPixelRatio) < 0.015) return;
    appliedRendererPixelRatio = next;
    renderer.setPixelRatio(next);
  }

  function resetAdaptiveRenderScaleSampling() {
    adaptiveRenderScaleTimer = 0;
    adaptiveRenderScaleRecoveryTimer = 0;
  }

  function resetAdaptiveRenderScale(reason = 'quality') {
    adaptiveRenderScale = 1.0;
    ultraRenderPressureElapsed = 0;
    ultraRenderPressureRecoveryElapsed = 0;
    ultraRenderPressureActive = false;
    resetAdaptiveRenderScaleSampling();
    applyMainRendererPixelRatio(true);
  }

  function updateAdaptiveRenderScale(dt = 0) {
    if (!gameStarted || !renderer || document.hidden || document.body.classList.contains('global-map-mode')) {
      // Do not carry FPS samples from a hidden tab or the separate global-map
      // renderer into the local-scene recovery dwell.
      resetAdaptiveRenderScaleSampling();
      return;
    }
    if (!Number.isFinite(fpsValue) || fpsValue <= 0) return;
    updateUltraRenderPressure(dt);
    adaptiveRenderScaleTimer += Math.max(0, Number(dt || 0));
    if (adaptiveRenderScaleTimer < 1.0) return;
    const sampleSeconds = adaptiveRenderScaleTimer;
    adaptiveRenderScaleTimer = 0;

    const floor = adaptiveRenderScaleFloor();
    let next = adaptiveRenderScale;
    if (fpsValue < ADAPTIVE_RENDER_SCALE_DOWN_FPS) {
      adaptiveRenderScaleRecoveryTimer = 0;
      next = Math.max(floor, adaptiveRenderScale - (fpsValue < 48 ? 0.08 : 0.045));
    } else if (fpsValue >= ADAPTIVE_RENDER_SCALE_UP_FPS && adaptiveRenderScale < 0.999) {
      // Rendering is capped at 60 FPS. Require a sustained near-cap reading so
      // resolution can recover without bouncing at the downscale boundary.
      adaptiveRenderScaleRecoveryTimer += sampleSeconds;
      if (adaptiveRenderScaleRecoveryTimer >= ADAPTIVE_RENDER_SCALE_RECOVERY_SECONDS) {
        adaptiveRenderScaleRecoveryTimer = 0;
        next = Math.min(1.0, adaptiveRenderScale + 0.025);
      }
    } else {
      adaptiveRenderScaleRecoveryTimer = 0;
    }
    if (Math.abs(next - adaptiveRenderScale) < 0.002) return;
    adaptiveRenderScale = next;
    // Do not leave the backing store a few pixels above the final floor just
    // because the last adaptive step is smaller than the resize deadband.
    applyMainRendererPixelRatio(next <= floor + 0.002 || next >= 0.999);
  }

  // v7.62 RAM budget: big textures are the main source of browser RAM usage.
  // Quality presets now decide which texture files and maps are loaded. The game
  // still spends work on GPU lighting/normal maps where useful, but avoids keeping
  // 4K/2K CPU-decoded images alive on every preset.
  function graphicsTextureBudget() {
    const id = graphicsQuality || (IS_MOBILE_DEVICE ? 'medium' : 'high');
    if (IS_MOBILE_DEVICE) {
      if (id === 'ultra') return { tier: 'mobile-ultra', maxColor: 1536, maxData: 1024, pbrMaps: true, layerNormals: false, displacement: false, terrainSegments: 72 };
      if (id === 'high') return { tier: 'mobile-high', maxColor: 1280, maxData: 1024, pbrMaps: true, layerNormals: false, displacement: false, terrainSegments: 64 };
      if (id === 'medium') return { tier: 'mobile-medium', maxColor: 1024, maxData: 768, pbrMaps: true, layerNormals: false, displacement: false, terrainSegments: 52 };
      return { tier: 'mobile-low', maxColor: 1024, maxData: 768, pbrMaps: true, layerNormals: false, displacement: false, terrainSegments: 52 };
    }
    if (id === 'ultra') return { tier: 'desktop-ultra', maxColor: 4096, maxData: 2048, pbrMaps: true, layerNormals: true, displacement: true, terrainSegments: 176 };
    if (id === 'high') return { tier: 'desktop-high', maxColor: 2048, maxData: 1024, pbrMaps: true, layerNormals: true, displacement: true, terrainSegments: 128 };
    if (id === 'medium') return { tier: 'desktop-medium', maxColor: 1280, maxData: 1024, pbrMaps: true, layerNormals: false, displacement: false, terrainSegments: 72 };
    return { tier: 'desktop-low', maxColor: 768, maxData: 512, pbrMaps: false, layerNormals: false, displacement: false, terrainSegments: 40 };
  }

  function getReliefTexturePath(kind) {
    const budget = graphicsTextureBudget();
    if (kind === 'base') {
      if (budget.maxColor >= 4096) return 'assets/textures/materials_ground_dirt_01/relief_ground_base_4k_v760.webp';
      if (budget.maxColor >= 1536) return 'assets/textures/materials_ground_dirt_01/relief_ground_base_2k_v762.webp';
      return 'assets/textures/materials_ground_dirt_01/relief_ground_base_1k_v762.webp';
    }
    if (kind === 'normal') return budget.maxData >= 1536
      ? 'assets/textures/materials_ground_dirt_01/relief_ground_normal_2k_v760.webp'
      : 'assets/textures/materials_ground_dirt_01/relief_ground_normal_1k_v762.webp';
    if (kind === 'roughness') return budget.maxData >= 1536
      ? 'assets/textures/materials_ground_dirt_01/relief_ground_roughness_2k_v760.webp'
      : 'assets/textures/materials_ground_dirt_01/relief_ground_roughness_1k_v762.webp';
    if (kind === 'height') return budget.maxData >= 1536
      ? 'assets/textures/materials_ground_dirt_01/relief_ground_height_2k_v760.webp'
      : 'assets/textures/materials_ground_dirt_01/relief_ground_height_1k_v762.webp';
    if (kind === 'ao') return budget.maxData >= 1536
      ? 'assets/textures/materials_ground_dirt_01/relief_ground_ao_2k_v760.webp'
      : 'assets/textures/materials_ground_dirt_01/relief_ground_ao_1k_v762.webp';
    return null;
  }


  const desktopMsaaEnabled = desktopMsaaEnabledForViewport();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: desktopMsaaEnabled, alpha: false, powerPreference: 'high-performance' });
  canvas.dataset.rendererMsaa = desktopMsaaEnabled ? 'on' : 'off';
  applyMainRendererPixelRatio(true);
  renderer.setClearColor(0x080b0c, 1);
  // v7.51: единый кинематографичный цветовой пайплайн. Без внешних ассетов:
  // Three.js сам держит правильную гамму, а тон-маппинг делает металл, землю
  // и ночной свет менее плоскими.
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
  if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
  else if (THREE.CineonToneMapping) renderer.toneMapping = THREE.CineonToneMapping;
  // v7.61 PBR/WebGL pass: use Three's physically based light falloff where the
  // current bundled version supports it. Kept behind guards so older builds do not fail.
  if ('physicallyCorrectLights' in renderer) renderer.physicallyCorrectLights = true;
  if ('useLegacyLights' in renderer) renderer.useLegacyLights = false;
  renderer.toneMappingExposure = IS_MOBILE_DEVICE ? 1.10 : 1.16;
  const fpsCounterEl = document.getElementById('fps-counter');
  const fpsCounterValueEl = document.getElementById('fps-counter-value');
  let fpsFrames = 0;
  let fpsTimer = 0;
  let fpsValue = 0;

  function updateFpsCounter(dt) {
    if (!fpsCounterEl) return;
    fpsFrames++;
    fpsTimer += Math.max(0, Number(dt || 0));
    if (fpsTimer >= 0.35) {
      fpsValue = Math.round(fpsFrames / fpsTimer);
      fpsFrames = 0;
      fpsTimer = 0;
      if (fpsCounterValueEl) fpsCounterValueEl.textContent = `FPS: ${fpsValue}`;
      else if (!document.getElementById('network-ping')) fpsCounterEl.textContent = `FPS: ${fpsValue}`;
      fpsCounterEl.classList.toggle('fps-low', fpsValue > 0 && fpsValue < 30);
      fpsCounterEl.classList.toggle('fps-mid', fpsValue >= 30 && fpsValue < 50);
      fpsCounterEl.classList.toggle('fps-high', fpsValue >= 50);
    }
  }

  // Shadow pipeline stays enabled for all presets so material shaders do not
  // switch color/lighting paths when changing Low/Medium/High/Ultra.
  // Shadow maps remain dynamic, but they are no longer recalculated every render.
  // The adaptive shadow budget below marks updates on a timer/events, keeping
  // real shadows without the heavy full-scene shadow pass every frame.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  // Камера ортографическая: приближение задают границы кадра, а не
  // расстояние до модели.
  const camera = new THREE.OrthographicCamera(-15, 15, 9.5, -9.5, 0.1, 300);
  camera.rotation.order = 'YXZ';

  const raycaster = new THREE.Raycaster();
  const visibilityRaycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const worldGroup = new THREE.Group();
  scene.add(worldGroup);


  // v7.66: первая торговая локация теперь рендерится как стабильная диорама.
  // На ней нельзя прятать статичные группы во время ходьбы: иначе при смене
  // технической клетки камера видела, как окружение/тени моргают или исчезают.
  function isTraderYardLocation() {
    return !!(currentLocation && currentLocation.id === 'settlement');
  }

  function markNoRuntimeCull(root, reason = 'stable-render') {
    if (!root || !root.traverse) return root;
    root.userData = root.userData || {};
    root.userData.noRuntimeCull = true;
    root.userData.noRuntimeCullReason = reason;
    root.traverse(obj => {
      if (!obj) return;
      obj.frustumCulled = false;
      obj.userData = obj.userData || {};
      obj.userData.noRuntimeCull = true;
      obj.userData.noRuntimeCullReason = reason;
    });
    return root;
  }

  // v7.4: экранное затенение окружения вместо скрытия объектов.
  // Объекты остаются в мире и синхронизации, а дальняя зона просто становится темнее.
  const visionShade = document.getElementById('vision-shade') || (() => {
    const el = document.createElement('div');
    el.id = 'vision-shade';
    el.setAttribute('aria-hidden', 'true');
    const container = document.getElementById('game-container');
    if (container) container.insertBefore(el, document.getElementById('ui-overlay') || null);
    return el;
  })();

  // v7.10: наглядная зона видимости не линиями поверх персонажей, а мягким
  // затенением тайлов на уровне пола. Оверлей лежит ниже персонажей/мобов/предметов
  // и не перекрывает их модели.
  const visibilityGridGroup = new THREE.Group();
  visibilityGridGroup.name = 'visibility-tile-shading';
  visibilityGridGroup.renderOrder = 1;
  scene.add(visibilityGridGroup);
  const visibilitySeenTileMaterial = new THREE.MeshBasicMaterial({
    // Светлую жёлтую подсветку видимой зоны не используем: она меняла
    // ощущение цвета карты между пресетами. Видимость теперь затемняет только fog.
    color: 0x8f8160,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide
  });
  const visibilityBlockTileMaterial = new THREE.MeshBasicMaterial({
    color: 0x7a4a2e,
    transparent: true,
    opacity: 0.105,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide
  });
  const visibilityFogTileMaterial = new THREE.MeshBasicMaterial({
    color: 0x010304,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide
  });
  let visibilityGridEnabled = true;
  const visibilityShadeCapacity = 1800;
  let visibilityShadeGeometry = null;
  let visibilityFogMesh = null;
  let visibilitySeenMesh = null;
  let visibilityBlockMesh = null;

  function syncVisibilityFogMaterialOpacity() {
    const preset = graphicsSettings || GRAPHICS_PRESETS.medium;
    const fogOpacity = Number(preset.fogDarkOpacity ?? 0.24);
    const seenOpacity = Number(preset.fogSeenOpacity ?? 0.055);
    const blockOpacity = Number(preset.fogBlockOpacity ?? 0.085);
    if (visibilityFogTileMaterial) visibilityFogTileMaterial.opacity = fogOpacity;
    if (visibilitySeenTileMaterial) visibilitySeenTileMaterial.opacity = seenOpacity;
    if (visibilityBlockTileMaterial) visibilityBlockTileMaterial.opacity = blockOpacity;
    if (visibilityFogMesh && visibilityFogMesh.material) visibilityFogMesh.material.opacity = fogOpacity;
    if (visibilitySeenMesh && visibilitySeenMesh.material) visibilitySeenMesh.material.opacity = seenOpacity;
    if (visibilityBlockMesh && visibilityBlockMesh.material) visibilityBlockMesh.material.opacity = blockOpacity;
  }

  syncVisibilityFogMaterialOpacity();
  // Visual fog-of-war is normal gameplay UI now. It can still be toggled, but
  // no longer depends on a hidden debug query parameter.

  function setVisibilityFogVisualEnabled(enabled) {
    visibilityGridEnabled = !!enabled;
    if (visibilityGridGroup) visibilityGridGroup.visible = visibilityGridEnabled;
    document.body.classList.toggle('fog-visual-hidden', !visibilityGridEnabled);
    const btn = document.getElementById('mobile-vision-toggle') || document.getElementById('touch-vision');
    if (btn) {
      btn.classList.toggle('active', visibilityGridEnabled);
      btn.classList.toggle('vision-off', !visibilityGridEnabled);
      btn.textContent = visibilityGridEnabled ? '◐' : '○';
      btn.setAttribute('aria-label', visibilityGridEnabled ? 'Скрыть затенение обзора' : 'Показать затенение обзора');
    }
    if (!visibilityGridEnabled) clearVisibilityGrid();
    else if (typeof updateVisibilityGridVisual === 'function') updateVisibilityGridVisual();
  }

  function toggleVisibilityFogVisual() {
    setVisibilityFogVisualEnabled(!visibilityGridEnabled);
    setReadout(visibilityGridEnabled ? 'Затенение видимости включено.' : 'Затенение видимости скрыто.');
  }
  const _visibilityTileMatrix = new THREE.Matrix4();
  const _visibilityTileQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const _visibilityTileScale = new THREE.Vector3(1, 1, 1);
  const _visibilityTilePos = new THREE.Vector3();

  // v42: окружение создаётся один раз в мировых координатах.
  // После построения локальные матрицы статичных объектов запекаются,
  // поэтому движение/поворот игрока больше не может менять деревья, камни,
  // ресурсы, ящики, пол, торговца, хранилище и выходы.
  function prepareWorldGroupForRebuild() {
    worldGroup.matrixAutoUpdate = true;
    worldGroup.position.set(0, 0, 0);
    worldGroup.rotation.set(0, 0, 0);
    worldGroup.scale.set(1, 1, 1);
    worldGroup.updateMatrix();
  }

  function freezeStaticWorldTransforms() {
    worldGroup.position.set(0, 0, 0);
    worldGroup.rotation.set(0, 0, 0);
    worldGroup.scale.set(1, 1, 1);
    worldGroup.updateMatrix();
    const stableTraderYard = isTraderYardLocation() && !locationUsesAuthoredLayout(currentLocation);
    worldGroup.traverse(obj => {
      obj.updateMatrix();
      obj.matrixAutoUpdate = false;
      // v7.66: у ручной торговой локации много крупных слоёв, теневых
      // декалей и составных групп. Их нельзя доверять стандартному frustum
      // culling по маленьким локальным bounding sphere: при движении камеры
      // отдельные детали могли исчезать на один кадр.
      if (stableTraderYard || obj.userData?.noRuntimeCull) {
        obj.frustumCulled = false;
        obj.userData = obj.userData || {};
        obj.userData.noRuntimeCull = true;
      }
    });
    worldGroup.updateMatrixWorld(true);
  }

  window.__virtualMoveReady = false;

  function getGameViewportSize() {
    const vv = window.visualViewport;
    const doc = document.documentElement;
    const body = document.body;
    const rawW = window.innerWidth || doc.clientWidth || body?.clientWidth || 1;
    const rawH = window.innerHeight || doc.clientHeight || body?.clientHeight || 1;
    const vvW = vv && vv.width ? vv.width : 0;
    const vvH = vv && vv.height ? vv.height : 0;

    // v7.74.29: do not let the first boot frame inherit a stale CSS canvas size.
    // Chrome sometimes reports the final visual viewport only after fullscreen,
    // DevTools or another resize-like event. Desktop is safest from window size;
    // mobile still prefers visualViewport because browser bars/safe areas matter.
    let cssW = deviceInfo.type === 'mobile' && vvW > 1 ? vvW : rawW;
    let cssH = deviceInfo.type === 'mobile' && vvH > 1 ? vvH : rawH;

    if (!Number.isFinite(cssW) || cssW < 64) cssW = rawW || doc.clientWidth || 1;
    if (!Number.isFinite(cssH) || cssH < 64) cssH = rawH || doc.clientHeight || 1;

    return {
      w: Math.max(1, Math.round(cssW)),
      h: Math.max(1, Math.round(cssH))
    };
  }

  function setAppViewportHeight() {
    const size = getGameViewportSize();
    document.documentElement.style.setProperty('--app-width', `${size.w}px`);
    document.documentElement.style.setProperty('--app-height', `${size.h}px`);
    return size;
  }

  function resize() {
    const size = setAppViewportHeight();
    const w = size.w;
    const h = size.h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    applyMainRendererPixelRatio(true);
    renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    const portrait = h > w;
    if (deviceInfo.type === 'mobile') document.body.classList.toggle('landscape-mode', !portrait);
    const compactLandscape = deviceInfo.type === 'mobile' && !portrait && h < 560;
    // v7.4: камера ближе к игроку, но без смены угла управления.
    //
    // Высота кадра подобрана по эталонному скриншоту: камера наклонена на
    // 45.7 градуса, поэтому человек ростом 1.8 м проецируется в кадр длиной
    // 1.26 единицы. При высоте кадра 15 фигура занимает 8.4% высоты экрана —
    // столько же, сколько на эталоне. Мобильные значения сохраняют прежние
    // пропорции к десктопному.
    const viewHeight = deviceInfo.type === 'mobile' ? (portrait ? 19.5 : (compactLandscape ? 12 : 13.5)) : 15;
    camera.zoom = 1;
    camera.left = -viewHeight * aspect / 2;
    camera.right = viewHeight * aspect / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    if (typeof updateCamera === 'function' && gameStarted) updateCamera(0);
    if (window.__virtualMoveReady && typeof resetVirtualMove === 'function') resetVirtualMove();
  }

  function forceCameraViewportSync(reason = 'layout') {
    // v7.74.29: entering the game does not always fire resize. When the login/
    // character screen is removed, force the same camera/canvas recalculation
    // that fullscreen or DevTools would normally trigger.
    resize();
    if (playerGroup && player) {
      playerGroup.position.set(player.x, 0, player.z);
      playerGroup.rotation.y = player.angle + Math.PI;
      playerGroup.updateMatrixWorld(true);
    }
    if (typeof updateCamera === 'function') updateCamera(0);
    try { renderer.render(scene, camera); } catch (_) {}
    if (reason && window.__debugCameraViewportSync) {
      console.log('[camera-sync]', reason, getGameViewportSize());
    }
  }

  function scheduleCameraViewportSync(reason = 'game-start') {
    forceCameraViewportSync(`${reason}:now`);
    requestAnimationFrame(() => {
      forceCameraViewportSync(`${reason}:raf1`);
      requestAnimationFrame(() => forceCameraViewportSync(`${reason}:raf2`));
    });
    setTimeout(() => forceCameraViewportSync(`${reason}:80ms`), 80);
    setTimeout(() => forceCameraViewportSync(`${reason}:250ms`), 250);
    setTimeout(() => forceCameraViewportSync(`${reason}:700ms`), 700);
  }
  resize();
  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
