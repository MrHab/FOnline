  function renderGlobalMapPanel(options = {}) {
    const panelOptions = options || {};
    if (globalMapState.onWorldMap) requestWastelandSimState(false);
    globalMapState.party = globalMapState.party.length ? globalMapState.party : globalMapPartySnapshot();
    ensureGlobalMapAmbushButton();
    const route = document.getElementById('global-map-route');
    const party = document.getElementById('global-map-party');
    const systemLog = document.getElementById('global-map-system-log');
    const contactsBoard = document.getElementById('global-map-world-contacts');
    const workBoard = document.getElementById('global-map-work-board');
    const enterBtn = document.getElementById('global-map-enter-btn');
    const cancelBtn = document.getElementById('global-map-cancel-btn');
    const ambushBtn = document.getElementById('global-map-ambush-btn');
    const traveling = !!globalMapState.travel;
    let playerPoint = globalMapPlayerPoint();
    if (!traveling && !globalMapState.encounter && globalMapPointIsWater(playerPoint.x, playerPoint.y)) {
      playerPoint = sanitizeGlobalMapPlayerLandState({ save: true });
    }
    const selectedPoint = globalMapSelectedPoint();
    const playerSettlement = globalMapSettlementAt(playerPoint.x, playerPoint.y);
    const selectedSettlement = globalMapSettlementAt(selectedPoint.x, selectedPoint.y);
    const playerWorldSite = globalMapWorldSiteAt(playerPoint.x, playerPoint.y);
    const selectedWorldSite = globalMapWorldSiteAt(selectedPoint.x, selectedPoint.y);
    const samePoint = globalMapPointDistance(playerPoint, selectedPoint) <= 0.35;
    const pendingDrop = !traveling && !globalMapState.encounter && globalMapState.pendingWorldDrop ? globalMapState.pendingWorldDrop : null;
    const currentBoardSiteId = playerSettlement?.id || playerWorldSite?.id || pendingDrop?.siteId || '';
    const selectedBoardSite = selectedSettlement
      ? (globalMapWorldSiteById(selectedSettlement.id) || { id: selectedSettlement.id, name: globalMapLocationName(selectedSettlement.id) })
      : selectedWorldSite;
    const currentBoardSite = playerSettlement
      ? (globalMapWorldSiteById(playerSettlement.id) || { id: playerSettlement.id, name: globalMapLocationName(playerSettlement.id) })
      : playerWorldSite || (pendingDrop?.siteId ? { id: pendingDrop.siteId, name: pendingDrop.siteName || globalMapLocationName(pendingDrop.locationId) } : null);
    renderGlobalMapWorldContacts(contactsBoard);
    renderGlobalMapWorkBoard(workBoard, currentBoardSite || selectedBoardSite, currentBoardSiteId);
    if (route) {
      if (traveling) {
        const pct = Math.round(Math.max(0, Math.min(1, globalMapState.travel.progress || 0)) * 100);
        const leftSec = Math.max(0, Math.ceil(Number(globalMapState.travel.duration || 0) * (1 - Math.max(0, Math.min(1, Number(globalMapState.travel.progress || 0))))));
        const travelWorldSite = globalMapWorldSites().find(site => site.id === globalMapState.travel.targetWorldSiteId);
        const targetTitle = globalMapState.travel.targetSettlementId
          ? globalMapLocationName(globalMapState.travel.targetSettlementId)
          : travelWorldSite
            ? globalMapWorldSiteTitle(travelWorldSite)
            : globalMapPointTitle(globalMapState.travel.toPoint);
        const targetPoint = clampGlobalMapPoint(globalMapState.travel.toPoint?.x, globalMapState.travel.toPoint?.y);
        const targetCell = globalMapPointCell(targetPoint.x, targetPoint.y);
        const currentPoint = globalMapTravelCurrentPoint(globalMapState.travel);
        const speedText = formatGlobalMapNumber(globalMapState.travel.speedKmh || globalMapTravelSpeedKmh(), 1);
        const distanceText = formatGlobalMapNumber(globalMapState.travel.distanceKm || 0, 1);
        route.innerHTML = `<b>Путь к: ${escapeHtml(targetTitle)}</b><br>Цель: клетка ${targetCell.cx + 1}:${targetCell.cy + 1} · точка ${Math.round(targetPoint.x)}:${Math.round(targetPoint.y)}<br>Сейчас: точка ${Math.round(currentPoint.x)}:${Math.round(currentPoint.y)} · прогресс ${pct}% · осталось ${formatGlobalTravelRealTime(leftSec)}<br>Дистанция ${distanceText} км · скорость ${speedText} км/ч · Странник ${globalMapState.travel.wandererSkill || 0}%${globalMapState.encounter ? '<br>Событие на маршруте.' : ''}`;
      } else if (globalMapState.attachedPartyId) {
        const attached = globalMapAttachedParty();
        if (attached) {
          const point = clampGlobalMapPoint(attached.x, attached.y);
          const cell = globalMapPointCell(point.x, point.y);
          const destinationName = attached.destinationSiteName || globalMapWorldSiteById(attached.destinationSiteId)?.name || globalMapLocationName(attached.destinationSiteId) || 'маршруту';
          const rosterRows = globalMapAttachedPartyRosterRows(attached);
          const leaderName = attached.leaderName || rosterRows.find(row => row?.leader)?.name || 'Караванщик';
          route.innerHTML = `<b>Вы в караванной группе: ${escapeHtml(attached.name || attached.id)}</b><br>Глава: ${escapeHtml(leaderName)} · ${escapeHtml(globalMapWorldPartyKindLabel(attached.kind))} · ${escapeHtml(globalMapFactionLabel(attached.faction || 'neutral'))}<br>Сейчас: клетка ${cell.cx + 1}:${cell.cy + 1} · точка ${Math.round(point.x)}:${Math.round(point.y)}<br>Движение: к ${escapeHtml(destinationName)} · ${escapeHtml(attached.statusText || 'отряд движется по маршруту')}`;
        } else {
          const partiesLoaded = Array.isArray(WASTELAND_SIM_STATE.parties) && WASTELAND_SIM_STATE.parties.length > 0;
          if (partiesLoaded) {
            globalMapState.attachedPartyId = '';
            globalMapState.attachedPartyTaskId = '';
            route.innerHTML = '<b>Группа недоступна</b><br>Отряд исчез с карты или был уничтожен. Вы снова двигаетесь самостоятельно.';
          } else {
            route.innerHTML = '<b>Загрузка группы</b><br>Ожидаем данные живой пустоши с сервера.';
          }
        }
      } else if (globalMapIsPlayerGroupFollower()) {
        const leaderName = globalMapState.travelLeaderName || 'лидер группы';
        route.innerHTML = `<b>Вы в группе</b><br>Маршрут выбирает ${escapeHtml(leaderName)}.<br>Вы можете осматривать глобальную карту, но не можете задавать путь, входить в локации или ставить засаду, пока не являетесь главой группы.`;
      } else if (pendingDrop) {
        const cell = globalMapPointCell(playerPoint.x, playerPoint.y);
        const title = pendingDrop.encounter ? 'Событие мира' : (pendingDrop.siteName || globalMapLocationName(pendingDrop.locationId));
        route.innerHTML = `<b>${escapeHtml(title)}</b><br>Клетка ${cell.cx + 1}:${cell.cy + 1} · точка ${Math.round(playerPoint.x)}:${Math.round(playerPoint.y)}<br>Вы на месте. Нажмите «Войти», чтобы перейти в найденную локацию, или выберите новую точку маршрута.`;
      } else {
        const selectedCell = globalMapPointCell(selectedPoint.x, selectedPoint.y);
        const selectedProfile = globalMapCellProfile(selectedCell.cx, selectedCell.cy);
        const routeProfile = samePoint ? null : globalMapRouteProfileBetweenPoints(playerPoint, selectedPoint);
        const targetTitle = selectedSettlement ? globalMapLocationName(selectedSettlement.id) : (selectedWorldSite ? globalMapWorldSiteTitle(selectedWorldSite) : selectedProfile.terrain);
        const distance = globalMapPointDistance(playerPoint, selectedPoint);
        const travelInfo = globalMapTravelInfoByDistance(distance);
        const selectedWorldSiteEnterable = globalMapWorldSiteCanEnter(selectedWorldSite);
        const arrival = selectedSettlement
          ? 'После прибытия можно войти в город.'
          : selectedWorldSite
            ? (selectedWorldSiteEnterable ? 'После прибытия можно войти в точку.' : 'После прибытия можно осмотреть состояние точки на карте.')
            : 'После прибытия вы останетесь на глобальной карте. Логова, стычки и события появляются как отдельные видимые точки.';
        route.innerHTML = `<b>${escapeHtml(targetTitle)}</b><br>Клетка ${selectedCell.cx + 1}:${selectedCell.cy + 1} · точка ${Math.round(selectedPoint.x)}:${Math.round(selectedPoint.y)}<br>${samePoint ? (playerSettlement ? `Вы в зоне: ${escapeHtml(globalMapLocationName(playerSettlement.id))}.` : (playerWorldSite ? `Вы у точки: ${escapeHtml(globalMapWorldSiteTitle(playerWorldSite))}.` : 'Текущая точка пустоши.')) : `Дистанция: ${formatGlobalMapNumber(travelInfo.distanceKm, 1)} км · скорость ${formatGlobalMapNumber(travelInfo.speedKmh, 1)} км/ч · Странник ${travelInfo.wanderer}% · время ${formatGlobalTravelRealTime(travelInfo.realSeconds)} · опасность видна на карте`}<br>${arrival}`;
      }
      const routeTaskSiteId = traveling
        ? (globalMapState.travel.targetSettlementId || globalMapState.travel.targetWorldSiteId || '')
        : pendingDrop
          ? (pendingDrop.siteId || '')
          : (selectedSettlement?.id || selectedWorldSite?.id || (samePoint ? (playerSettlement?.id || playerWorldSite?.id || '') : ''));
      const routeTaskHint = globalMapWorldTaskHintForSite(routeTaskSiteId);
      if (routeTaskHint) route.innerHTML += routeTaskHint;
      const trackedTaskHint = globalMapTrackedTaskRouteHtml();
      if (trackedTaskHint) route.innerHTML += trackedTaskHint;
      if (!traveling && !pendingDrop && !samePoint) {
        const pressureHtml = globalMapRoutePressureHtml(globalMapRouteProfileBetweenPoints(playerPoint, selectedPoint));
        if (pressureHtml) route.innerHTML += pressureHtml;
      }
    }
    if (party) {
      const attached = globalMapAttachedParty();
      if (attached) {
        const rosterRows = globalMapAttachedPartyRosterRows(attached);
        const total = Math.max(0, Number(attached.groupMemberCount || rosterRows.length || 0));
        const header = `<div class="global-party-row leader"><b>${escapeHtml(attached.name || 'Караван')}</b><small>${total} в группе</small></div>`;
        party.innerHTML = header + globalMapPartyRosterHtml(rosterRows, { maxRows: 10 });
      } else {
        const rows = traveling && globalMapState.party.length ? globalMapState.party : globalMapPartySnapshot();
        party.innerHTML = rows.map(row => `<div class="global-party-row"><b>${escapeHtml(row.name)}</b><small>${row.leader ? 'Лидер' : `${Math.round(row.distance)} м`}</small></div>`).join('');
      }
    }
    if (systemLog && !systemLog.children.length) {
      systemLog.innerHTML = '<div class="global-map-system-log-empty">События маршрута и системные сообщения появятся здесь.</div>';
    }
    renderGlobalMapWorldStatus(systemLog);
    if (enterBtn) {
      const canEnterWorldSite = playerWorldSite && globalMapWorldSiteCanEnter(playerWorldSite);
      enterBtn.disabled = traveling || !!globalMapState.encounter || globalMapGroupMovementLocked() || (!playerSettlement && !canEnterWorldSite && !pendingDrop);
      enterBtn.textContent = playerSettlement
        ? `Войти: ${globalMapLocationName(playerSettlement.id)}`
        : canEnterWorldSite
          ? `Войти: ${globalMapWorldSiteTitle(playerWorldSite)}`
          : playerWorldSite
            ? `Точка: ${globalMapWorldSiteTitle(playerWorldSite)}`
            : pendingDrop
              ? (pendingDrop.encounter ? 'Войти в событие' : `Войти: ${pendingDrop.siteName || globalMapLocationName(pendingDrop.locationId)}`)
              : 'Войти';
    }
    if (cancelBtn) {
      cancelBtn.disabled = (!traveling && !globalMapState.attachedPartyId) || !!globalMapState.encounter;
      cancelBtn.textContent = globalMapState.attachedPartyId ? 'Покинуть группу' : 'Стоп';
    }
    if (ambushBtn) {
      const canAmbush = globalMapState.onWorldMap
        && !globalMapGroupMovementLocked()
        && !traveling
        && !globalMapState.encounter
        && !playerSettlement
        && !playerWorldSite
        && !globalMapPointIsWater(playerPoint.x, playerPoint.y);
      ambushBtn.disabled = !canAmbush;
    }
    if (!panelOptions.skipMapDraw) {
      if (typeof GLOBAL_MAP_3D !== 'undefined' && GLOBAL_MAP_3D) GLOBAL_MAP_3D.dynamicHeavyReady = false;
      drawGlobalMap();
    }
  }

  let globalMapPanelFrameTimer = 0;
  let globalMapVisualFrameTimer = 0;

  function renderGlobalMapRuntimeFrame(dt = 0, force = false) {
    const step = Math.max(0, Number(dt || 0));
    globalMapPanelFrameTimer -= step;
    globalMapVisualFrameTimer -= step;

    const pan = GLOBAL_MAP_3D?.keyPan || {};
    const cameraActive = !!GLOBAL_MAP_3D?.dragging || !!(pan.KeyW || pan.KeyA || pan.KeyS || pan.KeyD);
    const worldActive = !!(globalMapState.travel || globalMapState.encounter);
    // Keep the 3D global map rendering at normal speed even while the player is
    // standing still. Heavy marker rebuilds are throttled inside
    // updateGlobalMap3DDynamic(), so this only restores smooth camera/party motion.
    const visualInterval = IS_MOBILE_DEVICE ? 1 / 45 : 1 / 60;
    if (force || globalMapVisualFrameTimer <= 0) {
      globalMapVisualFrameTimer = visualInterval;
      const forceHeavy3D = force || cameraActive;
      if (!renderGlobalMap3D(dt, forceHeavy3D)) drawGlobalMap();
    }

    const panelInterval = worldActive ? 0.25 : 60.0;
    if (force || globalMapPanelFrameTimer <= 0) {
      globalMapPanelFrameTimer = panelInterval;
      renderGlobalMapPanel({ skipMapDraw: true });
    }
  }

  function renderGlobalEncounterPanel() {
    const panel = document.getElementById('global-encounter-panel');
    if (!panel) return;
    panel.classList.remove('visible');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = '';
  }

  function renderMapWindow() {
    drawMinimap();
  }

  function setGlobalMapMiniGameActive(active) {
    const isActive = !!active;
    const win = document.getElementById('global-map-window');
    if (win) {
      win.classList.toggle('visible', isActive);
      win.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    }
    document.body.classList.toggle('global-map-mode', isActive);
    document.body.classList.toggle('game-ui-panel-open', isActive);
    if (playerGroup) playerGroup.visible = !isActive;
    if (marker && isActive) marker.visible = false;
    if (!isActive) {
      GLOBAL_MAP_3D.userPanned = false;
      GLOBAL_MAP_3D.dragging = false;
      clearGlobalMapCameraKeys();
      hideGlobalMapCursor();
    }
  }

  function closeGlobalMapMiniGame(options = {}) {
    globalMapState.onWorldMap = false;
    globalMapState.travel = null;
    globalMapState.encounter = null;
    globalMapSetTravelLeader('', '');
    if (options.keepEncounterState !== true) globalMapState.pendingEncounterWorldZoneId = '';
    if (options.keepEncounterState !== true) globalMapState.pendingEncounterWorldPartyId = '';
    if (options.clearPendingDrop !== false) globalMapState.pendingWorldDrop = null;
    setGlobalMapMiniGameActive(false);
    renderGlobalEncounterPanel();
  }

  function isPlayerInWorldMapExitZone() {
    if (!currentLocation || globalMapState.onWorldMap || globalMapState.travel || locationTransitionActive) return false;
    if (typeof worldToTile !== 'function') return false;
    const t = worldToTile(player.x, player.z);
    const bounds = typeof locationPlayableBounds === 'function'
      ? locationPlayableBounds(currentLocation)
      : { minX: 0, minZ: 0, maxX: MAP_W - 1, maxZ: MAP_H - 1 };
    return t.tx <= bounds.minX + 1 || t.tz <= bounds.minZ + 1 || t.tx >= bounds.maxX - 1 || t.tz >= bounds.maxZ - 1;
  }

  function updateWorldMapEdgeExit() {
    if (!isPlayerInWorldMapExitZone()) return false;
    if (typeof anyWindowOpen === 'function' && anyWindowOpen()) return false;
    return openGlobalMapFromLocationExit();
  }

  function localWorldMapExitDirection() {
    if (typeof worldToTile !== 'function') return 'south';
    const tile = worldToTile(player.x, player.z);
    const bounds = typeof locationPlayableBounds === 'function'
      ? locationPlayableBounds(currentLocation)
      : { minX: 0, minZ: 0, maxX: MAP_W - 1, maxZ: MAP_H - 1 };
    const candidates = [
      { direction: 'north', distance: tile.tz - bounds.minZ },
      { direction: 'south', distance: bounds.maxZ - tile.tz },
      { direction: 'west', distance: tile.tx - bounds.minX },
      { direction: 'east', distance: bounds.maxX - tile.tx }
    ];
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0].direction;
  }

  function directedGlobalMapExitPoint(circle = null, direction = 'south', fallback = null) {
    const safeCircle = sanitizeGlobalMapEntryCircle(circle);
    if (!safeCircle) return fallback ? clampGlobalMapPoint(fallback.x, fallback.y) : globalMapPlayerPoint();
    const vectors = {
      north: { x: 0, y: -1 },
      south: { x: 0, y: 1 },
      west: { x: -1, y: 0 },
      east: { x: 1, y: 0 }
    };
    const vector = vectors[direction] || vectors.south;
    const distance = globalMapCircleTouchRadius(safeCircle.radius) + 1.5;
    const point = clampGlobalMapPoint(
      safeCircle.x + vector.x * distance,
      safeCircle.y + vector.y * distance
    );
    return nearestGlobalMapLandPoint(point, fallback || safeCircle);
  }

  function openGlobalMapFromLocationExit() {
    if (typeof rejectBlockedGameplayAction === 'function'
      && rejectBlockedGameplayAction('Связь с сервером восстанавливается. Выход в пустошь временно недоступен.')) return false;
    if (globalMapState.onWorldMap || globalMapState.travel || locationTransitionActive) return false;
    const exitLocationId = currentLocation?.id || 'settlement';
    const settlementNode = GLOBAL_MAP_NODES.find(node => node.id === exitLocationId && node.kind === 'settlement');
    const exitCircle = sanitizeGlobalMapEntryCircle(globalMapState.lastEntryCircle);
    const exitDirection = localWorldMapExitDirection();
    if (exitCircle) {
      const p = directedGlobalMapExitPoint(exitCircle, exitDirection, globalMapPlayerPoint());
      globalMapState.playerX = p.x;
      globalMapState.playerY = p.y;
      globalMapState.selectedX = p.x;
      globalMapState.selectedY = p.y;
      globalMapState.fromLocationId = exitLocationId;
      clearGlobalMapEntryCircle();
    } else if (settlementNode) {
      globalMapState.currentWorldSiteId = '';
      const p = directedGlobalMapExitPoint({
        x: settlementNode.x,
        y: settlementNode.y,
        radius: globalMapSettlementRadius(settlementNode)
      }, exitDirection, globalMapLocationPoint(exitLocationId));
      globalMapState.playerX = p.x;
      globalMapState.playerY = p.y;
      globalMapState.selectedX = p.x;
      globalMapState.selectedY = p.y;
      globalMapState.fromLocationId = exitLocationId;
    }
    else {
      const p = globalMapPlayerPoint();
      globalMapState.selectedX = p.x;
      globalMapState.selectedY = p.y;
      globalMapState.fromLocationId = exitLocationId;
    }
    globalMapState.onWorldMap = true;
    globalMapState.encounter = null;
    globalMapState.party = globalMapPartySnapshot();
    if (multiplayer?.socket?.connected && multiplayer.joined) {
      globalMapSetTravelLeader(multiplayer.socket.id || '', characterProfile?.name || player.name || 'Лидер группы');
    } else {
      globalMapSetTravelLeader('', '');
    }
    player.targetPath = [];
    if (typeof stopAutoFire === 'function') stopAutoFire();
    if (typeof stopTouchAim === 'function') stopTouchAim();
    if (typeof closeAllWindows === 'function') closeAllWindows(false);
    setGlobalMapMiniGameActive(true);
    addLog('Вы вышли на глобальную карту. Выберите пункт назначения.', null, 'system');
    if (multiplayer?.socket?.connected && multiplayer.joined) {
      multiplayer.socket.emit('globalTravelEnterWorld', {
        fromLocationId: globalMapState.fromLocationId,
        exitDirection,
        worldPoint: globalMapPlayerPoint()
      }, ack => {
        if (ack?.ok === false) {
          globalMapSetTravelLeader(ack.leaderId || 'group-leader', ack.leaderName || '');
          globalMapState.onWorldMap = false;
          globalMapState.travel = null;
          globalMapState.encounter = null;
          setGlobalMapMiniGameActive(false);
          setReadout(ack.error || 'Маршрут выбирает лидер группы.');
          return;
        }
        if (ack?.worldPoint) {
          const point = globalMapSavedPoint(ack.worldPoint);
          globalMapState.playerX = point.x;
          globalMapState.playerY = point.y;
          globalMapState.selectedX = point.x;
          globalMapState.selectedY = point.y;
        }
        if (ack?.fromLocationId) globalMapState.fromLocationId = ack.fromLocationId;
        if (ack?.party?.length) globalMapState.party = ack.party;
        if (ack?.leaderId) globalMapSetTravelLeader(ack.leaderId, ack.leaderName || '');
        renderGlobalMapPanel();
      });
    }
    renderGlobalMapPanel();
    renderGlobalEncounterPanel();
    if (typeof queueSave === 'function') queueSave(true);
    return true;
  }

  function exposeLocalGlobalMapPerformanceHook() {
    try {
      const host = String(window.location.hostname || '').toLowerCase();
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return;
      window.__realmOpenGlobalMapForPerfTest = () => openGlobalMapFromLocationExit();
    } catch (_) {}
  }

  exposeLocalGlobalMapPerformanceHook();

  function exposeLocalBlockBuildingPerformanceHooks() {
    try {
      const host = String(window.location.hostname || '').toLowerCase();
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return;
      window.__realmBlockPerfStats = () => {
        const counts = { mesh: 0, instanced: 0, fastBatch: 0, fastSingle: 0 };
        if (scene && typeof scene.traverse === 'function') {
          scene.traverse(obj => {
            if (!obj) return;
            if (obj.isMesh) counts.mesh += 1;
            if (obj.isInstancedMesh) counts.instanced += 1;
            if (obj.userData?.fastModuleBatch) counts.fastBatch += 1;
            if (obj.userData?.fastModuleBlock) counts.fastSingle += 1;
          });
        }
        return {
          locationId: currentLocation?.id || '',
          renderer: renderer?.info?.render ? { ...renderer.info.render } : null,
          counts,
          wallBlocks: Array.isArray(traderBuildingWallBlocks) ? traderBuildingWallBlocks.length : 0,
          roofBlocks: Array.isArray(traderBuildingAuthoredRoofBlocks) ? traderBuildingAuthoredRoofBlocks.length : 0,
          fadedWalls: traderRoofCutawayRuntime?.fadedWallBlocks?.size || 0,
          fadedRoofs: traderRoofCutawayRuntime?.fadedRoofBlocks?.size || 0,
          player: player ? { x: Number(player.x || 0), z: Number(player.z || 0) } : null
        };
      };
      window.__realmBlockPerfStep = (phase = 0) => {
        if (!player || !playerGroup || !Array.isArray(traderBuildingWallBlocks) || !traderBuildingWallBlocks.length) return false;
        let best = null;
        let bestD = Infinity;
        traderBuildingWallBlocks.forEach(block => {
          const ud = block?.userData || {};
          const x = Number.isFinite(Number(ud.traderWallWorldX)) ? Number(ud.traderWallWorldX) : Number(block?.position?.x || 0);
          const z = Number.isFinite(Number(ud.traderWallWorldZ)) ? Number(ud.traderWallWorldZ) : Number(block?.position?.z || 0);
          const d = Math.hypot(Number(player.x || 0) - x, Number(player.z || 0) - z);
          if (d < bestD) { bestD = d; best = { x, z }; }
        });
        if (!best) return false;
        const p = Number(phase || 0);
        const radiusX = Math.max(2.4, Number(TILE || 2.0) * 1.45);
        const radiusZ = Math.max(2.4, Number(TILE || 2.0) * 1.15);
        player.x = best.x + Math.sin(p) * radiusX;
        player.z = best.z + Math.cos(p) * radiusZ;
        playerGroup.position.set(player.x, 0, player.z);
        if (typeof requestTraderRoofCutawayRefresh === 'function') requestTraderRoofCutawayRefresh('perf-block-step');
        return { x: player.x, z: player.z, anchor: best };
      };
      window.__realmBlockPerfLoadLocation = (id = '') => {
        const locId = String(id || '').trim();
        if (!locId || !LOCATIONS || !LOCATIONS[locId] || typeof buildWorld !== 'function') return false;
        currentLocation = LOCATIONS[locId];
        try {
          if (globalMapState) {
            globalMapState.onWorldMap = false;
            globalMapState.open = false;
          }
        } catch (_) {}
        buildWorld();
        const loc = currentLocation || {};
        const spawn = loc.spawn && typeof tileToWorld === 'function'
          ? tileToWorld(Number(loc.spawn.tx || MAP_W / 2), Number(loc.spawn.tz || MAP_H / 2))
          : null;
        if (player && playerGroup && spawn) {
          player.x = spawn.x;
          player.z = spawn.z;
          playerGroup.position.set(player.x, 0, player.z);
        }
        if (typeof requestTraderRoofCutawayRefresh === 'function') requestTraderRoofCutawayRefresh('perf-location-load');
        return typeof window.__realmBlockPerfStats === 'function' ? window.__realmBlockPerfStats() : true;
      };
    } catch (_) {}
  }

  exposeLocalBlockBuildingPerformanceHooks();

  let localPerfGlobalMapAutoOpenDone = false;
  function maybeAutoOpenGlobalMapForPerfTest() {
    if (localPerfGlobalMapAutoOpenDone
      || !gameStarted
      || !currentLocation
      || locationTransitionActive
      || globalMapState.onWorldMap
      || !multiplayer?.socket?.connected
      || !multiplayer.joined) return;
    try {
      const host = String(window.location.hostname || '').toLowerCase();
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return;
      const params = new URLSearchParams(window.location.search || '');
      if (!params.has('perfGlobalMap')) return;
      localPerfGlobalMapAutoOpenDone = !!openGlobalMapFromLocationExit();
    } catch (_) {}
  }

