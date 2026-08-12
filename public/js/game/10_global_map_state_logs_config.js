  // ===== UI / LOG / MINIMAP =====
  const logNodes = [];
  const systemLogNodes = [];
  const globalMapSystemLogNodes = [];

  function appendSystemLogLine(list, nodeStore, msg, type = '', limit = 5) {
    if (!list) return;
    const empty = list.querySelector('.global-map-system-log-empty');
    if (empty && empty.parentNode) empty.parentNode.removeChild(empty);
    const line = document.createElement('div');
    line.className = 'system-log-line' + (type ? ' ' + type : '');
    line.textContent = String(msg || '');
    list.insertBefore(line, list.firstChild);
    nodeStore.unshift(line);
    while (nodeStore.length > limit) {
      const oldLine = nodeStore.pop();
      if (oldLine && oldLine.parentNode) oldLine.parentNode.removeChild(oldLine);
    }
  }

  function addLog(msg, _, type = '') {
    const el = document.getElementById('log');
    if (el) {
      const d = document.createElement('div');
      d.className = 'log-msg' + (type ? ' ' + type : '');
      d.textContent = msg;
      el.insertBefore(d, el.firstChild);
      logNodes.unshift(d);
      if (logNodes.length > 80) {
        const old = logNodes.pop();
        if (old && old.parentNode) old.parentNode.removeChild(old);
      }
    }
    const list = document.getElementById('system-log-list');
    if (list) {
      appendSystemLogLine(list, systemLogNodes, msg, type, 80);
    }
    const globalMapList = document.getElementById('global-map-system-log');
    if (globalMapList) {
      appendSystemLogLine(globalMapList, globalMapSystemLogNodes, msg, type, 120);
    }
  }

  function bindSystemLogWheelIsolation() {
    ['log', 'system-log-list', 'global-map-system-log'].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.scrollWheelBound === '1') return;
      el.dataset.scrollWheelBound = '1';
      el.addEventListener('wheel', event => {
        const canScroll = el.scrollHeight > el.clientHeight + 1;
        if (!canScroll) return;
        const unit = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? el.clientHeight : 1);
        el.scrollTop += Number(event.deltaY || 0) * unit;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      }, { passive: false });
    });
  }

  bindSystemLogWheelIsolation();

  const miniCanvas = document.getElementById('minimap');
  const miniCtx = miniCanvas.getContext('2d');
  const globalMapCanvas = document.getElementById('global-map-canvas');
  const globalMap3dCanvas = document.getElementById('global-map-3d-canvas');
  const globalMapSurface = globalMap3dCanvas || globalMapCanvas;
  const globalMapCtx = globalMapCanvas ? globalMapCanvas.getContext('2d') : null;
  const globalMapCursor = document.getElementById('global-map-cursor');
  const GLOBAL_MAP_GRID = { cols: 30, rows: 30, cellPoints: 30 };
  const GLOBAL_MAP_SIZE = {
    width: GLOBAL_MAP_GRID.cols * GLOBAL_MAP_GRID.cellPoints,
    height: GLOBAL_MAP_GRID.rows * GLOBAL_MAP_GRID.cellPoints
  };
  const GLOBAL_MAP_CELL_KM = 10;
  const GLOBAL_MAP_POINT_KM = GLOBAL_MAP_CELL_KM / GLOBAL_MAP_GRID.cellPoints;
  const GLOBAL_MAP_TIME_COMPRESSION = 900;
  const GLOBAL_MAP_WORLD_DAY_REAL_MS = 60 * 60 * 1000;
  const WASTELAND_SIM_ACTIVE_FETCH_MS = 5000;
  const WASTELAND_SIM_IDLE_FETCH_MS = 15000;
  const WASTELAND_SIM_MAX_EXTRAPOLATION_MS = 7500;
  const GLOBAL_MAP_MIN_SPEED_KMH = 16;
  const GLOBAL_MAP_MAX_SPEED_KMH = 24;
  const GLOBAL_MAP_COASTLINE = [
    { x: 0.105, y: 0.00 }, { x: 0.070, y: 0.08 }, { x: 0.082, y: 0.16 }, { x: 0.055, y: 0.25 },
    { x: 0.106, y: 0.36 }, { x: 0.090, y: 0.48 }, { x: 0.142, y: 0.62 }, { x: 0.126, y: 0.73 },
    { x: 0.184, y: 0.86 }, { x: 0.154, y: 1.00 }
  ];
  const GLOBAL_MAP_WATER_TEXTURES = new Set(['water', 'ocean', 'sea', 'lake']);
  const GLOBAL_MAP_TEXTURES = {
    wasteland_dust: { base: '#7a5b32', accent: '#b69155', fill: 'rgba(126,94,50,0.22)' },
    old_road: { base: '#675a3d', accent: '#29241e', fill: 'rgba(112,98,62,0.34)' },
    salt_flat: { base: '#a89e70', accent: '#d5cfa0', fill: 'rgba(167,160,115,0.34)' },
    dry_lake: { base: '#b39a60', accent: '#6e5532', fill: 'rgba(174,151,91,0.34)' },
    rocky_hills: { base: '#6a6250', accent: '#39352d', fill: 'rgba(111,101,78,0.36)' },
    scrap_field: { base: '#5c5142', accent: '#9b6f37', fill: 'rgba(96,82,64,0.36)' },
    green_lowland: { base: '#405b32', accent: '#7aa15c', fill: 'rgba(54,91,47,0.34)' },
    water: { base: '#254a52', accent: '#7fb3a5', fill: 'rgba(42,90,96,0.56)' }
  };
  let GLOBAL_MAP_NODES = [
    { id: 'settlement', x: 195, y: 690, kind: 'settlement', danger: 0, locationCount: 1, model: 'oldKlimYard', modelScale: 1, rotationY: 0, note: 'Караванный двор, торговец, хранилище.' },
    { id: 'scrapTown', x: 735, y: 690, kind: 'settlement', danger: 1, locationCount: 1, model: 'scrapTown', modelScale: 1, rotationY: 0, note: 'Мастерские, запчасти, безопасная стоянка.' },
    { id: 'relayStation', x: 705, y: 195, kind: 'settlement', danger: 2, locationCount: 1, model: 'relayStation', modelScale: 1, rotationY: 0, note: 'Техническая станция с защищённым тайником.' },
    { id: 'caravanCamp', x: 495, y: 495, kind: 'settlement', danger: 1, locationCount: 1, model: 'wastelandShack', modelScale: 1, rotationY: 0, note: 'Караван-сарай «Перекрёсток»: столица вольных караванов.' }
  ];
  let GLOBAL_MAP_INFRASTRUCTURE = [
    { id: 'southern_caravan_road', name: 'Южная караванная трасса', type: 'road', model: 'broken_asphalt', walkable: true, travelFactor: 0.58, width: 8, points: [{ x: 195, y: 690 }, { x: 405, y: 615 }, { x: 525, y: 705 }, { x: 735, y: 690 }] },
    { id: 'relay_trade_road', name: 'Торговый путь Ретранслятора', type: 'road', model: 'broken_asphalt', walkable: true, travelFactor: 0.62, width: 7.5, points: [{ x: 405, y: 615 }, { x: 585, y: 555 }, { x: 705, y: 405 }, { x: 705, y: 195 }] },
    { id: 'old_northern_road', name: 'Старая северная дорога', type: 'road', model: 'concrete_slabs', walkable: true, travelFactor: 0.66, width: 7, points: [{ x: 195, y: 690 }, { x: 345, y: 555 }, { x: 450, y: 420 }, { x: 615, y: 285 }, { x: 705, y: 195 }] },
    { id: 'klim_water_pipeline', name: 'Водопровод Старого Клима', type: 'pipeline', model: 'service_pipeline', walkable: true, travelFactor: 0.76, width: 4.2, points: [{ x: 210, y: 680 }, { x: 255, y: 645 }, { x: 300, y: 600 }, { x: 355, y: 550 }] },
    { id: 'relay_oil_pipeline', name: 'Нефтепровод Ретранслятора', type: 'pipeline', model: 'service_pipeline', walkable: true, travelFactor: 0.74, width: 4.2, points: [{ x: 595, y: 565 }, { x: 645, y: 520 }, { x: 685, y: 465 }, { x: 720, y: 405 }, { x: 720, y: 210 }] }
  ];
  let GLOBAL_MAP_OBJECTS = [];
  let GLOBAL_ENCOUNTERS = [
    { id: 'ghoul_pack', title: 'Стая гулей', text: 'Из низины тянет гнилью. Впереди движение между камнями.', kind: 'hostile' },
    { id: 'radscorpion_nest', title: 'Гнездо радскорпионов', text: 'Песок шевелится у старых костей. Радскорпионы перекрыли проход.', kind: 'hostile' },
    { id: 'mutant_ant_swarm', title: 'Рой мутировавших муравьёв', text: 'Из трещин в земле вылезает крупный муравьиный рой.', kind: 'hostile' },
    { id: 'super_mutant_lair', title: 'Логово супермутантов', text: 'В руинах слышны тяжелые шаги. Супермутанты заняли точку и тащат туда добычу.', kind: 'hostile' },
    { id: 'gecko_pack', title: 'Гекконы пустоши', text: 'На горячих камнях мелькают большие мутировавшие ящерицы.', kind: 'hostile' },
    { id: 'fire_gecko_ambush', title: 'Огненные гекконы', text: 'Воздух дрожит от жара. Впереди рыщут огненные гекконы.', kind: 'hostile' },
    { id: 'peaceful_caravan', title: 'Мирный караван', text: 'На старой трассе остановился торговец с охраной. Можно торговать, уйти или напасть.', kind: 'caravan' },
    { id: 'caravan_patrol_vs_ghouls', title: 'Патруль против гулей', text: 'Патруль Старого Клима отбивается от гулей. Можно уйти, помочь или добить всех.', kind: 'battle' },
    { id: 'ants_vs_geckos', title: 'Муравьи против гекконов', text: 'Две стаи мутантов сцепились у сухого русла. Можно пройти мимо или вмешаться.', kind: 'battle' },
    { id: 'radscorpions_vs_patrol', title: 'Патруль против радскорпионов', text: 'Охрана Старого Клима держит круговую оборону от радскорпионов.', kind: 'battle' }
    , { id: 'raider_ambush', title: 'Засада рейдеров', text: 'Свежие следы засады пересекают дорогу. Рейдеры ждут добычу.', kind: 'hostile' }
    , { id: 'raiders_vs_patrol', title: 'Рейдеры против патруля', text: 'Патруль Старого Клима перестреливается с бандой рейдеров.', kind: 'battle' }
  ];
  const GLOBAL_MAP_CHANCE = {
    none: 0,
    rare: 4,
    uncommon: 12,
    common: 22,
    frequent: 38
  };
  const GLOBAL_LOCATION_CELL_RADIUS = GLOBAL_MAP_GRID.cellPoints * 0.5;
  const GLOBAL_SETTLEMENT_RADIUS = GLOBAL_LOCATION_CELL_RADIUS;
  const GLOBAL_MULTI_SETTLEMENT_RADIUS = GLOBAL_LOCATION_CELL_RADIUS;
  const GLOBAL_CAPITAL_CLEAR_RADIUS = 100;
  let GLOBAL_RANDOM_LOCATIONS = [
    { id: 'randomAshGrove', weight: 4 },
    { id: 'randomDryBasin', weight: 3 },
    { id: 'randomRuinedRoad', weight: 3 }
  ];
  let GLOBAL_MAP_CELL_OVERRIDES = new Map();
  let globalMapConfigLoaded = false;
  let WASTELAND_SIM_STATE = { worldHour: 0, gameDayRealMs: GLOBAL_MAP_WORLD_DAY_REAL_MS, updatedAt: 0, sampledAt: 0, serverNow: 0, sampleAgeMs: 0, factions: {}, sites: [], parties: [], threatZones: [], territories: [], worldZones: [], worldContacts: [], events: [], worldTasks: [], stats: {} };
  let wastelandSimFetchPending = false;
  let wastelandSimLastFetchAt = 0;
  let wastelandSimLastAppliedAt = 0;
  const globalMapState = {
    fromLocationId: currentLocation?.id || 'settlement',
    playerX: 255,
    playerY: 615,
    selectedX: 255,
    selectedY: 615,
    onWorldMap: false,
    pendingEncounterId: '',
    pendingEncounterRoomId: '',
    pendingEncounterWorldZoneId: '',
    pendingEncounterWorldPartyId: '',
    pendingEncounterWorldPoint: null,
    pendingWorldDrop: null,
    currentWorldSiteId: '',
    attachedPartyId: '',
    attachedPartyTaskId: '',
    partyDetachPending: false,
    travelLeaderId: '',
    travelLeaderName: '',
    routeContactStops: {},
    lastEntryCircle: null,
    travel: null,
    encounter: null,
    party: []
  };
  const GLOBAL_MAP_3D = {
    failed: false,
    revision: 1,
    builtRevision: 0,
    renderer: null,
    scene: null,
    camera: null,
    sun: null,
    raycaster: null,
    terrain: null,
    staticGroup: null,
    nodeGroup: null,
    dynamicGroup: null,
    dynamicCache: null,
    texture: null,
    worldWidth: 92,
    worldDepth: 92,
    zoom: 108,
    minZoom: 30,
    maxZoom: 150,
    targetX: 0,
    targetZ: 0,
    userPanned: false,
    dragging: false,
    dragX: 0,
    dragY: 0,
    keyPan: {},
    pixelScale: 1.0,
    pixelTimer: 0,
    appliedPixelRatio: 0,
    renderQueued: false,
    dynamicHeavyNextAt: 0,
    dynamicHeavyReady: false
  };
  const GLOBAL_MAP_3D_TERRAIN_TEXTURE_SIZE = IS_MOBILE_DEVICE ? 1536 : 2048;
  const GLOBAL_MAP_3D_TERRAIN_SEGMENTS = IS_MOBILE_DEVICE ? 128 : 192;
  const GLOBAL_MAP_DEFAULT_NODES = GLOBAL_MAP_NODES.map(row => ({ ...row }));
  const GLOBAL_MAP_DEFAULT_INFRASTRUCTURE = GLOBAL_MAP_INFRASTRUCTURE.map(row => ({ ...row, points: row.points.map(point => ({ ...point })) }));
  const GLOBAL_MAP_DEFAULT_OBJECTS = GLOBAL_MAP_OBJECTS.map(row => ({ ...row }));
  const GLOBAL_MAP_DEFAULT_ENCOUNTERS = GLOBAL_ENCOUNTERS.map(row => ({ ...row }));
  const GLOBAL_MAP_DEFAULT_RANDOM_LOCATIONS = GLOBAL_RANDOM_LOCATIONS.map(row => ({ ...row }));

  function normalizeGlobalMapPvpMode(value = 'pvp') {
    const raw = String(value || 'pvp').trim();
    if (raw === 'peaceful' || raw === 'pvp' || raw === 'pvpFullDrop') return raw;
    const low = raw.toLowerCase();
    if (['peace', 'safe', 'safezone', 'мирная', 'мирный'].includes(low)) return 'peaceful';
    if (['fulldrop', 'full_drop', 'pvpfulldrop', 'pvp-full-drop', 'полный', 'фулдроп'].includes(low)) return 'pvpFullDrop';
    return 'pvp';
  }

  function globalMapPvpLabel(mode = 'pvp') {
    const value = normalizeGlobalMapPvpMode(mode);
    if (value === 'peaceful') return 'мирная зона';
    if (value === 'pvpFullDrop') return 'PvP: полный дроп';
    return 'PvP: падают расходники';
  }

  function normalizeGlobalMapWeightRows(rows = [], allowedIds = null) {
    const out = [];
    (Array.isArray(rows) ? rows : []).slice(0, 64).forEach(row => {
      const id = String(row?.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      if (!id || (allowedIds && !allowedIds.has(id))) return;
      const weight = Math.max(0, Math.min(999, Math.round(Number(row?.weight || 0))));
      if (weight <= 0) return;
      const existing = out.find(x => x.id === id);
      if (existing) existing.weight = Math.min(999, existing.weight + weight);
      else out.push({ id, weight });
    });
    return out;
  }

  function normalizeClientGlobalMapConfig(raw = {}) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const maxX = GLOBAL_MAP_SIZE.width;
    const maxY = GLOBAL_MAP_SIZE.height;
    const centerOnCell = (x, y) => {
      const px = Math.max(0, Math.min(Math.max(0, maxX - 0.001), Number(x || 0)));
      const py = Math.max(0, Math.min(Math.max(0, maxY - 0.001), Number(y || 0)));
      const cx = Math.max(0, Math.min(GLOBAL_MAP_GRID.cols - 1, Math.floor(px / GLOBAL_MAP_GRID.cellPoints)));
      const cy = Math.max(0, Math.min(GLOBAL_MAP_GRID.rows - 1, Math.floor(py / GLOBAL_MAP_GRID.cellPoints)));
      return {
        x: Math.round((cx + 0.5) * GLOBAL_MAP_GRID.cellPoints),
        y: Math.round((cy + 0.5) * GLOBAL_MAP_GRID.cellPoints)
      };
    };
    const nodesSource = Array.isArray(src.nodes) ? src.nodes : [];
    const nodes = nodesSource.slice(0, 80).map((node, index) => {
      const point = centerOnCell(node?.x, node?.y);
      const id = String(node?.id || `node_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      const capitalFaction = String(node?.capitalFaction || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      return {
        id,
        x: point.x,
        y: point.y,
        kind: String(node?.kind || 'settlement').slice(0, 32),
        capital: node?.capital === true || !!capitalFaction || ['settlement', 'scrapTown', 'relayStation', 'caravanCamp'].includes(id),
        capitalFaction,
        danger: Math.max(0, Math.min(5, Math.round(Number(node?.danger || 0)))),
        locationCount: 1,
        model: String(node?.model || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64),
        modelScale: Math.max(0.4, Math.min(4, Number(node?.modelScale || 1))),
        rotationY: Math.max(0, Math.min(360, Number(node?.rotationY || 0))),
        note: String(node?.note || '').slice(0, 240)
      };
    }).filter(node => node.id);
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const infrastructureSource = Array.isArray(src.infrastructure) && src.infrastructure.length
      ? src.infrastructure
      : GLOBAL_MAP_DEFAULT_INFRASTRUCTURE;
    const infrastructure = infrastructureSource.slice(0, 64).map((row, index) => {
      const type = String(row?.type || row?.kind || 'road').toLowerCase() === 'pipeline' ? 'pipeline' : 'road';
      const points = [];
      (Array.isArray(row?.points) ? row.points : []).slice(0, 96).forEach(rawPoint => {
        const nodeId = String(rawPoint?.nodeId || rawPoint?.node || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
        const sourcePoint = nodeId && nodeById.has(nodeId) ? nodeById.get(nodeId) : rawPoint;
        const point = clampGlobalMapPoint(sourcePoint?.x, sourcePoint?.y);
        const previous = points[points.length - 1];
        if (!previous || globalMapPointDistance(previous, point) > 0.01) points.push({ x: point.x, y: point.y });
      });
      return {
        id: String(row?.id || `infrastructure_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64),
        name: String(row?.name || row?.id || '').replace(/[<>]/g, '').trim().slice(0, 96),
        type,
        model: String(row?.model || (type === 'pipeline' ? 'service_pipeline' : 'broken_asphalt')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48),
        walkable: row?.walkable !== false,
        travelFactor: Math.max(0.35, Math.min(1.5, Number(row?.travelFactor ?? (type === 'pipeline' ? 0.78 : 0.62)))),
        width: Math.max(2, Math.min(18, Number(row?.width ?? (type === 'pipeline' ? 4.2 : 8)))),
        points
      };
    }).filter(row => row.id && row.points.length >= 2);
    const objectsSource = Array.isArray(src.objects) ? src.objects : [];
    const objects = objectsSource.slice(0, 300).map((object, index) => {
      const x = Math.max(0, Math.min(maxX, Math.round(Number(object?.x || 0))));
      const y = Math.max(0, Math.min(maxY, Math.round(Number(object?.y || 0))));
      return {
        id: String(object?.id || `object_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80),
        kind: String(object?.kind || 'landmark').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32),
        cx: Math.max(0, Math.min(GLOBAL_MAP_GRID.cols - 1, Math.floor(Number(object?.cx ?? Math.floor(x / GLOBAL_MAP_GRID.cellPoints))))),
        cy: Math.max(0, Math.min(GLOBAL_MAP_GRID.rows - 1, Math.floor(Number(object?.cy ?? Math.floor(y / GLOBAL_MAP_GRID.cellPoints))))),
        x,
        y,
        model: String(object?.model || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64),
        modelScale: Math.max(0.2, Math.min(5, Number(object?.modelScale || 1))),
        rotationY: Math.max(0, Math.min(360, Number(object?.rotationY || 0))),
        note: String(object?.note || '').slice(0, 160)
      };
    }).filter(object => object.id && object.model);
    const encountersSource = Array.isArray(src.encounters) ? src.encounters : [];
    const encounters = encountersSource.slice(0, 120).map(row => ({
      id: String(row?.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64),
      title: String(row?.title || row?.id || 'Событие мира').slice(0, 120),
      text: String(row?.text || '').slice(0, 600),
      kind: String(row?.kind || 'hostile').slice(0, 32),
      locationId: String(row?.locationId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    })).filter(row => row.id);
    const encounterIds = new Set(encounters.map(row => row.id));
    const randomRows = normalizeGlobalMapWeightRows(
      Array.isArray(src.randomLocations) ? src.randomLocations : []
    ).filter(row => !LOCATIONS || LOCATIONS[row.id]);
    const cells = new Map();
    const rawCells = src.cells && typeof src.cells === 'object' ? src.cells : {};
    Object.entries(rawCells).forEach(([key, value]) => {
      const match = String(key).match(/^(\d+):(\d+)$/);
      if (!match || !value || typeof value !== 'object') return;
      const cx = Math.max(0, Math.min(GLOBAL_MAP_GRID.cols - 1, Math.floor(Number(match[1]))));
      const cy = Math.max(0, Math.min(GLOBAL_MAP_GRID.rows - 1, Math.floor(Number(match[2]))));
      cells.set(`${cx}:${cy}`, {
        terrain: String(value.terrain || '').slice(0, 80),
        pvpMode: normalizeGlobalMapPvpMode(value.pvpMode || value.zone || value.pvp || 'pvp'),
        chance: Math.max(0, Math.min(100, Math.round(Number(value.chance || 0)))),
        difficulty: Math.max(1, Math.min(5, Math.round(Number(value.difficulty || 1)))),
        texture: String(value.texture || value.textureId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64),
        fill: String(value.fill || '').slice(0, 48),
        encounters: normalizeGlobalMapWeightRows(value.encounters || [], encounterIds),
        randomLocations: normalizeGlobalMapWeightRows(value.randomLocations || []).filter(row => !LOCATIONS || LOCATIONS[row.id])
      });
    });
    return {
      nodes,
      infrastructure,
      objects,
      encounters,
      randomLocations: randomRows,
      cells
    };
  }

  function applyClientGlobalMapConfig(raw = {}) {
    const config = normalizeClientGlobalMapConfig(raw);
    GLOBAL_MAP_NODES = config.nodes;
    GLOBAL_MAP_INFRASTRUCTURE = config.infrastructure;
    GLOBAL_MAP_OBJECTS = config.objects;
    GLOBAL_ENCOUNTERS = config.encounters;
    GLOBAL_RANDOM_LOCATIONS = config.randomLocations;
    GLOBAL_MAP_CELL_OVERRIDES = config.cells;
    globalMapConfigLoaded = true;
    invalidateGlobalMap3D();
    const p = nearestGlobalMapLandPoint(
      clampGlobalMapPoint(globalMapState.playerX, globalMapState.playerY),
      globalMapLocationPoint(globalMapState.fromLocationId || currentLocation?.id || 'settlement')
    );
    globalMapState.playerX = p.x;
    globalMapState.playerY = p.y;
    if (globalMapPointIsWater(globalMapState.selectedX, globalMapState.selectedY)) {
      globalMapState.selectedX = p.x;
      globalMapState.selectedY = p.y;
    }
    if (globalMapState.travel) {
      const routePoints = Array.isArray(globalMapState.travel.routePoints) && globalMapState.travel.routePoints.length >= 2
        ? globalMapState.travel.routePoints
        : planGlobalMapInfrastructureRoute(globalMapState.travel.fromPoint, globalMapState.travel.toPoint);
      if (routePoints.length < 2 || globalMapPathWaterBlock(routePoints)) {
        globalMapState.travel = null;
        globalMapState.encounter = null;
      } else globalMapState.travel.routePoints = routePoints;
    }
    if (globalMapState.onWorldMap) renderGlobalMapPanel();
  }

  function fetchGlobalMapConfig() {
    return typeof serverApi === 'function'
      ? serverApi('/api/global-map', { method: 'GET' })
      : fetch('/api/global-map', { cache: 'no-store' }).then(res => res.json());
  }

  async function loadGlobalMapConfig(options = {}) {
    try {
      const data = options.data || await fetchGlobalMapConfig();
      if (data?.ok && data.map) applyClientGlobalMapConfig(data.map);
    } catch (err) {
      console.warn('[global-map] failed to load config', err);
    }
  }

  function wastelandSimVisualSignatureFromState(state = {}) {
    const compactRows = (rows = [], fields = []) => (Array.isArray(rows) ? rows : []).map(row => {
      const out = [];
      fields.forEach(field => {
        const value = row?.[field];
        out.push(typeof value === 'number' ? Math.round(value * 10) / 10 : (value ?? ''));
      });
      return out.join(':');
    }).join('|');
    return [
      compactRows(state.sites, ['id', 'owner', 'status', 'x', 'y', 'riskLevel', 'resourceType']),
      // Position changes are applied to existing party models every frame and
      // must not invalidate all heavy global-map geometry.
      compactRows(state.parties, ['id', 'kind', 'faction', 'species', 'visual', 'encounterId', 'state', 'destinationSiteId', 'targetPartyId', 'decisionKind', 'riskLevel', 'cargoFillPercent', 'threatPartyId']),
      compactRows([], ['id', 'type', 'status', 'x', 'y', 'displayX', 'displayY']),
      compactRows(state.events, ['id', 'type', 'status', 'siteId', 'level']),
      compactRows(state.worldTasks, ['id', 'type', 'status', 'siteId', 'partyId']),
      compactRows(state.territories, ['owner', 'cx', 'cy', 'borders']),
      compactRows(state.threatZones, ['id', 'type', 'x', 'y', 'radius', 'level'])
    ].join('||');
  }

  function clearGlobalMapWorldPartyAttachmentLocal(party = null, options = {}) {
    const attachedPartyId = String(globalMapState.attachedPartyId || '').trim();
    const attachedTaskId = String(globalMapState.attachedPartyTaskId || '').trim();
    if (!attachedPartyId && !attachedTaskId) return false;
    const pointSource = party && Number.isFinite(Number(party.x)) && Number.isFinite(Number(party.y))
      ? party
      : null;
    if (pointSource) {
      const p = clampGlobalMapPoint(pointSource.x, pointSource.y);
      globalMapState.playerX = p.x;
      globalMapState.playerY = p.y;
      globalMapState.selectedX = p.x;
      globalMapState.selectedY = p.y;
    }
    globalMapState.attachedPartyId = '';
    globalMapState.attachedPartyTaskId = '';
    if (options.save !== false && typeof queueSave === 'function') queueSave(true);
    return true;
  }

  function reconcileGlobalMapWorldPartyAttachment(nextState = {}, previousParty = null) {
    const attachedPartyId = String(globalMapState.attachedPartyId || '').trim();
    const attachedTaskId = String(globalMapState.attachedPartyTaskId || '').trim();
    if (!attachedPartyId && !attachedTaskId) return false;
    const parties = Array.isArray(nextState.parties) ? nextState.parties : [];
    const tasks = Array.isArray(nextState.worldTasks) ? nextState.worldTasks : [];
    const party = parties.find(row => String(row?.id || '') === attachedPartyId) || null;
    const task = tasks.find(row => String(row?.id || '') === attachedTaskId) || null;
    const attachmentValid = !!(
      party
      && (!task || (
        task.status === 'active'
        && String(task.partyId || '') === attachedPartyId
      ))
    );
    if (attachmentValid) return false;
    const lastParty = party || (
      previousParty && String(previousParty.id || '') === attachedPartyId
        ? previousParty
        : null
    );
    return clearGlobalMapWorldPartyAttachmentLocal(lastParty);
  }

  function globalMapWastelandSnapshotIsStale(previousState = {}, sim = {}) {
    const previousSampledAt = Number(previousState.sampledAt);
    const sampledAt = Number(sim.sampledAt);
    const hasPreviousSample = Number.isFinite(previousSampledAt) && previousSampledAt > 0;
    const hasSample = Number.isFinite(sampledAt) && sampledAt > 0;
    if (!hasPreviousSample) return false;
    if (!hasSample) return true;
    if (sampledAt !== previousSampledAt) return sampledAt < previousSampledAt;
    const previousServerNow = Number(previousState.serverNow);
    const serverNow = Number(sim.serverNow);
    return Number.isFinite(previousServerNow) && previousServerNow > 0
      && Number.isFinite(serverNow) && serverNow > 0
      && serverNow < previousServerNow;
  }

  function globalMapWastelandMotionClock(previousState = {}, sim = {}, previousAppliedAt = 0, appliedAt = performance.now()) {
    const previousSampledAt = Math.max(0, Number(previousState.sampledAt || 0));
    const sampledAt = Math.max(0, Number(sim.sampledAt || 0));
    const serverNow = Math.max(sampledAt, Number(sim.serverNow || sampledAt || 0));
    const sameSample = sampledAt > 0 && sampledAt === previousSampledAt;
    const previousAgeMs = sameSample && previousAppliedAt
      ? Math.max(0, Number(previousState.sampleAgeMs || 0) + Math.max(0, appliedAt - previousAppliedAt))
      : 0;
    const serverAgeMs = sampledAt > 0 ? Math.max(0, serverNow - sampledAt) : 0;
    return {
      sampledAt,
      serverNow,
      sampleAgeMs: sameSample ? Math.max(previousAgeMs, serverAgeMs) : serverAgeMs,
      appliedAt
    };
  }

  function applyWastelandSimState(sim = {}) {
    if (globalMapWastelandSnapshotIsStale(WASTELAND_SIM_STATE, sim)) return false;
    const motionClock = globalMapWastelandMotionClock(
      WASTELAND_SIM_STATE,
      sim,
      wastelandSimLastAppliedAt,
      performance.now()
    );
    wastelandSimLastAppliedAt = motionClock.appliedAt;
    const previousVisualSignature = WASTELAND_SIM_STATE?.visualSignature || '';
    const previousAttachedParty = Array.isArray(WASTELAND_SIM_STATE?.parties)
      ? WASTELAND_SIM_STATE.parties.find(row => String(row?.id || '') === String(globalMapState.attachedPartyId || '')) || null
      : null;
    const nextState = {
      worldHour: Number(sim.worldHour || 0),
      gameDayRealMs: Math.max(60000, Number(sim.gameDayRealMs || GLOBAL_MAP_WORLD_DAY_REAL_MS)),
      updatedAt: Number(sim.updatedAt || Date.now()),
      sampledAt: motionClock.sampledAt,
      serverNow: motionClock.serverNow,
      sampleAgeMs: motionClock.sampleAgeMs,
      factions: sim.factions && typeof sim.factions === 'object' ? sim.factions : {},
      sites: Array.isArray(sim.sites)
        ? sim.sites.filter(site => site && typeof site === 'object').map(site => ({ ...site, ...globalMapCellCenterPoint(site) }))
        : [],
      parties: Array.isArray(sim.parties) ? sim.parties : [],
      threatZones: Array.isArray(sim.threatZones) ? sim.threatZones : [],
      territories: Array.isArray(sim.territories) ? sim.territories : [],
      worldZones: Array.isArray(sim.worldZones) ? sim.worldZones : [],
      worldContacts: [],
      events: Array.isArray(sim.events) ? sim.events : [],
      worldTasks: Array.isArray(sim.worldTasks) ? sim.worldTasks : [],
      stats: sim.stats || {}
    };
    nextState.visualSignature = wastelandSimVisualSignatureFromState(nextState);
    WASTELAND_SIM_STATE = nextState;
    reconcileGlobalMapWorldPartyAttachment(nextState, previousAttachedParty);
    if (previousVisualSignature !== nextState.visualSignature && typeof GLOBAL_MAP_3D !== 'undefined' && GLOBAL_MAP_3D) {
      GLOBAL_MAP_3D.dynamicHeavyReady = false;
      GLOBAL_MAP_3D.dynamicHeavyNextAt = 0;
    }
    return true;
  }

  function fetchWastelandSimState() {
    return typeof serverApi === 'function'
      ? serverApi('/api/wasteland', { method: 'GET' })
      : fetch('/api/wasteland', { cache: 'no-store' }).then(res => res.json());
  }

  function applyFetchedWastelandSimState(data = {}) {
    if (!data?.ok || !data.sim) return false;
    applyWastelandSimState(data.sim);
    if (globalMapState.onWorldMap) renderGlobalMapPanel({ skipMapDraw: true });
    const pipboy = document.getElementById('inventory-window');
    if (pipboy?.classList.contains('visible')
      && ['world', 'quests', 'factions'].includes(pipboy.dataset.pipboyScreen)
      && typeof renderPipboyInfoPanels === 'function') {
      renderPipboyInfoPanels();
    }
    return true;
  }

  async function loadWastelandSimState(options = {}) {
    const force = options.force === true;
    const now = performance.now();
    if (wastelandSimFetchPending) return;
    const minInterval = globalMapState?.onWorldMap ? WASTELAND_SIM_ACTIVE_FETCH_MS : WASTELAND_SIM_IDLE_FETCH_MS;
    if (!force && now - wastelandSimLastFetchAt < minInterval) return;
    wastelandSimFetchPending = true;
    try {
      const data = options.data || await fetchWastelandSimState();
      applyFetchedWastelandSimState(data);
    } catch (err) {
      console.warn('[global-map] failed to load wasteland simulation', err);
    } finally {
      // Start the next interval after completion. A slow response therefore
      // cannot turn into an immediate back-to-back download loop.
      wastelandSimLastFetchAt = performance.now();
      wastelandSimFetchPending = false;
    }
  }

  function requestWastelandSimState(force = false) {
    loadWastelandSimState({ force });
  }

  async function loadWorldDataConfig() {
    // Location and map definitions are part of the critical character gate.
    // Wasteland simulation is only needed on the global map, so start it in
    // parallel but never let its timeout/retry hold the first playable frame.
    const startInitialWastelandFetch = !wastelandSimFetchPending;
    if (startInitialWastelandFetch) wastelandSimFetchPending = true;
    const wastelandRequest = startInitialWastelandFetch
      ? Promise.resolve()
        .then(() => fetchWastelandSimState())
        .then(data => ({ data, error: null }), error => ({ data: null, error }))
      : null;
    let settleCriticalConfig = null;
    const criticalConfigSettled = new Promise(resolve => { settleCriticalConfig = resolve; });
    if (wastelandRequest) {
      void wastelandRequest.then(async result => {
        const criticalConfigReady = await criticalConfigSettled;
        try {
          if (!criticalConfigReady) return;
          if (result.error) console.warn('[global-map] failed to load wasteland simulation', result.error);
          else applyFetchedWastelandSimState(result.data);
        } catch (error) {
          console.warn('[global-map] failed to apply wasteland simulation', error);
        } finally {
          wastelandSimLastFetchAt = performance.now();
          wastelandSimFetchPending = false;
        }
      });
    }
    const criticalRequests = [
      typeof fetchLocationConfig === 'function' ? fetchLocationConfig() : Promise.resolve(null),
      fetchGlobalMapConfig()
    ];
    let locationConfigReady = false;
    try {
      const [locationResult, globalMapResult] = await Promise.allSettled(criticalRequests);
      if (locationResult.status !== 'fulfilled' || !locationResult.value) {
        throw locationResult.reason || new Error('Сервер не вернул конфигурацию локаций.');
      }
      locationConfigReady = await loadLocationConfig({ data: locationResult.value });
      if (!locationConfigReady) throw new Error('Не удалось применить конфигурацию локаций сервера.');
      if (globalMapResult.status === 'fulfilled' && globalMapResult.value) {
        await loadGlobalMapConfig({ data: globalMapResult.value });
      } else if (globalMapResult.status === 'rejected') {
        console.warn('[global-map] failed to load config', globalMapResult.reason);
      }
      return true;
    } finally {
      if (settleCriticalConfig) settleCriticalConfig(locationConfigReady);
    }
  }

  function globalMapNode(id = '') {
    return GLOBAL_MAP_NODES.find(node => node.id === id) || GLOBAL_MAP_NODES[0] || null;
  }

  function globalMapLocationName(id = '') {
    return LOCATIONS[id]?.name || globalMapNode(id)?.id || 'Неизвестно';
  }

  function clampGlobalMapPoint(x, y) {
    if (x && typeof x === 'object') {
      y = x.y;
      x = x.x;
    }
    return {
      x: Math.max(0, Math.min(GLOBAL_MAP_SIZE.width, Number(x || 0))),
      y: Math.max(0, Math.min(GLOBAL_MAP_SIZE.height, Number(y || 0)))
    };
  }

  function globalMapLocationPoint(id = '') {
    const node = GLOBAL_MAP_NODES.find(row => row.id === id);
    if (node) return clampGlobalMapPoint(node.x, node.y);
    return clampGlobalMapPoint(globalMapState?.playerX ?? 0, globalMapState?.playerY ?? 0);
  }

  function setGlobalPlayerPointFromLocation(id = '') {
    const p = nearestGlobalMapLandPoint(
      globalMapLocationPoint(id || currentLocation?.id || 'settlement'),
      globalMapLocationPoint('settlement')
    );
    globalMapState.playerX = p.x;
    globalMapState.playerY = p.y;
    globalMapState.selectedX = p.x;
    globalMapState.selectedY = p.y;
    const settlement = globalMapSettlementAt(p.x, p.y);
    globalMapState.fromLocationId = settlement?.id || id || currentLocation?.id || 'settlement';
  }

  function globalMapPointDistance(a = {}, b = {}) {
    return Math.hypot(Number(a.x || 0) - Number(b.x || 0), Number(a.y || 0) - Number(b.y || 0));
  }

  const GLOBAL_MAP_PLAYER_COLLISION_RADIUS = 5.2;

  function globalMapPlayerCollisionRadiusPoints() {
    return GLOBAL_MAP_PLAYER_COLLISION_RADIUS;
  }

  function globalMapCircleTouchRadius(radius = 0) {
    return Math.max(0, Number(radius || 0)) + globalMapPlayerCollisionRadiusPoints();
  }

  function sanitizeGlobalMapEntryCircle(circle = null) {
    if (!circle || typeof circle !== 'object') return null;
    const center = clampGlobalMapPoint(circle.x ?? circle.centerX ?? circle.center?.x, circle.y ?? circle.centerY ?? circle.center?.y);
    const radius = Math.max(2, Math.min(40, Number(circle.radius || circle.r || 0) || GLOBAL_LOCATION_CELL_RADIUS));
    const origin = circle.origin
      ? clampGlobalMapPoint(circle.origin.x, circle.origin.y)
      : (circle.originX || circle.originY
        ? clampGlobalMapPoint(circle.originX, circle.originY)
        : null);
    return {
      x: center.x,
      y: center.y,
      radius,
      origin,
      kind: String(circle.kind || '').slice(0, 32),
      id: String(circle.id || '').slice(0, 80)
    };
  }

  function rememberGlobalMapEntryCircle(circle = null) {
    globalMapState.lastEntryCircle = sanitizeGlobalMapEntryCircle(circle);
    return globalMapState.lastEntryCircle;
  }

  function clearGlobalMapEntryCircle() {
    globalMapState.lastEntryCircle = null;
  }

  function globalMapPointOutsideCircle(circle = null, fallback = null) {
    const safeCircle = sanitizeGlobalMapEntryCircle(circle);
    if (!safeCircle) return fallback ? clampGlobalMapPoint(fallback.x, fallback.y) : globalMapPlayerPoint();
    const center = clampGlobalMapPoint(safeCircle.x, safeCircle.y);
    const preferred = safeCircle.origin
      ? clampGlobalMapPoint(safeCircle.origin.x, safeCircle.origin.y)
      : (fallback ? clampGlobalMapPoint(fallback.x, fallback.y) : globalMapLocationPoint(globalMapState.fromLocationId || currentLocation?.id || 'settlement'));
    let dx = preferred.x - center.x;
    let dy = preferred.y - center.y;
    let len = Math.hypot(dx, dy);
    if (len < 0.001) {
      const selected = globalMapSelectedPoint();
      dx = selected.x - center.x;
      dy = selected.y - center.y;
      len = Math.hypot(dx, dy);
    }
    const baseAngle = len >= 0.001 ? Math.atan2(dy, dx) : -Math.PI / 2;
    const exitRadius = globalMapCircleTouchRadius(safeCircle.radius) + 2.5;
    const distance = Math.max(3, exitRadius);
    const samples = [0, -0.34, 0.34, -0.72, 0.72, Math.PI, -Math.PI * 0.5, Math.PI * 0.5];
    for (const offset of samples) {
      const angle = baseAngle + offset;
      const candidate = clampGlobalMapPoint(
        center.x + Math.cos(angle) * distance,
        center.y + Math.sin(angle) * distance
      );
      const land = nearestGlobalMapLandPoint(candidate, preferred);
      if (globalMapPointDistance(land, center) > globalMapCircleTouchRadius(safeCircle.radius) + 1.5) return land;
    }
    return nearestGlobalMapLandPoint(preferred, center);
  }

  function globalMapSettlementRadius(node = null) {
    return GLOBAL_LOCATION_CELL_RADIUS;
  }

  function globalMapSettlementAt(x, y, radius = GLOBAL_SETTLEMENT_RADIUS) {
    const p = clampGlobalMapPoint(x, y);
    const hitRadius = Math.max(0, Number(radius || GLOBAL_SETTLEMENT_RADIUS));
    let best = null;
    let bestDist = Infinity;
    GLOBAL_MAP_NODES
      .filter(node => node.kind === 'settlement')
      .forEach(node => {
        const d = Math.hypot(p.x - Number(node.x || 0), p.y - Number(node.y || 0));
        if (hitRadius > 0 && d > hitRadius) return;
        if (d < bestDist) { best = node; bestDist = d; }
      });
    return best || null;
  }

  const GLOBAL_WORLD_SITE_RADIUS = GLOBAL_LOCATION_CELL_RADIUS;

  function globalMapCapitalNodes() {
    return GLOBAL_MAP_NODES.filter(node => node && (
      node.capital === true ||
      node.capitalFaction ||
      ['settlement', 'scrapTown', 'relayStation', 'caravanCamp'].includes(String(node.id || ''))
    ));
  }

  function globalMapPointInCapitalClearZone(point = {}, exceptId = '') {
    const p = clampGlobalMapPoint(point.x, point.y);
    const skipId = String(exceptId || '');
    return globalMapCapitalNodes().some(node => (
      String(node.id || '') !== skipId &&
      globalMapPointDistance(p, node) <= GLOBAL_CAPITAL_CLEAR_RADIUS
    ));
  }

  function globalMapWorldSiteVisible(site = null) {
    if (!site) return false;
    if (site.capital === true || ['settlement', 'scrapTown', 'relayStation', 'caravanCamp'].includes(String(site.id || ''))) return true;
    return !globalMapPointInCapitalClearZone(site, site.id || '');
  }

  function globalMapWorldSites() {
    return (Array.isArray(WASTELAND_SIM_STATE.sites) ? WASTELAND_SIM_STATE.sites : [])
      .filter(site => site && site.type !== 'settlement' && globalMapWorldSiteVisible(site));
  }

  function globalMapSettlementSites() {
    return (Array.isArray(WASTELAND_SIM_STATE.sites) ? WASTELAND_SIM_STATE.sites : [])
      .filter(site => site && String(site.type || '').toLowerCase() === 'settlement');
  }

  function globalMapWorldSiteCanEnter(site = null) {
    return !!(site?.locationId && LOCATIONS[site.locationId]);
  }

  function globalMapWorldSiteRadius(site = null) {
    return GLOBAL_WORLD_SITE_RADIUS;
  }

  function globalMapWorldSiteAt(x, y, radius = GLOBAL_WORLD_SITE_RADIUS) {
    const p = clampGlobalMapPoint(x, y);
    const hitRadius = Math.max(0, Number(radius || GLOBAL_WORLD_SITE_RADIUS));
    let best = null;
    let bestDist = Infinity;
    globalMapWorldSites().forEach(site => {
      const d = Math.hypot(p.x - Number(site.x || 0), p.y - Number(site.y || 0));
      if (hitRadius > 0 && d > hitRadius) return;
      if (d < bestDist) { best = site; bestDist = d; }
    });
    return best || null;
  }

  const GLOBAL_WORLD_PARTY_RADIUS = 0;

  function globalMapWorldPartyAt(x, y, radius = GLOBAL_WORLD_PARTY_RADIUS) {
    const p = clampGlobalMapPoint(x, y);
    const explicitRadius = Math.max(0, Number(radius || 0));
    let best = null;
    let bestDist = Infinity;
    (Array.isArray(WASTELAND_SIM_STATE.parties) ? WASTELAND_SIM_STATE.parties : [])
      .filter(row => globalMapWorldPartyVisibleOnMap(row))
      .forEach(row => {
        const point = globalMapWorldPartyDisplayPoint(row);
        const d = Math.hypot(p.x - Number(point.x || 0), p.y - Number(point.y || 0));
        const hitRadius = explicitRadius > 0
          ? explicitRadius
          : Math.max(GLOBAL_WORLD_PARTY_RADIUS, globalMapWorldPartyVisualRadiusPoints(row));
        if (d <= hitRadius && d < bestDist) {
          best = row;
          bestDist = d;
        }
      });
    return best || null;
  }

  function globalMapWorldPartyById(id = '') {
    const partyId = String(id || '').trim();
    if (!partyId) return null;
    return (Array.isArray(WASTELAND_SIM_STATE.parties) ? WASTELAND_SIM_STATE.parties : [])
      .find(row => row && String(row.id || '') === partyId && !globalMapWorldPartyDestroyed(row)) || null;
  }

  function globalMapLocalSocketId() {
    return String(multiplayer?.socket?.id || '').trim();
  }

  function globalMapSetTravelLeader(leaderId = '', leaderName = '') {
    globalMapState.travelLeaderId = String(leaderId || '').trim();
    globalMapState.travelLeaderName = String(leaderName || '').trim();
  }

  function globalMapIsPlayerGroupFollower() {
    const leaderId = String(globalMapState.travelLeaderId || '').trim();
    if (!leaderId) return false;
    const selfId = globalMapLocalSocketId();
    return !selfId || leaderId !== selfId;
  }

  function globalMapGroupMovementLocked() {
    return !!globalMapState.attachedPartyId || globalMapIsPlayerGroupFollower();
  }

  function blockGlobalMapGroupMovement(action = 'route') {
    if (!globalMapGroupMovementLocked()) return false;
    const msg = globalMapState.attachedPartyId
      ? 'Вы движетесь с отрядом. Сначала покиньте группу, если хотите выбрать собственный маршрут.'
      : `Маршрут выбирает ${globalMapState.travelLeaderName || 'лидер группы'}. Вы можете смотреть карту, но не вести группу.`;
    setReadout(msg);
    if (action !== 'silent') addLog(msg, null, 'system');
    renderGlobalMapPanel();
    return true;
  }

  function globalMapWorldPartyCanEncounter(party = {}) {
    if (!party || !globalMapWorldPartyVisibleOnMap(party)) return false;
    if (String(party.state || '').toLowerCase() === 'forming') return false;
    if (globalMapWorldPartyInBattle(party)) return false;
    if (String(party.id || '') && String(party.id || '') === String(globalMapState.attachedPartyId || '')) return false;
    const kind = String(party.kind || '').toLowerCase();
    const faction = globalMapFactionGroupKey(party.faction || '');
    return ['caravan', 'patrol', 'raider', 'monster'].includes(kind) || ['raiders', 'mutants', 'wild'].includes(faction);
  }

  function globalMapWorldPartyHostileToPlayer(party = {}) {
    if (!globalMapWorldPartyCanEncounter(party)) return false;
    const faction = globalMapFactionGroupKey(party.faction || '');
    if (['raiders', 'mutants', 'wild'].includes(faction)) return true;
    const playerFaction = globalMapPlayerFactionKey();
    const civil = ['old_klim', 'caravans', 'scrap_union', 'relay_order'];
    return !!(playerFaction && civil.includes(playerFaction) && civil.includes(faction) && playerFaction !== faction);
  }

  function globalMapWorldPartyEncounterRadius(party = {}) {
    const faction = globalMapFactionGroupKey(party.faction || '');
    const hostile = globalMapWorldPartyHostileToPlayer(party);
    const strength = Math.max(0, Number(party.escortPower || party.strength || 0));
    const base = hostile ? 17 : 9;
    const factionBonus = ['raiders', 'mutants', 'wild'].includes(faction) ? 3 : 0;
    return Math.max(6, Math.min(24, base + factionBonus + Math.min(4, strength / 28)));
  }

  function globalMapWorldPartyVisualRadiusPoints(party = {}) {
    const kind = String(party.kind || '').toLowerCase();
    const faction = globalMapFactionGroupKey(party.faction || '');
    const speciesText = [
      party.species,
      party.visual,
      party.modelKey,
      party.creature,
      party.creatureType,
      party.details?.species,
      party.details?.creature,
      party.details?.creatureType,
      party.name
    ].map(value => String(value || '').toLowerCase()).join(' ');
    let radius = 5.8;
    if (kind === 'caravan') radius = 8.2;
    else if (kind === 'patrol') radius = 6.4;
    else if (faction === 'raiders' || kind === 'raider') radius = 6.2;
    else if (faction === 'mutants') radius = 7.0;
    else if (/radscorpion|scorpion|скорпион/.test(speciesText)) radius = 7.2;
    else if (/gecko|геккон/.test(speciesText)) radius = 6.8;
    else if (/brahmin|брамин/.test(speciesText)) radius = 7.4;
    else if (/ant|мурав/.test(speciesText)) radius = 6.0;
    else if (/wolf|волк/.test(speciesText)) radius = 6.4;
    return Math.max(5.2, Math.min(8.8, radius));
  }

  function globalMapWorldPartyVisualRadiusWorld(party = {}) {
    const radius = globalMapWorldPartyVisualRadiusPoints(party);
    const scaleX = GLOBAL_MAP_3D.worldWidth / Math.max(1, GLOBAL_MAP_SIZE.width);
    const scaleZ = GLOBAL_MAP_3D.worldDepth / Math.max(1, GLOBAL_MAP_SIZE.height);
    return Math.max(0.56, radius * ((scaleX + scaleZ) * 0.5));
  }

  function globalMapWorldPartyEncounterLocationId(party = {}) {
    const kind = String(party.kind || '').toLowerCase();
    const faction = globalMapFactionGroupKey(party.faction || '');
    if (kind === 'patrol') return 'randomAshGrove';
    if (kind === 'caravan') return 'randomRuinedRoad';
    if (faction === 'mutants') return 'randomDryBasin';
    if (faction === 'wild') return 'randomDryBasin';
    return 'randomRuinedRoad';
  }

  function globalMapEntryCircleForTarget(targetLocationId = '', options = {}) {
    const origin = options.originWorldPoint || options.origin || null;
    const explicitPoint = options.worldPoint || options.point || null;
    const explicitRadius = Math.max(0, Number(options.entryRadius || options.exitRadius || options.worldContactRadius || 0));
    let center = explicitPoint ? clampGlobalMapPoint(explicitPoint.x, explicitPoint.y) : null;
    let radius = explicitRadius;
    let kind = String(options.entryKind || options.kind || '').slice(0, 32);
    let id = String(options.entryId || options.id || '').slice(0, 80);

    const partyId = String(options.partyId || options.worldPartyId || '').trim();
    const party = partyId ? globalMapWorldPartyById(partyId) : null;
    if (party) {
      center = clampGlobalMapPoint(globalMapWorldPartyDisplayPoint(party));
      radius = Math.max(radius, globalMapWorldPartyVisualRadiusPoints(party));
      kind = kind || 'party';
      id = id || partyId;
    }

    const siteId = String(options.siteId || options.worldSiteId || '').trim();
    const site = siteId && typeof globalMapWorldSiteById === 'function' ? globalMapWorldSiteById(siteId) : null;
    if (site) {
      center = clampGlobalMapPoint(site.x, site.y);
      radius = Math.max(radius, globalMapWorldSiteRadius(site));
      kind = kind || 'site';
      id = id || siteId;
    }

    const settlement = GLOBAL_MAP_NODES.find(node => node.kind === 'settlement' && node.id === targetLocationId);
    if (!center && settlement) {
      center = clampGlobalMapPoint(settlement.x, settlement.y);
      radius = Math.max(radius, globalMapSettlementRadius(settlement));
      kind = kind || 'settlement';
      id = id || settlement.id || targetLocationId;
    }

    if (!center) center = clampGlobalMapPoint(globalMapPlayerPoint());
    if (!radius) radius = GLOBAL_LOCATION_CELL_RADIUS;
    return sanitizeGlobalMapEntryCircle({
      x: center.x,
      y: center.y,
      radius,
      origin,
      kind,
      id
    });
  }

  function globalMapCreatureModelKeyFromParty(party = {}, options = {}) {
    const values = [
      party.species,
      party.visual,
      party.modelKey,
      party.encounterId,
      party.typeName,
      party.id,
      party.name
    ].map(value => String(value || '').toLowerCase());
    const compactValues = values.map(value => value.replace(/[^a-z0-9]+/g, '')).filter(Boolean);
    const has = predicate => compactValues.some(predicate);
    if (has(value => value.includes('brahmin'))) return 'brahmin';
    if (has(value => value.includes('firegecko') || value.includes('firegeckoambush'))) return 'fireGecko';
    if (has(value => value.includes('gecko'))) return 'gecko';
    if (has(value => value.includes('radscorpion') || value.includes('scorpion'))) return 'radscorpion';
    if (has(value => value === 'mutantant'
      || value === 'mutantants'
      || value === 'ant'
      || value === 'ants'
      || value.includes('mutantant')
      || value.includes('antswarm')
      || value.includes('anthive')
      || value.includes('mutantantswarm'))) return 'mutantAnt';
    if (has(value => value.includes('ghoul'))) return 'ghoul';
    if (has(value => value.includes('ashwolf') || value.includes('wolf'))) return 'ashWolf';
    if (!options.wildOnly && has(value => value === 'mutant'
      || value === 'supermutant'
      || value.includes('supermutant'))) return 'mutant';
    return '';
  }

  function globalMapWorldPartyWildSpeciesKey(party = {}) {
    const key = globalMapCreatureModelKeyFromParty(party, { wildOnly: true });
    if (key && key !== 'mutant') return key;
    return 'radscorpion';
  }

  function globalMapWorldPartyWildEncounterId(party = {}) {
    const species = globalMapWorldPartyWildSpeciesKey(party);
    if (species === 'gecko') return 'gecko_pack';
    if (species === 'fireGecko') return 'fire_gecko_ambush';
    if (species === 'mutantAnt') return 'mutant_ant_swarm';
    if (species === 'ghoul') return 'ghoul_pack';
    return 'radscorpion_nest';
  }

  function globalMapWorldPartyEncounterId(party = {}) {
    const kind = String(party.kind || '').toLowerCase();
    const faction = globalMapFactionGroupKey(party.faction || '');
    if (kind === 'patrol') return 'world_patrol_meeting';
    if (kind === 'caravan') return 'world_caravan_meeting';
    if (faction === 'mutants') return 'super_mutant_lair';
    if (faction === 'wild') return globalMapWorldPartyWildEncounterId(party);
    return 'raider_ambush';
  }

  function globalMapWorldPartyEncounterText(party = {}, forced = false) {
    const kind = String(party.kind || '').toLowerCase();
    const faction = globalMapFactionGroupKey(party.faction || '');
    if (forced) {
      if (faction === 'mutants') return 'Бродячие супермутанты заметили вас на маршруте. Обойти встречу уже не получится.';
      if (faction === 'wild') return 'Дикие твари вышли на ваш след. Отряд перекрывает путь.';
      if (faction === 'raiders') return 'Рейдерский отряд перехватил вас на дороге. Придётся вступить в столкновение.';
      return 'Враждебный отряд заметил вас на глобальной карте.';
    }
    if (kind === 'patrol') return 'Патруль остановился на дороге. Можно подойти, поговорить или пройти мимо.';
    if (kind === 'caravan') return 'Караван стоит на маршруте. Можно войти в сцену, поговорить с караванщиком и поторговать.';
    return 'Отряд пустоши находится рядом. Можно войти в сцену встречи.';
  }

  function globalMapAttachedParty() {
    return globalMapWorldPartyById(globalMapState.attachedPartyId);
  }

  function globalMapAttachedPartyRosterRows(party = globalMapAttachedParty()) {
    if (!party) return [];
    const groupMembers = Array.isArray(party.groupMembers) ? party.groupMembers : [];
    if (groupMembers.length) return groupMembers;
    const rows = [];
    if (party.leader || party.leaderName) {
      rows.push(party.leader || {
        id: party.leaderId || `${party.id || 'party'}_leader`,
        name: party.leaderName || 'Караванщик',
        role: party.leaderRole || 'Глава каравана',
        type: 'npc',
        leader: true
      });
    }
    (Array.isArray(party.npcMembers) ? party.npcMembers : []).forEach(row => rows.push(row));
    (Array.isArray(party.playerMembers) ? party.playerMembers : []).forEach(row => rows.push({
      ...row,
      role: row.role || 'Сопровождение',
      type: 'player'
    }));
    return rows;
  }

  function globalMapPartyRosterHtml(rows = [], options = {}) {
    const maxRows = Math.max(1, Number(options.maxRows || 8));
    const visible = rows.slice(0, maxRows);
    const hidden = Math.max(0, rows.length - visible.length);
    const body = visible.map(row => {
      const role = row.leader ? (row.role || 'Глава') : (row.role || (row.type === 'player' ? 'Игрок' : 'NPC'));
      const cls = row.leader ? ' leader' : row.type === 'player' ? ' player' : ' npc';
      return `<div class="global-party-row${cls}"><b>${escapeHtml(row.name || 'Участник')}</b><small>${escapeHtml(role)}</small></div>`;
    }).join('');
    return `${body}${hidden ? `<div class="global-party-row muted"><b>Еще ${hidden}</b><small>в составе</small></div>` : ''}`;
  }

  function detachGlobalMapWorldParty(reason = '', options = {}) {
    if (!options.skipServerCancel
      && typeof rejectBlockedGameplayAction === 'function'
      && rejectBlockedGameplayAction('Связь с сервером восстанавливается. Выход из группы временно недоступен.')) return false;
    const party = globalMapAttachedParty();
    if (!globalMapState.attachedPartyId) return false;
    const p = party ? clampGlobalMapPoint(party.x, party.y) : clampGlobalMapPoint(globalMapState.playerX, globalMapState.playerY);
    globalMapState.playerX = p.x;
    globalMapState.playerY = p.y;
    globalMapState.selectedX = p.x;
    globalMapState.selectedY = p.y;
    const label = party?.name || 'группа';
    const leavingTaskId = String(globalMapState.attachedPartyTaskId || '').trim();
    const socket = typeof multiplayer === 'object' ? multiplayer.socket : null;
    const finishDetach = () => {
      globalMapState.partyDetachPending = false;
      globalMapState.attachedPartyId = '';
      globalMapState.attachedPartyTaskId = '';
      if (reason) addLog(reason, null, 'system');
      else addLog(`Глобальная карта: вы покинули группу ${label}.`, null, 'system');
      renderGlobalMapPanel();
      if (typeof queueSave === 'function') queueSave(true);
    };
    if (!options.skipServerCancel && leavingTaskId && socket?.connected && typeof multiplayer === 'object' && multiplayer.joined && typeof socket.emit === 'function') {
      if (globalMapState.partyDetachPending) {
        setReadout('Сервер подтверждает выход из группы.');
        return false;
      }
      globalMapState.partyDetachPending = true;
      const handleServerAck = ack => {
        if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
        if (ack?.sim && typeof applyWastelandSimState === 'function') applyWastelandSimState(ack.sim);
        if (!ack || ack.ok === false) {
          globalMapState.partyDetachPending = false;
          addLog(ack?.error || 'Сервер не подтвердил выход из группы.', null, 'quest');
          renderGlobalMapPanel();
          if (typeof options.onServerResult === 'function') options.onServerResult(false, ack || null);
          return;
        }
        finishDetach();
        if (typeof options.onServerResult === 'function') options.onServerResult(true, ack);
      };
      const requestSent = typeof emitGuardedMultiplayerGameplayAction === 'function'
        ? emitGuardedMultiplayerGameplayAction(
          'worldTaskAction',
          { action: 'cancel', taskId: leavingTaskId },
          handleServerAck
        )
        : (socket.emit('worldTaskAction', { action: 'cancel', taskId: leavingTaskId }, handleServerAck), true);
      if (!requestSent) {
        globalMapState.partyDetachPending = false;
        setReadout('Нет подтверждённого соединения с сервером.');
        return false;
      }
      return true;
    }
    finishDetach();
    return true;
  }

  function attachGlobalMapToWorldParty(partyId = '', taskId = '') {
    const party = globalMapWorldPartyById(partyId);
    if (!party) {
      addLog('Группа уже недоступна на глобальной карте.', null, 'quest');
      return false;
    }
    globalMapState.travel = null;
    globalMapState.encounter = null;
    globalMapState.pendingWorldDrop = null;
    globalMapState.attachedPartyId = String(party.id || '');
    globalMapState.attachedPartyTaskId = String(taskId || '');
    const p = clampGlobalMapPoint(party.x, party.y);
    globalMapState.playerX = p.x;
    globalMapState.playerY = p.y;
    globalMapState.selectedX = p.x;
    globalMapState.selectedY = p.y;
    globalMapState.onWorldMap = true;
    if (typeof closeAllWindows === 'function') closeAllWindows(false);
    setGlobalMapMiniGameActive(true);
    addLog(`Глобальная карта: вы присоединились к группе ${party.name || party.id}.`, null, 'quest');
    renderGlobalMapPanel();
    if (typeof queueSave === 'function') queueSave(true);
    return true;
  }

  function globalMapWorldSiteTitle(site = null) {
    return site?.name || globalMapLocationName(site?.locationId || '') || 'Точка пустоши';
  }

  function globalMapResourceLabel(id = '') {
    const labels = {
      scrap: 'лом',
      ammoParts: 'детали патронов',
      water: 'вода',
      chemicals: 'химикаты',
      ore: 'руда',
      oil: 'нефть',
      electronics: 'электроника',
      medicine: 'медикаменты'
    };
    return labels[String(id || '')] || String(id || '');
  }

  function globalMapFactionLabel(id = '') {
    const key = String(id || '').toLowerCase();
    if (key === 'old_klim') return 'Старый Клим';
    if (key === 'caravans') return 'караванщики';
    if (key === 'scrap_union') return 'Свалочный союз';
    if (key === 'relay_order') return 'Ретранслятор';
    if (key === 'raiders') return 'рейдеры';
    if (key === 'mutants') return 'супермутанты';
    if (key === 'wild') return 'дикие твари';
    if (key === 'neutral') return 'нейтралы';
    return key || 'неизвестно';
  }

  function globalMapWorldSiteDescription(site = null) {
    const resourceLine = globalMapWorldSiteResourceLine(site);
    const controlLine = globalMapWorldSiteControlLine(site);
    const marketLine = globalMapWorldSiteMarketLine(site);
    const location = LOCATIONS[site?.locationId || ''] || {};
    const sizeLabel = String(site?.templateLocationId ? site?.localSizeLabel : location.localSizeLabel || '').trim();
    const sizeLine = sizeLabel
      ? `Размер внутренней локации: ${sizeLabel}.`
      : '';
    const note = String(site?.description || site?.note || '').trim();
    if (note) return [note, sizeLine, controlLine, resourceLine, marketLine].filter(Boolean).join(' ');
    const locationNote = String(location.description || location.note || '').trim();
    if (locationNote) return [locationNote, sizeLine, controlLine, resourceLine, marketLine].filter(Boolean).join(' ');
    const output = site?.output && typeof site.output === 'object' ? site.output : {};
    const resources = Object.entries(output)
      .filter(([, amount]) => Number(amount || 0) > 0)
      .map(([id]) => globalMapResourceLabel(id))
      .slice(0, 4);
    if (resources.length) return [`Ресурсная точка. Основная добыча: ${resources.join(', ')}.`, sizeLine, controlLine, resourceLine, marketLine].filter(Boolean).join(' ');
    const type = String(site?.type || '').toLowerCase();
    if (type === 'outpost') return ['Аванпост пустоши. Здесь могут быть охрана, припасы и контроль территории.', sizeLine, controlLine, marketLine].filter(Boolean).join(' ');
    if (type === 'production') return ['Производственная точка. Здесь делают патроны, детали, медикаменты или технические припасы, если есть сырье и рабочие.', sizeLine, controlLine, resourceLine, marketLine].filter(Boolean).join(' ');
    if (type === 'pointofinterest') return ['Точка интереса в пустоши. Может скрывать опасность, добычу или редкие находки.', sizeLine, controlLine, marketLine].filter(Boolean).join(' ');
    return [sizeLine, controlLine, marketLine].filter(Boolean).join(' ');
  }

  function globalMapWorldSiteControlLine(site = null) {
    if (!site) return '';
    const owner = site.ownerLabel || globalMapFactionLabel(site.owner || 'neutral');
    const state = site.controlStateLabel || '';
    const pressure = Math.round(Number(site.controlPressure || 0));
    const threat = site.controlThreatName
      ? ` Угроза: ${site.controlThreatName}${Number(site.controlThreatDistanceKm || 0) ? ` (${Number(site.controlThreatDistanceKm || 0).toFixed(1).replace('.', ',')} км)` : ''}.`
      : '';
    return `Контроль: ${owner}${state ? `, ${state}` : ''}${pressure ? `, давление ${pressure}` : ''}.${threat}`;
  }

  function globalMapWorldSiteMarketLine(site = null) {
    if (!site) return '';
    const state = String(site.marketStateLabel || site.marketState || '').trim();
    if (!state) return '';
    const price = Math.round((Number(site.marketPriceMultiplier || 1) - 1) * 100);
    const qty = Math.round((Number(site.marketQuantityMultiplier || 1) - 1) * 100);
    const parts = [`Рынок: ${state}`];
    if (Math.abs(price) >= 2) parts.push(`цены ${price > 0 ? '+' : ''}${price}%`);
    if (Math.abs(qty) >= 2) parts.push(`товар ${qty > 0 ? '+' : ''}${qty}%`);
    return `${parts.join(', ')}.`;
  }

  function globalMapWorldSiteResourceLine(site = null) {
    if (!site) return '';
    const output = site.output && typeof site.output === 'object' ? site.output : {};
    const resources = Object.entries(output)
      .filter(([, amount]) => Number(amount || 0) > 0)
      .map(([id]) => globalMapResourceLabel(id))
      .slice(0, 4);
    if (!resources.length) return '';
    const activity = Math.round(Number(site.resourceActivity || 0));
    const richness = Math.round(Number(site.resourceRichness || 0));
    const crew = Math.round(Number(site.workforce || 0));
    const protection = Math.round(Number(site.protectionLevel || 0));
    const protector = site.protectedBySiteId ? globalMapWorldSiteById(site.protectedBySiteId) : null;
    const raidActive = !!site.activeConflict;
    // Истощение стало физическим: выработанные узлы исчезают на самой карте и
    // возвращаются по таймеру, поэтому состояние точки описывает её богатство.
    const condition = richness >= 70
      ? 'богатая'
      : richness >= 40
        ? 'стабильная'
        : 'скудная';
    const guardText = protection > 0
      ? `Охрана: ${protection}%${protector ? ` (${protector.name || protector.id})` : ''}.`
      : 'Охрана: нет.';
    const stockText = globalMapResourceSummary(site.stockpile || {}, 3);
    const needText = String(site.productionNeedSummary || '').trim();
    const raidText = raidActive ? ` На точке идет налет: ${globalMapFactionLabel(site.lastRaidFaction)}.` : '';
    return `Добыча: ${resources.join(', ')}. Состояние: ${condition}, активность ${activity}%, богатство ${richness}%, рабочие ${crew}%. Запасы: ${stockText || 'пусто'}. ${needText ? `Нужно: ${needText}. ` : ''}${guardText}${raidText}`;
  }

  function globalMapSelectedPoint() {
    return clampGlobalMapPoint(globalMapState.selectedX, globalMapState.selectedY);
  }

  function globalMapPlayerPoint() {
    const attached = globalMapAttachedParty();
    if (attached) {
      const p = typeof globalMapWorldPartyDisplayPoint === 'function'
        ? globalMapWorldPartyDisplayPoint(attached)
        : clampGlobalMapPoint(attached.x, attached.y);
      globalMapState.playerX = p.x;
      globalMapState.playerY = p.y;
      globalMapState.selectedX = p.x;
      globalMapState.selectedY = p.y;
      return p;
    }
    return clampGlobalMapPoint(globalMapState.playerX, globalMapState.playerY);
  }

  function globalMapPointTitle(point = globalMapSelectedPoint()) {
    const settlement = globalMapSettlementAt(point.x, point.y);
    if (settlement) return globalMapLocationName(settlement.id);
    const worldSite = globalMapWorldSiteAt(point.x, point.y);
    if (worldSite) return globalMapWorldSiteTitle(worldSite);
    const cell = globalMapPointCell(point.x, point.y);
    const profile = globalMapCellProfile(cell.cx, cell.cy);
    return profile.terrain || 'Пустошь';
  }

  function pickRandomGlobalLocation(point = globalMapPlayerPoint()) {
    const cell = globalMapPointCell(point.x, point.y);
    const profile = globalMapCellProfile(cell.cx, cell.cy);
    const source = Array.isArray(profile.randomLocations) && profile.randomLocations.length
      ? profile.randomLocations
      : GLOBAL_RANDOM_LOCATIONS;
    const pool = source.filter(row => LOCATIONS[row.id]);
    const rows = pool.length ? pool : [{ id: 'randomEncounter', weight: 1 }];
    const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.weight || 0)), 0) || 1;
    let roll = Math.random() * total;
    for (const row of rows) {
      roll -= Math.max(0, Number(row.weight || 0));
      if (roll <= 0) return row.id;
    }
    return rows[rows.length - 1].id;
  }

  function globalMapRouteDistance(points = []) {
    let total = 0;
    for (let index = 1; index < points.length; index++) total += globalMapPointDistance(points[index - 1], points[index]);
    return total;
  }

  function globalMapPointAtRouteProgress(points = [], progress = 0) {
    const route = (Array.isArray(points) ? points : []).map(point => clampGlobalMapPoint(point?.x, point?.y));
    if (!route.length) return globalMapPlayerPoint();
    if (route.length === 1) return route[0];
    const total = globalMapRouteDistance(route);
    if (total <= 0.0001) return route[route.length - 1];
    let remaining = total * Math.max(0, Math.min(1, Number(progress || 0)));
    for (let index = 1; index < route.length; index++) {
      const from = route[index - 1];
      const to = route[index];
      const distance = globalMapPointDistance(from, to);
      if (remaining > distance && index < route.length - 1) {
        remaining -= distance;
        continue;
      }
      const segmentProgress = distance > 0 ? Math.max(0, Math.min(1, remaining / distance)) : 1;
      return clampGlobalMapPoint(
        from.x + (to.x - from.x) * segmentProgress,
        from.y + (to.y - from.y) * segmentProgress
      );
    }
    return route[route.length - 1];
  }

  function globalMapRoutePointsFromProgress(points = [], progress = 0) {
    const route = (Array.isArray(points) ? points : []).map(point => clampGlobalMapPoint(point?.x, point?.y));
    if (route.length < 2) return route;
    const total = globalMapRouteDistance(route);
    let remaining = total * Math.max(0, Math.min(1, Number(progress || 0)));
    for (let index = 1; index < route.length; index++) {
      const from = route[index - 1];
      const to = route[index];
      const distance = globalMapPointDistance(from, to);
      if (remaining > distance && index < route.length - 1) {
        remaining -= distance;
        continue;
      }
      const segmentProgress = distance > 0 ? Math.max(0, Math.min(1, remaining / distance)) : 1;
      const current = clampGlobalMapPoint(
        from.x + (to.x - from.x) * segmentProgress,
        from.y + (to.y - from.y) * segmentProgress
      );
      return [current, ...route.slice(index)];
    }
    return [route[route.length - 1]];
  }

  function globalMapSampleInfrastructure(row = {}, spacing = 12) {
    const sampled = [];
    const points = Array.isArray(row.points) ? row.points : [];
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1];
      const to = points[index];
      const distance = globalMapPointDistance(from, to);
      const steps = Math.max(1, Math.ceil(distance / Math.max(3, spacing)));
      for (let step = 0; step <= steps; step++) {
        if (index > 1 && step === 0) continue;
        const progress = step / steps;
        sampled.push({ x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress });
      }
    }
    return sampled;
  }

  function globalMapSimplifyRoutePoints(points = []) {
    const compact = [];
    points.forEach(point => {
      const current = clampGlobalMapPoint(point?.x, point?.y);
      if (!compact.length || globalMapPointDistance(compact[compact.length - 1], current) > 0.05) compact.push(current);
    });
    if (compact.length <= 2) return compact;
    const result = [compact[0]];
    for (let index = 1; index < compact.length - 1; index++) {
      const a = result[result.length - 1];
      const b = compact[index];
      const c = compact[index + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const bcx = c.x - b.x;
      const bcy = c.y - b.y;
      const scale = Math.max(1, Math.hypot(abx, aby) * Math.hypot(bcx, bcy));
      if (Math.abs(abx * bcy - aby * bcx) / scale > 0.0025) result.push(b);
    }
    result.push(compact[compact.length - 1]);
    return result;
  }

  function planGlobalMapInfrastructureRoute(fromPoint = {}, toPoint = {}, options = {}) {
    const from = clampGlobalMapPoint(fromPoint.x, fromPoint.y);
    const to = clampGlobalMapPoint(toPoint.x, toPoint.y);
    if (globalMapPointDistance(from, to) < 0.05) return [from, to];
    const graph = new Map();
    const infrastructureIds = [];
    const spacing = Math.max(5, Math.min(30, Number(options.spacing || 12)));
    const bias = Math.max(0.65, Math.min(1.65, Number(options.infrastructureBias || 1)));
    const addEdge = (fromId, toId, cost) => {
      if (!graph.has(fromId) || !graph.has(toId) || !Number.isFinite(cost)) return;
      graph.get(fromId).edges.push({ id: toId, cost: Math.max(0.0001, cost) });
      graph.get(toId).edges.push({ id: fromId, cost: Math.max(0.0001, cost) });
    };
    GLOBAL_MAP_INFRASTRUCTURE.filter(row => row.walkable && row.points.length >= 2).forEach(row => {
      let previousId = '';
      globalMapSampleInfrastructure(row, spacing).forEach((point, index) => {
        const id = `${row.id}:${index}`;
        graph.set(id, { id, point, routeId: row.id, edges: [] });
        infrastructureIds.push(id);
        if (previousId && !globalMapRouteWaterBlock(graph.get(previousId).point, point)) {
          addEdge(graph, previousId, id, globalMapPointDistance(graph.get(previousId).point, point) * row.travelFactor * bias);
        }
        previousId = id;
      });
    });
    for (let left = 0; left < infrastructureIds.length; left++) {
      const leftNode = graph.get(infrastructureIds[left]);
      for (let right = left + 1; right < infrastructureIds.length; right++) {
        const rightNode = graph.get(infrastructureIds[right]);
        if (leftNode.routeId === rightNode.routeId) continue;
        const distance = globalMapPointDistance(leftNode.point, rightNode.point);
        if (distance <= 1.25) addEdge(graph, leftNode.id, rightNode.id, Math.max(0.01, distance * 0.5));
      }
    }
    graph.set('start', { id: 'start', point: from, routeId: '', edges: [] });
    graph.set('finish', { id: 'finish', point: to, routeId: '', edges: [] });
    if (!globalMapRouteWaterBlock(from, to)) addEdge(graph, 'start', 'finish', globalMapPointDistance(from, to));
    const connectEndpoint = (id, point) => {
      infrastructureIds
        .map(candidateId => ({ id: candidateId, distance: globalMapPointDistance(point, graph.get(candidateId).point) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 32)
        .forEach(candidate => {
          const target = graph.get(candidate.id).point;
          if (!globalMapRouteWaterBlock(point, target)) addEdge(graph, id, candidate.id, candidate.distance);
        });
    };
    connectEndpoint('start', from);
    connectEndpoint('finish', to);
    const distances = new Map(Array.from(graph.keys(), id => [id, Infinity]));
    const previous = new Map();
    const unvisited = new Set(graph.keys());
    distances.set('start', 0);
    while (unvisited.size) {
      let currentId = '';
      let currentDistance = Infinity;
      unvisited.forEach(id => {
        const distance = distances.get(id);
        if (distance < currentDistance) {
          currentDistance = distance;
          currentId = id;
        }
      });
      if (!currentId || !Number.isFinite(currentDistance)) break;
      unvisited.delete(currentId);
      if (currentId === 'finish') break;
      graph.get(currentId).edges.forEach(edge => {
        if (!unvisited.has(edge.id)) return;
        const nextDistance = currentDistance + edge.cost;
        if (nextDistance + 0.0001 >= distances.get(edge.id)) return;
        distances.set(edge.id, nextDistance);
        previous.set(edge.id, currentId);
      });
    }
    if (!Number.isFinite(distances.get('finish'))) return [];
    const ids = [];
    let cursor = 'finish';
    while (cursor) {
      ids.push(cursor);
      if (cursor === 'start') break;
      cursor = previous.get(cursor) || '';
    }
    if (ids[ids.length - 1] !== 'start') return [];
    return globalMapSimplifyRoutePoints(ids.reverse().map(id => graph.get(id).point));
  }

  function globalMapTravelCurrentPoint(travel = globalMapState.travel) {
    if (!travel) return globalMapPlayerPoint();
    return globalMapTravelPointAtProgress(travel, travel.progress);
  }

  function globalMapTravelPointAtProgress(travel = globalMapState.travel, progress = 0) {
    if (!travel) return globalMapPlayerPoint();
    const from = travel.fromPoint || globalMapPlayerPoint();
    const to = travel.toPoint || globalMapSelectedPoint();
    const t = Math.max(0, Math.min(1, Number(progress || 0)));
    if (Array.isArray(travel.routePoints) && travel.routePoints.length >= 2) {
      return globalMapPointAtRouteProgress(travel.routePoints, t);
    }
    return clampGlobalMapPoint(
      Number(from.x || 0) + (Number(to.x || 0) - Number(from.x || 0)) * t,
      Number(from.y || 0) + (Number(to.y || 0) - Number(from.y || 0)) * t
    );
  }

  function globalMapClamp01(value) {
    return Math.max(0, Math.min(1, Number(value || 0)));
  }

  function globalMapSavedPoint(point = {}) {
    const p = clampGlobalMapPoint(point.x, point.y);
    return { x: p.x, y: p.y };
  }

  function globalMapSafeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function globalMapServerTravelProgress(payload = {}, durationSeconds = 0, transportMs = 0, progressFloor = 0) {
    const durationMs = Math.max(
      100,
      globalMapSafeNumber(payload.durationMs, globalMapSafeNumber(durationSeconds, 0) * 1000)
    );
    const directProgress = globalMapClamp01(payload.progress);
    const explicitElapsedMs = Number(payload.elapsedMs);
    const serverNow = Number(payload.serverNow);
    const startedAt = Number(payload.startedAt);
    const elapsedMs = Number.isFinite(explicitElapsedMs)
      ? Math.max(0, explicitElapsedMs)
      : (Number.isFinite(serverNow) && Number.isFinite(startedAt)
        ? Math.max(0, serverNow - startedAt)
        : directProgress * durationMs);
    const projectedProgress = globalMapClamp01(
      (elapsedMs + Math.max(0, globalMapSafeNumber(transportMs, 0)) * 0.5) / durationMs
    );
    return Math.max(globalMapClamp01(progressFloor), directProgress, projectedProgress);
  }

  function serializeGlobalMapTravel(travel = globalMapState.travel) {
    if (!travel) return null;
    const fromPoint = globalMapSavedPoint(travel.fromPoint || globalMapPlayerPoint());
    const toPoint = globalMapSavedPoint(travel.toPoint || globalMapSelectedPoint());
    const currentPoint = globalMapSavedPoint(globalMapTravelCurrentPoint(travel));
    return {
      fromPoint,
      toPoint,
      currentPoint,
      routePoints: (Array.isArray(travel.routePoints) ? travel.routePoints : [fromPoint, toPoint]).map(globalMapSavedPoint),
      targetSettlementId: travel.targetSettlementId || '',
      targetWorldSiteId: travel.targetWorldSiteId || '',
      travelId: travel.travelId || '',
      progress: globalMapClamp01(travel.progress),
      duration: globalMapSafeNumber(travel.duration, 0),
      durationMs: Math.max(0, globalMapSafeNumber(travel.duration, 0) * 1000),
      distanceKm: globalMapSafeNumber(travel.distanceKm, 0),
      speedKmh: globalMapSafeNumber(travel.speedKmh, 0),
      worldHours: globalMapSafeNumber(travel.worldHours, 0),
      wandererSkill: globalMapSafeNumber(travel.wandererSkill, 0),
      serverAuthoritative: !!travel.serverAuthoritative,
      elapsedMs: Math.max(0, globalMapSafeNumber(travel.duration, 0) * 1000 * globalMapClamp01(travel.progress))
    };
  }

  function restoreGlobalMapTravel(saved = null) {
    if (!saved || typeof saved !== 'object') return null;
    const fromPoint = globalMapSavedPoint(saved.fromPoint || saved.currentPoint || globalMapPlayerPoint());
    const toPoint = globalMapSavedPoint(saved.toPoint || globalMapSelectedPoint());
    const dist = globalMapPointDistance(fromPoint, toPoint);
    if (dist <= 0.35) return null;
    if (globalMapPointIsWater(fromPoint.x, fromPoint.y) || globalMapPointIsWater(toPoint.x, toPoint.y)) return null;
    const routePoints = globalMapSimplifyRoutePoints(
      Array.isArray(saved.routePoints) && saved.routePoints.length >= 2
        ? saved.routePoints
        : planGlobalMapInfrastructureRoute(fromPoint, toPoint)
    );
    if (routePoints.length < 2 || globalMapPathWaterBlock(routePoints)) return null;
    const routeDist = globalMapRouteDistance(routePoints);
    const routeTravelInfo = globalMapTravelInfoByDistance(routeDist);
    const duration = Math.max(0.1, globalMapSafeNumber(saved.duration, routeTravelInfo.realSeconds));
    const progress = globalMapServerTravelProgress(saved, duration, 0, saved.progress);
    return {
      fromPoint,
      toPoint,
      routePoints,
      targetSettlementId: saved.targetSettlementId || globalMapSettlementAt(toPoint.x, toPoint.y)?.id || '',
      targetWorldSiteId: saved.targetWorldSiteId || globalMapWorldSiteAt(toPoint.x, toPoint.y)?.id || '',
      travelId: String(saved.travelId || ''),
      progress,
      prevProgress: progress,
      duration,
      distanceKm: Math.max(0, globalMapSafeNumber(saved.distanceKm, routeTravelInfo.distanceKm)),
      speedKmh: Math.max(0, globalMapSafeNumber(saved.speedKmh, routeTravelInfo.speedKmh)),
      worldHours: Math.max(0, globalMapSafeNumber(saved.worldHours, routeTravelInfo.worldHours)),
      wandererSkill: Math.max(0, globalMapSafeNumber(saved.wandererSkill, routeTravelInfo.wanderer)),
      routeProfile: globalMapRouteProfileAlongPoints(routePoints),
      serverAuthoritative: !!saved.serverAuthoritative
    };
  }

  function serializeGlobalMapEncounter(encounter = globalMapState.encounter) {
    if (!encounter) return null;
    return {
      id: encounter.id || '',
      title: encounter.title || '',
      text: encounter.text || '',
      kind: encounter.kind || '',
      locationId: encounter.locationId || '',
      forced: !!encounter.forced,
      requiredWanderer: Math.max(0, Math.floor(globalMapSafeNumber(encounter.requiredWanderer, 0))),
      wanderer: Math.max(0, Math.floor(globalMapSafeNumber(encounter.wanderer, 0))),
      wandererXpAwarded: !!encounter.wandererXpAwarded
    };
  }

  function restoreGlobalMapEncounter(saved = null) {
    if (!saved || typeof saved !== 'object') return null;
    const template = GLOBAL_ENCOUNTERS.find(row => row.id === saved.id) || null;
    return {
      ...(template || {}),
      id: saved.id || template?.id || '',
      title: saved.title || template?.title || '',
      text: saved.text || template?.text || '',
      kind: saved.kind || template?.kind || '',
      locationId: saved.locationId || template?.locationId || '',
      forced: !!saved.forced,
      requiredWanderer: Math.max(0, Math.floor(globalMapSafeNumber(saved.requiredWanderer, 0))),
      wanderer: Math.max(0, Math.floor(globalMapSafeNumber(saved.wanderer, 0))),
      wandererXpAwarded: !!saved.wandererXpAwarded
    };
  }

  function sanitizeGlobalMapPendingDrop(drop = null) {
    if (!drop || typeof drop !== 'object' || !LOCATIONS[drop.locationId]) return null;
    return {
      locationId: drop.locationId,
      encounter: !!drop.encounter,
      encounterId: drop.encounterId || '',
      pvpMode: normalizeGlobalMapPvpMode(drop.pvpMode || 'pvp'),
      siteId: drop.siteId || '',
      siteName: drop.siteName || ''
    };
  }

  function serializeGlobalMapState() {
    const travel = serializeGlobalMapTravel(globalMapState.travel);
    let playerPoint = travel?.currentPoint || globalMapSavedPoint(globalMapPlayerPoint());
    if (globalMapPointIsWater(playerPoint.x, playerPoint.y)) {
      playerPoint = nearestGlobalMapLandPoint(playerPoint, globalMapLocationPoint(globalMapState.fromLocationId || currentLocation?.id || 'settlement'));
    }
    let selectedPoint = travel?.toPoint || globalMapSavedPoint(globalMapSelectedPoint());
    if (globalMapPointIsWater(selectedPoint.x, selectedPoint.y)) selectedPoint = playerPoint;
    return {
      version: 1,
      onWorldMap: !!(globalMapState.onWorldMap || globalMapState.travel || globalMapState.encounter),
      fromLocationId: globalMapState.fromLocationId || currentLocation?.id || 'settlement',
      playerX: playerPoint.x,
      playerY: playerPoint.y,
      selectedX: selectedPoint.x,
      selectedY: selectedPoint.y,
      pendingEncounterId: globalMapState.pendingEncounterId || '',
      pendingEncounterRoomId: globalMapState.pendingEncounterRoomId || '',
      pendingEncounterWorldZoneId: globalMapState.pendingEncounterWorldZoneId || '',
      pendingEncounterWorldPartyId: globalMapState.pendingEncounterWorldPartyId || '',
      pendingEncounterWorldPoint: globalMapState.pendingEncounterWorldPoint
        ? globalMapSavedPoint(globalMapState.pendingEncounterWorldPoint)
        : null,
      pendingWorldDrop: sanitizeGlobalMapPendingDrop(globalMapState.pendingWorldDrop),
      currentWorldSiteId: globalMapState.currentWorldSiteId || '',
      attachedPartyId: globalMapState.attachedPartyId || '',
      attachedPartyTaskId: globalMapState.attachedPartyTaskId || '',
      lastEntryCircle: sanitizeGlobalMapEntryCircle(globalMapState.lastEntryCircle),
      travel,
      encounter: serializeGlobalMapEncounter(globalMapState.encounter)
    };
  }

  function applySavedGlobalMapState(saved = null) {
    if (!saved || typeof saved !== 'object') {
      globalMapState.partyDetachPending = false;
      globalMapState.onWorldMap = false;
      globalMapState.travel = null;
      globalMapState.encounter = null;
      globalMapState.pendingEncounterWorldZoneId = '';
      globalMapState.pendingEncounterWorldPartyId = '';
      globalMapState.pendingWorldDrop = null;
      globalMapState.attachedPartyId = '';
      globalMapState.attachedPartyTaskId = '';
      clearGlobalMapEntryCircle();
      globalMapSetTravelLeader('', '');
      setGlobalMapMiniGameActive(false);
      renderGlobalEncounterPanel();
      return false;
    }
    const previousTravel = globalMapState.travel;
    const fallbackPoint = globalMapLocationPoint(saved.fromLocationId || currentLocation?.id || 'settlement');
    let playerPoint = globalMapSavedPoint({ x: saved.playerX, y: saved.playerY });
    playerPoint = nearestGlobalMapLandPoint(playerPoint, fallbackPoint);
    let selectedPoint = globalMapSavedPoint({
      x: Number.isFinite(Number(saved.selectedX)) ? saved.selectedX : playerPoint.x,
      y: Number.isFinite(Number(saved.selectedY)) ? saved.selectedY : playerPoint.y
    });
    if (globalMapPointIsWater(selectedPoint.x, selectedPoint.y)) selectedPoint = playerPoint;
    globalMapState.playerX = playerPoint.x;
    globalMapState.playerY = playerPoint.y;
    globalMapState.selectedX = selectedPoint.x;
    globalMapState.selectedY = selectedPoint.y;
    globalMapState.fromLocationId = saved.fromLocationId || currentLocation?.id || 'settlement';
    globalMapState.pendingEncounterId = saved.pendingEncounterId || '';
    globalMapState.pendingEncounterRoomId = saved.pendingEncounterRoomId || '';
    globalMapState.pendingEncounterWorldZoneId = String(saved.pendingEncounterWorldZoneId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    globalMapState.pendingEncounterWorldPartyId = String(saved.pendingEncounterWorldPartyId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    globalMapState.pendingEncounterWorldPoint = saved.pendingEncounterWorldPoint
      ? globalMapSavedPoint(saved.pendingEncounterWorldPoint)
      : null;
    globalMapState.pendingWorldDrop = sanitizeGlobalMapPendingDrop(saved.pendingWorldDrop);
    globalMapState.currentWorldSiteId = String(saved.currentWorldSiteId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    globalMapState.attachedPartyId = String(saved.attachedPartyId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    globalMapState.attachedPartyTaskId = String(saved.attachedPartyTaskId || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 120);
    const savedTravelLeaderId = String(saved.travelLeaderId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const savedTravelLeaderName = String(saved.travelLeaderName || '').slice(0, 80);
    globalMapState.lastEntryCircle = sanitizeGlobalMapEntryCircle(saved.lastEntryCircle);
    const restoredTravel = restoreGlobalMapTravel(saved.travel);
    if (restoredTravel
      && previousTravel
      && restoredTravel.serverAuthoritative
      && previousTravel.serverAuthoritative
      && restoredTravel.travelId
      && restoredTravel.travelId === previousTravel.travelId) {
      restoredTravel.progress = Math.max(restoredTravel.progress, globalMapClamp01(previousTravel.progress));
      restoredTravel.prevProgress = restoredTravel.progress;
    }
    globalMapState.travel = restoredTravel;
    globalMapState.encounter = globalMapState.travel ? restoreGlobalMapEncounter(saved.encounter) : null;
    globalMapState.party = globalMapPartySnapshot();

    const active = !!saved.onWorldMap;
    globalMapState.onWorldMap = active;
    const localLeaderId = active && !globalMapState.attachedPartyId
      && multiplayer?.socket?.connected && multiplayer.joined
      ? globalMapLocalSocketId()
      : '';
    globalMapSetTravelLeader(
      active ? (savedTravelLeaderId || localLeaderId) : '',
      active ? (savedTravelLeaderName || (localLeaderId ? (characterProfile?.name || player?.name || 'Игрок') : '')) : ''
    );
    if (active) {
      if (!globalMapState.travel && !globalMapState.encounter) {
        const settlement = globalMapSettlementAt(playerPoint.x, playerPoint.y);
        if (settlement) {
          globalMapState.fromLocationId = settlement.id;
          globalMapState.pendingWorldDrop = null;
        }
      }
      if (typeof closeAllWindows === 'function') closeAllWindows(false);
      setGlobalMapMiniGameActive(true);
      focusGlobalMapCameraOnRoute();
      renderGlobalMapPanel();
      renderGlobalEncounterPanel();
    } else {
      setGlobalMapMiniGameActive(false);
      renderGlobalEncounterPanel();
    }
    return active;
  }

  function globalMapDistance(a, b) {
    const left = globalMapNode(a);
    const right = globalMapNode(b);
    return Math.hypot(Number(left.x || 0) - Number(right.x || 0), Number(left.y || 0) - Number(right.y || 0));
  }

  function globalMapCellCenter(cx, cy) {
    return {
      x: (cx + 0.5) * GLOBAL_MAP_GRID.cellPoints,
      y: (cy + 0.5) * GLOBAL_MAP_GRID.cellPoints
    };
  }

  function globalMapPointCell(x, y) {
    const p = clampGlobalMapPoint(x, y);
    return {
      cx: Math.max(0, Math.min(GLOBAL_MAP_GRID.cols - 1, Math.floor(p.x / GLOBAL_MAP_GRID.cellPoints))),
      cy: Math.max(0, Math.min(GLOBAL_MAP_GRID.rows - 1, Math.floor(p.y / GLOBAL_MAP_GRID.cellPoints)))
    };
  }

  function globalMapCellCenterPoint(point = {}) {
    const cell = globalMapPointCell(point.x, point.y);
    return {
      x: Math.round((cell.cx + 0.5) * GLOBAL_MAP_GRID.cellPoints),
      y: Math.round((cell.cy + 0.5) * GLOBAL_MAP_GRID.cellPoints)
    };
  }

  function prepareGlobalMap3DRayFromClient(clientX, clientY) {
    if (globalMap3dCanvas && ensureGlobalMap3D()) {
      resizeGlobalMap3D();
      const rect3d = globalMap3dCanvas.getBoundingClientRect();
      if (!rect3d.width || !rect3d.height) return false;
      const mx = ((clientX - rect3d.left) / rect3d.width) * 2 - 1;
      const my = -(((clientY - rect3d.top) / rect3d.height) * 2 - 1);
      if (mx < -1 || mx > 1 || my < -1 || my > 1) return false;
      GLOBAL_MAP_3D.raycaster.setFromCamera({ x: mx, y: my }, GLOBAL_MAP_3D.camera);
      return true;
    }
    return false;
  }

  function globalMapWorldPartyIdFromObject(object = null) {
    let node = object;
    while (node) {
      if (node.userData?.ignoreWorldPartyPick) return '';
      const partyId = String(node.userData?.partyId || node.userData?.worldPartyId || '').trim();
      if (partyId) return partyId;
      node = node.parent || null;
    }
    return '';
  }

  function tagGlobalMapWorldPartyObject(root = null, partyId = '') {
    const id = String(partyId || '').trim();
    if (!root || !id) return;
    root.userData.partyId = id;
    root.userData.worldPartyId = id;
    if (typeof root.traverse === 'function') {
      root.traverse(child => {
        if (!child) return;
        child.userData.partyId = id;
        child.userData.worldPartyId = id;
      });
    }
  }

  function globalMapWorldScreenDistanceToPoint(clientX, clientY, point = {}, lift = 0.5) {
    if (!globalMap3dCanvas || !GLOBAL_MAP_3D.camera || typeof globalMap3DWorldPoint !== 'function') return null;
    const rect3d = globalMap3dCanvas.getBoundingClientRect();
    if (!rect3d.width || !rect3d.height) return null;
    const pos = globalMap3DWorldPoint(clampGlobalMapPoint(point.x, point.y), lift);
    const projected = pos.project(GLOBAL_MAP_3D.camera);
    if (projected.z < -1 || projected.z > 1) return null;
    const sx = rect3d.left + (projected.x * 0.5 + 0.5) * rect3d.width;
    const sy = rect3d.top + (-projected.y * 0.5 + 0.5) * rect3d.height;
    return {
      x: sx,
      y: sy,
      distance: Math.hypot(Number(clientX || 0) - sx, Number(clientY || 0) - sy)
    };
  }

  function globalMapWorldPartyScreenPickRadiusPx(party = {}) {
    const centerPoint = clampGlobalMapPoint(globalMapWorldPartyDisplayPoint(party));
    const visualRadius = Math.max(0, globalMapWorldPartyVisualRadiusPoints(party));
    const center = globalMapWorldScreenDistanceToPoint(0, 0, centerPoint, 0.48);
    const edgePoint = clampGlobalMapPoint(centerPoint.x + visualRadius, centerPoint.y);
    const edge = globalMapWorldScreenDistanceToPoint(0, 0, edgePoint, 0.48);
    if (center && edge) {
      const projectedRadius = Math.hypot(edge.x - center.x, edge.y - center.y);
      return Math.max(10, Math.min(46, projectedRadius + 3));
    }
    return Math.max(10, Math.min(32, visualRadius * 2));
  }

  function globalMapWorldPartyFromScreenDistance(clientX, clientY) {
    const group = GLOBAL_MAP_3D.dynamicCache?.worldParties;
    const cursorX = Number(clientX || 0);
    const cursorY = Number(clientY || 0);
    const pos = new THREE.Vector3();
    let best = null;
    let bestDist = Infinity;
    if (group && globalMap3dCanvas && GLOBAL_MAP_3D.camera) {
      const rect3d = globalMap3dCanvas.getBoundingClientRect();
      if (rect3d.width && rect3d.height) {
        group.children.forEach(marker => {
          const partyId = String(marker?.userData?.partyId || marker?.userData?.worldPartyId || '').trim();
          if (!partyId) return;
          const party = globalMapWorldPartyById(partyId);
          if (!globalMapWorldPartyVisibleOnMap(party)) return;
          marker.getWorldPosition(pos);
          const projected = pos.clone().project(GLOBAL_MAP_3D.camera);
          if (projected.z < -1 || projected.z > 1) return;
          const sx = rect3d.left + (projected.x * 0.5 + 0.5) * rect3d.width;
          const sy = rect3d.top + (-projected.y * 0.5 + 0.5) * rect3d.height;
          const pickRadius = globalMapWorldPartyScreenPickRadiusPx(party);
          const dist = Math.hypot(cursorX - sx, cursorY - sy);
          if (dist <= pickRadius && dist < bestDist) {
            best = party;
            bestDist = dist;
          }
        });
      }
    }
    (Array.isArray(WASTELAND_SIM_STATE.parties) ? WASTELAND_SIM_STATE.parties : [])
      .filter(row => globalMapWorldPartyVisibleOnMap(row))
      .forEach(party => {
        const point = globalMapWorldPartyDisplayPoint(party);
        const distances = [0.48, 1.05, 1.55]
          .map(lift => globalMapWorldScreenDistanceToPoint(cursorX, cursorY, point, lift))
          .filter(Boolean);
        if (!distances.length) return;
        const dist = Math.min(...distances.map(row => row.distance));
        const pickRadius = globalMapWorldPartyScreenPickRadiusPx(party);
        if (dist <= pickRadius && dist < bestDist) {
          best = party;
          bestDist = dist;
        }
      });
    return best;
  }

  function globalMapWorldPartyFromClient(clientX, clientY) {
    if (!prepareGlobalMap3DRayFromClient(clientX, clientY)) return null;
    const group = GLOBAL_MAP_3D.dynamicCache?.worldParties;
    if (group) {
      const hits = GLOBAL_MAP_3D.raycaster.intersectObject(group, true);
      for (const hit of hits) {
        const partyId = globalMapWorldPartyIdFromObject(hit?.object || null);
        const party = partyId ? globalMapWorldPartyById(partyId) : null;
        if (party) return party;
      }
    }
    return globalMapWorldPartyFromScreenDistance(clientX, clientY);
  }

  function globalMapPointFromClient(clientX, clientY) {
    if (prepareGlobalMap3DRayFromClient(clientX, clientY)) {
      const hits = GLOBAL_MAP_3D.terrain ? GLOBAL_MAP_3D.raycaster.intersectObject(GLOBAL_MAP_3D.terrain, false) : [];
      if (hits.length) return globalMapPointFromWorld(hits[0].point.x, hits[0].point.z);
    }
    if (!globalMapCanvas) return null;
    const rect = (globalMapSurface || globalMapCanvas).getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    if (relX < 0 || relY < 0 || relX > 1 || relY > 1) return null;
    return clampGlobalMapPoint(relX * GLOBAL_MAP_SIZE.width, relY * GLOBAL_MAP_SIZE.height);
  }

  function hideGlobalMapCursor() {
    if (!globalMapCursor) return;
    globalMapCursor.classList.remove('visible', 'flip-x', 'flip-y');
  }

  function setGlobalMapPanningCursor(active) {
    document.body.classList.toggle('global-map-panning', !!active);
    if (active) hideGlobalMapCursor();
  }

  function updateGlobalMapCursor(e) {
    if (!globalMapCursor || !globalMapCanvas || !document.body.classList.contains('global-map-mode')) {
      hideGlobalMapCursor();
      return;
    }
    if (GLOBAL_MAP_3D.dragging) {
      hideGlobalMapCursor();
      return;
    }
    const pickedParty = globalMapWorldPartyFromClient(e.clientX, e.clientY);
    const point = pickedParty
      ? clampGlobalMapPoint(globalMapWorldPartyDisplayPoint(pickedParty))
      : globalMapPointFromClient(e.clientX, e.clientY);
    if (!point) {
      hideGlobalMapCursor();
      return;
    }
    const cell = globalMapPointCell(point.x, point.y);
    const worldParty = pickedParty || globalMapWorldPartyAt(point.x, point.y);
    const settlement = worldParty ? null : globalMapSettlementAt(point.x, point.y);
    const worldSite = worldParty || settlement ? null : globalMapWorldSiteAt(point.x, point.y);
    const settlementSite = settlement ? globalMapWorldSiteById(settlement.id) : null;
    const cursorWorldSite = worldSite || settlementSite;
    const cursorHotspot = cursorWorldSite ? globalMapWorldSiteHotspot(cursorWorldSite) : null;
    const profile = worldParty || settlement || worldSite ? null : globalMapCellProfile(cell.cx, cell.cy);
    const title = worldParty
      ? (worldParty.name || globalMapWorldPartyKindLabel(worldParty.kind))
      : settlement
      ? globalMapLocationName(settlement.id)
      : worldSite
        ? globalMapWorldSiteTitle(worldSite)
        : (profile?.terrain || 'Пустошь');
    const noteText = worldParty
      ? globalMapWorldPartyStatus(worldParty)
      : settlement && settlement.note
      ? [String(settlement.note).trim(), globalMapWorldSiteMarketLine(settlementSite)].filter(Boolean).join(' ')
      : worldSite
        ? globalMapWorldSiteDescription(worldSite)
        : '';
    const kindText = worldParty
      ? `${globalMapWorldPartyKindLabel(worldParty.kind)} · ${globalMapFactionLabel(worldParty.faction || '')}`
      : settlementSite
        ? globalMapWorldSiteKindLabel(settlementSite)
      : worldSite
        ? globalMapWorldSiteKindLabel(worldSite)
        : '';
    const cursorResourceNames = cursorWorldSite
      ? Object.entries(cursorWorldSite.output || {})
        .filter(([, amount]) => Number(amount || 0) > 0)
        .map(([id]) => globalMapResourceLabel(id))
        .join(', ')
      : '';
    const extraRows = worldParty ? [
      ['Охрана', Math.round(Number(worldParty.escortPower || worldParty.strength || 0))],
      ['Риск', `${Math.round(Number(worldParty.riskLevel || 0))}%${worldParty.riskLabel ? ` · ${worldParty.riskLabel}` : ''}`],
      ['Груз', worldParty.cargoSummary && worldParty.cargoSummary !== 'нет груза' ? worldParty.cargoSummary : 'пусто']
    ] : cursorWorldSite ? [
      ...(cursorHotspot ? [['Обстановка', cursorHotspot.labels.join(', ')]] : []),
      ['Владелец', cursorWorldSite.ownerLabel || globalMapFactionLabel(cursorWorldSite.owner || 'neutral')],
      ['Контроль', cursorWorldSite.controlStateLabel || 'стабильно'],
      ...(cursorWorldSite.marketStateLabel ? [['Рынок', cursorWorldSite.marketStateLabel]] : []),
      ...(cursorResourceNames ? [['Можно добыть', cursorResourceNames]] : []),
      ...(cursorWorldSite.output && Object.keys(cursorWorldSite.output || {}).length ? [['Активность', `${Math.round(Number(cursorWorldSite.resourceActivity || 0))}%`]] : []),
      ...(cursorWorldSite.production && Object.keys(cursorWorldSite.production || {}).length ? [['Производство', globalMapResourceSummary(cursorWorldSite.production || {}, 3) || 'нет']] : []),
      ...(cursorWorldSite.workSummary ? [['Работают', cursorWorldSite.workSummary]] : []),
      ['Запасы', globalMapResourceSummary(cursorWorldSite.stockpile || {}, 2) || 'пусто'],
      ...(cursorWorldSite.controlThreatName ? [['Угроза', `${cursorWorldSite.controlThreatName}${Number(cursorWorldSite.controlThreatDistanceKm || 0) ? ` · ${Number(cursorWorldSite.controlThreatDistanceKm || 0).toFixed(1).replace('.', ',')} км` : ''}`]] : []),
      ...(cursorWorldSite.productionNeedSummary ? [['Нужно', `${globalMapProductionNeedLabel(cursorWorldSite.productionNeedReason)}: ${cursorWorldSite.productionNeedSummary}`]] : [])
    ] : [];
    const pointText = `${Math.round(point.x)}:${Math.round(point.y)}`;
    const cellText = `${cell.cx + 1}:${cell.cy + 1}`;
    const contentKey = `${title}|${cellText}|${pointText}|${noteText}|${kindText}|${extraRows.map(row => row.join(':')).join('|')}`;
    if (globalMapCursor.dataset.contentKey !== contentKey) {
      globalMapCursor.dataset.contentKey = contentKey;
      globalMapCursor.innerHTML = `
        <div class="global-map-cursor-card">
          <div class="global-map-cursor-title">${escapeHtml(title)}</div>
          ${kindText ? `<div><span>Тип</span><b>${escapeHtml(kindText)}</b></div>` : ''}
          ${extraRows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('')}
          ${noteText ? `<p class="global-map-cursor-note">${escapeHtml(noteText)}</p>` : ''}
          <div><span>Клетка</span><b>${cellText}</b></div>
          <div><span>Точка</span><b>${pointText}</b></div>
        </div>
      `;
    }
    const surface = globalMapSurface || globalMapCanvas;
    const hostRect = surface.parentElement?.getBoundingClientRect() || surface.getBoundingClientRect();
    const localX = e.clientX - hostRect.left;
    const localY = e.clientY - hostRect.top;
    globalMapCursor.style.left = `${localX}px`;
    globalMapCursor.style.top = `${localY}px`;
    globalMapCursor.classList.add('visible');
    globalMapCursor.classList.toggle('flip-x', localX > hostRect.width - (noteText ? 320 : 230));
    globalMapCursor.classList.toggle('flip-y', localY > hostRect.height - (noteText ? 170 : 112));
  }

  function globalMapNodeCell(id = '') {
    const node = globalMapNode(id);
    return globalMapPointCell(node.x, node.y);
  }

  function globalMapCellOverride(cx, cy) {
    return GLOBAL_MAP_CELL_OVERRIDES.get(`${cx}:${cy}`) || null;
  }

  function applyGlobalMapCellOverride(cx, cy, profile = {}) {
    const override = globalMapCellOverride(cx, cy);
    if (!override) {
      return {
        ...profile,
        pvpMode: normalizeGlobalMapPvpMode(profile.pvpMode || 'pvp')
      };
    }
    const encounterWeights = Array.isArray(override.encounters) && override.encounters.length
      ? override.encounters.reduce((acc, row) => {
          acc[row.id] = Math.max(0, Number(row.weight || 0));
          return acc;
        }, {})
      : (profile.weights || {});
    const randomLocations = Array.isArray(override.randomLocations) && override.randomLocations.length
      ? override.randomLocations
      : profile.randomLocations;
    return {
      ...profile,
      terrain: override.terrain || profile.terrain,
      chance: Number.isFinite(Number(override.chance)) ? Number(override.chance) : profile.chance,
      difficulty: Number.isFinite(Number(override.difficulty)) ? Number(override.difficulty) : profile.difficulty,
      fill: override.fill || profile.fill,
      texture: override.texture || profile.texture || '',
      pvpMode: normalizeGlobalMapPvpMode(override.pvpMode || profile.pvpMode || 'pvp'),
      weights: encounterWeights,
      randomLocations
    };
  }

  function globalMapCellProfile(cx, cy) {
    const ridge = Math.sin(cx * 0.72 + cy * 0.31) + Math.cos(cx * 0.22 - cy * 0.63);
    const center = globalMapCellCenter(cx, cy);
    const nx = (cx + 0.5) / GLOBAL_MAP_GRID.cols;
    const ny = (cy + 0.5) / GLOBAL_MAP_GRID.rows;
    const nearSettlement = GLOBAL_MAP_NODES
      .filter(node => node.kind === 'settlement')
      .some(node => Math.hypot(center.x - node.x, center.y - node.y) < globalMapSettlementRadius(node) + 45);
    const coastEdge = globalMapNormIsOcean(nx, ny);
    const coast = nx < globalMapCoastNormXAtY(ny) + 0.065 && ny > 0.10;
    const dryLake =
      ((nx - 0.315) ** 2) / (0.080 ** 2) + ((ny - 0.215) ** 2) / (0.040 ** 2) < 1 ||
      ((nx - 0.595) ** 2) / (0.095 ** 2) + ((ny - 0.560) ** 2) / (0.052 ** 2) < 1 ||
      ((nx - 0.385) ** 2) / (0.070 ** 2) + ((ny - 0.805) ** 2) / (0.040 ** 2) < 1;
    const oldRoad = Math.abs(cy - (18 + Math.sin(cx * 0.45) * 2.2)) < 1.15 ||
      Math.abs(cx - 18) < 1.0 ||
      Math.abs((ny - 0.64) - (nx - 0.30) * 0.25) < 0.030;
    if (nearSettlement) {
      return applyGlobalMapCellOverride(cx, cy, {
        terrain: 'окрестности поселения',
        chance: GLOBAL_MAP_CHANCE.rare,
        difficulty: 1,
        fill: 'rgba(76,103,48,0.22)',
        texture: 'green_lowland',
        weights: { peaceful_caravan: 7, caravan_patrol_vs_ghouls: 2, radscorpions_vs_patrol: 2, ghoul_pack: 1, gecko_pack: 1 }
      });
    }
    if (coastEdge) {
      return applyGlobalMapCellOverride(cx, cy, {
        terrain: 'океанский берег',
        chance: GLOBAL_MAP_CHANCE.none,
        difficulty: 1,
        fill: 'rgba(40,68,66,0.34)',
        texture: 'salt_flat',
        weights: { peaceful_caravan: 1 }
      });
    }
    if (dryLake) {
      return applyGlobalMapCellOverride(cx, cy, {
        terrain: 'высохшее озеро',
        chance: GLOBAL_MAP_CHANCE.rare,
        difficulty: 2,
        fill: 'rgba(193,171,111,0.24)',
        texture: 'dry_lake',
        weights: { peaceful_caravan: 3, mutant_ant_swarm: 4, radscorpion_nest: 3, gecko_pack: 2, ants_vs_geckos: 2, ghoul_pack: 1 }
      });
    }
    if (coast) {
      return applyGlobalMapCellOverride(cx, cy, {
        terrain: 'прибрежный солончак',
        chance: GLOBAL_MAP_CHANCE.rare,
        difficulty: 2,
        fill: 'rgba(107,93,63,0.28)',
        texture: 'salt_flat',
        weights: { peaceful_caravan: 4, gecko_pack: 4, fire_gecko_ambush: 1, ghoul_pack: 1 }
      });
    }
    if (oldRoad) {
      return applyGlobalMapCellOverride(cx, cy, {
        terrain: 'старая трасса',
        chance: GLOBAL_MAP_CHANCE.common,
        difficulty: 2,
        fill: 'rgba(101,91,58,0.28)',
        texture: 'old_road',
        weights: { peaceful_caravan: 5, caravan_patrol_vs_ghouls: 4, radscorpions_vs_patrol: 3, gecko_pack: 2, mutant_ant_swarm: 2, ghoul_pack: 2 }
      });
    }
    if (ridge > 0.72) {
      return applyGlobalMapCellOverride(cx, cy, {
        terrain: 'горный проход',
        chance: GLOBAL_MAP_CHANCE.common,
        difficulty: 3,
        fill: 'rgba(111,101,78,0.30)',
        texture: 'rocky_hills',
        weights: { radscorpion_nest: 5, fire_gecko_ambush: 4, ghoul_pack: 3, radscorpions_vs_patrol: 2, caravan_patrol_vs_ghouls: 2, peaceful_caravan: 1 }
      });
    }
    if (ridge < -0.86) {
      return applyGlobalMapCellOverride(cx, cy, {
        terrain: 'мёртвая низина',
        chance: GLOBAL_MAP_CHANCE.frequent,
        difficulty: 4,
        fill: 'rgba(46,59,42,0.22)',
        texture: 'green_lowland',
        weights: { ghoul_pack: 5, mutant_ant_swarm: 4, radscorpion_nest: 3, ants_vs_geckos: 2, caravan_patrol_vs_ghouls: 1 }
      });
    }
    return applyGlobalMapCellOverride(cx, cy, {
      terrain: 'пустошь',
      chance: GLOBAL_MAP_CHANCE.uncommon,
      difficulty: 2,
      fill: 'rgba(126,94,50,0.16)',
      texture: 'wasteland_dust',
      weights: { ghoul_pack: 3, peaceful_caravan: 3, caravan_patrol_vs_ghouls: 2, gecko_pack: 3, mutant_ant_swarm: 3, radscorpion_nest: 2, ants_vs_geckos: 1, radscorpions_vs_patrol: 1 }
    });
  }

  function globalMapRouteCells(fromId, toId) {
    const from = globalMapNodeCell(fromId);
    const to = globalMapNodeCell(toId);
    return globalMapRouteCellsBetweenCells(from, to);
  }

  function globalMapRouteCellsBetweenPoints(fromPoint = {}, toPoint = {}) {
    const from = globalMapPointCell(fromPoint.x, fromPoint.y);
    const to = globalMapPointCell(toPoint.x, toPoint.y);
    return globalMapRouteCellsBetweenCells(from, to);
  }

  function globalMapRouteCellsBetweenCells(from, to) {
    const steps = Math.max(Math.abs(to.cx - from.cx), Math.abs(to.cy - from.cy), 1) * 2 + 1;
    const cells = [];
    const seen = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.max(0, Math.min(GLOBAL_MAP_GRID.cols - 1, Math.round(from.cx + (to.cx - from.cx) * t)));
      const cy = Math.max(0, Math.min(GLOBAL_MAP_GRID.rows - 1, Math.round(from.cy + (to.cy - from.cy) * t)));
      const key = `${cx}:${cy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ cx, cy, ...globalMapCellProfile(cx, cy) });
    }
    return cells;
  }

  function globalMapRouteCellsAlongPoints(points = []) {
    const cells = [];
    const seen = new Set();
    const route = Array.isArray(points) ? points : [];
    for (let index = 1; index < route.length; index++) {
      globalMapRouteCellsBetweenPoints(route[index - 1], route[index]).forEach(cell => {
        const key = `${cell.cx}:${cell.cy}`;
        if (seen.has(key)) return;
        seen.add(key);
        cells.push(cell);
      });
    }
    return cells;
  }

  function globalMapRouteProfile(fromId, toId) {
    return globalMapRouteProfileFromCells(globalMapRouteCells(fromId, toId));
  }

  function globalMapRouteProfileBetweenPoints(fromPoint = {}, toPoint = {}) {
    return globalMapRouteProfileFromCells(globalMapRouteCellsBetweenPoints(fromPoint, toPoint));
  }

  function globalMapRouteProfileAlongPoints(points = []) {
    return globalMapRouteProfileFromCells(globalMapRouteCellsAlongPoints(points));
  }

  function globalMapWastelandInfluenceAtPoint(point = {}) {
    const zones = Array.isArray(WASTELAND_SIM_STATE.threatZones) ? WASTELAND_SIM_STATE.threatZones : [];
    const result = {
      chanceBonus: 0,
      difficultyBonus: 0,
      weights: {},
      sources: []
    };
    zones.forEach(zone => {
      if (!zone) return;
      const radiusPoints = Math.max(
        1,
        Number(zone.radiusPoints || 0) || Number(zone.radiusKm || 0) / GLOBAL_MAP_POINT_KM
      );
      const dist = globalMapPointDistance(point, zone);
      if (!Number.isFinite(dist) || dist > radiusPoints) return;
      const power = 1 - dist / radiusPoints;
      const chanceBonus = Number(zone.chanceBonus || 0) * power;
      const difficultyBonus = Number(zone.difficultyBonus || 0) * power;
      result.chanceBonus += chanceBonus;
      result.difficultyBonus += difficultyBonus;
      Object.entries(zone.weights || {}).forEach(([id, weight]) => {
        result.weights[id] = (result.weights[id] || 0) + Math.max(0, Number(weight || 0) * power);
      });
      if (Math.abs(chanceBonus) >= 0.006 || Math.abs(difficultyBonus) >= 0.08) {
        result.sources.push({
          id: zone.id || zone.sourceId || '',
          name: zone.name || zone.label || zone.kind || '',
          kind: zone.kind || '',
          label: zone.label || '',
          power,
          chanceBonus,
          difficultyBonus
        });
      }
    });
    result.chanceBonus = Math.max(-0.14, Math.min(0.34, result.chanceBonus));
    result.difficultyBonus = Math.max(-0.8, Math.min(1.8, result.difficultyBonus));
    result.sources.sort((a, b) => Math.abs(b.chanceBonus) + Math.abs(b.difficultyBonus) - Math.abs(a.chanceBonus) - Math.abs(a.difficultyBonus));
    return result;
  }

  function mergeGlobalMapWeights(target = {}, source = {}, mul = 1) {
    Object.entries(source || {}).forEach(([id, weight]) => {
      const amount = Math.max(0, Number(weight || 0) * Number(mul || 1));
      if (amount > 0) target[id] = (target[id] || 0) + amount;
    });
    return target;
  }

  function globalMapRouteProfileFromCells(cells = []) {
    const weights = {};
    let chanceSum = 0;
    let difficultySum = 0;
    let maxDifficulty = 1;
    let safeRouteChance = 1;
    const cellEncounterChances = [];
    const influenceSources = [];
    cells.forEach(cell => {
      const influence = globalMapWastelandInfluenceAtPoint(globalMapCellCenter(cell.cx, cell.cy));
      const cellChanceScore = Math.max(0, Number(cell.chance || 0) + influence.chanceBonus * 100);
      const cellDifficulty = Math.max(1, Math.min(5, Number(cell.difficulty || 1) + influence.difficultyBonus));
      const effectiveCell = {
        ...cell,
        chance: cellChanceScore,
        difficulty: cellDifficulty,
        wastelandInfluence: influence
      };
      chanceSum += cellChanceScore;
      difficultySum += cellDifficulty;
      maxDifficulty = Math.max(maxDifficulty, cellDifficulty);
      mergeGlobalMapWeights(weights, cell.weights);
      mergeGlobalMapWeights(weights, influence.weights);
      const cellChance = globalMapEncounterChanceForCell(effectiveCell);
      cellEncounterChances.push(cellChance);
      safeRouteChance *= (1 - cellChance);
      influence.sources.forEach(source => influenceSources.push(source));
    });
    const avgChance = cells.length ? chanceSum / cells.length : GLOBAL_MAP_CHANCE.rare;
    const avgDifficulty = cells.length ? difficultySum / cells.length : 1;
    const routeChance = 1 - Math.max(0, Math.min(1, safeRouteChance));
    const chance = Math.max(cellEncounterChances.some(v => v > 0) ? 0.025 : 0, Math.min(0.88, routeChance));
    return {
      cells,
      weights,
      chance,
      difficulty: Math.max(1, Math.min(5, Math.round(avgDifficulty + maxDifficulty * 0.18))),
      avgChance,
      cellEncounterChances,
      influenceSources: influenceSources.slice(0, 8)
    };
  }

  function globalMapPartySnapshot() {
    const rows = [{
      id: multiplayer?.socket?.id || characterProfile?.serverCharacterId || 'self',
      name: characterProfile?.name || player.name || 'Вы',
      leader: true,
      distance: 0
    }];
    if (multiplayer?.remotePlayers) {
      multiplayer.remotePlayers.forEach(row => {
        if (!row?.data?.id || row.group?.visible === false) return;
        const x = row.group?.position?.x ?? row.data.x;
        const z = row.group?.position?.z ?? row.data.z;
        const distance = Math.hypot(Number(x || 0) - player.x, Number(z || 0) - player.z);
        if (distance <= 8.5) rows.push({ id: row.data.id, name: row.data.name || 'Игрок', leader: false, distance });
      });
    }
    return rows;
  }

  function globalTravelDuration(fromId, toId) {
    const dist = globalMapDistance(fromId, toId);
    return globalTravelDurationByDistance(dist);
  }

  function globalMapWandererNorm() {
    return typeof skillNorm === 'function' ? Math.max(0, Math.min(1, skillNorm('wanderer'))) : 0;
  }

  function globalMapEncounterChanceForCell(cell = {}) {
    const terrainChance = Math.max(0, Number(cell.chance || 0)) / 100;
    if (terrainChance <= 0) return 0;
    const difficulty = Math.max(1, Math.min(5, Number(cell.difficulty || 1)));
    const wandererFactor = 1 - globalMapWandererNorm() * 0.22;
    const luckFactor = 1 - (typeof statValue === 'function' ? Math.max(0, Math.min(10, statValue('luck') - 5)) * 0.012 : 0);
    const rawChance = terrainChance * 0.95 + difficulty * 0.024;
    return Math.max(0.045, Math.min(0.38, rawChance * wandererFactor * luckFactor));
  }

  function globalMapEncounterProfileForCell(cell = {}, routeProfile = null) {
    const influence = Number.isFinite(Number(cell?.cx)) && Number.isFinite(Number(cell?.cy))
      ? globalMapWastelandInfluenceAtPoint(globalMapCellCenter(cell.cx, cell.cy))
      : { chanceBonus: 0, difficultyBonus: 0, weights: {} };
    const weights = {};
    mergeGlobalMapWeights(weights, routeProfile?.weights || {});
    mergeGlobalMapWeights(weights, cell?.weights || {});
    mergeGlobalMapWeights(weights, influence.weights || {});
    return {
      ...(routeProfile || {}),
      cells: cell ? [cell] : (routeProfile?.cells || []),
      weights,
      difficulty: Math.max(1, Math.min(5, Math.round(Number(cell?.difficulty || routeProfile?.difficulty || 2) + Number(influence.difficultyBonus || 0)))),
      avgChance: Math.max(0, Number(cell?.chance ?? routeProfile?.avgChance ?? GLOBAL_MAP_CHANCE.uncommon) + Number(influence.chanceBonus || 0) * 100),
      influenceSources: influence.sources || routeProfile?.influenceSources || []
    };
  }

  function globalMapTravelSpeedKmh() {
    const norm = globalMapWandererNorm();
    return GLOBAL_MAP_MIN_SPEED_KMH + (GLOBAL_MAP_MAX_SPEED_KMH - GLOBAL_MAP_MIN_SPEED_KMH) * norm;
  }

  function globalMapTravelInfoByDistance(dist) {
    const distancePoints = Math.max(0, Number(dist || 0));
    const distanceKm = distancePoints * GLOBAL_MAP_POINT_KM;
    const speedKmh = globalMapTravelSpeedKmh();
    const worldHours = speedKmh > 0 ? distanceKm / speedKmh : 0;
    return {
      distancePoints,
      distanceKm,
      speedKmh,
      worldHours,
      wanderer: globalWandererPercent(),
      realSeconds: distanceKm <= 0.001 ? 0 : Math.max(0.1, worldHours * 3600 / GLOBAL_MAP_TIME_COMPRESSION)
    };
  }

  function formatGlobalMapNumber(value, digits = 1) {
    return Number(value || 0).toFixed(digits).replace('.', ',');
  }

  function formatGlobalTravelRealTime(seconds) {
    const total = Math.max(0, Math.ceil(Number(seconds || 0)));
    if (total < 60) return `${total} сек.`;
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return sec ? `${min} мин ${sec} сек.` : `${min} мин`;
  }

  function formatGlobalTravelWorldTime(hours) {
    const totalMinutes = Math.max(0, Math.round(Number(hours || 0) * 60));
    if (totalMinutes < 60) return `${totalMinutes} мин`;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }

  function globalTravelDurationByDistance(dist) {
    return globalMapTravelInfoByDistance(dist).realSeconds;
  }

  function globalEncounterChance(fromId, toId) {
    return globalMapRouteProfile(fromId, toId).chance;
  }

  function pickGlobalEncounter(profile = null) {
    const weights = profile?.weights || {};
    const entries = GLOBAL_ENCOUNTERS
      .map(encounter => ({ encounter, weight: Math.max(0, Number(weights[encounter.id] || 0)) }))
      .filter(row => row.weight > 0);
    const pool = entries.length ? entries : GLOBAL_ENCOUNTERS.map(encounter => ({ encounter, weight: 1 }));
    const total = pool.reduce((sum, row) => sum + row.weight, 0) || 1;
    let roll = Math.random() * total;
    for (const row of pool) {
      roll -= row.weight;
      if (roll <= 0) return row.encounter;
    }
    return pool[pool.length - 1]?.encounter || GLOBAL_ENCOUNTERS[0];
  }

  function globalWandererPercent() {
    if (typeof skillPercent === 'function') return Math.max(0, Math.round(skillPercent('wanderer')));
    if (typeof skillNorm === 'function') return Math.max(0, Math.round(skillNorm('wanderer') * 100));
    return 0;
  }

  function globalEncounterChoiceInfo(profile = null) {
    const difficulty = Math.max(1, Math.min(5, Number(profile?.difficulty || 2)));
    const required = Math.max(15, Math.min(95, Math.round(18 + difficulty * 13 + Number(profile?.avgChance || 0) * 0.35)));
    const wanderer = globalWandererPercent();
    return {
      required,
      wanderer,
      canChoose: wanderer >= required
    };
  }

  function globalWandererCheckXp(choice = {}, profile = null) {
    if (!choice?.canChoose) return 0;
    const difficulty = Math.max(1, Math.min(5, Math.round(Number(profile?.difficulty || 2))));
    const margin = Math.max(0, Math.floor(Number(choice.wanderer || 0) - Number(choice.required || 0)));
    return Math.max(8, Math.min(35, 8 + difficulty * 4 + Math.floor(margin / 12)));
  }

  function awardGlobalWandererCheckXp(encounter = null, choice = {}, profile = null) {
    if (!encounter || encounter.wandererXpAwarded || !choice?.canChoose) return 0;
    const xp = globalWandererCheckXp(choice, profile);
    if (xp <= 0) return 0;
    encounter.wandererXpAwarded = true;
    if (typeof awardCharacterActionXp === 'function') {
      awardCharacterActionXp(xp, 'Странник: успешная проверка');
    } else if (player) {
      player.xp = Math.max(0, Number(player.xp || 0)) + xp;
      if (typeof createFloatingText === 'function') createFloatingText(player.x, player.z, '+' + xp + ' XP', '#e4c56b');
      if (typeof addLog === 'function') addLog(`Странник: успешная проверка: +${xp} XP.`, null, 'level');
      if (typeof checkLevelUp === 'function') checkLevelUp();
      if (typeof queueSave === 'function') queueSave(true);
    }
    return xp;
  }
