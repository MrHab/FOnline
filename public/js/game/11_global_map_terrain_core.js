  function invalidateGlobalMap3D() {
    GLOBAL_MAP_3D.revision += 1;
  }

  function globalMapWorldFromPoint(point = {}) {
    const p = clampGlobalMapPoint(point.x, point.y);
    return {
      x: (p.x / GLOBAL_MAP_SIZE.width - 0.5) * GLOBAL_MAP_3D.worldWidth,
      z: (p.y / GLOBAL_MAP_SIZE.height - 0.5) * GLOBAL_MAP_3D.worldDepth
    };
  }

  function globalMapPointFromWorld(x = 0, z = 0) {
    return clampGlobalMapPoint(
      (Number(x || 0) / GLOBAL_MAP_3D.worldWidth + 0.5) * GLOBAL_MAP_SIZE.width,
      (Number(z || 0) / GLOBAL_MAP_3D.worldDepth + 0.5) * GLOBAL_MAP_SIZE.height
    );
  }

  function globalMapCoastNormXAtY(ny = 0) {
    const y = Math.max(0, Math.min(1, Number(ny || 0)));
    const points = GLOBAL_MAP_COASTLINE;
    if (y <= points[0].y) return points[0].x;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (y <= b.y) {
        const t = (y - a.y) / Math.max(0.0001, b.y - a.y);
        return a.x + (b.x - a.x) * t;
      }
    }
    return points[points.length - 1].x;
  }

  function globalMapNormIsOcean(nx = 0, ny = 0) {
    return Math.max(0, Math.min(1, Number(nx || 0))) <= globalMapCoastNormXAtY(ny);
  }

  function globalMapPointIsWater(x = 0, y = 0) {
    const p = clampGlobalMapPoint(x, y);
    const nx = p.x / GLOBAL_MAP_SIZE.width;
    const ny = p.y / GLOBAL_MAP_SIZE.height;
    if (globalMapNormIsOcean(nx, ny)) return true;
    const cell = globalMapPointCell(p.x, p.y);
    const override = globalMapCellOverride(cell.cx, cell.cy);
    const texture = String(override?.texture || '').trim().toLowerCase();
    return GLOBAL_MAP_WATER_TEXTURES.has(texture);
  }

  function nearestGlobalMapLandPoint(point = {}, fallback = null) {
    const base = clampGlobalMapPoint(point.x, point.y);
    if (!globalMapPointIsWater(base.x, base.y)) return base;
    const preferred = fallback ? clampGlobalMapPoint(fallback.x, fallback.y) : { x: base.x + 1, y: base.y };
    const startAngle = Math.atan2(preferred.y - base.y, preferred.x - base.x);
    for (let radius = 1; radius <= GLOBAL_MAP_GRID.cellPoints * 10; radius += 1) {
      const samples = Math.max(16, Math.ceil(radius * 0.55));
      for (let i = 0; i < samples; i++) {
        const angle = startAngle + (i / samples) * Math.PI * 2;
        const candidate = clampGlobalMapPoint(
          base.x + Math.cos(angle) * radius,
          base.y + Math.sin(angle) * radius
        );
        if (!globalMapPointIsWater(candidate.x, candidate.y)) return candidate;
      }
    }
    return fallback && !globalMapPointIsWater(fallback.x, fallback.y) ? clampGlobalMapPoint(fallback.x, fallback.y) : base;
  }

  function sanitizeGlobalMapPlayerLandState(options = {}) {
    const current = globalMapPlayerPoint();
    if (!globalMapPointIsWater(current.x, current.y)) return current;
    const fallback = globalMapLocationPoint(globalMapState.fromLocationId || currentLocation?.id || 'settlement');
    const safe = nearestGlobalMapLandPoint(current, fallback);
    globalMapState.playerX = safe.x;
    globalMapState.playerY = safe.y;
    globalMapState.selectedX = safe.x;
    globalMapState.selectedY = safe.y;
    globalMapState.travel = null;
    globalMapState.encounter = null;
    if (options.clearPendingDrop !== false) globalMapState.pendingWorldDrop = null;
    if (options.announce) announceGlobalMapWaterBlock({ reason: 'target', point: current });
    if (options.save && typeof queueSave === 'function') queueSave(true);
    return safe;
  }

  function globalMapRouteWaterBlock(fromPoint = {}, toPoint = {}) {
    const from = clampGlobalMapPoint(fromPoint.x, fromPoint.y);
    const to = clampGlobalMapPoint(toPoint.x, toPoint.y);
    if (globalMapPointIsWater(from.x, from.y)) return { reason: 'from', point: from };
    if (globalMapPointIsWater(to.x, to.y)) return { reason: 'target', point: to };
    const distance = globalMapPointDistance(from, to);
    const steps = Math.max(1, Math.ceil(distance / 1.25));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const point = clampGlobalMapPoint(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t
      );
      if (globalMapPointIsWater(point.x, point.y)) return { reason: 'route', point };
    }
    return null;
  }

  function globalMapPathWaterBlock(points = []) {
    const route = Array.isArray(points) ? points : [];
    if (route.length < 2) return { reason: 'route', point: route[0] || null };
    for (let index = 1; index < route.length; index++) {
      const block = globalMapRouteWaterBlock(route[index - 1], route[index]);
      if (block) return block;
    }
    return null;
  }

  function announceGlobalMapWaterBlock(block = null) {
    const text = block?.reason === 'route'
      ? 'Маршрут проходит через воду. Выберите путь по суше.'
      : 'В воду нельзя идти. Выберите точку на суше.';
    if (typeof setReadout === 'function') setReadout(text);
    if (typeof addLog === 'function') addLog(`Глобальная карта: ${text}`, null, 'system');
  }

  function globalMapNormIsDryLake(nx = 0, ny = 0) {
    return ((nx - 0.315) ** 2) / (0.080 ** 2) + ((ny - 0.215) ** 2) / (0.040 ** 2) < 1 ||
      ((nx - 0.595) ** 2) / (0.095 ** 2) + ((ny - 0.560) ** 2) / (0.052 ** 2) < 1 ||
      ((nx - 0.385) ** 2) / (0.070 ** 2) + ((ny - 0.805) ** 2) / (0.040 ** 2) < 1;
  }

  function globalMapHeightAtPoint(x = 0, y = 0) {
    const nx = Math.max(0, Math.min(1, Number(x || 0) / GLOBAL_MAP_SIZE.width));
    const ny = Math.max(0, Math.min(1, Number(y || 0) / GLOBAL_MAP_SIZE.height));
    if (globalMapNormIsOcean(nx, ny)) return -1.05 + Math.sin(ny * 38) * 0.04;
    const ridge =
      Math.sin(nx * 20.5 + ny * 8.7) * 0.55 +
      Math.cos(nx * 7.4 - ny * 22.0) * 0.45 +
      Math.sin(nx * 42.0 + ny * 31.0) * 0.12;
    const eastMountains = Math.max(0, 1 - Math.abs(nx - (0.60 + ny * 0.30)) / 0.11) * Math.max(0, 1 - Math.abs(ny - 0.50) / 0.48);
    const oldMountains = Math.max(0, 1 - Math.abs(nx - (0.34 + ny * 0.30)) / 0.09) * Math.max(0, 1 - Math.abs(ny - 0.24) / 0.25);
    const basin = globalMapNormIsDryLake(nx, ny) ? -0.28 : 0;
    const coastRamp = nx < 0.18 ? -0.18 + nx * 0.55 : 0;
    return Math.max(-0.45, basin + coastRamp + ridge * 0.16 + eastMountains * 2.35 + oldMountains * 1.55);
  }

  function globalMapHeightAtWorld(x = 0, z = 0) {
    const point = globalMapPointFromWorld(x, z);
    return globalMapHeightAtPoint(point.x, point.y);
  }

  function drawGlobalMapTexturePatch(ctx, x, y, w, h, profile, shade = 0) {
    const preset = GLOBAL_MAP_TEXTURES[profile.texture] || GLOBAL_MAP_TEXTURES.wasteland_dust;
    ctx.fillStyle = preset.base || '#6f5b35';
    ctx.fillRect(x, y, w + 1, h + 1);
    ctx.fillStyle = profile.fill || preset.fill || 'rgba(126,94,50,0.18)';
    ctx.fillRect(x, y, w + 1, h + 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w + 1, h + 1);
    ctx.clip();
    ctx.strokeStyle = preset.accent || 'rgba(190,160,92,0.4)';
    ctx.fillStyle = preset.accent || 'rgba(190,160,92,0.4)';
    ctx.globalAlpha = 0.18;
    if (profile.texture === 'dry_lake' || profile.texture === 'salt_flat') {
      ctx.globalAlpha = 0.17;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(x + w * (0.22 + i * 0.18), y + h * (0.38 + (i % 2) * 0.18), w * 0.22, h * 0.08, i * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (profile.texture === 'rocky_hills' || profile.texture === 'scrap_field' || profile.texture === 'old_road') {
      for (let i = 0; i < 8; i++) {
        ctx.globalAlpha = 0.18;
        ctx.fillRect(x + ((i * 23 + shade * 31) % 100) / 100 * w, y + ((i * 37 + shade * 17) % 100) / 100 * h, w * 0.09, h * 0.045);
      }
    } else {
      for (let i = 0; i < 6; i++) {
        ctx.globalAlpha = 0.11;
        ctx.fillRect(x + ((i * 29 + 13) % 100) / 100 * w, y + ((i * 17 + 41) % 100) / 100 * h, w * 0.08, h * 0.025);
      }
    }
    ctx.restore();
  }

  function globalMapBuildTextureCanvas(size = GLOBAL_MAP_3D_TERRAIN_TEXTURE_SIZE) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const w = size;
    const h = size;
    const np = (x, y) => ({ x: x * w, y: y * h });
    ctx.fillStyle = '#6f5b35';
    ctx.fillRect(0, 0, w, h);
    const cw = w / GLOBAL_MAP_GRID.cols;
    const ch = h / GLOBAL_MAP_GRID.rows;
    for (let cy = 0; cy < GLOBAL_MAP_GRID.rows; cy++) {
      for (let cx = 0; cx < GLOBAL_MAP_GRID.cols; cx++) {
        const profile = globalMapCellProfile(cx, cy);
        const shade = Math.sin(cx * 0.71 + cy * 0.38) * 0.5 + Math.cos(cx * 0.26 - cy * 0.67) * 0.5;
        drawGlobalMapTexturePatch(ctx, cx * cw, cy * ch, cw, ch, profile, shade);
        ctx.fillStyle = shade > 0 ? `rgba(255,235,180,${0.04 + shade * 0.035})` : `rgba(24,18,12,${0.05 + Math.abs(shade) * 0.04})`;
        ctx.fillRect(cx * cw, cy * ch, cw + 1, ch + 1);
      }
    }

    const coastLine = GLOBAL_MAP_COASTLINE.map(p => np(p.x, p.y));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    coastLine.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(0, h);
    ctx.closePath();
    const ocean = ctx.createLinearGradient(0, 0, w * 0.25, h);
    ocean.addColorStop(0, '#254a52');
    ocean.addColorStop(0.55, '#305d61');
    ocean.addColorStop(1, '#172429');
    ctx.fillStyle = ocean;
    ctx.fill();
    ctx.clip();
    for (let i = 0; i < 42; i++) {
      const y = ((i * 37) % 100) / 100 * h;
      const x = (0.012 + (i % 9) * 0.018) * w;
      ctx.strokeStyle = i % 2 ? 'rgba(205,231,218,0.18)' : 'rgba(6,18,22,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 44, y);
      ctx.bezierCurveTo(x + 18, y - 18, x + 66, y + 14, x + 132, y - 5);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(238,205,127,0.45)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    coastLine.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();

    const drawDryLake = (x, y, rx, ry, rot) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const lake = ctx.createRadialGradient(0, 0, 2, 0, 0, Math.max(rx, ry));
      lake.addColorStop(0, 'rgba(225,213,164,0.65)');
      lake.addColorStop(0.62, 'rgba(181,154,95,0.46)');
      lake.addColorStop(1, 'rgba(70,53,32,0.22)');
      ctx.fillStyle = lake;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.setLineDash([10, 9]);
      ctx.strokeStyle = 'rgba(56,43,26,0.32)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, rx * (0.38 + i * 0.15), ry * (0.36 + i * 0.14), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    };
    drawDryLake(w * 0.315, h * 0.215, w * 0.070, h * 0.030, -0.32);
    drawDryLake(w * 0.595, h * 0.560, w * 0.085, h * 0.037, 0.24);
    drawDryLake(w * 0.385, h * 0.805, w * 0.060, h * 0.026, 0.10);

    ctx.strokeStyle = 'rgba(229,190,92,0.16)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += cw) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += ch) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    return canvas;
  }

  function disposeGlobalMap3DObject(obj) {
    if (!obj) return;
    obj.traverse?.(child => {
      if (child.geometry?.dispose) child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
      mats.forEach(mat => {
        if (mat.map?.dispose) mat.map.dispose();
        if (mat.dispose) mat.dispose();
      });
    });
  }

  function clearGlobalMap3DGroup(group) {
    if (!group) return;
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      disposeGlobalMap3DObject(child);
    }
  }

  function makeGlobalMapDynamicLine(color = 0xffffff, opacity = 0.8, vertexCount = 128, isSegments = false) {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
    if (THREE.DynamicDrawUsage) position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setDrawRange(0, 0);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 260);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    return isSegments ? new THREE.LineSegments(geometry, material) : new THREE.Line(geometry, material);
  }

  function updateGlobalMapDynamicLine(line, points = []) {
    if (!line?.geometry?.attributes?.position) return;
    const attr = line.geometry.attributes.position;
    const arr = attr.array;
    const count = Math.min(points.length, Math.floor(arr.length / 3));
    for (let i = 0; i < count; i++) {
      const p = points[i];
      const off = i * 3;
      arr[off] = Number(p.x || 0);
      arr[off + 1] = Number(p.y || 0);
      arr[off + 2] = Number(p.z || 0);
    }
    line.geometry.setDrawRange(0, count);
    attr.needsUpdate = true;
    line.visible = count > 1;
  }

