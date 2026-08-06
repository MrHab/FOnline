  // ===== WEAPON MODIFICATION WORKBENCH =====
  const WEAPON_MODIFICATION_SLOT_META = Object.freeze({
    barrel: { id: 'barrel', label: 'Ствол', short: 'СТВОЛ', anchor: 'left-top' },
    scope: { id: 'scope', label: 'Прицел', short: 'ПРИЦЕЛ', anchor: 'right-top' },
    magazine: { id: 'magazine', label: 'Магазин', short: 'МАГАЗИН', anchor: 'right-bottom' },
    forend: { id: 'forend', label: 'Цевьё', short: 'ЦЕВЬЁ', anchor: 'left-bottom' }
  });

  const WEAPON_MODIFICATION_CATALOG = Object.freeze({
    barrel_precision: {
      id: 'barrel_precision', slot: 'barrel', name: 'Прецизионный ствол', icon: '◎',
      weaponIds: ['pistol', 'rifle', 'assaultRifle', 'machineGun'],
      cost: { scrap: 3, weaponParts: 2 },
      effects: { damageMul: 1.06, rangeMul: 1.12, fireRateMul: 1.05 },
      desc: 'Повышает урон и дальность, но немного замедляет следующий выстрел.'
    },
    barrel_suppressor: {
      id: 'barrel_suppressor', slot: 'barrel', name: 'Самодельный глушитель', icon: '▰',
      weaponIds: ['pistol', 'rifle', 'assaultRifle'],
      cost: { scrap: 2, weaponParts: 2 },
      effects: { rangeMul: 0.96, accuracyBonus: 0.04, noiseMul: 0.42 },
      desc: 'Резко снижает шум выстрела и слегка повышает точность ценой дальности.'
    },
    barrel_choke: {
      id: 'barrel_choke', slot: 'barrel', name: 'Усиленный чок', icon: '◉',
      weaponIds: ['shotgun'],
      cost: { scrap: 2, weaponParts: 1 },
      effects: { rangeMul: 1.18, accuracyBonus: 0.04 },
      desc: 'Сужает разлёт дроби и делает дробовик увереннее на средней дистанции.'
    },
    barrel_nozzle: {
      id: 'barrel_nozzle', slot: 'barrel', name: 'Дальнобойная форсунка', icon: '≋',
      weaponIds: ['flamethrower'],
      cost: { scrap: 3, weaponParts: 2 },
      effects: { damageMul: 1.04, rangeMul: 1.20, fireRateMul: 1.06 },
      desc: 'Формирует плотную струю пламени: дальше и мощнее, но с небольшой задержкой.'
    },
    barrel_accelerator: {
      id: 'barrel_accelerator', slot: 'barrel', name: 'Ускоряющая катушка', icon: 'ϟ',
      weaponIds: ['laserPistol', 'plasmaRifle'],
      cost: { electronics: 3, weaponParts: 2 },
      effects: { damageMul: 1.08, rangeMul: 1.10, fireRateMul: 1.08 },
      desc: 'Усиливает энергетический импульс ценой более долгого охлаждения.'
    },
    barrel_rocket_stabilizer: {
      id: 'barrel_rocket_stabilizer', slot: 'barrel', name: 'Стабилизатор сопла', icon: '◁',
      weaponIds: ['rocketLauncher'],
      cost: { scrap: 4, weaponParts: 2 },
      effects: { rangeMul: 1.12, accuracyBonus: 0.05 },
      desc: 'Выравнивает сход ракеты с направляющей и делает дальний выстрел предсказуемее.'
    },
    scope_reflex: {
      id: 'scope_reflex', slot: 'scope', name: 'Коллиматорный прицел', icon: '⊙',
      excludeWeaponIds: ['flamethrower'],
      cost: { electronics: 2, scrap: 1 },
      effects: { accuracyBonus: 0.04 },
      desc: 'Простой светящийся маркер для быстрого и точного наведения.'
    },
    scope_marksman: {
      id: 'scope_marksman', slot: 'scope', name: 'Оптика разведчика', icon: '⌖',
      weaponIds: ['rifle', 'assaultRifle', 'machineGun', 'plasmaRifle', 'rocketLauncher'],
      cost: { electronics: 3, weaponParts: 2 },
      effects: { accuracyBonus: 0.08, rangeMul: 1.10 },
      desc: 'Увеличивает рабочую дальность и вероятность попадания.'
    },
    scope_thermal: {
      id: 'scope_thermal', slot: 'scope', name: 'Тепловизионный визир', icon: '◈',
      weaponIds: ['laserPistol', 'plasmaRifle', 'flamethrower', 'rocketLauncher'],
      cost: { electronics: 5, weaponParts: 2 },
      effects: { accuracyBonus: 0.06, rangeMul: 1.06 },
      desc: 'Стабилизированный визир для сложных энергетических и тяжёлых систем.'
    },
    mag_extended: {
      id: 'mag_extended', slot: 'magazine', name: 'Расширенный магазин', icon: '▥',
      excludeWeaponIds: ['rocketLauncher'],
      cost: { scrap: 3, weaponParts: 2 },
      effects: { magMul: 1.35, reloadApDelta: 1 },
      desc: 'Вмещает больше боеприпасов, но перезарядка требует на 1 ОД больше.'
    },
    mag_quick: {
      id: 'mag_quick', slot: 'magazine', name: 'Быстросъёмный магазин', icon: '⇊',
      excludeWeaponIds: ['rocketLauncher'],
      cost: { scrap: 2, weaponParts: 2 },
      effects: { magMul: 0.86, reloadApDelta: -1 },
      desc: 'Уменьшает ёмкость, зато ускоряет перезарядку на 1 ОД.'
    },
    mag_overcharged: {
      id: 'mag_overcharged', slot: 'magazine', name: 'Перегруженный энергоэлемент', icon: '▣',
      weaponIds: ['laserPistol', 'plasmaRifle'],
      cost: { electronics: 4, weaponParts: 2 },
      effects: { damageMul: 1.12, magMul: 0.80 },
      desc: 'Повышает мощность каждого импульса, уменьшая число зарядов.'
    },
    mag_rocket_loader: {
      id: 'mag_rocket_loader', slot: 'magazine', name: 'Кассета быстрого заряжания', icon: '↯',
      weaponIds: ['rocketLauncher'],
      cost: { scrap: 4, weaponParts: 3 },
      effects: { reloadApDelta: -2 },
      desc: 'Направляющая кассета заметно сокращает время установки новой ракеты.'
    },
    forend_grip: {
      id: 'forend_grip', slot: 'forend', name: 'Эргономичная рукоять', icon: '┷',
      weaponIds: ['rifle', 'assaultRifle', 'machineGun', 'plasmaRifle', 'shotgun'],
      cost: { wood: 2, scrap: 1 },
      effects: { accuracyBonus: 0.03, autoPenaltyReduction: 0.04 },
      desc: 'Улучшает удержание и заметно снижает штраф автоматического огня.'
    },
    forend_bipod: {
      id: 'forend_bipod', slot: 'forend', name: 'Складные сошки', icon: '⋀',
      weaponIds: ['rifle', 'assaultRifle', 'machineGun', 'plasmaRifle', 'rocketLauncher'],
      cost: { scrap: 4, weaponParts: 1 },
      effects: { accuracyBonus: 0.06 },
      desc: 'Тяжёлая, но стабильная опора для уверенного дальнего огня.'
    },
    forend_heatshield: {
      id: 'forend_heatshield', slot: 'forend', name: 'Теплозащитное цевьё', icon: '▧',
      weaponIds: ['assaultRifle', 'machineGun', 'flamethrower', 'plasmaRifle'],
      cost: { scrap: 3, weaponParts: 2 },
      effects: { fireRateMul: 0.88, accuracyBonus: 0.02 },
      desc: 'Лучше отводит тепло и сокращает паузу между атаками.'
    }
  });

  const WEAPON_MODIFICATION_BASE_STATS = Object.fromEntries(
    Object.entries(ITEMS)
      .filter(([, item]) => item?.type === 'weapon' && item?.ammoType)
      .map(([id, item]) => [id, {
        dmg: Array.isArray(item.dmg) ? item.dmg.slice(0, 2) : [1, 1],
        range: Number(item.range || 1),
        magSize: Math.max(1, Math.round(Number(item.magSize || 1))),
        fireRate: Number(item.fireRate || 0.5),
        reloadApCost: Number(item.reloadApCost || item.apCost || 3)
      }])
  );
  var weaponModificationStatsReady = true;

  function weaponModificationSlotsFor(itemOrId) {
    const item = typeof itemOrId === 'string' ? ITEMS[itemOrId] : itemOrId;
    if (!item || item.type !== 'weapon' || !item.ammoType) return [];
    const slots = ['barrel', 'scope', 'magazine'];
    if (itemHands(item) === 2) slots.push('forend');
    return slots;
  }

  function weaponModificationCompatible(mod, itemOrId) {
    const item = typeof itemOrId === 'string' ? ITEMS[itemOrId] : itemOrId;
    if (!mod || !item || item.type !== 'weapon' || !item.ammoType) return false;
    const weaponId = baseItemId(item.id || itemOrId || '');
    if (!weaponModificationSlotsFor(item).includes(mod.slot)) return false;
    if (Array.isArray(mod.weaponIds) && !mod.weaponIds.includes(weaponId)) return false;
    if (Array.isArray(mod.excludeWeaponIds) && mod.excludeWeaponIds.includes(weaponId)) return false;
    return true;
  }

  function sanitizeClientWeaponModifications(raw = {}, itemOrId = null) {
    const out = {};
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    for (const slot of Object.keys(WEAPON_MODIFICATION_SLOT_META)) {
      const modId = String(source[slot] || '');
      const mod = WEAPON_MODIFICATION_CATALOG[modId];
      if (mod && mod.slot === slot && (!itemOrId || weaponModificationCompatible(mod, itemOrId))) out[slot] = modId;
    }
    return out;
  }

  function applyWeaponModificationStats(itemOrId) {
    const item = typeof itemOrId === 'string' ? ITEMS[itemOrId] : itemOrId;
    if (!item || item.type !== 'weapon' || !item.ammoType) return item || null;
    const weaponId = baseItemId(item.id || '');
    const base = WEAPON_MODIFICATION_BASE_STATS[weaponId];
    if (!base) return item;
    const mods = sanitizeClientWeaponModifications(item.weaponMods || {}, item);
    let damageMul = 1;
    let rangeMul = 1;
    let magMul = 1;
    let fireRateMul = 1;
    let reloadApDelta = 0;
    let accuracyBonus = 0;
    let autoPenaltyReduction = 0;
    let noiseMul = 1;
    Object.values(mods).forEach(modId => {
      const effects = WEAPON_MODIFICATION_CATALOG[modId]?.effects || {};
      damageMul *= Number(effects.damageMul || 1);
      rangeMul *= Number(effects.rangeMul || 1);
      magMul *= Number(effects.magMul || 1);
      fireRateMul *= Number(effects.fireRateMul || 1);
      reloadApDelta += Number(effects.reloadApDelta || 0);
      accuracyBonus += Number(effects.accuracyBonus || 0);
      autoPenaltyReduction += Number(effects.autoPenaltyReduction || 0);
      noiseMul *= Number(effects.noiseMul || 1);
    });
    item.weaponMods = mods;
    item.dmg = base.dmg.map(value => Math.max(1, Math.round(Number(value || 1) * damageMul)));
    item.range = Math.max(0.4, Number((base.range * rangeMul).toFixed(1)));
    item.magSize = Math.max(1, Math.round(base.magSize * magMul));
    item.loaded = Math.max(0, Math.min(item.magSize, Math.round(Number(item.loaded || 0))));
    item.fireRate = Math.max(0.045, Number((base.fireRate * fireRateMul).toFixed(3)));
    item.reloadApCost = Math.max(1, Math.round(base.reloadApCost + reloadApDelta));
    item.modAccuracyBonus = Number(accuracyBonus.toFixed(4));
    item.modAutoPenaltyReduction = Number(autoPenaltyReduction.toFixed(4));
    item.modNoiseMul = Number(noiseMul.toFixed(4));
    return item;
  }

  function weaponModificationCount(itemOrId) {
    const item = typeof itemOrId === 'string' ? ITEMS[itemOrId] : itemOrId;
    return Object.keys(sanitizeClientWeaponModifications(item?.weaponMods || {}, item)).length;
  }

  function weaponModificationEffectText(mod) {
    const e = mod?.effects || {};
    const rows = [];
    if (e.damageMul && e.damageMul !== 1) rows.push(`урон ${e.damageMul > 1 ? '+' : ''}${Math.round((e.damageMul - 1) * 100)}%`);
    if (e.rangeMul && e.rangeMul !== 1) rows.push(`дальность ${e.rangeMul > 1 ? '+' : ''}${Math.round((e.rangeMul - 1) * 100)}%`);
    if (e.magMul && e.magMul !== 1) rows.push(`ёмкость ${e.magMul > 1 ? '+' : ''}${Math.round((e.magMul - 1) * 100)}%`);
    if (e.accuracyBonus) rows.push(`точность +${Math.round(e.accuracyBonus * 100)}%`);
    if (e.autoPenaltyReduction) rows.push(`контроль отдачи +${Math.round(e.autoPenaltyReduction * 100)}%`);
    if (e.fireRateMul && e.fireRateMul !== 1) rows.push(e.fireRateMul < 1 ? `темп +${Math.round((1 - e.fireRateMul) * 100)}%` : `темп -${Math.round((e.fireRateMul - 1) * 100)}%`);
    if (e.reloadApDelta) rows.push(`перезарядка ${e.reloadApDelta > 0 ? '+' : ''}${e.reloadApDelta} ОД`);
    if (e.noiseMul && e.noiseMul < 1) rows.push(`шум -${Math.round((1 - e.noiseMul) * 100)}%`);
    return rows.join(' · ');
  }

  function weaponModificationInventoryQty(itemId) {
    if (typeof mapBaseQty === 'function') return Math.max(0, Math.floor(mapBaseQty(inventory, itemId)));
    return Math.max(0, Math.floor(Number(inventory.get(itemId) || 0)));
  }

  function weaponModificationCostHtml(cost = {}) {
    return Object.entries(cost).map(([itemId, qty]) => {
      const have = weaponModificationInventoryQty(itemId);
      const enough = have >= Number(qty || 0);
      return `<span class="wm-cost-chip${enough ? '' : ' is-missing'}">${itemArtHtml(itemId)}<b>${have}/${qty}</b></span>`;
    }).join('');
  }

  function canAffordWeaponModification(mod) {
    return Object.entries(mod?.cost || {}).every(([itemId, qty]) => weaponModificationInventoryQty(itemId) >= Number(qty || 0));
  }

  const weaponModificationUi = {
    itemId: '',
    activeSlot: 'barrel',
    pending: false,
    modelRequest: 0,
    renderer: null,
    scene: null,
    camera: null,
    modelPivot: null,
    weaponRoot: null,
    baseScale: 1,
    zoom: 1,
    dragging: false,
    pointerId: null,
    pointerX: 0,
    pointerY: 0,
    raf: 0,
    lastFrameAt: 0
  };

  function weaponModificationMountRoot() {
    const fullscreenRoot = document.fullscreenElement;
    if (fullscreenRoot?.isConnected) return fullscreenRoot;
    return document.getElementById('game-container') || document.body;
  }

  function ensureWeaponModificationWindow() {
    let modal = document.getElementById('weapon-modification-window');
    const root = weaponModificationMountRoot();
    if (modal) {
      if (modal.parentElement !== root) root.appendChild(modal);
      return modal;
    }
    modal = document.createElement('div');
    modal.id = 'weapon-modification-window';
    modal.className = 'weapon-modification-overlay';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="weapon-modification-shell" role="dialog" aria-modal="true" aria-labelledby="wm-title">
        <header class="wm-header">
          <div>
            <div class="wm-kicker">ОРУЖЕЙНЫЙ ВЕРСТАК</div>
            <h2 id="wm-title">Модификация оружия</h2>
            <div id="wm-subtitle" class="wm-subtitle">Выберите узел сборки</div>
          </div>
          <div class="wm-header-actions">
            <span id="wm-build-count" class="wm-build-count">0 / 4</span>
            <button id="wm-close" class="wm-close" type="button" aria-label="Закрыть модификацию">×</button>
          </div>
        </header>
        <div class="wm-body">
          <section class="wm-stage" aria-label="Трёхмерная модель оружия">
            <canvas id="wm-canvas"></canvas>
            <div class="wm-vignette" aria-hidden="true"></div>
            <div id="wm-slot-layer" class="wm-slot-layer"></div>
            <div class="wm-rotate-hint"><span>↔</span> Тяните, чтобы вращать · колесо — масштаб</div>
          </section>
          <aside class="wm-options-panel">
            <div class="wm-options-heading">
              <div id="wm-slot-kicker" class="wm-kicker">УЗЕЛ</div>
              <h3 id="wm-slot-title">Ствол</h3>
              <p id="wm-slot-note">Выберите совместимую деталь.</p>
            </div>
            <div id="wm-option-list" class="wm-option-list"></div>
          </aside>
        </div>
        <footer class="wm-footer">
          <div id="wm-stat-strip" class="wm-stat-strip"></div>
          <div id="wm-status" class="wm-status" aria-live="polite">Сборка готова к настройке.</div>
        </footer>
      </div>`;
    root.appendChild(modal);
    modal.addEventListener('pointerdown', event => {
      if (event.target === modal) closeWeaponModificationWorkbench();
    });
    modal.querySelector('#wm-close')?.addEventListener('click', closeWeaponModificationWorkbench);
    const canvas = modal.querySelector('#wm-canvas');
    canvas?.addEventListener('pointerdown', event => {
      if (!weaponModificationUi.modelPivot) return;
      weaponModificationUi.dragging = true;
      weaponModificationUi.pointerId = event.pointerId;
      weaponModificationUi.pointerX = event.clientX;
      weaponModificationUi.pointerY = event.clientY;
      canvas.setPointerCapture?.(event.pointerId);
      canvas.classList.add('is-dragging');
      event.preventDefault();
    });
    canvas?.addEventListener('pointermove', event => {
      if (!weaponModificationUi.dragging || weaponModificationUi.pointerId !== event.pointerId || !weaponModificationUi.modelPivot) return;
      const dx = event.clientX - weaponModificationUi.pointerX;
      const dy = event.clientY - weaponModificationUi.pointerY;
      weaponModificationUi.pointerX = event.clientX;
      weaponModificationUi.pointerY = event.clientY;
      weaponModificationUi.modelPivot.rotation.y += dx * 0.012;
      weaponModificationUi.modelPivot.rotation.x = Math.max(-1.05, Math.min(1.05, weaponModificationUi.modelPivot.rotation.x + dy * 0.009));
      event.preventDefault();
    });
    const releasePointer = event => {
      if (weaponModificationUi.pointerId !== event.pointerId) return;
      weaponModificationUi.dragging = false;
      weaponModificationUi.pointerId = null;
      canvas?.classList.remove('is-dragging');
    };
    canvas?.addEventListener('pointerup', releasePointer);
    canvas?.addEventListener('pointercancel', releasePointer);
    canvas?.addEventListener('wheel', event => {
      weaponModificationUi.zoom = Math.max(0.68, Math.min(1.75, weaponModificationUi.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
      event.preventDefault();
    }, { passive: false });
    if (document.body.dataset.boundWeaponModificationKeys !== '1') {
      document.body.dataset.boundWeaponModificationKeys = '1';
      window.addEventListener('keydown', event => {
        const open = document.getElementById('weapon-modification-window')?.classList.contains('is-open');
        if (!open || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeWeaponModificationWorkbench();
      }, true);
    }
    return modal;
  }

  function initializeWeaponModificationRenderer() {
    if (weaponModificationUi.renderer) return true;
    const canvas = document.getElementById('wm-canvas');
    if (!canvas || typeof THREE === 'undefined' || !THREE.WebGLRenderer) return false;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
    camera.position.set(0, 0.15, 4.8);
    const ambient = new THREE.HemisphereLight(0xbfe8d0, 0x24160d, 1.45);
    const key = new THREE.DirectionalLight(0xffe2ad, 2.1);
    key.position.set(3.2, 4.4, 5.2);
    const rim = new THREE.DirectionalLight(0x69ff9b, 1.2);
    rim.position.set(-4.5, 1.5, -3.5);
    scene.add(ambient, key, rim);
    const pivot = new THREE.Group();
    pivot.rotation.set(-0.10, -0.20, 0.02);
    scene.add(pivot);
    weaponModificationUi.renderer = renderer;
    weaponModificationUi.scene = scene;
    weaponModificationUi.camera = camera;
    weaponModificationUi.modelPivot = pivot;
    return true;
  }

  function resizeWeaponModificationRenderer() {
    const renderer = weaponModificationUi.renderer;
    const camera = weaponModificationUi.camera;
    const canvas = document.getElementById('wm-canvas');
    if (!renderer || !camera || !canvas) return;
    const width = Math.max(1, Math.floor(canvas.clientWidth));
    const height = Math.max(1, Math.floor(canvas.clientHeight));
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const targetWidth = Math.floor(width * pixelRatio);
    const targetHeight = Math.floor(height * pixelRatio);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function weaponModificationRenderLoop(now = 0) {
    const modal = document.getElementById('weapon-modification-window');
    if (!modal?.classList.contains('is-open')) {
      weaponModificationUi.raf = 0;
      return;
    }
    resizeWeaponModificationRenderer();
    const dt = Math.min(0.05, Math.max(0, (now - Number(weaponModificationUi.lastFrameAt || now)) / 1000));
    weaponModificationUi.lastFrameAt = now;
    const pivot = weaponModificationUi.modelPivot;
    if (pivot) {
      if (!weaponModificationUi.dragging) pivot.rotation.y += dt * 0.12;
      const scale = weaponModificationUi.baseScale * weaponModificationUi.zoom;
      pivot.scale.setScalar(scale);
    }
    weaponModificationUi.renderer?.render(weaponModificationUi.scene, weaponModificationUi.camera);
    weaponModificationUi.raf = requestAnimationFrame(weaponModificationRenderLoop);
  }

  async function loadWeaponModificationModel(itemId) {
    if (!initializeWeaponModificationRenderer()) return;
    const request = ++weaponModificationUi.modelRequest;
    const item = ITEMS[itemId];
    const weaponId = baseItemId(itemId);
    const entry = typeof weaponModelCatalogEntry === 'function' ? weaponModelCatalogEntry(weaponId) : null;
    const status = document.getElementById('wm-status');
    if (status) status.textContent = 'Загрузка 3D-модели…';
    if (entry && typeof loadWeaponModelTemplate === 'function') await loadWeaponModelTemplate(entry);
    if (request !== weaponModificationUi.modelRequest || weaponModificationUi.itemId !== itemId) return;
    const pivot = weaponModificationUi.modelPivot;
    if (!pivot) return;
    while (pivot.children.length) pivot.remove(pivot.children[0]);
    pivot.scale.setScalar(1);
    const root = typeof makeWeaponModelMesh === 'function' ? makeWeaponModelMesh(weaponId) : null;
    if (!root) {
      const fallback = new THREE.Group();
      const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x4b5146, metalness: 0.7, roughness: 0.42 });
      const stockMaterial = new THREE.MeshStandardMaterial({ color: 0x563820, metalness: 0.05, roughness: 0.78 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.34, 0.42), bodyMaterial);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 1.9, 12), bodyMaterial);
      barrel.rotation.z = Math.PI * 0.5;
      barrel.position.x = 2.0;
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.46, 0.38), stockMaterial);
      stock.position.x = -1.65;
      fallback.add(body, barrel, stock);
      pivot.add(fallback);
      weaponModificationUi.weaponRoot = fallback;
    } else {
      root.updateMatrixWorld(true);
      let bounds = new THREE.Box3().setFromObject(root);
      const sourceSize = bounds.getSize(new THREE.Vector3());
      if (sourceSize.y > sourceSize.x && sourceSize.y > sourceSize.z) root.rotation.z -= Math.PI * 0.5;
      else if (sourceSize.z > sourceSize.x && sourceSize.z > sourceSize.y) root.rotation.y += Math.PI * 0.5;
      root.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(root);
      const center = bounds.getCenter(new THREE.Vector3());
      root.position.sub(center);
      pivot.add(root);
      weaponModificationUi.weaponRoot = root;
    }
    pivot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(pivot);
    const size = bounds.getSize(new THREE.Vector3());
    const maxDimension = Math.max(0.2, size.x, size.y, size.z);
    weaponModificationUi.baseScale = Math.max(0.16, Math.min(3.8, 3.5 / maxDimension));
    weaponModificationUi.zoom = 1;
    if (status) status.textContent = `${item?.name || weaponId}: модель готова. Выберите узел сборки.`;
  }

  function weaponModificationStatsHtml(item) {
    const base = WEAPON_MODIFICATION_BASE_STATS[baseItemId(item?.id || '')] || {};
    const rows = [
      ['УРОН', `${item?.dmg?.[0] || 0}–${item?.dmg?.[1] || 0}`, base.dmg ? `${base.dmg[0]}–${base.dmg[1]}` : ''],
      ['ДАЛЬНОСТЬ', `${Number(item?.range || 0).toFixed(1).replace('.0', '')} м`, base.range ? `${base.range} м` : ''],
      ['ЁМКОСТЬ', `${Math.round(Number(item?.magSize || 0))}`, base.magSize ? String(base.magSize) : ''],
      ['ТОЧНОСТЬ', `+${Math.round(Number(item?.modAccuracyBonus || 0) * 100)}%`, '0%'],
      ['ТЕМП', `${Number(item?.fireRate || 0).toFixed(2)} c`, base.fireRate ? `${Number(base.fireRate).toFixed(2)} c` : '']
    ];
    return rows.map(([label, value, original]) => {
      const changed = original && value !== original && !(label === 'ТОЧНОСТЬ' && value === '+0%');
      return `<div class="wm-stat${changed ? ' is-changed' : ''}"><span>${label}</span><b>${value}</b>${changed ? `<small>было ${original}</small>` : ''}</div>`;
    }).join('');
  }

  function renderWeaponModificationWorkbench() {
    const modal = ensureWeaponModificationWindow();
    const item = ITEMS[weaponModificationUi.itemId];
    if (!item || item.type !== 'weapon' || !item.ammoType) {
      closeWeaponModificationWorkbench();
      return;
    }
    applyWeaponModificationStats(item);
    const slots = weaponModificationSlotsFor(item);
    if (!slots.includes(weaponModificationUi.activeSlot)) weaponModificationUi.activeSlot = slots[0] || 'barrel';
    const mods = sanitizeClientWeaponModifications(item.weaponMods || {}, item);
    const subtitle = modal.querySelector('#wm-subtitle');
    if (subtitle) subtitle.textContent = `${item.name} · ${itemHands(item) === 2 ? 'двуручное оружие' : 'одноручное оружие'} · состояние ${Math.round(Number(item.condition ?? 100))}%`;
    const count = modal.querySelector('#wm-build-count');
    if (count) count.textContent = `${Object.keys(mods).length} / ${slots.length} узлов`;
    const layer = modal.querySelector('#wm-slot-layer');
    if (layer) {
      layer.innerHTML = slots.map(slot => {
        const meta = WEAPON_MODIFICATION_SLOT_META[slot];
        const mod = WEAPON_MODIFICATION_CATALOG[mods[slot]];
        const selected = weaponModificationUi.activeSlot === slot;
        return `<button type="button" class="wm-slot wm-slot--${meta.anchor}${selected ? ' is-selected' : ''}${mod ? ' is-installed' : ''}" data-wm-slot="${slot}" aria-pressed="${selected}">
          <span class="wm-slot-node" aria-hidden="true"></span>
          <small>${meta.short}</small>
          <b>${mod ? mod.name : 'Пусто'}</b>
          <em>${mod ? mod.icon : '+'}</em>
        </button>`;
      }).join('');
      layer.querySelectorAll('[data-wm-slot]').forEach(button => button.addEventListener('click', () => {
        weaponModificationUi.activeSlot = button.dataset.wmSlot || 'barrel';
        renderWeaponModificationWorkbench();
      }));
    }
    const slotMeta = WEAPON_MODIFICATION_SLOT_META[weaponModificationUi.activeSlot];
    const slotKicker = modal.querySelector('#wm-slot-kicker');
    const slotTitle = modal.querySelector('#wm-slot-title');
    const slotNote = modal.querySelector('#wm-slot-note');
    if (slotKicker) slotKicker.textContent = `УЗЕЛ ${slots.indexOf(weaponModificationUi.activeSlot) + 1} ИЗ ${slots.length}`;
    if (slotTitle) slotTitle.textContent = slotMeta?.label || 'Модификация';
    if (slotNote) slotNote.textContent = mods[weaponModificationUi.activeSlot]
      ? 'Деталь установлена. Можно заменить её или вернуть базовую конфигурацию.'
      : 'Подходящие детали создаются из материалов прямо на оружейном верстаке.';
    const compatible = Object.values(WEAPON_MODIFICATION_CATALOG)
      .filter(mod => mod.slot === weaponModificationUi.activeSlot && weaponModificationCompatible(mod, item));
    const list = modal.querySelector('#wm-option-list');
    if (list) {
      const installedId = mods[weaponModificationUi.activeSlot] || '';
      const removeHtml = installedId ? `<button type="button" class="wm-option wm-option-remove" data-wm-mod="">
        <span class="wm-option-icon">×</span><span><b>Базовая конфигурация</b><small>Снять установленную деталь. Материалы не возвращаются.</small></span><em>СНЯТЬ</em>
      </button>` : '';
      list.innerHTML = removeHtml + compatible.map(mod => {
        const installed = installedId === mod.id;
        const affordable = canAffordWeaponModification(mod);
        const disabled = weaponModificationUi.pending || installed || !affordable;
        return `<button type="button" class="wm-option${installed ? ' is-installed' : ''}${!affordable ? ' is-locked' : ''}" data-wm-mod="${mod.id}" ${disabled ? 'disabled' : ''}>
          <span class="wm-option-icon">${mod.icon}</span>
          <span class="wm-option-copy"><b>${mod.name}</b><small>${mod.desc}</small><strong>${weaponModificationEffectText(mod)}</strong><span class="wm-cost-row">${weaponModificationCostHtml(mod.cost)}</span></span>
          <em>${installed ? 'УСТАНОВЛЕНО' : (affordable ? 'СОЗДАТЬ' : 'НЕ ХВАТАЕТ')}</em>
        </button>`;
      }).join('');
      list.querySelectorAll('[data-wm-mod]').forEach(button => button.addEventListener('click', () => {
        requestWeaponModificationChange(weaponModificationUi.activeSlot, button.dataset.wmMod || '');
      }));
    }
    const strip = modal.querySelector('#wm-stat-strip');
    if (strip) strip.innerHTML = weaponModificationStatsHtml(item);
  }

  function requestWeaponModificationChange(slot, modificationId) {
    const itemId = weaponModificationUi.itemId;
    const item = ITEMS[itemId];
    if (weaponModificationUi.pending || !item) return false;
    if (typeof multiplayer === 'undefined' || !multiplayer?.socket?.connected || !multiplayer.joined) {
      const status = document.getElementById('wm-status');
      if (status) status.textContent = 'Верстак недоступен без соединения с сервером мира.';
      return false;
    }
    weaponModificationUi.pending = true;
    renderWeaponModificationWorkbench();
    const status = document.getElementById('wm-status');
    if (status) status.textContent = modificationId ? 'Сборка и установка детали…' : 'Снятие детали…';
    multiplayer.socket.emit('inventoryItemAction', {
      action: 'modifyWeapon',
      itemId: baseItemId(itemId),
      itemRuntimeId: String(itemId || '').slice(0, 96),
      modSlot: slot,
      modificationId,
      equipment: typeof multiplayerEquipmentSnapshot === 'function' ? multiplayerEquipmentSnapshot() : { ...equipment }
    }, ack => {
      weaponModificationUi.pending = false;
      if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      if (!ack?.ok) {
        if (status) status.textContent = ack?.error || 'Сервер отклонил изменение сборки.';
        renderWeaponModificationWorkbench();
        return;
      }
      const resolvedId = String(ack.itemRuntimeId || itemId);
      const target = ITEMS[resolvedId] || ITEMS[itemId];
      if (target) {
        target.weaponMods = sanitizeClientWeaponModifications(ack.weaponMods || {}, target);
        applyWeaponModificationStats(target);
      }
      const mod = WEAPON_MODIFICATION_CATALOG[modificationId];
      if (status) status.textContent = mod
        ? `${mod.name}: установлено на ${item.name}.`
        : `${WEAPON_MODIFICATION_SLOT_META[slot]?.label || 'Деталь'}: возвращена базовая конфигурация.`;
      if (typeof renderInventory === 'function') renderInventory();
      if (typeof renderQuickbar === 'function') renderQuickbar();
      if (typeof renderWeaponReadout === 'function') renderWeaponReadout();
      if (typeof queueSave === 'function') queueSave(true);
      renderWeaponModificationWorkbench();
    });
    return true;
  }

  function openWeaponModificationWorkbench(itemId) {
    const item = ITEMS[itemId];
    if (!item || item.type !== 'weapon' || !item.ammoType) {
      setReadout('Это оружие не поддерживает сменные узлы.');
      return false;
    }
    if ((inventory.get(itemId) || 0) <= 0 && !Object.values(equipment).includes(itemId)) {
      setReadout('Выбранный экземпляр оружия больше недоступен.');
      return false;
    }
    const modal = ensureWeaponModificationWindow();
    weaponModificationUi.itemId = itemId;
    weaponModificationUi.activeSlot = weaponModificationSlotsFor(item)[0] || 'barrel';
    weaponModificationUi.pending = false;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('weapon-modification-open');
    if (typeof hideItemContextMenu === 'function') hideItemContextMenu();
    if (typeof hideTooltip === 'function') hideTooltip();
    renderWeaponModificationWorkbench();
    loadWeaponModificationModel(itemId);
    if (!weaponModificationUi.raf) {
      weaponModificationUi.lastFrameAt = performance.now();
      weaponModificationUi.raf = requestAnimationFrame(weaponModificationRenderLoop);
    }
    setTimeout(() => modal.querySelector('#wm-close')?.focus(), 0);
    return true;
  }

  function closeWeaponModificationWorkbench() {
    const modal = document.getElementById('weapon-modification-window');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('weapon-modification-open');
    weaponModificationUi.dragging = false;
    weaponModificationUi.pointerId = null;
    weaponModificationUi.modelRequest += 1;
  }
