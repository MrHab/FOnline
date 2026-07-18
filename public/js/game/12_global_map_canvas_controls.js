  function handleGlobalMapWheel(e) {
    if (!document.body.classList.contains('global-map-mode') || !ensureGlobalMap3D()) return;
    e.preventDefault();
    const factor = Math.exp(Math.max(-240, Math.min(240, Number(e.deltaY || 0))) * 0.0016);
    GLOBAL_MAP_3D.zoom = Math.max(GLOBAL_MAP_3D.minZoom, Math.min(GLOBAL_MAP_3D.maxZoom, GLOBAL_MAP_3D.zoom * factor));
    GLOBAL_MAP_3D.dynamicHeavyNextAt = 0;
    renderGlobalMapPanel();
  }

  function scheduleGlobalMap3DRender() {
    if (GLOBAL_MAP_3D.renderQueued) return;
    GLOBAL_MAP_3D.renderQueued = true;
    requestAnimationFrame(() => {
      GLOBAL_MAP_3D.renderQueued = false;
      if (!document.body.classList.contains('global-map-mode')) return;
      if (!renderGlobalMap3D(0, true)) drawGlobalMap();
    });
  }

  function handleGlobalMapPointerDown(e) {
    if (!document.body.classList.contains('global-map-mode') || !ensureGlobalMap3D()) return;
    if (e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    GLOBAL_MAP_3D.dragging = true;
    GLOBAL_MAP_3D.dragX = e.clientX;
    GLOBAL_MAP_3D.dragY = e.clientY;
    setGlobalMapPanningCursor(true);
    globalMapSurface?.setPointerCapture?.(e.pointerId);
  }

  function handleGlobalMapPointerDrag(e) {
    if (!GLOBAL_MAP_3D.dragging) return false;
    e.preventDefault();
    const dx = Number(e.clientX || 0) - GLOBAL_MAP_3D.dragX;
    const dy = Number(e.clientY || 0) - GLOBAL_MAP_3D.dragY;
    GLOBAL_MAP_3D.dragX = e.clientX;
    GLOBAL_MAP_3D.dragY = e.clientY;
    const scale = GLOBAL_MAP_3D.zoom / 980;
    GLOBAL_MAP_3D.userPanned = true;
    clampGlobalMap3DCameraTarget(GLOBAL_MAP_3D.targetX - dx * scale, GLOBAL_MAP_3D.targetZ - dy * scale);
    scheduleGlobalMap3DRender();
    return true;
  }

  function handleGlobalMapPointerUp(e) {
    if (!GLOBAL_MAP_3D.dragging) return;
    GLOBAL_MAP_3D.dragging = false;
    setGlobalMapPanningCursor(false);
    globalMapSurface?.releasePointerCapture?.(e.pointerId);
    if (e && e.type !== 'pointercancel') updateGlobalMapCursor(e);
  }

  function drawGlobalMap() {
    if (renderGlobalMap3D()) return;
    if (!globalMapCanvas || !globalMapCtx) return;
    const ctx = globalMapCtx;
    const w = globalMapCanvas.width;
    const h = globalMapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const pointPx = point => ({ x: Number(point.x || 0) / GLOBAL_MAP_SIZE.width * w, y: Number(point.y || 0) / GLOBAL_MAP_SIZE.height * h });
    const px = node => pointPx(node);
    const np = (x, y) => ({ x: x * w, y: y * h });
    const drawPolyline = (points, close = false) => {
      if (!points.length) return;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      if (close) ctx.closePath();
    };
    const drawLabel = (text, x, y, size = 12, color = '#efd078', align = 'center') => {
      ctx.save();
      ctx.font = `900 ${size}px Consolas, monospace`;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, size * 0.28);
      ctx.strokeStyle = 'rgba(0,0,0,0.72)';
      ctx.fillStyle = color;
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
      ctx.restore();
    };

    const landGrd = ctx.createLinearGradient(0, 0, w, h);
    landGrd.addColorStop(0, '#6d5d3d');
    landGrd.addColorStop(0.34, '#9b7d4e');
    landGrd.addColorStop(0.58, '#736542');
    landGrd.addColorStop(0.78, '#3d402b');
    landGrd.addColorStop(1, '#19170f');
    ctx.fillStyle = landGrd;
    ctx.fillRect(0, 0, w, h);

    const cols = GLOBAL_MAP_GRID.cols;
    const rows = GLOBAL_MAP_GRID.rows;
    const cw = w / cols;
    const ch = h / rows;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const cell = globalMapCellProfile(cx, cy);
        const relief = Math.sin(cx * 0.71 + cy * 0.38) * 0.5 + Math.cos(cx * 0.26 - cy * 0.67) * 0.5;
        const grain = Math.sin(cx * 5.37 + cy * 2.19) * 0.5 + Math.cos(cx * 1.73 - cy * 4.11) * 0.5;
        ctx.fillStyle = cell.fill;
        ctx.fillRect(cx * cw, cy * ch, cw + 1, ch + 1);
        ctx.fillStyle = relief > 0.18 ? `rgba(245,230,190,${Math.min(0.12, relief * 0.06)})` : `rgba(0,0,0,${Math.min(0.13, Math.abs(relief) * 0.07)})`;
        ctx.fillRect(cx * cw, cy * ch, cw + 1, ch + 1);
        ctx.fillStyle = grain > 0 ? `rgba(255,233,166,${0.018 + grain * 0.018})` : `rgba(21,14,9,${0.018 + Math.abs(grain) * 0.018})`;
        ctx.fillRect(cx * cw, cy * ch, cw + 1, ch + 1);
      }
    }

    const coastLine = GLOBAL_MAP_COASTLINE.map(p => np(p.x, p.y));
    const oceanShape = [np(0, 0), ...coastLine, np(0, 1)];
    const oceanGrd = ctx.createLinearGradient(0, 0, w * 0.24, h);
    oceanGrd.addColorStop(0, '#223c3e');
    oceanGrd.addColorStop(0.52, '#314d4a');
    oceanGrd.addColorStop(1, '#151f22');
    ctx.save();
    drawPolyline(oceanShape, true);
    ctx.fillStyle = oceanGrd;
    ctx.fill();
    ctx.clip();
    for (let i = 0; i < 28; i++) {
      const y = ((i * 37) % 100) / 100 * h;
      const x = (0.015 + (i % 7) * 0.022) * w;
      ctx.strokeStyle = i % 2 ? 'rgba(194,213,191,0.13)' : 'rgba(7,18,20,0.22)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - 34, y);
      ctx.bezierCurveTo(x + 18, y - 12, x + 54, y + 11, x + 106, y - 4);
      ctx.stroke();
    }
    ctx.restore();
    drawPolyline(coastLine, false);
    ctx.strokeStyle = 'rgba(238,205,127,0.45)';
    ctx.lineWidth = 8;
    ctx.stroke();
    drawPolyline(coastLine, false);
    ctx.strokeStyle = 'rgba(25,20,13,0.65)';
    ctx.lineWidth = 2;
    ctx.stroke();
    drawLabel('ТИХИЙ ОКЕАН', w * 0.055, h * 0.64, 11, 'rgba(193,220,198,0.86)', 'center');

    const drawDryLake = (x, y, rx, ry, rot, label) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const lakeGrd = ctx.createRadialGradient(0, 0, 2, 0, 0, Math.max(rx, ry));
      lakeGrd.addColorStop(0, 'rgba(224,211,159,0.48)');
      lakeGrd.addColorStop(0.62, 'rgba(180,156,104,0.33)');
      lakeGrd.addColorStop(1, 'rgba(69,54,35,0.20)');
      ctx.fillStyle = lakeGrd;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(236,218,159,0.34)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = 'rgba(60,43,25,0.24)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, rx * (0.45 + i * 0.18), ry * (0.42 + i * 0.16), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(33,25,15,0.25)';
      for (let i = 0; i < 10; i++) {
        const a = i * 0.73;
        const sx = Math.cos(a) * rx * 0.12;
        const sy = Math.sin(a) * ry * 0.10;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(Math.cos(a + 0.32) * rx * (0.36 + (i % 3) * 0.13), Math.sin(a + 0.18) * ry * (0.36 + (i % 4) * 0.11));
        ctx.stroke();
      }
      ctx.restore();
      drawLabel(label, x, y - ry - 11, 10, 'rgba(232,211,139,0.84)');
    };
    drawDryLake(w * 0.315, h * 0.215, w * 0.070, h * 0.030, -0.32, 'СУХОЕ ОЗЕРО');
    drawDryLake(w * 0.595, h * 0.560, w * 0.085, h * 0.037, 0.24, 'СОЛОНЧАК');
    drawDryLake(w * 0.385, h * 0.805, w * 0.060, h * 0.026, 0.10, 'МЁРТВАЯ НИЗИНА');

    const drawWash = points => {
      ctx.save();
      ctx.setLineDash([9, 8]);
      ctx.strokeStyle = 'rgba(74,59,35,0.42)';
      ctx.lineWidth = 3;
      drawPolyline(points.map(p => np(p[0], p[1])), false);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(223,200,133,0.18)';
      ctx.lineWidth = 1;
      drawPolyline(points.map(p => np(p[0], p[1])), false);
      ctx.stroke();
      ctx.restore();
    };
    drawWash([[0.19,0.22],[0.29,0.27],[0.42,0.31],[0.51,0.40],[0.59,0.56]]);
    drawWash([[0.72,0.15],[0.66,0.26],[0.61,0.40],[0.59,0.56],[0.55,0.68]]);
    drawWash([[0.19,0.68],[0.28,0.73],[0.38,0.80],[0.49,0.83]]);

    const drawMountainChain = (points, labelX, labelY, label) => {
      const pts = points.map(p => np(p[0], p[1]));
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawPolyline(pts, false);
      ctx.strokeStyle = 'rgba(20,18,13,0.35)';
      ctx.lineWidth = 18;
      ctx.stroke();
      drawPolyline(pts, false);
      ctx.strokeStyle = 'rgba(92,87,70,0.56)';
      ctx.lineWidth = 8;
      ctx.stroke();
      drawPolyline(pts, false);
      ctx.strokeStyle = 'rgba(229,212,159,0.22)';
      ctx.lineWidth = 2;
      ctx.stroke();
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        for (let t = 0.18; t < 1; t += 0.27) {
          const x = a.x + (b.x - a.x) * t;
          const y = a.y + (b.y - a.y) * t;
          const s = 7 + ((i * 5 + Math.round(t * 10)) % 4) * 2;
          ctx.fillStyle = 'rgba(35,31,23,0.42)';
          ctx.beginPath();
          ctx.moveTo(x, y - s);
          ctx.lineTo(x - s * 0.8, y + s * 0.65);
          ctx.lineTo(x + s * 0.9, y + s * 0.55);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(225,211,166,0.18)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.restore();
      drawLabel(label, w * labelX, h * labelY, 10, 'rgba(222,209,160,0.78)');
    };
    drawMountainChain([[0.58,0.06],[0.66,0.16],[0.72,0.27],[0.78,0.42],[0.85,0.58],[0.91,0.76]], 0.88, 0.43, 'ХРЕБЕТ');
    drawMountainChain([[0.36,0.08],[0.45,0.19],[0.49,0.33],[0.52,0.49]], 0.47, 0.18, 'СТАРЫЕ ГОРЫ');

    ctx.save();
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 34; i++) {
      const y = (Math.sin(i * 9.731) * 0.5 + 0.5) * h;
      const x = (Math.cos(i * 5.117) * 0.5 + 0.5) * w;
      const rx = 90 + (i % 7) * 28;
      const ry = 24 + (i % 5) * 18;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(34,28,20,0.19)' : 'rgba(216,195,148,0.09)';
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, (i * 0.39) % Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(229,190,92,0.20)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += cw) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += ch) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,218,118,0.20)';
    ctx.lineWidth = 1.5;
    for (let x = 0; x <= w; x += cw * 5) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += ch * 5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    drawGlobalMapFactionTerritories2D(ctx, pointPx);
    drawGlobalMapFactionInfluence2D(ctx, pointPx);
    drawGlobalMapFactionFronts2D(ctx, pointPx);

    const playerPoint = globalMapPlayerPoint();
    const selectedPoint = globalMapSelectedPoint();
    const playerSettlement = globalMapSettlementAt(playerPoint.x, playerPoint.y);
    const selectedSettlement = globalMapSettlementAt(selectedPoint.x, selectedPoint.y);
    let iconPoint = playerPoint;
    if (globalMapState.travel) {
      iconPoint = globalMapTravelCurrentPoint(globalMapState.travel);
    }
    const destinationPoint = globalMapState.travel?.toPoint || selectedPoint;
    const hasDestination = globalMapPointDistance(iconPoint, destinationPoint) > 0.35;
    const destinationColor = globalMapState.encounter ? '#ff7254' : '#efd078';
    if (hasDestination) {
      const routePoints = globalMapState.travel?.routePoints?.length >= 2
        ? globalMapRoutePointsFromProgress(globalMapState.travel.routePoints, globalMapState.travel.progress)
        : [iconPoint, destinationPoint];
      const routePixels = routePoints.map(pointPx);
      ctx.save();
      ctx.strokeStyle = globalMapState.encounter ? 'rgba(255,114,84,0.82)' : 'rgba(238,208,120,0.82)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 7]);
      ctx.lineDashOffset = -Math.floor(performance.now() / 90) % 14;
      ctx.beginPath();
      routePixels.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    const trackedTask = globalMapTrackedWorldTask();
    const trackedPoint = globalMapTrackedTaskTargetPoint(trackedTask);
    if (trackedPoint) {
      const from = pointPx(iconPoint);
      const to = pointPx(trackedPoint);
      const pulse = 0.5 + Math.sin(performance.now() / 260) * 0.5;
      ctx.save();
      ctx.strokeStyle = `rgba(143,215,255,${0.38 + pulse * 0.24})`;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([4, 8]);
      ctx.lineDashOffset = -Math.floor(performance.now() / 70) % 12;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.translate(to.x, to.y);
      ctx.strokeStyle = 'rgba(0,0,0,0.78)';
      ctx.fillStyle = 'rgba(143,215,255,0.92)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 12 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(0, 10);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(2, -14);
      ctx.lineTo(15, -9);
      ctx.lineTo(2, -4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(143,215,255,0.86)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    globalMapWorldTaskMarkerRows(18).forEach(row => {
      const p = pointPx(clampGlobalMapPoint(row.x, row.y));
      const meta = row.meta || globalMapWorldTaskTypeMeta(row.topTask || {});
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.strokeStyle = 'rgba(0,0,0,0.78)';
      ctx.fillStyle = globalMapColorAlpha(meta.color, 0.30);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, row.tasks.length > 1 ? 12 : 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });

    GLOBAL_MAP_NODES.forEach(node => {
      const p = px(node);
      const isCurrent = node.id === playerSettlement?.id;
      const isSelected = node.id === selectedSettlement?.id;
      const radius = node.kind === 'settlement' ? 13 : 9;
      const nodeSite = globalMapWorldSiteById(node.id);
      const nodeColor = nodeSite ? globalMapWorldSiteColor(nodeSite) : (node.kind === 'settlement' ? '#15951d' : '#d8a85d');
      const ownerColor = nodeSite ? (globalMapFactionColor(nodeSite.owner || '') || nodeColor) : nodeColor;
      if (nodeSite) {
        ctx.save();
        ctx.translate(p.x, p.y);
        drawGlobalMapWorldHotspot2D(ctx, nodeSite, { radius: node.kind === 'settlement' ? 22 : 18, labelY: node.kind === 'settlement' ? -38 : -30 });
        ctx.restore();
      }
      if (node.kind === 'settlement') {
        ctx.strokeStyle = isSelected ? 'rgba(239,208,120,0.58)' : globalMapColorAlpha(nodeColor, 0.46);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, globalMapSettlementRadius(node) / GLOBAL_MAP_SIZE.width * w, 0, Math.PI * 2);
        ctx.stroke();
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((node.x * 0.013 + node.y * 0.007) % 0.55 - 0.25);
        ctx.fillStyle = 'rgba(8,18,8,0.74)';
        ctx.strokeStyle = 'rgba(151,219,96,0.34)';
        ctx.lineWidth = 1;
        const blocks = [[-13,-6,8,5],[-4,-9,7,7],[5,-5,9,5],[-10,3,7,6],[1,3,11,6]];
        blocks.forEach(([x, y, bw, bh]) => {
          ctx.fillRect(x, y, bw, bh);
          ctx.strokeRect(x, y, bw, bh);
        });
        ctx.strokeStyle = 'rgba(226,194,96,0.38)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-16, 0);
        ctx.lineTo(16, 0);
        ctx.moveTo(0, -13);
        ctx.lineTo(0, 12);
        ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = isCurrent ? '#ffffff' : (isSelected ? '#efd078' : ownerColor);
      ctx.lineWidth = isCurrent || isSelected ? 5 : 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = node.kind === 'settlement' ? globalMapColorAlpha(ownerColor, 0.30) : 'rgba(216,168,93,0.70)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, node.kind === 'settlement' ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (node.kind === 'settlement' && nodeSite) {
        ctx.font = '900 9px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.78)';
        ctx.fillStyle = ownerColor;
        const ownerLabel = nodeSite.ownerLabel || globalMapFactionLabel(nodeSite.owner || 'neutral');
        ctx.strokeText(ownerLabel, p.x, p.y + 27);
        ctx.fillText(ownerLabel, p.x, p.y + 27);
      }
      ctx.fillStyle = '#efd078';
      ctx.font = '900 14px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.72)';
      ctx.strokeText(globalMapLocationName(node.id), p.x, p.y - 18);
      ctx.fillText(globalMapLocationName(node.id), p.x, p.y - 18);
    });

    globalMapWorldSites()
      .slice(0, 24)
      .forEach(row => {
        const p = pointPx(clampGlobalMapPoint(row.x, row.y));
        const color = globalMapWorldSiteColor(row);
        ctx.save();
        ctx.translate(p.x, p.y);
        drawGlobalMapWorldHotspot2D(ctx, row, { radius: 18, labelY: -31 });
        drawGlobalMapWorldSite2DIcon(ctx, row, color);
        ctx.restore();
      });

    (Array.isArray(WASTELAND_SIM_STATE.parties) ? WASTELAND_SIM_STATE.parties : [])
      .filter(row => globalMapWorldPartyVisibleOnMap(row))
      .forEach(row => {
        const p = pointPx(globalMapWorldPartyDisplayPoint(row));
        const color = globalMapWorldPartyColor(row.kind, row.faction);
        const risk = Math.max(0, Math.min(100, Number(row.riskLevel || 0)));
        const cargoFill = Math.max(0, Math.min(100, Number(row.cargoFillPercent || 0)));
        const partyRadiusPx = Math.max(8, globalMapWorldPartyVisualRadiusPoints(row) / Math.max(1, GLOBAL_MAP_SIZE.width) * w);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.strokeStyle = risk >= 55
          ? `rgba(255,114,84,${risk >= 75 ? 0.82 : 0.58})`
          : globalMapColorAlpha(color, 0.34);
        ctx.lineWidth = risk >= 75 ? 3 : 2;
        ctx.beginPath();
        ctx.arc(0, 0, partyRadiusPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.strokeStyle = 'rgba(0,0,0,0.82)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -7);
        ctx.lineTo(7, 5);
        ctx.lineTo(-7, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (String(row.kind || '').toLowerCase() === 'caravan') {
          ctx.strokeStyle = 'rgba(0,0,0,0.78)';
          ctx.fillStyle = 'rgba(20,16,8,0.78)';
          ctx.lineWidth = 1;
          ctx.fillRect(-8, 8, 16, 4);
          ctx.strokeRect(-8, 8, 16, 4);
          ctx.fillStyle = cargoFill >= 75 ? '#f2d678' : '#9fdb7a';
          ctx.fillRect(-7, 9, Math.max(1, 14 * cargoFill / 100), 2);
        }
        ctx.font = '900 10px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.72)';
        ctx.fillStyle = color;
        ctx.strokeText(globalMapWorldPartyKindLabel(row.kind), 0, -11);
        ctx.fillText(globalMapWorldPartyKindLabel(row.kind), 0, -11);
        ctx.restore();
      });

    (Array.isArray(WASTELAND_SIM_STATE.parties) ? WASTELAND_SIM_STATE.parties : [])
      .filter(row => row && globalMapWorldPartyDestroyed(row) && String(row.kind || '').toLowerCase() !== 'caravan')
      .slice(0, 8)
      .forEach(row => {
        const p = pointPx(clampGlobalMapPoint(row.x, row.y));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = 'rgba(255,114,84,0.24)';
        ctx.strokeStyle = 'rgba(0,0,0,0.78)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,154,118,0.82)';
        ctx.beginPath();
        ctx.moveTo(-5, -5);
        ctx.lineTo(5, 5);
        ctx.moveTo(5, -5);
        ctx.lineTo(-5, 5);
        ctx.stroke();
        ctx.font = '900 9px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.76)';
        ctx.fillStyle = '#ff9a76';
        ctx.strokeText('РАЗГРОМ', 0, -13);
        ctx.fillText('РАЗГРОМ', 0, -13);
        ctx.restore();
      });

    if (hasDestination) {
      const sp = pointPx(destinationPoint);
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.fillStyle = destinationColor;
      ctx.strokeStyle = 'rgba(0,0,0,0.82)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = globalMapColorAlpha(destinationColor, 0.72);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const ip = pointPx(iconPoint);
    ctx.save();
    ctx.translate(ip.x, ip.y);
    ctx.fillStyle = '#f0d56f';
    ctx.strokeStyle = 'rgba(0,0,0,0.82)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240,213,111,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

