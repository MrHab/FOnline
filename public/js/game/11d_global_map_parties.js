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

  function globalMapWorldPartyMat(color, emissiveIntensity = 0.08) {
    return new THREE.MeshLambertMaterial({
      color,
      emissive: color,
      emissiveIntensity
    });
  }

  function globalMapAddBox(group, color, size, position, rotation = null, emissiveIntensity = 0.06) {
    const mesh = new THREE.Mesh(
      new THREE.BoxBufferGeometry(size[0], size[1], size[2]),
      globalMapWorldPartyMat(color, emissiveIntensity)
    );
    mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    group.add(mesh);
    return mesh;
  }

  function globalMapAddSphere(group, color, radius, position, scale = null, emissiveIntensity = 0.06) {
    const mesh = new THREE.Mesh(
      new THREE.SphereBufferGeometry(radius, 12, 8),
      globalMapWorldPartyMat(color, emissiveIntensity)
    );
    mesh.position.set(position[0], position[1], position[2]);
    if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
    group.add(mesh);
    return mesh;
  }

  function globalMapAddCylinder(group, color, radiusTop, radiusBottom, height, position, rotation = null, segments = 8, emissiveIntensity = 0.06) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderBufferGeometry(radiusTop, radiusBottom, height, segments),
      globalMapWorldPartyMat(color, emissiveIntensity)
    );
    mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    group.add(mesh);
    return mesh;
  }

  function globalMapAddCone(group, color, radius, height, position, rotation = null, segments = 8, emissiveIntensity = 0.08) {
    const mesh = new THREE.Mesh(
      new THREE.ConeBufferGeometry(radius, height, segments),
      globalMapWorldPartyMat(color, emissiveIntensity)
    );
    mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    group.add(mesh);
    return mesh;
  }

  function globalMapBuildHumanoidMini(color, options = {}) {
    const group = new THREE.Group();
    const cloth = options.cloth || color;
    const armor = options.armor || 0x2a2520;
    const skin = options.skin || 0xd8c09a;
    const scale = Number(options.scale || 1);
    globalMapAddCylinder(group, cloth, 0.13 * scale, 0.17 * scale, 0.48 * scale, [0, 0.48 * scale, 0], null, 8, 0.08);
    globalMapAddSphere(group, skin, 0.13 * scale, [0, 0.82 * scale, 0], [0.9, 1, 0.9], 0.04);
    globalMapAddBox(group, armor, [0.36 * scale, 0.12 * scale, 0.16 * scale], [0, 0.58 * scale, 0.02 * scale], null, 0.04);
    globalMapAddCylinder(group, armor, 0.035 * scale, 0.035 * scale, 0.56 * scale, [0.28 * scale, 0.56 * scale, -0.02 * scale], [Math.PI / 2, 0, 0.78], 6, 0.03);
    if (options.pack) {
      globalMapAddBox(group, 0x6e5133, [0.18 * scale, 0.24 * scale, 0.16 * scale], [-0.15 * scale, 0.48 * scale, -0.14 * scale], null, 0.04);
    }
    return group;
  }

  function globalMapBuildCaravanMini(color, cargoFill = 0) {
    const group = new THREE.Group();
    group.userData.facingOffsetY = Math.PI;
    globalMapAddBox(group, 0x5b3d22, [0.78, 0.28, 0.42], [0, 0.35, 0], null, 0.05);
    globalMapAddBox(group, cargoFill >= 70 ? 0xd4b45d : 0x7f8e52, [0.54, 0.28, 0.32], [0.02, 0.58, 0], null, 0.06);
    globalMapAddCylinder(group, 0x1c1610, 0.11, 0.11, 0.08, [-0.36, 0.2, -0.24], [Math.PI / 2, 0, 0], 10, 0.02);
    globalMapAddCylinder(group, 0x1c1610, 0.11, 0.11, 0.08, [0.36, 0.2, -0.24], [Math.PI / 2, 0, 0], 10, 0.02);
    const guardA = globalMapBuildHumanoidMini(color, { scale: 0.54, cloth: color, armor: 0x2f3324, pack: true });
    guardA.position.set(-0.55, 0.08, 0.22);
    const guardB = globalMapBuildHumanoidMini(color, { scale: 0.54, cloth: color, armor: 0x2f3324 });
    guardB.position.set(0.55, 0.08, 0.22);
    const brahmin = globalMapBuildBrahminMini(0x8b6b4a);
    brahmin.scale.setScalar(0.62);
    brahmin.position.set(0, 0.04, 0.56);
    group.add(guardA, guardB, brahmin);
    return group;
  }

  function globalMapBuildMutantMini(color) {
    const group = new THREE.Group();
    globalMapAddCylinder(group, color, 0.18, 0.25, 0.72, [0, 0.58, 0], null, 8, 0.14);
    globalMapAddSphere(group, 0xa6d36b, 0.18, [0, 1.02, 0], [1.08, 0.86, 1], 0.08);
    globalMapAddBox(group, 0x445030, [0.62, 0.18, 0.20], [0, 0.74, 0.02], null, 0.06);
    globalMapAddCylinder(group, 0x4a3526, 0.05, 0.07, 0.76, [0.42, 0.62, 0.04], [0.38, 0, 0.72], 6, 0.03);
    return group;
  }

  function globalMapBuildRaiderMini(color) {
    const group = new THREE.Group();
    const left = globalMapBuildHumanoidMini(color, { scale: 0.62, cloth: 0x6b3328, armor: 0x38312b, skin: 0xc8a078 });
    const right = globalMapBuildHumanoidMini(color, { scale: 0.58, cloth: 0x51342a, armor: 0x5d5b50, skin: 0xc8a078, pack: true });
    left.position.set(-0.18, 0.04, 0.02);
    right.position.set(0.26, 0.02, -0.02);
    right.rotation.y = -0.28;
    group.add(left, right);
    globalMapAddCone(group, 0xff7b53, 0.08, 0.24, [-0.42, 0.34, -0.04], [0, 0, Math.PI], 3, 0.18);
    return group;
  }

  function globalMapBuildBrahminMini(color) {
    const group = new THREE.Group();
    group.userData.facingOffsetY = Math.PI;
    globalMapAddBox(group, color, [0.68, 0.34, 0.36], [0, 0.42, 0], null, 0.04);
    globalMapAddSphere(group, 0x7d5a3d, 0.18, [-0.18, 0.68, 0.04], [1.1, 0.8, 0.9], 0.03);
    globalMapAddSphere(group, 0x7d5a3d, 0.18, [0.18, 0.68, 0.04], [1.1, 0.8, 0.9], 0.03);
    globalMapAddSphere(group, color, 0.14, [-0.22, 0.48, 0.32], [0.9, 0.72, 0.85], 0.03);
    globalMapAddSphere(group, color, 0.14, [0.22, 0.48, 0.32], [0.9, 0.72, 0.85], 0.03);
    [-0.24, 0.24].forEach(x => {
      globalMapAddCylinder(group, 0x2a1d14, 0.035, 0.035, 0.34, [x, 0.17, -0.13], null, 5, 0.02);
      globalMapAddCylinder(group, 0x2a1d14, 0.035, 0.035, 0.34, [x, 0.17, 0.17], null, 5, 0.02);
    });
    return group;
  }

  function globalMapBuildScorpionMini(color) {
    const group = new THREE.Group();
    group.userData.facingOffsetY = Math.PI / 2;
    globalMapAddSphere(group, color, 0.22, [0, 0.28, 0], [1.45, 0.72, 1], 0.1);
    globalMapAddSphere(group, 0x3a2019, 0.16, [0.28, 0.30, 0.02], [1.2, 0.7, 0.9], 0.06);
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      globalMapAddCylinder(group, 0x3a2019, 0.025, 0.025, 0.42, [i * 0.09, 0.25, -0.24], [Math.PI / 2, 0, i * 0.18], 5, 0.02);
      globalMapAddCylinder(group, 0x3a2019, 0.025, 0.025, 0.42, [i * 0.09, 0.25, 0.24], [Math.PI / 2, 0, -i * 0.18], 5, 0.02);
    }
    globalMapAddCylinder(group, color, 0.035, 0.045, 0.52, [-0.38, 0.52, 0], [0, 0, -0.82], 6, 0.06);
    globalMapAddCone(group, 0xff7254, 0.08, 0.22, [-0.58, 0.72, 0], [0, 0, -1.1], 8, 0.18);
    return group;
  }

  function globalMapBuildAntMini(color) {
    const group = new THREE.Group();
    group.userData.facingOffsetY = Math.PI / 2;
    globalMapAddSphere(group, color, 0.16, [-0.24, 0.28, 0], [1.25, 0.75, 1], 0.08);
    globalMapAddSphere(group, color, 0.18, [0, 0.30, 0], [1.1, 0.75, 1], 0.08);
    globalMapAddSphere(group, 0x5a2419, 0.14, [0.24, 0.30, 0], [1.05, 0.75, 1], 0.08);
    [-0.22, 0, 0.22].forEach(x => {
      globalMapAddCylinder(group, 0x2a120c, 0.025, 0.025, 0.38, [x, 0.24, -0.22], [Math.PI / 2, 0, 0.42], 5, 0.02);
      globalMapAddCylinder(group, 0x2a120c, 0.025, 0.025, 0.38, [x, 0.24, 0.22], [Math.PI / 2, 0, -0.42], 5, 0.02);
    });
    return group;
  }

  function globalMapBuildGeckoMini(color, fire = false) {
    const group = new THREE.Group();
    group.userData.facingOffsetY = Math.PI / 2;
    globalMapAddSphere(group, fire ? 0xc56a28 : color, 0.20, [0, 0.28, 0], [1.65, 0.65, 0.85], fire ? 0.18 : 0.08);
    globalMapAddSphere(group, fire ? 0xff9a46 : 0x6a8a58, 0.14, [0.34, 0.30, 0], [1.15, 0.72, 0.9], fire ? 0.22 : 0.07);
    globalMapAddCone(group, fire ? 0xffb15a : 0x4d6b43, 0.10, 0.48, [-0.42, 0.26, 0], [0, 0, -Math.PI / 2], 8, fire ? 0.18 : 0.06);
    [-0.16, 0.18].forEach(x => {
      globalMapAddCylinder(group, 0x2e241b, 0.025, 0.025, 0.30, [x, 0.20, -0.18], [Math.PI / 2, 0, 0.38], 5, 0.02);
      globalMapAddCylinder(group, 0x2e241b, 0.025, 0.025, 0.30, [x, 0.20, 0.18], [Math.PI / 2, 0, -0.38], 5, 0.02);
    });
    return group;
  }

  function globalMapBuildGhoulMini(color) {
    const group = new THREE.Group();
    const a = globalMapBuildHumanoidMini(0x6d745e, { scale: 0.54, cloth: 0x3b3a2e, armor: 0x26241e, skin: 0x8a8f68 });
    const b = globalMapBuildHumanoidMini(0x6d745e, { scale: 0.50, cloth: 0x2f342a, armor: 0x20231d, skin: 0x9a8f6a });
    a.rotation.z = -0.12;
    b.rotation.z = 0.14;
    b.position.set(0.26, 0.02, -0.05);
    group.add(a, b);
    return group;
  }

  function globalMapBuildWolfMini(color) {
    const group = new THREE.Group();
    group.userData.facingOffsetY = Math.PI / 2;
    globalMapAddSphere(group, color, 0.18, [0, 0.28, 0], [1.6, 0.62, 0.82], 0.08);
    globalMapAddSphere(group, 0x6b6758, 0.12, [0.36, 0.31, 0], [1.0, 0.75, 0.8], 0.05);
    globalMapAddCone(group, 0x40362e, 0.08, 0.34, [-0.38, 0.30, 0], [0, 0, -Math.PI / 2], 6, 0.04);
    [-0.22, 0.2].forEach(x => {
      globalMapAddCylinder(group, 0x2a241e, 0.03, 0.03, 0.28, [x, 0.15, -0.12], null, 5, 0.02);
      globalMapAddCylinder(group, 0x2a241e, 0.03, 0.03, 0.28, [x, 0.15, 0.12], null, 5, 0.02);
    });
    return group;
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
    let model;
    if (key === 'caravan') model = globalMapBuildCaravanMini(color, cargoFill);
    else if (key === 'mutant') model = globalMapBuildMutantMini(0x8dbb5a);
    else if (key === 'raider') model = globalMapBuildRaiderMini(color);
    else if (key === 'radscorpion') model = globalMapBuildScorpionMini(0x6d2f24);
    else if (key === 'mutantAnt') model = globalMapBuildAntMini(0x5b1f18);
    else if (key === 'fireGecko') model = globalMapBuildGeckoMini(0xc76d2b, true);
    else if (key === 'gecko') model = globalMapBuildGeckoMini(0x6f9a55, false);
    else if (key === 'brahmin') model = globalMapBuildBrahminMini(0x8b6b4a);
    else if (key === 'ghoul') model = globalMapBuildGhoulMini(color);
    else if (key === 'ashWolf') model = globalMapBuildWolfMini(0x6d6a58);
    else model = globalMapBuildHumanoidMini(color, {
      scale: key === 'patrol' ? 0.72 : 0.64,
      cloth: color,
      armor: key === 'patrol' ? 0x314033 : 0x2f3632,
      pack: key === 'patrol'
    });
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
