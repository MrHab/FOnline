  function updateTraderAuthoredRoofBlockTransparency(forceOpaque = false, candidateRows = null) {
    if (!traderBuildingAuthoredRoofBlocks.length) return false;
    const alpha = 0.24;
    let changed = false;
    let releasePending = false;
    const previous = traderRoofCutawayRuntime.fadedRoofBlocks || new Set();
    if (forceOpaque) {
      previous.forEach(block => { if (applyTraderOccluderOpacity(block, 1.0)) changed = true; });
      previous.clear();
      traderRoofCutawayRuntime.fadedRoofBlocks = previous;
      traderRoofCutawayRuntime.roofReleasePending = false;
      return changed;
    }
    const rows = Array.isArray(candidateRows)
      ? candidateRows
      : traderRowsNearWorldPoint(getTraderAuthoredRoofCutawayCache().rows, player?.x || 0, player?.z || 0);
    const activeCandidates = new Set(rows.map(row => row && row.block).filter(Boolean));
    const candidateBlocks = new Set(activeCandidates);
    previous.forEach(block => candidateBlocks.add(block));
    const next = new Set();
    candidateBlocks.forEach(block => {
      if (!block) return;
      const rawCutaway = activeCandidates.has(block) && isTraderAuthoredRoofBlockCutaway(block);
      const shouldFade = stableTraderAuthoredRoofBlockCutaway(block, rawCutaway, false);
      if (shouldFade) next.add(block);
      if (shouldFade && !rawCutaway) releasePending = true;
      if (applyTraderOccluderOpacity(block, shouldFade ? alpha : 1.0)) changed = true;
    });
    traderRoofCutawayRuntime.fadedRoofBlocks = next;
    traderRoofCutawayRuntime.roofReleasePending = releasePending;
    return changed;
  }

  function isTraderWallBlockLowerBase(block) {
    const ud = block?.userData || {};
    const row = Number(ud.traderWallRow);
    if (Number.isFinite(row)) return row <= 0;
    const box = buildTraderWallBlockBox(block);
    return !!box && Number.isFinite(box.max?.y) && box.max.y <= 1.22;
  }

  function isTraderWallBlockGameplayVisible(block) {
    if (!block || !block.userData) return false;
    const ud = block.userData;
    const tile = Number(TILE || 2.0);
    const baseX = Number(ud.traderWallLocalX || 0);
    const baseZ = Number(ud.traderWallLocalZ || 0);
    const kind = String(ud.kind || '').toLowerCase();
    const localPlayer = traderPlayerLocalPosition();
    if (!localPlayer) return false;

    // A wall block fades only when the concrete cell behind that wall, relative
    // to the player, is already free from fog-of-war. Do not sample the wall
    // cell itself, the camera side, or a wide area around it.
    const blockSize = Math.max(0.5, Number(ud.traderWallBlockSize || 1.0));
    const offset = blockSize * 1.10;
    const tangent = blockSize * 0.28;
    const samples = [];
    const add = (x, z) => samples.push({ x, z });

    if (kind.includes('front') || kind.includes('back')) {
      const dirZ = localPlayer.z < baseZ ? 1 : -1;
      const targetZ = baseZ + dirZ * offset;
      add(baseX, targetZ);
      add(baseX - tangent, targetZ);
      add(baseX + tangent, targetZ);
    } else if (kind.includes('left') || kind.includes('right')) {
      const dirX = localPlayer.x < baseX ? 1 : -1;
      const targetX = baseX + dirX * offset;
      add(targetX, baseZ);
      add(targetX, baseZ - tangent);
      add(targetX, baseZ + tangent);
    } else {
      return false;
    }

    for (const s of samples) {
      if (isTraderLocalPointFogFree(s.x, s.z)) return true;
    }
    // If the wall visually covers a floor cell already visible to the character
    // from the current camera angle, fade that wall block too.
    return isTraderWallScreenProjectionCoveringFogFreeGround(block);
  }


  function computeTraderWallCutawayFromVisibleFloor() {
    const result = new Set();
    if (!player || !camera || !camera.position || !rtsFog || !rtsFog.visibleTiles || !traderBuildingWallBlocks.length || !THREE) return result;
    const ray = computeTraderWallCutawayFromVisibleFloor._ray || (computeTraderWallCutawayFromVisibleFloor._ray = new THREE.Ray());
    const dir = computeTraderWallCutawayFromVisibleFloor._dir || (computeTraderWallCutawayFromVisibleFloor._dir = new THREE.Vector3());
    const target = computeTraderWallCutawayFromVisibleFloor._target || (computeTraderWallCutawayFromVisibleFloor._target = new THREE.Vector3());
    const hit = computeTraderWallCutawayFromVisibleFloor._hit || (computeTraderWallCutawayFromVisibleFloor._hit = new THREE.Vector3());
    const origin = camera.position;
    const tile = Number(TILE || 2.0);
    const wallCache = getTraderWallCutawayCache();
    const wallRows = wallCache.rows || [];
    if (!wallRows.length) return result;

    const wallArea = wallCache.area || { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    const maxPad = tile * 3.0;

    for (const key of rtsFog.visibleTiles) {
      const parts = String(key).split(',');
      if (parts.length < 2) continue;
      const tx = Number(parts[0]);
      const tz = Number(parts[1]);
      if (!Number.isFinite(tx) || !Number.isFinite(tz)) continue;
      const center = tileToWorld(tx, tz);
      if (center.x < wallArea.minX - maxPad || center.x > wallArea.maxX + maxPad ||
          center.z < wallArea.minZ - maxPad || center.z > wallArea.maxZ + maxPad) continue;
      const samples = [
        { x: center.x, z: center.z },
        { x: center.x - tile * 0.42, z: center.z - tile * 0.42 },
        { x: center.x - tile * 0.42, z: center.z + tile * 0.42 },
        { x: center.x + tile * 0.42, z: center.z - tile * 0.42 },
        { x: center.x + tile * 0.42, z: center.z + tile * 0.42 },
        { x: center.x, z: center.z - tile * 0.46 },
        { x: center.x, z: center.z + tile * 0.46 },
        { x: center.x - tile * 0.46, z: center.z },
        { x: center.x + tile * 0.46, z: center.z }
      ];
      for (const s of samples) {
        if (!isTraderWorldPointFogFree(s.x, s.z)) continue;
        target.set(Number(s.x || 0), traderFloorSurfaceYForWorldPoint(s.x, s.z), Number(s.z || 0));
        dir.copy(target).sub(origin);
        const distToFloor = dir.length();
        if (!Number.isFinite(distToFloor) || distToFloor <= 0.001) continue;
        dir.multiplyScalar(1 / distToFloor);
        ray.set(origin, dir);
        const candidateRows = traderWallRowsAlongSegment(wallCache, origin.x, origin.z, target.x, target.z);
        for (const row of candidateRows) {
          if (result.has(row.block)) continue;
          const resultHit = ray.intersectBox(row.box, hit);
          if (!resultHit) continue;
          const hitDist = hit.distanceTo(origin);
          if (hitDist > 0.02 && hitDist < distToFloor - 0.025) result.add(row.block);
        }
      }
    }
    return result;
  }


  function isTraderPlayerNearWallTransparencyRange() {
    if (!player) return false;
    const radius = traderCutawayNearRadiusWorld();
    const r2 = radius * radius;
    const px = Number(player.x || 0);
    const pz = Number(player.z || 0);
    const wallRows = getTraderWallCutawayCache().rows || [];
    for (let i = 0; i < wallRows.length; i++) {
      if (traderDistanceSqToBoxXZ(wallRows[i].box, px, pz) <= r2) return true;
    }
    const roofRows = getTraderAuthoredRoofCutawayCache().rows || [];
    for (let i = 0; i < roofRows.length; i++) {
      if (traderDistanceSqToBoxXZ(roofRows[i].box, px, pz) <= r2) return true;
    }
    const localPlayer = traderBuildingWorldToLocal(player.x, player.z);
    const tile = Number(TILE || 2.0);
    return isTraderPlayerNearRoofEvaluation() || (Math.abs(localPlayer.x) <= tile * 6.0 && Math.abs(localPlayer.z) <= tile * 5.0);
  }

  function quantizeTraderWallKeyValue(value, step) {
    const n = Number(value || 0);
    const s = Math.max(0.001, Number(step || 1));
    return Math.round(n / s);
  }

  function traderWallTransparencyStateKey() {
    const localPlayer = traderPlayerLocalPosition();
    const fogVersion = typeof rtsFogVisibilityVersion === 'number' ? rtsFogVisibilityVersion : 0;
    const playerKey = localPlayer
      ? `${quantizeTraderWallKeyValue(localPlayer.x, 0.45)}:${quantizeTraderWallKeyValue(localPlayer.z, 0.45)}`
      : 'no-player';
    const cameraKey = camera && camera.position
      ? `${quantizeTraderWallKeyValue(camera.position.x, 0.75)}:${quantizeTraderWallKeyValue(camera.position.y, 1.5)}:${quantizeTraderWallKeyValue(camera.position.z, 0.75)}`
      : 'no-camera';
    const zoomKey = camera && Number.isFinite(Number(camera.zoom))
      ? quantizeTraderWallKeyValue(camera.zoom, 0.05)
      : 0;
    return `${fogVersion}|${playerKey}|${cameraKey}|${zoomKey}|${isTraderPlayerNearWallTransparencyRange() ? 1 : 0}`;
  }

  function shouldUpdateTraderWallBlockTransparency(dt = 0, force = false) {
    const hasCutawayShell = !!(traderBuildingWallBlocks.length || traderBuildingAuthoredRoofBlocks.length || traderBuildingInteriorObjects.length);
    if (!hasCutawayShell || !player) return false;
    if (!isTraderYardLocation() && !locationUsesAuthoredLayout(currentLocation)) return false;
    traderRoofCutawayRuntime.wallTransparencyElapsed += Math.max(0, Number(dt || 0));
    const key = traderWallTransparencyStateKey();
    const keyChanged = key !== traderRoofCutawayRuntime.lastWallTransparencyKey;
    const elapsed = Number(traderRoofCutawayRuntime.wallTransparencyElapsed || 0);
    const minInterval = Math.max(0.04, Number(traderRoofCutawayRuntime.wallTransparencyMinInterval || 0.12));
    const releaseInterval = Math.max(0.24, Number(traderRoofCutawayRuntime.wallTransparencyMinInterval || 0.12) * 2.0);
    if (!force && keyChanged && elapsed < minInterval) return false;
    if (!force && !keyChanged) {
      if (!traderRoofCutawayRuntime.roofReleasePending) return false;
      if (elapsed < releaseInterval) return false;
    }
    traderRoofCutawayRuntime.lastWallTransparencyKey = key;
    traderRoofCutawayRuntime.wallTransparencyElapsed = 0;
    return true;
  }

  function maybeUpdateTraderWallBlockTransparency(dt = 0, force = false) {
    if (!shouldUpdateTraderWallBlockTransparency(dt, force)) return false;
    return updateTraderWallBlockTransparency();
  }


  function updateTraderWallBlockTransparency() {
    const hasCutawayShell = !!(traderBuildingWallBlocks.length || traderBuildingAuthoredRoofBlocks.length || traderBuildingInteriorObjects.length);
    if (!hasCutawayShell || !player) return false;
    const nearBuilding = isTraderPlayerNearWallTransparencyRange();
    if (!nearBuilding) {
      let resetChanged = false;
      const fadedWalls = traderRoofCutawayRuntime.fadedWallBlocks || new Set();
      fadedWalls.forEach(block => { if (applyTraderOccluderOpacity(block, 1.0)) resetChanged = true; });
      fadedWalls.clear();
      traderRoofCutawayRuntime.fadedWallBlocks = fadedWalls;
      if (updateTraderAuthoredRoofBlockTransparency(true)) resetChanged = true;
      return resetChanged;
    }
    const fadeAlpha = 0.42;
    let changed = false;

    const wallCutawaySet = computeTraderWallCutawayFromVisibleFloor();
    const previousWalls = traderRoofCutawayRuntime.fadedWallBlocks || new Set();
    previousWalls.forEach(block => {
      if (!wallCutawaySet.has(block) && applyTraderOccluderOpacity(block, 1.0)) changed = true;
    });
    wallCutawaySet.forEach(block => {
      if (block && block.userData && applyTraderOccluderOpacity(block, fadeAlpha)) changed = true;
    });
    traderRoofCutawayRuntime.fadedWallBlocks = wallCutawaySet;

    const roofRows = traderRowsNearWorldPoint(getTraderAuthoredRoofCutawayCache().rows, player.x, player.z);
    if (updateTraderAuthoredRoofBlockTransparency(false, roofRows)) changed = true;
    return changed;
  }

  function requestTraderRoofCutawayRefresh(reason = 'event') {
    traderRoofCutawayRuntime.force = true;
    traderRoofCutawayRuntime.reason = reason;
  }

  function snapshotTraderRoofWarmupState(objects) {
    const seen = new Set();
    const seenMaterials = new Set();
    const objectStates = [];
    const materialStates = [];
    const addMaterial = (material) => {
      if (!material) return;
      const list = Array.isArray(material) ? material : [material];
      list.forEach(mat => {
        if (!mat || seenMaterials.has(mat)) return;
        seenMaterials.add(mat);
        materialStates.push({
          material: mat,
          opacity: mat.opacity,
          transparent: mat.transparent,
          depthWrite: mat.depthWrite,
          depthTest: mat.depthTest
        });
      });
    };
    const addObject = (object) => {
      if (!object || seen.has(object)) return;
      seen.add(object);
      objectStates.push({
        object,
        visible: object.visible,
        frustumCulled: object.frustumCulled,
        castShadow: object.castShadow,
        receiveShadow: object.receiveShadow
      });
      addMaterial(object.material);
    };
    (objects || []).forEach(object => {
      if (!object) return;
      if (typeof object.traverse === 'function') object.traverse(addObject);
      else addObject(object);
    });

    const lightStates = traderInteriorLightObjects.map(entry => {
      if (!entry) return null;
      return {
        entry,
        lightVisible: entry.light ? entry.light.visible : undefined,
        lightIntensity: entry.light ? entry.light.intensity : undefined,
        groupVisible: entry.group ? entry.group.visible : undefined,
        glowOpacity: entry.glowMaterial ? entry.glowMaterial.opacity : undefined,
        bulbEmissiveIntensity: entry.bulbMaterial && typeof entry.bulbMaterial.emissiveIntensity === 'number'
          ? entry.bulbMaterial.emissiveIntensity
          : undefined
      };
    }).filter(Boolean);

    return { objectStates, materialStates, lightStates };
  }

  function restoreTraderRoofWarmupState(snapshot) {
    if (!snapshot) return;
    (snapshot.objectStates || []).forEach(state => {
      const object = state.object;
      if (!object) return;
      object.visible = state.visible;
      object.frustumCulled = state.frustumCulled;
      if (typeof state.castShadow !== 'undefined') object.castShadow = state.castShadow;
      if (typeof state.receiveShadow !== 'undefined') object.receiveShadow = state.receiveShadow;
    });
    (snapshot.materialStates || []).forEach(state => {
      const material = state.material;
      if (!material) return;
      if (typeof state.opacity !== 'undefined') material.opacity = state.opacity;
      if (typeof state.transparent !== 'undefined') material.transparent = state.transparent;
      if (typeof state.depthWrite !== 'undefined') material.depthWrite = state.depthWrite;
      if (typeof state.depthTest !== 'undefined') material.depthTest = state.depthTest;
    });
    traderRoofCutawayRuntime.lastRoofOpacityApplied = null;
    (snapshot.lightStates || []).forEach(state => {
      const entry = state.entry;
      if (!entry) return;
      if (entry.group && typeof state.groupVisible !== 'undefined') entry.group.visible = state.groupVisible;
      if (entry.light) {
        if (typeof state.lightVisible !== 'undefined') entry.light.visible = state.lightVisible;
        if (typeof state.lightIntensity !== 'undefined') entry.light.intensity = state.lightIntensity;
      }
      if (entry.glowMaterial && typeof state.glowOpacity !== 'undefined') entry.glowMaterial.opacity = state.glowOpacity;
      if (entry.bulbMaterial && typeof state.bulbEmissiveIntensity !== 'undefined' && typeof entry.bulbMaterial.emissiveIntensity === 'number') {
        entry.bulbMaterial.emissiveIntensity = state.bulbEmissiveIntensity;
      }
    });
  }

  function setTraderRoofWarmupRenderState(openRoof) {
    traderBuildingStaticRoofs.forEach(roof => {
      if (!roof) return;
      roof.castShadow = false;
      roof.receiveShadow = false;
      roof.frustumCulled = false;
      roof.visible = true;
    });
    traderBuildingCutawayRoofBatches.forEach(batch => {
      if (!batch || !batch.mesh) return;
      [batch.mesh, batch.ghostMesh].forEach(roofMesh => {
        if (!roofMesh) return;
        roofMesh.castShadow = false;
        roofMesh.receiveShadow = false;
        roofMesh.frustumCulled = false;
        roofMesh.visible = true;
      });
    });
    traderBuildingCutawayRoofs.forEach(roof => {
      if (!roof) return;
      roof.castShadow = false;
      roof.receiveShadow = false;
      roof.frustumCulled = false;
      roof.visible = true;
    });
    applyTraderRoofMaterialOpacity(!!openRoof, true);
    traderBuildingOcclusionVolumes.forEach(fog => {
      if (!fog) return;
      fog.castShadow = false;
      fog.receiveShadow = false;
      fog.frustumCulled = false;
      fog.visible = false;
    });
    traderBuildingInteriorObjects.forEach(obj => {
      if (!obj) return;
      obj.frustumCulled = false;
      obj.visible = true;
    });
    if (traderNpc && traderNpc.mesh) {
      traderNpc.mesh.frustumCulled = false;
      traderNpc.mesh.visible = !!openRoof;
    }

    if (openRoof) {
      traderInteriorLightObjects.forEach(entry => {
        if (!entry) return;
        if (entry.group) entry.group.visible = true;
        if (entry.light) {
          entry.light.visible = true;
          entry.light.intensity = Math.max(0.05, Number(entry.nightIntensity ?? entry.dayIntensity ?? 0.5));
        }
        if (entry.glowMaterial) entry.glowMaterial.opacity = Math.max(0.08, Number(entry.nightGlow ?? entry.dayGlow ?? 0.2));
        if (entry.bulbMaterial && typeof entry.bulbMaterial.emissiveIntensity === 'number') {
          entry.bulbMaterial.emissiveIntensity = Math.max(0.25, Number(entry.bulbNight ?? 1.4));
        }
      });
    } else {
      traderInteriorLightObjects.forEach(entry => {
        if (!entry) return;
        if (entry.group) entry.group.visible = false;
        if (entry.light) {
          entry.light.visible = false;
          entry.light.intensity = 0;
        }
        if (entry.glowMaterial) entry.glowMaterial.opacity = 0;
        if (entry.bulbMaterial && typeof entry.bulbMaterial.emissiveIntensity === 'number') entry.bulbMaterial.emissiveIntensity = 0.05;
      });
    }
  }

  function getTraderRoofWarmupObjects() {
    const objects = [];
    traderBuildingStaticRoofs.forEach(obj => { if (obj) objects.push(obj); });
    traderBuildingCutawayRoofs.forEach(obj => { if (obj) objects.push(obj); });
    traderBuildingCutawayRoofBatches.forEach(batch => { if (batch && batch.mesh) objects.push(batch.mesh); if (batch && batch.ghostMesh) objects.push(batch.ghostMesh); });
    traderBuildingAuthoredRoofBlocks.forEach(obj => { if (obj) objects.push(obj); });
    traderBuildingInteriorObjects.forEach(obj => { if (obj) objects.push(obj); });
    traderBuildingOcclusionVolumes.forEach(obj => { if (obj) objects.push(obj); });
    traderInteriorLightObjects.forEach(entry => { if (entry && entry.group) objects.push(entry.group); if (entry && entry.light) objects.push(entry.light); });
    if (traderNpc && traderNpc.mesh) objects.push(traderNpc.mesh);
    return objects;
  }

  function prewarmTraderRoofCutawayRenderState(reason = 'manual') {
    if (!renderer || !scene || !camera || !isTraderYardLocation()) return false;
    if (!traderBuildingStaticRoofs.length && !traderBuildingInteriorObjects.length) return false;
    if (traderRoofCutawayRuntime.cutawayWarmupDone && reason !== 'force') return false;

    const warmupObjects = getTraderRoofWarmupObjects();
    const snapshot = snapshotTraderRoofWarmupState(warmupObjects);
    const previousRenderTarget = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
    const previousShadowAutoUpdate = renderer.shadowMap ? renderer.shadowMap.autoUpdate : undefined;
    const previousShadowNeedsUpdate = renderer.shadowMap ? renderer.shadowMap.needsUpdate : undefined;
    const canvas = renderer.domElement;
    const canvasW = canvas ? canvas.width : 0;
    const canvasH = canvas ? canvas.height : 0;

    try {
      if (renderer.shadowMap) {
        renderer.shadowMap.autoUpdate = false;
        renderer.shadowMap.needsUpdate = false;
      }
      if (!traderRoofCutawayRuntime.cutawayWarmupTarget) {
        traderRoofCutawayRuntime.cutawayWarmupTarget = new THREE.WebGLRenderTarget(32, 32, {
          depthBuffer: true,
          stencilBuffer: false
        });
      }
      const target = traderRoofCutawayRuntime.cutawayWarmupTarget;

      // Compile and upload both variants while the player is not waiting at the doorway:
      // 1) closed roof / hidden interior, 2) open roof / visible interior + lamps.
      [false, true].forEach(openRoof => {
        setTraderRoofWarmupRenderState(openRoof);
        if (renderer.compile) {
          try { renderer.compile(scene, camera); } catch (_) {}
        }
        if (renderer.setRenderTarget && renderer.render) {
          try {
            renderer.setRenderTarget(target);
            if (renderer.clear) renderer.clear();
            renderer.render(scene, camera);
          } catch (_) {}
        }
      });

      traderRoofCutawayRuntime.cutawayWarmupDone = true;
      traderRoofCutawayRuntime.cutawayWarmupReason = reason;
      return true;
    } finally {
      restoreTraderRoofWarmupState(snapshot);
      if (renderer.setRenderTarget) {
        try { renderer.setRenderTarget(previousRenderTarget || null); } catch (_) {}
      }
      if (canvasW && canvasH && renderer.setViewport) {
        try { renderer.setViewport(0, 0, canvasW, canvasH); } catch (_) {}
      }
      if (renderer.setScissorTest) {
        try { renderer.setScissorTest(false); } catch (_) {}
      }
      if (renderer.shadowMap) {
        if (typeof previousShadowAutoUpdate !== 'undefined') renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
        if (typeof previousShadowNeedsUpdate !== 'undefined') renderer.shadowMap.needsUpdate = previousShadowNeedsUpdate;
      }
      traderRoofCutawayRuntime.cutawayWarmupScheduled = false;
    }
  }

  function scheduleTraderRoofCutawayWarmup(reason = 'idle') {
    if (traderRoofCutawayRuntime.cutawayWarmupDone || traderRoofCutawayRuntime.cutawayWarmupScheduled) return;
    if (!isTraderYardLocation() || (!traderBuildingStaticRoofs.length && !traderBuildingInteriorObjects.length)) return;
    traderRoofCutawayRuntime.cutawayWarmupScheduled = true;
    const token = ++traderRoofCutawayRuntime.cutawayWarmupToken;
    const run = () => {
      if (token !== traderRoofCutawayRuntime.cutawayWarmupToken) return;
      prewarmTraderRoofCutawayRenderState(reason);
    };
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(deadline => {
        if (token !== traderRoofCutawayRuntime.cutawayWarmupToken) return;
        if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() < 6) {
          setTimeout(run, 0);
        } else {
          run();
        }
      }, { timeout: 900 });
    } else {
      setTimeout(run, 160);
    }
  }

