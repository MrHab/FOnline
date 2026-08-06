  // ===== MULTIPLAYER CLIENT =====
  const multiplayer = {
    socket: null,
    connected: false,
    joined: false,
    authorityMode: (typeof serverSession !== 'undefined' && serverSession?.token) ? 'blocked' : 'offline-local',
    authorityReason: 'startup',
    transportState: 'idle',
    socketGeneration: 0,
    joinAttemptId: 0,
    joinInFlight: false,
    joinPromise: null,
    joinSocketId: '',
    joinSessionToken: '',
    joinCharacterId: '',
    joinClientInstanceId: '',
    joinedSocketId: '',
    joinedSessionToken: '',
    joinedCharacterId: '',
    joinedClientInstanceId: '',
    onlineSessionRequired: !!(typeof serverSession !== 'undefined' && serverSession?.token),
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
    movementSeq: 0,
    equipmentRevision: 0,
    equipmentActionSeq: 0,
    pendingEquipmentSlots: new Set()
  };

  function currentMultiplayerJoinContext() {
    return {
      sessionToken: String((typeof serverSession !== 'undefined' && serverSession?.token) || ''),
      characterId: String((typeof selectedServerCharacterId !== 'undefined' && selectedServerCharacterId) || ''),
      clientInstanceId: typeof getClientInstanceId === 'function' ? String(getClientInstanceId() || '') : ''
    };
  }

  function multiplayerJoinContextIsCurrent(context = {}) {
    const current = currentMultiplayerJoinContext();
    return !!current.sessionToken
      && !!current.characterId
      && !!current.clientInstanceId
      && String(context.sessionToken || '') === current.sessionToken
      && String(context.characterId || '') === current.characterId
      && String(context.clientInstanceId || '') === current.clientInstanceId;
  }

  function remapMultiplayerPendingJoinContext(fromContext = {}, characterId = '') {
    const nextCharacterId = String(characterId || '');
    if (!nextCharacterId) return false;
    const matches = context => !!context
      && String(context.sessionToken || '') === String(fromContext.sessionToken || '')
      && String(context.characterId || '') === String(fromContext.characterId || '')
      && String(context.clientInstanceId || '') === String(fromContext.clientInstanceId || '');
    if (matches({
      sessionToken: multiplayer.joinSessionToken,
      characterId: multiplayer.joinCharacterId,
      clientInstanceId: multiplayer.joinClientInstanceId
    })) {
      multiplayer.joinCharacterId = nextCharacterId;
    }
    (Array.isArray(multiplayer.joinWaiters) ? multiplayer.joinWaiters : []).forEach(waiter => {
      if (matches(waiter?.context)) waiter.context.characterId = nextCharacterId;
    });
    return true;
  }

  function multiplayerJoinAttemptMatchesCurrent(socket = multiplayer.socket) {
    return !!socket
      && multiplayer.joinSocketId === socket.id
      && multiplayerJoinContextIsCurrent({
        sessionToken: multiplayer.joinSessionToken,
        characterId: multiplayer.joinCharacterId,
        clientInstanceId: multiplayer.joinClientInstanceId
      });
  }

  function multiplayerJoinedContextMatchesCurrent(socket = multiplayer.socket) {
    return !!socket
      && !!socket.connected
      && multiplayer.joined
      && multiplayer.joinedSocketId === socket.id
      && multiplayerJoinContextIsCurrent({
        sessionToken: multiplayer.joinedSessionToken,
        characterId: multiplayer.joinedCharacterId,
        clientInstanceId: multiplayer.joinedClientInstanceId
      })
      && String(multiplayer.characterLeaseId || '') === String(
        (typeof activeCharacterLeaseId !== 'undefined' && activeCharacterLeaseId) || ''
      )
      && !!multiplayer.characterLeaseId;
  }

  function clearMultiplayerJoinedContext() {
    multiplayer.joined = false;
    multiplayer.joinedSocketId = '';
    multiplayer.joinedSessionToken = '';
    multiplayer.joinedCharacterId = '';
    multiplayer.joinedClientInstanceId = '';
    multiplayer.characterLeaseId = '';
  }

  function captureMultiplayerGameplayAckContext(socket = multiplayer.socket) {
    if (!socket
      || typeof socket.emit !== 'function'
      || !multiplayerJoinedContextMatchesCurrent(socket)) return null;
    return {
      socket,
      socketGeneration: Number(multiplayer.socketGeneration || 0),
      socketId: String(socket.id || ''),
      roomId: String(multiplayer.roomId || ''),
      joinContext: currentMultiplayerJoinContext(),
      joinedSocketId: String(multiplayer.joinedSocketId || ''),
      joinedSessionToken: String(multiplayer.joinedSessionToken || ''),
      joinedCharacterId: String(multiplayer.joinedCharacterId || ''),
      joinedClientInstanceId: String(multiplayer.joinedClientInstanceId || ''),
      characterLeaseId: String(multiplayer.characterLeaseId || '')
    };
  }

  function multiplayerGameplayAckContextIsCurrent(context) {
    const socket = context?.socket;
    return !!socket
      && socket === multiplayer.socket
      && !!socket.connected
      && Number(context.socketGeneration) === Number(multiplayer.socketGeneration || 0)
      && String(context.socketId || '') === String(socket.id || '')
      && String(context.roomId || '') === String(multiplayer.roomId || '')
      && String(context.joinedSocketId || '') === String(multiplayer.joinedSocketId || '')
      && String(context.joinedSessionToken || '') === String(multiplayer.joinedSessionToken || '')
      && String(context.joinedCharacterId || '') === String(multiplayer.joinedCharacterId || '')
      && String(context.joinedClientInstanceId || '') === String(multiplayer.joinedClientInstanceId || '')
      && String(context.characterLeaseId || '') === String(multiplayer.characterLeaseId || '')
      && multiplayerJoinContextIsCurrent(context.joinContext)
      && multiplayerJoinedContextMatchesCurrent(socket);
  }

  function emitGuardedMultiplayerGameplayAction(eventName, payload, onAck) {
    const socket = multiplayer.socket;
    const ackContext = captureMultiplayerGameplayAckContext(socket);
    if (!ackContext) return false;
    socket.emit(eventName, payload, (...ackArgs) => {
      if (!multiplayerGameplayAckContextIsCurrent(ackContext)) return false;
      if (typeof onAck === 'function') onAck(...ackArgs);
      return true;
    });
    return true;
  }

  function invalidateMultiplayerSessionContext(reason = 'session-context-changed', options = {}) {
    const socket = multiplayer.socket;
    try {
      if (typeof cancelMultiplayerJoinAttempt === 'function') cancelMultiplayerJoinAttempt(reason);
    } catch (_) {}
    multiplayer.socketGeneration = Number(multiplayer.socketGeneration || 0) + 1;
    multiplayer.socket = null;
    multiplayer.connected = false;
    clearMultiplayerJoinedContext();
    multiplayer.transportState = 'blocked';
    multiplayer.serverAuthoritativeEnemies = false;
    if (multiplayer.pendingEquipmentSlots?.clear) multiplayer.pendingEquipmentSlots.clear();
    try {
      if (typeof activeCharacterLeaseId !== 'undefined') activeCharacterLeaseId = '';
    } catch (_) {}
    if (typeof setClientAuthorityMode === 'function') {
      setClientAuthorityMode('blocked', reason, {
        force: true,
        clearWorld: options.clearWorld !== false
      });
    }
    try {
      if (typeof resetNetworkPingMeasurement === 'function') resetNetworkPingMeasurement('offline');
    } catch (_) {}
    resolveMultiplayerJoinWaiters(false);
    if (socket && options.disconnect !== false) {
      try { socket.disconnect(); } catch (_) {}
    }
    return !!socket;
  }

  function resolveMultiplayerJoinWaiters(ok) {
    const waiters = Array.isArray(multiplayer.joinWaiters) ? multiplayer.joinWaiters.splice(0) : [];
    waiters.forEach(waiter => {
      try { if (waiter.timer) clearTimeout(waiter.timer); } catch (_) {}
      const contextAccepted = !!ok
        && multiplayerJoinContextIsCurrent(waiter.context)
        && multiplayerJoinedContextMatchesCurrent(multiplayer.socket);
      try { waiter.resolve(contextAccepted); } catch (_) {}
    });
  }

  function waitForMultiplayerJoin(timeoutMs = 4500) {
    if (multiplayerJoinedContextMatchesCurrent(multiplayer.socket)) {
      return Promise.resolve(true);
    }
    if (!Array.isArray(multiplayer.joinWaiters)) multiplayer.joinWaiters = [];
    return new Promise(resolve => {
      const waiter = { resolve, timer: null, context: currentMultiplayerJoinContext() };
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

  function clientWorldRequiresServer() {
    const authenticated = !!(typeof serverSession !== 'undefined' && serverSession && serverSession.token);
    const boundServerCharacter = !!(
      typeof gameStarted !== 'undefined'
      && gameStarted
      && typeof characterProfile !== 'undefined'
      && characterProfile?.serverCharacterId
    );
    return authenticated || !!multiplayer.onlineSessionRequired || boundServerCharacter;
  }

  function clientAuthorityMode() {
    if (!clientWorldRequiresServer()) return 'offline-local';
    const serverReady = multiplayer.authorityMode === 'server'
      && multiplayerJoinedContextMatchesCurrent(multiplayer.socket);
    return serverReady ? 'server' : 'blocked';
  }

  function clientGameplayIsBlocked() {
    const contextTransitionPending = !!(
      typeof clientContextTransitionInFlight !== 'undefined'
      && clientContextTransitionInFlight
    );
    return contextTransitionPending || clientAuthorityMode() === 'blocked';
  }

  function rejectBlockedGameplayAction(message = 'Связь с сервером восстанавливается. Действие временно недоступно.') {
    if (!clientGameplayIsBlocked()) return false;
    try { setReadout(message); } catch (_) {}
    return true;
  }

  function clearClientGameplayInput(reason = 'authority') {
    try {
      if (typeof clearAllGameplayInput === 'function') {
        clearAllGameplayInput(reason, { sendIdle: false });
        return;
      }
    } catch (_) {}
    try {
      if (typeof keys === 'object' && keys) Object.keys(keys).forEach(code => { keys[code] = false; });
      if (typeof stopAutoFire === 'function') stopAutoFire();
      if (typeof stopTouchAim === 'function') stopTouchAim();
      if (typeof resetVirtualMove === 'function') resetVirtualMove();
      if (typeof player === 'object' && player) {
        player.attackTarget = null;
      }
    } catch (_) {}
  }

  function setClientAuthorityMode(mode = 'blocked', reason = 'network', options = {}) {
    const next = ['server', 'offline-local', 'blocked'].includes(mode) ? mode : 'blocked';
    const previous = multiplayer.authorityMode;
    multiplayer.authorityMode = next;
    multiplayer.authorityReason = String(reason || 'network').slice(0, 48);
    try {
      if (document?.body) document.body.dataset.authorityMode = next;
    } catch (_) {}
    if (next !== 'blocked') return previous !== next;
    if (previous === next && options.force !== true) return false;
    multiplayer.serverAuthoritativeEnemies = false;
    clearClientGameplayInput(reason);
    if (options.clearWorld !== false) {
      try { clearNetworkRoomEntities({ keepPlayer: true }); } catch (_) {}
      try { resetNetworkSnapshotStamps(); } catch (_) {}
    }
    return previous !== next;
  }

  function enemiesAreServerAuthoritative() {
    return clientAuthorityMode() === 'server' && multiplayer.serverAuthoritativeEnemies;
  }

  function clientEnemyStateMayUseLocalFallback() {
    return clientAuthorityMode() === 'offline-local';
  }

  function groundItemsAreServerAuthoritative() {
    return clientAuthorityMode() === 'server';
  }

  function worldContainersAreServerAuthoritative() {
    return clientAuthorityMode() === 'server';
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
    try {
      if (activeLootEnemy || activeWorldContainer) {
        if (typeof closeLootWindow === 'function') closeLootWindow();
        else {
          activeLootEnemy = null;
          activeWorldContainer = null;
        }
      }
    } catch (_) {}
    try {
      if (traderWindowOpen && typeof closeTraderWindow === 'function') closeTraderWindow();
    } catch (_) {}
    try {
      if (storageWindowOpen && typeof closeStorageWindow === 'function') closeStorageWindow();
    } catch (_) {}
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
    try { return networkEquipmentBaseId(equipment[activeWeaponEquipmentSlot()] || currentWeapon()?.id || 'fists', 'fists'); }
    catch (_) { return networkEquipmentBaseId(equipment.weapon || equipment.offhand || 'fists', 'fists'); }
  }

  function multiplayerEquipmentSnapshot() {
    return {
      // The authoritative server still normalizes these ids before exposing
      // equipment to other players, but it needs the local runtime id to keep
      // each physical weapon's magazine separate.
      weapon: String(equipment.weapon || 'fists').slice(0, 96),
      offhand: String(equipment.offhand || '').slice(0, 96),
      armor: String(equipment.armor || '').slice(0, 96),
      helmet: String(equipment.helmet || '').slice(0, 96),
      boots: String(equipment.boots || '').slice(0, 96),
      backpack: String(equipment.backpack || '').slice(0, 96)
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
      appearance: typeof normalizeCharacterAppearance === 'function'
        ? normalizeCharacterAppearance(characterProfile?.appearance || {})
        : (characterProfile?.appearance || {}),
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
