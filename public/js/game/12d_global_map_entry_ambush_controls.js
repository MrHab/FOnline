  function enterCurrentGlobalSettlement() {
    if (!globalMapState.onWorldMap || globalMapState.travel || globalMapState.encounter) return false;
    if (blockGlobalMapGroupMovement()) return false;
    let point = globalMapPlayerPoint();
    if (globalMapPointIsWater(point.x, point.y)) {
      point = sanitizeGlobalMapPlayerLandState({ announce: true, save: true });
      renderGlobalMapPanel();
      return false;
    }
    const settlement = globalMapSettlementAt(point.x, point.y);
    const pendingDrop = globalMapState.pendingWorldDrop;
    if (!settlement) {
      const worldSite = globalMapWorldSiteAt(point.x, point.y);
      if (globalMapWorldSiteCanEnter(worldSite)) {
        addLog(`Глобальная карта: вход в ${globalMapWorldSiteTitle(worldSite)}.`, null, 'system');
        enterGlobalLocalLocation(worldSite.locationId, {
          encounter: false,
          pvpMode: worldSite.pvpMode || 'pvp',
          siteId: worldSite.id || '',
          worldPoint: { x: Number(worldSite.x || point.x), y: Number(worldSite.y || point.y) },
          originWorldPoint: point,
          entryCircle: {
            x: Number(worldSite.x || point.x),
            y: Number(worldSite.y || point.y),
            radius: globalMapWorldSiteRadius(worldSite),
            origin: point,
            kind: 'site',
            id: worldSite.id || worldSite.locationId
          }
        });
        return true;
      }
      if (pendingDrop?.locationId) {
        addLog(`Глобальная карта: вход в ${pendingDrop.encounter ? 'событие мира' : globalMapLocationName(pendingDrop.locationId)}.`, null, 'system');
        enterGlobalLocalLocation(pendingDrop.locationId, {
          encounter: !!pendingDrop.encounter,
          encounterId: pendingDrop.encounterId || '',
          pvpMode: pendingDrop.pvpMode || 'pvp',
          worldPoint: point,
          originWorldPoint: point,
          entryCircle: {
            x: point.x,
            y: point.y,
            radius: GLOBAL_LOCATION_CELL_RADIUS,
            origin: point,
            kind: pendingDrop.encounter ? 'contact' : 'site',
            id: pendingDrop.siteId || pendingDrop.encounterId || pendingDrop.locationId
          }
        });
        return true;
      }
      setReadout('Нужно находиться в зоне города, ресурсной точки или найденного события на глобальной карте.');
      return false;
    }
    addLog(`Глобальная карта: вход в ${globalMapLocationName(settlement.id)}.`, null, 'system');
    enterGlobalLocalLocation(settlement.id, {
      encounter: false,
      pvpMode: LOCATIONS[settlement.id]?.pvpMode || 'peaceful',
      worldPoint: { x: Number(settlement.x || point.x), y: Number(settlement.y || point.y) },
      originWorldPoint: point,
      entryCircle: {
        x: Number(settlement.x || point.x),
        y: Number(settlement.y || point.y),
        radius: globalMapSettlementRadius(settlement),
        origin: point,
        kind: 'settlement',
        id: settlement.id
      }
    });
    return true;
  }

  function ensureGlobalMapAmbushButton() {
    const existing = document.getElementById('global-map-ambush-btn');
    if (existing) existing.remove();
  }

  function createGlobalMapAmbush() {
    setReadout('Искусственные засады отключены: встречи возникают только от реальных сущностей мира.');
    return true;
  }

  function initGlobalMapControls() {
    ensureGlobalMapAmbushButton();
    const enterBtn = document.getElementById('global-map-enter-btn');
    const cancelBtn = document.getElementById('global-map-cancel-btn');
    const ambushBtn = document.getElementById('global-map-ambush-btn');
    if (enterBtn) enterBtn.addEventListener('click', e => { e.preventDefault(); enterCurrentGlobalSettlement(); });
    if (cancelBtn) cancelBtn.addEventListener('click', e => { e.preventDefault(); cancelGlobalTravel(); });
    if (ambushBtn && ambushBtn.dataset.bound !== '1') {
      ambushBtn.dataset.bound = '1';
      ambushBtn.addEventListener('click', e => { e.preventDefault(); createGlobalMapAmbush(); });
    }
    if (!document.body.dataset.globalMapKeyboardCameraBound) {
      document.body.dataset.globalMapKeyboardCameraBound = '1';
      document.addEventListener('keydown', e => { handleGlobalMapCameraKey(e, true); }, true);
      document.addEventListener('keyup', e => { handleGlobalMapCameraKey(e, false); }, true);
      window.addEventListener('blur', clearGlobalMapCameraKeys);
    }
    if (globalMapSurface) {
      globalMapSurface.addEventListener('pointermove', e => {
        if (handleGlobalMapPointerDrag(e)) return;
        updateGlobalMapCursor(e);
      });
      globalMapSurface.addEventListener('pointerenter', updateGlobalMapCursor);
      globalMapSurface.addEventListener('pointerleave', e => {
        handleGlobalMapPointerUp(e);
        hideGlobalMapCursor();
      });
      globalMapSurface.addEventListener('pointerdown', handleGlobalMapPointerDown);
      globalMapSurface.addEventListener('pointerup', handleGlobalMapPointerUp);
      globalMapSurface.addEventListener('pointercancel', handleGlobalMapPointerUp);
      globalMapSurface.addEventListener('contextmenu', e => e.preventDefault());
      globalMapSurface.addEventListener('wheel', handleGlobalMapWheel, { passive: false });
      globalMapSurface.addEventListener('click', e => {
        if (GLOBAL_MAP_3D.dragging || e.button !== 0) return;
        const pickedParty = globalMapWorldPartyFromClient(e.clientX, e.clientY);
        if (pickedParty && globalMapWorldPartyCanEncounter(pickedParty)) {
          openGlobalMapWorldPartyEncounter(pickedParty.id || '');
          return;
        }
        const point = globalMapPointFromClient(e.clientX, e.clientY);
        if (!point) return;
        const party = globalMapWorldPartyAt(point.x, point.y);
        if (party && globalMapWorldPartyCanEncounter(party)) {
          openGlobalMapWorldPartyEncounter(party.id || '');
          return;
        }
        selectGlobalMapDestination(point.x, point.y);
      });
    }
  }


