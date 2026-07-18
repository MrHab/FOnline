  const PERK_WHEEL_SIZE = 2100;
  const PERK_WHEEL_CENTER = PERK_WHEEL_SIZE / 2;
  const PERK_WHEEL_LEVELS = [3, 6, 9, 12, 15, 18, 21, 24];
  const PERK_WHEEL_MIN_ZOOM = 0.62;
  const PERK_WHEEL_MAX_ZOOM = 1.45;
  const PERK_NODE_SAFE_GAP = 84;
  const PERK_NODE_MARGIN = 96;
  const PERK_BRANCH_LABEL_SIDE_GAP = 78;
  const PERK_BRANCH_LABEL_VERTICAL_GAP = 78;
  const PERK_BRANCH_LABEL_EDGE_PAD = 180;
  const PERK_SIDE_LABEL_GAP = 96;
  const PERK_BRANCH_SLOT_STEP = 96;
  const PERK_SIDE_LEVEL_STEP = 104;
  const PERK_TOP_LEVEL_STEP = 92;
  const PERK_BOTTOM_ROW_Y = PERK_WHEEL_CENTER + 720;
  const PERK_BRANCH_DEPTH_START = 300;
  const PERK_SIDE_SLOT_FAN = 26;
  const PERK_TOP_SLOT_ARCH = 54;
  const PERK_BOTTOM_SLOT_ARCH = 46;
  const PERK_CELL_STACK_STEP = 32;
  const PERK_RADIAL_HUB_RADIUS = 220;
  const PERK_RADIAL_NODE_RADIUS = 440;
  const PERK_RADIAL_LEVEL_STEP = 58;
  const PERK_RADIAL_SLOT_RADIUS = 10;
  const PERK_RADIAL_ANGLE_STEP = 8.4;
  const PERK_RADIAL_WIDE_ANGLE_STEP = 8.2;
  const PERK_RADIAL_STACK_ANGLE_STEP = 1.8;
  const PERK_RADIAL_LABEL_RADIUS = 715;
  const PERK_LAYOUT_MODE = 'atlas';
  const PERK_ATLAS_LEFT_X = PERK_WHEEL_CENTER - 790;
  const PERK_ATLAS_ROW_WIDTH = 1580;
  const PERK_ATLAS_LABEL_X = PERK_ATLAS_LEFT_X + 30;
  const PERK_ATLAS_HUB_X = PERK_ATLAS_LEFT_X + 270;
  const PERK_ATLAS_NODE_CENTER_X = PERK_WHEEL_CENTER + 130;
  const PERK_ATLAS_FIRST_ROW_Y = PERK_WHEEL_CENTER - 640;
  const PERK_ATLAS_ROW_STEP = 140;
  const PERK_ATLAS_NODE_STEP = 132;
  const PERK_ATLAS_MAX_NODE_SPAN = 890;
  const PERK_ATLAS_STATUS_X = PERK_WHEEL_CENTER + 700;
  const PERK_ATLAS_STATUS_Y = PERK_WHEEL_CENTER - 710;
  const PERK_HUB_PORT_STEP = 14;
  const PERK_HUB_PORT_OFFSET = 16;
  const PERK_LINK_ELBOW = 28;
  const PERK_DEPENDENCY_ELBOW = 30;
  let perkWheelZoom = 0.92;
  let selectedPerkCategory = 'available';
  let selectedPerkId = '';
  let perkSearchText = '';
  let selectedPerkStateFilter = 'all';

  function syncPerkTreeFullscreenButton() {
    const win = document.getElementById('talents-window');
    const btn = document.getElementById('perk-wheel-fullscreen');
    if (!btn) return;
    const active = !!(win && win.classList.contains('perk-tree-fullscreen'));
    btn.classList.toggle('active', active);
    btn.textContent = active ? '↙' : '⛶';
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.setAttribute('aria-label', active ? 'Свернуть древо перков' : 'Развернуть древо перков');
    updatePerkFullscreenButtonPosition();
  }

  function updatePerkFullscreenButtonPosition() {
    const win = document.getElementById('talents-window');
    const wrap = document.getElementById('perk-wheel-wrap');
    const btn = document.getElementById('perk-wheel-fullscreen');
    if (!win || !wrap || !btn || !win.classList.contains('visible') || progressionMode !== 'perks') return;
    const size = 36;
    const gap = 13;
    btn.style.position = 'absolute';
    btn.style.left = `${Math.max(gap, wrap.scrollLeft + wrap.clientWidth - size - gap)}px`;
    btn.style.top = `${Math.max(gap, wrap.scrollTop + gap)}px`;
    btn.style.right = 'auto';
    btn.style.margin = '0';
  }

  function applyPerkWheelViewportLayout() {
    const wrap = document.getElementById('perk-wheel-wrap');
    const wheel = document.getElementById('perk-wheel');
    if (!wrap || !wheel) return { wrap: null, wheel: null, insetX: 0, insetY: 0 };
    if (wheel.classList.contains('perk-board')) {
      perkWheelZoom = 1;
      wheel.style.zoom = '1';
      wheel.style.transformOrigin = '';
      wrap.dataset.zoom = '100';
      wrap.dataset.perkInsetX = '0';
      wrap.dataset.perkInsetY = '0';
      wheel.style.setProperty('--perk-wheel-offset-x', '0px');
      wheel.style.setProperty('--perk-wheel-offset-y', '0px');
      return { wrap, wheel, insetX: 0, insetY: 0 };
    }
    const zoom = Math.max(PERK_WHEEL_MIN_ZOOM, Math.min(PERK_WHEEL_MAX_ZOOM, Number(perkWheelZoom) || 1));
    perkWheelZoom = zoom;
    wheel.style.zoom = String(zoom);
    wheel.style.transformOrigin = '0 0';
    wrap.dataset.zoom = String(Math.round(zoom * 100));
    const insetX = Math.max(0, (wrap.clientWidth - PERK_WHEEL_SIZE * zoom) / 2);
    const insetY = Math.max(0, (wrap.clientHeight - PERK_WHEEL_SIZE * zoom) / 2);
    wheel.style.setProperty('--perk-wheel-offset-x', `${insetX}px`);
    wheel.style.setProperty('--perk-wheel-offset-y', `${insetY}px`);
    wrap.dataset.perkInsetX = String(insetX);
    wrap.dataset.perkInsetY = String(insetY);
    return { wrap, wheel, insetX, insetY };
  }

  function currentPerkWheelInsets(wrap = document.getElementById('perk-wheel-wrap')) {
    return {
      x: Math.max(0, Number(wrap?.dataset?.perkInsetX || 0)),
      y: Math.max(0, Number(wrap?.dataset?.perkInsetY || 0))
    };
  }

  function centerPerkWheelView(resetZoom = false) {
    if (resetZoom) perkWheelZoom = 1.0;
    const { wrap, insetX, insetY } = applyPerkWheelViewportLayout();
    if (!wrap) return;
    const wheel = document.getElementById('perk-wheel');
    if (wheel && wheel.classList.contains('perk-board')) {
      requestAnimationFrame(() => {
        wrap.scrollLeft = 0;
        wrap.scrollTop = 0;
        updatePerkFullscreenButtonPosition();
      });
      return;
    }
    requestAnimationFrame(() => {
      const layout = applyPerkWheelViewportLayout();
      const nextInsetX = Number.isFinite(layout.insetX) ? layout.insetX : insetX;
      const nextInsetY = Number.isFinite(layout.insetY) ? layout.insetY : insetY;
      const x = nextInsetX + PERK_WHEEL_CENTER * perkWheelZoom - wrap.clientWidth / 2;
      const y = nextInsetY + PERK_WHEEL_CENTER * perkWheelZoom - wrap.clientHeight / 2;
      wrap.scrollLeft = Math.max(0, x);
      wrap.scrollTop = Math.max(0, y);
      updatePerkFullscreenButtonPosition();
    });
  }

  function togglePerkTreeFullscreen() {
    const win = document.getElementById('talents-window');
    if (!win) return;
    win.classList.toggle('perk-tree-fullscreen');
    syncPerkTreeFullscreenButton();
    hidePerkHoverTooltip();
    requestAnimationFrame(() => {
      applyPerkWheelViewportLayout();
      centerPerkWheelView(false);
      updatePerkFullscreenButtonPosition();
    });
  }

  function bindPerkTreeFullscreenButton() {
    const btn = document.getElementById('perk-wheel-fullscreen');
    if (!btn || btn.dataset.boundPerkFullscreen === '1') return;
    btn.dataset.boundPerkFullscreen = '1';
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      togglePerkTreeFullscreen();
    });
    const wrap = document.getElementById('perk-wheel-wrap');
    if (wrap && wrap.dataset.boundFullscreenButtonCamera !== '1') {
      wrap.dataset.boundFullscreenButtonCamera = '1';
      wrap.addEventListener('scroll', updatePerkFullscreenButtonPosition, { passive: true });
    }
    if (!document.body.dataset.boundPerkFullscreenButtonResize) {
      document.body.dataset.boundPerkFullscreenButtonResize = '1';
      window.addEventListener('resize', () => {
        applyPerkWheelViewportLayout();
        updatePerkFullscreenButtonPosition();
      }, { passive: true });
    }
    syncPerkTreeFullscreenButton();
  }

  // Правила расположения дерева перков:
  // 1) каждая ветка получает собственную безопасную полосу, поэтому соседние группы не делят одну линию;
  // 2) все независимые перки раскладываются по жёсткой сетке: боковые ветки — по колонкам уровней и строкам слотов, верхняя/нижняя ветка — зеркально;
  // 3) выравнивание обязательно сохраняется: антиколлизионный проход не имеет права ломать строки и колонки;
  // 4) линии независимых перков выходят не из одной точки, а из отдельных портов хаба, упорядоченных по тому же порядку, что и сами перки — это предотвращает пересечения;
  // 5) независимые линии рисуются ортогонально внутри своей полосы (колено + горизонталь/вертикаль), а не случайной диагональю через дерево;
  // 6) подписи веток обязательно выравниваются по общей оси своей стороны и ставятся вплотную к полосе перков, а не у края полотна;
  // 7) подписи не участвуют в расчёте размеров карты перков, поэтому окно не раздувается искусственно пустыми полями;
  // 8) если у перка нет явного перка-предшественника в требованиях, к нему идёт отдельная линия от хаба ветки;
  // 9) нижняя ветка «Защита и удача» выравнивается по одной высоте, чтобы читаться как единый ряд;
  // 10) размер карты задаётся одним числом в JS и CSS, без разных координат для ПК и телефона.
  const PERK_SUBGROUP_META = [
    { key: 'special', label: 'Характеристики', side: 'top', angle: -90, row: 0, ids: ['specialStr','specialPer','specialEnd','specialCha','specialInt','specialAgi','specialLuck'] },
    { key: 'combat_light', label: 'Лёгкое оружие', side: 'left', angle: -130, row: -600, ids: ['gunslinger', 'automaticMan', 'sharpshooter', 'ambush'] },
    { key: 'combat_heavy', label: 'Тяжёлое, огонь, взрыв', side: 'left', angle: -165, row: -200, ids: ['heavyShooter', 'machineGunner', 'pyromaniac', 'grenadier'] },
    { key: 'combat_energy', label: 'Энергетика', side: 'left', angle: 165, row: 200, ids: ['energyTech'] },
    { key: 'combat_melee', label: 'Ближний бой', side: 'left', angle: 130, row: 600, ids: ['meleeBreaker', 'unarmedFighter'] },
    { key: 'survival_vision', label: 'Обзор и скрытность', side: 'right', angle: -35, row: -600, ids: ['vigilance', 'nightVision', 'awareness', 'ghost'] },
    { key: 'medicine', label: 'Медицина', side: 'right', angle: 0, row: -200, ids: ['fieldMedic', 'quickTreatment', 'surgeon', 'immunologist', 'fieldSurgeon'] },
    { key: 'tech', label: 'Техника', side: 'right', angle: 35, row: 200, ids: ['quickHands', 'engineer', 'weaponSmith', 'recycler'] },
    { key: 'trade', label: 'Торговля и мир', side: 'right', angle: 65, row: 600, ids: ['merchant', 'diplomat', 'scrounger', 'cacheSense'] },
    { key: 'defense_luck', label: 'Защита и удача', side: 'bottom', angle: 105, row: 0, ids: ['actionBoy', 'toughness', 'armorTraining', 'steadfastness', 'lucky', 'secondChance', 'ironBones'] }
  ];

  function perkSubgroupMeta(talent) {
    const id = String(talent?.id || '');
    const group = String(talent?.group || '');
    const found = PERK_SUBGROUP_META.find(meta => Array.isArray(meta.ids) && meta.ids.includes(id));
    if (found) return found;
    if (id.startsWith('special') || group === 'SPECIAL') return PERK_SUBGROUP_META[0];
    return PERK_SUBGROUP_META.find(meta => meta.key === 'survival_vision') || PERK_SUBGROUP_META[0];
  }

  function perkSubgroupIds(meta) {
    return Array.isArray(meta?.ids) ? meta.ids.filter(Boolean) : [];
  }

  function perkSubgroupIndex(meta, talent) {
    const ids = perkSubgroupIds(meta);
    const idx = ids.indexOf(String(talent?.id || ''));
    return idx >= 0 ? idx : 0;
  }

  function perkSubgroupCount(meta) {
    const ids = perkSubgroupIds(meta);
    return Math.max(1, ids.length);
  }

  function perkLevelRing(talent) {
    const level = Number(talent?.req?.level || 3);
    return Math.max(1, Math.min(8, Math.ceil(level / 3)));
  }

  function perkNodeRadius(talent) {
    // Глубина ветки сжата в безопасный диапазон: даже перки 24 уровня не уходят под боковые подписи.
    return 260 + (perkLevelRing(talent) - 1) * 88;
  }

  function perkPolarPoint(radius, angleDeg) {
    const angle = Number(angleDeg || 0) * Math.PI / 180;
    return {
      x: PERK_WHEEL_CENTER + Math.cos(angle) * radius,
      y: PERK_WHEEL_CENTER + Math.sin(angle) * radius
    };
  }

  function perkAtlasEnabled() {
    return PERK_LAYOUT_MODE === 'atlas';
  }

  function perkAtlasRowIndex(meta) {
    return Math.max(0, PERK_SUBGROUP_META.findIndex(entry => entry.key === meta?.key));
  }

  function perkAtlasRowY(meta) {
    return PERK_ATLAS_FIRST_ROW_Y + perkAtlasRowIndex(meta) * PERK_ATLAS_ROW_STEP;
  }

  function perkAtlasNodePoint(meta, talent) {
    const ids = perkSubgroupIds(meta);
    const count = Math.max(1, ids.length);
    const slotIndex = Math.max(0, ids.indexOf(String(talent?.id || '')));
    const span = Math.min((count - 1) * PERK_ATLAS_NODE_STEP, PERK_ATLAS_MAX_NODE_SPAN);
    const step = count > 1 ? span / (count - 1) : 0;
    const x = PERK_ATLAS_NODE_CENTER_X + (slotIndex - (count - 1) / 2) * step;
    return { x, y: perkAtlasRowY(meta) };
  }

  function perkGroupHubPoint(meta) {
    if (perkAtlasEnabled()) return { x: PERK_ATLAS_HUB_X, y: perkAtlasRowY(meta) };
    if (Number.isFinite(Number(meta?.angle))) return perkPolarPoint(PERK_RADIAL_HUB_RADIUS, Number(meta.angle));
    const row = Number(meta?.row || 0);
    if (meta?.side === 'left') return { x: PERK_WHEEL_CENTER - 170, y: PERK_WHEEL_CENTER + row };
    if (meta?.side === 'right') return { x: PERK_WHEEL_CENTER + 170, y: PERK_WHEEL_CENTER + row };
    if (meta?.side === 'top') return { x: PERK_WHEEL_CENTER, y: PERK_WHEEL_CENTER - 260 };
    if (meta?.side === 'bottom') return { x: PERK_WHEEL_CENTER, y: PERK_WHEEL_CENTER + 260 };
    return { x: PERK_WHEEL_CENTER, y: PERK_WHEEL_CENTER };
  }

  function emptyPerkLaneBounds() {
    return {
      left: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      right: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      top: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      bottom: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    };
  }

  function collectPerkLaneBounds(entries) {
    const bounds = emptyPerkLaneBounds();
    entries.forEach(entry => {
      const side = entry?.meta?.side || 'right';
      const target = bounds[side] || (bounds[side] = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
      target.minX = Math.min(target.minX, entry.x);
      target.maxX = Math.max(target.maxX, entry.x);
      target.minY = Math.min(target.minY, entry.y);
      target.maxY = Math.max(target.maxY, entry.y);
    });
    return bounds;
  }

  function perkBranchLabelPoint(meta, laneBounds) {
    if (perkAtlasEnabled()) return { x: PERK_ATLAS_LABEL_X, y: perkAtlasRowY(meta) };
    if (Number.isFinite(Number(meta?.angle))) return perkPolarPoint(PERK_RADIAL_LABEL_RADIUS, Number(meta.angle));
    const row = Number(meta?.row || 0);
    const side = meta?.side || 'right';
    const sideBounds = laneBounds?.[side] || {};
    if (side === 'left') return { x: Math.max(PERK_BRANCH_LABEL_EDGE_PAD, (Number.isFinite(sideBounds.minX) ? sideBounds.minX : PERK_WHEEL_CENTER - 760) - PERK_BRANCH_LABEL_SIDE_GAP), y: PERK_WHEEL_CENTER + row };
    if (side === 'right') return { x: Math.min(PERK_WHEEL_SIZE - PERK_BRANCH_LABEL_EDGE_PAD, (Number.isFinite(sideBounds.maxX) ? sideBounds.maxX : PERK_WHEEL_CENTER + 760) + PERK_BRANCH_LABEL_SIDE_GAP), y: PERK_WHEEL_CENTER + row };
    if (side === 'top') return { x: PERK_WHEEL_CENTER, y: Math.max(56, (Number.isFinite(sideBounds.minY) ? sideBounds.minY : PERK_WHEEL_CENTER - 680) - PERK_BRANCH_LABEL_VERTICAL_GAP) };
    if (side === 'bottom') return { x: PERK_WHEEL_CENTER, y: Math.min(PERK_WHEEL_SIZE - 56, (Number.isFinite(sideBounds.maxY) ? sideBounds.maxY : PERK_BOTTOM_ROW_Y) + PERK_BRANCH_LABEL_VERTICAL_GAP) };
    return { x: PERK_WHEEL_CENTER, y: PERK_WHEEL_CENTER };
  }

  function perkSideLabelPoint(side, laneBounds) {
    const sideBounds = laneBounds?.[side] || {};
    if (side === 'left') {
      const anchorX = Math.max(72, (Number.isFinite(sideBounds.minX) ? sideBounds.minX : PERK_WHEEL_CENTER - 760) - PERK_BRANCH_LABEL_SIDE_GAP - PERK_SIDE_LABEL_GAP);
      const centerY = Number.isFinite(sideBounds.minY) && Number.isFinite(sideBounds.maxY) ? (sideBounds.minY + sideBounds.maxY) / 2 : PERK_WHEEL_CENTER;
      return { x: anchorX, y: centerY };
    }
    if (side === 'right') {
      const anchorX = Math.min(PERK_WHEEL_SIZE - 72, (Number.isFinite(sideBounds.maxX) ? sideBounds.maxX : PERK_WHEEL_CENTER + 760) + PERK_BRANCH_LABEL_SIDE_GAP + PERK_SIDE_LABEL_GAP);
      const centerY = Number.isFinite(sideBounds.minY) && Number.isFinite(sideBounds.maxY) ? (sideBounds.minY + sideBounds.maxY) / 2 : PERK_WHEEL_CENTER;
      return { x: anchorX, y: centerY };
    }
    return { x: PERK_WHEEL_CENTER, y: PERK_WHEEL_CENTER };
  }

  function perkPrerequisiteEntry(entry, entryMap) {
    const req = entry?.talent?.req || {};
    const prerequisiteId = req.talent || req.perk || req.requiresTalent || null;
    return prerequisiteId && entryMap.has(prerequisiteId) ? entryMap.get(prerequisiteId) : null;
  }

  function assignPerkHubPorts(entries, groupHubs) {
    const ports = new Map();
    PERK_SUBGROUP_META.forEach(meta => {
      const list = entries.filter(entry => entry?.meta?.key === meta.key);
      if (!list.length) return;
      const hub = groupHubs.get(meta.key);
      if (!hub) return;
      const sorted = list.slice().sort((a, b) => {
        if (meta.side === 'left' || meta.side === 'right') return a.y - b.y || a.x - b.x;
        return a.x - b.x || a.y - b.y;
      });
      const span = (sorted.length - 1) * PERK_HUB_PORT_STEP;
      const start = -span / 2;
      sorted.forEach((entry, idx) => {
        if (perkAtlasEnabled()) {
          ports.set(entry.talent.id, { x: hub.x, y: hub.y });
          return;
        }
        if (Number.isFinite(Number(meta.angle))) {
          const dx = entry.x - hub.x;
          const dy = entry.y - hub.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          ports.set(entry.talent.id, {
            x: hub.x + dx / len * PERK_HUB_PORT_OFFSET,
            y: hub.y + dy / len * PERK_HUB_PORT_OFFSET
          });
          return;
        }
        const shift = start + idx * PERK_HUB_PORT_STEP;
        let point = { x: hub.x, y: hub.y };
        if (meta.side === 'left') point = { x: hub.x - PERK_HUB_PORT_OFFSET, y: hub.y + shift };
        else if (meta.side === 'right') point = { x: hub.x + PERK_HUB_PORT_OFFSET, y: hub.y + shift };
        else if (meta.side === 'top') point = { x: hub.x + shift, y: hub.y - PERK_HUB_PORT_OFFSET };
        else if (meta.side === 'bottom') point = { x: hub.x + shift, y: hub.y + PERK_HUB_PORT_OFFSET };
        ports.set(entry.talent.id, point);
      });
    });
    return ports;
  }

  function perkRadialLinkPath(entry, source, curveScale = 0.16) {
    const sx = source.x;
    const sy = source.y;
    const tx = entry.x;
    const ty = entry.y;
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.max(1, Math.hypot(dx, dy));
    const curve = Math.min(72, len * curveScale);
    const direction = entry?.meta?.side === 'left' || entry?.meta?.side === 'top' ? -1 : 1;
    const cx = (sx + tx) / 2 - (dy / len) * curve * direction;
    const cy = (sy + ty) / 2 + (dx / len) * curve * direction;
    return `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
  }

  function perkDependencyPath(entry, source) {
    if (perkAtlasEnabled()) {
      const sx = source.x;
      const sy = source.y;
      const tx = entry.x;
      const ty = entry.y;
      const midX = (sx + tx) / 2;
      return `M ${sx} ${sy} H ${midX} V ${ty} H ${tx}`;
    }
    if (Number.isFinite(Number(entry?.meta?.angle))) return perkRadialLinkPath(entry, source, 0.14);
    const side = entry?.meta?.side || 'right';
    const sx = source.x;
    const sy = source.y;
    const tx = entry.x;
    const ty = entry.y;
    if (side === 'left') {
      const elbowX = Math.min(sx, tx) - PERK_DEPENDENCY_ELBOW;
      return `M ${sx} ${sy} H ${elbowX} V ${ty} H ${tx}`;
    }
    if (side === 'right') {
      const elbowX = Math.max(sx, tx) + PERK_DEPENDENCY_ELBOW;
      return `M ${sx} ${sy} H ${elbowX} V ${ty} H ${tx}`;
    }
    if (side === 'top') {
      const elbowY = Math.min(sy, ty) - PERK_DEPENDENCY_ELBOW;
      return `M ${sx} ${sy} V ${elbowY} H ${tx} V ${ty}`;
    }
    if (side === 'bottom') {
      const elbowY = Math.max(sy, ty) + PERK_DEPENDENCY_ELBOW;
      return `M ${sx} ${sy} V ${elbowY} H ${tx} V ${ty}`;
    }
    return `M ${sx} ${sy} L ${tx} ${ty}`;
  }

  function perkIndependentPath(entry, source) {
    if (perkAtlasEnabled()) {
      const sx = source.x;
      const sy = source.y;
      return `M ${sx} ${sy} H ${entry.x}`;
    }
    if (Number.isFinite(Number(entry?.meta?.angle))) return perkRadialLinkPath(entry, source, 0.18);
    const side = entry?.meta?.side || 'right';
    const sx = source.x;
    const sy = source.y;
    const tx = entry.x;
    const ty = entry.y;
    if (side === 'left') {
      const elbowX = Math.min(sx, tx) - PERK_LINK_ELBOW;
      return `M ${sx} ${sy} H ${elbowX} V ${ty} H ${tx}`;
    }
    if (side === 'right') {
      const elbowX = Math.max(sx, tx) + PERK_LINK_ELBOW;
      return `M ${sx} ${sy} H ${elbowX} V ${ty} H ${tx}`;
    }
    if (side === 'top') {
      const elbowY = Math.min(sy, ty) - PERK_LINK_ELBOW;
      return `M ${sx} ${sy} V ${elbowY} H ${tx} V ${ty}`;
    }
    if (side === 'bottom') {
      const elbowY = Math.max(sy, ty) + PERK_LINK_ELBOW;
      return `M ${sx} ${sy} V ${elbowY} H ${tx} V ${ty}`;
    }
    return `M ${sx} ${sy} L ${tx} ${ty}`;
  }

  function perkNodeDesiredPoint(meta, talent, indexInCell, countInCell) {
    const side = meta?.side || 'right';
    if (perkAtlasEnabled()) return perkAtlasNodePoint(meta, talent);
    if (Number.isFinite(Number(meta?.angle))) {
      const slotIndex = perkSubgroupIndex(meta, talent);
      const slotCount = perkSubgroupCount(meta);
      const slotMiddle = (slotCount - 1) / 2;
      const slotDelta = slotIndex - slotMiddle;
      const slotNorm = slotMiddle > 0 ? slotDelta / slotMiddle : 0;
      const stackDelta = indexInCell - (Math.max(1, countInCell) - 1) / 2;
      const step = (side === 'top' || side === 'bottom') ? PERK_RADIAL_WIDE_ANGLE_STEP : PERK_RADIAL_ANGLE_STEP;
      const angle = Number(meta.angle) + slotDelta * step + stackDelta * PERK_RADIAL_STACK_ANGLE_STEP;
      const levelIndex = Math.max(0, perkLevelRing(talent) - 1);
      const radius = PERK_RADIAL_NODE_RADIUS + levelIndex * PERK_RADIAL_LEVEL_STEP + Math.abs(slotNorm) * PERK_RADIAL_SLOT_RADIUS;
      return perkPolarPoint(radius, angle);
    }
    const row = Number(meta?.row || 0);
    const slotIndex = perkSubgroupIndex(meta, talent);
    const slotCount = perkSubgroupCount(meta);
    const slotMiddle = (slotCount - 1) / 2;
    const slotDelta = slotIndex - slotMiddle;
    const slotNorm = slotMiddle > 0 ? slotDelta / slotMiddle : 0;
    const laneOffset = slotDelta * PERK_BRANCH_SLOT_STEP;
    const levelIndex = Math.max(0, perkLevelRing(talent) - 1);
    const stackOffset = (indexInCell - (Math.max(1, countInCell) - 1) / 2) * PERK_CELL_STACK_STEP;
    const sideDepth = PERK_BRANCH_DEPTH_START + levelIndex * PERK_SIDE_LEVEL_STEP + Math.abs(slotNorm) * PERK_SIDE_SLOT_FAN;
    const topArch = Math.abs(slotNorm) * Math.abs(slotNorm) * PERK_TOP_SLOT_ARCH;
    const bottomArch = Math.abs(slotNorm) * Math.abs(slotNorm) * PERK_BOTTOM_SLOT_ARCH;

    if (side === 'left') {
      return { x: PERK_WHEEL_CENTER - sideDepth, y: PERK_WHEEL_CENTER + row + laneOffset + stackOffset };
    }
    if (side === 'right') {
      return { x: PERK_WHEEL_CENTER + sideDepth, y: PERK_WHEEL_CENTER + row + laneOffset + stackOffset };
    }
    if (side === 'top') {
      return { x: PERK_WHEEL_CENTER + laneOffset + stackOffset, y: PERK_WHEEL_CENTER - 610 - levelIndex * PERK_TOP_LEVEL_STEP - topArch };
    }
    if (side === 'bottom') {
      return { x: PERK_WHEEL_CENTER + laneOffset + stackOffset, y: PERK_BOTTOM_ROW_Y + bottomArch };
    }
    return { x: PERK_WHEEL_CENTER, y: PERK_WHEEL_CENTER };
  }

  function clampPerkPoint(point) {
    point.x = Math.max(PERK_NODE_MARGIN, Math.min(PERK_WHEEL_SIZE - PERK_NODE_MARGIN, point.x));
    point.y = Math.max(PERK_NODE_MARGIN, Math.min(PERK_WHEEL_SIZE - PERK_NODE_MARGIN, point.y));
    return point;
  }

  function resolvePerkLayoutCollisions(entries) {
    // Сетка задаёт выравнивание строк и колонок. Поэтому здесь мы не двигаем узлы свободно,
    // а только подрезаем их в пределах полотна. Иначе теряется визуальное выравнивание,
    // на которое пользователь явно опирается.
    entries.forEach(entry => clampPerkPoint(entry));
  }

  function ensurePerkHoverTooltip() {


    let tip = document.getElementById('perk-hover-tooltip');
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = 'perk-hover-tooltip';
    tip.className = 'perk-hover-tooltip';
    tip.style.display = 'none';
    document.body.appendChild(tip);
    return tip;
  }

  function movePerkHoverTooltip(e) {
    const tip = ensurePerkHoverTooltip();
    const pad = 18;
    const rect = tip.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + rect.width + 12 > window.innerWidth) x = Math.max(12, e.clientX - rect.width - pad);
    if (y + rect.height + 12 > window.innerHeight) y = Math.max(12, e.clientY - rect.height - pad);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function showPerkHoverTooltip(e, talent, groupLabel, level, rank, maxed, reqMet) {
    const tip = ensurePerkHoverTooltip();
    const noPoints = !maxed && reqMet && player.perkPoints <= 0;
    const state = maxed ? 'изучен полностью' : (reqMet ? (noPoints ? 'доступен, но нет очков перков' : 'можно изучить') : 'недоступен');
    const formula = talentFormulaText(talent);
    tip.innerHTML = `
      <div class="perk-tip-title"><span>${escapeHtml(talent.icon)}</span><b>${escapeHtml(talent.name)}</b></div>
      <div class="perk-tip-state ${maxed ? 'maxed' : (reqMet && !noPoints ? 'available' : 'locked')}">${escapeHtml(state)} · ранг ${rank}/${talent.max}</div>
      <div class="perk-tip-desc">${escapeHtml(talent.desc)}</div>
      <div class="perk-tip-formula">${escapeHtml(formula)}</div>
      <div class="perk-tip-req">Требования: ${escapeHtml(talentRequirementText(talent))}</div>
    `;
    tip.style.display = 'block';
    movePerkHoverTooltip(e);
  }

  function hidePerkHoverTooltip() {
    const tip = document.getElementById('perk-hover-tooltip');
    if (tip) tip.style.display = 'none';
  }

  
  
  function initPerkWheelPan() {
    const wrap = document.getElementById('perk-wheel-wrap');
    const wheel = document.getElementById('perk-wheel');
    if (!wrap || !wheel) return;
    if (wheel.classList.contains('perk-board')) {
      applyPerkWheelViewportLayout();
      updatePerkFullscreenButtonPosition();
      return;
    }

    const applyZoom = (nextZoom, clientX = null, clientY = null) => {
      nextZoom = Math.max(PERK_WHEEL_MIN_ZOOM, Math.min(PERK_WHEEL_MAX_ZOOM, Number(nextZoom) || perkWheelZoom));
      if (Math.abs(nextZoom - perkWheelZoom) < 0.001) return;
      const rect = wrap.getBoundingClientRect();
      const localX = clientX == null ? wrap.clientWidth / 2 : Math.max(0, Math.min(wrap.clientWidth, clientX - rect.left));
      const localY = clientY == null ? wrap.clientHeight / 2 : Math.max(0, Math.min(wrap.clientHeight, clientY - rect.top));
      const oldInsets = currentPerkWheelInsets(wrap);
      const worldX = (wrap.scrollLeft + localX - oldInsets.x) / Math.max(0.01, perkWheelZoom);
      const worldY = (wrap.scrollTop + localY - oldInsets.y) / Math.max(0.01, perkWheelZoom);
      perkWheelZoom = nextZoom;
      applyPerkWheelViewportLayout();
      requestAnimationFrame(() => {
        const layout = applyPerkWheelViewportLayout();
        wrap.scrollLeft = layout.insetX > 0 ? 0 : Math.max(0, layout.insetX + worldX * perkWheelZoom - localX);
        wrap.scrollTop = layout.insetY > 0 ? 0 : Math.max(0, layout.insetY + worldY * perkWheelZoom - localY);
        updatePerkFullscreenButtonPosition();
      });
    };

    const zoomBy = (factor, clientX = null, clientY = null) => applyZoom(perkWheelZoom * factor, clientX, clientY);

    applyPerkWheelViewportLayout();

    if (!wrap.dataset.centered) {
      requestAnimationFrame(() => {
        centerPerkWheelView(false);
        wrap.dataset.centered = '1';
      });
    }

    if (wrap.dataset.panBound !== '1') {
      wrap.dataset.panBound = '1';
      let active = false;
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;

      const startPan = e => {
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('.perk-node, .progression-tab, .window-x, button')) return;
        active = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = wrap.scrollLeft;
        startTop = wrap.scrollTop;
        wrap.classList.add('panning');
        wrap.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      };
      const movePan = e => {
        if (!active) return;
        const insets = currentPerkWheelInsets(wrap);
        wrap.scrollLeft = insets.x > 0 ? 0 : startLeft - (e.clientX - startX);
        wrap.scrollTop = insets.y > 0 ? 0 : startTop - (e.clientY - startY);
        e.preventDefault();
      };
      const stopPan = e => {
        if (!active) return;
        active = false;
        wrap.classList.remove('panning');
        try { wrap.releasePointerCapture?.(e.pointerId); } catch (_) {}
      };
      const handleWheelZoom = e => {
        const win = document.getElementById('talents-window');
        if (!win || !win.classList.contains('visible') || progressionMode !== 'perks') return;
        if (!wrap.contains(e.target) && e.target !== wrap) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        zoomBy(e.deltaY < 0 ? 1.14 : 1 / 1.14, e.clientX, e.clientY);
      };

      wrap.addEventListener('pointerdown', startPan);
      wrap.addEventListener('pointermove', movePan);
      wrap.addEventListener('pointerup', stopPan);
      wrap.addEventListener('pointercancel', stopPan);
      wrap.addEventListener('mouseleave', () => { active = false; wrap.classList.remove('panning'); });
      wrap.addEventListener('dblclick', e => { if (!e.target?.closest?.('.perk-node')) centerPerkWheelView(true); });
      wrap.addEventListener('wheel', handleWheelZoom, { passive: false, capture: true });
      wheel.addEventListener('wheel', handleWheelZoom, { passive: false, capture: true });
      document.addEventListener('wheel', handleWheelZoom, { passive: false, capture: true });
    }

  }

  function perkWheelInfoHtml(talent) {
    if (!talent) return 'Выберите узел перка.';
    const rank = talentLevel(talent.id);
    const maxed = rank >= talent.max;
    const req = talentRequirementText(talent);
    const state = maxed ? 'изучен полностью' : (talentRequirementsMet(talent) ? (player.perkPoints > 0 ? 'доступен для изучения' : 'доступен, но нет свободных очков перков') : 'недоступен');
    return `<b>${escapeHtml(talent.icon)} ${escapeHtml(talent.name)}</b> · ранг ${rank}/${talent.max} · ${escapeHtml(state)}<br>${escapeHtml(talent.desc)}<br>${escapeHtml(talentFormulaText(talent))}<br><span class="talent-req">Требования: ${escapeHtml(req)}</span>`;
  }

  function perkCategoryOptions() {
    return [
      { key: 'available', label: 'Доступные', desc: 'Перки, требования которых уже выполнены.' },
      { key: 'all', label: 'Все', desc: 'Полный список перков по веткам развития.' },
      ...PERK_SUBGROUP_META.map(meta => ({ key: meta.key, label: meta.label, desc: perkCategoryDescription(meta) }))
    ];
  }

  function perkCategoryIcon(key) {
    const icons = {
      available: '★',
      all: '☰',
      special: 'S',
      combat_light: '⌁',
      combat_heavy: '▰',
      combat_energy: '⚡',
      combat_melee: '✦',
      survival_vision: '◌',
      medicine: '+',
      tech: '⚙',
      trade: '◇',
      defense_luck: '◆'
    };
    return icons[key] || '•';
  }

  function perkCategoryState(key) {
    const talents = key === 'available' ? allOrderedPerks() : perksForCategory(key);
    const relevant = key === 'available' ? talents.filter(talent => talentLevel(talent.id) < talent.max && talentRequirementsMet(talent)) : talents;
    if (!relevant.length) return 'empty';
    if (relevant.some(talent => perkStateInfo(talent).canLearn)) return 'ready';
    if (relevant.every(talent => perkStateInfo(talent).maxed)) return 'done';
    if (relevant.some(talent => perkStateInfo(talent).noPoints)) return 'points';
    return 'locked';
  }

  function perkCategoryStateText(state) {
    if (state === 'ready') return 'есть выбор';
    if (state === 'points') return 'нет очков';
    if (state === 'done') return 'изучено';
    if (state === 'locked') return 'закрыто';
    return 'нет';
  }

  function learnedPerkRanks() {
    return TALENTS.reduce((sum, talent) => sum + talentLevel(talent.id), 0);
  }

  function totalPerkRanks() {
    return TALENTS.reduce((sum, talent) => sum + (talent.max || 1), 0);
  }

  function compactText(text = '', limit = 132) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;
    return `${clean.slice(0, Math.max(0, limit - 1)).trim()}…`;
  }

  function normalizePerkSearch(text = '') {
    return String(text || '').toLocaleLowerCase('ru').replace(/\s+/g, ' ').trim();
  }

  function perkSearchHaystack(talent) {
    const meta = perkSubgroupMeta(talent);
    return normalizePerkSearch([
      talent?.name,
      talent?.desc,
      talent?.id,
      meta?.label,
      talentFormulaText(talent),
      talentRequirementText(talent)
    ].filter(Boolean).join(' '));
  }

  function perkMatchesSearch(talent, query = perkSearchText) {
    const clean = normalizePerkSearch(query);
    if (!clean) return true;
    return clean.split(' ').every(part => perkSearchHaystack(talent).includes(part));
  }

  function perkSearchActive() {
    return normalizePerkSearch(perkSearchText).length > 0;
  }

  function perkStateFilterActive() {
    return selectedPerkStateFilter !== 'all';
  }

  function perkMatchesStateFilter(talent, filter = selectedPerkStateFilter) {
    if (!filter || filter === 'all') return true;
    const state = perkStateInfo(talent);
    if (filter === 'ready') return !state.maxed && state.reqMet;
    if (filter === 'locked') return !state.maxed && !state.reqMet;
    if (filter === 'done') return talentLevel(talent.id) > 0;
    return true;
  }

  function visiblePerksForBoard(categoryKey) {
    const base = perkSearchActive() ? allOrderedPerks() : perksForCategory(categoryKey);
    return sortedPerkChoices(base.filter(talent => perkMatchesSearch(talent) && perkMatchesStateFilter(talent)));
  }

  function perkNextStepText(talent, state = perkStateInfo(talent)) {
    if (state.maxed) return 'Изучен полностью';
    if (state.canLearn) return 'Можно изучить';
    if (state.noPoints) return 'Нужно очко перка';
    const missing = talentRequirementRows(talent).filter(row => !row.ok).map(row => row.text);
    if (missing.length) return `Нужно: ${missing.slice(0, 2).join(', ')}`;
    return state.label;
  }

  function perkNextRankText(talent, state = perkStateInfo(talent)) {
    if (state.maxed) return `Ранг ${state.rank}/${talent.max}`;
    return `Следующий ранг ${state.rank + 1}/${talent.max}`;
  }

  function perkRequirementChipsHtml(talent) {
    const rows = talentRequirementRows(talent);
    if (!rows.length) return '<span class="perk-req-chip ok">Без требований</span>';
    const visible = rows.slice(0, 3).map(row => `<span class="perk-req-chip ${row.ok ? 'ok' : 'bad'}">${row.ok ? '✓' : '×'} ${escapeHtml(row.text)}</span>`);
    if (rows.length > 3) visible.push(`<span class="perk-req-chip more">+${rows.length - 3}</span>`);
    return visible.join('');
  }

  function perkCategoryDescription(meta) {
    const descriptions = {
      special: 'Усиление SPECIAL и базовых параметров персонажа.',
      combat_light: 'Пистолеты, винтовки, очереди и точные выстрелы.',
      combat_heavy: 'Тяжелое оружие, взрывы и подавление.',
      combat_energy: 'Энергетическое оружие и стабильность выстрелов.',
      combat_melee: 'Ближний бой и атаки без оружия.',
      survival_vision: 'Обзор, скрытность, ночное зрение и разведка.',
      medicine: 'Лечение, хирургия и сопротивление осложнениям.',
      tech: 'Взлом, терминалы, ремонт, крафт и разбор.',
      trade: 'Торговля, диалоги, награды и находки.',
      defense_luck: 'Живучесть, броня, удача и спасение от смерти.'
    };
    return descriptions[meta?.key] || 'Перки этой ветки развития.';
  }

  function orderedPerksForMeta(meta) {
    const ids = perkSubgroupIds(meta);
    const byId = new Map(TALENTS.map(talent => [talent.id, talent]));
    const known = ids.map(id => byId.get(id)).filter(Boolean);
    const extras = TALENTS
      .filter(talent => perkSubgroupMeta(talent)?.key === meta?.key && !ids.includes(talent.id))
      .sort((a, b) => perkLevelRequirement(a) - perkLevelRequirement(b) || a.name.localeCompare(b.name, 'ru'));
    return known.concat(extras);
  }

  function allOrderedPerks() {
    const seen = new Set();
    const list = [];
    PERK_SUBGROUP_META.forEach(meta => {
      orderedPerksForMeta(meta).forEach(talent => {
        if (seen.has(talent.id)) return;
        seen.add(talent.id);
        list.push(talent);
      });
    });
    TALENTS.forEach(talent => {
      if (!seen.has(talent.id)) list.push(talent);
    });
    return list;
  }

  function perksForCategory(key) {
    if (key === 'available') {
      return allOrderedPerks()
        .filter(talent => talentLevel(talent.id) < talent.max && talentRequirementsMet(talent))
        .sort((a, b) => perkCategorySortIndex(a) - perkCategorySortIndex(b) || perkLevelRequirement(a) - perkLevelRequirement(b) || a.name.localeCompare(b.name, 'ru'));
    }
    if (key === 'all') return allOrderedPerks();
    const meta = PERK_SUBGROUP_META.find(entry => entry.key === key) || PERK_SUBGROUP_META[0];
    return orderedPerksForMeta(meta);
  }

  function perkChoiceSortValue(talent) {
    const state = perkStateInfo(talent);
    if (state.canLearn) return 0;
    if (state.noPoints) return 1;
    if (!state.maxed && state.reqMet) return 2;
    if (!state.maxed) return 3;
    return 4;
  }

  function sortedPerkChoices(talents = []) {
    return talents.slice().sort((a, b) => {
      const stateSort = perkChoiceSortValue(a) - perkChoiceSortValue(b);
      if (stateSort) return stateSort;
      const categorySort = perkCategorySortIndex(a) - perkCategorySortIndex(b);
      if (categorySort) return categorySort;
      return perkLevelRequirement(a) - perkLevelRequirement(b) || a.name.localeCompare(b.name, 'ru');
    });
  }

  function perkBoardSections(categoryKey, talents = []) {
    if (categoryKey === 'all') {
      const sections = [];
      PERK_SUBGROUP_META.forEach(meta => {
        const list = sortedPerkChoices(talents.filter(talent => perkSubgroupMeta(talent)?.key === meta.key));
        if (list.length) sections.push({ title: meta.label, talents: list });
      });
      return sections;
    }
    if (categoryKey === 'available') {
      return [{ title: 'Можно изучить сейчас', talents: sortedPerkChoices(talents) }];
    }
    const buckets = [
      { key: 'ready', title: 'Можно изучить', test: talent => {
        const state = perkStateInfo(talent);
        return !state.maxed && state.reqMet;
      } },
      { key: 'locked', title: 'Закрытые', test: talent => !perkStateInfo(talent).reqMet && !perkStateInfo(talent).maxed },
      { key: 'done', title: 'Изученные', test: talent => perkStateInfo(talent).maxed }
    ];
    return buckets
      .map(bucket => ({ title: bucket.title, talents: sortedPerkChoices(talents.filter(bucket.test)) }))
      .filter(section => section.talents.length);
  }

  function perkCategorySortIndex(talent) {
    const meta = perkSubgroupMeta(talent);
    const groupIndex = PERK_SUBGROUP_META.findIndex(entry => entry.key === meta?.key);
    const idIndex = perkSubgroupIds(meta).indexOf(talent?.id);
    return (Math.max(0, groupIndex) * 100) + (idIndex >= 0 ? idIndex : 99);
  }

  function perkLevelRequirement(talent) {
    return Number(talent?.req?.level || 3);
  }

  function perkStateInfo(talent) {
    const rank = talentLevel(talent.id);
    const maxed = rank >= talent.max;
    const reqMet = talentRequirementsMet(talent);
    const noPoints = !maxed && reqMet && player.perkPoints <= 0;
    const canLearn = !maxed && reqMet && player.perkPoints > 0;
    return {
      rank,
      maxed,
      reqMet,
      noPoints,
      canLearn,
      className: maxed ? 'maxed' : (canLearn ? 'available' : (noPoints ? 'no-points' : 'locked')),
      label: maxed ? 'Изучен' : (canLearn ? 'Можно изучить' : (noPoints ? 'Нет очков' : 'Закрыт'))
    };
  }

  function perkRequirementListHtml(talent) {
    const rows = typeof talentRequirementRows === 'function' ? talentRequirementRows(talent) : [];
    if (!rows.length) return '<div class="perk-detail-req ok">Требований нет</div>';
    return rows.map(row => `<div class="perk-detail-req ${row.ok ? 'ok' : 'bad'}"><span>${row.ok ? '✓' : '×'}</span>${escapeHtml(row.text)}</div>`).join('');
  }

  function requestTalentUpgradeConfirmation(talent) {
    if (!talent) return;
    const state = perkStateInfo(talent);
    if (!state.canLearn) {
      learnTalent(talent.id);
      return;
    }
    const nextRank = state.rank + 1;
    if (typeof openGameConfirmPanel === 'function') {
      return openGameConfirmPanel({
        kicker: 'PIP-ASH / Перки',
        title: 'Изучить перк?',
        itemName: talent.name,
        iconText: talent.icon || '★',
        body: `Ранг ${state.rank}/${talent.max} -> ${nextRank}/${talent.max}. ${talent.desc}`,
        note: `Будет потрачено 1 очко перка. Свободно: ${player.perkPoints} -> ${Math.max(0, player.perkPoints - 1)}. Требования: ${talentRequirementText(talent)}.`,
        confirmLabel: 'Изучить',
        cancelLabel: 'Не сейчас',
        onConfirm: () => learnTalent(talent.id),
        onCancel: () => setReadout('Изучение перка отменено.')
      });
    }
    setReadout('Игровое окно подтверждения недоступно. Перезагрузите интерфейс и попробуйте снова.');
  }

  function renderPerkDetail(detail, talent) {
    if (!detail) return;
    if (!talent) {
      detail.innerHTML = `
        <div class="perk-detail-empty">
          <b>Нет доступных перков</b>
          <span>Повышайте уровень, навыки и SPECIAL, чтобы открыть новые ветки.</span>
        </div>
      `;
      return;
    }
    const meta = perkSubgroupMeta(talent);
    const state = perkStateInfo(talent);
    const nextStep = perkNextStepText(talent, state);
    detail.innerHTML = `
      <div class="perk-detail-kicker"><span>${escapeHtml(meta?.label || 'Перки')}</span><span>${escapeHtml(state.label)}</span></div>
      <div class="perk-detail-title"><span>${escapeHtml(talent.icon)}</span><b>${escapeHtml(talent.name)}</b></div>
      <div class="perk-detail-state ${state.className}">
        <span>Ранг ${state.rank}/${talent.max}</span>
        <span>Ур. ${perkLevelRequirement(talent)}</span>
        <span>${escapeHtml(state.label)}</span>
      </div>
      <div class="perk-detail-next ${state.className}">
        <b>${escapeHtml(perkNextRankText(talent, state))}</b>
        <span>${escapeHtml(state.canLearn ? 'Готов к изучению' : nextStep)}</span>
      </div>
      <div class="perk-detail-block">
        <div class="perk-detail-block-title">Эффект</div>
        <div class="perk-detail-desc">${escapeHtml(talent.desc)}</div>
      </div>
      <div class="perk-detail-block">
        <div class="perk-detail-block-title">Формула</div>
        <div class="perk-detail-formula">${escapeHtml(talentFormulaText(talent))}</div>
      </div>
      <div class="perk-detail-block">
        <div class="perk-detail-block-title">Требования</div>
        <div class="perk-detail-reqs">${perkRequirementListHtml(talent)}</div>
      </div>
      <button type="button" class="perk-detail-learn" data-learn-perk="${escapeHtml(talent.id)}" ${state.canLearn ? '' : 'disabled'}>
        ${state.maxed ? 'Изучен полностью' : (state.canLearn ? 'Изучить перк' : state.label)}
      </button>
    `;
    const learnBtn = detail.querySelector('[data-learn-perk]');
    if (learnBtn) {
      learnBtn.addEventListener('click', e => {
        e.preventDefault();
        requestTalentUpgradeConfirmation(talent);
      });
    }
  }

  
  
  function renderPerkWheel() {
    const wheel = document.getElementById('perk-wheel');
    const info = document.getElementById('perk-wheel-info');
    if (!wheel) return;
    bindPerkTreeFullscreenButton();
    if (info) info.innerHTML = '';
    hidePerkHoverTooltip();

    wheel.innerHTML = '';
    wheel.className = 'perk-wheel perk-board';
    wheel.setAttribute('aria-label', 'Список перков');
    ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'zoom', 'transform-origin'].forEach(prop => wheel.style.removeProperty(prop));
    const wrap = document.getElementById('perk-wheel-wrap');
    if (wrap) {
      wrap.classList.add('perk-board-wrap');
      wrap.classList.remove('panning');
      wrap.dataset.centered = '1';
    }

    const availableNow = sortedPerkChoices(perksForCategory('available'));
    if (selectedPerkCategory === 'available' && !availableNow.length && !selectedPerkId) selectedPerkCategory = 'all';
    const categories = perkCategoryOptions();
    if (!categories.some(category => category.key === selectedPerkCategory)) selectedPerkCategory = 'all';

    const searchActive = perkSearchActive();
    const stateFilterActive = perkStateFilterActive();
    let visibleTalents = visiblePerksForBoard(selectedPerkCategory);
    if (!searchActive && !stateFilterActive && !visibleTalents.length && selectedPerkCategory !== 'all') {
      selectedPerkCategory = 'all';
      visibleTalents = visiblePerksForBoard(selectedPerkCategory);
    }
    if (visibleTalents.length && !visibleTalents.some(talent => talent.id === selectedPerkId)) selectedPerkId = visibleTalents[0].id;
    if (!visibleTalents.length) selectedPerkId = '';
    const selectedTalent = visibleTalents.find(talent => talent.id === selectedPerkId) || visibleTalents[0] || null;
    if (selectedTalent) selectedPerkId = selectedTalent.id;

    const shell = document.createElement('div');
    shell.className = 'perk-board-shell';
    const selectedCategory = categories.find(category => category.key === selectedPerkCategory) || categories[0];
    const boardTitle = searchActive ? 'Поиск перков' : (selectedCategory?.label || 'Перки');
    const boardDesc = searchActive ? 'Совпадения по названию, эффекту, формуле и требованиям.' : (selectedCategory?.desc || 'Развитие персонажа.');
    const boardIcon = searchActive ? '⌕' : perkCategoryIcon(selectedCategory?.key);
    shell.innerHTML = `
      <div class="perk-board-status">
        <div class="primary"><span>Очки перков</span><b>${player.perkPoints}</b></div>
        <div><span>Уровень</span><b>${player.level}</b></div>
        <div><span>Доступно</span><b>${availableNow.length}</b></div>
        <div><span>Изучено</span><b>${learnedPerkRanks()}</b></div>
        <div class="wide"><span>Раздел</span><b>${escapeHtml(boardTitle)}</b></div>
      </div>
      <div class="perk-board-focus">
        <div>
          <span>${escapeHtml(boardIcon)}</span>
          <b>${escapeHtml(boardTitle)}</b>
          <small>${escapeHtml(boardDesc)}</small>
        </div>
        <label class="perk-board-search" for="perk-board-search">
          <span>Поиск</span>
          <input id="perk-board-search" type="search" autocomplete="off" spellcheck="false" value="${escapeHtml(perkSearchText)}" placeholder="название, эффект, требование">
        </label>
        <div class="perk-board-legend" aria-label="Фильтр состояния перков">
          <button type="button" class="ready${selectedPerkStateFilter === 'ready' ? ' active' : ''}" data-perk-state-filter="ready" aria-pressed="${selectedPerkStateFilter === 'ready' ? 'true' : 'false'}">Можно</button>
          <button type="button" class="locked${selectedPerkStateFilter === 'locked' ? ' active' : ''}" data-perk-state-filter="locked" aria-pressed="${selectedPerkStateFilter === 'locked' ? 'true' : 'false'}">Закрыт</button>
          <button type="button" class="done${selectedPerkStateFilter === 'done' ? ' active' : ''}" data-perk-state-filter="done" aria-pressed="${selectedPerkStateFilter === 'done' ? 'true' : 'false'}">Изучен</button>
        </div>
      </div>
      <div class="perk-board-layout">
        <nav class="perk-board-categories" aria-label="Категории перков"></nav>
        <div class="perk-board-list" role="list"></div>
        <aside class="perk-detail-panel"></aside>
      </div>
    `;
    wheel.appendChild(shell);

    const categoryNav = shell.querySelector('.perk-board-categories');
    categories.forEach(category => {
      const categoryState = perkCategoryState(category.key);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `perk-category-btn ${categoryState}` + (category.key === selectedPerkCategory ? ' active' : '');
      const categoryStateText = category.key === 'all' ? 'обзор' : perkCategoryStateText(categoryState);
      const categoryStateLabel = `— ${categoryStateText}`;
      btn.innerHTML = `
        <span class="perk-category-icon">${escapeHtml(perkCategoryIcon(category.key))}</span>
        <span class="perk-category-label"><b>${escapeHtml(category.label)}</b><small>${escapeHtml(categoryStateLabel)}</small></span>
      `;
      btn.title = '';
      btn.dataset.gameHint = category.desc;
      btn.addEventListener('click', e => {
        e.preventDefault();
        selectedPerkCategory = category.key;
        selectedPerkId = '';
        perkSearchText = '';
        renderPerkWheel();
        requestAnimationFrame(() => {
          if (wrap) {
            wrap.scrollLeft = 0;
            wrap.scrollTop = 0;
          }
          updatePerkFullscreenButtonPosition();
        });
      });
      categoryNav.appendChild(btn);
    });

    shell.querySelectorAll('[data-perk-state-filter]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const nextFilter = btn.dataset.perkStateFilter || 'all';
        selectedPerkStateFilter = selectedPerkStateFilter === nextFilter ? 'all' : nextFilter;
        selectedPerkId = '';
        renderPerkWheel();
      });
    });

    const search = shell.querySelector('#perk-board-search');
    if (search) {
      search.addEventListener('pointerdown', e => e.stopPropagation());
      search.addEventListener('click', e => e.stopPropagation());
      search.addEventListener('input', e => {
        e.stopPropagation();
        perkSearchText = String(e.target.value || '').slice(0, 64);
        selectedPerkId = '';
        renderPerkWheel();
        requestAnimationFrame(() => {
          const nextSearch = document.getElementById('perk-board-search');
          if (!nextSearch) return;
          nextSearch.focus();
          const pos = nextSearch.value.length;
          try { nextSearch.setSelectionRange(pos, pos); } catch (_) {}
        });
      });
      search.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key !== 'Escape' || !perkSearchText) return;
        e.preventDefault();
        perkSearchText = '';
        selectedPerkId = '';
        renderPerkWheel();
      });
    }

    const list = shell.querySelector('.perk-board-list');
    const appendPerkCard = talent => {
      const meta = perkSubgroupMeta(talent);
      const state = perkStateInfo(talent);
      const node = document.createElement('button');
      node.type = 'button';
      node.className = `perk-card ${state.className}` + (talent.id === selectedPerkId ? ' selected' : '');
      node.dataset.id = talent.id;
      node.dataset.gameHint = `${talent.name} — ${talent.desc} ${talentFormulaText(talent)}`;
      node.innerHTML = `
        <span class="perk-card-icon">${escapeHtml(talent.icon)}</span>
        <span class="perk-card-main">
          <span class="perk-card-top"><b>${escapeHtml(talent.name)}</b><span class="perk-card-state">${escapeHtml(state.label)}</span></span>
          <small>${escapeHtml(meta?.label || 'Перки')} · ур. ${perkLevelRequirement(talent)} · ${escapeHtml(perkNextRankText(talent, state))}</small>
          <em>${escapeHtml(compactText(talent.desc, 118))}</em>
          <span class="perk-card-reqs">${perkRequirementChipsHtml(talent)}</span>
        </span>
      `;
      node.addEventListener('click', e => {
        e.preventDefault();
        selectedPerkId = talent.id;
        renderPerkWheel();
      });
      node.addEventListener('pointerenter', e => showPerkHoverTooltip(e, talent, meta.label, perkLevelRequirement(talent), state.rank, state.maxed, state.reqMet));
      node.addEventListener('pointermove', movePerkHoverTooltip);
      node.addEventListener('pointerleave', hidePerkHoverTooltip);
      node.addEventListener('focus', e => showPerkHoverTooltip(e, talent, meta.label, perkLevelRequirement(talent), state.rank, state.maxed, state.reqMet));
      node.addEventListener('blur', hidePerkHoverTooltip);
      list.appendChild(node);
    };
    const sectionCategory = (searchActive || stateFilterActive) ? 'all' : selectedPerkCategory;
    perkBoardSections(sectionCategory, visibleTalents).forEach(section => {
      if (section.title) {
        const group = document.createElement('div');
        group.className = 'perk-board-group-title';
        group.textContent = section.title;
        list.appendChild(group);
      }
      section.talents.forEach(appendPerkCard);
    });
    if (!visibleTalents.length) {
      const empty = document.createElement('div');
      empty.className = 'perk-board-empty';
      empty.textContent = searchActive
        ? 'Поиск не нашёл подходящих перков.'
        : (stateFilterActive ? 'Нет перков с выбранным состоянием.' : 'В этой категории пока нет перков.');
      list.appendChild(empty);
    }
    renderPerkDetail(shell.querySelector('.perk-detail-panel'), selectedTalent);
    initPerkWheelPan();
  }

  function renderTalentTree() {
    renderSpecialSummary();
    updateProgressionHero();
    renderSkillTree();
    const points = document.getElementById('talent-points');
    if (points) points.textContent = player.perkPoints;
    // Вкладка «Персонаж и навыки» теперь содержит только параметры и навыки.
    // Все перки вынесены в отдельный каталог во вкладке «Перки».
    const grid = document.getElementById('talent-grid');
    if (grid) grid.innerHTML = '';
    setProgressionMode(progressionMode, { noRender: true });
    renderPerkWheel();
  }

  function stripNativeBrowserTooltips(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('[title]').forEach(el => {
      const value = el.getAttribute('title');
      if (value && !el.dataset.gameHint) el.dataset.gameHint = value;
      el.removeAttribute('title');
    });
  }

  function initNativeTooltipSuppressor() {
    if (document.body.dataset.boundNativeTooltipSuppressor === '1') return;
    document.body.dataset.boundNativeTooltipSuppressor = '1';
    stripNativeBrowserTooltips(document);
    const suppress = e => {
      const el = e.target?.closest?.('[title]');
      if (!el) return;
      const value = el.getAttribute('title');
      if (value && !el.dataset.gameHint) el.dataset.gameHint = value;
      el.removeAttribute('title');
    };
    ['pointerover', 'mouseover', 'touchstart', 'focusin'].forEach(type => document.addEventListener(type, suppress, true));
  }
  initNativeTooltipSuppressor();

  function gameTooltipItem(item, extraStat = '') {
    if (!item) return item;
    const baseStat = item.stat || itemStatLine(item);
    const stat = extraStat ? `${baseStat} · ${extraStat}` : baseStat;
    return { ...item, stat };
  }

  function showTooltip(e, item) {
    if (!item) return;
    stripNativeBrowserTooltips(document);
    const t = document.getElementById('tooltip');
    const name = document.getElementById('tt-name');
    const desc = document.getElementById('tt-desc');
    const stat = document.getElementById('tt-stat');
    if (!t || !name || !desc || !stat) return;
    name.textContent = item.name;
    desc.textContent = item.desc || item.dataset?.gameHint || '';
    stat.textContent = item.stat || itemStatLine(item);
    t.style.display = 'block';
    moveTooltip(e);
  }

  function moveTooltip(e) {
    const t = document.getElementById('tooltip');
    if (!t) return;
    const pad = 14;
    const edge = 10;
    const width = Math.min(t.offsetWidth || 250, Math.max(120, window.innerWidth - edge * 2));
    const height = Math.min(t.offsetHeight || 115, Math.max(80, window.innerHeight - edge * 2));
    const x = Math.max(edge, Math.min(window.innerWidth - width - edge, e.clientX + pad));
    const y = Math.max(edge, Math.min(window.innerHeight - height - edge, e.clientY + pad));
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }

  function hideTooltip() {
    const tt = document.getElementById('tooltip'); if (tt) { tt.style.display = 'none'; tt.dataset.itemId = ''; }
  }

  function initMobileTooltipAutoClose() {
    if (document.body.dataset.boundMobileTooltipClose === '1') return;
    document.body.dataset.boundMobileTooltipClose = '1';
    document.addEventListener('pointerdown', e => {
      if (!isMobileControlsEnabled()) return;
      const tooltip = document.getElementById('tooltip');
      if (!tooltip || tooltip.style.display === 'none') return;
      const menu = document.getElementById('item-context-menu');
      const target = e.target;
      if (tooltip.contains(target) || (menu && menu.contains(target))) return;
      hideTooltip();
    }, true);
  }
