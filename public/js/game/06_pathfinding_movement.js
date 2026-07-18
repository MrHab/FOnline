  // ===== PATHFINDING =====
  function keyOf(tx, tz) { return `${tx},${tz}`; }

  function nearestWalkable(tx, tz) {
    if (isWalkableTile(tx, tz)) return { tx, tz };
    for (let r = 1; r <= 6; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = tx + dx, nz = tz + dz;
          if (isWalkableTile(nx, nz)) return { tx: nx, tz: nz };
        }
      }
    }
    return null;
  }

  function findPath(startTx, startTz, goalTx, goalTz) {
    const goal = nearestWalkable(goalTx, goalTz);
    if (!goal || !isWalkableTile(startTx, startTz)) return [];
    goalTx = goal.tx; goalTz = goal.tz;
    if (startTx === goalTx && startTz === goalTz) return [{ tx: goalTx, tz: goalTz }];

    const open = [{ tx: startTx, tz: startTz, f: 0 }];
    const came = new Map();
    const gScore = new Map([[keyOf(startTx, startTz), 0]]);
    const closed = new Set();
    const dirs = [
      [1,0,1], [-1,0,1], [0,1,1], [0,-1,1],
      [1,1,1.42], [1,-1,1.42], [-1,1,1.42], [-1,-1,1.42]
    ];
    const h = (tx, tz) => Math.hypot(goalTx - tx, goalTz - tz);

    while (open.length) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift();
      const curKey = keyOf(cur.tx, cur.tz);
      if (closed.has(curKey)) continue;
      if (cur.tx === goalTx && cur.tz === goalTz) {
        const out = [];
        let k = curKey;
        while (came.has(k)) {
          const [x, z] = k.split(',').map(Number);
          out.push({ tx: x, tz: z });
          k = came.get(k);
        }
        out.reverse();
        return out;
      }
      closed.add(curKey);

      for (const [dx, dz, cost] of dirs) {
        const nx = cur.tx + dx, nz = cur.tz + dz;
        if (!isWalkableTile(nx, nz)) continue;
        // prevent cutting corners diagonally through solid cells
        if (dx !== 0 && dz !== 0 && (!isWalkableTile(cur.tx + dx, cur.tz) || !isWalkableTile(cur.tx, cur.tz + dz))) continue;
        const nk = keyOf(nx, nz);
        if (closed.has(nk)) continue;
        const tentative = (gScore.get(curKey) || 999999) + cost;
        if (tentative < (gScore.get(nk) || 999999)) {
          came.set(nk, curKey);
          gScore.set(nk, tentative);
          open.push({ tx: nx, tz: nz, f: tentative + h(nx, nz) });
        }
      }
    }
    return [];
  }

  function setMoveTargetWorld(x, z) {
    const start = worldToTile(player.x, player.z);
    const goal = worldToTile(x, z);
    const pathTiles = findPath(start.tx, start.tz, goal.tx, goal.tz);
    player.targetPath = pathTiles.map(p => {
      const w = tileToWorld(p.tx, p.tz);
      return { x: w.x, z: w.z };
    });
    if (player.targetPath.length > 0) {
      const last = player.targetPath[player.targetPath.length - 1];
      const destinationClear = typeof canPlayerMoveToWorldPoint === 'function'
        ? canPlayerMoveToWorldPoint(x, z, 0)
        : isWalkableWorld(x, z);
      if (destinationClear) {
        last.x = x; last.z = z;
      }
      showMoveMarker(last.x, last.z);
      setReadout('Иду к выбранной точке.');
    } else {
      setReadout('Туда нельзя пройти.');
    }
  }

