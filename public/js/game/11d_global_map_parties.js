  // World-party visualization helpers.
  function globalMapDeclutterRows(rows = [], minDistance = 14, offsetStep = 9) {
    const placed = [];
    return (Array.isArray(rows) ? rows : []).map((row, index) => {
      const point = clampGlobalMapPoint(row?.x, row?.y);
      const nearby = placed.filter(pos => Math.hypot(pos.x - point.x, pos.y - point.y) < minDistance);
      let display = point;
      if (nearby.length) {
        const ring = Math.floor((nearby.length - 1) / 6) + 1;
        const angle = index * 2.399963 + nearby.length * 0.82;
        display = clampGlobalMapPoint(
          point.x + Math.cos(angle) * offsetStep * ring,
          point.y + Math.sin(angle) * offsetStep * ring
        );
      }
      placed.push(display);
      return { ...row, displayX: display.x, displayY: display.y };
    });
  }

  function globalMapWorldPartyModelKey(row = {}) {
    const kind = String(row.kind || '').toLowerCase();
    const faction = globalMapFactionGroupKey(row.faction || '');
    if (kind === 'caravan') return 'caravan';
    if (kind === 'patrol') return 'patrol';
    const creatureKey = globalMapCreatureModelKeyFromParty(row);
    if (creatureKey) return creatureKey;
    if (faction === 'mutants') return 'mutant';
    if (faction === 'raiders' || kind === 'raider') return 'raider';
    if (faction === 'wild' || kind === 'monster') return globalMapWorldPartyWildSpeciesKey(row);
    return 'npc';
  }

  const GLOBAL_MAP_PARTY_GLB_KEYS = Object.freeze({
    caravan: 'friendlyBrahmin',
    mutant: 'enemySuperMutant',
    raider: 'enemyRaider',
    patrol: 'klimPatrolGuard',
    npc: 'wastelandSettler',
    radscorpion: 'enemyRadscorpion',
    mutantAnt: 'enemyMutantAnt',
    fireGecko: 'enemyFireGecko',
    gecko: 'enemyGecko',
    brahmin: 'friendlyBrahmin',
    ghoul: 'enemyGhoul',
    ashWolf: 'enemyAshWolf'
  });

  function globalMapWorldPartyGlbKey(key = '') {
    return GLOBAL_MAP_PARTY_GLB_KEYS[String(key || '')] || 'wastelandSettler';
  }

  function buildGlobalMapWorldPartyGlb(key = 'npc', visualRadius = 1) {
    const model = new THREE.Group();
    const glbKey = globalMapWorldPartyGlbKey(key);
    model.userData.partyModelKey = key;
    model.userData.staticModelKey = glbKey;
    if (typeof makeStaticModelGroup !== 'function') return model;
    const target = Math.max(0.72, Math.min(1.48, Number(visualRadius || 1) * 0.68));
    const holder = makeStaticModelGroup(glbKey, 0, 0, 0, `global-party-${key}`, {
      cloneMaterials: true,
      castShadow: false,
      receiveShadow: false,
      afterApply: (_slot, root) => {
        if (typeof fitGlobalMapStaticModelInstance === 'function') {
          fitGlobalMapStaticModelInstance(root, 0, target, 0.02);
        }
      }
    });
    model.add(holder);
    return model;
  }

  function buildGlobalMapWorldPartyModel(row = {}, color = 0xefd078, risk = 0, cargoFill = 0) {
    const group = new THREE.Group();
    const visualRadius = globalMapWorldPartyVisualRadiusWorld(row);
    const halo = new THREE.Mesh(
      new THREE.TorusBufferGeometry(visualRadius, Math.max(0.024, Math.min(0.052, visualRadius * 0.018)), 8, 64),
      new THREE.MeshBasicMaterial({
        color: risk >= 55 ? 0xff7254 : color,
        transparent: true,
        opacity: risk >= 75 ? 0.48 : 0.26,
        depthTest: false
      })
    );
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
    const key = globalMapWorldPartyModelKey(row);
    const model = buildGlobalMapWorldPartyGlb(key, visualRadius);
    model.userData.partyModelKey = key;
    model.position.y = 0.02;
    group.add(model);
    group.userData.partyHalo = halo;
    group.userData.partyModelKey = key;
    group.userData.facingOffsetY = Number(model.userData?.facingOffsetY || 0);
    group.traverse(child => {
      if (child && child.isMesh) {
        child.frustumCulled = false;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    return group;
  }

  function globalMapWorldParties3DSignature(parties = []) {
    return parties.map(row => [
      row?.id || '',
      row?.kind || '',
      row?.faction || '',
      row?.species || '',
      row?.visual || '',
      globalMapWorldPartyModelKey(row || {}),
      row?.name || '',
      row?.state || '',
      row?.destinationSiteId || '',
      row?.targetPartyId || '',
      row?.decisionKind || '',
      Math.round(globalMapWorldPartyVisualRadiusPoints(row || {}) * 10) / 10,
      Math.round(Number(row?.riskLevel || 0)),
      Math.round(Number(row?.cargoFillPercent || 0)),
      row?.threatPartyId || ''
    ].join(':')).join('|');
  }
