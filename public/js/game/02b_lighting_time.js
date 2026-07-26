  // ===== LIGHTS =====
  const hemi = new THREE.HemisphereLight(0xf0dcc0, 0x5b472e, 0.88);
  scene.add(hemi);
  // v7.60: меньше плоского ambient-света и сильнее боковой sun/fill — normal и
  // displacement карты теперь читаются как объём, а не как бледная картинка.
  const worldFill = new THREE.AmbientLight(0xf1d8b1, 0.24);
  scene.add(worldFill);
  const reliefRim = new THREE.DirectionalLight(0xffd3a0, 0.44);
  reliefRim.position.set(28, 24, -36);
  scene.add(reliefRim);
  const sun = new THREE.DirectionalLight(0xffdfad, 1.58);
  sun.position.set(-32, 52, 18);
  sun.castShadow = !!graphicsSettings.shadows && !REAL_SHADOWS_TEMP_DISABLED;
  scene.add(sun);
  scene.add(sun.target);

  // v7.74.40: night must not use the sun as a fake all-purpose light.
  // Keep the real shadow-casting light for daytime only and use a separate,
  // non-shadow-casting moon light so night stays readable without impossible
  // "sun shadows".
  const moon = new THREE.DirectionalLight(0x9db8ff, 0.0);
  moon.position.set(34, 40, -30);
  moon.castShadow = false;
  scene.add(moon);
  scene.add(moon.target);
  let sunShadowsAllowedByTime = true;

  function shadowTypeForPreset(preset) {
    const type = String(preset?.shadowType || 'soft');
    if (type === 'basic' && THREE.BasicShadowMap !== undefined) return THREE.BasicShadowMap;
    if (type === 'pcf' && THREE.PCFShadowMap !== undefined) return THREE.PCFShadowMap;
    return THREE.PCFSoftShadowMap;
  }

  function configureShadowQuality(forceMapReset = false) {
    if (!renderer || !sun || !sun.shadow) return;
    const preset = graphicsSettings || GRAPHICS_PRESETS.medium;
    const mobileShadowAllowed = !IS_MOBILE_DEVICE || preset.mobileShadows !== false;
    const enabled = !REAL_SHADOWS_TEMP_DISABLED && !!preset.shadows && sunShadowsAllowedByTime && mobileShadowAllowed;
    // v7.74.78: keep the Three.js shadow pipeline enabled even when mobile
    // presets disable the expensive sun shadow pass. Some mobile GPUs/drivers
    // can recompile MeshStandardMaterial into a flat grey path when
    // renderer.shadowMap.enabled is toggled off after the world was built.
    // We disable the caster/light pass instead of switching the renderer path.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = shadowTypeForPreset(preset);
    // Dynamic shadows stay real, but adaptive budget controls when a shadow-map
    // pass is requested. Re-rendering it every frame is the main FPS cost.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = !!enabled;
    sun.castShadow = enabled;
    const size = Math.max(256, Number(IS_MOBILE_DEVICE ? (preset.mobileShadowMap || Math.min(Number(preset.shadowMap || 1024), 768)) : (preset.shadowMap || 1024)));
    const currentW = Number(sun.shadow.mapSize?.x || 0);
    const currentH = Number(sun.shadow.mapSize?.y || 0);
    if (sun.shadow.mapSize && (currentW !== size || currentH !== size)) {
      sun.shadow.mapSize.set(size, size);
      forceMapReset = true;
    }
    const span = Math.max(18, Number(preset.shadowCameraSpan || 60));
    const cam = sun.shadow.camera;
    if (cam) {
      cam.left = -span;
      cam.right = span;
      cam.top = span;
      cam.bottom = -span;
      cam.near = 3;
      cam.far = Math.max(55, Number(preset.shadowFar || 120));
      if (typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
    }
    sun.shadow.bias = Number(preset.shadowBias ?? -0.00012);
    sun.shadow.normalBias = Number(preset.shadowNormalBias ?? 0.035);
    if ('radius' in sun.shadow) sun.shadow.radius = preset.id === 'low' ? 1 : (preset.id === 'medium' ? 1.6 : 2.2);
    if (forceMapReset && sun.shadow.map) {
      try { sun.shadow.map.dispose(); } catch (_) {}
      sun.shadow.map = null;
    }
    if (enabled) requestAdaptiveShadowUpdate('quality');
  }

  const adaptiveShadowBudget = {
    elapsed: 999,
    pending: true,
    reason: 'init',
    lastFocusX: Infinity,
    lastFocusZ: Infinity,
    lastCasterBudgetX: Infinity,
    lastCasterBudgetZ: Infinity,
    lastSunAzimuth: Infinity,
    lastSunHeight: Infinity,
    lastDynamicX: Infinity,
    lastDynamicZ: Infinity,
    worldPos: new THREE.Vector3()
  };

  function getAdaptiveShadowPlayerRef() {
    // 02_renderer_world_map.js is loaded before 04_player_model_visuals.js where
    // `const player` is declared. Directly touching that lexical binding during
    // boot hits the temporal-dead-zone and breaks the login screen. Keep the
    // shadow budget boot-safe; after player initialization the same closure will
    // resolve the real player object.
    try { return (typeof player !== 'undefined') ? player : null; }
    catch (_) { return null; }
  }

  function shadowFocusWorldPoint() {
    // v7.74.18: keep the directional-light shadow camera stable per location.
    // Following the player made the whole shadow projection crawl/jump and forced
    // expensive shadow-map refreshes while walking. The playable maps are centred
    // around world 0,0 and the preset shadow spans cover the whole active yard.
    return { x: 0, z: 0 };
  }

  function dynamicShadowMotionChanged() {
    const p = getAdaptiveShadowPlayerRef();
    if (!p) return false;
    const x = Number.isFinite(p.x) ? p.x : 0;
    const z = Number.isFinite(p.z) ? p.z : 0;
    const moved = Math.hypot(x - adaptiveShadowBudget.lastDynamicX, z - adaptiveShadowBudget.lastDynamicZ);
    // Player/enemy shadows must not update at 6-15 Hz while the actor moves,
    // otherwise the shadow visibly snaps under the feet. The expensive part is
    // caster count, not this tiny threshold; caster budget remains strict.
    const threshold = Math.max(0.012, Number((graphicsSettings || GRAPHICS_PRESETS.medium).shadowDynamicMoveThreshold || 0.012));
    if (moved <= threshold) return false;
    adaptiveShadowBudget.lastDynamicX = x;
    adaptiveShadowBudget.lastDynamicZ = z;
    return true;
  }

  function effectiveShadowUpdateFps() {
    const preset = graphicsSettings || GRAPHICS_PRESETS.medium;
    let fps = Math.max(2, Number(preset.shadowUpdateFps || 12));
    // Adaptive downgrade changes only update frequency, not the chosen preset.
    // This removes spikes during combat/crowded rooms without turning shadows off.
    if (IS_MOBILE_DEVICE) {
      fps *= 0.55;
      if (fpsValue > 0 && fpsValue < 28) fps *= 0.55;
      else if (fpsValue > 0 && fpsValue < 42) fps *= 0.75;
      return Math.max(1.5, Math.min(8, fps));
    }
    if (fpsValue > 0 && fpsValue < 26) fps *= 0.50;
    else if (fpsValue > 0 && fpsValue < 38) fps *= 0.70;
    else if (fpsValue > 0 && fpsValue > 72 && preset.id !== 'low') fps *= 1.12;
    return Math.max(2.5, Math.min(30, fps));
  }

  function requestAdaptiveShadowUpdate(reason = 'event') {
    adaptiveShadowBudget.pending = true;
    adaptiveShadowBudget.reason = reason;
    // v7.74.69: do not flip renderer.shadowMap.needsUpdate here. Setting it
    // directly makes Three.js render the expensive shadow pass on the very next
    // frame and bypasses the adaptive budget. updateAdaptiveShadowBudget() is
    // the single gate that decides when the pending shadow pass is allowed.
  }

  function focusSunShadowCamera(force = false) {
    if (!sun || !sun.shadow) return;
    const focus = shadowFocusWorldPoint();
    const preset = graphicsSettings || GRAPHICS_PRESETS.medium;
    const moveThreshold = Math.max(0.05, Number(preset.shadowFocusMoveThreshold || 0.5));
    const moved = Math.hypot(focus.x - adaptiveShadowBudget.lastFocusX, focus.z - adaptiveShadowBudget.lastFocusZ) > moveThreshold;
    const azimuth = Number.isFinite(sun.userData?.lastDynamicShadowAzimuth) ? sun.userData.lastDynamicShadowAzimuth : -Math.PI * 0.35;
    const sunHeight = Number.isFinite(sun.userData?.lastDynamicShadowHeight) ? sun.userData.lastDynamicShadowHeight : 52;
    const sunMoved = Math.abs(azimuth - adaptiveShadowBudget.lastSunAzimuth) > 0.006 || Math.abs(sunHeight - adaptiveShadowBudget.lastSunHeight) > 0.35;
    if (!force && !moved && !sunMoved) return;
    const radius = 46;
    sun.target.position.set(focus.x, 0, focus.z);
    sun.position.set(focus.x + Math.cos(azimuth) * radius, sunHeight, focus.z + Math.sin(azimuth) * radius);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    adaptiveShadowBudget.lastFocusX = focus.x;
    adaptiveShadowBudget.lastFocusZ = focus.z;
    adaptiveShadowBudget.lastSunAzimuth = azimuth;
    adaptiveShadowBudget.lastSunHeight = sunHeight;
    requestAdaptiveShadowUpdate('focus');
  }

  function shadowCasterAllowedByBudget(obj) {
    const preset = graphicsSettings || GRAPHICS_PRESETS.medium;
    const mode = String(preset.shadowCasterMode || 'high');
    if (!obj || !obj.isMesh) return false;
    const kind = String(obj.userData?.kind || obj.name || '').toLowerCase();
    if (obj.userData?.traderRoofGridCell || kind.includes('roof-grid')) return false;
    if (kind.includes('fog') || kind.includes('visibility') || kind.includes('ground-layer') || kind.includes('floor-detail')) return false;
    if (kind.includes('glow') || kind.includes('light') || kind.includes('lamp-bulb') || kind.includes('point-light')) return false;
    if (kind.includes('muzzle') || kind.includes('projectile') || kind.includes('bullet') || kind.includes('tracer') || kind.includes('label')) return false;

    const focus = shadowFocusWorldPoint();
    const radius = Math.max(10, Number(preset.shadowCasterRadius || preset.shadowCameraSpan || 40));
    obj.getWorldPosition(adaptiveShadowBudget.worldPos);
    const dx = adaptiveShadowBudget.worldPos.x - focus.x;
    const dz = adaptiveShadowBudget.worldPos.z - focus.z;
    if ((dx * dx + dz * dz) > radius * radius) return false;

    if (kind.includes('pebble') || kind.includes('grass') || kind.includes('blade') || kind.includes('decal')) return mode === 'ultra';
    if (mode === 'major') {
      return /player|trader|npc|enemy|building|wall|door|post|tree|trunk|rock|boulder|vehicle|car|crate|storage|chest|barrel|gate|tower/.test(kind);
    }
    if (mode === 'medium') {
      return !/tiny|spark|window-grille|cord|shade|strip|bolt|twig/.test(kind);
    }
    if (mode === 'high') {
      return !/spark|window-grille|cord|bolt|tiny/.test(kind);
    }
    return true;
  }

  function applyShadowCasterBudget() {
    const preset = graphicsSettings || GRAPHICS_PRESETS.medium;
    const mobileShadowAllowed = !IS_MOBILE_DEVICE || preset.mobileShadows !== false;
    const enabled = !REAL_SHADOWS_TEMP_DISABLED && !!preset.shadows && sunShadowsAllowedByTime && mobileShadowAllowed;
    scene.traverse(obj => {
      if (!obj || !obj.isMesh) return;
      if (obj.userData && obj.userData.forceNoShadow) {
        obj.castShadow = false;
        return;
      }
      if (obj.userData && obj.userData.baseCastShadow === undefined) obj.userData.baseCastShadow = !!obj.castShadow;
      obj.castShadow = enabled && obj.userData.baseCastShadow && shadowCasterAllowedByBudget(obj);
    });
  }

  function updateAdaptiveShadowBudget(dt = 0, force = false) {
    const preset = graphicsSettings || GRAPHICS_PRESETS.medium;
    const mobileShadowAllowed = !IS_MOBILE_DEVICE || preset.mobileShadows !== false;
    const enabled = !REAL_SHADOWS_TEMP_DISABLED && !!preset.shadows && sunShadowsAllowedByTime && mobileShadowAllowed;
    if (!renderer || !renderer.shadowMap || !sun || !sun.shadow || !enabled) {
      if (renderer && renderer.shadowMap) {
        // v7.74.78: do not disable renderer.shadowMap on mobile. Keep the shader
        // path stable and just skip sun shadow casting/updating.
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.autoUpdate = false;
        renderer.shadowMap.needsUpdate = false;
      }
      if (sun) sun.castShadow = false;
      return;
    }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.autoUpdate = false;
    sun.castShadow = true;

    adaptiveShadowBudget.elapsed += Math.max(0, Number(dt || 0));
    focusSunShadowCamera(force);

    const focus = shadowFocusWorldPoint();
    const rebudgetDistance = Math.max(1.5, Number(preset.shadowCasterRebudgetDistance || 3.5));
    if (force || Math.hypot(focus.x - adaptiveShadowBudget.lastCasterBudgetX, focus.z - adaptiveShadowBudget.lastCasterBudgetZ) > rebudgetDistance) {
      applyShadowCasterBudget();
      adaptiveShadowBudget.lastCasterBudgetX = focus.x;
      adaptiveShadowBudget.lastCasterBudgetZ = focus.z;
      requestAdaptiveShadowUpdate('caster-budget');
    }

    const dynamicMoved = dynamicShadowMotionChanged();
    if (!adaptiveShadowBudget.pending && dynamicMoved) {
      // Actor movement requests a new shadow map, but it is still throttled by
      // the adaptive budget. Updating the full shadow pass every animation frame
      // makes movement near buildings look like a roof/cutaway FPS hitch.
      requestAdaptiveShadowUpdate('dynamic-motion');
    }

    const updateInterval = 1 / effectiveShadowUpdateFps();
    if (!force && adaptiveShadowBudget.elapsed < updateInterval) return;
    if (!force && !adaptiveShadowBudget.pending) return;
    sun.shadow.needsUpdate = true;
    renderer.shadowMap.needsUpdate = true;
    adaptiveShadowBudget.pending = false;
    adaptiveShadowBudget.elapsed = 0;
  }

  function requestDynamicShadowRefresh(reason = 'event') {
    // Reapply quality/caster budget after location rebuild or settings change.
    // The shadow map remains dynamic, but adaptive budget decides the next pass.
    configureShadowQuality(false);
    focusSunShadowCamera(true);
    applyShadowCasterBudget();
    requestAdaptiveShadowUpdate(reason);
  }
  configureShadowQuality(true);
  applyShadowCasterBudget();
  updateAdaptiveShadowBudget(1, true);

  // ===== IN-GAME TIME / DAY-NIGHT CYCLE =====
  // 1 real hour = 1 full in-game day. Lighting is no longer tied to graphics quality.
  const GAME_DAY_REAL_MS = 60 * 60 * 1000;
  const GAME_MINUTES_PER_DAY = 24 * 60;
  const gameTimeEls = [document.getElementById('desktop-game-time'), document.getElementById('mobile-game-time')].filter(Boolean);
  const dayNightColors = {
    skyNight: new THREE.Color(0x34394a),
    skyDawn: new THREE.Color(0x775033),
    skyDay: new THREE.Color(0x3b2a1a),
    fogNight: new THREE.Color(0x394058),
    fogDawn: new THREE.Color(0x765031),
    fogDay: new THREE.Color(0x46311e),
    hemiSkyNight: new THREE.Color(0xc9d7ff),
    hemiSkyDawn: new THREE.Color(0xe2a66f),
    hemiSkyDay: new THREE.Color(0xe2c9a4),
    hemiGroundNight: new THREE.Color(0x84745e),
    hemiGroundDay: new THREE.Color(0x85643e),
    fillNight: new THREE.Color(0xc2d0ff),
    fillDawn: new THREE.Color(0xf1bb7c),
    fillDay: new THREE.Color(0xecd4ad),
    sunDawn: new THREE.Color(0xffa866),
    sunDay: new THREE.Color(0xffdfad),
    sunNight: new THREE.Color(0xffdfad),
    moonNight: new THREE.Color(0x9db8ff)
  };
  const _timeColorA = new THREE.Color();
  const _timeColorB = new THREE.Color();
  const traderInteriorLightObjects = [];
  let lastGameTimeText = '';
  let lastLightingSecond = -1;
  let gameClockHour = 12;

  function clampLighting01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0));
  }

  function smooth01(v) {
    v = clampLighting01(v);
    return v * v * (3 - 2 * v);
  }

  function lerpNumber(a, b, t) {
    return a + (b - a) * t;
  }

  function graphicsPresetRank() {
    const id = String((graphicsSettings && graphicsSettings.id) || graphicsQuality || 'medium');
    if (id === 'ultra') return 3;
    if (id === 'high') return 2;
    if (id === 'medium') return 1;
    return 0;
  }

  function currentInteriorLightFactors(hourFloat = gameClockHour) {
    const sunAltitude = Math.sin((hourFloat - 6) / 24 * Math.PI * 2);
    const daylight = smooth01((sunAltitude + 0.18) / 0.83);
    const twilight = smooth01(1 - Math.abs(hourFloat - 6) / 2.2) + smooth01(1 - Math.abs(hourFloat - 18) / 2.2);
    return { daylight, night: 1 - daylight, twilight: clampLighting01(twilight) };
  }

  function updateTraderInteriorLightLevels(force = false) {
    if (!traderInteriorLightObjects.length) return;
    const rank = graphicsPresetRank();
    const factors = currentInteriorLightFactors(gameClockHour);
    const nightBoost = Math.max(factors.night, factors.twilight * 0.72);
    traderInteriorLightObjects.forEach(entry => {
      if (!entry) return;
      const enabledByQuality = rank >= Number(entry.minRank || 0);
      const visibility = entry.group && entry.group.visible === false ? false : true;
      const intensity = enabledByQuality && visibility
        ? lerpNumber(Number(entry.dayIntensity ?? 0.18), Number(entry.nightIntensity ?? 0.90), nightBoost)
        : 0;
      if (entry.light) {
        entry.light.intensity = intensity;
        entry.light.visible = intensity > 0.001;
      }
      if (entry.glowMaterial) {
        entry.glowMaterial.opacity = enabledByQuality && visibility
          ? lerpNumber(Number(entry.dayGlow ?? 0.08), Number(entry.nightGlow ?? 0.42), nightBoost)
          : 0;
      }
      if (entry.bulbMaterial && typeof entry.bulbMaterial.emissiveIntensity === 'number') {
        entry.bulbMaterial.emissiveIntensity = enabledByQuality && visibility
          ? lerpNumber(0.65, Number(entry.bulbNight ?? 1.85), nightBoost)
          : 0.05;
      }
    });
  }

  function currentGameTimeInfo(nowMs = Date.now()) {
    const dayFraction = ((nowMs % GAME_DAY_REAL_MS) + GAME_DAY_REAL_MS) % GAME_DAY_REAL_MS / GAME_DAY_REAL_MS;
    const totalMinutes = Math.floor(dayFraction * GAME_MINUTES_PER_DAY) % GAME_MINUTES_PER_DAY;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    const hourFloat = totalMinutes / 60;
    let phase = 'Ночь';
    if (hourFloat >= 5 && hourFloat < 7) phase = 'Рассвет';
    else if (hourFloat >= 7 && hourFloat < 18) phase = 'День';
    else if (hourFloat >= 18 && hourFloat < 20) phase = 'Закат';
    const text = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} · ${phase}`;
    return { dayFraction, totalMinutes, hour, minute, hourFloat, phase, text };
  }

  function currentGameDayIndex(nowMs = Date.now()) {
    return Math.floor(Number(nowMs || Date.now()) / GAME_DAY_REAL_MS);
  }

  function applyDayNightLighting(force = false) {
    const nowMs = Date.now();
    const lightingSecond = Math.floor(nowMs / 1000);
    if (!force && lightingSecond === lastLightingSecond) return;
    lastLightingSecond = lightingSecond;

    const info = currentGameTimeInfo(nowMs);
    gameClockHour = info.hourFloat;
    if (info.text !== lastGameTimeText) {
      lastGameTimeText = info.text;
      gameTimeEls.forEach(el => { el.textContent = info.text; });
    }

    // Sun altitude: 06:00 sunrise, 12:00 noon, 18:00 sunset.
    const sunAltitude = Math.sin((info.hourFloat - 6) / 24 * Math.PI * 2);
    const daylight = smooth01((sunAltitude + 0.18) / 0.83);
    const twilight = smooth01(1 - Math.abs(info.hourFloat - 6) / 2.2) + smooth01(1 - Math.abs(info.hourFloat - 18) / 2.2);
    const twilightClamped = clampLighting01(twilight);
    const night = 1 - daylight;

    _timeColorA.copy(dayNightColors.skyNight).lerp(dayNightColors.skyDay, daylight);
    _timeColorA.lerp(dayNightColors.skyDawn, twilightClamped * 0.28);
    scene.background.copy(_timeColorA);

    _timeColorB.copy(dayNightColors.fogNight).lerp(dayNightColors.fogDay, daylight);
    _timeColorB.lerp(dayNightColors.fogDawn, twilightClamped * 0.24);
    if (scene.fog) {
      scene.fog.color.copy(_timeColorB);
      // Time controls atmosphere; graphics quality controls resolution/shadows/effects only.
      // Mobile screens crushed the old night into near-black. Night fog is now
      // thinner and cooler, while daytime density remains almost unchanged.
      scene.fog.density = lerpNumber(IS_MOBILE_DEVICE ? 0.00175 : 0.00205, 0.0026, daylight) + twilightClamped * 0.00010;
    }

    hemi.color.copy(dayNightColors.hemiSkyNight).lerp(dayNightColors.hemiSkyDay, daylight);
    hemi.color.lerp(dayNightColors.hemiSkyDawn, twilightClamped * 0.35);
    hemi.groundColor.copy(dayNightColors.hemiGroundNight).lerp(dayNightColors.hemiGroundDay, daylight);
    hemi.intensity = lerpNumber(IS_MOBILE_DEVICE ? 1.22 : 1.08, 0.92, daylight) + twilightClamped * 0.04;

    worldFill.color.copy(dayNightColors.fillNight).lerp(dayNightColors.fillDay, daylight);
    worldFill.color.lerp(dayNightColors.fillDawn, twilightClamped * 0.22);
    worldFill.intensity = lerpNumber(IS_MOBILE_DEVICE ? 0.72 : 0.58, 0.26, daylight) + twilightClamped * 0.025;

    const moonAmount = smooth01((0.16 - sunAltitude) / 0.46);
    const sunlightAmount = smooth01(daylight);
    const sunShadowActive = !REAL_SHADOWS_TEMP_DISABLED && !!(graphicsSettings || GRAPHICS_PRESETS.medium).shadows && sunlightAmount > 0.22;
    const shadowTimeChanged = sunShadowsAllowedByTime !== sunShadowActive;
    sunShadowsAllowedByTime = sunShadowActive;

    sun.color.copy(dayNightColors.sunNight).lerp(dayNightColors.sunDay, daylight);
    sun.color.lerp(dayNightColors.sunDawn, twilightClamped * 0.55);
    // No fake sun at night: when the sun is below the horizon, it stops lighting
    // and stops casting shadows. Twilight still has a little warm light.
    sun.intensity = lerpNumber(0.0, 1.68, daylight) + twilightClamped * 0.10;
    sun.castShadow = !REAL_SHADOWS_TEMP_DISABLED && sunShadowsAllowedByTime;

    moon.color.copy(dayNightColors.moonNight);
    moon.intensity = lerpNumber(0.0, IS_MOBILE_DEVICE ? 0.92 : 0.72, moonAmount);
    moon.visible = moon.intensity > 0.01;
    moon.castShadow = false;

    if (typeof reliefRim !== 'undefined' && reliefRim) {
      reliefRim.intensity = lerpNumber(IS_MOBILE_DEVICE ? 0.28 : 0.22, 0.50, daylight) + twilightClamped * 0.03;
      reliefRim.color.copy(dayNightColors.moonNight).lerp(sun.color, Math.max(0.18, daylight));
    }

    // v7.74.40: mobile night needs readability, not a black filter. Exposure is
    // raised at night and the CSS overlay is reduced separately in the stylesheet.
    renderer.toneMappingExposure = lerpNumber(IS_MOBILE_DEVICE ? 1.28 : 1.18, IS_MOBILE_DEVICE ? 1.10 : 1.16, daylight) + twilightClamped * 0.015;
    applyTerrainNightTint(night, twilightClamped);
    updateTraderInteriorLightLevels(force);

    const azimuth = info.dayFraction * Math.PI * 2 - Math.PI * 0.35;
    const sunHeight = lerpNumber(10, 58, Math.max(0, sunAltitude));
    const radius = 46;
    // Sun/time changes request a dynamic shadow refresh, but the expensive
    // shadow pass is throttled by updateAdaptiveShadowBudget().
    sun.position.set(Math.cos(azimuth) * radius, sunHeight, Math.sin(azimuth) * radius);
    sun.userData.lastDynamicShadowAzimuth = azimuth;
    sun.userData.lastDynamicShadowHeight = sunHeight;
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();

    const moonAzimuth = azimuth + Math.PI;
    const moonHeight = lerpNumber(24, 46, moonAmount);
    moon.position.set(Math.cos(moonAzimuth) * radius, moonHeight, Math.sin(moonAzimuth) * radius);
    moon.target.position.set(0, 0, 0);
    moon.target.updateMatrixWorld();

    if (shadowTimeChanged && typeof configureShadowQuality === 'function') {
      configureShadowQuality(false);
      applyShadowCasterBudget();
    }
    if (!REAL_SHADOWS_TEMP_DISABLED && sunShadowsAllowedByTime && sun.shadow && typeof requestAdaptiveShadowUpdate === 'function') requestAdaptiveShadowUpdate('sun-time');
    else if (!sunShadowsAllowedByTime && renderer && renderer.shadowMap) {
      renderer.shadowMap.needsUpdate = false;
      if (sun.shadow) sun.shadow.needsUpdate = false;
    }

    // At night the world is softly moonlit, not darkened by a black fullscreen mask.
    document.body.classList.toggle('game-night', night > 0.55);
    document.body.classList.toggle('game-day', daylight > 0.65);
    document.body.classList.toggle('game-moonlight', moonAmount > 0.45);
  }

  applyDayNightLighting(true);

