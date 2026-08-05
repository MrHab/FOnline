  // ===== MAP =====
  const TILE = 2.0;
  const MAP_W = 38;
  const MAP_H = 38;
  const WORLD_MAP_EXIT_BAND_TILES = 2;
  const map = [];
  const resourceNodes = [];
  const locationJobBoards = [];
  const locationCraftingStations = [];
  const locationTradeMachines = [];
  const obstacleMeshes = [];
  const staticCullObjects = [];
  const staticCollisionBoxes = [];
  const authoredMovementBlockers = new Set();
  const authoredVisionBlockers = new Set();
  const authoredLowVisionCover = new Set();
  const floorMeshes = [];
  const PLAYER_COLLISION_RADIUS = 0.48;
  const WORLD_ENVIRONMENT_VERSION = 'unique-world-site-layouts-v780';
  // v7.54: техническая сетка остаётся в map[][], но обычный игрок больше не видит
  // квадратные плоскости пола. Их можно вернуть только локально для отладки.
  const DEBUG_SHOW_TERRAIN_TILES = false;
  const RENDER_LAND_TILE_PLANES = false;

  const TILE_TYPES = {
    GRASS: 0,
    TREE: 1,
    ROCK: 2,
    WATER: 3,
    DARK: 4,
    PATH: 5,
    ORE: 6,
    WOOD: 7,
    RUIN: 8,
    OIL: 9
  };

  let LOCATIONS = {
    settlement: {
      id: 'settlement',
      name: 'Караванный двор Старого Клима',
      seed: 20260768,
      safe: true,
      pvpMode: 'peaceful',
      spawn: { tx: 19, tz: 25 },
      entryFromWasteland: { tx: 19, tz: 10 },
      exit: { tx: 19, tz: 8, to: 'wasteland', label: 'Северные ворота' },
      trader: { tx: 15, tz: 20, name: 'Старый Клим' },
      storage: { tx: 24, tz: 20, name: 'Караванный сундук' }
    },
    wasteland: {
      id: 'wasteland',
      name: 'Пепельный лес',
      seed: 123456,
      safe: false,
      pvpMode: 'pvp',
      enemyCap: 12,
      spawnCount: 8,
      spawn: { tx: 19, tz: 32 },
      entryFromSettlement: { tx: 19, tz: 34 },
      exit: { tx: 19, tz: 35, to: 'settlement', label: 'Дорога в поселение' }
    },
    scrapTown: {
      id: 'scrapTown',
      name: 'Свалочный пост',
      seed: 20260811,
      safe: true,
      pvpMode: 'peaceful',
      spawn: { tx: 19, tz: 25 },
      entryFromWorld: { tx: 19, tz: 25 },
      trader: {
        tx: 16,
        tz: 19,
        name: 'Грач-Жестянщик',
        stock: [
          { id: 'repairKit', price: 18, qty: 4 },
          { id: 'pickaxe', price: 16, qty: 2 },
          { id: 'axe', price: 15, qty: 2 },
          { id: 'handPump', price: 22, qty: 2 },
          { id: 'scrap', price: 3, qty: 18 },
          { id: 'oil', price: 8, qty: 8 },
          { id: 'ammo9', price: 2, qty: 90 },
          { id: 'ammo556', price: 4, qty: 80 },
          { id: 'shotgunShell', price: 5, qty: 28 },
          { id: 'napalm', price: 6, qty: 35 },
          { id: 'pistol', price: 48, qty: 1 },
          { id: 'rifle', price: 78, qty: 1 },
          { id: 'shotgun', price: 138, qty: 1 },
          { id: 'metalArmor', price: 54, qty: 1 },
          { id: 'ballisticVest', price: 82, qty: 1 },
          { id: 'scoutBoots', price: 20, qty: 1 },
          { id: 'backpack', price: 32, qty: 1 },
          { id: 'water', price: 6, qty: 5 }
        ],
        buyInterests: ['materials', 'tools', 'weapons', 'armor']
      }
    },
    relayStation: {
      id: 'relayStation',
      name: 'Станция Ретранслятор',
      seed: 20260823,
      safe: true,
      pvpMode: 'peaceful',
      spawn: { tx: 19, tz: 25 },
      entryFromWorld: { tx: 19, tz: 25 },
      trader: {
        tx: 22,
        tz: 18,
        name: 'Рада Искра',
        stock: [
          { id: 'energyCell', price: 4, qty: 120 },
          { id: 'napalm', price: 6, qty: 50 },
          { id: 'laserPistol', price: 128, qty: 1 },
          { id: 'plasmaRifle', price: 232, qty: 1 },
          { id: 'flamethrower', price: 198, qty: 1 },
          { id: 'oil', price: 9, qty: 14 },
          { id: 'repairKit', price: 18, qty: 3 },
          { id: 'hazmatSuit', price: 88, qty: 1 },
          { id: 'energySuit', price: 138, qty: 1 },
          { id: 'tacticalHelmet', price: 32, qty: 1 },
          { id: 'assaultHelmet', price: 50, qty: 1 },
          { id: 'doctorBag', price: 36, qty: 2 },
          { id: 'antibiotics', price: 26, qty: 4 },
          { id: 'medkit', price: 21, qty: 4 },
          { id: 'rocketAmmo', price: 22, qty: 4 },
          { id: 'napalm', price: 6, qty: 20 },
          { id: 'water', price: 6, qty: 4 }
        ],
        buyInterests: ['tools', 'ammo', 'weapons', 'armor']
      }
    },
    randomEncounter: {
      id: 'randomEncounter',
      name: 'Событие мира',
      seed: 20260901,
      safe: false,
      pvpMode: 'pvp',
      encounterOnly: true,
      noRespawn: true,
      enemyCap: 0,
      spawnCount: 0,
      spawn: { tx: 19, tz: 19 },
      entryFromWorld: { tx: 19, tz: 19 },
      entryFromNorth: { tx: 19, tz: 4 },
      entryFromSouth: { tx: 19, tz: 34 },
      entryFromWest: { tx: 4, tz: 19 },
      entryFromEast: { tx: 34, tz: 19 }
    },
    randomAshGrove: {
      id: 'randomAshGrove',
      name: 'Пепельная роща',
      seed: 20260911,
      safe: false,
      pvpMode: 'pvp',
      randomTemplate: true,
      noRespawn: true,
      enemyCap: 0,
      spawnCount: 0,
      spawn: { tx: 19, tz: 19 },
      entryFromWorld: { tx: 19, tz: 19 },
      entryFromNorth: { tx: 19, tz: 4 },
      entryFromSouth: { tx: 19, tz: 34 },
      entryFromWest: { tx: 4, tz: 19 },
      entryFromEast: { tx: 34, tz: 19 }
    },
    randomDryBasin: {
      id: 'randomDryBasin',
      name: 'Сухая низина',
      seed: 20260921,
      safe: false,
      pvpMode: 'pvp',
      randomTemplate: true,
      noRespawn: true,
      enemyCap: 0,
      spawnCount: 0,
      spawn: { tx: 19, tz: 19 },
      entryFromWorld: { tx: 19, tz: 19 },
      entryFromNorth: { tx: 19, tz: 4 },
      entryFromSouth: { tx: 19, tz: 34 },
      entryFromWest: { tx: 4, tz: 19 },
      entryFromEast: { tx: 34, tz: 19 }
    },
    randomRuinedRoad: {
      id: 'randomRuinedRoad',
      name: 'Старая дорога',
      seed: 20260931,
      safe: false,
      pvpMode: 'pvp',
      randomTemplate: true,
      noRespawn: true,
      enemyCap: 0,
      spawnCount: 0,
      spawn: { tx: 19, tz: 19 },
      entryFromWorld: { tx: 19, tz: 19 },
      entryFromNorth: { tx: 19, tz: 4 },
      entryFromSouth: { tx: 19, tz: 34 },
      entryFromWest: { tx: 4, tz: 19 },
      entryFromEast: { tx: 34, tz: 19 }
    }
  };
  applyLocationTraderProfiles(LOCATIONS);
  let currentLocation = LOCATIONS.settlement;
  let clientLocationConfigLoaded = false;

  function applyLocationTraderProfiles(locations = {}) {
    const profiles = {
      settlement: { id: 'old_klim', dialogueProfile: 'klim', caps: 720, quests: ['klimSupplies', 'klimTerminal'] },
      scrapTown: { id: 'scrap_gratch', dialogueProfile: 'scrap', caps: 460, quests: ['scrapParts'] },
      relayStation: { id: 'relay_rada', dialogueProfile: 'relay', caps: 640, quests: ['relayCalibration'] }
    };
    Object.entries(profiles).forEach(([locationId, profile]) => {
      const loc = locations?.[locationId];
      if (!loc?.trader) return;
      const authoredActor = !!loc.trader.authoredActor;
      loc.trader = { ...profile, ...loc.trader };
      if (!authoredActor || !loc.trader.id) loc.trader.id = profile.id;
      if (!authoredActor || !loc.trader.dialogueProfile) loc.trader.dialogueProfile = profile.dialogueProfile;
      loc.trader.caps = Number.isFinite(Number(loc.trader.caps)) ? Math.max(0, Math.floor(Number(loc.trader.caps))) : profile.caps;
      loc.trader.quests = Array.isArray(loc.trader.quests) && loc.trader.quests.length ? loc.trader.quests : profile.quests.slice();
    });
    return locations;
  }

  function normalizeClientLocationDictionary(input = {}) {
    const src = input && typeof input === 'object' ? input : {};
    const rows = Array.isArray(src)
      ? src
      : Object.values(src);
    const out = {};
    rows.forEach(row => {
      if (!row || typeof row !== 'object') return;
      const id = String(row.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      if (!id) return;
      const loc = { ...row, id };
      loc.name = String(loc.name || id).slice(0, 120);
      loc.safe = loc.pvpMode === 'peaceful' || loc.safe === true;
      loc.pvpMode = loc.pvpMode || (loc.safe ? 'peaceful' : 'pvp');
      if (!loc.spawn) loc.spawn = { tx: 19, tz: 19 };
      out[id] = loc;
    });
    return out;
  }

  function applyClientLocationConfig(locations = {}) {
    const next = normalizeClientLocationDictionary(locations);
    if (!Object.keys(next).length) return false;
    LOCATIONS = next;
    clientLocationConfigLoaded = true;
    const currentId = currentLocation?.id || 'settlement';
    currentLocation = LOCATIONS[currentId] || LOCATIONS.settlement || Object.values(LOCATIONS)[0];
    if (globalMapState && currentLocation) globalMapState.fromLocationId = currentLocation.id;
    const title = document.getElementById('map-title');
    if (title && currentLocation) title.textContent = currentLocation.name;
    return true;
  }

  async function loadLocationConfig() {
    try {
      const data = typeof serverApi === 'function'
        ? await serverApi('/api/locations', { method: 'GET' })
        : await fetch('/api/locations', { cache: 'no-store' }).then(res => res.json());
      if (data?.ok && data.locations && applyClientLocationConfig(data.locations)) {
        return true;
      }
    } catch (err) {
      console.warn('[locations] failed to load file locations', err);
    }
    return false;
  }

  let exitPortal = null;
  let traderNpc = null;
  let storageBox = null;
  const traderBuildingCutawayRoofs = [];
  const traderBuildingStaticRoofs = [];
  const traderBuildingCutawayRoofBatches = [];
  const traderBuildingInteriorObjects = [];
  const traderBuildingWallBlocks = [];
  const traderBuildingAuthoredRoofBlocks = [];
  const traderBuildingOcclusionVolumes = [];
  const traderRoofBatchUnitGeometry = markSharedGeometry(createTraderRoofBatchUnitGeometry());
  const traderRoofCutawayRuntime = {
    elapsed: 999,
    minInterval: 0.10,
    maxIdleInterval: 0.50,
    force: true,
    lastPlayerX: NaN,
    lastPlayerZ: NaN,
    lastTileX: NaN,
    lastTileZ: NaN,
    lastInside: false,
    lastFullRoofCutawayVisible: null,
    evaluatedFullRoofCutawayVisible: false,
    lastAnyVisibleInteriorZone: false,
    roofVisibilityChanged: false,
    cachedInteriorVisibilityTick: -1,
    lastRoofGateKey: '',
    lastRoofGateVisible: false,
    lastInteriorVisibilityKey: '',
    lastRoofVisibilityApplied: null,
    roofOpacityCutaway: false,
    lastRoofOpacityApplied: null,
    lastRoofCellGateKey: '',
    lastFogVisibilityVersion: -1,
    wallTransparencyElapsed: 999,
    wallTransparencyMinInterval: 0.12,
    wallTransparencyMaxIdleInterval: 2.00,
    lastWallTransparencyKey: '',
    wallCutawayCache: null,
    roofCutawayCache: null,
    fadedWallBlocks: new Set(),
    fadedRoofBlocks: new Set(),
    shellBoundsCache: null,
    roofReleasePending: false,
    cutawayWarmupDone: false,
    cutawayWarmupScheduled: false,
    cutawayWarmupToken: 0,
    cutawayWarmupTarget: null,
    batchedRoofMatrix: new THREE.Matrix4(),
    batchedRoofPosition: new THREE.Vector3(),
    batchedRoofQuaternion: new THREE.Quaternion(),
    batchedRoofScale: new THREE.Vector3()
  };

  const traderEdgeDustHazeRuntime = {
    items: [],
    time: 0
  };

  const locationStates = {};

  // v7.65: full-screen transition overlay. World rebuilds are still synchronous,
  // but they now start only after the browser has painted the loading screen.
  let locationTransitionActive = false;
  let locationTransitionToken = 0;
  const LOCATION_LOADING_MIN_VISIBLE_MS = 360;
  const STARTUP_REVEAL_FRAME_COUNT = 4;
  const STARTUP_REVEAL_EXTRA_HOLD_MS = 260;

  function locationLoadingElements() {
    const screen = document.getElementById('location-loading-screen');
    return {
      screen,
      kicker: document.getElementById('location-loading-kicker') || screen?.querySelector('.location-loading-kicker'),
      title: document.getElementById('location-loading-title'),
      subtitle: document.getElementById('location-loading-subtitle'),
      step: document.getElementById('location-loading-step'),
      bar: document.getElementById('location-loading-bar'),
      hint: document.getElementById('location-loading-hint') || screen?.querySelector('.location-loading-hint')
    };
  }

  function setLocationLoadingProgress(stepText, percent = 0, subtitleText = '') {
    const el = locationLoadingElements();
    if (el.step && stepText) el.step.textContent = stepText;
    if (el.subtitle && subtitleText) el.subtitle.textContent = subtitleText;
    if (el.bar) el.bar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  }

  function showLocationLoading(targetName = 'локация', subtitleText = 'Подготовка мира...', options = {}) {
    const el = locationLoadingElements();
    const mode = options.mode || 'location';
    locationTransitionActive = true;
    if (typeof stopAutoFire === 'function') stopAutoFire();
    if (typeof stopTouchAim === 'function') stopTouchAim();
    if (typeof virtualMove === 'object' && virtualMove) {
      virtualMove.active = false;
      virtualMove.forward = 0;
      virtualMove.right = 0;
      virtualMove.pointerId = null;
    }
    if (player) {
      player.attackTarget = null;
    }
    document.body.classList.add('location-loading-active');
    document.body.classList.toggle('game-startup-loading-active', mode === 'startup');
    if (el.kicker) el.kicker.textContent = options.kicker || (mode === 'startup' ? 'Вход в игру' : 'Переход между локациями');
    if (el.title) el.title.textContent = targetName;
    if (el.subtitle) el.subtitle.textContent = subtitleText;
    if (el.step) el.step.textContent = options.initialStep || (mode === 'startup' ? 'Подготовка персонажа...' : 'Подготовка перехода...');
    if (el.hint) el.hint.textContent = options.hint || (mode === 'startup'
      ? 'Мир станет доступен после сборки окружения, прогрева материалов и стабилизации камеры.'
      : 'Мир станет доступен после загрузки геометрии, текстур, теней и общей локации.');
    if (el.bar) el.bar.style.width = `${Math.max(0, Math.min(100, Number(options.initialProgress) || 4))}%`;
    if (el.screen) {
      el.screen.classList.add('visible');
      el.screen.setAttribute('aria-hidden', 'false');
    }
  }

  function hideLocationLoading() {
    const el = locationLoadingElements();
    document.body.classList.remove('location-loading-active', 'game-startup-loading-active');
    if (el.screen) {
      el.screen.classList.remove('visible');
      el.screen.setAttribute('aria-hidden', 'true');
    }
    locationTransitionActive = false;
  }

  function nextPaintForLocationLoading() {
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  function withTimeout(promise, ms = 7000) {
    let timer = null;
    return new Promise(resolve => {
      timer = setTimeout(() => resolve(false), ms);
      Promise.resolve(promise).then(
        value => { clearTimeout(timer); resolve(value); },
        () => { clearTimeout(timer); resolve(false); }
      );
    });
  }

  function forceWorldVisibleForStartupReveal() {
    if (worldGroup) {
      worldGroup.visible = true;
      worldGroup.traverse(obj => {
        if (!obj) return;
        if (obj.userData && obj.userData.keepHiddenDuringStartupReveal) return;
        if (obj.isMesh || obj.isGroup || obj.isInstancedMesh || obj.isLight) obj.visible = true;
      });
    }
    if (playerGroup) {
      playerGroup.visible = true;
      playerGroup.position.set(player.x, 0, player.z);
      playerGroup.rotation.y = player.angle + Math.PI;
      playerGroup.updateMatrixWorld(true);
    }
    if (typeof updatePlayerEquipmentVisuals === 'function') {
      try { updatePlayerEquipmentVisuals(); } catch (_) {}
    }
    if (Array.isArray(staticCullObjects)) {
      staticCullObjects.forEach(row => { if (row && row.object) row.object.visible = true; });
    }
  }

  function renderStartupRevealFrame(reason = 'startup-reveal') {
    forceWorldVisibleForStartupReveal();
    if (typeof forceCameraViewportSync === 'function') {
      try { forceCameraViewportSync(reason); } catch (_) {}
    } else if (typeof updateCamera === 'function') {
      try { updateCamera(0); } catch (_) {}
    }
    if (typeof rebuildRtsFogOfWar === 'function') {
      try { rebuildRtsFogOfWar(); } catch (_) {}
    }
    if (typeof updateVisionShade === 'function') {
      try { updateVisionShade(); } catch (_) {}
    }
    if (typeof updateOccludedEntityVisibility === 'function') {
      try { updateOccludedEntityVisibility(0.016); } catch (_) {}
    }
    if (typeof updateTraderBuildingRoofCutaway === 'function') {
      try { updateTraderBuildingRoofCutaway(0.016); } catch (_) {}
    }
    if (typeof requestDynamicShadowRefresh === 'function') requestDynamicShadowRefresh();
    if (renderer && renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
    if (typeof drawMinimap === 'function') {
      try { drawMinimap(); } catch (_) {}
    }
    if (renderer && scene && camera) {
      try { renderer.render(scene, camera); } catch (_) {}
    }
  }

  async function waitForStartupVisualRevealSettle() {
    if (typeof waitForStartupNetworkQuiet === 'function') {
      setLocationLoadingProgress('Жду стартовую синхронизацию сервера...', 94);
      await waitForStartupNetworkQuiet({ quietMs: 240, timeoutMs: 1800 });
    }
    setLocationLoadingProgress('Готовлю первый кадр мира...', 97);
    renderStartupRevealFrame('startup-reveal:pre');
    for (let i = 0; i < STARTUP_REVEAL_FRAME_COUNT; i++) {
      await nextPaintForLocationLoading();
      renderStartupRevealFrame(`startup-reveal:frame-${i + 1}`);
    }
    await new Promise(resolve => setTimeout(resolve, STARTUP_REVEAL_EXTRA_HOLD_MS));
    renderStartupRevealFrame('startup-reveal:final');
  }

  function preloadImageForLocation(url) {
    if (!url) return Promise.resolve(true);
    const normalized = url.startsWith('/') ? url : `/${url}`;
    if (THREE.Cache && THREE.Cache.get && (THREE.Cache.get(url) || THREE.Cache.get(normalized))) return Promise.resolve(true);
    return new Promise(resolve => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        try {
          if (THREE.Cache && THREE.Cache.add) {
            THREE.Cache.add(normalized, img);
            THREE.Cache.add(url, img);
          }
        } catch (_) {}
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = normalized;
    });
  }

  function uniqueLocationUrls(list) {
    const seen = new Set();
    const out = [];
    (list || []).forEach(url => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      out.push(url);
    });
    return out;
  }

  function getLocationPreloadTextureUrls(locationId) {
    const budget = graphicsTextureBudget();
    const urls = [
      getReliefTexturePath('base'),
      budget.pbrMaps ? getReliefTexturePath('normal') : null,
      budget.pbrMaps ? getReliefTexturePath('roughness') : null,
      budget.displacement ? getReliefTexturePath('height') : null,
      budget.pbrMaps ? getReliefTexturePath('ao') : null,
      'assets/textures/cc0/cc0_style_dry_wood.png',
      'assets/textures/cc0/cc0_style_rusty_metal.png',
      'assets/textures/materials_ground_dirt_01/stone_wall_base_v759.webp',
      'assets/textures/materials_ground_dirt_01/stone_wall_normal_v759.webp'
    ];
    if (locationId === 'settlement') {
      urls.push(
        'assets/textures/materials_ground_dirt_01/layer_sand_from_archive_v759.webp',
        'assets/textures/materials_ground_dirt_01/relief_cracked_patch_rgba_v760.webp',
        'assets/textures/materials_ground_dirt_01/relief_gravel_pebbles_rgba_v760.webp',
        'assets/textures/materials_ground_dirt_01/layer_tire_tracks_from_archive_v759.webp',
        'assets/textures/materials_ground_dirt_01/relief_mud_scorch_rgba_v760.webp',
        'assets/textures/materials_ground_dirt_01/layer_straw_dry_grass_from_archive_v759.webp',
        'assets/textures/wasteland/layers/soft_shadow_blob_v758.webp',
        'assets/textures/wasteland/layers/baked_contact_ao_blob_v761.webp',
        'assets/textures/wasteland/layers/warm_bloom_blob_v761.webp',
        'assets/textures/psx_buildings/trader_wall_metal_blue_base_v769.webp',
        'assets/textures/psx_buildings/trader_wall_metal_blue_normal_v769.webp',
        'assets/textures/psx_buildings/trader_wall_metal_blue_roughness_v769.webp',
        'assets/textures/psx_buildings/trader_wall_metal_blue_ao_v769.webp',
        'assets/textures/psx_buildings/trader_wall_corrugated_rust_base_v769.webp',
        'assets/textures/psx_buildings/trader_wall_corrugated_rust_normal_v769.webp',
        'assets/textures/psx_buildings/trader_wall_corrugated_rust_roughness_v769.webp',
        'assets/textures/psx_buildings/trader_wall_corrugated_rust_ao_v769.webp',
        'assets/textures/psx_buildings/trader_floor_concrete_base_v769.webp',
        'assets/textures/psx_buildings/trader_floor_concrete_normal_v769.webp',
        'assets/textures/psx_buildings/trader_floor_concrete_roughness_v769.webp',
        'assets/textures/psx_buildings/trader_floor_concrete_ao_v769.webp',
        'assets/textures/psx_buildings/trader_roof_red_white_base_v769.webp',
        'assets/textures/psx_buildings/trader_roof_red_white_normal_v769.webp',
        'assets/textures/psx_buildings/trader_roof_red_white_roughness_v769.webp',
        'assets/textures/psx_buildings/trader_roof_red_white_ao_v769.webp',
        'assets/textures/psx_buildings/trader_window_dark_v769.webp',
        'assets/textures/materials_wood_bricks_01/oldbricks_base_v770.webp',
        'assets/textures/materials_wood_bricks_01/oldbricks_normal_v770.webp',
        'assets/textures/materials_wood_bricks_01/oldbricks_roughness_v770.webp',
        'assets/textures/materials_wood_bricks_01/oldbricks_ao_v770.webp',
        'assets/textures/materials_wood_bricks_01/oldbricks_height_v770.webp',
        'assets/textures/materials_wood_bricks_01/destroyed_concrete_base_v770.webp',
        'assets/textures/materials_wood_bricks_01/destroyed_concrete_normal_v770.webp',
        'assets/textures/materials_wood_bricks_01/destroyed_concrete_roughness_v770.webp',
        'assets/textures/materials_wood_bricks_01/destroyed_concrete_ao_v770.webp',
        'assets/textures/materials_wood_bricks_01/destroyed_concrete_height_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_floor_02_base_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_floor_02_normal_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_floor_02_roughness_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_floor_02_ao_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_floor_02_height_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_floor_04_base_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_floor_04_normal_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_floor_04_roughness_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_floor_04_ao_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_floor_04_height_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_bricks_floor_base_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_bricks_floor_normal_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_bricks_floor_roughness_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_bricks_floor_ao_v770.webp',
        'assets/textures/materials_wood_bricks_01/wood_bricks_floor_height_v770.webp'
      );
      if (budget.layerNormals) {
        urls.push(
          'assets/textures/materials_ground_dirt_01/layer_sand_micro_normal_v761.webp',
          'assets/textures/materials_ground_dirt_01/relief_cracked_patch_normal_v761.webp',
          'assets/textures/materials_ground_dirt_01/relief_gravel_pebbles_normal_v761.webp',
          'assets/textures/materials_ground_dirt_01/layer_tire_tracks_normal_v761.webp',
          'assets/textures/materials_ground_dirt_01/relief_mud_scorch_normal_v761.webp',
          'assets/textures/materials_ground_dirt_01/layer_straw_dry_grass_normal_v761.webp'
        );
      }
    } else {
      urls.push(
        'assets/textures/cc0/cc0_style_desert_cracked_ground.png',
        'assets/textures/cc0/cc0_style_dust_decal.png',
        'assets/textures/cc0/cc0_style_crack_decal.png',
        'assets/textures/cc0/cc0_style_tire_tracks.png',
        'assets/textures/cc0/cc0_style_scrap_scatter.png',
        'assets/textures/cc0/cc0_style_scorch_decal.png'
      );
    }
    return uniqueLocationUrls(urls);
  }

  async function preloadLocationAssets(locationId, onProgress) {
    const urls = getLocationPreloadTextureUrls(locationId);
    if (!urls.length) return;
    let done = 0;
    await Promise.all(urls.map(async url => {
      await withTimeout(preloadImageForLocation(url), 6500);
      done += 1;
      if (onProgress) onProgress(done, urls.length, url);
    }));
  }

  async function runGameStartupLoading(title = 'Вход в игру', work, options = {}) {
    if (typeof work !== 'function') return false;
    if (locationTransitionActive) return false;
    const token = ++locationTransitionToken;
    const startedAt = performance.now();
    const targetLocation = options.location || currentLocation || LOCATIONS.settlement;
    showLocationLoading(title, options.subtitle || 'Подготавливаю персонажа и окружение...', {
      mode: 'startup',
      kicker: options.kicker || 'Вход в игру',
      initialStep: 'Открываю экран загрузки...',
      initialProgress: 6,
      hint: options.hint || 'Мир появится после сборки карты, прогрева материалов и точной установки камеры.'
    });

    try {
      await nextPaintForLocationLoading();
      if (token !== locationTransitionToken) return false;

      const characterScreen = document.getElementById('character-screen');
      if (characterScreen) characterScreen.classList.remove('visible');

      setLocationLoadingProgress('Подготавливаю графику и модели мира...', 12);
      await ensureWorldRuntimeReady();
      if (token !== locationTransitionToken) return false;

      setLocationLoadingProgress('Загружаю текстуры и материалы...', 18);
      await preloadLocationAssets(targetLocation.id, (done, total) => {
        const p = 18 + (done / Math.max(1, total)) * 34;
        setLocationLoadingProgress(`Загружаю ассеты ${done}/${total}...`, p);
      });
      if (token !== locationTransitionToken) return false;

      await nextPaintForLocationLoading();
      setLocationLoadingProgress('Собираю карту, персонажа и окружение...', 58);
      const result = work();
      if (result === false) throw new Error(options.errorMessage || 'Не удалось подготовить мир.');

      if (typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('startup-loading');
      if (typeof updateCamera === 'function') {
        try { updateCamera(0); } catch (_) {}
      }
      setLocationLoadingProgress('Прогреваю крышу, тени и шейдеры...', 78);
      prewarmTraderRoofCutawayRenderState('startup-loading');
      if (renderer && renderer.compile) {
        try { renderer.compile(scene, camera); } catch (_) {}
      }
      if (typeof requestDynamicShadowRefresh === 'function') requestDynamicShadowRefresh();
      if (renderer && scene && camera) {
        try { renderer.render(scene, camera); } catch (_) {}
      }

      if (typeof options.beforeReveal === 'function') {
        setLocationLoadingProgress(options.beforeRevealStep || 'Синхронизирую локацию с сервером...', options.beforeRevealProgress || 90);
        const revealResult = await options.beforeReveal();
        if (revealResult === false) throw new Error(options.errorMessage || 'Не удалось завершить вход в мир.');
        if (token !== locationTransitionToken) return false;
        if (typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('startup-network-ready');
        if (typeof updateCamera === 'function') {
          try { updateCamera(0); } catch (_) {}
        }
        if (typeof requestDynamicShadowRefresh === 'function') requestDynamicShadowRefresh();
        if (renderer && scene && camera) {
          try { renderer.render(scene, camera); } catch (_) {}
        }
      }

      await nextPaintForLocationLoading();
      if (typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('startup-loading-final');
      await waitForStartupVisualRevealSettle();
      setLocationLoadingProgress('Мир готов.', 100);
      const elapsed = performance.now() - startedAt;
      if (elapsed < LOCATION_LOADING_MIN_VISIBLE_MS) {
        await new Promise(resolve => setTimeout(resolve, LOCATION_LOADING_MIN_VISIBLE_MS - elapsed));
      }
      await nextPaintForLocationLoading();
      if (token === locationTransitionToken) hideLocationLoading();
      return true;
    } catch (error) {
      console.error('Game startup loading failed:', error);
      setLocationLoadingProgress('Ошибка загрузки мира.', 100);
      setTimeout(() => {
        if (token === locationTransitionToken) {
          hideLocationLoading();
          const characterScreen = document.getElementById('character-screen');
          if (characterScreen) characterScreen.classList.add('visible');
        }
      }, 600);
      return false;
    }
  }

  async function runLocationTransition(targetLocation, work, options = {}) {
    if (!targetLocation || typeof work !== 'function') return false;
    if (locationTransitionActive) return false;
    const token = ++locationTransitionToken;
    const startedAt = performance.now();
    showLocationLoading(targetLocation.name || 'Загрузка локации', options.subtitle || 'Подготовка ассетов и окружения...');
    setLocationLoadingProgress('Останавливаю движение и закрываю окна...', 8);

    try {
      await nextPaintForLocationLoading();
      if (token !== locationTransitionToken) return false;

      setLocationLoadingProgress('Загружаю текстуры земли и декали...', 18);
      await preloadLocationAssets(targetLocation.id, (done, total) => {
        const p = 18 + (done / Math.max(1, total)) * 44;
        setLocationLoadingProgress(`Загружаю ассеты ${done}/${total}...`, p);
      });
      if (token !== locationTransitionToken) return false;

      await nextPaintForLocationLoading();
      setLocationLoadingProgress('Собираю геометрию локации...', 70);
      const workResult = work();
      const resolvedWorkResult = workResult && typeof workResult.then === 'function'
        ? (setLocationLoadingProgress('Синхронизирую общую локацию...', 78), await workResult)
        : workResult;
      if (resolvedWorkResult === false) throw new Error(options.errorMessage || 'Не удалось подготовить локацию.');
      if (token !== locationTransitionToken) return false;

      // Changing location to the trader yard can rebuild the DOM/canvas overlay
      // and the heavy roof scene in the same frame. Force the same camera/canvas
      // sync used on game startup while the loading screen is still covering the
      // world, otherwise the first visible settlement frame may look zoomed in
      // until fullscreen/devtools triggers a resize.
      if (typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('location-transition-after-build');
      if (typeof updateCamera === 'function') {
        try { updateCamera(0); } catch (_) {}
      }
      if (renderer && scene && camera) {
        try { renderer.render(scene, camera); } catch (_) {}
      }
      await nextPaintForLocationLoading();

      setLocationLoadingProgress('Прогреваю быстрый срез крыши...', 82);
      prewarmTraderRoofCutawayRenderState('location-transition');

      setLocationLoadingProgress('Компилирую материалы и шейдеры...', 86);
      if (renderer && renderer.compile) {
        try { renderer.compile(scene, camera); } catch (_) {}
      }
      if (renderer && scene && camera) {
        try { renderer.render(scene, camera); } catch (_) {}
      }
      setLocationLoadingProgress('Настраиваю динамические тени...', 94);
      if (typeof requestDynamicShadowRefresh === 'function') requestDynamicShadowRefresh();
      if (renderer && scene && camera) {
        try { renderer.render(scene, camera); } catch (_) {}
      }

      setLocationLoadingProgress('Локация готова.', 100);
      if (typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('location-transition-ready');
      if (typeof renderStartupRevealFrame === 'function') {
        try { renderStartupRevealFrame('location-transition-ready'); } catch (_) {}
      } else if (typeof updateCamera === 'function') {
        try { updateCamera(0); } catch (_) {}
      }
      const elapsed = performance.now() - startedAt;
      if (elapsed < LOCATION_LOADING_MIN_VISIBLE_MS) {
        await new Promise(resolve => setTimeout(resolve, LOCATION_LOADING_MIN_VISIBLE_MS - elapsed));
      }
      await nextPaintForLocationLoading();
      if (typeof forceCameraViewportSync === 'function') {
        try { forceCameraViewportSync('location-transition-before-reveal'); } catch (_) {}
      }
      if (renderer && scene && camera) {
        try { renderer.render(scene, camera); } catch (_) {}
      }
      if (token === locationTransitionToken) hideLocationLoading();
      return true;
    } catch (error) {
      console.error('Location transition failed:', error);
      if (typeof addLog === 'function') addLog('Ошибка загрузки локации. Попробуйте перейти ещё раз.', null, 'system');
      setLocationLoadingProgress('Ошибка загрузки локации.', 100);
      setTimeout(() => { if (token === locationTransitionToken) hideLocationLoading(); }, 600);
      return false;
    }
  }

  const TRADER_STOCK = [
    { id: 'ammo9', price: 2 },
    { id: 'ammo556', price: 4 },
    { id: 'stim', price: 12 },
    { id: 'medkit', price: 22 },
    { id: 'doctorBag', price: 38 },
    { id: 'antibiotics', price: 28 },
    { id: 'water', price: 5 },
    { id: 'oil', price: 9 },
    { id: 'pickaxe', price: 18 },
    { id: 'axe', price: 16 },
    { id: 'handPump', price: 24 },
    { id: 'repairKit', price: 20 },
    { id: 'leather', price: 28 },
    { id: 'metalArmor', price: 58 },
    { id: 'ballisticVest', price: 86 },
    { id: 'combatArmor', price: 130 },
    { id: 'hazmatSuit', price: 96 },
    { id: 'heavyArmor', price: 170 },
    { id: 'energySuit', price: 145 },
    { id: 'helmet', price: 18 },
    { id: 'tacticalHelmet', price: 34 },
    { id: 'assaultHelmet', price: 52 },
    { id: 'boots', price: 16 },
    { id: 'scoutBoots', price: 22 },
    { id: 'reinforcedBoots', price: 30 },
    { id: 'backpack', price: 34 },
    { id: 'rifle', price: 80 },
    { id: 'assaultRifle', price: 115 },
    { id: 'machineGun', price: 185 },
    { id: 'laserPistol', price: 135 },
    { id: 'flamethrower', price: 210 },
    { id: 'plasmaRifle', price: 240 },
    { id: 'shotgun', price: 150 },
    { id: 'rocketLauncher', price: 320 },
    { id: 'energyCell', price: 5 },
    { id: 'napalm', price: 6 },
    { id: 'shotgunShell', price: 5 },
    { id: 'rocketAmmo', price: 24 }
  ];


  function rngFactory(seed) {
    return function() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  let rand = rngFactory(98765);

  function tileToWorld(tx, tz) {
    return {
      x: (tx - MAP_W / 2 + 0.5) * TILE,
      z: (tz - MAP_H / 2 + 0.5) * TILE
    };
  }

  function worldToTile(x, z) {
    return {
      tx: Math.floor(x / TILE + MAP_W / 2),
      tz: Math.floor(z / TILE + MAP_H / 2)
    };
  }

  function traderBuildingCenterWorld() {
    // v7.74.97: the trader building is an even 10 x 8 tile footprint.
    // Its logical origin is placed on a world tile corner, not at a tile center,
    // so every wall/roof/fog cell aligns exactly to the main TILE grid.
    const c = tileToWorld(15, 20);
    const tile = Number(TILE || 2.0);
    return { x: c.x - tile / 2, z: c.z - tile / 2 };
  }

  function inBounds(tx, tz) {
    return tx >= 0 && tz >= 0 && tx < MAP_W && tz < MAP_H;
  }

  function authoredTileKey(tx, tz) {
    return `${tx}:${tz}`;
  }

  function clearAuthoredTileLayers() {
    authoredMovementBlockers.clear();
    authoredVisionBlockers.clear();
    authoredLowVisionCover.clear();
  }

  function clearAuthoredTileMarks(tx, tz) {
    const key = authoredTileKey(tx, tz);
    authoredMovementBlockers.delete(key);
    authoredVisionBlockers.delete(key);
    authoredLowVisionCover.delete(key);
  }

  function markAuthoredTileLayer(tx, tz, layer) {
    if (!inBounds(tx, tz)) return;
    const key = authoredTileKey(tx, tz);
    if (layer === 'movement') authoredMovementBlockers.add(key);
    else if (layer === 'vision-block') {
      authoredVisionBlockers.add(key);
      authoredLowVisionCover.delete(key);
    } else if (layer === 'vision-cover' && !authoredVisionBlockers.has(key)) {
      authoredLowVisionCover.add(key);
    }
  }

  // The broad bounds make lookup cheap; collision itself uses the model-aligned OBB.
  function addStaticCollisionBox(cx, cz, width, depth, label = 'static-collider', rotationY = 0) {
    if (!Number.isFinite(cx) || !Number.isFinite(cz) || width <= 0 || depth <= 0) return null;
    const halfX = width / 2;
    const halfZ = depth / 2;
    const angle = Number(rotationY || 0);
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const broadHalfX = halfX * cos + halfZ * sin;
    const broadHalfZ = halfX * sin + halfZ * cos;
    const box = {
      x: cx,
      z: cz,
      halfX,
      halfZ,
      rotationY: angle,
      minX: cx - broadHalfX,
      maxX: cx + broadHalfX,
      minZ: cz - broadHalfZ,
      maxZ: cz + broadHalfZ,
      label
    };
    staticCollisionBoxes.push(box);
    return box;
  }

  function removeStaticCollisionBox(box) {
    if (Array.isArray(box)) {
      box.forEach(removeStaticCollisionBox);
      return;
    }
    const index = staticCollisionBoxes.indexOf(box);
    if (index >= 0) staticCollisionBoxes.splice(index, 1);
  }

  function addStaticCollisionTile(tx, tz, width, depth, label = 'static-collider', dx = 0, dz = 0) {
    const p = tileToWorld(tx, tz);
    return addStaticCollisionBox(p.x + dx, p.z + dz, width, depth, label);
  }

  function addStaticCollisionSpanTiles(tx1, tz1, tx2, tz2, thickness = 0.75, label = 'static-wall') {
    const a = tileToWorld(tx1, tz1);
    const b = tileToWorld(tx2, tz2);
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    const width = Math.abs(a.x - b.x) + TILE;
    const depth = Math.abs(a.z - b.z) + TILE;
    if (width >= depth) return addStaticCollisionBox(cx, cz, width, thickness, label);
    return addStaticCollisionBox(cx, cz, thickness, depth, label);
  }

  function staticCollisionBoxPenaltyAt(x, z, radius, b) {
    if (!b || x < b.minX - radius || x > b.maxX + radius || z < b.minZ - radius || z > b.maxZ + radius) return 0;
    const dx = x - b.x;
    const dz = z - b.z;
    const cos = Math.cos(b.rotationY || 0);
    const sin = Math.sin(b.rotationY || 0);
    const localX = dx * cos + dz * sin;
    const localZ = -dx * sin + dz * cos;
    const nearestX = Math.max(-b.halfX, Math.min(b.halfX, localX));
    const nearestZ = Math.max(-b.halfZ, Math.min(b.halfZ, localZ));
    const outsideDistance = Math.hypot(localX - nearestX, localZ - nearestZ);
    if (outsideDistance > 0) return Math.max(0, radius - outsideDistance);
    return radius + Math.min(b.halfX - Math.abs(localX), b.halfZ - Math.abs(localZ));
  }

  function staticCollisionPenaltyAt(x, z, radius = 0.38) {
    let penalty = 0;
    for (const b of staticCollisionBoxes) {
      penalty = Math.max(penalty, staticCollisionBoxPenaltyAt(x, z, radius, b));
    }
    return penalty;
  }

  function isBlockedByStaticCollision(x, z, radius = 0.38) {
    return staticCollisionPenaltyAt(x, z, radius) > 0.0001;
  }

  function staticCollisionRayHitDistance(x, z, dirX, dirZ, maxRange = 1.0, radius = 0.0, opts = {}) {
    if (!staticCollisionBoxes.length) return null;
    const len = Math.hypot(dirX, dirZ);
    if (!Number.isFinite(len) || len <= 0.0001) return null;
    const dx = dirX / len;
    const dz = dirZ / len;
    const startPad = Math.max(0.02, Number(opts.startPad || 0.12));
    let best = null;
    for (const b of staticCollisionBoxes) {
      if (!b) continue;
      const relX = x - Number(b.x || 0);
      const relZ = z - Number(b.z || 0);
      const cos = Math.cos(Number(b.rotationY || 0));
      const sin = Math.sin(Number(b.rotationY || 0));
      const localX = relX * cos + relZ * sin;
      const localZ = -relX * sin + relZ * cos;
      const localDx = dx * cos + dz * sin;
      const localDz = -dx * sin + dz * cos;
      const minX = -Number(b.halfX || 0) - radius;
      const maxX = Number(b.halfX || 0) + radius;
      const minZ = -Number(b.halfZ || 0) - radius;
      const maxZ = Number(b.halfZ || 0) + radius;
      let tMin = 0;
      let tMax = Number(maxRange || 0);
      if (Math.abs(localDx) < 0.00001) {
        if (localX < minX || localX > maxX) continue;
      } else {
        let t1 = (minX - localX) / localDx;
        let t2 = (maxX - localX) / localDx;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) continue;
      }
      if (Math.abs(localDz) < 0.00001) {
        if (localZ < minZ || localZ > maxZ) continue;
      } else {
        let t1 = (minZ - localZ) / localDz;
        let t2 = (maxZ - localZ) / localDz;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) continue;
      }
      if (tMax < startPad || tMin > maxRange) continue;
      const hit = Math.max(startPad, tMin);
      if (hit <= maxRange && (best === null || hit < best)) best = hit;
    }
    return best;
  }

  function isStaticCollisionBlockingWorldLine(x1, z1, x2, z2, radius = 0.0) {
    const dx = Number(x2 || 0) - Number(x1 || 0);
    const dz = Number(z2 || 0) - Number(z1 || 0);
    const maxRange = Math.hypot(dx, dz);
    if (!Number.isFinite(maxRange) || maxRange <= 0.001) return false;
    const hit = staticCollisionRayHitDistance(x1, z1, dx, dz, maxRange, radius, { startPad: 0.16 });
    return hit !== null && hit < maxRange - 0.08;
  }

  function tileTypeAt(tx, tz) {
    if (!inBounds(tx, tz) || !map || !Array.isArray(map[tz])) return null;
    return map[tz][tx];
  }

  function locationPlayableBounds(loc = currentLocation) {
    const raw = loc && loc.playableBounds && typeof loc.playableBounds === 'object' ? loc.playableBounds : {};
    const fit = (value, min, max) => Math.max(min, Math.min(max, Math.floor(Number(value) || 0)));
    const width = fit(raw.width || loc?.localWidthTiles || MAP_W, 8, MAP_W);
    const height = fit(raw.height || loc?.localHeightTiles || MAP_H, 8, MAP_H);
    const rawMinX = Number.isFinite(Number(raw.minX)) ? Number(raw.minX) : (MAP_W - width) / 2;
    const rawMinZ = Number.isFinite(Number(raw.minZ)) ? Number(raw.minZ) : (MAP_H - height) / 2;
    const minX = fit(rawMinX, 0, MAP_W - width);
    const minZ = fit(rawMinZ, 0, MAP_H - height);
    return { minX, minZ, maxX: minX + width - 1, maxZ: minZ + height - 1, width, height };
  }

  function tileWithinLocationPlayableBounds(tx, tz, loc = currentLocation) {
    const bounds = locationPlayableBounds(loc);
    return tx >= bounds.minX && tx <= bounds.maxX && tz >= bounds.minZ && tz <= bounds.maxZ;
  }

  // Movement, vision and bullets are intentionally separate systems.
  // Water blocks walking only: it does not block eyesight or bullets.
  // Low cover does not darken terrain or block movement. Standing characters see and shoot over it.
  // Crouched characters are lower: low cover blocks their own vision and shots,
  // and can hide other crouched characters directly behind it.
  function isMovementBlockingTile(tx, tz) {
    if (!tileWithinLocationPlayableBounds(tx, tz)) return true;
    const t = tileTypeAt(tx, tz);
    if (t === null) return true;
    if (authoredMovementBlockers.has(authoredTileKey(tx, tz))) return true;
    return t === TILE_TYPES.TREE ||
      t === TILE_TYPES.WATER ||
      t === TILE_TYPES.ORE ||
      t === TILE_TYPES.WOOD ||
      t === TILE_TYPES.OIL;
  }

  function isSolidTile(tx, tz) {
    return isMovementBlockingTile(tx, tz);
  }

  function isFullVisionBlockingTile(tx, tz) {
    const t = tileTypeAt(tx, tz);
    if (t === null) return true;
    if (authoredVisionBlockers.has(authoredTileKey(tx, tz))) return true;
    return t === TILE_TYPES.TREE;
  }

  function isLowVisionCoverTile(tx, tz) {
    const t = tileTypeAt(tx, tz);
    if (t === null) return false;
    if (authoredLowVisionCover.has(authoredTileKey(tx, tz))) return true;
    return t === TILE_TYPES.ROCK ||
      t === TILE_TYPES.ORE ||
      t === TILE_TYPES.WOOD ||
      t === TILE_TYPES.RUIN ||
      t === TILE_TYPES.OIL;
  }

  function isBallisticBlockingTile(tx, tz, options = {}) {
    const t = tileTypeAt(tx, tz);
    if (t === null) return true;
    if (t === TILE_TYPES.TREE) return true;
    // Стоя игрок стреляет поверх низких укрытий. Сидя игрок находится за
    // укрытием ниже, поэтому камень/руда/бревно/руины уже останавливают пулю.
    if (options.shooterCrouching && isLowVisionCoverTile(tx, tz)) return true;
    return false;
  }

  function isWalkableTile(tx, tz) {
    return inBounds(tx, tz) && !isMovementBlockingTile(tx, tz);
  }

  function isWorldTerrainWalkableTile(tx, tz) {
    if (!tileWithinLocationPlayableBounds(tx, tz)) return false;
    const type = tileTypeAt(tx, tz);
    if (type === null || type === TILE_TYPES.WATER) return false;
    // The legacy capital replaces these cells with hand-built geometry.
    if (currentLocation?.id === 'settlement' && type === TILE_TYPES.TREE) return false;
    return true;
  }

  function isWorldTerrainWalkable(x, z, radius = PLAYER_COLLISION_RADIUS) {
    const samples = [
      [x - radius, z - radius], [x + radius, z - radius],
      [x - radius, z + radius], [x + radius, z + radius], [x, z]
    ];
    const gridOk = samples.every(([sx, sz]) => {
      const { tx, tz } = worldToTile(sx, sz);
      return isWorldTerrainWalkableTile(tx, tz);
    });
    return gridOk;
  }

  function isWalkableWorld(x, z, radius = PLAYER_COLLISION_RADIUS) {
    return isWorldTerrainWalkable(x, z, radius) && !isBlockedByStaticCollision(x, z, radius);
  }

  function isPlayerCenterOnWalkable(x = player.x, z = player.z) {
    const t = worldToTile(x, z);
    return isWorldTerrainWalkableTile(t.tx, t.tz);
  }

  function recoverPlayerIfBlocked() {
    if (!player || isWalkableWorld(player.x, player.z)) return false;
    // A late-loaded or changed model collider must never shove the character.
    // Normal movement can now leave intersecting static geometry by reducing
    // penetration on both the client and the server. Recovery remains only for
    // invalid terrain/spawn positions where manual escape is impossible.
    if (isWorldTerrainWalkable(player.x, player.z)) return false;
    const cur = worldToTile(player.x, player.z);
    const candidates = [];
    for (let r = 0; r <= 5; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const tx = cur.tx + dx;
          const tz = cur.tz + dz;
          if (!isWalkableTile(tx, tz)) continue;
          const w = tileToWorld(tx, tz);
          candidates.push({ x: w.x, z: w.z, d: Math.hypot(w.x - player.x, w.z - player.z) });
        }
      }
      candidates.sort((a, b) => a.d - b.d);
      for (const c of candidates) {
        if (isWalkableWorld(c.x, c.z)) {
          player.x = c.x;
          player.z = c.z;
          return true;
        }
      }
    }
    return false;
  }

  function nudgePlayerAwayFromTile(tx, tz) {
    if (!inBounds(tx, tz)) return;
    const center = tileToWorld(tx, tz);
    let dx = player.x - center.x;
    let dz = player.z - center.z;
    let len = Math.hypot(dx, dz);
    if (len < 0.001) {
      dx = Math.sin(player.angle || 0);
      dz = Math.cos(player.angle || 0);
      len = Math.hypot(dx, dz) || 1;
    }
    dx /= len;
    dz /= len;
    const distances = [1.05, 1.25, 1.5, 1.8, 2.1];
    for (const d of distances) {
      const nx = center.x + dx * d;
      const nz = center.z + dz * d;
      if (isWalkableWorld(nx, nz)) {
        player.x = nx;
        player.z = nz;
        return;
      }
    }
    recoverPlayerIfBlocked();
  }

  function markAuthoredLocationObjectOnClientMap(row = {}) {
    if (locationObjectIsEntity(row)) return;
    const collision = String(row.collision || '').toLowerCase();
    const tags = authoredObjectTags(row);
    const model = String(row.model || row.url || '').toLowerCase();
    const explicitResourceRaw = String(row.resourceType || row.resource || '').trim().toLowerCase();
    const explicitResource = explicitResourceRaw === 'ammoparts'
      ? 'ammoParts'
      : explicitResourceRaw === 'weaponparts'
        ? 'weaponParts'
        : explicitResourceRaw;
    const isResourceCandidate = collision === 'resource' || tags.includes('resource') || tags.includes('harvestable') || tags.includes('resource-node');
    const resourceType =
      ['ore', 'wood', 'scrap', 'water', 'oil', 'chemicals', 'medicine', 'food', 'electronics', 'ammoParts', 'weaponParts'].includes(explicitResource) ? explicitResource :
      !isResourceCandidate ? '' :
      (tags.includes('oil') || model.includes('oil_pump') || model.includes('oilpump')) ? 'oil' :
      (tags.includes('scrap') || model.includes('scrap')) ? 'scrap' :
      (tags.includes('water') || model.includes('water_tank') || model.includes('watertank')) ? 'water' :
      (tags.includes('ore') || model.includes('ore')) ? 'ore' :
      (tags.includes('wood') || model.includes('deadwood') || (collision === 'resource' && tags.includes('tree'))) ? 'wood' :
      '';
    const authoritativeLocation = typeof authoritativeResourceSnapshotLocationId === 'string'
      ? authoritativeResourceSnapshotLocationId
      : '';
    if (resourceType && currentLocation && authoritativeLocation === String(currentLocation.id || '')) {
      const id = String(row.id || '');
      const live = resourceNodes.some(resource => resource
        && String(resource.id || '') === id
        && Number(resource.hp || 0) > 0);
      if (!live) return;
    }
    const blocksMovement = authoredObjectBlocksMovement(row);
    const visionKind = authoredObjectVisionKind(row);
    if (!blocksMovement && !resourceType && !visionKind) return;
    const pos = row.position && typeof row.position === 'object' ? row.position : row;
    const center = worldToTile(Number(pos.x || 0), Number(pos.z || 0));
    const size = authoredObjectCollisionSize(row);
    const cellsX = Math.max(1, Math.round(size.width / TILE));
    const cellsZ = Math.max(1, Math.round(size.depth / TILE));
    for (let dz = -Math.floor((cellsZ - 1) / 2); dz <= Math.ceil((cellsZ - 1) / 2); dz++) {
      for (let dx = -Math.floor((cellsX - 1) / 2); dx <= Math.ceil((cellsX - 1) / 2); dx++) {
        const tx = center.tx + dx;
        const tz = center.tz + dz;
        if (!inBounds(tx, tz)) continue;
        // Authored resources keep their own GLB and collider. The tile mark is
        // only a coarse pathfinding hint; drawing a procedural node here would
        // duplicate the model and restore a full-cell collision volume.
        if (blocksMovement) markAuthoredTileLayer(tx, tz, 'movement');
        if (visionKind === 'block') markAuthoredTileLayer(tx, tz, 'vision-block');
        else if (visionKind === 'cover') markAuthoredTileLayer(tx, tz, 'vision-cover');
      }
    }
    if (resourceType && inBounds(center.tx, center.tz)) {
      const id = row.id || `res_${center.tx}_${center.tz}_${resourceType}`;
      const existing = resourceNodes.find(resource => String(resource?.id || '') === String(id));
      if (existing) {
        existing.authoredObjectId = id;
        existing.authoredRow = row;
      } else {
        resourceNodes.push({
          id,
          tx: center.tx,
          tz: center.tz,
          type: resourceType,
          hp: Number(row.hp || 3),
          maxHp: Number(row.maxHp || row.hp || 3),
          mesh: null,
          authoredObjectId: id,
          authoredRow: row
        });
      }
    }
  }

  function buildAuthoredClientMap(loc = currentLocation) {
    if (!locationUsesAuthoredLayout(loc)) return false;
    map.length = 0;
    const preserveAuthoritativeResources = typeof authoritativeResourceSnapshotLocationId === 'string'
      && authoritativeResourceSnapshotLocationId === String(loc?.id || '');
    if (!preserveAuthoritativeResources) resourceNodes.length = 0;
    clearAuthoredTileLayers();
    for (let z = 0; z < MAP_H; z++) {
      map[z] = [];
      for (let x = 0; x < MAP_W; x++) {
        map[z][x] = (x === 0 || z === 0 || x === MAP_W - 1 || z === MAP_H - 1) ? TILE_TYPES.PATH : TILE_TYPES.GRASS;
      }
    }
    (Array.isArray(loc.objects) ? loc.objects : []).forEach(markAuthoredLocationObjectOnClientMap);
    const clearPoint = p => {
      if (!p) return;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = Number(p.tx) + dx;
          const z = Number(p.tz) + dz;
          if (inBounds(x, z)) {
            map[z][x] = TILE_TYPES.PATH;
            clearAuthoredTileMarks(x, z);
          }
        }
      }
    };
    [loc.spawn, loc.respawn, loc.entryFromWorld, loc.entryFromWasteland, loc.entryFromSettlement, loc.trader, loc.storage, loc.exit]
      .forEach(clearPoint);
    (Array.isArray(loc.transitions) ? loc.transitions : []).forEach(clearPoint);
    return true;
  }

  function generateMap() {
    map.length = 0;
    resourceNodes.length = 0;
    clearAuthoredTileLayers();
    const loc = currentLocation || LOCATIONS.settlement;
    rand = rngFactory(loc.seed || 1);
    const applyWorldExitEdges = () => {
      const bounds = locationPlayableBounds(loc);
      const isSizedWorldSite = loc.worldSiteInstance === true || loc.runtimeMode === 'worldSiteInstance';
      for (let z = 0; z < MAP_H; z++) {
        for (let x = 0; x < MAP_W; x++) {
          if (isSizedWorldSite && (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ)) {
            map[z][x] = TILE_TYPES.DARK;
            continue;
          }
          if (x <= bounds.minX + 1 || z <= bounds.minZ + 1 || x >= bounds.maxX - 1 || z >= bounds.maxZ - 1) map[z][x] = TILE_TYPES.PATH;
        }
      }
    };

    const authoredLayout = locationUsesAuthoredLayout(loc);
    const saved = authoredLayout ? null : locationStates[loc.id];
    if (saved && saved.map && saved.environmentVersion === WORLD_ENVIRONMENT_VERSION) {
      saved.map.forEach((row, z) => { map[z] = row.slice(); });
      (saved.resources || []).forEach(r => resourceNodes.push({ id: r.id || `res_${r.tx}_${r.tz}_${r.type || 'node'}`, tx: r.tx, tz: r.tz, type: r.type, hp: r.hp, maxHp: r.maxHp || 3, mesh: null }));
      applyWorldExitEdges();
      return;
    }
    if (saved && saved.map && saved.environmentVersion !== WORLD_ENVIRONMENT_VERSION) {
      locationStates[loc.id] = { environmentVersion: WORLD_ENVIRONMENT_VERSION, enemies: null };
    }

    if (authoredLayout && buildAuthoredClientMap(loc)) {
      applyWorldExitEdges();
      return;
    }

    for (let z = 0; z < MAP_H; z++) {
      map[z] = [];
      for (let x = 0; x < MAP_W; x++) {
        if (x === 0 || z === 0 || x === MAP_W - 1 || z === MAP_H - 1) {
          map[z][x] = TILE_TYPES.PATH;
          continue;
        }

        const proceduralArchetype = String(loc.templateLocationId || loc.id || '');
        const darkChance =
          proceduralArchetype === 'randomDryBasin' ? 0.20 :
            proceduralArchetype === 'scrapTown' ? 0.14 :
              proceduralArchetype === 'randomRuinedRoad' ? 0.10 :
                proceduralArchetype === 'relayStation' ? 0.09 :
                  proceduralArchetype === 'randomAshGrove' ? 0.08 : 0.06;
        map[z][x] = rand() < darkChance ? TILE_TYPES.DARK : TILE_TYPES.GRASS;
      }
    }

    const midX = Math.floor(MAP_W / 2);
    const midZ = Math.floor(MAP_H / 2);

    if (loc.id === 'settlement') {
      // v7.68: поселение стало осмысленным караванным фортом.
      // Внутри — чистый открытый двор для торговли, снаружи — отделённая фоном пустошь.
      for (let z = 0; z < MAP_H; z++) {
        for (let x = 0; x < MAP_W; x++) {
          map[z][x] = (x === 0 || z === 0 || x === MAP_W - 1 || z === MAP_H - 1) ? TILE_TYPES.PATH : TILE_TYPES.GRASS;
        }
      }
      const markPath = (cx, cz, rx = 1, rz = rx) => {
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
          for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            if (!inBounds(x, z)) continue;
            const nx = (x - cx) / Math.max(0.1, rx);
            const nz = (z - cz) / Math.max(0.1, rz);
            if (nx * nx + nz * nz <= 1.05) map[z][x] = TILE_TYPES.PATH;
          }
        }
      };
      const markLine = (x1, z1, x2, z2, radius = 1) => {
        const steps = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1)) * 2 + 1;
        for (let i = 0; i <= steps; i++) {
          const t = i / Math.max(1, steps);
          markPath(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, radius, radius * 0.72);
        }
      };
      const block = (type, cells) => cells.forEach(([x, z]) => { if (inBounds(x, z)) map[z][x] = type; });

      // Основные проходы: ворота → центральный двор → южный жилой сектор.
      markLine(19, 8, 19, 31, 1.55);
      markLine(13, 20, 26, 20, 1.05);
      markPath(19, 20, 8.6, 5.1);
      markPath(15, 20, 2.5, 1.85);
      markPath(24, 20, 2.6, 1.85);
      markPath(19, 10, 2.4, 1.8);
      markPath(19, 26, 3.0, 1.7);

      // Периметр форта из металлолома. Внешняя зона между стеной и краем карты — фон пустоши.
      const wallCells = [];
      for (let x = 5; x <= 33; x++) {
        if (x < 17 || x > 21) wallCells.push([x, 8]);
        wallCells.push([x, 31]);
      }
      for (let z = 9; z <= 30; z++) {
        wallCells.push([5, z], [33, z]);
      }
      block(TILE_TYPES.RUIN, wallCells);

      // Ворота, углы и опорные площадки под сторожевые конструкции.
      block(TILE_TYPES.ROCK, [
        [5,8],[6,8],[5,9],
        [33,8],[32,8],[33,9],
        [5,31],[5,30],[6,31],
        [33,31],[32,31],[33,30],
        [16,8],[16,9],[22,8],[22,9],
        [23,15],[24,15],[24,16],[25,16]
      ]);

      // v7.71: interior/building collision is now handled by precise static
      // collider boxes, not by filling whole tiles. This allows real doors and
      // readable interiors without letting the player walk through walls.

      const clearPoints = [loc.spawn, loc.entryFromWasteland, loc.trader, loc.storage, loc.exit];
      clearPoints.forEach(p => {
        if (!p) return;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = p.tx + dx, z = p.tz + dz;
            if (inBounds(x, z)) map[z][x] = TILE_TYPES.PATH;
          }
        }
      });
    } else {
      const markPath = (cx, cz, rx = 1, rz = rx) => {
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
          for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            if (!inBounds(x, z)) continue;
            const nx = (x - cx) / Math.max(0.1, rx);
            const nz = (z - cz) / Math.max(0.1, rz);
            if (nx * nx + nz * nz <= 1.05) map[z][x] = TILE_TYPES.PATH;
          }
        }
      };
      const markLine = (x1, z1, x2, z2, radius = 1) => {
        const steps = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1)) * 2 + 1;
        for (let i = 0; i <= steps; i++) {
          const t = i / Math.max(1, steps);
          markPath(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, radius, radius * 0.72);
        }
      };
      const block = (type, cells) => cells.forEach(([x, z]) => { if (inBounds(x, z)) map[z][x] = type; });
      const addResource = (tx, tz, type) => {
        if (!inBounds(tx, tz)) return;
        map[tz][tx] = type === 'oil' || type === 'water'
          ? TILE_TYPES.OIL
          : type === 'wood'
            ? TILE_TYPES.WOOD
            : TILE_TYPES.ORE;
        resourceNodes.push({ id: `res_${tx}_${tz}_${type}`, tx, tz, type, hp: 3, maxHp: 3, mesh: null });
      };

      const worldSiteInstance = loc.worldSiteInstance === true || loc.runtimeMode === 'worldSiteInstance';
      const proceduralArchetype = String(loc.templateLocationId || loc.id || '');
      if (worldSiteInstance) {
        const bounds = locationPlayableBounds(loc);
        const profile = loc.worldSiteProfile && typeof loc.worldSiteProfile === 'object' ? loc.worldSiteProfile : {};
        const layout = Math.max(0, Math.floor(Number(profile.layoutVariant ?? loc.localLayoutVariant ?? 0)));
        const content = Math.max(0, Math.floor(Number(profile.contentVariant ?? loc.localContentVariant ?? 0)));
        const left = bounds.minX + 2;
        const right = bounds.maxX - 2;
        const top = bounds.minZ + 2;
        const bottom = bounds.maxZ - 2;
        markPath(midX, midZ, 3.2 + (layout % 3), 2.6 + ((layout + 1) % 3));
        if (layout % 4 === 0) {
          markLine(left, midZ - 2, right, midZ + 2, 0.9);
          markLine(midX - 3, top, midX + 3, bottom, 0.75);
        } else if (layout % 4 === 1) {
          markLine(left, top + 2, right, bottom - 2, 1.0);
          markLine(left, bottom - 3, midX + 4, midZ, 0.7);
        } else if (layout % 4 === 2) {
          markLine(left, midZ + 3, midX, midZ, 1.1);
          markLine(midX, midZ, right, top + 3, 0.8);
          markLine(midX, midZ, right - 3, bottom, 0.65);
        } else {
          markLine(midX - 4, top, midX + 4, bottom, 0.95);
          markLine(left, midZ, right, midZ - 3, 0.75);
        }

        const obstacleTarget = 9 + content + Math.round(Number(profile.danger || 0) * 2);
        let placedObstacles = 0;
        for (let attempt = 0; attempt < obstacleTarget * 12 && placedObstacles < obstacleTarget; attempt += 1) {
          const tx = Math.floor(left + rand() * Math.max(1, right - left + 1));
          const tz = Math.floor(top + rand() * Math.max(1, bottom - top + 1));
          if (!inBounds(tx, tz) || map[tz][tx] === TILE_TYPES.PATH || Math.hypot(tx - midX, tz - midZ) < 4.5) continue;
          const roll = rand();
          const type = proceduralArchetype === 'randomAshGrove'
            ? (roll < 0.62 ? TILE_TYPES.TREE : roll < 0.82 ? TILE_TYPES.ROCK : TILE_TYPES.RUIN)
            : proceduralArchetype === 'randomDryBasin'
              ? (roll < 0.68 ? TILE_TYPES.ROCK : roll < 0.91 ? TILE_TYPES.RUIN : TILE_TYPES.TREE)
              : (roll < 0.58 ? TILE_TYPES.RUIN : roll < 0.86 ? TILE_TYPES.ROCK : TILE_TYPES.TREE);
          map[tz][tx] = type;
          placedObstacles += 1;
        }

        const resourceTarget = Math.max(2, Math.min(8, 2 + Math.round(Number(profile.resourceRichness || 0) / 24) + (content % 3)));
        let placedResources = 0;
        for (let attempt = 0; attempt < resourceTarget * 16 && placedResources < resourceTarget; attempt += 1) {
          const tx = Math.floor(left + rand() * Math.max(1, right - left + 1));
          const tz = Math.floor(top + rand() * Math.max(1, bottom - top + 1));
          if (!inBounds(tx, tz) || ![TILE_TYPES.GRASS, TILE_TYPES.DARK].includes(map[tz][tx]) || Math.hypot(tx - midX, tz - midZ) < 5) continue;
          const type = proceduralArchetype === 'randomAshGrove' ? (rand() < 0.82 ? 'wood' : 'ore')
            : proceduralArchetype === 'randomDryBasin' ? (rand() < 0.82 ? 'ore' : 'wood')
              : (rand() < 0.5 ? 'ore' : 'wood');
          addResource(tx, tz, type);
          placedResources += 1;
        }
      } else {
        markPath(midX, midZ, 4.2, 3.4);
        markLine(midX, 3, midX, MAP_H - 4, 1.15);
        markLine(3, midZ, MAP_W - 4, midZ, 1.15);
      }

      if (worldSiteInstance) {
        // The unique instance layout above replaces the cloned template layout.
      } else if (loc.id === 'scrapTown') {
        markLine(19, 25, 16, 19, 1.6);
        markLine(19, 25, 28, 13, 1.0);
        block(TILE_TYPES.RUIN, [[7,10],[8,10],[8,11],[29,10],[30,10],[30,11],[7,27],[8,28],[28,28],[29,28],[31,18],[31,19]]);
        block(TILE_TYPES.ROCK, [[12,13],[25,14],[11,25],[26,24]]);
        [[9,14,'ore'],[29,16,'ore'],[26,29,'ore'],[12,28,'wood'],[31,22,'wood']].forEach(([x, z, type]) => addResource(x, z, type));
      } else if (loc.id === 'relayStation') {
        markLine(19, 25, 22, 18, 1.5);
        markLine(11, 14, 30, 25, 0.85);
        block(TILE_TYPES.RUIN, [[9,12],[10,12],[28,11],[29,11],[7,28],[31,27]]);
        block(TILE_TYPES.ROCK, [[12,10],[30,18],[9,24],[26,30]]);
        [[8,16,'ore'],[29,25,'ore'],[12,29,'wood'],[32,14,'wood']].forEach(([x, z, type]) => addResource(x, z, type));
      } else if (loc.id === 'randomAshGrove') {
        markLine(6, 19, 32, 19, 1.0);
        markLine(19, 6, 19, 32, 1.0);
        block(TILE_TYPES.TREE, [[6,8],[9,9],[31,9],[32,28],[7,30],[28,30],[5,23],[33,17]]);
        block(TILE_TYPES.ROCK, [[12,14],[28,16],[15,29]]);
        [[10,26,'wood'],[13,11,'wood'],[24,25,'wood'],[30,12,'wood'],[8,18,'wood'],[21,30,'wood'],[27,20,'ore']].forEach(([x, z, type]) => addResource(x, z, type));
      } else if (loc.id === 'randomDryBasin') {
        markPath(midX, midZ, 7.2, 5.8);
        markLine(8, 30, 30, 9, 0.85);
        block(TILE_TYPES.ROCK, [[8,11],[29,12],[7,25],[31,27],[13,31]]);
        block(TILE_TYPES.RUIN, [[19,10],[26,18]]);
        [[11,16,'ore'],[28,22,'ore'],[21,30,'ore'],[14,27,'wood'],[26,13,'wood']].forEach(([x, z, type]) => addResource(x, z, type));
      } else if (loc.id === 'randomRuinedRoad') {
        for (let i = 3; i < MAP_W - 3; i++) {
          const roadZ = Math.round(8 + i * 0.58 + Math.sin(i * 0.45) * 1.4);
          markPath(i, roadZ, 1.05, 0.85);
        }
        block(TILE_TYPES.RUIN, [[6,16],[7,16],[10,22],[29,15],[31,16],[27,25]]);
        block(TILE_TYPES.ROCK, [[13,13],[22,27],[33,21]]);
        [[9,25,'wood'],[24,12,'ore'],[31,28,'wood'],[15,29,'ore']].forEach(([x, z, type]) => addResource(x, z, type));
      } else if (loc.id === 'wasteland') {
        markLine(19, 32, 19, 8, 1.2);
        markLine(9, 26, 30, 12, 0.85);
        block(TILE_TYPES.TREE, [[6,8],[12,27],[26,8],[33,20],[8,29],[31,12]]);
        block(TILE_TYPES.ROCK, [[9,14],[29,23],[15,31],[24,14]]);
        block(TILE_TYPES.RUIN, [[7,22],[28,12],[30,29]]);
        [[10,10,'wood'],[13,27,'wood'],[25,25,'wood'],[31,18,'wood'],[6,31,'wood'],[27,12,'ore'],[14,24,'ore'],[22,30,'ore'],[17,11,'ore']].forEach(([x, z, type]) => addResource(x, z, type));
      } else {
        block(TILE_TYPES.RUIN, [[8,9],[28,11],[13,27],[29,28]]);
        block(TILE_TYPES.ROCK, [[10,24],[30,18]]);
        [[11,15,'wood'],[27,23,'ore'],[15,29,'wood'],[29,9,'ore']].forEach(([x, z, type]) => addResource(x, z, type));
      }

      const entries = [loc.spawn, loc.entryFromSettlement, loc.entryFromWorld, loc.trader, loc.storage, loc.exit];
      entries.forEach(p => {
        if (!p) return;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const x = p.tx + dx, z = p.tz + dz;
            if (inBounds(x, z)) map[z][x] = TILE_TYPES.PATH;
          }
        }
        for (let i = resourceNodes.length - 1; i >= 0; i--) {
          const r = resourceNodes[i];
          if (Math.abs(r.tx - p.tx) <= 2 && Math.abs(r.tz - p.tz) <= 2) resourceNodes.splice(i, 1);
        }
      });
    }
    applyWorldExitEdges();

    locationStates[loc.id] = locationStates[loc.id] || {};
    locationStates[loc.id].environmentVersion = WORLD_ENVIRONMENT_VERSION;
    locationStates[loc.id].map = map.map(row => row.slice());
    locationStates[loc.id].resources = resourceNodes.map(r => ({ id: ensureResourceId(r), tx: r.tx, tz: r.tz, type: r.type, hp: r.hp, maxHp: r.maxHp }));
    if (!Array.isArray(locationStates[loc.id].enemies)) locationStates[loc.id].enemies = null;
  }

  function graphicsDetailLevel() {
    const preset = graphicsSettings || GRAPHICS_PRESETS.medium;
    let value = Number(preset.terrainDetails ?? 0.45);
    if (IS_MOBILE_DEVICE) value *= 0.58;
    return Math.max(0, Math.min(1, value));
  }

  function graphicsDecalDensity() {
    const preset = graphicsSettings || GRAPHICS_PRESETS.medium;
    let value = Number(preset.decalDensity ?? 0.34);
    if (IS_MOBILE_DEVICE) value *= 0.52;
    return Math.max(0, Math.min(1, value));
  }

  function registerFloorDetail(object, tx, tz) {
    if (!object) return object;
    object.userData.kind = object.userData.kind || 'floor-detail';
    worldGroup.add(object);
    staticCullObjects.push({ object, tx, tz, kind: 'floor-detail' });
    return object;
  }

  function createGroundDecal(tx, tz, pos, material, size = 1.1, rot = 0, y = 0.006) {
    const decal = new THREE.Mesh(detailPlaneGeom, material);
    decal.rotation.x = -Math.PI / 2;
    decal.rotation.z = rot;
    decal.position.set(pos.x + (hash01(tx, tz, 71) - 0.5) * 0.42, y, pos.z + (hash01(tx, tz, 73) - 0.5) * 0.42);
    decal.scale.set(size, size, 1);
    decal.renderOrder = 0;
    return registerFloorDetail(decal, tx, tz);
  }

  function createTerrainPatch(tx, tz, pos, material, scaleX = TILE, scaleZ = TILE, rot = 0, y = 0.003, jitter = 0.18) {
    const patch = new THREE.Mesh(detailPlaneGeom, material);
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = rot;
    patch.position.set(pos.x + (hash01(tx, tz, 371) - 0.5) * jitter, y, pos.z + (hash01(tx, tz, 373) - 0.5) * jitter);
    patch.scale.set(scaleX, scaleZ, 1);
    patch.renderOrder = 0;
    return registerFloorDetail(patch, tx, tz);
  }

  function createPebbleCluster(tx, tz, pos, amount = 3) {
    const group = new THREE.Group();
    group.position.set(pos.x, 0.02, pos.z);
    for (let i = 0; i < amount; i++) {
      const pebble = new THREE.Mesh(pebbleGeom, hash01(tx, tz, 100 + i) > 0.45 ? mats.rock : mats.rockLight);
      pebble.position.set((hash01(tx, tz, 111 + i) - 0.5) * 1.12, 0.045, (hash01(tx, tz, 121 + i) - 0.5) * 1.12);
      const s = 0.72 + hash01(tx, tz, 131 + i) * 1.35;
      pebble.scale.set(s * 1.2, s * 0.7, s);
      pebble.rotation.set(hash01(tx, tz, 141 + i) * Math.PI, hash01(tx, tz, 151 + i) * Math.PI, hash01(tx, tz, 161 + i) * Math.PI);
      pebble.castShadow = true;
      pebble.receiveShadow = true;
      group.add(pebble);
    }
    return registerFloorDetail(group, tx, tz);
  }

  function createDryGrassTuft(tx, tz, pos) {
    const group = new THREE.Group();
    group.position.set(pos.x + (hash01(tx, tz, 181) - 0.5) * 0.68, 0, pos.z + (hash01(tx, tz, 191) - 0.5) * 0.68);
    const blades = 3 + Math.floor(hash01(tx, tz, 193) * 4);
    for (let i = 0; i < blades; i++) {
      const blade = new THREE.Mesh(grassBladeGeom, hash01(tx, tz, 199 + i) > 0.5 ? mats.dryGrass : mats.scrub);
      blade.position.y = 0.19 + hash01(tx, tz, 201 + i) * 0.08;
      blade.rotation.set((hash01(tx, tz, 211 + i) - 0.5) * 0.42, hash01(tx, tz, 221 + i) * Math.PI * 2, (hash01(tx, tz, 231 + i) - 0.5) * 0.42);
      blade.scale.set(0.85 + hash01(tx, tz, 241 + i) * 0.7, 0.65 + hash01(tx, tz, 251 + i) * 0.8, 0.85);
      blade.castShadow = true;
      group.add(blade);
    }
    return registerFloorDetail(group, tx, tz);
  }

  function createBoneOrScrap(tx, tz, pos) {
    const group = new THREE.Group();
    group.position.set(pos.x + (hash01(tx, tz, 261) - 0.5) * 0.6, 0.065, pos.z + (hash01(tx, tz, 271) - 0.5) * 0.6);
    group.rotation.y = hash01(tx, tz, 281) * Math.PI * 2;
    if (hash01(tx, tz, 283) > 0.52) {
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.62, 7), mats.bone);
      bone.rotation.z = Math.PI / 2;
      bone.castShadow = true;
      group.add(bone);
      const knobA = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), mats.bone);
      const knobB = knobA.clone();
      knobA.position.x = -0.31; knobB.position.x = 0.31;
      knobA.scale.set(1, 0.7, 0.8); knobB.scale.set(1, 0.7, 0.8);
      group.add(knobA, knobB);
    } else {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.035, 0.32), mats.rust);
      plate.rotation.set(0.12, 0, 0.08);
      plate.castShadow = true;
      group.add(plate);
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.045, 8), mats.darkMetal);
      bolt.position.set(0.18, 0.035, -0.07);
      bolt.castShadow = true;
      group.add(bolt);
    }
    return registerFloorDetail(group, tx, tz);
  }

  function createTerrainTileDetail(tx, tz, type, pos) {
    if (type === TILE_TYPES.WATER) return;
    const detail = graphicsDetailLevel();
    const decal = graphicsDecalDensity();
    if (detail <= 0.02 && decal <= 0.02) return;
    const h = hash01(tx, tz, currentLocation?.seed || 1);
    const h2 = hash01(tx, tz, 777);
    const h3 = hash01(tx, tz, 991);

    if (type === TILE_TYPES.PATH) {
      if (h < decal * 0.55) createGroundDecal(tx, tz, pos, mats.groundCrack, 0.85 + h2 * 0.65, h3 * Math.PI * 2, 0.004);
      else if (h < decal * 0.86) createGroundDecal(tx, tz, pos, mats.groundDust, 1.05 + h2 * 0.8, h3 * Math.PI * 2, 0.004);
      if (h2 < decal * 0.22) createGroundDecal(tx, tz, pos, mats.tireTrack, 1.15, h3 * Math.PI, 0.005);
      if (h3 < decal * 0.16) createGroundDecal(tx, tz, pos, mats.scrapScatter, 1.05 + h * 0.35, h2 * Math.PI * 2, 0.007);
      if (h3 < detail * 0.18) createPebbleCluster(tx, tz, pos, 2 + Math.floor(h * 3));
      if (h2 > 1 - detail * 0.16) createBoneOrScrap(tx, tz, pos);
      return;
    }

    if (type === TILE_TYPES.GRASS || type === TILE_TYPES.DARK) {
      if (h < detail * 0.32) createDryGrassTuft(tx, tz, pos);
      if (h2 < detail * 0.18) createPebbleCluster(tx, tz, pos, 2 + Math.floor(h3 * 3));
      if (h3 < decal * 0.18) createGroundDecal(tx, tz, pos, mats.groundDust, 0.95 + h * 0.55, h2 * Math.PI * 2, 0.004);
      if (h > 1 - detail * 0.10) createBoneOrScrap(tx, tz, pos);
      return;
    }

    if ([TILE_TYPES.ROCK, TILE_TYPES.ORE, TILE_TYPES.WOOD, TILE_TYPES.RUIN, TILE_TYPES.OIL].includes(type)) {
      if (h < detail * 0.42) createPebbleCluster(tx, tz, pos, 2 + Math.floor(h2 * 3));
      if (h2 < detail * 0.26) createDryGrassTuft(tx, tz, pos);
      if (h3 < decal * 0.22) createGroundDecal(tx, tz, pos, mats.groundDust, 1.05, h * Math.PI * 2, 0.004);
      if (h2 < decal * 0.14) createGroundDecal(tx, tz, pos, mats.scrapScatter, 0.95, h3 * Math.PI * 2, 0.007);
      if (h > 1 - detail * 0.18) createBoneOrScrap(tx, tz, pos);
    }
  }

  function createWastelandBackplate() {
    // v7.75.48 stage 1 world-edge cleanup:
    // the backplate must extend well beyond the playable grid so the camera
    // never sees plain scene background in map corners. Keep this layer cheap
    // and purely decorative; later stages can add edge dressing on top.
    const edgeBorder = currentLocation && currentLocation.id === 'settlement' ? 40 : 32;
    const sizeX = MAP_W * TILE + edgeBorder * 2;
    const sizeZ = MAP_H * TILE + edgeBorder * 2;
    const isSettlement = currentLocation && currentLocation.id === 'settlement';
    const backMat = isSettlement ? (mats.settlementBack || mats.wastelandBack || mats.grassA) : (mats.wastelandBack || mats.grassA);
    const segments = isSettlement ? reliefGroundSegments : 1;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ, segments, segments), backMat);
    prepareGroundUv2(back);
    back.rotation.x = -Math.PI / 2;
    // v7.60: relief-terrain sits чуть ниже игровых объектов. Displacement поднимает
    // микрорельеф, но не мешает коллизиям и не ломает старую техническую сетку.
    back.position.set(0, isSettlement ? -0.086 : -0.052, 0);
    back.receiveShadow = true;
    back.userData.kind = isSettlement ? 'relief-wasteland-backplate' : 'seamless-wasteland-backplate';
    if (isSettlement) markNoRuntimeCull(back, 'trader-yard-backplate');
    worldGroup.add(back);
    staticCullObjects.push({ object: back, tx: Math.floor(MAP_W / 2), tz: Math.floor(MAP_H / 2), kind: 'floor' });
  }

  function getVisualGroundMaterial(tx, tz, type) {
    // Клетки остаются технической основой, но визуально не должны читаться как квадраты.
    // Поэтому почти вся суша использует единую пыльную гамму; отличия создаются
    // декалями и объектами, а не шахматным чередованием материалов.
    if (type === TILE_TYPES.WATER) return mats.water;
    if (type === TILE_TYPES.PATH) return mats.path;
    if (type === TILE_TYPES.DARK) return mats.darkGrass;
    return hash01(tx, tz, 4401) > 0.82 ? mats.grassB : mats.grassA;
  }

  function createTile(tx, tz, type) {
    const pos = tileToWorld(tx, tz);

    // v7.54 Terrain Rebuild: обычная суша больше не рисуется отдельными квадратами.
    // map[z][x] остаётся технической сеткой для логики, но визуал даёт единая
    // большая плоскость + мягкие органические пятна/декали.
    if (DEBUG_SHOW_TERRAIN_TILES || RENDER_LAND_TILE_PLANES) {
      const geom = new THREE.PlaneGeometry(TILE, TILE);
      const mat = getVisualGroundMaterial(tx, tz, type);
      const tile = new THREE.Mesh(geom, mat);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(pos.x, -0.020, pos.z);
      tile.receiveShadow = true;
      tile.userData.tile = { tx, tz, type, debugOnly: !RENDER_LAND_TILE_PLANES };
      tile.visible = DEBUG_SHOW_TERRAIN_TILES || type === TILE_TYPES.WATER;
      worldGroup.add(tile);
      floorMeshes.push(tile);
      staticCullObjects.push({ object: tile, tx, tz, kind: 'floor' });
    }

    if (currentLocation && currentLocation.id === 'settlement') {
      // v7.58: для первой локации запрещены тайловые визуальные слои.
      // Квадратная сетка остаётся только технической; вся земля собирается
      // вручную крупными органическими слоями в createTraderYardTerrainLayers().
      return;
    }

    const rot = hash01(tx, tz, 381) * Math.PI * 2;
    if (type === TILE_TYPES.WATER) {
      createTerrainPatch(tx, tz, pos, mats.waterEdgePatch, TILE * 1.18, TILE * 0.92, rot + 0.34, -0.010, 0.45);
      createTerrainPatch(tx, tz, pos, mats.waterPatch, TILE * 0.94, TILE * 0.74, rot, -0.006, 0.36);
      if (hash01(tx, tz, 383) > 0.54) {
        const ripple = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.37, 28), new THREE.MeshBasicMaterial({ color: 0x9ec8ca, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }));
        ripple.rotation.x = -Math.PI / 2;
        ripple.position.set(pos.x + (hash01(tx, tz, 387) - 0.5) * 0.55, 0.009, pos.z + (hash01(tx, tz, 389) - 0.5) * 0.55);
        ripple.scale.set(1.3 + hash01(tx, tz, 391) * 0.7, 0.75 + hash01(tx, tz, 393) * 0.35, 1);
        worldGroup.add(ripple);
        staticCullObjects.push({ object: ripple, tx, tz, kind: 'floor-detail' });
      }
    } else if (type === TILE_TYPES.PATH) {
      createTerrainPatch(tx, tz, pos, mats.pathDust, TILE * 1.16, TILE * 0.78, rot, 0.002, 0.42);
      if (hash01(tx, tz, 397) > 0.34) createGroundDecal(tx, tz, pos, mats.tireTrack, 1.12 + hash01(tx, tz, 399) * 0.42, rot, 0.006);
    } else if (type === TILE_TYPES.DARK) {
      createTerrainPatch(tx, tz, pos, mats.scorchedPatch, TILE * 1.06, TILE * 0.86, rot, 0.001, 0.46);
    }

    createTerrainTileDetail(tx, tz, type, pos);
  }

  function createTree(x, z) {
    const tt = worldToTile(x, z);
    const variants = ['deadTreeA', 'deadTreeB', 'deadTreeC'];
    const key = variants[Math.floor(hash01(tt.tx, tt.tz, 77603) * variants.length) % variants.length];
    const angle = hash01(tt.tx, tt.tz, 77601) * Math.PI * 2;
    return createStaticObstacleModel(key, x, z, angle, 'wasteland-dead-tree', 'static-obstacle');
  }

  function createRock(x, z, ore = false) {
    const tt = worldToTile(x, z);
    const key = ore ? 'oreOutcrop' : 'rubbleRock';
    const angle = hash01(tt.tx, tt.tz, 77720) * Math.PI * 2;
    return createStaticObstacleModel(key, x, z, angle, ore ? 'resource-ore-outcrop' : 'wasteland-rubble-rock', ore ? 'static-resource' : 'static-obstacle');
  }

  function createWoodNode(x, z) {
    const tt = worldToTile(x, z);
    const angle = hash01(tt.tx, tt.tz, 77780) * Math.PI * 2;
    return createStaticObstacleModel('deadwood', x, z, angle, 'resource-deadwood', 'static-resource');
  }

  function createRuin(x, z) {
    const tt = worldToTile(x, z);
    const variants = ['carWreck', 'concreteWall', 'barrelCluster', 'tireStack', 'scrapHeap', 'lowRuinedWall', 'roadblockBarricade'];
    const key = variants[Math.floor(hash01(tt.tx, tt.tz, 77802) * variants.length) % variants.length];
    const angle = hash01(tt.tx, tt.tz, 77800) * Math.PI * 2;
    return createStaticObstacleModel(key, x, z, angle, 'wasteland-ruin-prop', 'static-obstacle');
  }


  function makeLabelSprite(text, color = '#f0d28a') {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 34px Segoe UI, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.88)';
    ctx.strokeText(text, 256, 48);
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 48);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(4.5, 0.85, 1);
    return sprite;
  }

  function makeInjuryIconSprite(text, color = '#ffbf69') {
    const c = document.createElement('canvas');
    c.width = 192;
    c.height = 192;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 192, 192);

    // Без фоновой плашки: оставляем только саму иконку состояния.
    ctx.font = 'bold 112px Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, Segoe UI, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.82)';
    ctx.strokeText(text, 96, 101);
    ctx.fillStyle = color;
    ctx.fillText(text, 96, 101);

    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 50;
    // v7.43.7: текущий большой размер 1.18 уменьшен примерно в 3 раза.
    sprite.scale.set(0.39, 0.39, 1);
    return sprite;
  }

  function createCrate(x, z, sx = 0.85, sz = 0.85) {
    const angle = hash01(Math.round(x * 10), Math.round(z * 10), 755) * 0.22 - 0.11;
    const opts = {
      scaleX: Math.max(0.35, sx / 0.85),
      scaleZ: Math.max(0.35, sz / 0.85)
    };
    const group = createStaticSetDressing('crate', x, z, angle, 'crate', {
      ...opts
    });
    group.userData.allowsPlayerOverlap = true;
    return group;
  }
