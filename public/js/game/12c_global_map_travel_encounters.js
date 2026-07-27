  function startGlobalTravel() {
    if (typeof rejectBlockedGameplayAction === 'function'
      && rejectBlockedGameplayAction('Связь с сервером восстанавливается. Маршрут временно недоступен.')) return false;
    if (blockGlobalMapGroupMovement()) return false;
    const serverRequired = typeof clientWorldRequiresServer === 'function' && clientWorldRequiresServer();
    if (serverRequired && !(multiplayer?.socket?.connected && multiplayer.joined)) {
      setReadout('Нет соединения с сервером: маршрут пустоши не запущен.');
      if (typeof connectMultiplayer === 'function') connectMultiplayer({ waitForJoin: true, timeoutMs: 4500 });
      return false;
    }
    const fromPoint = sanitizeGlobalMapPlayerLandState({ announce: true, save: true });
    const toPoint = globalMapSelectedPoint();
    if (globalMapPointDistance(fromPoint, toPoint) <= 0.35 || globalMapState.travel) return false;
    const serverAuthoritative = !!(serverRequired && multiplayer?.socket?.connected && multiplayer.joined);
    const plannedRoutePoints = planGlobalMapInfrastructureRoute(fromPoint, toPoint);
    const waterBlock = plannedRoutePoints.length >= 2
      ? globalMapPathWaterBlock(plannedRoutePoints)
      : { reason: 'route', point: toPoint };
    if (waterBlock && !serverAuthoritative) {
      announceGlobalMapWaterBlock(waterBlock);
      renderGlobalMapPanel();
      return false;
    }
    const routePoints = waterBlock ? [fromPoint, toPoint] : plannedRoutePoints;
    globalMapState.pendingWorldDrop = null;
    const travelInfo = globalMapTravelInfoByDistance(globalMapRouteDistance(routePoints));
    const duration = travelInfo.realSeconds;
    const routeProfile = globalMapRouteProfileAlongPoints(routePoints);
    const targetSettlement = globalMapSettlementAt(toPoint.x, toPoint.y);
    const targetWorldSite = globalMapWorldSiteAt(toPoint.x, toPoint.y);
    globalMapState.travel = {
      fromPoint,
      toPoint,
      routePoints,
      targetSettlementId: targetSettlement?.id || '',
      targetWorldSiteId: targetWorldSite?.id || '',
      progress: 0,
      prevProgress: 0,
      duration,
      distanceKm: travelInfo.distanceKm,
      speedKmh: travelInfo.speedKmh,
      worldHours: travelInfo.worldHours,
      wandererSkill: travelInfo.wanderer,
      routeProfile,
      serverAuthoritative
    };
    globalMapState.encounter = null;
    globalMapState.party = globalMapPartySnapshot();
    addLog(`Глобальная карта: движение к ${targetSettlement ? globalMapLocationName(targetSettlement.id) : (targetWorldSite ? globalMapWorldSiteTitle(targetWorldSite) : 'точке пустоши')}.`, null, 'system');
    if (multiplayer?.socket?.connected && multiplayer.joined) {
      const targetLocationId = targetSettlement?.id || targetWorldSite?.locationId || 'wasteland';
      const requestStartedAt = performance.now();
      multiplayer.socket.emit('globalTravelStart', {
        fromLocationId: globalMapState.fromLocationId || currentLocation?.id || 'settlement',
        targetLocationId,
        siteId: targetWorldSite?.id || '',
        worldPoint: globalMapSavedPoint(toPoint)
      }, ack => {
        if (!ack || ack.ok === false) {
          globalMapState.travel = null;
          globalMapState.encounter = null;
          if (ack?.leaderId) globalMapSetTravelLeader(ack.leaderId, ack.leaderName || '');
          setReadout(ack?.error || 'Сервер не подтвердил маршрут пустоши.');
          renderGlobalMapPanel();
          return;
        }
        const activeTravel = globalMapState.travel;
        if (activeTravel) {
          const optimisticProgress = Math.max(0, Math.min(1, Number(activeTravel.progress || 0)));
          if (ack.fromPoint) activeTravel.fromPoint = globalMapSavedPoint(ack.fromPoint);
          if (ack.targetPoint) activeTravel.toPoint = globalMapSavedPoint(ack.targetPoint);
          if (Array.isArray(ack.routePoints) && ack.routePoints.length >= 2) {
            activeTravel.routePoints = globalMapSimplifyRoutePoints(ack.routePoints);
            activeTravel.routeProfile = globalMapRouteProfileAlongPoints(activeTravel.routePoints);
          }
          activeTravel.duration = Math.max(0.1, Number(ack.duration ?? (Number(ack.durationMs || 0) / 1000)) || activeTravel.duration || 0.1);
          activeTravel.distanceKm = Math.max(0, Number(ack.distanceKm ?? activeTravel.distanceKm ?? 0));
          activeTravel.speedKmh = Math.max(0, Number(ack.speedKmh ?? activeTravel.speedKmh ?? 0));
          activeTravel.worldHours = Math.max(0, Number(ack.worldHours ?? activeTravel.worldHours ?? 0));
          activeTravel.targetSettlementId = ack.targetLocationId && GLOBAL_MAP_NODES.some(node => node.id === ack.targetLocationId)
            ? ack.targetLocationId
            : activeTravel.targetSettlementId;
          activeTravel.targetWorldSiteId = ack.targetSiteId || activeTravel.targetWorldSiteId || '';
          activeTravel.travelId = String(ack.travelId || activeTravel.travelId || '');
          activeTravel.progress = globalMapServerTravelProgress(
            ack,
            activeTravel.duration,
            Math.max(0, performance.now() - requestStartedAt),
            optimisticProgress
          );
          activeTravel.prevProgress = activeTravel.progress;
          const serverPoint = globalMapTravelCurrentPoint(activeTravel);
          globalMapState.playerX = serverPoint.x;
          globalMapState.playerY = serverPoint.y;
        }
        if (ack.party?.length) globalMapState.party = ack.party;
        if (ack.leaderId) globalMapSetTravelLeader(ack.leaderId, ack.leaderName || '');
        renderGlobalMapPanel();
      });
    }
    renderGlobalMapPanel();
    if (typeof queueSave === 'function') queueSave(true);
    return true;
  }

  function cancelGlobalTravel() {
    if (typeof rejectBlockedGameplayAction === 'function'
      && rejectBlockedGameplayAction('Связь с сервером восстанавливается. Маршрут временно нельзя изменить.')) return false;
    if (globalMapState.attachedPartyId) {
      detachGlobalMapWorldParty();
      return;
    }
    if (!globalMapState.travel || globalMapState.encounter) return;
    const finishCancel = serverPoint => {
      const travel = globalMapState.travel;
      const p = nearestGlobalMapLandPoint(
        serverPoint ? globalMapSavedPoint(serverPoint) : globalMapTravelCurrentPoint(travel),
        travel?.fromPoint || globalMapPlayerPoint()
      );
      globalMapState.playerX = p.x;
      globalMapState.playerY = p.y;
      globalMapState.selectedX = p.x;
      globalMapState.selectedY = p.y;
      addLog('Глобальная карта: движение остановлено.', null, 'system');
      globalMapState.travel = null;
      const settlement = globalMapSettlementAt(p.x, p.y);
      const worldSite = settlement ? null : globalMapWorldSiteAt(p.x, p.y);
      if (settlement) {
        globalMapState.pendingWorldDrop = null;
        globalMapState.fromLocationId = settlement.id;
      } else if (worldSite) {
        globalMapState.pendingWorldDrop = globalMapWorldSiteCanEnter(worldSite)
          ? {
            locationId: worldSite.locationId,
            encounter: false,
            encounterId: '',
            pvpMode: worldSite.pvpMode || 'pvp',
            siteId: worldSite.id || '',
            siteName: globalMapWorldSiteTitle(worldSite)
          }
          : null;
      } else globalMapState.pendingWorldDrop = null;
      focusGlobalMapCameraOnRoute();
      renderGlobalMapPanel();
      if (typeof queueSave === 'function') queueSave(true);
    };
    if (multiplayer?.socket?.connected && multiplayer.joined) {
      multiplayer.socket.emit('globalTravelCancel', {}, ack => {
        if (!ack || ack.ok === false) {
          setReadout(ack?.error || 'Сервер не смог остановить маршрут.');
          renderGlobalMapPanel();
          return;
        }
        finishCancel(ack.worldPoint || null);
      });
      return;
    }
    if (typeof clientWorldRequiresServer === 'function' && clientWorldRequiresServer()) {
      setReadout('Нет соединения с сервером: маршрут нельзя изменить.');
      return;
    }
    finishCancel(null);
  }

  function selectGlobalMapDestination(x, y) {
    if (typeof rejectBlockedGameplayAction === 'function'
      && rejectBlockedGameplayAction('Связь с сервером восстанавливается. Выбор маршрута временно недоступен.')) return false;
    if (globalMapState.encounter) return false;
    if (blockGlobalMapGroupMovement()) return false;
    if (globalMapState.attachedPartyId) {
      detachGlobalMapWorldParty('Глобальная карта: вы покинули группу и выбрали собственный маршрут.');
    }
    keepGlobalMapCameraAfterManualDestination();
    if (globalMapState.travel) {
      const rawPoint = globalMapTravelCurrentPoint(globalMapState.travel);
      const p = nearestGlobalMapLandPoint(rawPoint, globalMapState.travel.fromPoint || globalMapPlayerPoint());
      if (globalMapPointIsWater(rawPoint.x, rawPoint.y)) announceGlobalMapWaterBlock({ reason: 'from', point: rawPoint });
      globalMapState.playerX = p.x;
      globalMapState.playerY = p.y;
      globalMapState.travel = null;
    }
    sanitizeGlobalMapPlayerLandState({ save: false });
    const point = clampGlobalMapPoint(x, y);
    const waterBlock = globalMapPointIsWater(point.x, point.y) ? { reason: 'target', point } : null;
    if (waterBlock) {
      announceGlobalMapWaterBlock(waterBlock);
      const current = globalMapPlayerPoint();
      globalMapState.selectedX = current.x;
      globalMapState.selectedY = current.y;
      globalMapState.pendingWorldDrop = null;
      renderGlobalMapPanel();
      return false;
    }
    if (globalMapPointDistance(globalMapPlayerPoint(), point) > 0.35) {
      globalMapState.pendingWorldDrop = null;
    }
    globalMapState.selectedX = point.x;
    globalMapState.selectedY = point.y;
    renderGlobalMapPanel();
    return startGlobalTravel();
  }

  function maybeTriggerGlobalEncounterAlongRoute(prevProgress = 0, nextProgress = 0) {
    // Hidden random encounters are disabled. The route only stops for real world parties and locations.
    void prevProgress;
    void nextProgress;
    return false;
  }

  function resolveGlobalEncounter(decision = 'skip') {
    if (typeof rejectBlockedGameplayAction === 'function'
      && rejectBlockedGameplayAction('Связь с сервером восстанавливается. Решение по встрече временно недоступно.')) return false;
    const encounter = globalMapState.encounter;
    if (!encounter) return;
    if (encounter.forced && decision !== 'enter') decision = 'enter';
    const travel = globalMapState.travel;
    globalMapState.encounter = null;
    if (multiplayer?.socket?.connected && multiplayer.joined) {
      multiplayer.socket.emit('globalTravelEncounterDecision', { decision, encounterId: encounter.id, title: encounter.title });
    }
    renderGlobalEncounterPanel();
    if (!travel) {
      const eventPoint = clampGlobalMapPoint(encounter.worldContactPoint?.x ?? globalMapState.playerX, encounter.worldContactPoint?.y ?? globalMapState.playerY);
      if (decision === 'enter') {
        globalMapState.playerX = eventPoint.x;
        globalMapState.playerY = eventPoint.y;
        globalMapState.selectedX = eventPoint.x;
        globalMapState.selectedY = eventPoint.y;
        const cell = globalMapPointCell(eventPoint.x, eventPoint.y);
        const profile = globalMapCellProfile(cell.cx, cell.cy);
        enterGlobalLocalLocation(encounter.locationId || pickRandomGlobalLocation(eventPoint), {
          encounter: true,
          encounterId: encounter.id,
          encounterRoomId: encounter.worldZoneRoomId || '',
          worldZoneId: encounter.worldZoneId || '',
          partyId: encounter.worldPartyId || '',
          siteId: encounter.siteId || '',
          pvpMode: encounter.pvpMode || profile.pvpMode || 'pvp',
          worldPoint: eventPoint,
          originWorldPoint: encounter.originWorldPoint || null,
          entryRadius: encounter.worldContactRadius || 0,
          entryKind: encounter.worldContactKind || encounter.kind || 'contact',
          entryId: encounter.worldContactId || encounter.worldPartyId || encounter.worldZoneId || encounter.id || ''
        });
      } else {
        const originPoint = encounter.originWorldPoint
          ? clampGlobalMapPoint(encounter.originWorldPoint.x, encounter.originWorldPoint.y)
          : globalMapPlayerPoint();
        globalMapState.playerX = originPoint.x;
        globalMapState.playerY = originPoint.y;
        globalMapState.selectedX = originPoint.x;
        globalMapState.selectedY = originPoint.y;
        addLog(`Группа обходит событие: ${encounter.title}.`, null, 'system');
        renderGlobalMapPanel();
        if (typeof queueSave === 'function') queueSave(true);
      }
      return;
    }
    travel.encounterDone = true;
    if (decision === 'enter') {
      const p = globalMapTravelCurrentPoint(travel);
      const cell = globalMapPointCell(p.x, p.y);
      const profile = globalMapCellProfile(cell.cx, cell.cy);
      finishGlobalTravel({
        targetLocationId: encounter.locationId || pickRandomGlobalLocation(p),
        encounter: true,
        encounterId: encounter.id,
        encounterRoomId: encounter.worldZoneRoomId || '',
        worldZoneId: encounter.worldZoneId || '',
        partyId: encounter.worldPartyId || '',
        siteId: encounter.siteId || '',
        pvpMode: encounter.pvpMode || profile.pvpMode || 'pvp',
        worldPoint: encounter.worldContactPoint || p,
        originWorldPoint: encounter.originWorldPoint || travel.fromPoint || null,
        entryRadius: encounter.worldContactRadius || 0,
        entryKind: encounter.worldContactKind || encounter.kind || 'contact',
        entryId: encounter.worldContactId || encounter.worldPartyId || encounter.worldZoneId || encounter.id || ''
      });
    } else {
      addLog(`Группа обходит событие: ${encounter.title}.`, null, 'system');
      renderGlobalMapPanel();
      if (typeof queueSave === 'function') queueSave(true);
    }
  }

  function globalMapEntryKeyFromApproach(targetLocationId, targetPoint = null, originPoint = null) {
    const loc = LOCATIONS[targetLocationId] || {};
    const target = targetPoint ? clampGlobalMapPoint(targetPoint.x, targetPoint.y) : globalMapPlayerPoint();
    const origin = originPoint ? clampGlobalMapPoint(originPoint.x, originPoint.y) : globalMapSelectedPoint();
    const dx = Number(origin.x || 0) - Number(target.x || 0);
    const dy = Number(origin.y || 0) - Number(target.y || 0);
    let key = '';
    if (Math.abs(dx) >= Math.abs(dy)) key = dx >= 0 ? 'entryFromEast' : 'entryFromWest';
    else key = dy >= 0 ? 'entryFromSouth' : 'entryFromNorth';
    if (loc[key]) return key;
    if (loc.entryFromWorld) return 'entryFromWorld';
    return 'spawn';
  }

  function enterGlobalLocalLocation(targetLocationId, options = {}) {
    if (typeof rejectBlockedGameplayAction === 'function'
      && rejectBlockedGameplayAction('Связь с сервером восстанавливается. Вход в локацию временно недоступен.')) return false;
    const entryCircle = options.entryCircle
      ? sanitizeGlobalMapEntryCircle(options.entryCircle)
      : globalMapEntryCircleForTarget(targetLocationId, options);
    if (entryCircle) rememberGlobalMapEntryCircle(entryCircle);
    globalMapState.attachedPartyId = '';
    globalMapState.attachedPartyTaskId = '';
    globalMapState.pendingEncounterId = options.encounterId || '';
    globalMapState.pendingEncounterRoomId = options.encounterRoomId || options.roomId || '';
    globalMapState.pendingEncounterWorldZoneId = String(options.worldZoneId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    globalMapState.pendingEncounterWorldPartyId = String(options.partyId || options.worldPartyId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    globalMapState.pendingEncounterWorldPoint = globalMapSavedPoint(options.worldPoint || globalMapPlayerPoint());
    globalMapState.fromLocationId = targetLocationId;
    globalMapState.currentWorldSiteId = String(options.siteId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const targetLoc = LOCATIONS[targetLocationId] || {};
    if (!targetLoc.randomTemplate && !targetLoc.encounterOnly) globalMapState.pendingEncounterRoomId = '';
    const pvpMode = normalizeGlobalMapPvpMode(options.pvpMode || targetLoc.pvpMode || (targetLoc.safe ? 'peaceful' : 'pvp'));
    if (targetLoc.randomTemplate || targetLoc.encounterOnly) {
      targetLoc.pvpMode = pvpMode;
      targetLoc.safe = pvpMode === 'peaceful';
      targetLoc.pvp = pvpMode !== 'peaceful';
      targetLoc.fullDrop = pvpMode === 'pvpFullDrop';
    }
    const entryKey = options.entryKey || globalMapEntryKeyFromApproach(targetLocationId, options.worldPoint || globalMapPlayerPoint(), options.originWorldPoint || globalMapState.travel?.fromPoint || null);
    const go = () => {
      closeGlobalMapMiniGame({ clearPendingDrop: true, keepEncounterState: true });
      loadLocation(targetLocationId, entryKey);
    };
    if (multiplayer?.socket?.connected && multiplayer.joined) {
      const worldPoint = globalMapSavedPoint(globalMapState.pendingEncounterWorldPoint || globalMapPlayerPoint());
      multiplayer.socket.emit('globalTravelArrive', {
        targetLocationId,
        entryKey,
        encounter: !!options.encounter,
        encounterId: options.encounterId || '',
        encounterRoomId: globalMapState.pendingEncounterRoomId || '',
        worldZoneId: globalMapState.pendingEncounterWorldZoneId || '',
        partyId: globalMapState.pendingEncounterWorldPartyId || '',
        siteId: globalMapState.currentWorldSiteId || '',
        pvpMode,
        worldPoint
      }, ack => {
        if (ack?.encounterRoomId) globalMapState.pendingEncounterRoomId = ack.encounterRoomId;
        if (ack?.worldZoneId) globalMapState.pendingEncounterWorldZoneId = String(ack.worldZoneId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
        if (ack?.partyId) globalMapState.pendingEncounterWorldPartyId = String(ack.partyId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
        if (ack?.encounterId) globalMapState.pendingEncounterId = ack.encounterId;
        if (ack?.siteId) globalMapState.currentWorldSiteId = String(ack.siteId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
        if (ack?.worldPoint) globalMapState.pendingEncounterWorldPoint = globalMapSavedPoint(ack.worldPoint);
        if (ack?.pvpMode && (targetLoc.randomTemplate || targetLoc.encounterOnly)) {
          const ackPvpMode = normalizeGlobalMapPvpMode(ack.pvpMode);
          targetLoc.pvpMode = ackPvpMode;
          targetLoc.safe = ackPvpMode === 'peaceful';
          targetLoc.pvp = ackPvpMode !== 'peaceful';
          targetLoc.fullDrop = ackPvpMode === 'pvpFullDrop';
        }
        if (ack?.ok !== false && ack?.stayOnWorldMap) {
          const point = globalMapSavedPoint(ack.worldPoint || worldPoint);
          globalMapState.playerX = point.x;
          globalMapState.playerY = point.y;
          globalMapState.selectedX = point.x;
          globalMapState.selectedY = point.y;
          globalMapState.onWorldMap = true;
          globalMapState.travel = null;
          globalMapState.encounter = null;
          globalMapState.pendingWorldDrop = null;
          renderGlobalEncounterPanel();
          renderGlobalMapPanel();
          if (typeof queueSave === 'function') queueSave(true);
          return;
        }
        if (!ack || ack.ok !== false) go();
        else {
          setReadout(ack.error || 'Группа не смогла завершить переход.');
          renderGlobalMapPanel();
          return;
        }
      });
    } else if (typeof clientWorldRequiresServer === 'function' && clientWorldRequiresServer()) {
      setReadout('Нет соединения с сервером: вход в локацию пустоши остановлен.');
      if (typeof connectMultiplayer === 'function') {
        Promise.resolve(connectMultiplayer({ waitForJoin: true, timeoutMs: 5000 })).then(ok => {
          if (ok && multiplayer?.socket?.connected && multiplayer.joined) enterGlobalLocalLocation(targetLocationId, options);
          else {
            setReadout('Нет соединения с сервером: локация не загружена локально.');
            renderGlobalMapPanel();
          }
        });
      }
    } else go();
  }

  function confirmGlobalTravelWorldPoint(travel, finalPoint, message = '') {
    const complete = serverPoint => {
      const point = serverPoint ? globalMapSavedPoint(serverPoint) : globalMapSavedPoint(finalPoint);
      globalMapState.playerX = point.x;
      globalMapState.playerY = point.y;
      globalMapState.selectedX = point.x;
      globalMapState.selectedY = point.y;
      globalMapState.travel = null;
      globalMapState.encounter = null;
      globalMapState.pendingWorldDrop = null;
      if (message) addLog(message, null, 'system');
      renderGlobalEncounterPanel();
      renderGlobalMapPanel();
      if (typeof queueSave === 'function') queueSave(true);
    };
    if (multiplayer?.socket?.connected && multiplayer.joined) {
      multiplayer.socket.emit('globalTravelArrive', {
        targetLocationId: 'wasteland',
        stayOnWorldMap: true,
        worldPoint: globalMapSavedPoint(finalPoint)
      }, ack => {
        if (!ack || ack.ok === false) {
          if (ack?.worldPoint) {
            const corrected = globalMapSavedPoint(ack.worldPoint);
            globalMapState.playerX = corrected.x;
            globalMapState.playerY = corrected.y;
          }
          travel.progress = Math.min(0.995, Math.max(0, Number(travel.progress || 0)));
          travel.prevProgress = travel.progress;
          globalMapState.travel = travel;
          setReadout(ack?.error || 'Сервер ещё не подтвердил прибытие.');
          renderGlobalMapPanel();
          return;
        }
        complete(ack.worldPoint || finalPoint);
      });
      return;
    }
    if (typeof clientWorldRequiresServer === 'function' && clientWorldRequiresServer()) {
      globalMapState.travel = travel;
      setReadout('Нет соединения с сервером: прибытие не подтверждено.');
      renderGlobalMapPanel();
      return;
    }
    complete(finalPoint);
  }

  function finishGlobalTravel(options = {}) {
    const travel = globalMapState.travel;
    if (!travel) return;
    let finalPoint = options.encounter ? globalMapTravelCurrentPoint(travel) : clampGlobalMapPoint(travel.toPoint?.x, travel.toPoint?.y);
    if (globalMapPointIsWater(finalPoint.x, finalPoint.y)) {
      finalPoint = nearestGlobalMapLandPoint(finalPoint, travel.fromPoint || globalMapPlayerPoint());
    }
    globalMapState.playerX = finalPoint.x;
    globalMapState.playerY = finalPoint.y;
    globalMapState.selectedX = finalPoint.x;
    globalMapState.selectedY = finalPoint.y;
    globalMapState.travel = null;
    globalMapState.encounter = null;
    if (options.targetLocationId) {
      enterGlobalLocalLocation(options.targetLocationId, options);
      return;
    }
    const settlement = globalMapSettlementAt(finalPoint.x, finalPoint.y);
    if (settlement) {
      globalMapState.fromLocationId = settlement.id;
      addLog(`Глобальная карта: вход в ${globalMapLocationName(settlement.id)}.`, null, 'system');
      enterGlobalLocalLocation(settlement.id, {
        encounter: false,
        pvpMode: LOCATIONS[settlement.id]?.pvpMode || 'peaceful',
        worldPoint: { x: Number(settlement.x || finalPoint.x), y: Number(settlement.y || finalPoint.y) },
        originWorldPoint: travel.fromPoint || null,
        entryCircle: {
          x: Number(settlement.x || finalPoint.x),
          y: Number(settlement.y || finalPoint.y),
          radius: globalMapSettlementRadius(settlement),
          origin: travel.fromPoint || null,
          kind: 'settlement',
          id: settlement.id
        }
      });
      return;
    }
    const worldSite = globalMapWorldSiteAt(finalPoint.x, finalPoint.y);
    if (globalMapWorldSiteCanEnter(worldSite)) {
      addLog(`Глобальная карта: вход в ${globalMapWorldSiteTitle(worldSite)}.`, null, 'system');
      enterGlobalLocalLocation(worldSite.locationId, {
        encounter: false,
        pvpMode: worldSite.pvpMode || 'pvp',
        siteId: worldSite.id || '',
        worldPoint: { x: Number(worldSite.x || finalPoint.x), y: Number(worldSite.y || finalPoint.y) },
        originWorldPoint: travel.fromPoint || null,
        entryCircle: {
          x: Number(worldSite.x || finalPoint.x),
          y: Number(worldSite.y || finalPoint.y),
          radius: globalMapWorldSiteRadius(worldSite),
          origin: travel.fromPoint || null,
          kind: 'site',
          id: worldSite.id || worldSite.locationId
        }
      });
      return;
    }
    if (worldSite) {
      confirmGlobalTravelWorldPoint(
        travel,
        finalPoint,
        `Глобальная карта: вы прибыли к точке ${globalMapWorldSiteTitle(worldSite)}. Это видимая зона мира без отдельной входной локации.`
      );
      return;
    }
    confirmGlobalTravelWorldPoint(
      travel,
      finalPoint,
      'Глобальная карта: вы прибыли в выбранную точку пустоши. Вход доступен только у городов, ресурсных точек и видимых событий мира.'
    );
  }

  function updateGlobalTravel(dt = 0) {
    const travel = globalMapState.travel;
    if (!travel && !globalMapState.onWorldMap) return false;
    Object.keys(keys).forEach(code => { keys[code] = false; });
    if (typeof stopAutoFire === 'function') stopAutoFire();
    if (typeof stopTouchAim === 'function') stopTouchAim();
    if (globalMapState.onWorldMap) {
      setGlobalMapMiniGameActive(true);
    }
    updateGlobalMapKeyboardCamera(dt);
    if (!travel) {
      renderGlobalMapRuntimeFrame(dt);
      return true;
    }
    if (globalMapState.encounter) {
      renderGlobalMapRuntimeFrame(dt);
      return true;
    }
    const prevProgress = Math.max(0, Math.min(1, Number(travel.progress || 0)));
    travel.prevProgress = prevProgress;
    travel.progress = Math.min(1, prevProgress + Math.max(0, Number(dt || 0)) / Math.max(0.1, travel.duration));
    const prevPoint = globalMapTravelPointAtProgress(travel, prevProgress);
    const nextPoint = globalMapTravelPointAtProgress(travel, travel.progress);
    const waterBlock = travel.serverAuthoritative ? null : globalMapRouteWaterBlock(prevPoint, nextPoint);
    if (waterBlock) {
      const safePoint = nearestGlobalMapLandPoint(prevPoint, travel.fromPoint || globalMapPlayerPoint());
      globalMapState.playerX = safePoint.x;
      globalMapState.playerY = safePoint.y;
      globalMapState.selectedX = safePoint.x;
      globalMapState.selectedY = safePoint.y;
      globalMapState.travel = null;
      globalMapState.encounter = null;
      globalMapState.pendingWorldDrop = null;
      announceGlobalMapWaterBlock(waterBlock);
      renderGlobalEncounterPanel();
      renderGlobalMapPanel();
      if (typeof queueSave === 'function') queueSave(true);
      return true;
    }
    if (typeof queueSave === 'function') queueSave();
    if (maybeStopGlobalTravelForWorldParty(prevPoint, nextPoint)) {
      return true;
    }
    if (maybeStopGlobalTravelForWorldLocation(prevPoint, nextPoint)) {
      return true;
    }
    if (maybeTriggerGlobalEncounterAlongRoute(prevProgress, travel.progress)) {
      return true;
    }
    if (travel.progress >= 1) finishGlobalTravel();
    else renderGlobalMapRuntimeFrame(dt);
    return true;
  }

  function handleGlobalTravelStarted(data = {}) {
    if (data.leaderId === multiplayer?.socket?.id) return;
    globalMapSetTravelLeader(data.leaderId || '', data.leaderName || '');
    if (Array.isArray(data.party)) globalMapState.party = data.party;
    const fromPoint = globalMapSavedPoint(data.fromPoint || data.worldPoint || globalMapPlayerPoint());
    const toPoint = globalMapSavedPoint(data.targetPoint || fromPoint);
    const routePoints = globalMapSimplifyRoutePoints(
      Array.isArray(data.routePoints) && data.routePoints.length >= 2
        ? data.routePoints
        : planGlobalMapInfrastructureRoute(fromPoint, toPoint)
    );
    const duration = Math.max(0.1, Number(data.duration ?? (Number(data.durationMs || 0) / 1000)) || 0.1);
    const progress = globalMapServerTravelProgress(data, duration);
    globalMapState.onWorldMap = true;
    globalMapState.encounter = null;
    globalMapState.travel = {
      fromPoint,
      toPoint,
      routePoints,
      targetSettlementId: GLOBAL_MAP_NODES.some(node => node.id === data.targetLocationId) ? data.targetLocationId : '',
      targetWorldSiteId: data.targetSiteId || '',
      travelId: String(data.travelId || ''),
      progress,
      prevProgress: progress,
      duration,
      distanceKm: Math.max(0, Number(data.distanceKm || 0)),
      speedKmh: Math.max(0, Number(data.speedKmh || 0)),
      worldHours: Math.max(0, Number(data.worldHours || 0)),
      wandererSkill: 0,
      routeProfile: globalMapRouteProfileAlongPoints(routePoints),
      serverAuthoritative: true
    };
    const currentPoint = globalMapTravelCurrentPoint(globalMapState.travel);
    globalMapState.playerX = currentPoint.x;
    globalMapState.playerY = currentPoint.y;
    globalMapState.selectedX = toPoint.x;
    globalMapState.selectedY = toPoint.y;
    renderGlobalMapPanel();
    addLog(`${data.leaderName || 'Лидер группы'} ведёт группу: ${globalMapLocationName(data.fromLocationId)} → ${globalMapLocationName(data.targetLocationId)}.`, null, 'system');
  }

  function handleGlobalTravelEnteredWorld(data = {}) {
    if (data.leaderId === multiplayer?.socket?.id) return;
    if (data.worldPoint) {
      const p = globalMapSavedPoint(data.worldPoint);
      globalMapState.playerX = p.x;
      globalMapState.playerY = p.y;
      globalMapState.selectedX = p.x;
      globalMapState.selectedY = p.y;
      globalMapState.fromLocationId = data.fromLocationId || currentLocation?.id || 'settlement';
    } else {
      setGlobalPlayerPointFromLocation(data.fromLocationId || currentLocation?.id || 'settlement');
    }
    globalMapState.onWorldMap = true;
    globalMapState.travel = null;
    globalMapState.encounter = null;
    globalMapSetTravelLeader(data.leaderId || '', data.leaderName || '');
    globalMapState.party = Array.isArray(data.party) ? data.party : globalMapPartySnapshot();
    if (typeof closeAllWindows === 'function') closeAllWindows(false);
    setGlobalMapMiniGameActive(true);
    addLog(`${data.leaderName || 'Лидер группы'} вывел группу на глобальную карту.`, null, 'system');
    renderGlobalMapPanel();
  }

  function handleGlobalTravelEncounterDecision(data = {}) {
    if (data.leaderId === multiplayer?.socket?.id) return;
    if (data.pending) addLog(`Лидер группы обнаружил событие: ${data.title || 'неизвестная угроза'}.`, null, 'combat');
    else addLog(`Решение лидера: ${data.decision === 'enter' ? 'вступить в стычку' : 'обойти событие'}.`, null, 'system');
  }

  function handleGlobalTravelCancelled(data = {}) {
    if (data.leaderId === multiplayer?.socket?.id) return;
    const point = data.worldPoint ? globalMapSavedPoint(data.worldPoint) : globalMapPlayerPoint();
    globalMapState.playerX = point.x;
    globalMapState.playerY = point.y;
    globalMapState.selectedX = point.x;
    globalMapState.selectedY = point.y;
    globalMapState.travel = null;
    globalMapState.encounter = null;
    globalMapState.onWorldMap = true;
    if (Array.isArray(data.party)) globalMapState.party = data.party;
    addLog(`${data.leaderName || 'Лидер группы'} остановил движение.`, null, 'system');
    renderGlobalMapPanel();
    if (typeof queueSave === 'function') queueSave(true);
  }

  function handleGlobalTravelArrived(data = {}) {
    if (data.leaderId === multiplayer?.socket?.id) return;
    const targetLocationId = data.targetLocationId || 'settlement';
    addLog(`${data.leaderName || 'Лидер группы'} привёл группу: ${globalMapLocationName(targetLocationId)}.`, null, 'system');
    globalMapState.fromLocationId = targetLocationId;
    if (data.worldPoint) {
      const p = globalMapSavedPoint(data.worldPoint);
      globalMapState.playerX = p.x;
      globalMapState.playerY = p.y;
      globalMapState.selectedX = p.x;
      globalMapState.selectedY = p.y;
    } else {
      setGlobalPlayerPointFromLocation(targetLocationId);
    }
    globalMapState.travel = null;
    globalMapState.encounter = null;
    if (data.stayOnWorldMap) {
      globalMapState.onWorldMap = true;
      globalMapState.pendingEncounterId = '';
      globalMapState.pendingEncounterRoomId = '';
      globalMapState.pendingEncounterWorldZoneId = '';
      globalMapState.pendingEncounterWorldPartyId = '';
      globalMapState.currentWorldSiteId = '';
      globalMapState.pendingEncounterWorldPoint = null;
      renderGlobalEncounterPanel();
      renderGlobalMapPanel();
      if (typeof queueSave === 'function') queueSave(true);
      return;
    }
    globalMapState.pendingEncounterId = data.encounterId || '';
    globalMapState.pendingEncounterRoomId = data.encounterRoomId || '';
    globalMapState.pendingEncounterWorldZoneId = String(data.worldZoneId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    globalMapState.pendingEncounterWorldPartyId = String(data.partyId || data.worldPartyId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    globalMapState.currentWorldSiteId = String(data.siteId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    globalMapState.pendingEncounterWorldPoint = data.worldPoint ? globalMapSavedPoint(data.worldPoint) : null;
    const targetLoc = LOCATIONS[targetLocationId] || {};
    if (data.pvpMode && (targetLoc.randomTemplate || targetLoc.encounterOnly)) {
      const pvpMode = normalizeGlobalMapPvpMode(data.pvpMode);
      targetLoc.pvpMode = pvpMode;
      targetLoc.safe = pvpMode === 'peaceful';
      targetLoc.pvp = pvpMode !== 'peaceful';
      targetLoc.fullDrop = pvpMode === 'pvpFullDrop';
    }
    rememberGlobalMapEntryCircle(globalMapEntryCircleForTarget(targetLocationId, {
      worldPoint: data.worldPoint || null,
      partyId: data.partyId || data.worldPartyId || '',
      siteId: data.siteId || '',
      pvpMode: data.pvpMode || '',
      originWorldPoint: globalMapPlayerPoint(),
      entryKind: data.encounter ? 'contact' : '',
      entryId: data.worldZoneId || data.partyId || data.siteId || targetLocationId
    }));
    closeGlobalMapMiniGame({ clearPendingDrop: true, keepEncounterState: true });
    const entryKey = data.entryKey || (LOCATIONS[targetLocationId]?.entryFromWorld ? 'entryFromWorld' : 'spawn');
    loadLocation(targetLocationId, entryKey);
  }
