  // ===== COMBAT EFFECTS =====
  const tracers = [];
  const floatingTexts = [];
  const npcSpeechBubbles = new Map();
  const sparks = [];

  // v7.63: combat effects must not allocate heavy geometry/lights on every shot.
  // Keep the visual punch, but move work to the GPU and reuse small shared geometry.
  const combatFxSharedGlowGeometry = markSharedGeometry(new THREE.SphereGeometry(0.085, 6, 4));
  const combatFxSharedParticleGeometry = markSharedGeometry(new THREE.SphereGeometry(1, 6, 4));

  function combatRenderTier() {
    return String(graphicsSettings?.renderEffects || 'normal');
  }

  function combatEffectScale() {
    const tier = combatRenderTier();
    const mobileMul = IS_MOBILE_DEVICE ? 0.62 : 1;
    if (tier === 'ultra') return 1 * mobileMul;
    if (tier === 'high') return 0.74 * mobileMul;
    if (tier === 'minimal') return 0.30 * mobileMul;
    return 0.52 * mobileMul;
  }

  function dynamicMuzzleLightsEnabled() {
    // v7.64: never create/remove real PointLight during a shot. In WebGL every
    // runtime light-count change can force material shader relinking and shadow
    // map refreshes; on real machines this showed up as a one-second freeze,
    // disappearing props and blinking shadows. Shots now use pooled glow meshes
    // only, so the light/shadow pipeline remains stable while firing.
    return false;
  }

  const COMBAT_TRACER_POOL_SIZE = IS_MOBILE_DEVICE ? 16 : 48;
  const COMBAT_GLOW_POOL_SIZE = IS_MOBILE_DEVICE ? 18 : 64;
  const combatTracerPool = [];
  const combatGlowPool = [];
  let combatFxPoolsReady = false;

  function createCombatTracerObject() {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(6);
    setGeometryAttributeCompat(geom, 'position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffd56a, transparent: true, opacity: 0.0, depthWrite: false });
    const line = new THREE.Line(geom, mat);
    line.frustumCulled = false;
    line.visible = false;
    line.userData.combatPooled = 'tracer';
    scene.add(line);
    return line;
  }

  function createCombatGlowObject() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc86a, transparent: true, opacity: 0.0, depthWrite: false });
    const mesh = new THREE.Mesh(combatFxSharedGlowGeometry, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.combatPooled = 'glow';
    scene.add(mesh);
    return mesh;
  }

  function ensureCombatFxPools() {
    if (combatFxPoolsReady) return;
    combatFxPoolsReady = true;
    for (let i = 0; i < COMBAT_TRACER_POOL_SIZE; i++) combatTracerPool.push(createCombatTracerObject());
    for (let i = 0; i < COMBAT_GLOW_POOL_SIZE; i++) combatGlowPool.push(createCombatGlowObject());
  }

  function acquireCombatTracer(color, x1, y1, z1, x2, y2, z2, opacity = 0.88) {
    ensureCombatFxPools();
    const line = combatTracerPool.pop() || createCombatTracerObject();
    const attr = line.geometry.getAttribute('position');
    const a = attr.array;
    a[0] = x1; a[1] = y1; a[2] = z1;
    a[3] = x2; a[4] = y2; a[5] = z2;
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    line.material.color.setHex(color || 0xffd56a);
    line.material.opacity = opacity;
    line.visible = true;
    return line;
  }

  function releaseCombatTracer(t) {
    if (!t || !t.line) return;
    if (t.pooled || t.line.userData?.combatPooled === 'tracer') {
      t.line.visible = false;
      if (t.line.material) t.line.material.opacity = 0;
      combatTracerPool.push(t.line);
      return;
    }
    scene.remove(t.line);
    if (t.line.geometry && t.line.geometry.dispose) t.line.geometry.dispose();
    if (t.mat && t.mat.dispose) t.mat.dispose();
  }

  function acquireCombatGlow(color, x, y, z, scale = 0.45, opacity = 0.84) {
    ensureCombatFxPools();
    const mesh = combatGlowPool.pop() || createCombatGlowObject();
    mesh.material.color.setHex(color || 0xffc86a);
    mesh.material.opacity = opacity;
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(scale);
    mesh.visible = true;
    return mesh;
  }

  function releaseCombatSpark(s) {
    if (!s || !s.obj) return;
    if (s.pooled || s.obj.userData?.combatPooled === 'glow') {
      s.obj.visible = false;
      if (s.obj.material) s.obj.material.opacity = 0;
      combatGlowPool.push(s.obj);
      return;
    }
    scene.remove(s.obj);
    if (s.obj.geometry && s.obj.geometry.dispose) s.obj.geometry.dispose();
    if (s.obj.material && s.obj.material.dispose) s.obj.material.dispose();
  }

  // Warm the small effect pool during boot, not on the first shot.
  ensureCombatFxPools();

  function weaponFxProfile(weaponOrId = 'pistol') {
    const id = typeof weaponOrId === 'string' ? weaponOrId : String(weaponOrId?.id || 'pistol');
    if (id === 'laserPistol') return { tracerColor: 0xff5b84, flashColor: 0xff6f9d, lightColor: 0xff84b3, tracerLife: 0.22, flashLife: 0.11 };
    if (id === 'machineGun') return { tracerColor: 0xffcb76, flashColor: 0xffd98a, lightColor: 0xffc86a, tracerLife: 0.15, flashLife: 0.07 };
    if (id === 'flamethrower') return { tracerColor: 0xff8d24, flashColor: 0xff5a00, lightColor: 0xff8f33, tracerLife: 0.12, flashLife: 0.09 };
    if (id === 'plasmaRifle') return { tracerColor: 0x75ffa8, flashColor: 0x3aff84, lightColor: 0x6fffc1, tracerLife: 0.24, flashLife: 0.1 };
    if (id === 'shotgun') return { tracerColor: 0xffe09d, flashColor: 0xffca72, lightColor: 0xffcd7a, tracerLife: 0.12, flashLife: 0.07 };
    if (id === 'rocketLauncher') return { tracerColor: 0xffd18a, flashColor: 0xff9a32, lightColor: 0xffb04d, tracerLife: 0.2, flashLife: 0.12 };
    return { tracerColor: 0xffd56a, flashColor: 0xffc86a, lightColor: 0xffc86a, tracerLife: 0.16, flashLife: 0.08 };
  }

  function clipShotFxEndToStaticCollision(x1, z1, x2, z2) {
    const dx = Number(x2 || 0) - Number(x1 || 0);
    const dz = Number(z2 || 0) - Number(z1 || 0);
    const dist = Math.hypot(dx, dz);
    if (!Number.isFinite(dist) || dist <= 0.001) return null;
    if (typeof staticCollisionRayHitDistance !== 'function') return { x: x2, z: z2, dist, clipped: false };
    const hit = staticCollisionRayHitDistance(x1, z1, dx, dz, dist, 0.025, { startPad: 0.035 });
    if (hit === null || hit >= dist - 0.04) return { x: x2, z: z2, dist, clipped: false };
    const safe = Math.max(0.0, hit - 0.055);
    if (safe < 0.16) return null;
    const nx = dx / dist;
    const nz = dz / dist;
    return { x: x1 + nx * safe, z: z1 + nz * safe, dist: safe, clipped: true };
  }

  function spawnTracer(x1, z1, x2, z2, y1 = 1.15, y2 = 1.0, options = {}) {
    const clipped = clipShotFxEndToStaticCollision(x1, z1, x2, z2);
    if (!clipped) return;
    x2 = clipped.x;
    z2 = clipped.z;
    const tracerLife = Number(options.tracerLife || 0.16);
    const line = acquireCombatTracer(options.tracerColor || 0xffd56a, x1, y1, z1, x2, y2, z2, 0.88);
    tracers.push({ line, mat: line.material, life: tracerLife, maxLife: tracerLife, pooled: true });

    const dir = new THREE.Vector3(x2 - x1, 0, z2 - z1);
    if (dir.lengthSq() > 0.0001) dir.normalize(); else dir.set(0, 0, -1);
    const flashPosX = x1 + dir.x * 0.35;
    const flashPosZ = z1 + dir.z * 0.35;
    const flashLife = Number(options.flashLife || 0.08);

    const glow = acquireCombatGlow(options.flashColor || 0xffc86a, flashPosX, y1, flashPosZ, 0.45, 0.84);
    sparks.push({ obj: glow, life: flashLife, maxLife: flashLife, kind: 'mesh', baseScale: 0.45, peakScale: 1.15, pooled: true });
  }

  function spawnBlockedMuzzleFlash(start, w = currentWeapon()) {
    if (!start || combatRenderTier() === 'minimal') return;
    const fx = weaponFxProfile(w);
    const glow = acquireCombatGlow(fx.flashColor || 0xffc86a, start.x, Number(start.y || 1.08), start.z, 0.34, 0.72);
    sparks.push({ obj: glow, life: 0.045, maxLife: 0.045, kind: 'mesh', baseScale: 0.22, peakScale: 0.62, pooled: true });
  }

  function spawnFlameCone(x1, z1, x2, z2, y1 = 1.15, y2 = 1.0, options = {}) {
    const clipped = clipShotFxEndToStaticCollision(x1, z1, x2, z2);
    if (!clipped) return;
    x2 = clipped.x;
    z2 = clipped.z;
    const start = new THREE.Vector3(x1, y1, z1);
    const target = new THREE.Vector3(x2, y2, z2);
    const dir = target.clone().sub(start);
    const planarLen = Math.hypot(dir.x, dir.z);
    if (planarLen > 0.0001) dir.multiplyScalar(1 / Math.max(0.0001, dir.length()));
    else dir.set(0, 0, -1);
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    const coneLength = Math.min(3.8, Math.max(2.4, planarLen * 0.45));
    const particleCount = Math.max(4, Math.round(12 * combatEffectScale()));
    const flashLife = Number(options.flashLife || 0.09);

    if (dynamicMuzzleLightsEnabled()) {
      const flash = new THREE.PointLight(options.lightColor || options.flashColor || 0xff8f33, 1.8, 4.2, 2);
      flash.position.set(x1 + dir.x * 0.32, y1, z1 + dir.z * 0.32);
      scene.add(flash);
      sparks.push({ obj: flash, life: flashLife, maxLife: flashLife, kind: 'light' });
    }

    for (let i = 0; i < particleCount; i++) {
      const t = (i + 1) / particleCount;
      const dist = coneLength * (0.18 + 0.82 * t) * (0.9 + Math.random() * 0.22);
      const coneRadius = 0.16 + t * 0.95;
      const side = (Math.random() - 0.5) * coneRadius;
      const rise = 0.03 + t * 0.34 + Math.random() * 0.08;
      const pos = start.clone()
        .addScaledVector(dir, dist)
        .addScaledVector(right, side)
        .add(new THREE.Vector3(0, rise, 0));
      const scale = 0.18 + t * 0.32 + Math.random() * 0.08;
      const color = i % 3 === 0 ? 0xfff1a1 : (i % 2 === 0 ? 0xffb347 : 0xff6a00);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.86, depthWrite: false });
      const mesh = new THREE.Mesh(combatFxSharedParticleGeometry, mat);
      mesh.position.copy(pos);
      mesh.scale.setScalar(scale);
      scene.add(mesh);
      sparks.push({
        obj: mesh,
        life: 0.12 + Math.random() * 0.08,
        maxLife: 0.14 + Math.random() * 0.08,
        kind: 'flame',
        baseScale: scale * 0.55,
        peakScale: scale * 1.45,
        vx: dir.x * (0.6 + t * 1.6) + right.x * ((Math.random() - 0.5) * 0.55),
        vy: 0.35 + t * 0.65,
        vz: dir.z * (0.6 + t * 1.6) + right.z * ((Math.random() - 0.5) * 0.55)
      });
    }
  }


  function spawnExplosionFx(x, z, radius = 3.5) {
    const safeRadius = Math.max(1.4, Number(radius || 3.5));
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(safeRadius * 0.72, safeRadius, 28),
      new THREE.MeshBasicMaterial({ color: 0xffa13a, transparent: true, opacity: 0.64, depthWrite: false, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.055, z);
    scene.add(ring);
    sparks.push({ obj: ring, life: 0.30, maxLife: 0.30, kind: 'mesh', baseScale: 0.55, peakScale: 1.25 });

    const core = new THREE.Mesh(
      combatFxSharedParticleGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffdd74, transparent: true, opacity: 0.90, depthWrite: false })
    );
    core.position.set(x, 0.72, z);
    core.scale.setScalar(0.55);
    scene.add(core);
    sparks.push({ obj: core, life: 0.20, maxLife: 0.20, kind: 'mesh', baseScale: 0.75, peakScale: 2.4 });

    if (dynamicMuzzleLightsEnabled()) {
      const light = new THREE.PointLight(0xff9a33, 2.4, safeRadius * 2.8, 2);
      light.position.set(x, 1.2, z);
      scene.add(light);
      sparks.push({ obj: light, life: 0.16, maxLife: 0.16, kind: 'light' });
    }

    const particleCount = Math.max(5, Math.round(14 * combatEffectScale()));
    for (let i = 0; i < particleCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 0.18 + Math.random() * 0.55;
      const scale = 0.08 + Math.random() * 0.1;
      const mesh = new THREE.Mesh(
        combatFxSharedParticleGeometry,
        new THREE.MeshBasicMaterial({ color: Math.random() < 0.45 ? 0xffe08a : 0xff6f2f, transparent: true, opacity: 0.86, depthWrite: false })
      );
      mesh.position.set(x + Math.cos(a) * d, 0.35 + Math.random() * 0.65, z + Math.sin(a) * d);
      mesh.scale.setScalar(scale);
      scene.add(mesh);
      sparks.push({ obj: mesh, life: 0.24 + Math.random() * 0.14, maxLife: 0.30, kind: 'mesh', baseScale: scale * 0.65, peakScale: scale * 1.5, vx: Math.cos(a) * (1.6 + Math.random() * 1.5), vy: 0.7 + Math.random() * 1.0, vz: Math.sin(a) * (1.6 + Math.random() * 1.5) });
    }
  }

