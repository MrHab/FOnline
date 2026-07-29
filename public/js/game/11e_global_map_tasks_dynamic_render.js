  function globalMapWorldTaskTypeMeta(task = {}) {
    const type = String(task.type || '').toLowerCase();
    const objective = String(task.objective || '').toLowerCase();
    if (type === 'escort_caravan') return { label: 'Сопровождение', glyph: '↗', color: '#efd078', bg: 'rgba(40,30,8,0.88)' };
    if (type === 'join_patrol') return { label: 'Патруль', glyph: '!', color: '#93d982', bg: 'rgba(8,28,16,0.88)' };
    if (type === 'clear_lair') return { label: 'Логово', glyph: '!', color: '#ff4f3f', bg: 'rgba(42,8,5,0.9)' };
    if (type === 'retake_site') return { label: 'Вернуть контроль', glyph: '⚑', color: '#ff9a76', bg: 'rgba(42,12,6,0.9)' };
    if (type === 'defend_resource' && objective === 'hold_control') return { label: 'Удержать', glyph: '◆', color: '#ffcf5f', bg: 'rgba(36,28,8,0.88)' };
    if (type === 'defend_resource') return { label: 'Оборона', glyph: '!', color: '#ff7254', bg: 'rgba(42,10,6,0.9)' };
    if (type === 'deliver_supplies') return { label: 'Доставка', glyph: '+', color: '#9fd7ff', bg: 'rgba(8,28,38,0.88)' };
    return { label: 'Работа', glyph: '!', color: '#c8f0ff', bg: 'rgba(8,28,38,0.88)' };
  }

  function globalMapActiveWorldTasks(limit = 24) {
    return (Array.isArray(WASTELAND_SIM_STATE.worldTasks) ? WASTELAND_SIM_STATE.worldTasks : [])
      .filter(row => row && row.status === 'active')
      .slice()
      .sort((a, b) => {
        const priorityDelta = Number(b.priority || 0) - Number(a.priority || 0);
        if (priorityDelta) return priorityDelta;
        return Number(a.expiresHour || 0) - Number(b.expiresHour || 0);
      })
      .slice(0, limit);
  }

  function globalMapShouldShowTaskMarker(task = {}) {
    return false;
  }

  function globalMapWorldTaskMarkerRows(limit = 18) {
    const buckets = new Map();
    globalMapActiveWorldTasks(limit * 2).forEach(task => {
      if (!globalMapShouldShowTaskMarker(task)) return;
      const type = String(task.type || '');
      const point = ['escort_caravan', 'join_patrol'].includes(type)
        ? (globalMapTaskPartyPoint(task) || globalMapTaskSitePoint(task, false) || globalMapTaskSitePoint(task, true))
        : (globalMapTaskExplicitPoint(task) || globalMapTaskSitePoint(task, false) || globalMapTaskSitePoint(task, true) || globalMapTaskPartyPoint(task));
      if (!point) return;
      const safePoint = clampGlobalMapPoint(point.x, point.y);
      const key = `${Math.round(safePoint.x)}:${Math.round(safePoint.y)}`;
      const meta = globalMapWorldTaskTypeMeta(task);
      let row = buckets.get(key);
      if (!row) {
        row = {
          key,
          x: safePoint.x,
          y: safePoint.y,
          tasks: [],
          topTask: task,
          meta,
          priority: Number(task.priority || 0)
        };
        buckets.set(key, row);
      }
      row.tasks.push(task);
      if (Number(task.priority || 0) > Number(row.priority || 0)) {
        row.topTask = task;
        row.meta = meta;
        row.priority = Number(task.priority || 0);
      }
    });
    return [...buckets.values()]
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || b.tasks.length - a.tasks.length)
      .slice(0, limit);
  }

  function globalMapWorldTasks3DSignature(rows = []) {
    return rows.map(row => [
      row.key,
      Math.round(Number(row.x || 0) * 10) / 10,
      Math.round(Number(row.y || 0) * 10) / 10,
      row.meta?.glyph || '',
      row.meta?.label || '',
      row.meta?.color || '',
      row.tasks.length,
      row.topTask?.id || '',
      row.priority || 0
    ].join(':')).join('|');
  }

  function buildGlobalMapWorldTaskMarker(row = {}) {
    const meta = row.meta || globalMapWorldTaskTypeMeta(row.topTask || {});
    const color = parseInt(String(meta.color || '#9fd7ff').replace('#', ''), 16) || 0x9fd7ff;
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusBufferGeometry(row.tasks?.length > 1 ? 0.78 : 0.64, 0.03, 8, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.58, depthTest: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    const pin = new THREE.Mesh(
      new THREE.ConeBufferGeometry(0.26, 0.74, 4),
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.38 })
    );
    pin.position.y = 0.48;
    pin.rotation.y = Math.PI * 0.25;
    group.add(ring, pin);
    group.userData.taskRing = ring;
    return group;
  }

  function updateGlobalMap3DDynamic(dt = 0, forceHeavy = false) {
    const dynamic = ensureGlobalMap3DDynamicCache();
    if (!dynamic) return;
    const nowMs = performance.now();
    const keyPan = GLOBAL_MAP_3D && GLOBAL_MAP_3D.keyPan ? GLOBAL_MAP_3D.keyPan : {};
    const keyboardPanning = !!(keyPan.KeyW || keyPan.KeyA || keyPan.KeyS || keyPan.KeyD);
    const cameraPanning = !!(GLOBAL_MAP_3D.dragging || keyboardPanning);
    const heavyIntervalMs = cameraPanning ? 120 : 900;
    const heavyUpdate = forceHeavy || !GLOBAL_MAP_3D.dynamicHeavyReady || (cameraPanning && nowMs >= Number(GLOBAL_MAP_3D.dynamicHeavyNextAt || 0));
    if (heavyUpdate) {
      GLOBAL_MAP_3D.dynamicHeavyReady = true;
      GLOBAL_MAP_3D.dynamicHeavyNextAt = nowMs + heavyIntervalMs;
    }
    const playerPoint = globalMapState.travel ? globalMapTravelCurrentPoint(globalMapState.travel) : globalMapPlayerPoint();
    const selectedPoint = globalMapSelectedPoint();
    const destinationPoint = globalMapState.travel?.toPoint || selectedPoint;
    const hasDestination = globalMapPointDistance(playerPoint, destinationPoint) > 0.35;
    const currentSettlement = globalMapSettlementAt(playerPoint.x, playerPoint.y);
    const selectedSettlement = globalMapSettlementAt(destinationPoint.x, destinationPoint.y);
    const territoryRows = heavyUpdate ? globalMapFactionTerritoryRows() : (dynamic.cachedTerritoryRows || []);
    if (dynamic.factionTerritories) {
      if (heavyUpdate || !dynamic.factionTerritoriesSignature) {
        dynamic.cachedTerritoryRows = territoryRows;
        dynamic.cachedTerritoryRowsLength = territoryRows.length;
        const signature = globalMapFactionTerritory3DSignature(territoryRows);
        if (dynamic.factionTerritoriesSignature !== signature) {
          clearGlobalMap3DGroup(dynamic.factionTerritories);
          territoryRows.forEach(row => {
            const point = clampGlobalMapPoint((Number(row.cx || 0) + 0.5) * GLOBAL_MAP_GRID.cellPoints, (Number(row.cy || 0) + 0.5) * GLOBAL_MAP_GRID.cellPoints);
            const cell = buildGlobalMapFactionTerritoryCell(row);
            cell.position.copy(globalMap3DWorldPoint(point, 0.045));
            dynamic.factionTerritories.add(cell);
          });
          dynamic.factionTerritoriesSignature = signature;
        }
        dynamic.factionTerritories.visible = territoryRows.length > 0;
        updateGlobalMapFactionTerritoryZoomVisuals(dynamic.factionTerritories);
      }
    }
    if (dynamic.factionInfluence) {
      if (heavyUpdate || !dynamic.factionInfluenceSignature) {
        const influenceRows = globalMapFactionInfluenceRows();
        const signature = globalMapFactionInfluence3DSignature(influenceRows);
        if (dynamic.factionInfluenceSignature !== signature) {
          clearGlobalMap3DGroup(dynamic.factionInfluence);
          influenceRows.forEach(row => {
            const zone = buildGlobalMapFactionInfluenceZone(row);
            zone.position.copy(globalMap3DWorldPoint(clampGlobalMapPoint(row.x, row.y), 0.035));
            dynamic.factionInfluence.add(zone);
          });
          dynamic.factionInfluenceSignature = signature;
        }
        dynamic.factionInfluence.visible = influenceRows.length > 0 && !(dynamic.cachedTerritoryRowsLength > 0);
        updateGlobalMapFactionInfluenceZoomVisuals(dynamic.factionInfluence);
      }
    }
    if (dynamic.factionFronts) {
      if (heavyUpdate || !dynamic.factionFrontsSignature) {
        const frontRows = globalMapFactionFrontRows();
        const signature = globalMapFactionFronts3DSignature(frontRows);
        if (dynamic.factionFrontsSignature !== signature) {
          clearGlobalMap3DGroup(dynamic.factionFronts);
          dynamic.factionFrontsSignature = signature;
        }
        // Front state remains visible on the site marker itself. A connector
        // from a nearby squad looked exactly like a squad destination route.
        dynamic.factionFronts.visible = false;
      }
    }
    if (currentSettlement) {
      updateGlobalMap3DCircleLine(
        dynamic.currentCircle,
        currentSettlement,
        globalMapSettlementRadius(currentSettlement) / GLOBAL_MAP_SIZE.width * GLOBAL_MAP_3D.worldWidth
      );
    } else dynamic.currentCircle.visible = false;
    if (selectedSettlement && selectedSettlement.id !== currentSettlement?.id) {
      updateGlobalMap3DCircleLine(
        dynamic.selectedCircle,
        selectedSettlement,
        globalMapSettlementRadius(selectedSettlement) / GLOBAL_MAP_SIZE.width * GLOBAL_MAP_3D.worldWidth
      );
    } else dynamic.selectedCircle.visible = false;
    if (hasDestination) {
      const segments = 34;
      const pts = [];
      const routePoints = globalMapState.travel?.routePoints?.length >= 2
        ? globalMapRoutePointsFromProgress(globalMapState.travel.routePoints, globalMapState.travel.progress)
        : [playerPoint, destinationPoint];
      for (let i = 0; i < segments; i++) {
        if (i % 2) continue;
        const a = i / segments;
        const b = Math.min(1, (i + 0.58) / segments);
        [a, b].forEach(t => {
          pts.push(globalMap3DWorldPoint(globalMapPointAtRouteProgress(routePoints, t), 0.34));
        });
      }
      dynamic.routeLine.material.color.setHex(globalMapState.encounter ? 0xff7254 : 0xffdf7d);
      updateGlobalMapDynamicLine(dynamic.routeLine, pts);
      const flagColor = globalMapState.encounter ? 0xff7254 : 0xefd078;
      const flagEmissive = globalMapState.encounter ? 0x5a160a : 0x4c3306;
      const flagPos = globalMap3DWorldPoint(destinationPoint, 0.10);
      dynamic.flag.position.copy(flagPos);
      // The destination footprint must stay equal to the player's halo at every zoom level.
      dynamic.flag.scale.setScalar(1);
      (dynamic.flagColorMeshes || []).forEach(mesh => {
        if (!mesh?.material) return;
        mesh.material.color?.setHex?.(flagColor);
        mesh.material.emissive?.setHex?.(flagEmissive);
      });
      dynamic.flag.visible = true;
    } else {
      dynamic.routeLine.visible = false;
      dynamic.flag.visible = false;
    }
    const trackedTask = globalMapTrackedWorldTask();
    const trackedPoint = globalMapTrackedTaskTargetPoint(trackedTask);
    if (trackedPoint) {
      const segments = 34;
      const pts = [];
      for (let i = 0; i < segments; i++) {
        if (i % 2) continue;
        const a = i / segments;
        const b = Math.min(1, (i + 0.55) / segments);
        [a, b].forEach(t => {
          pts.push(globalMap3DWorldPoint({
            x: playerPoint.x + (trackedPoint.x - playerPoint.x) * t,
            y: playerPoint.y + (trackedPoint.y - playerPoint.y) * t
          }, 0.40));
        });
      }
      updateGlobalMapDynamicLine(dynamic.taskLine, pts);
      const taskPos = globalMap3DWorldPoint(trackedPoint, 0.58);
      dynamic.taskMarker.position.copy(taskPos);
      dynamic.taskMarker.visible = true;
      if (dynamic.taskRing) {
        const pulse = 1 + Math.sin(nowMs / 260) * 0.08;
        dynamic.taskRing.scale.setScalar(pulse);
      }
    } else {
      dynamic.taskLine.visible = false;
      dynamic.taskMarker.visible = false;
    }
    if (dynamic.worldTasks) {
      if (heavyUpdate || !dynamic.worldTasksSignature) {
        const taskRows = globalMapWorldTaskMarkerRows();
        const signature = globalMapWorldTasks3DSignature(taskRows);
        if (dynamic.worldTasksSignature !== signature) {
          clearGlobalMap3DGroup(dynamic.worldTasks);
          taskRows.forEach(row => {
            const marker = buildGlobalMapWorldTaskMarker(row);
            marker.position.copy(globalMap3DWorldPoint(clampGlobalMapPoint(row.x, row.y), 0.66));
            dynamic.worldTasks.add(marker);
          });
          dynamic.worldTasksSignature = signature;
        }
        dynamic.worldTasks.visible = taskRows.length > 0;
      }
      dynamic.worldTasks.children.forEach(group => {
        const ring = group?.userData?.taskRing;
        if (ring) ring.scale.setScalar(1);
      });
    }
    const playerPos = globalMap3DWorldPoint(playerPoint, 0.10);
    dynamic.playerMarker.position.copy(playerPos);
    dynamic.playerMarker.visible = true;
    updateGlobalMapPlayerModelVisuals(dynamic.playerMarker);
    updateGlobalMapPlayerModelDirection(dynamic.playerMarker, playerPoint, destinationPoint);
    if (dynamic.settlementStatus) {
      if (heavyUpdate || !dynamic.settlementStatusSignature) {
        const settlementSites = globalMapSettlementSites();
        const signature = globalMapSettlementStatus3DSignature(settlementSites);
        if (dynamic.settlementStatusSignature !== signature) {
          clearGlobalMap3DGroup(dynamic.settlementStatus);
          settlementSites.forEach(site => {
            const marker = buildGlobalMapSettlementStatusMarker(site);
            const node = GLOBAL_MAP_NODES.find(row => row && row.id === site.id);
            const point = node || site;
            marker.position.copy(globalMap3DWorldPoint(clampGlobalMapPoint(point.x, point.y), 0.18));
            dynamic.settlementStatus.add(marker);
          });
          dynamic.settlementStatusSignature = signature;
        }
        dynamic.settlementStatus.visible = settlementSites.length > 0;
      }
      dynamic.settlementStatus.children.forEach(group => {
        const ring = group?.userData?.statusRing;
        if (ring) ring.scale.setScalar(1);
      });
    }
    if (dynamic.worldSites) {
      if (heavyUpdate || !dynamic.worldSitesSignature) {
        const worldSites = globalMapWorldSites().slice(0, 140);
        const signature = globalMapWorldSites3DSignature(worldSites);
        if (dynamic.worldSitesSignature !== signature) {
          clearGlobalMap3DGroup(dynamic.worldSites);
          worldSites.forEach(row => {
            const color = parseInt(String(globalMapWorldSiteColor(row)).replace('#', ''), 16) || 0x80c8ff;
            const group = buildGlobalMapWorldSiteMarker(row, color);
            group.position.copy(globalMap3DWorldPoint(clampGlobalMapPoint(row.x, row.y), 0.24));
            dynamic.worldSites.add(group);
          });
          dynamic.worldSitesSignature = signature;
        }
        dynamic.worldSites.visible = worldSites.length > 0;
      }
    }
    if (dynamic.worldParties) {
      if (heavyUpdate || !dynamic.worldPartiesSignature) {
        const allPartyRows = (Array.isArray(WASTELAND_SIM_STATE.parties) ? WASTELAND_SIM_STATE.parties : []);
        const partyRows = allPartyRows
          .filter(row => globalMapWorldPartyVisibleOnMap(row));
        const aftermathRows = allPartyRows
          .filter(row => row
            && String(row.state || '').toLowerCase() !== 'forming'
            && globalMapWorldPartyDestroyed(row)
            && !row.respawnDisabled);
        const signature = globalMapWorldParties3DSignature([...partyRows, ...aftermathRows]);
        if (dynamic.worldPartiesSignature !== signature) {
          clearGlobalMap3DGroup(dynamic.worldParties);
          partyRows.forEach(row => {
            const colorText = globalMapWorldPartyColor(row.kind, row.faction);
            const color = parseInt(String(colorText).replace('#', ''), 16) || 0xefd078;
            const risk = Math.max(0, Math.min(100, Number(row.riskLevel || 0)));
            const cargoFill = Math.max(0, Math.min(100, Number(row.cargoFillPercent || 0)));
            const group = buildGlobalMapWorldPartyModel(row, color, risk, cargoFill);
            const label = makeGlobalMapCompactTextSprite(globalMapWorldPartyLabel(row), colorText, 'rgba(12,10,6,0.84)');
            label.position.set(0, 1.36, 0);
            label.scale.multiplyScalar(0.36);
            label.visible = Number(GLOBAL_MAP_3D.zoom || 90) <= 52 || Number(row.riskLevel || 0) >= 75;
            label.userData.ignoreWorldPartyPick = true;
            label.raycast = function noopWorldPartyLabelRaycast() {};
            tagGlobalMapWorldPartyObject(group, row.id || '');
            label.userData.ignoreWorldPartyPick = true;
            group.userData.pickRadiusPx = 0;
            group.userData.partyLabel = label;
            group.add(label);
            const displayPoint = globalMapWorldPartyDisplayPoint(row);
            group.position.copy(globalMap3DWorldPoint(displayPoint, 0.48));
            updateGlobalMapWorldPartyModelDirection(group, row, displayPoint);
            dynamic.worldParties.add(group);
          });

          aftermathRows.forEach(row => {
            const group = new THREE.Group();
            const ring = new THREE.Mesh(
              new THREE.TorusBufferGeometry(0.58, 0.024, 8, 40),
              new THREE.MeshBasicMaterial({
                color: 0xff7254,
                transparent: true,
                opacity: 0.36,
                depthTest: false
              })
            );
            ring.rotation.x = Math.PI / 2;
            const wreck = new THREE.Mesh(
              new THREE.BoxBufferGeometry(0.62, 0.12, 0.26),
              new THREE.MeshLambertMaterial({
                color: 0x2a2018,
                emissive: 0x1a0804,
                emissiveIntensity: 0.18
              })
            );
            wreck.position.y = 0.18;
            wreck.rotation.y = 0.55;
            const ember = new THREE.Mesh(
              new THREE.SphereBufferGeometry(0.13, 12, 8),
              new THREE.MeshBasicMaterial({
                color: 0xff7254,
                transparent: true,
                opacity: 0.74
              })
            );
            ember.position.set(0.22, 0.28, -0.06);
            group.add(ring, wreck, ember);
            group.position.copy(globalMap3DWorldPoint(clampGlobalMapPoint(row.x, row.y), 0.32));
            dynamic.worldParties.add(group);
          });

          dynamic.worldPartiesSignature = signature;
        }
        dynamic.worldParties.visible = partyRows.length > 0 || aftermathRows.length > 0;
      }
      const showPartyLabels = Number(GLOBAL_MAP_3D.zoom || 90) <= 52;
      dynamic.worldParties.children.forEach(group => {
        const partyId = String(group?.userData?.partyId || '');
        if (partyId) {
          const row = globalMapWorldPartyById(partyId);
          if (row) {
            const displayPoint = globalMapWorldPartyDisplayPoint(row);
            group.position.copy(globalMap3DWorldPoint(displayPoint, 0.48));
            updateGlobalMapWorldPartyModelDirection(group, row, displayPoint);
          }
        }
        const label = group?.userData?.partyLabel;
        if (label) {
          label.visible = showPartyLabels || String(group?.userData?.forceLabel || '') === '1';
          group.userData.pickRadiusPx = 0;
        }
      });
    }
  }

  function renderGlobalMap3D(dt = 0, forceHeavy = false) {
    if (!ensureGlobalMap3D()) return false;
    if (GLOBAL_MAP_3D.builtRevision !== GLOBAL_MAP_3D.revision) rebuildGlobalMap3DStatic();
    resizeGlobalMap3D(dt, forceHeavy);
    updateGlobalMap3DAdaptivePixelRatio(dt);
    updateGlobalMap3DDynamic(dt, forceHeavy);
    updateGlobalMap3DCameraTarget();
    GLOBAL_MAP_3D.renderer.render(GLOBAL_MAP_3D.scene, GLOBAL_MAP_3D.camera);
    return true;
  }

