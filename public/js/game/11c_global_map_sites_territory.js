  function addGlobalMap3DCircle(group, point, radius, color, opacity = 0.78) {
    const p = globalMap3DWorldPoint(point, 0.18);
    const pts = [];
    for (let i = 0; i <= 72; i++) {
      const a = i / 72 * Math.PI * 2;
      pts.push(new THREE.Vector3(p.x + Math.cos(a) * radius, p.y, p.z + Math.sin(a) * radius));
    }
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity })
    ));
  }

  function updateGlobalMap3DCircleLine(line, point, radius) {
    if (!line) return;
    if (!point || !Number.isFinite(radius) || radius <= 0) {
      line.visible = false;
      return;
    }
    const p = globalMap3DWorldPoint(point, 0.18);
    const pts = [];
    for (let i = 0; i <= 72; i++) {
      const a = i / 72 * Math.PI * 2;
      pts.push(new THREE.Vector3(p.x + Math.cos(a) * radius, p.y, p.z + Math.sin(a) * radius));
    }
    updateGlobalMapDynamicLine(line, pts);
  }

  function globalMapWorldSiteOutput(site = {}, id = '') {
    const output = site?.output && typeof site.output === 'object' ? site.output : {};
    const stockpile = site?.stockpile && typeof site.stockpile === 'object' ? site.stockpile : {};
    const outputAmount = Number(output[id] || 0);
    return outputAmount > 0 ? outputAmount : Number(stockpile[id] || 0) * 0.02;
  }

  function globalMapWorldSitePrimaryResource(site = {}) {
    if (globalMapWorldSiteOutput(site, 'oil') > 0) return 'oil';
    if (globalMapWorldSiteOutput(site, 'water') > 0) return 'water';
    if (globalMapWorldSiteOutput(site, 'ore') > 0) return 'ore';
    if (globalMapWorldSiteOutput(site, 'scrap') + globalMapWorldSiteOutput(site, 'ammoParts') > 0) return 'scrap';
    if (globalMapWorldSiteOutput(site, 'chemicals') > 0) return 'chemicals';
    if (globalMapWorldSiteOutput(site, 'electronics') > 0) return 'electronics';
    return String(site?.type || 'point').toLowerCase();
  }

  function makeGlobalMapSiteMat(color, emissiveIntensity = 0.08, opacity = 1) {
    return new THREE.MeshLambertMaterial({
      color,
      emissive: color,
      emissiveIntensity,
      transparent: opacity < 1,
      opacity
    });
  }

  function addGlobalMapSiteMesh(group, geometry, material, pos = {}, rot = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(Number(pos.x || 0), Number(pos.y || 0), Number(pos.z || 0));
    mesh.rotation.set(Number(rot.x || 0), Number(rot.y || 0), Number(rot.z || 0));
    group.add(mesh);
    return mesh;
  }

  function addGlobalMapWorldSiteRing(group, color) {
    const ring = new THREE.Mesh(
      new THREE.TorusBufferGeometry(0.52, 0.026, 8, 36),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.34 })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }

  function addGlobalMapOilSiteMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.82, 0.08, 0.46), makeGlobalMapSiteMat(0x2b2016, 0.02), { y: 0.05 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.026, 0.026, 0.78, 6), makeGlobalMapSiteMat(0x5c4229, 0.02), { x: -0.22, y: 0.42 }, { z: 0.27 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.026, 0.026, 0.78, 6), makeGlobalMapSiteMat(0x5c4229, 0.02), { x: 0.06, y: 0.42 }, { z: -0.27 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.92, 0.075, 0.1), makeGlobalMapSiteMat(0xb88746, 0.16), { x: 0.07, y: 0.82 }, { z: -0.24 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.13, 0.13, 0.1, 14), makeGlobalMapSiteMat(0x1b1610, 0.04), { x: -0.46, y: 0.72 }, { z: Math.PI / 2 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.16, 0.16, 0.34, 16), makeGlobalMapSiteMat(0x11100c, 0.06), { x: 0.38, y: 0.24, z: 0.2 });
  }

  function addGlobalMapWaterSiteMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.24, 0.28, 0.42, 18), makeGlobalMapSiteMat(0x5da8c8, 0.18), { y: 0.34 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.05, 0.05, 0.72, 8), makeGlobalMapSiteMat(0x2f3f45, 0.04), { x: 0.36, y: 0.24 }, { z: Math.PI / 2 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.18, 0.16, 0.18), makeGlobalMapSiteMat(0x29454f, 0.05), { x: -0.34, y: 0.16 });
    const drop = addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.15, 14, 10), makeGlobalMapSiteMat(0x79d5ff, 0.26, 0.9), { x: 0.5, y: 0.22 });
    drop.scale.set(0.72, 1.2, 0.72);
  }

  function addGlobalMapOreSiteMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.46, 0.42, 4), makeGlobalMapSiteMat(0x61574c, 0.04), { y: 0.28 }, { y: Math.PI / 4 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.42, 0.24, 0.08), makeGlobalMapSiteMat(0x171311, 0.02), { y: 0.18, z: -0.22 });
    addGlobalMapSiteMesh(group, new THREE.OctahedronBufferGeometry(0.16, 0), makeGlobalMapSiteMat(0x9a9282, 0.06), { x: -0.34, y: 0.15, z: 0.2 }, { y: 0.35 });
    addGlobalMapSiteMesh(group, new THREE.OctahedronBufferGeometry(0.12, 0), makeGlobalMapSiteMat(0xbdb08b, 0.08), { x: 0.32, y: 0.12, z: 0.18 }, { y: 0.82 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.025, 0.025, 0.62, 6), makeGlobalMapSiteMat(0x4f3925, 0.03), { x: 0.05, y: 0.46, z: 0.23 }, { z: Math.PI / 4 });
  }

  function addGlobalMapScrapSiteMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.7, 0.08, 0.38), makeGlobalMapSiteMat(0x2a2c2b, 0.02), { y: 0.08 }, { y: 0.18 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.5, 0.06, 0.24), makeGlobalMapSiteMat(0x9b7b4d, 0.06), { x: -0.08, y: 0.2, z: 0.04 }, { y: -0.42, z: 0.12 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.44, 0.055, 0.2), makeGlobalMapSiteMat(0x64706c, 0.06), { x: 0.14, y: 0.31, z: -0.05 }, { y: 0.48, z: -0.08 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.17, 0.17, 0.08, 14), makeGlobalMapSiteMat(0x161514, 0.02), { x: 0.34, y: 0.19, z: 0.2 }, { x: Math.PI / 2 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.025, 0.025, 0.64, 6), makeGlobalMapSiteMat(0xd49a47, 0.08), { x: -0.25, y: 0.31, z: -0.17 }, { z: Math.PI / 2.5 });
  }

  function addGlobalMapChemicalSiteMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.18, 0.2, 0.42, 16), makeGlobalMapSiteMat(0x3b4d2c, 0.08), { x: -0.18, y: 0.28 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.13, 0.15, 0.34, 14), makeGlobalMapSiteMat(0x6c7044, 0.08), { x: 0.18, y: 0.22, z: 0.08 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.7, 0.055, 0.18), makeGlobalMapSiteMat(0x222820, 0.04), { y: 0.12, z: -0.24 }, { y: 0.28 });
    const pool = addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.16, 14, 10), makeGlobalMapSiteMat(0x9de05c, 0.28, 0.78), { x: 0.37, y: 0.18, z: -0.18 });
    pool.scale.set(1.25, 0.32, 1.05);
  }

  function addGlobalMapElectronicsSiteMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.025, 0.025, 0.98, 8), makeGlobalMapSiteMat(0x2f3540, 0.08), { y: 0.55 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.46, 0.24, 0.035), makeGlobalMapSiteMat(0x284d62, 0.18), { y: 0.78, z: 0.08 }, { x: 0.18, y: 0.35 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.36, 0.2, 0.035), makeGlobalMapSiteMat(0x3f6b7a, 0.18), { x: -0.26, y: 0.48, z: -0.04 }, { x: -0.22, y: -0.35 });
    addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.08, 10, 8), makeGlobalMapSiteMat(color, 0.32), { y: 1.08 });
  }

  function addGlobalMapOutpostSiteMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.58, 0.12, 0.44), makeGlobalMapSiteMat(0x4b3a24, 0.04), { y: 0.11 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.035, 0.035, 0.72, 6), makeGlobalMapSiteMat(0x3b2a19, 0.02), { x: -0.24, y: 0.48, z: -0.16 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.035, 0.035, 0.72, 6), makeGlobalMapSiteMat(0x3b2a19, 0.02), { x: 0.24, y: 0.48, z: -0.16 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.54, 0.08, 0.22), makeGlobalMapSiteMat(0x725431, 0.08), { y: 0.82, z: -0.16 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.26, 0.18, 0.035), makeGlobalMapSiteMat(color, 0.22), { x: 0.36, y: 0.92, z: -0.16 });
  }

  function addGlobalMapProductionSiteMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.68, 0.32, 0.48), makeGlobalMapSiteMat(0x3b342a, 0.04), { y: 0.25 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.44, 0.28, 4), makeGlobalMapSiteMat(0x5b4a35, 0.08), { y: 0.55 }, { y: Math.PI / 4 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.07, 0.09, 0.74, 10), makeGlobalMapSiteMat(0x1f1f1b, 0.04), { x: 0.33, y: 0.78, z: 0.08 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.34, 0.06, 0.18), makeGlobalMapSiteMat(color, 0.18), { x: -0.18, y: 0.48, z: 0.27 });
  }

  function addGlobalMapLairSiteMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.48, 0.52, 5), makeGlobalMapSiteMat(0x4a4539, 0.04), { x: -0.08, y: 0.28 }, { y: Math.PI / 5 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.32, 0.42, 5), makeGlobalMapSiteMat(0x5b513d, 0.04), { x: 0.28, y: 0.22, z: -0.08 }, { y: -0.35 });
    const mouth = addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.26, 14, 8), makeGlobalMapSiteMat(0x0c0908, 0.02), { x: -0.02, y: 0.16, z: 0.2 });
    mouth.scale.set(1.15, 0.42, 0.72);
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.06, 0.34, 4), makeGlobalMapSiteMat(color, 0.16), { x: -0.38, y: 0.32, z: -0.16 }, { z: -0.3 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.05, 0.3, 4), makeGlobalMapSiteMat(color, 0.16), { x: 0.42, y: 0.28, z: 0.18 }, { z: 0.28 });
  }

  function addGlobalMapCaravanCampMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.24, 0.38, 4), makeGlobalMapSiteMat(0xc8b274, 0.08), { x: -0.28, y: 0.26, z: -0.08 }, { y: Math.PI / 4 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.22, 0.34, 4), makeGlobalMapSiteMat(0x9f8f62, 0.06), { x: 0.18, y: 0.24, z: 0.12 }, { y: -Math.PI / 4 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.42, 0.11, 0.24), makeGlobalMapSiteMat(0x6b5234, 0.04), { x: 0.34, y: 0.15, z: -0.2 }, { y: 0.22 });
    addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.08, 10, 8), makeGlobalMapSiteMat(0xff9d3b, 0.34), { x: -0.02, y: 0.14, z: -0.25 });
  }

  function addGlobalMapWreckedTruckMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.74, 0.16, 0.34), makeGlobalMapSiteMat(0x6d6658, 0.04), { y: 0.2 }, { y: -0.22 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.3, 0.22, 0.32), makeGlobalMapSiteMat(0x8b876f, 0.05), { x: -0.28, y: 0.34, z: 0.02 }, { y: -0.22 });
    [-0.28, 0.28].forEach(x => {
      addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.09, 0.09, 0.055, 14), makeGlobalMapSiteMat(0x11100d, 0.02), { x, y: 0.13, z: 0.22 }, { x: Math.PI / 2 });
      addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.08, 0.08, 0.055, 14), makeGlobalMapSiteMat(0x11100d, 0.02), { x, y: 0.13, z: -0.2 }, { x: Math.PI / 2 });
    });
  }

  function addGlobalMapScrapCacheMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.42, 0.18, 0.32), makeGlobalMapSiteMat(0x705b38, 0.06), { x: -0.18, y: 0.18 }, { y: 0.18 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.34, 0.14, 0.24), makeGlobalMapSiteMat(0x454d49, 0.06), { x: 0.18, y: 0.27, z: -0.05 }, { y: -0.28, z: 0.08 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.13, 0.13, 0.08, 12), makeGlobalMapSiteMat(0x171514, 0.02), { x: 0.36, y: 0.15, z: 0.18 }, { x: Math.PI / 2 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.08, 0.44, 4), makeGlobalMapSiteMat(color, 0.16), { x: -0.36, y: 0.34, z: -0.2 }, { z: -0.35 });
  }

  function addGlobalMapRaiderCacheMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.62, 0.16, 0.34), makeGlobalMapSiteMat(0x4a2118, 0.08), { y: 0.17 }, { y: 0.28 });
    [-0.34, -0.12, 0.14, 0.36].forEach((x, index) => {
      addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.055, 0.42, 4), makeGlobalMapSiteMat(0xc85a39, 0.16), { x, y: 0.42, z: index % 2 ? 0.24 : -0.22 }, { z: index % 2 ? 0.35 : -0.35 });
    });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.28, 0.22, 0.08), makeGlobalMapSiteMat(0x1c1411, 0.04), { x: 0.05, y: 0.36, z: 0.02 });
  }

  function addGlobalMapBeastTracksMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.025, 0.025, 0.56, 6), makeGlobalMapSiteMat(0xd8cda8, 0.06), { x: -0.1, y: 0.22, z: -0.06 }, { z: Math.PI / 2.8, y: 0.4 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.022, 0.022, 0.42, 6), makeGlobalMapSiteMat(0xd8cda8, 0.06), { x: 0.17, y: 0.18, z: 0.08 }, { z: -Math.PI / 2.5, y: -0.2 });
    [[-0.28, 0.2], [-0.08, 0.28], [0.18, 0.2], [0.34, 0.02]].forEach(([x, z], i) => {
      const paw = addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.08, 8, 6), makeGlobalMapSiteMat(i % 2 ? 0x45372a : 0x2f271f, 0.02), { x, y: 0.08, z });
      paw.scale.set(1.2, 0.22, 0.8);
    });
  }

  function addGlobalMapMutantMarksMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.045, 0.06, 0.82, 6), makeGlobalMapSiteMat(0x3b3328, 0.04), { y: 0.46 }, { z: 0.1 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.52, 0.07, 0.08), makeGlobalMapSiteMat(0x61412f, 0.08), { y: 0.72 }, { z: 0.22 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.12, 0.28, 4), makeGlobalMapSiteMat(color, 0.2), { y: 0.98 }, { y: Math.PI / 4 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.26, 0.08, 0.14), makeGlobalMapSiteMat(0x17120f, 0.04), { x: -0.24, y: 0.18, z: 0.22 }, { y: 0.35 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.22, 0.07, 0.13), makeGlobalMapSiteMat(0x17120f, 0.04), { x: 0.28, y: 0.16, z: -0.2 }, { y: -0.25 });
  }

  function addGlobalMapFieldClinicMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.28, 0.34, 4), makeGlobalMapSiteMat(0xd8d0b0, 0.08), { x: -0.14, y: 0.25 }, { y: Math.PI / 4 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.024, 0.024, 0.7, 8), makeGlobalMapSiteMat(0x3a2c1b, 0.02), { x: 0.34, y: 0.42, z: -0.12 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.28, 0.2, 0.035), makeGlobalMapSiteMat(0xf1e8c5, 0.08), { x: 0.34, y: 0.78, z: -0.12 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.18, 0.04, 0.045), makeGlobalMapSiteMat(0xc84632, 0.22), { x: 0.34, y: 0.78, z: -0.09 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.04, 0.16, 0.045), makeGlobalMapSiteMat(0xc84632, 0.22), { x: 0.34, y: 0.78, z: -0.085 });
  }

  function addGlobalMapWatchPostMarker(group, color) {
    addGlobalMapOutpostSiteMarker(group, color);
    addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.08, 10, 8), makeGlobalMapSiteMat(0xff9d3b, 0.32), { x: -0.38, y: 0.12, z: 0.3 });
  }

  function addGlobalMapBurnedFarmsteadMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.54, 0.08, 0.42), makeGlobalMapSiteMat(0x2b2018, 0.02), { y: 0.09 }, { y: -0.18 });
    [-0.24, 0.2].forEach((x, i) => addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.025, 0.035, 0.52, 6), makeGlobalMapSiteMat(0x1b1511, 0.02), { x, y: 0.35, z: i ? -0.14 : 0.16 }, { z: i ? -0.32 : 0.28 }));
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.11, 0.28, 5), makeGlobalMapSiteMat(0x5f5544, 0.04), { x: 0.34, y: 0.18, z: 0.22 });
    addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.07, 8, 6), makeGlobalMapSiteMat(0xff7b3e, 0.22, 0.7), { x: -0.34, y: 0.12, z: -0.18 });
  }

  function addGlobalMapSmugglerDropMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.48, 0.18, 0.34), makeGlobalMapSiteMat(0x6b573a, 0.06), { x: -0.12, y: 0.2 }, { y: 0.16 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.3, 0.14, 0.24), makeGlobalMapSiteMat(0x26313a, 0.08), { x: 0.26, y: 0.31, z: -0.08 }, { y: -0.36 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.72, 0.035, 0.44), makeGlobalMapSiteMat(0x1d251b, 0.04, 0.78), { y: 0.43, z: 0.02 }, { z: 0.04 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.018, 0.018, 0.8, 6), makeGlobalMapSiteMat(color, 0.12), { y: 0.18, z: 0.28 }, { z: Math.PI / 2 });
  }

  function addGlobalMapBunkerVentMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.34, 0.38, 0.12, 18), makeGlobalMapSiteMat(0x353a36, 0.04), { y: 0.1 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.18, 0.2, 0.32, 14), makeGlobalMapSiteMat(0x202522, 0.04), { y: 0.28 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.52, 0.035, 0.08), makeGlobalMapSiteMat(color, 0.18), { y: 0.48 }, { y: 0.3 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.5, 0.035, 0.08), makeGlobalMapSiteMat(color, 0.18), { y: 0.55 }, { y: -0.38 });
  }

  function addGlobalMapAntTunnelsMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    [[-0.2, -0.06, 0.23], [0.18, 0.1, 0.19], [0.0, 0.26, 0.16]].forEach(([x, z, r]) => {
      const mound = addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(r, 14, 8), makeGlobalMapSiteMat(0x9a7b4d, 0.06), { x, y: 0.12, z });
      mound.scale.set(1.2, 0.42, 1);
    });
    const hole = addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.14, 10, 6), makeGlobalMapSiteMat(0x100c08, 0.02), { x: -0.12, y: 0.13, z: 0.05 });
    hole.scale.set(1.15, 0.24, 0.8);
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.06, 0.32, 4), makeGlobalMapSiteMat(color, 0.16), { x: 0.36, y: 0.25, z: -0.18 }, { z: 0.4 });
  }

  function addGlobalMapRoadShrineMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.032, 0.04, 0.62, 6), makeGlobalMapSiteMat(0x4b3926, 0.04), { y: 0.34 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.38, 0.055, 0.055), makeGlobalMapSiteMat(0x6f5737, 0.06), { y: 0.55 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.5, 0.08, 0.2), makeGlobalMapSiteMat(0x2d251d, 0.04), { y: 0.08 }, { y: 0.18 });
    addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.055, 8, 6), makeGlobalMapSiteMat(color, 0.26), { x: 0.28, y: 0.13, z: -0.04 });
  }

  function addGlobalMapWaterPumpMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.26, 0.3, 0.36, 18), makeGlobalMapSiteMat(0x7db7c6, 0.16), { x: -0.18, y: 0.28 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.035, 0.035, 0.86, 8), makeGlobalMapSiteMat(0x354146, 0.04), { x: 0.22, y: 0.44 }, { z: Math.PI / 2 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.48, 0.08, 0.12), makeGlobalMapSiteMat(0x4d3724, 0.04), { x: 0.22, y: 0.7 }, { z: -0.26 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.05, 0.05, 0.52, 8), makeGlobalMapSiteMat(0x2a2520, 0.03), { x: 0.52, y: 0.27, z: 0.18 });
    addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.1, 10, 8), makeGlobalMapSiteMat(0x8edfff, 0.26, 0.82), { x: 0.46, y: 0.2, z: -0.2 });
  }

  function addGlobalMapFarmSiteMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.5, 0.06, 0.34), makeGlobalMapSiteMat(0x6f5a34, 0.04), { x: -0.18, y: 0.08, z: -0.12 }, { y: 0.18 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.44, 0.045, 0.26), makeGlobalMapSiteMat(0x496b32, 0.08), { x: -0.2, y: 0.14, z: -0.12 }, { y: 0.18 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.36, 0.045, 0.22), makeGlobalMapSiteMat(0x657b3d, 0.08), { x: 0.22, y: 0.13, z: 0.18 }, { y: -0.42 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.13, 0.15, 0.26, 14), makeGlobalMapSiteMat(0x8ecfe3, 0.18), { x: 0.36, y: 0.22, z: -0.22 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.22, 0.26, 4), makeGlobalMapSiteMat(0xd8c27a, 0.08), { x: 0.05, y: 0.28, z: 0.28 }, { y: Math.PI / 4 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.018, 0.018, 0.62, 6), makeGlobalMapSiteMat(color, 0.14), { x: -0.42, y: 0.32, z: 0.18 }, { z: -0.28 });
  }

  function addGlobalMapScrapFieldMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    [[-0.28, -0.18, 0.08], [0.08, 0.02, 0.16], [0.34, 0.18, 0.11]].forEach(([x, z, y], index) => {
      addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.38, 0.08, 0.22), makeGlobalMapSiteMat(index % 2 ? 0x6c7168 : 0x8e6f43, 0.06), { x, y: y + 0.08, z }, { y: index * 0.42, z: index ? 0.08 : -0.05 });
    });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.12, 0.12, 0.08, 14), makeGlobalMapSiteMat(0x141312, 0.02), { x: -0.44, y: 0.1, z: 0.2 }, { x: Math.PI / 2 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.018, 0.018, 0.72, 6), makeGlobalMapSiteMat(color, 0.12), { y: 0.28, z: -0.28 }, { z: Math.PI / 2.2 });
  }

  function addGlobalMapQuarryMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.5, 0.36, 4), makeGlobalMapSiteMat(0x73674f, 0.04), { x: -0.18, y: 0.22 }, { y: Math.PI / 4 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.36, 0.28, 4), makeGlobalMapSiteMat(0x9a8a65, 0.06), { x: 0.2, y: 0.16, z: -0.14 }, { y: -0.35 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.52, 0.06, 0.12), makeGlobalMapSiteMat(0x2d241a, 0.02), { y: 0.18, z: 0.28 }, { y: 0.25 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.022, 0.022, 0.58, 6), makeGlobalMapSiteMat(color, 0.12), { x: 0.38, y: 0.34, z: 0.08 }, { z: -0.42 });
  }

  function addGlobalMapSiliconRidgeMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.OctahedronBufferGeometry(0.2, 0), makeGlobalMapSiteMat(0xbdd2d4, 0.18), { x: -0.25, y: 0.22, z: 0.04 }, { y: 0.3 });
    addGlobalMapSiteMesh(group, new THREE.OctahedronBufferGeometry(0.16, 0), makeGlobalMapSiteMat(0x8bb6c4, 0.16), { x: 0.1, y: 0.18, z: -0.18 }, { y: -0.6 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.38, 0.22, 0.035), makeGlobalMapSiteMat(0x264f66, 0.2), { x: 0.34, y: 0.34, z: 0.14 }, { x: -0.22, y: 0.42 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.022, 0.022, 0.56, 8), makeGlobalMapSiteMat(0x2f3540, 0.06), { x: 0.34, y: 0.28, z: 0.14 });
  }

  function addGlobalMapTireDepotMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    [-0.24, 0.02, 0.28].forEach((x, stack) => {
      for (let i = 0; i < 3 - (stack === 1 ? 0 : 1); i += 1) {
        addGlobalMapSiteMesh(group, new THREE.TorusBufferGeometry(0.12, 0.035, 8, 18), makeGlobalMapSiteMat(0x171615, 0.02), { x, y: 0.09 + i * 0.075, z: stack % 2 ? -0.12 : 0.1 }, { x: Math.PI / 2 });
      }
    });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.68, 0.08, 0.2), makeGlobalMapSiteMat(0x6a5638, 0.04), { y: 0.11, z: -0.26 }, { y: 0.18 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.07, 0.34, 4), makeGlobalMapSiteMat(color, 0.16), { x: 0.43, y: 0.3, z: 0.22 }, { z: 0.36 });
  }

  function addGlobalMapChemSpringMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    const pool = addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.3, 18, 10), makeGlobalMapSiteMat(0x95d25c, 0.28, 0.78), { y: 0.11 });
    pool.scale.set(1.3, 0.22, 0.85);
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.18, 0.16, 0.32, 14), makeGlobalMapSiteMat(0x4b5a35, 0.08), { x: -0.34, y: 0.22, z: -0.06 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.16, 0.13, 0.26, 14), makeGlobalMapSiteMat(0x6c7044, 0.08), { x: 0.34, y: 0.18, z: 0.08 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.02, 0.02, 0.54, 6), makeGlobalMapSiteMat(color, 0.14), { y: 0.38, z: 0.3 }, { z: Math.PI / 2 });
  }

  function addGlobalMapAmmoWorksMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.64, 0.26, 0.42), makeGlobalMapSiteMat(0x4a3c29, 0.05), { y: 0.23 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.42, 0.24, 4), makeGlobalMapSiteMat(0x7b5f37, 0.08), { y: 0.48 }, { y: Math.PI / 4 });
    [-0.2, 0, 0.2].forEach(x => {
      addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.035, 0.035, 0.28, 10), makeGlobalMapSiteMat(0xc79b4a, 0.16), { x, y: 0.2, z: 0.32 });
    });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.18, 0.18, 0.04), makeGlobalMapSiteMat(color, 0.2), { x: 0.4, y: 0.46, z: -0.22 });
  }

  function addGlobalMapFoundryMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.22, 0.26, 0.5, 16), makeGlobalMapSiteMat(0x332b24, 0.04), { x: -0.08, y: 0.32 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.08, 0.1, 0.72, 10), makeGlobalMapSiteMat(0x171716, 0.04), { x: 0.3, y: 0.5, z: -0.06 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.58, 0.08, 0.18), makeGlobalMapSiteMat(0x3f3428, 0.04), { y: 0.15, z: 0.28 }, { y: -0.22 });
    addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.12, 10, 8), makeGlobalMapSiteMat(0xff7d36, 0.32, 0.78), { x: -0.3, y: 0.16, z: 0.2 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.28, 0.06, 0.08), makeGlobalMapSiteMat(color, 0.18), { x: 0.12, y: 0.62, z: 0.18 });
  }

  function addGlobalMapRelayWorkshopMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.58, 0.22, 0.4), makeGlobalMapSiteMat(0x334047, 0.06), { y: 0.22 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.026, 0.026, 1.0, 8), makeGlobalMapSiteMat(0x222a31, 0.08), { x: 0.28, y: 0.64, z: -0.1 });
    addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.075, 10, 8), makeGlobalMapSiteMat(color, 0.32), { x: 0.28, y: 1.16, z: -0.1 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.38, 0.2, 0.035), makeGlobalMapSiteMat(0x2d6272, 0.18), { x: -0.2, y: 0.52, z: 0.22 }, { x: -0.12, y: 0.28 });
  }

  function addGlobalMapSolarArrayMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    [[-0.24, -0.16], [0.24, -0.16], [-0.1, 0.22], [0.36, 0.18]].forEach(([x, z], index) => {
      addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.018, 0.018, 0.34, 6), makeGlobalMapSiteMat(0x343b3e, 0.04), { x, y: 0.22, z });
      addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.34, 0.18, 0.035), makeGlobalMapSiteMat(index % 2 ? 0x2f6f85 : 0x245a74, 0.2), { x, y: 0.42, z }, { x: -0.32, y: index * 0.18 });
    });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.26, 0.18, 0.2), makeGlobalMapSiteMat(0x3b3d34, 0.04), { x: -0.42, y: 0.16, z: 0.26 }, { y: -0.25 });
    addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.07, 10, 8), makeGlobalMapSiteMat(color, 0.3), { x: -0.42, y: 0.32, z: 0.26 });
  }

  function addGlobalMapMilitaryDepotMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.68, 0.26, 0.46), makeGlobalMapSiteMat(0x4f5142, 0.04), { y: 0.22 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.5, 0.22, 4), makeGlobalMapSiteMat(0x6a654c, 0.06), { y: 0.46 }, { y: Math.PI / 4 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.22, 0.16, 0.18), makeGlobalMapSiteMat(0x2a2b22, 0.03), { x: -0.32, y: 0.18, z: 0.28 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.28, 0.12, 0.2), makeGlobalMapSiteMat(0x5a3a28, 0.08), { x: 0.32, y: 0.14, z: -0.26 });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.024, 0.024, 0.5, 6), makeGlobalMapSiteMat(color, 0.16), { x: 0.44, y: 0.45, z: 0.18 }, { z: -0.3 });
  }

  function addGlobalMapMutantCraterMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    const pit = addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.34, 16, 8), makeGlobalMapSiteMat(0x1c1612, 0.02), { y: 0.08 });
    pit.scale.set(1.2, 0.22, 0.95);
    [[-0.34, 0.08], [0.28, -0.14], [0.04, 0.32]].forEach(([x, z], i) => {
      addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.14 + i * 0.02, 0.34, 5), makeGlobalMapSiteMat(0x6a5f48, 0.04), { x, y: 0.2, z }, { y: i * 0.45 });
    });
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.04, 0.055, 0.76, 6), makeGlobalMapSiteMat(color, 0.18), { x: 0.38, y: 0.42, z: 0.18 }, { z: 0.28 });
  }

  function addGlobalMapRadscorpionNestMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    [[-0.24, -0.08, 0.2], [0.18, 0.12, 0.18], [0.02, 0.3, 0.15]].forEach(([x, z, r]) => {
      const mound = addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(r, 12, 8), makeGlobalMapSiteMat(0xa88255, 0.05), { x, y: 0.1, z });
      mound.scale.set(1.15, 0.36, 0.9);
    });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.08, 0.42, 5), makeGlobalMapSiteMat(0xd0c6a2, 0.08), { x: 0.34, y: 0.26, z: -0.18 }, { z: -0.48 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.06, 0.32, 5), makeGlobalMapSiteMat(color, 0.16), { x: -0.38, y: 0.24, z: 0.18 }, { z: 0.36 });
  }

  function addGlobalMapGeckoCanyonMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.42, 0.48, 4), makeGlobalMapSiteMat(0x8c7350, 0.04), { x: -0.28, y: 0.3, z: -0.08 }, { y: Math.PI / 4 });
    addGlobalMapSiteMesh(group, new THREE.ConeBufferGeometry(0.36, 0.44, 4), makeGlobalMapSiteMat(0x9f8055, 0.04), { x: 0.28, y: 0.28, z: 0.08 }, { y: -Math.PI / 5 });
    addGlobalMapSiteMesh(group, new THREE.BoxBufferGeometry(0.54, 0.045, 0.12), makeGlobalMapSiteMat(0xd8c493, 0.08), { y: 0.12, z: 0.28 }, { y: -0.2 });
    addGlobalMapSiteMesh(group, new THREE.SphereBufferGeometry(0.07, 8, 6), makeGlobalMapSiteMat(color, 0.24, 0.78), { x: 0.0, y: 0.18, z: -0.2 });
  }

  function addGlobalMapDefaultWorldSiteMarker(group, color) {
    addGlobalMapWorldSiteRing(group, color);
    addGlobalMapSiteMesh(group, new THREE.CylinderBufferGeometry(0.08, 0.11, 0.42, 10), makeGlobalMapSiteMat(color, 0.12), { y: 0.28 });
    addGlobalMapSiteMesh(group, new THREE.OctahedronBufferGeometry(0.18, 0), makeGlobalMapSiteMat(color, 0.22), { y: 0.62 });
  }

  function globalMapWorldSiteModelKey(site = {}) {
    const activity = String(site?.activityKind || '').toLowerCase();
    if (activity) return activity;
    const identity = `${site?.id || ''} ${site?.locationId || ''}`.toLowerCase();
    if (identity.includes('drywaterpump')) return 'dry_water_pump';
    if (identity.includes('oldklimfarm') || identity.includes('resourceoldklimfarm')) return 'old_klim_farm';
    if (identity.includes('scrapfields')) return 'scrap_fields';
    if (identity.includes('ironmine')) return 'iron_mine';
    if (identity.includes('klimquarry')) return 'klim_quarry';
    if (identity.includes('chemspring')) return 'chem_spring';
    if (identity.includes('siliconridge')) return 'silicon_ridge';
    if (identity.includes('tiredepot')) return 'tire_depot';
    if (identity.includes('mutantcrater')) return 'mutant_crater';
    if (identity.includes('radscorpionnest')) return 'radscorpion_nest';
    if (identity.includes('geckocanyon')) return 'gecko_canyon';
    if (identity.includes('anthive')) return 'ant_hive';
    if (identity.includes('roadoutpost')) return 'road_outpost';
    if (identity.includes('scrapoutpost')) return 'scrap_outpost';
    if (identity.includes('relayoutpost')) return 'relay_outpost';
    if (identity.includes('klimammoworks')) return 'ammo_works';
    if (identity.includes('scrapfoundry')) return 'scrap_foundry';
    if (identity.includes('relayworkshop')) return 'relay_workshop';
    if (identity.includes('solararray')) return 'solar_array';
    if (identity.includes('olddepot')) return 'military_depot';
    const type = String(site?.type || '').toLowerCase();
    if (type === 'outpost' || type === 'production' || type === 'lair') return type;
    return String(globalMapWorldSitePrimaryResource(site) || 'point').toLowerCase();
  }

  function buildGlobalMapWorldSiteMarker(site = {}, color = 0x80c8ff) {
    const group = new THREE.Group();
    const modelKey = globalMapWorldSiteModelKey(site);
    if (modelKey === 'caravan_camp') addGlobalMapCaravanCampMarker(group, color);
    else if (modelKey === 'wrecked_truck') addGlobalMapWreckedTruckMarker(group, color);
    else if (modelKey === 'scrap_cache') addGlobalMapScrapCacheMarker(group, color);
    else if (modelKey === 'tech_wreck' || modelKey === 'relay_beacon') addGlobalMapElectronicsSiteMarker(group, color);
    else if (modelKey === 'water_pocket' || modelKey === 'water') addGlobalMapWaterSiteMarker(group, color);
    else if (modelKey === 'ore_scars' || modelKey === 'prospector_claim' || modelKey === 'ore') addGlobalMapOreSiteMarker(group, color);
    else if (modelKey === 'raider_pickup') addGlobalMapRaiderCacheMarker(group, color);
    else if (modelKey === 'beast_tracks' || modelKey === 'ghoul_ruins') addGlobalMapBeastTracksMarker(group, color);
    else if (modelKey === 'mutant_marks') addGlobalMapMutantMarksMarker(group, color);
    else if (modelKey === 'old_klim_watch') addGlobalMapWatchPostMarker(group, color);
    else if (modelKey === 'field_clinic') addGlobalMapFieldClinicMarker(group, color);
    else if (modelKey === 'burned_farmstead') addGlobalMapBurnedFarmsteadMarker(group, color);
    else if (modelKey === 'smuggler_drop') addGlobalMapSmugglerDropMarker(group, color);
    else if (modelKey === 'old_bunker_vent') addGlobalMapBunkerVentMarker(group, color);
    else if (modelKey === 'ant_tunnels') addGlobalMapAntTunnelsMarker(group, color);
    else if (modelKey === 'road_shrine') addGlobalMapRoadShrineMarker(group, color);
    else if (modelKey === 'dry_water_pump') addGlobalMapWaterPumpMarker(group, color);
    else if (modelKey === 'old_klim_farm') addGlobalMapFarmSiteMarker(group, color);
    else if (modelKey === 'scrap_fields') addGlobalMapScrapFieldMarker(group, color);
    else if (modelKey === 'iron_mine' || modelKey === 'klim_quarry') addGlobalMapQuarryMarker(group, color);
    else if (modelKey === 'chem_spring') addGlobalMapChemSpringMarker(group, color);
    else if (modelKey === 'silicon_ridge') addGlobalMapSiliconRidgeMarker(group, color);
    else if (modelKey === 'tire_depot') addGlobalMapTireDepotMarker(group, color);
    else if (modelKey === 'mutant_crater') addGlobalMapMutantCraterMarker(group, color);
    else if (modelKey === 'radscorpion_nest') addGlobalMapRadscorpionNestMarker(group, color);
    else if (modelKey === 'gecko_canyon') addGlobalMapGeckoCanyonMarker(group, color);
    else if (modelKey === 'ant_hive') addGlobalMapAntTunnelsMarker(group, color);
    else if (modelKey === 'road_outpost') addGlobalMapWatchPostMarker(group, color);
    else if (modelKey === 'scrap_outpost') addGlobalMapScrapCacheMarker(group, color);
    else if (modelKey === 'relay_outpost') addGlobalMapElectronicsSiteMarker(group, color);
    else if (modelKey === 'ammo_works') addGlobalMapAmmoWorksMarker(group, color);
    else if (modelKey === 'scrap_foundry') addGlobalMapFoundryMarker(group, color);
    else if (modelKey === 'relay_workshop') addGlobalMapRelayWorkshopMarker(group, color);
    else if (modelKey === 'solar_array') addGlobalMapSolarArrayMarker(group, color);
    else if (modelKey === 'military_depot') addGlobalMapMilitaryDepotMarker(group, color);
    else if (modelKey === 'chemicals') addGlobalMapChemicalSiteMarker(group, color);
    else if (modelKey === 'electronics') addGlobalMapElectronicsSiteMarker(group, color);
    else if (modelKey === 'oil') addGlobalMapOilSiteMarker(group, color);
    else if (modelKey === 'scrap' || modelKey === 'ammoparts') addGlobalMapScrapSiteMarker(group, color);
    else if (modelKey === 'outpost') addGlobalMapOutpostSiteMarker(group, color);
    else if (modelKey === 'production') addGlobalMapProductionSiteMarker(group, color);
    else if (modelKey === 'lair') addGlobalMapLairSiteMarker(group, color);
    else addGlobalMapDefaultWorldSiteMarker(group, color);
    return group;
  }

  function globalMapWorldSites3DSignature(sites = []) {
    return sites.map(site => [
      site?.id || '',
      Math.round(Number(site?.x || 0) * 10) / 10,
      Math.round(Number(site?.y || 0) * 10) / 10,
      globalMapWorldSiteModelKey(site),
      globalMapWorldSiteColor(site),
      site?.productionNeedSummary || '',
      site?.controlState || '',
      site?.marketState || '',
      globalMapWorldSiteHotspot(site)?.label || '',
      globalMapPointCoveredByWorldContact(site) ? 'covered' : ''
    ].join(':')).join('|');
  }

  function globalMapSettlementStatus3DSignature(sites = []) {
    return sites.map(site => [
      site?.id || '',
      site?.owner || '',
      site?.ownerLabel || '',
      site?.controlState || '',
      site?.marketState || '',
      Math.round(Number(site?.controlPressure || 0)),
      site?.controlThreatName || '',
      globalMapWorldSiteHotspot(site)?.label || '',
      globalMapPointCoveredByWorldContact(site) ? 'covered' : ''
    ].join(':')).join('|');
  }

  function buildGlobalMapSettlementStatusMarker(site = {}) {
    const group = new THREE.Group();
    const node = GLOBAL_MAP_NODES.find(row => row && row.id === site.id);
    const radius = (node ? globalMapSettlementRadius(node) : GLOBAL_SETTLEMENT_RADIUS) / GLOBAL_MAP_SIZE.width * GLOBAL_MAP_3D.worldWidth;
    const statusColorText = globalMapWorldSiteColor(site);
    const statusColor = parseInt(String(statusColorText).replace('#', ''), 16) || 0x93d982;
    const alert = globalMapPointCoveredByWorldContact(site) ? null : globalMapWorldSiteHotspot(site);
    const ringColor = alert && alert.level !== 'good'
      ? (parseInt(String(alert.color || '').replace('#', ''), 16) || statusColor)
      : statusColor;

    const statusRing = new THREE.Mesh(
      new THREE.TorusBufferGeometry(Math.max(0.78, radius * 0.92), 0.028, 8, 64),
      new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: alert && alert.level === 'critical' ? 0.62 : 0.46, depthTest: false })
    );
    statusRing.rotation.x = Math.PI / 2;
    statusRing.position.y = 0.1;
    group.add(statusRing);
    group.userData.statusRing = statusRing;

    const pole = new THREE.Mesh(
      new THREE.CylinderBufferGeometry(0.025, 0.025, 1.05, 8),
      new THREE.MeshBasicMaterial({ color: 0x20170c })
    );
    pole.position.set(radius * 0.55, 1.1, -radius * 0.35);
    const flag = new THREE.Mesh(
      new THREE.BoxBufferGeometry(0.48, 0.22, 0.035),
      new THREE.MeshLambertMaterial({ color: ringColor, emissive: ringColor, emissiveIntensity: 0.18 })
    );
    flag.position.set(radius * 0.55 + 0.22, 1.38, -radius * 0.35);
    group.add(pole, flag);

    return group;
  }

  function globalMapFactionInfluenceRadius(site = {}) {
    const type = String(site.type || '').toLowerCase();
    const security = Math.max(0, Math.min(100, Number(site.security || 0)));
    const prosperity = Math.max(0, Math.min(100, Number(site.prosperity || 0)));
    const pressure = Math.min(30, Math.abs(Number(site.controlPressure || 0)));
    let radius = 28;
    if (type === 'settlement') radius = 48;
    else if (type === 'outpost') radius = 38;
    else if (type === 'production') radius = 35;
    else if (type === 'resource') radius = 31;
    else if (type === 'pointofinterest') radius = 27;
    radius += security * 0.08 + prosperity * 0.05;
    radius -= pressure * 0.22;
    if (String(site.owner || '').toLowerCase() === 'neutral') radius *= 0.72;
    if (site.controlState === 'secured') radius *= 1.12;
    if (site.controlState === 'critical') radius *= 0.86;
    return Math.max(18, Math.min(58, radius));
  }

  function globalMapFactionTerritoryRows() {
    const normalizeRow = (row = {}) => {
      const borders = String(row.borders || '')
        .split('')
        .filter(side => !globalMapFactionTerritoryBorderIsWater(row, side))
        .join('');
      return { ...row, borders };
    };
    return (Array.isArray(WASTELAND_SIM_STATE.territories) ? WASTELAND_SIM_STATE.territories : [])
      .filter(row => row && row.owner && row.owner !== 'neutral')
      .filter(row => !globalMapFactionTerritoryCellIsWater(row))
      .map(normalizeRow)
      .slice(0, GLOBAL_MAP_GRID.cols * GLOBAL_MAP_GRID.rows);
  }

  function globalMapFactionTerritoryPoint(row = {}, localX = 0.5, localY = 0.5) {
    return {
      x: (Number(row.cx || 0) + Math.max(0, Math.min(1, Number(localX || 0)))) * GLOBAL_MAP_GRID.cellPoints,
      y: (Number(row.cy || 0) + Math.max(0, Math.min(1, Number(localY || 0)))) * GLOBAL_MAP_GRID.cellPoints
    };
  }

  function globalMapFactionTerritoryPointIsWater(point = {}) {
    return typeof globalMapPointIsWater === 'function' && globalMapPointIsWater(point.x, point.y);
  }

  function globalMapFactionTerritoryCellIsWater(row = {}) {
    return globalMapFactionTerritoryPointIsWater(globalMapFactionTerritoryPoint(row, 0.5, 0.5));
  }

  function globalMapFactionTerritoryBorderIsWater(row = {}, side = '') {
    const s = String(side || '').toUpperCase();
    const samples = s === 'N'
      ? [[0.18, 0], [0.5, 0], [0.82, 0]]
      : s === 'E'
      ? [[1, 0.18], [1, 0.5], [1, 0.82]]
      : s === 'S'
      ? [[0.18, 1], [0.5, 1], [0.82, 1]]
      : s === 'W'
      ? [[0, 0.18], [0, 0.5], [0, 0.82]]
      : [];
    return samples.some(([x, y]) => globalMapFactionTerritoryPointIsWater(globalMapFactionTerritoryPoint(row, x, y)));
  }

  function globalMapFactionTerritory3DSignature(rows = []) {
    return rows.map(row => [
      row.cx,
      row.cy,
      row.owner,
      row.color || '',
      row.borders || '',
      Math.round(Number(row.strength || 0) * 100)
    ].join(':')).join('|');
  }

  function globalMap3DTerritoryZoomFactor() {
    const min = Number(GLOBAL_MAP_3D.minZoom || 30);
    const max = Number(GLOBAL_MAP_3D.maxZoom || 150);
    const zoom = Number(GLOBAL_MAP_3D.zoom || 90);
    if (max <= min) return 0.5;
    return Math.max(0, Math.min(1, (zoom - min) / (max - min)));
  }

  function makeGlobalMapTerritoryBorderBand(color, width, depth, position, role = 'core') {
    const PlaneGeometry = THREE.PlaneBufferGeometry || THREE.PlaneGeometry;
    const baseOpacity = role === 'glow' ? 0.18 : 0.54;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: baseOpacity,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(new PlaneGeometry(width, depth), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(position.x, position.y, position.z);
    mesh.renderOrder = role === 'glow' ? 24 : 25;
    mesh.userData.territoryBorderBand = true;
    mesh.userData.territoryBorderRole = role;
    mesh.userData.baseOpacity = baseOpacity;
    mesh.userData.axis = position.axis || 'z';
    return mesh;
  }

  function updateGlobalMapFactionTerritoryZoomVisuals(group = null) {
    if (!group) return;
    const t = globalMap3DTerritoryZoomFactor();
    const fillOpacityBoost = 1 + t * 0.55;
    const lineOpacityBoost = 1 + t * 0.32;
    const coreScale = 0.72 + t * 1.45;
    const glowScale = 0.82 + t * 2.35;
    group.traverse?.(node => {
      const mat = node?.material;
      if (!mat) return;
      if (node.userData?.territoryFill) {
        mat.opacity = Math.max(0.06, Math.min(0.24, Number(node.userData.baseOpacity || 0.12) * fillOpacityBoost));
        return;
      }
      if (node.userData?.territoryBorderLine) {
        mat.opacity = Math.max(0.72, Math.min(1, Number(node.userData.baseOpacity || 0.82) * lineOpacityBoost));
        if (Number.isFinite(Number(mat.linewidth))) mat.linewidth = 1 + t * 3;
        return;
      }
      if (node.userData?.territoryBorderBand) {
        const role = node.userData.territoryBorderRole || 'core';
        const mult = role === 'glow' ? glowScale : coreScale;
        if (node.userData.axis === 'x') node.scale.x = mult;
        else node.scale.y = mult;
        const opacity = role === 'glow'
          ? 0.08 + t * 0.26
          : 0.38 + t * 0.42;
        mat.opacity = Math.max(0.05, Math.min(role === 'glow' ? 0.38 : 0.9, opacity));
      }
    });
  }

  function buildGlobalMapFactionTerritoryCell(row = {}) {
    const cellWorldW = GLOBAL_MAP_GRID.cellPoints / GLOBAL_MAP_SIZE.width * GLOBAL_MAP_3D.worldWidth;
    const cellWorldD = GLOBAL_MAP_GRID.cellPoints / GLOBAL_MAP_SIZE.height * GLOBAL_MAP_3D.worldDepth;
    const colorText = row.color || globalMapFactionColor(row.owner || '') || '#9fd7ff';
    const color = parseInt(String(colorText).replace('#', ''), 16) || 0x9fd7ff;
    const strength = Math.max(0.1, Math.min(1, Number(row.strength || 0.3)));
    const group = new THREE.Group();
    const PlaneGeometry = THREE.PlaneBufferGeometry || THREE.PlaneGeometry;
    const fill = new THREE.Mesh(
      new PlaneGeometry(cellWorldW * 0.98, cellWorldD * 0.98),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.055 + strength * 0.105,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide
      })
    );
    fill.rotation.x = Math.PI / 2;
    fill.userData.territoryFill = true;
    fill.userData.baseOpacity = fill.material.opacity;
    fill.renderOrder = 20;
    group.add(fill);

    const borders = String(row.borders || '');
    if (borders) {
      const halfW = cellWorldW * 0.5;
      const halfD = cellWorldD * 0.5;
      const y = 0.04;
      const points = [];
      const coreThickness = Math.max(0.075, Math.min(cellWorldW, cellWorldD) * 0.045);
      const glowThickness = Math.max(0.22, Math.min(cellWorldW, cellWorldD) * 0.14);
      const addEdge = (a, b) => {
        points.push(new THREE.Vector3(a[0], y, a[1]), new THREE.Vector3(b[0], y, b[1]));
        const horizontal = Math.abs(a[1] - b[1]) < 0.001;
        const cx = (a[0] + b[0]) * 0.5;
        const cz = (a[1] + b[1]) * 0.5;
        if (horizontal) {
          group.add(
            makeGlobalMapTerritoryBorderBand(color, cellWorldW, glowThickness, { x: cx, y: y + 0.004, z: cz, axis: 'z' }, 'glow'),
            makeGlobalMapTerritoryBorderBand(color, cellWorldW, coreThickness, { x: cx, y: y + 0.008, z: cz, axis: 'z' }, 'core')
          );
        } else {
          group.add(
            makeGlobalMapTerritoryBorderBand(color, glowThickness, cellWorldD, { x: cx, y: y + 0.004, z: cz, axis: 'x' }, 'glow'),
            makeGlobalMapTerritoryBorderBand(color, coreThickness, cellWorldD, { x: cx, y: y + 0.008, z: cz, axis: 'x' }, 'core')
          );
        }
      };
      if (borders.includes('N')) addEdge([-halfW, -halfD], [halfW, -halfD]);
      if (borders.includes('E')) addEdge([halfW, -halfD], [halfW, halfD]);
      if (borders.includes('S')) addEdge([-halfW, halfD], [halfW, halfD]);
      if (borders.includes('W')) addEdge([-halfW, -halfD], [-halfW, halfD]);
      const border = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.82,
          depthWrite: false,
          depthTest: false
        })
      );
      border.renderOrder = 26;
      border.userData.territoryBorderLine = true;
      border.userData.baseOpacity = border.material.opacity;
      group.add(border);
    }
    updateGlobalMapFactionTerritoryZoomVisuals(group);
    return group;
  }

  function globalMapFactionInfluenceRows(limit = 32) {
    return (Array.isArray(WASTELAND_SIM_STATE.sites) ? WASTELAND_SIM_STATE.sites : [])
      .filter(site => site && site.owner)
      .map(site => {
        const owner = String(site.owner || 'neutral').toLowerCase();
        const color = globalMapFactionColor(owner) || '#9fd7ff';
        const critical = site.controlState === 'critical' || !!site.activeConflict;
        const contested = ['contested', 'threatened'].includes(String(site.controlState || ''));
        return {
          id: site.id || `${site.x}:${site.y}`,
          x: Number(site.x || 0),
          y: Number(site.y || 0),
          owner,
          ownerLabel: site.ownerLabel || globalMapFactionLabel(owner),
          type: String(site.type || ''),
          color,
          radius: globalMapFactionInfluenceRadius(site),
          opacity: owner === 'neutral' ? 0.095 : critical ? 0.18 : contested ? 0.16 : 0.12,
          state: site.controlState || 'stable',
          pressure: Number(site.controlPressure || 0)
        };
      })
      .slice(0, limit);
  }

  function globalMapFactionInfluence3DSignature(rows = []) {
    return rows.map(row => [
      row.id,
      row.owner,
      row.color,
      Math.round(Number(row.x || 0) * 10) / 10,
      Math.round(Number(row.y || 0) * 10) / 10,
      Math.round(Number(row.radius || 0)),
      Math.round(Number(row.opacity || 0) * 100),
      row.state,
      Math.round(Number(row.pressure || 0))
    ].join(':')).join('|');
  }

  function updateGlobalMapFactionInfluenceZoomVisuals(group = null) {
    if (!group) return;
    const t = globalMap3DTerritoryZoomFactor();
    group.traverse?.(node => {
      const mat = node?.material;
      if (!mat) return;
      if (node.userData?.influenceFill) {
        mat.opacity = Math.max(0.06, Math.min(0.28, Number(node.userData.baseOpacity || 0.12) * (1 + t * 0.75)));
        return;
      }
      if (node.userData?.influenceRing) {
        const critical = node.userData.influenceCritical === true;
        mat.opacity = Math.max(0.28, Math.min(0.86, Number(node.userData.baseOpacity || (critical ? 0.48 : 0.28)) + t * (critical ? 0.24 : 0.36)));
        return;
      }
      if (node.userData?.influenceGlowRing) {
        mat.opacity = Math.max(0.08, Math.min(0.44, 0.08 + t * 0.34));
      }
    });
  }

  function buildGlobalMapFactionInfluenceZone(row = {}) {
    const group = new THREE.Group();
    const radius = Math.max(0.6, Number(row.radius || 24) / GLOBAL_MAP_SIZE.width * GLOBAL_MAP_3D.worldWidth);
    const color = parseInt(String(row.color || '#9fd7ff').replace('#', ''), 16) || 0x9fd7ff;
    const CircleGeometry = THREE.CircleBufferGeometry || THREE.CircleGeometry;
    const fill = new THREE.Mesh(
      new CircleGeometry(radius, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: Math.max(0.05, Math.min(0.22, Number(row.opacity || 0.12))),
        depthTest: false,
        side: THREE.DoubleSide
      })
    );
    fill.rotation.x = Math.PI / 2;
    fill.userData.influenceFill = true;
    fill.userData.baseOpacity = fill.material.opacity;
    fill.renderOrder = 18;
    const glowRing = new THREE.Mesh(
      new THREE.TorusBufferGeometry(radius, Math.max(0.025, radius * 0.034), 8, 72),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.12,
        depthTest: false
      })
    );
    glowRing.rotation.x = Math.PI / 2;
    glowRing.renderOrder = 21;
    glowRing.userData.influenceGlowRing = true;
    const ring = new THREE.Mesh(
      new THREE.TorusBufferGeometry(radius, Math.max(0.012, radius * 0.015), 8, 72),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: row.state === 'critical' ? 0.48 : 0.28,
        depthTest: false
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.renderOrder = 22;
    ring.userData.influenceRing = true;
    ring.userData.influenceCritical = row.state === 'critical';
    ring.userData.baseOpacity = ring.material.opacity;
    group.add(fill, glowRing, ring);
    group.userData.zoneRing = ring;
    group.userData.zoneGlowRing = glowRing;
    updateGlobalMapFactionInfluenceZoomVisuals(group);
    return group;
  }

  function globalMapFactionGroupKey(faction = '') {
    const key = String(faction || '').toLowerCase();
    if (key === 'old_klim' || key === 'klim_patrol') return 'old_klim';
    if (key === 'caravan' || key === 'caravans') return 'caravans';
    if (key === 'scrap' || key === 'scrap_town' || key === 'scrap_union') return 'scrap_union';
    if (key === 'relay' || key === 'relay_station' || key === 'relay_order') return 'relay_order';
    if (['ghouls', 'radscorpions', 'mutant_ants', 'geckos', 'wild'].includes(key)) return 'wild';
    return key || 'neutral';
  }

  function globalMapFactionsLookHostile(left = '', right = '') {
    const a = globalMapFactionGroupKey(left);
    const b = globalMapFactionGroupKey(right);
    if (!a || !b || a === b) return false;
    if (a === 'neutral' || b === 'neutral') return ['raiders', 'mutants', 'wild'].includes(a === 'neutral' ? b : a);
    const civil = ['old_klim', 'caravans', 'scrap_union', 'relay_order'];
    if (civil.includes(a) && civil.includes(b)) return false;
    return ['raiders', 'mutants', 'wild'].includes(a) || ['raiders', 'mutants', 'wild'].includes(b);
  }

  function globalMapPlayerFactionKey() {
    const raw = typeof playerWorldFactionId === 'function'
      ? playerWorldFactionId()
      : (characterProfile?.worldFactionId || characterProfile?.factionId || '');
    if (typeof worldFactionKey === 'function') return worldFactionKey(raw);
    return globalMapFactionGroupKey(raw);
  }

  function globalMapWorldContactIsForced(contact = {}) {
    if (!contact || contact.hidden || contact.visible === false) return false;
    if (contact.details?.forcedEncounter || contact.details?.simBattle) {
      const activeFaction = globalMapFactionGroupKey(contact.targetFaction || contact.faction || contact.details?.conflict?.primaryFaction || '');
      if (['raiders', 'mutants', 'wild'].includes(activeFaction)) return true;
    }
    const kind = String(contact.kind || '').toLowerCase();
    const activeFaction = globalMapFactionGroupKey(contact.targetFaction || contact.faction || contact.details?.conflict?.primaryFaction || '');
    if (kind === 'lair' || ['raiders', 'mutants', 'wild'].includes(activeFaction)) return true;
    const playerFaction = globalMapPlayerFactionKey();
    const civil = ['old_klim', 'caravans', 'scrap_union', 'relay_order'];
    if (playerFaction && civil.includes(playerFaction) && civil.includes(activeFaction) && playerFaction !== activeFaction) return true;
    return false;
  }

  function globalMapNearestThreatPartyForSite(site = {}, preferredFaction = '') {
    const sitePoint = clampGlobalMapPoint(site.x, site.y);
    const preferred = globalMapFactionGroupKey(preferredFaction);
    let best = null;
    let bestDist = Infinity;
    (Array.isArray(WASTELAND_SIM_STATE.parties) ? WASTELAND_SIM_STATE.parties : [])
      .filter(row => globalMapWorldPartyVisibleOnMap(row))
      .forEach(row => {
        const rowFaction = globalMapFactionGroupKey(row.faction || '');
        if (preferred && preferred !== 'neutral' && rowFaction !== preferred) return;
        if ((!preferred || preferred === 'neutral') && !globalMapFactionsLookHostile(rowFaction, site.owner || 'neutral')) return;
        const dist = globalMapPointDistance(sitePoint, row);
        if (dist < bestDist) {
          best = row;
          bestDist = dist;
        }
      });
    return best && bestDist <= 120 ? { party: best, distance: bestDist } : null;
  }

  function globalMapFactionFrontRows(limit = 18) {
    const activeTasks = globalMapActiveWorldTasks(80);
    const rows = [];
    (Array.isArray(WASTELAND_SIM_STATE.sites) ? WASTELAND_SIM_STATE.sites : []).forEach(site => {
      if (!site || !site.id) return;
      const targetTasks = activeTasks.filter(task => String(task.siteId || '') === String(site.id || ''));
      const pressure = Number(site.controlPressure || 0);
      const raidActive = !!site.activeConflict;
      if (raidActive && globalMapPointCoveredByWorldContact(site, 16)) return;
      const state = String(site.controlState || 'stable');
      const conflictTask = targetTasks.find(task => ['retake_site', 'defend_resource'].includes(String(task.type || '')));
      const needsFront = raidActive || conflictTask || ['critical', 'contested', 'threatened'].includes(state) || Math.abs(pressure) > 4;
      if (!needsFront) return;

      const threatFaction = site.controlThreatFaction || site.lastRaidFaction || conflictTask?.targetFaction || '';
      const nearestThreat = globalMapNearestThreatPartyForSite(site, threatFaction);
      let source = nearestThreat ? clampGlobalMapPoint(nearestThreat.party.x, nearestThreat.party.y) : null;
      if ((!source || globalMapPointDistance(source, site) < 1) && conflictTask?.issuerSiteId && conflictTask.issuerSiteId !== site.id) {
        source = globalMapTaskSitePoint(conflictTask, true);
      }
      const meta = conflictTask ? globalMapWorldTaskTypeMeta(conflictTask) : null;
      const color = raidActive ? '#ff7254' : (meta?.color || (state === 'critical' ? '#ff7254' : '#ffcf5f'));
      const label = raidActive
        ? 'Налет'
        : conflictTask?.type === 'retake_site'
          ? 'Фронт'
          : conflictTask?.type === 'defend_resource'
            ? 'Оборона'
            : state === 'critical'
              ? 'Кризис'
              : 'Давление';
      const severity = (raidActive ? 5 : 0)
        + (state === 'critical' ? 4 : state === 'contested' ? 3 : state === 'threatened' ? 2 : 0)
        + Math.min(4, Math.abs(pressure) / 3)
        + (conflictTask ? Number(conflictTask.priority || 0) : 0);
      rows.push({
        id: `${site.id}:${conflictTask?.id || state}:${Math.round(pressure)}`,
        siteId: site.id,
        x: Number(site.x || 0),
        y: Number(site.y || 0),
        sourceX: source ? Number(source.x || 0) : null,
        sourceY: source ? Number(source.y || 0) : null,
        owner: site.owner || 'neutral',
        threatFaction,
        color,
        label,
        severity,
        state,
        taskCount: targetTasks.length
      });
    });
    return rows
      .sort((a, b) => Number(b.severity || 0) - Number(a.severity || 0))
      .slice(0, limit);
  }

  function globalMapFactionFronts3DSignature(rows = []) {
    return rows.map(row => [
      row.id,
      row.siteId,
      row.color,
      row.label,
      Math.round(Number(row.x || 0) * 10) / 10,
      Math.round(Number(row.y || 0) * 10) / 10,
      row.sourceX == null ? '' : Math.round(Number(row.sourceX || 0) * 10) / 10,
      row.sourceY == null ? '' : Math.round(Number(row.sourceY || 0) * 10) / 10,
      Math.round(Number(row.severity || 0)),
      row.taskCount || 0
    ].join(':')).join('|');
  }

