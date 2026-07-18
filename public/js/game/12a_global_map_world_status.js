  function globalMapWorldPartyKindLabel(kind = '') {
    const value = String(kind || '').toLowerCase();
    if (value === 'caravan') return 'Караван';
    if (value === 'patrol') return 'Патруль';
    if (value === 'raider') return 'Рейдеры';
    if (value === 'monster') return 'Монстры';
    return 'Отряд';
  }

  function globalMapFactionColor(faction = '') {
    const key = String(faction || '').toLowerCase();
    const fromSim = WASTELAND_SIM_STATE.factions?.[key]?.color;
    if (fromSim) return String(fromSim);
    if (key === 'old_klim' || key === 'klim_patrol') return '#93d982';
    if (key === 'caravans' || key === 'caravan') return '#efd078';
    if (key === 'scrap_union') return '#d7a95e';
    if (key === 'relay_order') return '#7fcfff';
    if (key === 'raiders') return '#ff7b53';
    if (key === 'mutants') return '#c681ff';
    if (['wild', 'ghouls', 'radscorpions', 'mutant_ants', 'geckos'].includes(key)) return '#b88cff';
    if (key === 'neutral') return '#9fd7ff';
    return '';
  }

  function globalMapWorldPartyColor(kind = '', faction = '') {
    const factionColor = globalMapFactionColor(faction);
    if (factionColor) return factionColor;
    const value = String(kind || '').toLowerCase();
    if (value === 'caravan') return '#efd078';
    if (value === 'patrol') return '#93d982';
    if (value === 'raider') return '#ff7b53';
    if (value === 'monster') return '#c681ff';
    return '#9fd7ff';
  }

  function globalMapWorldPartyLabel(row = {}) {
    const kind = globalMapWorldPartyKindLabel(row.kind);
    const stateKey = String(row.state || '').toLowerCase();
    if (stateKey === 'forming') return `${kind} · формируется на базе`;
    if (stateKey === 'onsite' && row?.onsiteDepartureRequested) return `${kind} · выходит из локации`;
    if (stateKey === 'engaged') return `${kind} · бой`;
    if (stateKey === 'onsite') return `${kind} · в локации`;
    return kind;
  }

  function globalMapWorldPartyDestroyed(row = {}) {
    return !!row?.destroyed || String(row?.state || '').toLowerCase() === 'destroyed';
  }

  function globalMapWorldPartyInBattle(row = {}) {
    const stateKey = String(row?.state || '').toLowerCase();
    return stateKey === 'engaged' || stateKey === 'onsite' || !!row?.engagedZoneId || !!row?.onsiteZoneId;
  }

  function globalMapWorldPartyVisibleOnMap(row = {}) {
    if (!row) return false;
    if (String(row.state || '').toLowerCase() === 'forming') return true;
    return !globalMapWorldPartyDestroyed(row);
  }

  function globalMapWorldPartyDestinationPoint(row = {}) {
    if (String(row.state || '').toLowerCase() === 'forming') return null;
    if (globalMapWorldPartyInBattle(row)) return null;
    const targetPartyId = String(row.targetPartyId || '').trim();
    if (targetPartyId) {
      const targetParty = (Array.isArray(WASTELAND_SIM_STATE.parties) ? WASTELAND_SIM_STATE.parties : [])
        .find(entry => entry && String(entry.id || '') === targetPartyId && globalMapWorldPartyVisibleOnMap(entry));
      if (targetParty) return clampGlobalMapPoint(targetParty.x, targetParty.y);
    }
    const destinationId = String(row.destinationSiteId || '').trim();
    if (!destinationId) return null;
    const site = globalMapWorldSiteById(destinationId);
    if (site) return clampGlobalMapPoint(site.x, site.y);
    const node = GLOBAL_MAP_NODES.find(entry => entry && entry.id === destinationId);
    return node ? clampGlobalMapPoint(node.x, node.y) : null;
  }

  function globalMapEstimatedWorldHoursSinceSimUpdate() {
    if (!wastelandSimLastAppliedAt) return 0;
    const elapsedMs = Math.max(0, performance.now() - wastelandSimLastAppliedAt);
    const dayMs = Math.max(60000, Number(WASTELAND_SIM_STATE.gameDayRealMs || GLOBAL_MAP_WORLD_DAY_REAL_MS));
    return Math.max(0, elapsedMs / dayMs * 24);
  }

  function globalMapWorldPartyDisplayPoint(row = {}) {
    const base = clampGlobalMapPoint(row.x, row.y);
    if (!row || globalMapWorldPartyDestroyed(row)) return base;
    const stateKey = String(row.state || '').toLowerCase();
    if (['engaged', 'onsite', 'staging', 'recovering', 'forming', 'destroyed'].includes(stateKey)) return base;
    const destination = globalMapWorldPartyDestinationPoint(row);
    if (!destination) return base;
    const distPoints = globalMapPointDistance(base, destination);
    if (distPoints <= 0.001) return base;
    const speedKmh = Math.max(0, Number(row.speedKmh || 0));
    if (speedKmh <= 0) return base;
    const travelKm = Math.min(distPoints * GLOBAL_MAP_POINT_KM, speedKmh * globalMapEstimatedWorldHoursSinceSimUpdate());
    const t = Math.max(0, Math.min(1, travelKm / Math.max(0.001, distPoints * GLOBAL_MAP_POINT_KM)));
    return {
      x: base.x + (destination.x - base.x) * t,
      y: base.y + (destination.y - base.y) * t
    };
  }

  function globalMapProductionNeedLabel(reason = '') {
    const key = String(reason || '').toLowerCase();
    if (key === 'raid') return 'восстановление после налета';
    if (key === 'depleted') return 'истощение месторождения';
    if (key === 'stalled') return 'добыча стоит';
    if (key === 'security') return 'нужна охрана';
    if (key === 'low_stock') return 'низкие запасы';
    return key ? 'нужна поддержка' : '';
  }

  function globalMapWorldSiteHotspot(site = {}) {
    if (!site) return null;
    const worldHour = Number(WASTELAND_SIM_STATE.worldHour || 0);
    const tasks = globalMapWorldTasksForSite(site.id);
    const rows = [];
    const add = (score, label, color = '#ffcf5f', level = 'warning') => {
      if (!label) return;
      rows.push({ score: Number(score || 0), label, color, level });
    };
    if (site.activeConflict) add(120, 'Налет', '#ff7254', 'critical');
    if (site.controlState === 'critical') add(105, 'Контроль', '#ff7254', 'critical');
    if (site.marketState === 'blockade') add(96, 'Блокада', '#ff8a54', 'critical');
    if (Number(site.supplyDisruptedUntil || 0) > worldHour) add(88, 'Снабжение', '#ff8a54', 'warning');
    if (site.controlState === 'contested' || site.controlState === 'threatened') add(72, 'Спорная зона', '#ffcf5f', 'warning');
    if (site.marketState === 'shortage') add(68, 'Дефицит', '#ffcf5f', 'warning');
    if (String(site.productionNeedSummary || '').trim()) add(62, 'Нужна поддержка', '#ffcf5f', 'warning');
    if (tasks.length) add(54, 'Работа', '#9fd7ff', 'task');
    if (Number(site.resourceDepletion || 0) >= 80) add(42, 'Истощение', '#d7a95e', 'warning');
    if (Number(site.resourceActivity || 100) < 25 && (site.output && Object.keys(site.output).length)) add(38, 'Добыча стоит', '#d7a95e', 'warning');
    if (Number(site.supportBoostUntil || 0) > worldHour || Number(site.marketSupplyBoostUntil || 0) > worldHour) add(24, 'Снабжено', '#83d889', 'good');
    if (!rows.length) return null;
    rows.sort((a, b) => b.score - a.score);
    const top = rows[0];
    return {
      ...top,
      labels: rows.slice(0, 3).map(row => row.label),
      score: Math.round(rows.reduce((sum, row) => sum + row.score, 0) / Math.max(1, rows.length)),
      radius: top.level === 'critical' ? 22 : top.level === 'task' ? 18 : 20
    };
  }

  function globalMapColorAlpha(color = '#ffcf5f', alpha = 1) {
    const hex = String(color || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return `rgba(255,207,95,${alpha})`;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function drawGlobalMapFactionTerritories2D(ctx, pointPx) {
    if (!ctx || typeof pointPx !== 'function') return;
    const rows = globalMapFactionTerritoryRows();
    if (!rows.length) return;
    const cellW = GLOBAL_MAP_GRID.cellPoints / GLOBAL_MAP_SIZE.width * ctx.canvas.width;
    const cellH = GLOBAL_MAP_GRID.cellPoints / GLOBAL_MAP_SIZE.height * ctx.canvas.height;
    rows.forEach(row => {
      const p = pointPx({
        x: (Number(row.cx || 0) + 0.5) * GLOBAL_MAP_GRID.cellPoints,
        y: (Number(row.cy || 0) + 0.5) * GLOBAL_MAP_GRID.cellPoints
      });
      const strength = Math.max(0.1, Math.min(1, Number(row.strength || 0.3)));
      ctx.save();
      ctx.fillStyle = globalMapColorAlpha(row.color || globalMapFactionColor(row.owner || ''), 0.08 + strength * 0.12);
      ctx.fillRect(p.x - cellW * 0.5, p.y - cellH * 0.5, cellW + 0.5, cellH + 0.5);
      ctx.restore();
    });
  }

  function drawGlobalMapFactionInfluence2D(ctx, pointPx) {
    if (!ctx || typeof pointPx !== 'function') return;
    if (globalMapFactionTerritoryRows().length) return;
    globalMapFactionInfluenceRows().forEach(row => {
      const p = pointPx(row);
      const radius = Math.max(10, Number(row.radius || 24) / GLOBAL_MAP_SIZE.width * ctx.canvas.width);
      ctx.save();
      ctx.fillStyle = globalMapColorAlpha(row.color, row.opacity);
      ctx.strokeStyle = globalMapColorAlpha(row.color, row.state === 'critical' ? 0.58 : 0.34);
      ctx.lineWidth = row.state === 'critical' ? 2.4 : 1.5;
      if (row.state === 'contested' || row.state === 'threatened') ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawGlobalMapFactionFronts2D(ctx, pointPx) {
    if (!ctx || typeof pointPx !== 'function') return;
    globalMapFactionFrontRows().forEach(row => {
      const target = pointPx(row);
      ctx.save();
      ctx.translate(target.x, target.y);
      ctx.fillStyle = globalMapColorAlpha(row.color, 0.22);
      ctx.strokeStyle = globalMapColorAlpha(row.color, 0.82);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(16, 10 + Number(row.severity || 0) * 0.65), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawGlobalMapWorldHotspot2D(ctx, site = {}, options = {}) {
    if (globalMapPointCoveredByWorldContact(site, 16)) return;
    const hotspot = globalMapWorldSiteHotspot(site);
    if (!hotspot || hotspot.level === 'good') return;
    const radius = Number(options.radius || hotspot.radius || 20);
    ctx.save();
    ctx.strokeStyle = globalMapColorAlpha(hotspot.color, hotspot.level === 'critical' ? 0.72 : 0.52);
    ctx.fillStyle = globalMapColorAlpha(hotspot.color, hotspot.level === 'critical' ? 0.10 : 0.065);
    ctx.lineWidth = hotspot.level === 'critical' ? 3 : 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = globalMapColorAlpha(hotspot.color, 0.38);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawGlobalMapWorldSite2DIcon(ctx, site = {}, color = '#80c8ff') {
    const resource = globalMapWorldSitePrimaryResource(site);
    ctx.strokeStyle = color;
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.78)';
    ctx.lineWidth = 1.5;
    if (resource === 'oil') {
      ctx.fillRect(-4, 1, 8, 4);
      ctx.strokeRect(-4, 1, 8, 4);
      ctx.beginPath();
      ctx.moveTo(-5, -4);
      ctx.lineTo(5, -1);
      ctx.stroke();
      return;
    }
    if (resource === 'water') {
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.quadraticCurveTo(6, 0, 0, 6);
      ctx.quadraticCurveTo(-6, 0, 0, -6);
      ctx.fill();
      ctx.stroke();
      return;
    }
    if (resource === 'ore') {
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(6, 5);
      ctx.lineTo(-6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }
    if (resource === 'scrap' || resource === 'ammoParts') {
      ctx.save();
      ctx.rotate(-0.35);
      ctx.fillRect(-5, -2, 10, 4);
      ctx.strokeRect(-5, -2, 10, 4);
      ctx.rotate(0.7);
      ctx.fillRect(-5, -2, 10, 4);
      ctx.strokeRect(-5, -2, 10, 4);
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.rect(-4, -4, 8, 8);
    ctx.fill();
    ctx.stroke();
  }

  function globalMapWorldSiteColor(site = {}) {
    const owner = String(site.owner || '').toLowerCase();
    const type = String(site.type || '').toLowerCase();
    const worldHour = Number(WASTELAND_SIM_STATE.worldHour || 0);
    if (site.controlState === 'critical') return '#ff7254';
    if (site.controlState === 'contested' || site.controlState === 'threatened') return '#ffcf5f';
    if (site.marketState === 'blockade') return '#ff8a54';
    if (site.marketState === 'shortage') return '#ffcf5f';
    if (Number(site.supplyDisruptedUntil || 0) > worldHour) return '#ff8a54';
    if (site.productionNeedSummary) return '#ffcf5f';
    if (Math.abs(Number(site.controlPressure || 0)) > 8) return '#ffcf5f';
    if (Number(site.supportBoostUntil || 0) > worldHour) return '#83d889';
    if (Number(site.threatSuppressedUntil || 0) > worldHour) return '#83d889';
    const resource = globalMapWorldSitePrimaryResource(site);
    if (resource === 'oil') return '#b88746';
    if (resource === 'water') return '#62c8ff';
    if (resource === 'ore') return '#b9ad96';
    if (resource === 'scrap' || resource === 'ammoParts') return '#d7a95e';
    if (owner === 'raiders') return '#ff6b52';
    if (owner === 'old_klim') return '#93d982';
    if (type === 'resource') return '#80c8ff';
    if (type === 'outpost') return '#efd078';
    if (type === 'production') return '#caa6ff';
    return '#b7a0ff';
  }

  function globalMapWorldSiteKindLabel(site = {}) {
    const type = String(site.type || '').toLowerCase();
    if (type === 'resource') return 'Ресурс';
    if (type === 'outpost') return 'Аванпост';
    if (type === 'production') return 'Производство';
    if (type === 'pointofinterest') return 'Точка интереса';
    if (type === 'settlement') return 'Поселение';
    return 'Зона';
  }

  function globalMapPressureSourceLabel(source = {}) {
    const kind = String(source.kind || '').toLowerCase();
    const label = String(source.label || '').toLowerCase();
    const name = String(source.name || '').trim();
    if (kind === 'raider' || label.includes('raider')) return name ? `рейдеры: ${name}` : 'рейдеры рядом';
    if (kind === 'monster' || label.includes('monster')) return name ? `монстры: ${name}` : 'миграция монстров';
    if (kind === 'patrol') return name ? `патруль: ${name}` : 'патруль поблизости';
    if (kind === 'caravan') return name ? `караван: ${name}` : 'караван поблизости';
    if (label.includes('production raid')) return name ? `налет на производство: ${name}` : 'налет на производственную точку';
    if (label.includes('secured production')) return name ? `охраняемое производство: ${name}` : 'охраняемая производственная точка';
    if (label.includes('contested production')) return name ? `спорное производство: ${name}` : 'спорная производственная точка';
    if (label.includes('resource raid')) return name ? `налет на ресурс: ${name}` : 'налет на ресурсную точку';
    if (label.includes('secured resource')) return name ? `охраняемая точка: ${name}` : 'охраняемая ресурсная точка';
    if (label.includes('contested')) return name ? `спорная точка: ${name}` : 'спорная ресурсная зона';
    return name || 'обстановка пустоши';
  }

  function globalMapRoutePressureHtml(routeProfile = null) {
    const seen = new Set();
    const rows = (Array.isArray(routeProfile?.influenceSources) ? routeProfile.influenceSources : [])
      .filter(row => row && (Math.abs(Number(row.chanceBonus || 0)) >= 0.01 || Math.abs(Number(row.difficultyBonus || 0)) >= 0.12))
      .filter(row => {
        const key = String(row.id || row.name || row.label || '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3);
    if (!rows.length) return '';
    const text = rows.map(globalMapPressureSourceLabel).join(', ');
    return `<br><span class="global-route-pressure">Обстановка: ${escapeHtml(text)}</span>`;
  }

  function globalMapWorldSiteById(id = '') {
    const key = String(id || '');
    return (Array.isArray(WASTELAND_SIM_STATE.sites) ? WASTELAND_SIM_STATE.sites : [])
      .find(site => String(site?.id || '') === key) || null;
  }

  function globalMapResourceSummary(cargo = {}, limit = 3) {
    const labels = {
      water: 'вода',
      ore: 'руда',
      scrap: 'лом',
      oil: 'нефть',
      chemicals: 'химикаты',
      medicine: 'медикаменты',
      electronics: 'электроника',
      ammoParts: 'детали',
      food: 'еда',
      ammo9: '9мм',
      ammo556: '.223',
      weaponParts: 'оруж. детали'
    };
    const rows = Object.entries(cargo || {})
      .map(([id, value]) => [id, Math.floor(Number(value || 0))])
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    return rows.map(([id, value]) => `${value} ${labels[id] || id}`).join(', ');
  }

  function globalMapWorldPartyStatus(row = {}) {
    if (String(row.statusText || '').trim()) return String(row.statusText).trim();
    const state = String(row.state || '').toLowerCase();
    const destination = globalMapWorldSiteById(row.destinationSiteId);
    const parts = [];
    if (state === 'moving') parts.push('в пути');
    else if (state === 'hunting') parts.push('ищет добычу');
    else if (state === 'roaming') parts.push('бродит');
    else if (state === 'destroyed') parts.push('разбит');
    else if (state) parts.push(state);
    if (destination) parts.push(`к ${destination.name || destination.id}`);
    const cargo = globalMapResourceSummary(row.cargo || {});
    if (cargo) parts.push(`груз: ${cargo}`);
    if (Number(row.cargoFillPercent || 0) > 0) parts.push(`загрузка ${Math.round(Number(row.cargoFillPercent || 0))}%`);
    if (Number(row.escortPower || 0) > 0) parts.push(`охрана ${Math.round(Number(row.escortPower || 0))}`);
    if (Number(row.riskLevel || 0) >= 35) parts.push(`${row.riskLabel || 'риск'} ${Math.round(Number(row.riskLevel || 0))}%`);
    if (row.reformAtHour && Number(row.reformAtHour || 0) > Number(WASTELAND_SIM_STATE.worldHour || 0)) {
      parts.push('восстанавливается');
    }
    return parts.join(' · ');
  }

  function globalMapWorldSiteStatus(row = {}, worldHour = 0) {
    if (row.activeConflict) return `идет налет: ${globalMapFactionLabel(row.activeConflict.primaryFaction || row.lastRaidFaction)}`;
    if (Number(row.supplyDisruptedUntil || 0) > worldHour) return 'перебои снабжения';
    if (row.marketState === 'blockade') return 'рынок: снабжение нарушено';
    if (row.marketState === 'shortage') return 'рынок: дефицит';
    if (row.productionNeedSummary) return `нужна поддержка: ${globalMapProductionNeedLabel(row.productionNeedReason)}`;
    if (Number(row.marketSupplyBoostUntil || 0) > worldHour) return 'свежее снабжение';
    if (row.marketState === 'supplied') return 'рынок снабжен';
    if (Number(row.supportBoostUntil || 0) > worldHour) return 'добыча стабилизирована';
    if (Number(row.threatSuppressedUntil || 0) > worldHour) return 'угроза подавлена';
    if (row.controlStateLabel && row.controlState !== 'stable') return row.controlStateLabel;
    const hasOutput = row.output && typeof row.output === 'object' && Object.values(row.output).some(value => Number(value || 0) > 0);
    if (hasOutput && Number(row.resourceDepletion || 0) >= 80) return 'месторождение истощено';
    if (hasOutput && Number(row.resourceActivity || 0) < 25) return 'добыча почти стоит';
    if (hasOutput && Number(row.resourceActivity || 0) >= 120) return 'активная добыча';
    if (hasOutput && Number(row.protectionLevel || 0) >= 45) return 'под охраной аванпоста';
    if (Number(row.security || 100) < 35) return 'низкая безопасность';
    const pressure = Number(row.controlPressure || 0);
    if (Math.abs(pressure) > 4) return pressure > 0 ? 'давление врагов' : 'контроль укрепляется';
    return 'спокойно';
  }

  function globalMapWorldTaskReward(task = {}) {
    const reward = task.reward && typeof task.reward === 'object' ? task.reward : {};
    const parts = [];
    if (Number(reward.xp || 0) > 0) parts.push(`${Math.round(Number(reward.xp || 0))} XP`);
    if (Number(reward.caps || 0) > 0) parts.push(`${Math.round(Number(reward.caps || 0))} крышек`);
    if (Number(reward.reputation || 0) > 0) parts.push(`репутация +${Math.round(Number(reward.reputation || 0))}`);
    return parts.join(', ');
  }

  function globalMapWorldTasksForSite(siteId = '') {
    const id = String(siteId || '').trim();
    if (!id) return [];
    return (Array.isArray(WASTELAND_SIM_STATE.worldTasks) ? WASTELAND_SIM_STATE.worldTasks : [])
      .filter(row => row && row.status === 'active' && (String(row.siteId || '') === id || String(row.issuerSiteId || '') === id))
      .slice(0, 3);
  }

  function globalMapWorldTasksForBoard(siteId = '') {
    const id = String(siteId || '').trim();
    if (!id) return [];
    return (Array.isArray(WASTELAND_SIM_STATE.worldTasks) ? WASTELAND_SIM_STATE.worldTasks : [])
      .filter(row => row && row.status === 'active' && String(row.issuerSiteId || row.siteId || '') === id)
      .slice(0, 6);
  }

  function globalMapTrackedWorldTask() {
    if (typeof currentTrackedWorldTask !== 'function') return null;
    const task = currentTrackedWorldTask();
    return task && task.status === 'active' ? task : null;
  }

  function globalMapTaskSitePoint(task = {}, preferIssuer = false) {
    const siteId = String(preferIssuer ? (task.issuerSiteId || task.siteId || '') : (task.siteId || task.issuerSiteId || '')).trim();
    if (!siteId) return null;
    const site = globalMapWorldSiteById(siteId);
    if (site) return clampGlobalMapPoint(site.x, site.y);
    const node = globalMapNode(siteId);
    return node ? clampGlobalMapPoint(node.x, node.y) : null;
  }

  function globalMapTaskExplicitPoint(task = {}) {
    const x = Number(task?.targetX ?? task?.details?.x);
    const y = Number(task?.targetY ?? task?.details?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return clampGlobalMapPoint(x, y);
  }

  function globalMapTaskPartyPoint(task = {}) {
    const partyId = String(task?.partyId || '').trim();
    if (!partyId) return null;
    const party = (Array.isArray(WASTELAND_SIM_STATE.parties) ? WASTELAND_SIM_STATE.parties : [])
      .find(row => globalMapWorldPartyVisibleOnMap(row) && String(row.id || '') === partyId);
    return party ? clampGlobalMapPoint(party.x, party.y) : null;
  }

  function globalMapTrackedTaskTargetPoint(task = globalMapTrackedWorldTask()) {
    if (!task) return null;
    if (['escort_caravan', 'join_patrol'].includes(String(task.type || ''))) {
      const partyPoint = globalMapTaskPartyPoint(task);
      if (partyPoint) return partyPoint;
    }
    return globalMapTaskExplicitPoint(task) || globalMapTaskSitePoint(task, false) || globalMapTaskSitePoint(task, true);
  }

  function globalMapTrackedTaskBoardPoint(task = globalMapTrackedWorldTask()) {
    if (!task) return null;
    return globalMapTaskSitePoint(task, true) || globalMapTaskSitePoint(task, false);
  }

  function globalMapTrackedTaskRouteHtml(task = globalMapTrackedWorldTask()) {
    const target = globalMapTrackedTaskTargetPoint(task);
    if (!task || !target) return '';
    const cell = globalMapPointCell(target.x, target.y);
    const targetName = task.targetPartyName || task.targetSiteName || task.siteName || globalMapWorldSiteById(task.siteId)?.name || globalMapLocationName(task.siteId) || 'цель';
    return `<br><span class="global-map-task-hint tracked">Отслеживается: ${escapeHtml(task.title || 'Работа пустоши')} · ${escapeHtml(targetName)} · клетка ${cell.cx + 1}:${cell.cy + 1} · точка ${Math.round(target.x)}:${Math.round(target.y)}</span>`;
  }

  function globalMapWorldTaskHintForSite(siteId = '') {
    const tasks = globalMapWorldTasksForSite(siteId);
    if (!tasks.length) return '';
    const rows = tasks
      .map(task => {
        const reward = globalMapWorldTaskReward(task);
        const departure = typeof worldTaskCaravanDepartureText === 'function' ? worldTaskCaravanDepartureText(task) : '';
        return `${task.title || 'Работа пустоши'}${reward ? ` (${reward})` : ''}${departure ? ` - ${departure}` : ''}`;
      })
      .join('; ');
    return `<br><span class="global-map-task-hint">Работа здесь: ${escapeHtml(rows)}. Откройте Пип-бой -> Задания, чтобы взять работу.</span>`;
  }

  function renderGlobalMapWorldStatus(systemLog) {
    if (!systemLog) return;
    const old = systemLog.querySelector('.global-map-world-state');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const parties = (Array.isArray(WASTELAND_SIM_STATE.parties) ? WASTELAND_SIM_STATE.parties : [])
      .filter(row => globalMapWorldPartyVisibleOnMap(row))
      .sort((a, b) => {
        const ar = Number(a.riskLevel || 0) + Number(a.cargoTotal || 0) * 0.08;
        const br = Number(b.riskLevel || 0) + Number(b.cargoTotal || 0) * 0.08;
        return br - ar;
      })
      .slice(0, 6);
    const worldHour = Number(WASTELAND_SIM_STATE.worldHour || 0);
    const sites = (Array.isArray(WASTELAND_SIM_STATE.sites) ? WASTELAND_SIM_STATE.sites : [])
      .filter(row => row && (
        String(row.type || '').toLowerCase() !== 'settlement' ||
        ['blockade', 'shortage'].includes(String(row.marketState || '')) ||
        Number(row.supplyDisruptedUntil || 0) > worldHour
      ))
      .filter(row =>
        Number(row.supplyDisruptedUntil || 0) > worldHour ||
        ['blockade', 'shortage'].includes(String(row.marketState || '')) ||
        Number(row.threatSuppressedUntil || 0) > worldHour ||
        !!row.activeConflict ||
        ['critical', 'contested', 'threatened'].includes(String(row.controlState || '')) ||
        Math.abs(Number(row.controlPressure || 0)) > 4 ||
        String(row.productionNeedSummary || '').trim() ||
        Number(row.security || 100) < 35 ||
        Number(row.resourceDepletion || 0) >= 80 ||
        Number(row.resourceActivity || 100) < 25 ||
        Number(row.protectionLevel || 0) >= 55
      )
      .sort((a, b) => {
        const score = row => {
          const state = String(row.controlState || '');
          const stateScore = state === 'critical' ? 80 : state === 'contested' ? 55 : state === 'threatened' ? 38 : 0;
          const marketScore = row.marketState === 'blockade' ? 70 : row.marketState === 'shortage' ? 38 : 0;
          return stateScore + marketScore + Math.abs(Number(row.controlPressure || 0)) * 2 + (String(row.productionNeedSummary || '').trim() ? 12 : 0);
        };
        return score(b) - score(a);
      })
      .slice(0, 4);
    const events = (Array.isArray(WASTELAND_SIM_STATE.events) ? WASTELAND_SIM_STATE.events : []).slice(0, 4);
    const tasks = (Array.isArray(WASTELAND_SIM_STATE.worldTasks) ? WASTELAND_SIM_STATE.worldTasks : [])
      .filter(row => row && row.status === 'active')
      .slice(0, 3);
    if (!parties.length && !sites.length && !events.length && !tasks.length) return;
    const empty = systemLog.querySelector('.global-map-system-log-empty');
    if (empty && empty.parentNode) empty.parentNode.removeChild(empty);
    const wrap = document.createElement('div');
    wrap.className = 'global-map-world-state';
    const partyHtml = parties.map(row => {
      const point = clampGlobalMapPoint(row.x, row.y);
      const cell = globalMapPointCell(point.x, point.y);
      const status = globalMapWorldPartyStatus(row);
      const className = Number(row.riskLevel || 0) >= 55 ? 'combat' : (String(row.kind || '') === 'caravan' ? 'loot' : 'system');
      return `<div class="system-log-line ${className}">Мир: ${escapeHtml(globalMapWorldPartyKindLabel(row.kind))} · ${escapeHtml(row.name || '')} · клетка ${cell.cx + 1}:${cell.cy + 1}${status ? ` · ${escapeHtml(status)}` : ''}</div>`;
    }).join('');
    const eventHtml = events.map(row => `<div class="system-log-line loot">Мир: ${escapeHtml(row.title || row.text || row.type || 'событие')}</div>`).join('');
    const taskHtml = tasks.map(row => {
      const reward = globalMapWorldTaskReward(row);
      const departure = typeof worldTaskCaravanDepartureText === 'function' ? worldTaskCaravanDepartureText(row) : '';
      return `<div class="system-log-line quest">Задание: ${escapeHtml(row.title || 'Работа пустоши')}${reward ? ` · ${escapeHtml(reward)}` : ''}${departure ? ` · ${escapeHtml(departure)}` : ''}</div>`;
    }).join('');
    const siteHtml = sites.map(row => {
      const point = clampGlobalMapPoint(row.x, row.y);
      const cell = globalMapPointCell(point.x, point.y);
      const status = globalMapWorldSiteStatus(row, worldHour);
      return `<div class="system-log-line level">Мир: ${escapeHtml(globalMapWorldSiteKindLabel(row))} · ${escapeHtml(row.name || row.id || '')} · ${escapeHtml(status)} · ${cell.cx + 1}:${cell.cy + 1}</div>`;
    }).join('');
    wrap.innerHTML = taskHtml + partyHtml + siteHtml + eventHtml;
    systemLog.appendChild(wrap);
  }

  function globalMapWorldContactById(contactId = '') {
    void contactId;
    return null;
  }

  function globalMapWorldContactDistance(contact = {}) {
    const playerPoint = globalMapPlayerPoint();
    return globalMapPointDistance(playerPoint, clampGlobalMapPoint(contact.x, contact.y));
  }

  function globalMapWorldContactButtonText(contact = {}, options = {}) {
    const point = clampGlobalMapPoint(contact.x, contact.y);
    const currentPoint = globalMapPlayerPoint();
    const candidatePlayerPoint = options.playerPoint ? clampGlobalMapPoint(options.playerPoint.x, options.playerPoint.y) : currentPoint;
    const distKm = globalMapPointDistance(candidatePlayerPoint, point);
    if (distKm > globalMapCircleTouchRadius(globalMapWorldContactDetectRadius(contact))) return 'Маршрут';
    return contact.actionLabel || globalMapWorldContactMeta(contact).label || 'Войти';
  }

  function openGlobalMapWorldContact(contactId = '', options = {}) {
    void contactId;
    void options;
    return false;

    const contact = globalMapWorldContactById(contactId);
    if (!contact) {
      setReadout('Событие уже исчезло или было решено миром.');
      renderGlobalMapPanel();
      return false;
    }
    if (blockGlobalMapGroupMovement()) return false;
    const point = clampGlobalMapPoint(contact.x, contact.y);
    const triggerRadius = globalMapWorldContactDetectRadius(contact);
    const currentPoint = globalMapPlayerPoint();
    const candidatePlayerPoint = options.playerPoint ? clampGlobalMapPoint(options.playerPoint.x, options.playerPoint.y) : currentPoint;
    const distKm = globalMapPointDistance(candidatePlayerPoint, point);
    const fromRoute = !!options.fromRoute;
    if (distKm > globalMapCircleTouchRadius(triggerRadius) + 0.35) {
      selectGlobalMapDestination(point.x, point.y);
      addLog(`Маршрут к событию: ${contact.title || 'событие пустоши'}.`, null, 'system');
      return true;
    }
    const meta = globalMapWorldContactMeta(contact);
    const originPoint = options.originPoint ? clampGlobalMapPoint(options.originPoint.x, options.originPoint.y) : currentPoint;
    const playerPoint = candidatePlayerPoint;
    globalMapState.travel = null;
    globalMapState.playerX = playerPoint.x;
    globalMapState.playerY = playerPoint.y;
    globalMapState.selectedX = point.x;
    globalMapState.selectedY = point.y;
    const forcedEncounter = globalMapWorldContactIsForced(contact);
    globalMapState.encounter = {
      id: contact.encounterId || 'caravan_patrol_vs_ghouls',
      title: contact.title || meta.label || 'Событие пустоши',
      text: contact.text || 'Мир пустоши ждёт вашего решения.',
      kind: contact.kind || 'battle',
      locationId: contact.locationId || '',
      forced: forcedEncounter,
      requiredWanderer: 0,
      wanderer: 0,
      worldContact: true,
      worldContactId: contact.id || '',
      worldContactKind: contact.kind || '',
      worldZoneId: contact.zoneId || '',
      worldZoneRoomId: contact.roomId || '',
      worldPartyId: contact.partyId || contact.sourceId || '',
      siteId: contact.siteId || '',
      worldContactRadius: triggerRadius,
      originWorldPoint: { x: originPoint.x, y: originPoint.y },
      worldContactPoint: { x: point.x, y: point.y },
      pvpMode: contact.pvpMode || 'pvp'
    };
    globalMapState.encounter.wanderer = typeof skillValue === 'function' ? skillValue('wanderer') : 0;
    rememberGlobalMapEntryCircle({
      x: point.x,
      y: point.y,
      radius: triggerRadius,
      origin: originPoint,
      kind: contact.kind || 'contact',
      id: contact.id || ''
    });
    addLog(`Контакт пустоши: ${contact.title || meta.label}.`, null, 'combat');
    renderGlobalMapPanel();
    if (typeof queueSave === 'function') queueSave(true);
    resolveGlobalEncounter('enter');
    return true;
  }

  function openGlobalMapWorldPartyEncounter(partyId = '', options = {}) {
    const knownParty = (Array.isArray(WASTELAND_SIM_STATE.parties) ? WASTELAND_SIM_STATE.parties : [])
      .find(row => row && String(row.id || '') === String(partyId || '').trim());
    if (String(knownParty?.state || '').toLowerCase() === 'forming') {
      setReadout(knownParty.statusText || 'Отряд формируется на базе и пока не готов к выходу.');
      renderGlobalMapPanel();
      return false;
    }
    const party = globalMapWorldPartyById(partyId);
    if (!party || !globalMapWorldPartyCanEncounter(party)) {
      setReadout('Отряд уже ушёл или был уничтожен.');
      renderGlobalMapPanel();
      return false;
    }
    if (blockGlobalMapGroupMovement()) return false;
    const point = clampGlobalMapPoint(globalMapWorldPartyDisplayPoint(party));
    const routePoint = globalMapPointIsWater(point.x, point.y)
      ? nearestGlobalMapLandPoint(point, globalMapPlayerPoint())
      : point;
    const encounterRadius = globalMapWorldPartyVisualRadiusPoints(party);
    const currentPoint = globalMapPlayerPoint();
    const candidatePlayerPoint = options.playerPoint ? clampGlobalMapPoint(options.playerPoint.x, options.playerPoint.y) : currentPoint;
    const distKm = globalMapPointDistance(candidatePlayerPoint, point);
    const fromRoute = !!options.fromRoute;
    if (distKm > globalMapCircleTouchRadius(encounterRadius) + 0.35) {
      selectGlobalMapDestination(routePoint.x, routePoint.y);
      addLog(`Маршрут к отряду: ${party.name || globalMapWorldPartyKindLabel(party.kind)}.`, null, 'system');
      return true;
    }
    const forced = options.forced ?? globalMapWorldPartyHostileToPlayer(party);
    const originPoint = options.originPoint ? clampGlobalMapPoint(options.originPoint.x, options.originPoint.y) : currentPoint;
    const playerPoint = candidatePlayerPoint;
    globalMapState.travel = null;
    globalMapState.playerX = playerPoint.x;
    globalMapState.playerY = playerPoint.y;
    globalMapState.selectedX = point.x;
    globalMapState.selectedY = point.y;
    globalMapState.encounter = {
      id: globalMapWorldPartyEncounterId(party),
      title: party.name || globalMapWorldPartyKindLabel(party.kind) || 'Отряд пустоши',
      text: globalMapWorldPartyEncounterText(party, forced),
      kind: party.kind || 'party',
      locationId: globalMapWorldPartyEncounterLocationId(party),
      forced,
      requiredWanderer: 0,
      wanderer: typeof skillValue === 'function' ? skillValue('wanderer') : 0,
      worldContact: true,
      worldContactId: `party_${party.id || ''}`,
      worldContactKind: party.kind || 'party',
      worldZoneId: '',
      worldZoneRoomId: '',
      worldPartyId: party.id || '',
      siteId: '',
      worldContactRadius: encounterRadius,
      originWorldPoint: { x: originPoint.x, y: originPoint.y },
      worldContactPoint: { x: point.x, y: point.y },
      pvpMode: 'pvp'
    };
    rememberGlobalMapEntryCircle({
      x: point.x,
      y: point.y,
      radius: encounterRadius,
      origin: originPoint,
      kind: party.kind || 'party',
      id: party.id || ''
    });
    addLog(`${forced ? 'Враждебный отряд' : 'Отряд'} на глобальной карте: ${party.name || globalMapWorldPartyKindLabel(party.kind)}.`, null, forced ? 'combat' : 'system');
    renderGlobalMapPanel();
    if (typeof queueSave === 'function') queueSave(true);
    resolveGlobalEncounter('enter');
    return true;
  }

  function globalMapPointSegmentHit(point = {}, from = {}, to = {}) {
    const px = Number(point.x || 0);
    const py = Number(point.y || 0);
    const ax = Number(from.x || 0);
    const ay = Number(from.y || 0);
    const bx = Number(to.x || 0);
    const by = Number(to.y || 0);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const rawT = lenSq > 0.0001 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    const t = Math.max(0, Math.min(1, rawT));
    const x = ax + dx * t;
    const y = ay + dy * t;
    return {
      t,
      x,
      y,
      distance: Math.hypot(px - x, py - y)
    };
  }

  function globalMapPointSegmentCircleEntry(center = {}, from = {}, to = {}, radius = 0) {
    const cx = Number(center.x || 0);
    const cy = Number(center.y || 0);
    const ax = Number(from.x || 0);
    const ay = Number(from.y || 0);
    const bx = Number(to.x || 0);
    const by = Number(to.y || 0);
    const r = Math.max(0, Number(radius || 0));
    if (r <= 0) return null;
    const startDist = Math.hypot(ax - cx, ay - cy);
    if (startDist <= r) return clampGlobalMapPoint(ax, ay);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0.0001) return Math.hypot(bx - cx, by - cy) <= r ? clampGlobalMapPoint(bx, by) : null;
    const fx = ax - cx;
    const fy = ay - cy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - r * r;
    const discriminant = b * b - 4 * lenSq * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    const t1 = (-b - root) / (2 * lenSq);
    const t2 = (-b + root) / (2 * lenSq);
    const candidates = [t1, t2].filter(t => Number.isFinite(t) && t >= 0 && t <= 1).sort((a, bValue) => a - bValue);
    if (!candidates.length) return null;
    const t = candidates[0];
    return clampGlobalMapPoint(ax + dx * t, ay + dy * t);
  }

  function globalMapWorldContactDetectRadius(contact = {}) {
    const explicitRadius = Number(contact.radius || 0);
    if (Number.isFinite(explicitRadius) && explicitRadius > 0) return Math.max(3, Math.min(18, explicitRadius));
    const priority = Math.max(1, Math.min(5, Number(contact.priority || 1)));
    const kind = String(contact.kind || '').toLowerCase();
    const kindBonus = kind === 'siege' || kind === 'battle' ? 3 : kind === 'lair' ? 2 : 0;
    return Math.max(5, Math.min(14, 5 + priority * 1.4 + kindBonus));
  }

  function maybeStopGlobalTravelForWorldLocation(prevPoint = {}, nextPoint = {}) {
    const travel = globalMapState.travel;
    if (!travel || globalMapState.encounter) return false;
    const ignored = globalMapState.routeContactStops && typeof globalMapState.routeContactStops === 'object'
      ? globalMapState.routeContactStops
      : {};
    globalMapState.routeContactStops = ignored;
    const now = Number(WASTELAND_SIM_STATE.worldHour || 0);
    Object.keys(ignored).forEach(id => {
      if (Number(ignored[id] || 0) <= now) delete ignored[id];
    });

    const candidates = [];
    GLOBAL_MAP_NODES
      .filter(node => node.kind === 'settlement' && LOCATIONS[node.id])
      .forEach(node => candidates.push({
        key: `settlement:${node.id}`,
        id: node.id,
        kind: 'settlement',
        locationId: node.id,
        point: clampGlobalMapPoint(node.x, node.y),
        radius: globalMapSettlementRadius(node),
        pvpMode: LOCATIONS[node.id]?.pvpMode || 'peaceful',
        priority: 1
      }));
    globalMapWorldSites()
      .filter(site => globalMapWorldSiteCanEnter(site))
      .forEach(site => candidates.push({
        key: `site:${site.id || site.locationId}`,
        id: site.id || '',
        kind: 'site',
        locationId: site.locationId,
        point: clampGlobalMapPoint(site.x, site.y),
        radius: globalMapWorldSiteRadius(site),
        pvpMode: site.pvpMode || LOCATIONS[site.locationId]?.pvpMode || 'pvp',
        priority: 2
      }));

    let best = null;
    candidates.forEach(candidate => {
      if (!candidate.locationId || ignored[candidate.key]) return;
      const radius = Math.max(2, Number(candidate.radius || GLOBAL_LOCATION_CELL_RADIUS));
      const touchRadius = globalMapCircleTouchRadius(radius);
      if (globalMapPointDistance(prevPoint, candidate.point) <= touchRadius + 0.25) return;
      const hit = globalMapPointSegmentHit(candidate.point, prevPoint, nextPoint);
      if (hit.distance > touchRadius) return;
      const entryPoint = globalMapPointSegmentCircleEntry(candidate.point, prevPoint, nextPoint, touchRadius)
        || clampGlobalMapPoint(hit.x, hit.y);
      const score = Number(candidate.priority || 1) * 100 - hit.distance * 4 - hit.t;
      if (!best || score > best.score) best = { ...candidate, hit, radius, touchRadius, entryPoint, score };
    });
    if (!best) return false;

    ignored[best.key] = now + 1.25;
    const stopPoint = nearestGlobalMapLandPoint(best.entryPoint || best.point, prevPoint);
    globalMapState.travel = null;
    globalMapState.encounter = null;
    globalMapState.playerX = stopPoint.x;
    globalMapState.playerY = stopPoint.y;
    globalMapState.selectedX = best.point.x;
    globalMapState.selectedY = best.point.y;
    addLog(`Глобальная карта: вход в ${best.kind === 'settlement' ? globalMapLocationName(best.locationId) : globalMapWorldSiteTitle({ id: best.id, locationId: best.locationId })}.`, null, 'system');
    enterGlobalLocalLocation(best.locationId, {
      encounter: false,
      siteId: best.kind === 'site' ? best.id : '',
      pvpMode: best.pvpMode || 'pvp',
      worldPoint: best.point,
      originWorldPoint: travel.fromPoint || prevPoint,
      entryCircle: {
        x: best.point.x,
        y: best.point.y,
        radius: best.radius,
        origin: travel.fromPoint || prevPoint,
        kind: best.kind,
        id: best.id || best.locationId
      }
    });
    return true;
  }

  function maybeStopGlobalTravelForWorldParty(prevPoint = {}, nextPoint = {}) {
    const travel = globalMapState.travel;
    if (!travel || globalMapState.encounter) return false;
    const ignored = globalMapState.routeContactStops && typeof globalMapState.routeContactStops === 'object'
      ? globalMapState.routeContactStops
      : {};
    globalMapState.routeContactStops = ignored;
    const now = Number(WASTELAND_SIM_STATE.worldHour || 0);
    Object.keys(ignored).forEach(id => {
      if (Number(ignored[id] || 0) <= now) delete ignored[id];
    });

    let best = null;
    (Array.isArray(WASTELAND_SIM_STATE.parties) ? WASTELAND_SIM_STATE.parties : []).forEach(party => {
      const partyId = String(party?.id || '').trim();
      const ignoredKey = partyId ? `party:${partyId}` : '';
      if (!partyId || ignored[ignoredKey]) return;
      if (!globalMapWorldPartyCanEncounter(party)) return;
      const point = clampGlobalMapPoint(globalMapWorldPartyDisplayPoint(party));
      const hit = globalMapPointSegmentHit(point, prevPoint, nextPoint);
      const radius = globalMapWorldPartyVisualRadiusPoints(party);
      const touchRadius = globalMapCircleTouchRadius(radius);
      if (hit.t <= 0.02 && globalMapPointDistance(prevPoint, point) > touchRadius) return;
      if (hit.distance > touchRadius) return;
      const entryPoint = globalMapPointSegmentCircleEntry(point, prevPoint, nextPoint, touchRadius)
        || clampGlobalMapPoint(hit.x, hit.y);
      const threat = Math.max(1, Number(party.riskLevel || 0) / 20) + (globalMapWorldPartyHostileToPlayer(party) ? 2 : 0);
      const score = threat * 100 - hit.distance * 5 - hit.t;
      if (!best || score > best.score) best = { party, point, hit, radius, touchRadius, entryPoint, score, ignoredKey };
    });
    if (!best) return false;

    ignored[best.ignoredKey] = now + 2;
    const stopPoint = nearestGlobalMapLandPoint(best.entryPoint || best.point, prevPoint);
    return openGlobalMapWorldPartyEncounter(best.party.id || '', {
      forced: true,
      fromRoute: true,
      playerPoint: stopPoint,
      originPoint: travel.fromPoint || prevPoint
    });
  }

  function maybeStopGlobalTravelForWorldContact(prevPoint = {}, nextPoint = {}) {
    void prevPoint;
    void nextPoint;
    return false;

    const travel = globalMapState.travel;
    if (!travel || globalMapState.encounter) return false;
    const ignored = globalMapState.routeContactStops && typeof globalMapState.routeContactStops === 'object'
      ? globalMapState.routeContactStops
      : {};
    globalMapState.routeContactStops = ignored;
    const now = Number(WASTELAND_SIM_STATE.worldHour || 0);
    Object.keys(ignored).forEach(id => {
      if (Number(ignored[id] || 0) <= now) delete ignored[id];
    });

    let best = null;
    globalMapWorldContacts(60, { includeHidden: true }).forEach(contact => {
      const id = String(contact?.id || '').trim();
      if (!id || ignored[id]) return;
      const point = clampGlobalMapPoint(contact.x, contact.y);
      const hit = globalMapPointSegmentHit(point, prevPoint, nextPoint);
      const radius = globalMapWorldContactDetectRadius(contact);
      const touchRadius = globalMapCircleTouchRadius(radius);
      if (hit.t <= 0.02 && globalMapPointDistance(prevPoint, point) > touchRadius) return;
      if (hit.distance > touchRadius) return;
      const priority = Math.max(1, Math.min(5, Number(contact.priority || 1)));
      const score = priority * 100 - hit.distance * 4 - hit.t;
      const entryPoint = globalMapPointSegmentCircleEntry(point, prevPoint, nextPoint, touchRadius)
        || clampGlobalMapPoint(hit.x, hit.y);
      if (!best || score > best.score) best = { contact, point, hit, radius, touchRadius, entryPoint, score };
    });
    if (!best) return false;

    ignored[String(best.contact.id || '')] = now + 2;
    const stopPoint = nearestGlobalMapLandPoint(best.entryPoint || best.point, prevPoint);
    globalMapState.playerX = stopPoint.x;
    globalMapState.playerY = stopPoint.y;
    globalMapState.selectedX = best.point.x;
    globalMapState.selectedY = best.point.y;
    globalMapState.travel = null;
    globalMapState.encounter = null;
    const meta = globalMapWorldContactMeta(best.contact);
    addLog(`Глобальная карта: вход в событие "${best.contact.title || meta.label}".`, null, 'combat');
    setReadout(`Обнаружено: ${best.contact.title || meta.label}.`);
    openGlobalMapWorldContact(best.contact.id || '', {
      fromRoute: true,
      playerPoint: stopPoint,
      originPoint: travel.fromPoint || prevPoint
    });
    if (typeof queueSave === 'function') queueSave(true);
    return true;
  }

  function renderGlobalMapWorldContacts(boardEl) {
    if (!boardEl) return;
    boardEl.innerHTML = '';
    return;

    const contacts = globalMapWorldContacts(5);
    if (!contacts.length) {
      boardEl.innerHTML = '<div class="global-map-contact-empty">Поблизости нет срочных событий. Мир продолжает жить фоном.</div>';
      return;
    }
    boardEl.innerHTML = contacts.map(contact => {
      const meta = globalMapWorldContactMeta(contact);
      const point = clampGlobalMapPoint(contact.x, contact.y);
      const cell = globalMapPointCell(point.x, point.y);
      const distKm = globalMapWorldContactDistance(contact);
      const critical = Number(contact.priority || 0) >= 4;
      const text = String(contact.text || '').trim();
      return `<div class="global-map-contact-row${critical ? ' critical' : ''}">
        <div>
          <b>${escapeHtml(meta.label)}: ${escapeHtml(contact.title || 'Событие пустоши')}</b>
          <small>${escapeHtml(text ? text.slice(0, 130) : 'Можно вмешаться лично или дать миру решить исход.')} ${text.length > 130 ? '...' : ''}</small>
          <small>Клетка ${cell.cx + 1}:${cell.cy + 1} · точка ${Math.round(point.x)}:${Math.round(point.y)} · ${formatGlobalMapNumber(distKm, 1)} км</small>
        </div>
        <button class="global-map-contact-action" type="button" data-world-contact="${escapeHtml(contact.id)}">${escapeHtml(globalMapWorldContactButtonText(contact))}</button>
      </div>`;
    }).join('');
    boardEl.querySelectorAll('[data-world-contact]').forEach(btn => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', e => {
        e.preventDefault();
        openGlobalMapWorldContact(btn.dataset.worldContact || '');
      });
    });
  }

  function renderGlobalMapWorkBoard(boardEl, boardSite = null, currentBoardSiteId = '') {
    if (!boardEl) return;
    const siteId = String(boardSite?.id || '').trim();
    if (!siteId) {
      boardEl.innerHTML = '<div class="global-map-work-empty">Выберите поселение, аванпост или ресурсную точку.</div>';
      return;
    }
    const tasks = globalMapWorldTasksForBoard(siteId);
    const atBoard = String(currentBoardSiteId || '').trim() === siteId;
    const factionPanel = typeof worldFactionPanelHtml === 'function'
      ? worldFactionPanelHtml(boardSite, 'global-map-work-faction')
      : '';
    if (!tasks.length) {
      boardEl.innerHTML = `${factionPanel}<div class="global-map-work-empty">${escapeHtml(boardSite.name || 'Доска работ')}: новых заявок нет.</div>`;
      if (typeof bindWorldFactionJoinButtons === 'function') bindWorldFactionJoinButtons(boardEl);
      return;
    }
    boardEl.innerHTML = factionPanel + tasks.map(task => {
      const reward = globalMapWorldTaskReward(task);
      const accepted = typeof isWorldTaskAccepted === 'function' && isWorldTaskAccepted(task);
      const targetName = task.targetSiteName || task.siteName || task.title || '';
      const access = typeof worldTaskAccessStatus === 'function'
        ? worldTaskAccessStatus(task)
        : { ok: true, text: '' };
      const disabled = accepted || !atBoard || !access.ok;
      const buttonText = accepted ? 'Взято' : !atBoard ? 'Подойти' : access.ok ? 'Взять' : 'Недоступно';
      const caravanDeparture = typeof worldTaskCaravanDepartureHtml === 'function'
        ? worldTaskCaravanDepartureHtml(task, 'global-map-work-countdown')
        : '';
      return `<div class="global-map-work-row">
        <div>
          <b>${escapeHtml(task.title || 'Работа пустоши')}</b>
          <small>${targetName ? `Цель: ${escapeHtml(targetName)}. ` : ''}${reward ? `Награда: ${escapeHtml(reward)}.` : ''}${!accepted && atBoard && !access.ok ? ` ${escapeHtml(access.text)}` : ''}</small>
          ${caravanDeparture}
        </div>
        ${accepted
          ? `<button class="global-map-work-accept" type="button" data-global-task-cancel="${escapeHtml(task.id)}">Отменить</button>`
          : `<button class="global-map-work-accept" type="button" data-global-task-accept="${escapeHtml(task.id)}"${disabled ? ' disabled' : ''}>${escapeHtml(buttonText)}</button>`}
      </div>`;
    }).join('');
    if (typeof bindWorldFactionJoinButtons === 'function') bindWorldFactionJoinButtons(boardEl);
    boardEl.querySelectorAll('[data-global-task-accept]').forEach(btn => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', e => {
        e.preventDefault();
        if (btn.disabled || typeof acceptWorldTask !== 'function') return;
        acceptWorldTask(btn.dataset.globalTaskAccept || '');
        renderGlobalMapPanel();
      });
    });
    boardEl.querySelectorAll('[data-global-task-cancel]').forEach(btn => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', e => {
        e.preventDefault();
        if (typeof cancelWorldTask !== 'function') return;
        cancelWorldTask(btn.dataset.globalTaskCancel || '');
        renderGlobalMapPanel();
      });
    });
  }

