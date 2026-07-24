  // ===== MULTIPLAYER CLIENT =====
  const multiplayer = {
    socket: null,
    connected: false,
    joined: false,
    roomId: '',
    worldSiteId: '',
    worldSiteOwner: '',
    worldSiteOwnerLabel: '',
    lastStateSent: 0,
    lastHeartbeat: 0,
    networkPingElapsed: 0,
    networkPingMs: null,
    networkPingSmoothedMs: null,
    networkPingRequestId: 0,
    networkPingInFlight: false,
    networkPingTimeout: null,
    networkPingStatus: 'offline',
    lastWorldStateApplied: 0,
    serverAuthoritativeEnemies: false,
    remotePlayers: new Map(),
    groundItems: new Map(),
    groundItemMeshes: [],
    worldContainers: new Map(),
    worldContainerMeshes: [],
    joinWaiters: [],
    startupSnapshotWaiters: [],
    lastStartupNetworkEventAt: 0,
    lastWorldStateAt: 0,
    pvpMode: '',
    lastEnemySnapshotAt: 0,
    lastGroundItemsSnapshotAt: 0,
    lastWorldContainersSnapshotAt: 0,
    lastPlayerSnapshotT: 0,
    lastEnemySnapshotT: 0,
    lastGroundItemsSnapshotT: 0,
    lastWorldContainersSnapshotT: 0,
    lastHeavyProfileSent: 0,
    movementSeq: 0
  };

  function resolveMultiplayerJoinWaiters(ok) {
    const waiters = Array.isArray(multiplayer.joinWaiters) ? multiplayer.joinWaiters.splice(0) : [];
    waiters.forEach(waiter => {
      try { if (waiter.timer) clearTimeout(waiter.timer); } catch (_) {}
      try { waiter.resolve(!!ok); } catch (_) {}
    });
  }

  function waitForMultiplayerJoin(timeoutMs = 4500) {
    if (multiplayer.joined && multiplayer.roomId) return Promise.resolve(true);
    if (!Array.isArray(multiplayer.joinWaiters)) multiplayer.joinWaiters = [];
    return new Promise(resolve => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const idx = multiplayer.joinWaiters.indexOf(waiter);
        if (idx >= 0) multiplayer.joinWaiters.splice(idx, 1);
        resolve(false);
      }, Math.max(800, Number(timeoutMs) || 4500));
      multiplayer.joinWaiters.push(waiter);
    });
  }

  function markStartupNetworkEvent(kind = 'snapshot') {
    const now = performance.now();
    multiplayer.lastStartupNetworkEventAt = now;
    if (kind === 'worldState') multiplayer.lastWorldStateAt = now;
    else if (kind === 'enemySnapshot') multiplayer.lastEnemySnapshotAt = now;
    else if (kind === 'groundItemsSnapshot') multiplayer.lastGroundItemsSnapshotAt = now;
    else if (kind === 'worldContainersSnapshot') multiplayer.lastWorldContainersSnapshotAt = now;
  }

  function waitForStartupNetworkQuiet(options = {}) {
    const quietMs = Math.max(90, Number(options.quietMs || 220));
    const timeoutMs = Math.max(450, Number(options.timeoutMs || 1600));
    const started = performance.now();
    return new Promise(resolve => {
      const tick = () => {
        const now = performance.now();
        const last = Number(multiplayer.lastStartupNetworkEventAt || started);
        if (now - last >= quietMs || now - started >= timeoutMs) {
          resolve(true);
          return;
        }
        setTimeout(tick, 35);
      };
      tick();
    });
  }


  function enemiesAreServerAuthoritative() {
    return !!(multiplayer.socket && multiplayer.socket.connected && multiplayer.joined && multiplayer.serverAuthoritativeEnemies);
  }

  function clientWorldRequiresServer() {
    return !!(typeof serverSession !== 'undefined' && serverSession && serverSession.token);
  }

  function clientEnemyStateMayUseLocalFallback() {
    return !enemiesAreServerAuthoritative() && !multiplayer.socket && !clientWorldRequiresServer();
  }

  function groundItemsAreServerAuthoritative() {
    return !!(multiplayer.socket && multiplayer.socket.connected && multiplayer.joined);
  }

  function worldContainersAreServerAuthoritative() {
    return !!(multiplayer.socket && multiplayer.socket.connected && multiplayer.joined);
  }

  function networkPayloadIsForCurrentRoom(data) {
    if (!data || typeof data !== 'object') return false;
    // В MMO-событиях сервер отправляет roomId. Это надёжнее locationId, потому что
    // в одной локации могут быть разные инстансы комнат, а currentLocation на клиенте
    // иногда обновляется чуть позже сетевого события.
    if (data.roomId && multiplayer.roomId && data.roomId === multiplayer.roomId) return true;
    if (data.roomId && multiplayer.roomId && data.roomId !== multiplayer.roomId) return false;
    const loc = currentLocation?.id || 'settlement';
    return !data.locationId || data.locationId === loc;
  }


  // v7.74.37: серверные snapshot считаются авторитетными только для текущей комнаты.
  // Поздние пакеты из старой комнаты после перехода/респавна нельзя применять: иначе
  // клиент может на кадр вернуть старых мобов, игроков, контейнеры или предметы.
  function networkSnapshotIsFresh(data, stampField) {
    if (!networkPayloadIsForCurrentRoom(data)) return false;
    const t = Number(data?.t || 0);
    if (!t) return true;
    const prev = Number(multiplayer[stampField] || 0);
    if (prev && t < prev) return false;
    multiplayer[stampField] = t;
    return true;
  }

  function clearNetworkRoomEntities(options = {}) {
    const keepPlayer = options.keepPlayer !== false;
    try { clearRemotePlayers(); } catch (_) {}
    try { clearEnemies(); } catch (_) {}
    try { clearWorldContainersVisuals(); } catch (_) {}
    try { clearGroundItemsVisuals(); } catch (_) {}
    try {
      if (activeWorldContainer) {
        activeWorldContainer = null;
        if (typeof closeLootWindow === 'function') closeLootWindow();
      }
    } catch (_) {}
    try {
      if (player && player.attackTarget) player.attackTarget = null;
      if (typeof stopAutoFire === 'function') stopAutoFire();
      if (marker) marker.visible = false;
    } catch (_) {}
    if (!keepPlayer && playerGroup) {
      try { playerGroup.visible = false; } catch (_) {}
    }
  }

  function resetNetworkSnapshotStamps() {
    multiplayer.lastPlayerSnapshotT = 0;
    multiplayer.lastEnemySnapshotT = 0;
    multiplayer.lastGroundItemsSnapshotT = 0;
    multiplayer.lastWorldContainersSnapshotT = 0;
    multiplayer.lastWorldStateApplied = 0;
  }


  function networkEquipmentBaseId(id, fallback = '') {
    const raw = id || fallback;
    if (!raw) return '';
    try { return baseItemId(raw) || raw; }
    catch (_) { return raw; }
  }

  function multiplayerWeaponId() {
    try { return networkEquipmentBaseId(equipment.weapon || currentWeapon()?.id || 'fists', 'fists'); }
    catch (_) { return networkEquipmentBaseId(equipment.weapon || 'fists', 'fists'); }
  }

  function multiplayerEquipmentSnapshot() {
    return {
      weapon: multiplayerWeaponId(),
      armor: networkEquipmentBaseId(equipment.armor),
      helmet: networkEquipmentBaseId(equipment.helmet),
      boots: networkEquipmentBaseId(equipment.boots),
      backpack: networkEquipmentBaseId(equipment.backpack)
    };
  }

  function multiplayerInjurySnapshot() {
    const out = {};
    Object.keys(INJURY_META).forEach(id => { if (hasInjury(id)) out[id] = true; });
    return out;
  }

  function multiplayerSkillSnapshot() {
    try {
      if (typeof clientSkillRanksSnapshot === 'function') return clientSkillRanksSnapshot();
      return { ...skillRanks };
    }
    catch (_) { return {}; }
  }

  function multiplayerTalentSnapshot() {
    try { return { ...talentRanks }; }
    catch (_) { return {}; }
  }

  function multiplayerTraitSnapshot() {
    try { return Array.isArray(characterProfile?.traits) ? characterProfile.traits.slice(0, 2) : []; }
    catch (_) { return []; }
  }

  function multiplayerTaggedSkillsSnapshot() {
    try {
      const known = new Set(SKILLS.map(skill => skill.id));
      return Array.isArray(characterProfile?.taggedSkills)
        ? characterProfile.taggedSkills.filter(id => known.has(id)).slice(0, 2)
        : [];
    }
    catch (_) { return []; }
  }


  function sendImmediateMultiplayerState(reason = 'state') {
    if (!multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined) return;
    // v7.74.57: any state packet that carries position must have a movement seq.
    // Otherwise an older reliable combat/profile packet can arrive after newer
    // movement packets and pull the remote model backwards for other clients.
    multiplayer.socket.emit('state', {
      seq: ++multiplayer.movementSeq,
      reason,
      x: player.x,
      z: player.z,
      vx: 0,
      vz: 0,
      angle: player.angle,
      moving: reason === 'idle' ? false : true,
      crouching: player.crouching,
      hp: player.hp,
      maxHp: player.maxHp,
      maxAp: player.maxAp,
      ap: player.ap,
      combat: typeof multiplayerCombatSnapshot === 'function' ? multiplayerCombatSnapshot() : null,
      carry: typeof multiplayerCarrySnapshot === 'function' ? multiplayerCarrySnapshot() : null,
      inventory: typeof multiplayerInventorySnapshot === 'function' ? multiplayerInventorySnapshot() : null,
      special: characterProfile?.special || DEFAULT_SPECIAL,
      factionId: characterProfile?.factionId || characterProfile?.worldFactionId || '',
      worldFactionId: characterProfile?.worldFactionId || characterProfile?.factionId || '',
      skillRanks: multiplayerSkillSnapshot(),
      talentRanks: multiplayerTalentSnapshot(),
      traits: multiplayerTraitSnapshot(),
      taggedSkills: multiplayerTaggedSkillsSnapshot(),
      level: player.level,
      name: characterProfile?.name || serverSession.login || 'Игрок',
      deviceType: getDeviceType(),
      controlType: getDeviceControlType(),
      weapon: multiplayerWeaponId(),
      equipment: multiplayerEquipmentSnapshot(),
      injuries: multiplayerInjurySnapshot()
    });
  }
