  const NETWORK_PING_INTERVAL_SECONDS = 2;
  const NETWORK_PING_TIMEOUT_MS = 3500;
  const NETWORK_PING_SCHEDULER_SAMPLE_MS = 50;
  const networkPingEl = document.getElementById('network-ping');

  function currentNetworkPingTransport() {
    return String(multiplayer.socket?.io?.engine?.transport?.name || '').trim().toLowerCase();
  }

  function networkPingObservedMainThreadStallMs(measuredPing, finishedAt, schedulerExpectedAt, maxSchedulerDelay) {
    const measured = Math.max(0, Number(measuredPing) || 0);
    const callbackSchedulerDelay = Math.max(0, (Number(finishedAt) || 0) - (Number(schedulerExpectedAt) || 0));
    return Math.min(measured, Math.max(0, Number(maxSchedulerDelay) || 0, callbackSchedulerDelay));
  }

  function renderNetworkPing(pingMs = null, status = 'offline') {
    multiplayer.networkPingStatus = status;
    if (!networkPingEl) return;
    const hasPing = pingMs !== null && pingMs !== '' && Number.isFinite(Number(pingMs));
    const roundedPing = hasPing ? Math.max(0, Math.round(Number(pingMs))) : null;
    const quality = roundedPing === null
      ? (status === 'timeout' ? 'bad' : 'offline')
      : (roundedPing <= 80 ? 'good' : (roundedPing <= 160 ? 'medium' : 'bad'));
    networkPingEl.classList.remove('ping-good', 'ping-medium', 'ping-bad', 'ping-offline');
    networkPingEl.classList.add(`ping-${quality}`);
    networkPingEl.textContent = roundedPing === null ? (status === 'waiting' ? '…ms' : '—ms') : `${roundedPing}ms`;
    if (roundedPing === null) {
      networkPingEl.title = status === 'waiting'
        ? 'RTT до игрового сервера: измерение…'
        : (status === 'timeout'
          ? 'RTT до игрового сервера: ответ не получен вовремя'
          : 'RTT до игрового сервера: нет соединения');
      delete networkPingEl.dataset.rawPingMs;
      delete networkPingEl.dataset.mainThreadStallMs;
      delete networkPingEl.dataset.transport;
      return;
    }
    const rawPing = Number(multiplayer.networkPingMs);
    const mainThreadStall = Number(multiplayer.networkPingMainThreadStallMs);
    const transport = String(multiplayer.networkPingTransport || '').toLowerCase();
    const details = [
      `Полный RTT до игрового сервера: ${roundedPing} мс (сглажено)`,
      Number.isFinite(rawPing) ? `Последний замер: ${Math.max(0, Math.round(rawPing))} мс` : '',
      transport ? `Транспорт: ${transport === 'websocket' ? 'WebSocket' : transport}` : '',
      Number.isFinite(mainThreadStall) && mainThreadStall >= 8
        ? `Максимальная пауза главного потока во время замера: ${Math.max(0, Math.round(mainThreadStall))} мс (наблюдение, не часть RTT для вычитания)`
        : ''
    ].filter(Boolean);
    networkPingEl.title = details.join('\n');
    if (Number.isFinite(rawPing)) networkPingEl.dataset.rawPingMs = String(Math.max(0, Math.round(rawPing)));
    else delete networkPingEl.dataset.rawPingMs;
    if (Number.isFinite(mainThreadStall)) networkPingEl.dataset.mainThreadStallMs = String(Math.max(0, Math.round(mainThreadStall)));
    else delete networkPingEl.dataset.mainThreadStallMs;
    if (transport) networkPingEl.dataset.transport = transport;
    else delete networkPingEl.dataset.transport;
  }

  function resetNetworkPingMeasurement(status = 'offline') {
    if (multiplayer.networkPingTimeout) clearTimeout(multiplayer.networkPingTimeout);
    multiplayer.networkPingTimeout = null;
    multiplayer.networkPingRequestId = Number(multiplayer.networkPingRequestId || 0) + 1;
    multiplayer.networkPingInFlight = false;
    multiplayer.networkPingElapsed = status === 'waiting' ? NETWORK_PING_INTERVAL_SECONDS : 0;
    multiplayer.networkPingMs = null;
    multiplayer.networkPingSmoothedMs = null;
    multiplayer.networkPingMainThreadStallMs = null;
    multiplayer.networkPingTransport = '';
    renderNetworkPing(null, status);
  }

  function beginNetworkPingProbe(socket, requestId) {
    if (requestId !== multiplayer.networkPingRequestId
      || socket !== multiplayer.socket
      || !socket?.connected
      || !multiplayer.joined
      || document.hidden) {
      if (requestId === multiplayer.networkPingRequestId) {
        multiplayer.networkPingInFlight = false;
        multiplayer.networkPingElapsed = NETWORK_PING_INTERVAL_SECONDS;
      }
      return;
    }

    const startedAt = performance.now();
    const clientTime = Date.now();
    let schedulerExpectedAt = startedAt + NETWORK_PING_SCHEDULER_SAMPLE_MS;
    let maxSchedulerDelay = 0;
    let schedulerTimer = null;
    const sampleSchedulerDelay = () => {
      if (requestId !== multiplayer.networkPingRequestId) return;
      const now = performance.now();
      maxSchedulerDelay = Math.max(maxSchedulerDelay, now - schedulerExpectedAt);
      schedulerExpectedAt = now + NETWORK_PING_SCHEDULER_SAMPLE_MS;
      schedulerTimer = setTimeout(sampleSchedulerDelay, NETWORK_PING_SCHEDULER_SAMPLE_MS);
    };
    schedulerTimer = setTimeout(sampleSchedulerDelay, NETWORK_PING_SCHEDULER_SAMPLE_MS);

    multiplayer.networkPingTimeout = setTimeout(() => {
      if (requestId !== multiplayer.networkPingRequestId) return;
      if (schedulerTimer) clearTimeout(schedulerTimer);
      multiplayer.networkPingTimeout = null;
      resetNetworkPingMeasurement('timeout');
    }, NETWORK_PING_TIMEOUT_MS);

    socket.emit('networkPing', { clientTime }, ack => {
      if (requestId !== multiplayer.networkPingRequestId) return;
      if (schedulerTimer) clearTimeout(schedulerTimer);
      if (multiplayer.networkPingTimeout) clearTimeout(multiplayer.networkPingTimeout);
      multiplayer.networkPingTimeout = null;
      multiplayer.networkPingInFlight = false;
      if (!ack
        || ack.ok !== true
        || Number(ack.clientTime) !== clientTime
        || !Number.isFinite(Number(ack.serverTime))) {
        resetNetworkPingMeasurement('timeout');
        return;
      }
      const finishedAt = performance.now();
      const measuredPing = Math.min(9999, Math.max(0, finishedAt - startedAt));
      // This is deliberately diagnostic only. The displayed RTT keeps the full
      // application delay instead of hiding a slow frame or a congested client.
      const mainThreadStall = networkPingObservedMainThreadStallMs(
        measuredPing,
        finishedAt,
        schedulerExpectedAt,
        maxSchedulerDelay
      );
      const previousPing = multiplayer.networkPingSmoothedMs;
      const smoothedPing = previousPing !== null && Number.isFinite(Number(previousPing))
        ? Number(previousPing) * 0.68 + measuredPing * 0.32
        : measuredPing;
      multiplayer.networkPingMs = measuredPing;
      multiplayer.networkPingSmoothedMs = smoothedPing;
      multiplayer.networkPingMainThreadStallMs = mainThreadStall;
      multiplayer.networkPingTransport = currentNetworkPingTransport();
      renderNetworkPing(smoothedPing, 'online');
    });
  }

  function updateNetworkPing(dt) {
    const socket = multiplayer.socket;
    if (!socket || !socket.connected || !multiplayer.joined) {
      if (multiplayer.networkPingStatus !== 'offline') resetNetworkPingMeasurement('offline');
      return;
    }
    if (multiplayer.networkPingStatus === 'offline') resetNetworkPingMeasurement('waiting');
    multiplayer.networkPingElapsed += Math.max(0, Number(dt) || 0);
    if (multiplayer.networkPingInFlight || multiplayer.networkPingElapsed < NETWORK_PING_INTERVAL_SECONDS) return;

    multiplayer.networkPingElapsed = 0;
    multiplayer.networkPingInFlight = true;
    const requestId = Number(multiplayer.networkPingRequestId || 0) + 1;
    multiplayer.networkPingRequestId = requestId;
    // updateNetworkPing runs inside the render-frame update. Starting the clock
    // in a microtask keeps the rest of that same Ultra frame out of the probe.
    // Later client stalls remain part of the full application RTT and are
    // reported separately as diagnostic context.
    if (typeof queueMicrotask === 'function') queueMicrotask(() => beginNetworkPingProbe(socket, requestId));
    else setTimeout(() => beginNetworkPingProbe(socket, requestId), 0);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    const socket = multiplayer.socket;
    resetNetworkPingMeasurement(socket?.connected && multiplayer.joined ? 'waiting' : 'offline');
  });

  function applyServerLocalPositionAck(ack = {}) {
    const x = Number(ack.x);
    const z = Number(ack.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    player.x = x;
    player.z = z;
    player.attackTarget = null;
    if (playerGroup) playerGroup.position.set(player.x, player.y || 0, player.z);
    multiplayer.lastSentX = x;
    multiplayer.lastSentZ = z;
    return true;
  }

  function clientEquipmentIdForServerBase(slot, rawBaseId) {
    const baseId = typeof baseItemId === 'function' ? baseItemId(rawBaseId || '') : String(rawBaseId || '');
    if (!baseId) return slot === 'weapon' ? 'fists' : '';
    const current = equipment?.[slot] || '';
    if (current && (typeof baseItemId !== 'function' || baseItemId(current) === baseId)) return current;
    if (typeof inventory !== 'undefined' && inventory?.forEach) {
      let found = '';
      inventory.forEach((qty, itemId) => {
        if (found || Number(qty || 0) <= 0) return;
        if ((typeof baseItemId === 'function' ? baseItemId(itemId) : itemId) === baseId) found = itemId;
      });
      if (found) return found;
    }
    return baseId;
  }

  function applyServerAuthoritativePlayerState(snapshot = {}, options = {}) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (Number.isFinite(Number(snapshot.equipmentRevision))) {
      multiplayer.equipmentRevision = Math.max(0, Math.floor(Number(snapshot.equipmentRevision)));
    }
    if (snapshot.equipment && typeof snapshot.equipment === 'object') {
      ['weapon', 'offhand', 'armor', 'helmet', 'boots', 'backpack'].forEach(slot => {
        const fallback = slot === 'weapon' ? 'fists' : '';
        const serverBaseId = typeof baseItemId === 'function'
          ? baseItemId(snapshot.equipment[slot] || fallback)
          : String(snapshot.equipment[slot] || fallback);
        const runtimeId = String(snapshot.equipmentRuntime?.[slot] || '');
        if (runtimeId
          && (typeof baseItemId !== 'function' || baseItemId(runtimeId) === serverBaseId)) {
          if (!ITEMS[runtimeId] && typeof ensureSavedRuntimeItem === 'function') {
            ensureSavedRuntimeItem(runtimeId, { baseId: serverBaseId });
          }
          equipment[slot] = ITEMS[runtimeId]
            ? runtimeId
            : clientEquipmentIdForServerBase(slot, serverBaseId);
        } else {
          equipment[slot] = clientEquipmentIdForServerBase(slot, serverBaseId);
        }
      });
    }
    if (Array.isArray(snapshot.inventory) && typeof applyServerInventorySnapshot === 'function') {
      applyServerInventorySnapshot(snapshot.inventory);
    }
    if (Array.isArray(snapshot.weaponInventoryRuntime)) {
      const rows = snapshot.weaponInventoryRuntime.slice(0, 80);
      const weaponBases = new Set(rows.map(row => String(row?.baseId || '')).filter(Boolean));
      const equippedWeaponIds = new Set(['weapon', 'offhand'].map(slot => String(equipment?.[slot] || '')).filter(Boolean));
      const stableRuntimeIdsByBase = new Map();
      for (const [itemId, qty] of inventory.entries()) {
        if (equippedWeaponIds.has(itemId) || qty <= 0 || typeof isRuntimeItemId !== 'function' || !isRuntimeItemId(itemId)) continue;
        const baseId = typeof baseItemId === 'function' ? baseItemId(itemId) : itemId;
        if (!weaponBases.has(String(baseId))) continue;
        const ids = stableRuntimeIdsByBase.get(String(baseId)) || [];
        ids.push(itemId);
        stableRuntimeIdsByBase.set(String(baseId), ids);
      }
      for (const [itemId] of Array.from(inventory.entries())) {
        if (equippedWeaponIds.has(itemId)) continue;
        const baseId = typeof baseItemId === 'function' ? baseItemId(itemId) : itemId;
        if (weaponBases.has(String(baseId))) inventory.delete(itemId);
      }
      rows.forEach(row => {
        const rawId = String(row?.id || '');
        const baseId = String(row?.baseId || '');
        const qty = Math.max(0, Math.floor(Number(row?.qty || 0)));
        if (!rawId || !baseId || qty <= 0) return;
        const stableIds = rawId === baseId ? (stableRuntimeIdsByBase.get(baseId) || []).splice(0, qty) : [];
        const resolvedIds = stableIds.concat(Array.from({ length: Math.max(0, qty - stableIds.length) }, () => rawId));
        resolvedIds.forEach(resolvedId => {
          if (!ITEMS[resolvedId] && typeof ensureSavedRuntimeItem === 'function') {
            ensureSavedRuntimeItem(resolvedId, {
              baseId,
              loaded: Number(row.loaded || 0),
              condition: Number(row.condition || 100),
              weaponMods: row.weaponMods && typeof row.weaponMods === 'object' ? { ...row.weaponMods } : {}
            });
          }
          if (!ITEMS[resolvedId]) return;
          if (Number.isFinite(Number(row.loaded))) ITEMS[resolvedId].loaded = Math.max(0, Math.round(Number(row.loaded)));
          if (Number.isFinite(Number(row.condition))) ITEMS[resolvedId].condition = Math.max(1, Math.min(100, Number(row.condition)));
          if (row.weaponMods && typeof row.weaponMods === 'object') ITEMS[resolvedId].weaponMods = { ...row.weaponMods };
          if (typeof applyWeaponModificationStats === 'function') applyWeaponModificationStats(ITEMS[resolvedId]);
          inventory.set(resolvedId, Math.max(0, Number(inventory.get(resolvedId) || 0)) + 1);
        });
      });
      if (typeof normalizeUniqueEquipmentState === 'function') normalizeUniqueEquipmentState();
    }
    if (Array.isArray(snapshot.weaponModifications)) {
      snapshot.weaponModifications.slice(0, 80).forEach(row => {
        const runtimeId = String(row?.id || '');
        const baseId = String(row?.baseId || '');
        if (!runtimeId || !baseId) return;
        if (!ITEMS[runtimeId] && typeof ensureSavedRuntimeItem === 'function') ensureSavedRuntimeItem(runtimeId, { baseId });
        const item = ITEMS[runtimeId];
        if (!item) return;
        item.weaponMods = row.weaponMods && typeof row.weaponMods === 'object' ? { ...row.weaponMods } : {};
        if (typeof applyWeaponModificationStats === 'function') applyWeaponModificationStats(item);
      });
    }
    if (Array.isArray(snapshot.storage) && typeof applyServerStorageSnapshot === 'function') {
      applyServerStorageSnapshot(snapshot.storage);
    }
    if (snapshot.itemConditions && typeof applyServerItemConditions === 'function') {
      applyServerItemConditions(snapshot.itemConditions);
    }
    if (snapshot.combat && typeof applyServerCombatState === 'function') {
      applyServerCombatState(snapshot.combat);
    }
    if (Number.isFinite(Number(snapshot.hp))) player.hp = Math.max(0, Number(snapshot.hp));
    if (Number.isFinite(Number(snapshot.maxHp))) player.maxHp = Math.max(1, Number(snapshot.maxHp));
    if (Number.isFinite(Number(snapshot.ap))) player.ap = Math.max(0, Number(snapshot.ap));
    if (Number.isFinite(Number(snapshot.maxAp))) player.maxAp = Math.max(0, Number(snapshot.maxAp));
    if (Number.isFinite(Number(snapshot.xp))) player.xp = Math.max(0, Math.floor(Number(snapshot.xp)));
    if (Number.isFinite(Number(snapshot.xpNeeded))) player.xpNeeded = Math.max(1, Math.floor(Number(snapshot.xpNeeded)));
    if (Number.isFinite(Number(snapshot.level))) player.level = Math.max(1, Math.floor(Number(snapshot.level)));
    if (Number.isFinite(Number(snapshot.perkPoints))) player.perkPoints = Math.max(0, Math.floor(Number(snapshot.perkPoints)));
    if (Number.isFinite(Number(snapshot.skillPoints))) player.skillPoints = Math.max(0, Math.floor(Number(snapshot.skillPoints)));
    if (snapshot.injuries && typeof snapshot.injuries === 'object') player.injuries = { ...snapshot.injuries };
    if (characterProfile) {
      if (snapshot.name) characterProfile.name = String(snapshot.name).slice(0, 24);
      if (snapshot.special && typeof snapshot.special === 'object') characterProfile.special = { ...snapshot.special };
      if (Array.isArray(snapshot.traits)) characterProfile.traits = snapshot.traits.slice(0, 2);
      if (Array.isArray(snapshot.taggedSkills)) characterProfile.taggedSkills = snapshot.taggedSkills.slice(0, 2);
      if (snapshot.appearance && typeof snapshot.appearance === 'object') {
        characterProfile.appearance = typeof normalizeCharacterAppearance === 'function'
          ? normalizeCharacterAppearance(snapshot.appearance)
          : { ...snapshot.appearance };
        if (typeof applyCharacterGlbAppearance === 'function') {
          applyCharacterGlbAppearance(playerGroup, characterProfile.appearance, {
            castShadow: true,
            equipment
          });
        }
      }
      if (typeof snapshot.worldFactionId === 'string') {
        characterProfile.worldFactionId = snapshot.worldFactionId;
        characterProfile.factionId = snapshot.worldFactionId;
      }
      if (snapshot.worldFactionReputation && typeof snapshot.worldFactionReputation === 'object') {
        characterProfile.worldFactionReputation = { ...snapshot.worldFactionReputation };
      }
    }
    if (snapshot.skillRanks && typeof snapshot.skillRanks === 'object') {
      Object.keys(skillRanks).forEach(key => delete skillRanks[key]);
      Object.assign(skillRanks, snapshot.skillRanks);
    }
    if (snapshot.talentRanks && typeof snapshot.talentRanks === 'object') {
      Object.keys(talentRanks).forEach(key => delete talentRanks[key]);
      Object.assign(talentRanks, snapshot.talentRanks);
    }
    if (snapshot.npcQuests && typeof snapshot.npcQuests === 'object' && typeof npcQuestState === 'object') {
      Object.keys(npcQuestState).forEach(key => delete npcQuestState[key]);
      Object.assign(npcQuestState, snapshot.npcQuests);
      if (typeof normalizeNpcQuestState === 'function') normalizeNpcQuestState();
      if (typeof updateNpcQuestPanel === 'function') updateNpcQuestPanel();
    }
    if (Array.isArray(snapshot.worldTaskAccepted) && typeof applyWorldTaskAccepted === 'function') applyWorldTaskAccepted(snapshot.worldTaskAccepted);
    if (typeof snapshot.worldTaskTrackedId === 'string' && typeof applyWorldTaskTracked === 'function') applyWorldTaskTracked(snapshot.worldTaskTrackedId);
    if (Array.isArray(snapshot.worldTaskRewardClaims) && typeof applyWorldTaskRewardClaims === 'function') applyWorldTaskRewardClaims(snapshot.worldTaskRewardClaims);
    if (Array.isArray(snapshot.worldTaskRecords) && typeof applyServerWorldTaskRecords === 'function') applyServerWorldTaskRecords(snapshot.worldTaskRecords);
    if (snapshot.socialState && typeof applySocialStateSnapshot === 'function') applySocialStateSnapshot(snapshot.socialState);
    if (snapshot.globalMap && typeof applySavedGlobalMapState === 'function') {
      if (typeof globalMapState === 'object' && globalMapState) {
        globalMapState.attachedPartyId = String(snapshot.globalMap.attachedPartyId || '')
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 80);
        globalMapState.attachedPartyTaskId = String(snapshot.globalMap.attachedPartyTaskId || '')
          .replace(/[^a-zA-Z0-9_:-]/g, '')
          .slice(0, 120);
      }
      const shouldApplyGlobalMap = snapshot.onGlobalMap === true
        || (typeof globalMapState === 'object' && globalMapState?.onWorldMap && snapshot.onGlobalMap === false);
      if (shouldApplyGlobalMap) applySavedGlobalMapState(snapshot.globalMap);
    }
    const positionMode = String(options.positionMode || '');
    if (positionMode === 'transition' || positionMode === 'correction') {
      applyServerLocalPositionAck(snapshot);
    }
    if (typeof updatePlayerEquipmentVisuals === 'function') updatePlayerEquipmentVisuals();
    if (typeof renderInventory === 'function') renderInventory();
    if (typeof renderCharacterWindow === 'function') renderCharacterWindow();
    return true;
  }

  function applyServerInjuryPayload(data = {}) {
    if (data.injuries && typeof data.injuries === 'object') player.injuries = { ...data.injuries };
    const added = Array.isArray(data.newInjuries) ? data.newInjuries : [];
    added.forEach(id => {
      const label = typeof INJURY_LABELS === 'object' && INJURY_LABELS[id] ? INJURY_LABELS[id] : id;
      addLog(`Получена травма: ${label}.`, null, 'system');
    });
    if (typeof renderInjuryStatusPanels === 'function') renderInjuryStatusPanels();
  }

  function multiplayerSocketGenerationMatches(socket, generation) {
    return !!(
      socket
      && multiplayer.socket === socket
      && Number(multiplayer.socketGeneration || 0) === Number(generation || 0)
    );
  }

  function resetNetworkEnemyFrameSequence(data = {}) {
    multiplayer.lastEnemyFrameRoomId = String(data.roomId || multiplayer.roomId || data.locationId || '');
    multiplayer.lastEnemyFrameSeq = 0;
    multiplayer.lastEnemyFrameSnapshotT = Math.max(0, Number(data.t || 0));
  }

  function networkEnemyFrameIsFresh(data = {}) {
    if (!networkPayloadIsForCurrentRoom(data)) return false;
    const seq = Number(data.seq);
    if (!Number.isSafeInteger(seq) || seq <= 0) return false;
    const roomKey = String(data.roomId || multiplayer.roomId || data.locationId || '');
    if (roomKey !== String(multiplayer.lastEnemyFrameRoomId || '')) {
      multiplayer.lastEnemyFrameRoomId = roomKey;
      multiplayer.lastEnemyFrameSeq = 0;
      multiplayer.lastEnemyFrameSnapshotT = 0;
    }
    const t = Math.max(0, Number(data.t || 0));
    const fullSnapshotT = Math.max(0, Number(multiplayer.lastEnemyFrameSnapshotT || 0));
    if (t && fullSnapshotT && t <= fullSnapshotT) return false;
    if (seq <= Math.max(0, Number(multiplayer.lastEnemyFrameSeq || 0))) return false;
    const previousT = Math.max(0, Number(multiplayer.lastEnemySnapshotT || 0));
    if (t && previousT && t < previousT) return false;
    multiplayer.lastEnemyFrameSeq = seq;
    if (t) multiplayer.lastEnemySnapshotT = Math.max(previousT, t);
    return true;
  }

  function cancelMultiplayerJoinAttempt(reason = 'cancelled') {
    if (multiplayer.joinTimer) {
      clearTimeout(multiplayer.joinTimer);
      multiplayer.joinTimer = null;
    }
    const resolve = multiplayer.joinAttemptResolve;
    multiplayer.joinAttemptId = Number(multiplayer.joinAttemptId || 0) + 1;
    multiplayer.joinInFlight = false;
    multiplayer.joinPromise = null;
    multiplayer.joinAttemptResolve = null;
    multiplayer.joinSocketId = '';
    multiplayer.joinSessionToken = '';
    multiplayer.joinCharacterId = '';
    multiplayer.joinClientInstanceId = '';
    if (typeof resolve === 'function') {
      try { resolve(false); } catch (_) {}
    }
    return reason;
  }

  function joinMultiplayerRoom() {
    const socket = multiplayer.socket;
    const socketGeneration = Number(multiplayer.socketGeneration || 0);
    const joinContext = typeof currentMultiplayerJoinContext === 'function'
      ? currentMultiplayerJoinContext()
      : {
          sessionToken: String(serverSession.token || ''),
          characterId: String(selectedServerCharacterId || ''),
          clientInstanceId: String(getClientInstanceId() || '')
        };
    if (!socket || !socket.connected || !serverSession.token || !selectedServerCharacterId || !characterProfile) {
      resolveMultiplayerJoinWaiters(false);
      return Promise.resolve(false);
    }
    if (multiplayerJoinedContextMatchesCurrent(socket)) {
      multiplayer.transportState = 'joined';
      if (typeof setClientAuthorityMode === 'function') {
        setClientAuthorityMode('server', 'join-current-socket');
      }
      resolveMultiplayerJoinWaiters(true);
      return Promise.resolve(true);
    }
    if (multiplayer.joinInFlight
      && multiplayerJoinAttemptMatchesCurrent(socket)
      && multiplayer.joinPromise) {
      return multiplayer.joinPromise;
    }
    cancelMultiplayerJoinAttempt('superseded');
    const joinAttemptId = Number(multiplayer.joinAttemptId || 0) + 1;
    multiplayer.joinAttemptId = joinAttemptId;
    multiplayer.joinInFlight = true;
    multiplayer.joinSocketId = socket.id;
    multiplayer.joinSessionToken = joinContext.sessionToken;
    multiplayer.joinCharacterId = joinContext.characterId;
    multiplayer.joinClientInstanceId = joinContext.clientInstanceId;
    multiplayer.transportState = 'joining';
    const payload = {
      token: serverSession.token,
      deviceId: getDeviceId(),
      clientInstanceId: getClientInstanceId(),
      deviceType: getDeviceType(),
      controlType: getDeviceControlType(),
      enemyFrameVersion: 1,
      characterId: selectedServerCharacterId,
      locationId: currentLocation?.id || 'settlement',
      roomId: (currentLocation?.encounterOnly || currentLocation?.randomTemplate || globalMapState?.pendingEncounterRoomId)
        ? (globalMapState?.pendingEncounterRoomId || '')
        : '',
      encounterId: (currentLocation?.encounterOnly || currentLocation?.randomTemplate || globalMapState?.pendingEncounterId)
        ? (globalMapState?.pendingEncounterId || '')
        : '',
      worldZoneId: (currentLocation?.encounterOnly || currentLocation?.randomTemplate || globalMapState?.pendingEncounterWorldZoneId)
        ? (globalMapState?.pendingEncounterWorldZoneId || '')
        : '',
      partyId: (currentLocation?.encounterOnly || currentLocation?.randomTemplate || globalMapState?.pendingEncounterWorldPartyId)
        ? (globalMapState?.pendingEncounterWorldPartyId || '')
        : '',
      siteId: (currentLocation?.encounterOnly || currentLocation?.randomTemplate || globalMapState?.currentWorldSiteId)
        ? (globalMapState?.currentWorldSiteId || '')
        : '',
      worldPoint: (currentLocation?.encounterOnly || currentLocation?.randomTemplate)
        ? (globalMapState?.pendingEncounterWorldPoint || { x: globalMapState?.playerX || 0, y: globalMapState?.playerY || 0 })
        : null,
      pvpMode: currentLocation?.pvpMode || '',
      entryKey: multiplayer.pendingEntryKey || 'spawn',
      lastVisitedSettlementId: typeof rememberCurrentSettlementLocation === 'function' ? rememberCurrentSettlementLocation() : (characterProfile?.lastVisitedSettlementId || 'settlement'),
      name: characterProfile.name || serverSession.login || 'Игрок',
      x: player.x,
      z: player.z,
      angle: player.angle,
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
      weapon: multiplayerWeaponId(),
      equipment: multiplayerEquipmentSnapshot(),
      injuries: multiplayerInjurySnapshot()
    };
    let resolveJoinAttempt = null;
    let joinAttemptSettled = false;
    let joinTimer = null;
    const joinPromise = new Promise(resolve => { resolveJoinAttempt = resolve; });
    multiplayer.joinPromise = joinPromise;
    multiplayer.joinAttemptResolve = resolveJoinAttempt;
    const finishJoinAttempt = (ok, nextTransportState) => {
      if (joinAttemptSettled) return false;
      joinAttemptSettled = true;
      if (joinTimer) {
        clearTimeout(joinTimer);
        if (multiplayer.joinTimer === joinTimer) multiplayer.joinTimer = null;
        joinTimer = null;
      }
      const current = multiplayerSocketGenerationMatches(socket, socketGeneration)
        && Number(multiplayer.joinAttemptId || 0) === joinAttemptId;
      if (current) {
        multiplayer.joinInFlight = false;
        multiplayer.joinPromise = null;
        multiplayer.joinAttemptResolve = null;
        multiplayer.joinSocketId = '';
        multiplayer.joinSessionToken = '';
        multiplayer.joinCharacterId = '';
        multiplayer.joinClientInstanceId = '';
        multiplayer.transportState = nextTransportState;
      }
      try { resolveJoinAttempt(!!ok && current); } catch (_) {}
      return current;
    };
    joinTimer = setTimeout(() => {
      if (!finishJoinAttempt(false, socket.connected ? 'connected' : 'connecting')) return;
      clearMultiplayerJoinedContext();
      if (typeof setClientAuthorityMode === 'function') {
        setClientAuthorityMode('blocked', 'join-timeout', { force: true, clearWorld: true });
      }
      resolveMultiplayerJoinWaiters(false);
      setOnlineStatus('Сеть: сервер не подтвердил вход в игровую сессию');
      if (multiplayerSocketGenerationMatches(socket, socketGeneration)
        && typeof socket.disconnect === 'function'
        && typeof socket.connect === 'function') {
        try { socket.disconnect(); } catch (_) {}
        if (multiplayerSocketGenerationMatches(socket, socketGeneration)) {
          socket.auth = {
            token: serverSession.token,
            deviceId: getDeviceId(),
            clientInstanceId: getClientInstanceId(),
            deviceType: getDeviceType(),
            controlType: getDeviceControlType()
          };
          multiplayer.transportState = 'connecting';
          try { socket.connect(); } catch (_) {}
        }
      }
    }, 5000);
    multiplayer.joinTimer = joinTimer;
    socket.emit('join', payload, ack => {
      if (!multiplayerSocketGenerationMatches(socket, socketGeneration)
        || Number(multiplayer.joinAttemptId || 0) !== joinAttemptId
        || !multiplayerJoinContextIsCurrent(joinContext)) {
        finishJoinAttempt(false, 'blocked');
        return;
      }
      const ackTopLevelCharacterId = String(ack?.characterId || '');
      const ackSelfCharacterId = String(ack?.self?.characterId || '');
      const ackCharacterId = ackTopLevelCharacterId || ackSelfCharacterId || joinContext.characterId;
      const inconsistentAckCharacter = !!(
        ackTopLevelCharacterId
        && ackSelfCharacterId
        && ackTopLevelCharacterId !== ackSelfCharacterId
      );
      const characterWasRemapped = ackCharacterId !== joinContext.characterId;
      const unprovenCharacterRemap = characterWasRemapped && ackSelfCharacterId !== ackCharacterId;
      if (!ack || !ack.ok || !ackCharacterId || inconsistentAckCharacter || unprovenCharacterRemap) {
        finishJoinAttempt(false, 'blocked');
        const msg = ack?.error
          || (inconsistentAckCharacter || unprovenCharacterRemap
            ? 'Сервер вернул несогласованный идентификатор персонажа. Подключение остановлено.'
            : 'Сервер отклонил вход в сетевую игру.');
        setReadout(msg);
        setOnlineStatus(`Сеть: ${msg}`);
        activeCharacterLeaseId = '';
        multiplayer.characterLeaseId = '';
        clearMultiplayerJoinedContext();
        if (typeof setClientAuthorityMode === 'function') {
          setClientAuthorityMode('blocked', 'join-rejected', { force: true, clearWorld: true });
        }
        resetNetworkPingMeasurement('offline');
        try { socket.disconnect(); } catch (_) {}
        resolveMultiplayerJoinWaiters(false);
        return;
      }
      multiplayer.transportState = 'joined';
      resetNetworkPingMeasurement('waiting');
      multiplayer.roomId = ack.roomId || '';
      multiplayer.characterLeaseId = ack.characterLeaseId || '';
      activeCharacterLeaseId = multiplayer.characterLeaseId || activeCharacterLeaseId || '';
      if (characterWasRemapped && typeof remapMultiplayerPendingJoinContext === 'function') {
        remapMultiplayerPendingJoinContext(joinContext, ackCharacterId);
      }
      if (characterProfile) {
        setSelectedServerCharacterForSaveContext(ackCharacterId, { preserveMultiplayerJoin: true });
        characterProfile.serverCharacterId = selectedServerCharacterId;
        localStorage.setItem(SERVER_CHARACTER_KEY, selectedServerCharacterId);
      }
      multiplayer.joined = true;
      multiplayer.joinedSocketId = socket.id;
      multiplayer.joinedSessionToken = joinContext.sessionToken;
      multiplayer.joinedCharacterId = selectedServerCharacterId;
      multiplayer.joinedClientInstanceId = joinContext.clientInstanceId;
      multiplayer.onlineSessionRequired = true;
      if (ack.lastVisitedSettlementId && characterProfile) {
        characterProfile.lastVisitedSettlementId = typeof normalizeLastVisitedSettlementId === 'function'
          ? normalizeLastVisitedSettlementId(ack.lastVisitedSettlementId)
          : ack.lastVisitedSettlementId;
      }
      multiplayer.serverAuthoritativeEnemies = ack.serverAuthoritativeEnemies !== false;
      if (typeof setClientAuthorityMode === 'function') {
        setClientAuthorityMode('server', ack.alreadyJoined ? 'join-idempotent' : 'join-accepted');
      }
      finishJoinAttempt(true, 'joined');
      applyServerAuthoritativePlayerState(ack.self || ack, { positionMode: 'transition' });
      multiplayer.pendingEntryKey = '';
      resetNetworkSnapshotStamps();
      markStartupNetworkEvent('worldState');
      clearNetworkRoomEntities({ keepPlayer: true });
      (ack.players || []).forEach(p => upsertRemotePlayer(p, { source: 'join', forceSnap: true }));
      initWorldSyncFromServer(ack.worldState);
      resolveMultiplayerJoinWaiters(true);
      const locationLabel = currentLocation?.name || ack.locationId || 'Локация';
      setOnlineStatus(`Сеть: ${locationLabel} · игроков в локации: ${(ack.players || []).length + 1}`);
      addLog(`Вы вошли в общую локацию «${locationLabel}». Ограничения количества игроков нет.`, null, 'system');
    });
    return joinPromise;
  }

  function connectMultiplayer(options = {}) {
    const shouldWaitForJoin = !!(options && options.waitForJoin);
    if (!serverSession.token || !selectedServerCharacterId || !characterProfile) {
      resolveMultiplayerJoinWaiters(false);
      return shouldWaitForJoin ? Promise.resolve(false) : undefined;
    }
    if (!window.io) {
      setOnlineStatus('Сеть: socket.io не загрузился. Откройте игру через Node-сервер, не через отдельный HTML.');
      resolveMultiplayerJoinWaiters(false);
      return shouldWaitForJoin ? Promise.resolve(false) : undefined;
    }
    if (multiplayer.socket) {
      const socket = multiplayer.socket;
      const joinedContextConflict = multiplayer.joined
        && multiplayer.joinedSocketId === socket.id
        && !multiplayerJoinedContextMatchesCurrent(socket);
      const joiningContextConflict = multiplayer.joinInFlight
        && multiplayer.joinSocketId === socket.id
        && !multiplayerJoinAttemptMatchesCurrent(socket);
      if (joinedContextConflict || joiningContextConflict) {
        invalidateMultiplayerSessionContext('join-context-changed', {
          disconnect: true,
          clearWorld: !!gameStarted
        });
      }
    }
    const waitPromise = shouldWaitForJoin ? waitForMultiplayerJoin(options.timeoutMs || 4500) : null;
    if (multiplayer.socket) {
      const socket = multiplayer.socket;
      if (socket.connected) {
        multiplayer.connected = true;
        if (multiplayerJoinedContextMatchesCurrent(socket)) {
          multiplayer.transportState = 'joined';
          if (typeof setClientAuthorityMode === 'function') {
            setClientAuthorityMode('server', 'connect-current-socket');
          }
          resolveMultiplayerJoinWaiters(true);
        } else {
          joinMultiplayerRoom();
        }
      } else if (!socket.active && typeof socket.connect === 'function') {
        socket.auth = {
          token: serverSession.token,
          deviceId: getDeviceId(),
          clientInstanceId: getClientInstanceId(),
          deviceType: getDeviceType(),
          controlType: getDeviceControlType()
        };
        multiplayer.transportState = 'connecting';
        socket.connect();
      }
      return waitPromise || undefined;
    }
    const base = SERVER_API_BASE || location.origin;
    const socket = window.io(base, { transports: ['websocket', 'polling'], auth: { token: serverSession.token, deviceId: getDeviceId(), clientInstanceId: getClientInstanceId(), deviceType: getDeviceType(), controlType: getDeviceControlType() } });
    const socketGeneration = Number(multiplayer.socketGeneration || 0) + 1;
    multiplayer.socket = socket;
    multiplayer.socketGeneration = socketGeneration;
    multiplayer.transportState = 'connecting';
    socket.on('connect', () => {
      if (!multiplayerSocketGenerationMatches(socket, socketGeneration)) return;
      multiplayer.connected = true;
      multiplayer.transportState = 'connected';
      joinMultiplayerRoom();
    });
    socket.on('disconnect', () => {
      if (!multiplayerSocketGenerationMatches(socket, socketGeneration)) return;
      cancelMultiplayerJoinAttempt('disconnect');
      multiplayer.connected = false;
      clearMultiplayerJoinedContext();
      multiplayer.transportState = socket.active ? 'connecting' : 'blocked';
      multiplayer.serverAuthoritativeEnemies = false;
      if (multiplayer.pendingEquipmentSlots?.clear) multiplayer.pendingEquipmentSlots.clear();
      if (typeof setClientAuthorityMode === 'function') {
        setClientAuthorityMode('blocked', 'disconnect', { force: true, clearWorld: true });
      }
      resetNetworkPingMeasurement('offline');
      resolveMultiplayerJoinWaiters(false);
      setOnlineStatus('Сеть: отключено от сервера');
    });
    socket.on('connect_error', err => {
      if (!multiplayerSocketGenerationMatches(socket, socketGeneration)) return;
      cancelMultiplayerJoinAttempt('connect-error');
      multiplayer.connected = false;
      clearMultiplayerJoinedContext();
      multiplayer.transportState = 'connecting';
      if (typeof setClientAuthorityMode === 'function') {
        setClientAuthorityMode('blocked', 'connect-error', { force: true, clearWorld: true });
      }
      resetNetworkPingMeasurement('offline');
      resolveMultiplayerJoinWaiters(false);
      setOnlineStatus(`Сеть: ошибка подключения ${err?.message || ''}`.trim());
    });
    socket.on('sessionRejected', data => {
      if (!multiplayerSocketGenerationMatches(socket, socketGeneration)) return;
      cancelMultiplayerJoinAttempt('session-rejected');
      const msg = data?.error || 'Сессия отклонена сервером.';
      setReadout(msg);
      setOnlineStatus(`Сеть: ${msg}`);
      activeCharacterLeaseId = '';
      multiplayer.characterLeaseId = '';
      clearMultiplayerJoinedContext();
      multiplayer.transportState = 'blocked';
      if (typeof setClientAuthorityMode === 'function') {
        setClientAuthorityMode('blocked', 'session-rejected', { force: true, clearWorld: true });
      }
      resetNetworkPingMeasurement('offline');
      // v7.74.67: rejected duplicate tab must not keep a live socket that can
      // reconnect later and take over the character after the real tab closes.
      try { socket.disconnect(); } catch (_) {}
      resolveMultiplayerJoinWaiters(false);
    });
    multiplayer.socket.on('playerJoined', data => upsertRemotePlayer(data, { source: 'join', forceSnap: true }));
    multiplayer.socket.on('playerLeft', data => removeRemotePlayerFromNetworkEvent(data));
    multiplayer.socket.on('playerState', data => {
      if (!networkPayloadIsForCurrentRoom(data || {})) return;
      const p = data?.player || data;
      if (!p || !p.id || p.id === multiplayer.socket?.id) return;
      upsertRemotePlayer(p, { source: 'state', receivedAt: performance.now(), serverT: data?.t || 0 });
    });
    multiplayer.socket.on('playerRespawned', data => {
      if (!data) return;
      const myId = multiplayer.socket?.id || '';
      if (data.id === myId) return;
      const sameRoom = data.roomId && multiplayer.roomId && data.roomId === multiplayer.roomId;
      if (data.player && sameRoom) upsertRemotePlayer(data.player, { source: 'respawn', forceSnap: true });
      else removeRemotePlayerFromNetworkEvent(data);
    });
    multiplayer.socket.on('snapshot', data => {
      if (!networkSnapshotIsFresh(data || {}, 'lastPlayerSnapshotT')) return;
      const list = data?.players || [];
      const liveIds = new Set();
      list.forEach(p => {
        if (!p || p.id === multiplayer.socket.id) return;
        // Snapshot от сервера является полным списком текущей комнаты.
        // Если игрок умер/сменил локацию, старую модель нужно убрать, а не ждать следующего playerLeft.
        if (p.dead || Number(p.hp ?? 1) <= 0) {
          removeRemotePlayerFromNetworkEvent(p);
          return;
        }
        if (p.locationId && currentLocation && p.locationId !== currentLocation.id) {
          removeRemotePlayerFromNetworkEvent(p);
          return;
        }
        if (p.characterId) removeRemotePlayersByCharacterId(p.characterId, p.id);
        liveIds.add(p.id);
        upsertRemotePlayer(p, { source: 'snapshot' });
      });
      [...multiplayer.remotePlayers.keys()].forEach(id => { if (!liveIds.has(id)) removeRemotePlayer(id); });
    });
    multiplayer.socket.on('worldState', data => { markStartupNetworkEvent('worldState'); applyNetworkWorldState(data?.state || data, data?.reason || 'update'); });
    multiplayer.socket.on('resourceUpdated', data => {
      markStartupNetworkEvent('worldState');
      if (!networkPayloadIsForCurrentRoom(data) || !data.resource) return;
      applyNetworkResources([data.resource], null);
      if (typeof refreshNetworkFogVisibilityNow === 'function') refreshNetworkFogVisibilityNow();
    });
    multiplayer.socket.on('enemySnapshot', data => {
      markStartupNetworkEvent('enemySnapshot');
      if (!networkSnapshotIsFresh(data || {}, 'lastEnemySnapshotT')) return;
      resetNetworkEnemyFrameSequence(data || {});
      multiplayer.serverAuthoritativeEnemies = true;
      applyNetworkEnemies(data.enemies || [], { allowPositionSync: true, fromServer: true, pruneMissing: true });
    });
    multiplayer.socket.on('enemyFrame', data => {
      if (!networkEnemyFrameIsFresh(data || {})) return;
      multiplayer.serverAuthoritativeEnemies = true;
      applyNetworkEnemyFrame(data.enemies || []);
    });
    multiplayer.socket.on('groundItemsSnapshot', data => {
      markStartupNetworkEvent('groundItemsSnapshot');
      if (!networkSnapshotIsFresh(data || {}, 'lastGroundItemsSnapshotT')) return;
      applyNetworkGroundItems(data.items || []);
    });
    multiplayer.socket.on('groundItemDropped', data => {
      if (!networkPayloadIsForCurrentRoom(data) || !data.item) return;
      upsertGroundItem(data.item);
    });
    multiplayer.socket.on('groundItemPicked', data => {
      if (!networkPayloadIsForCurrentRoom(data)) return;
      removeGroundItemVisual(data.id || data.item?.id);
    });
    multiplayer.socket.on('worldContainersSnapshot', data => {
      markStartupNetworkEvent('worldContainersSnapshot');
      if (!networkSnapshotIsFresh(data || {}, 'lastWorldContainersSnapshotT')) return;
      applyNetworkWorldContainers(data.containers || []);
    });
    multiplayer.socket.on('worldContainerUpdated', data => {
      if (!networkPayloadIsForCurrentRoom(data) || !data.container) return;
      upsertWorldContainer(data.container);
      if (activeWorldContainer && activeWorldContainer.id === data.container.id) {
        activeWorldContainer = multiplayer.worldContainers.get(data.container.id) || data.container;
        renderLootWindow();
      }
    });
    multiplayer.socket.on('melee', data => {
      if (!data || data.shooterId === multiplayer.socket.id) return;
      const row = multiplayer.remotePlayers.get(data.shooterId);
      if (!row || !row.group) return;
      if (data.equipment) {
        row.data = { ...row.data, weapon: data.weapon || row.data.weapon, equipment: data.equipment };
        updateRemoteEquipmentVisuals(row.group, row.data);
      }
      triggerMeleeAttackVisual(row.group, data.weapon || row.data?.equipment?.weapon || row.data?.weapon || 'fists', {
        targetX: data.targetX,
        targetZ: data.targetZ
      });
    });
    multiplayer.socket.on('playerReloaded', data => {
      if (!data || data.shooterId === multiplayer.socket.id) return;
      if (data.roomId && !networkPayloadIsForCurrentRoom(data)) return;
      const row = multiplayer.remotePlayers.get(data.shooterId);
      if (!row?.group) return;
      triggerCharacterReloadVisual(row.group, data.weapon || row.data?.equipment?.weapon || row.data?.weapon || 'pistol');
    });
    multiplayer.socket.on('enemyMelee', data => {
      if (!data || data.locationId !== (currentLocation?.id || 'settlement')) return;
      const attacker = enemies.find(e => e && e.id === data.enemyId);
      if (!attacker || !attacker.mesh) return;
      if (data.equipment || data.weapon) {
        attacker.equipment = enemyEquipmentFromData(data);
        attacker.weapon = attacker.equipment.weapon;
        updateEnemyEquipmentVisuals(attacker);
      }
      triggerMeleeAttackVisual(attacker.mesh, data.weapon || attacker.equipment?.weapon || attacker.weapon || 'fists', {
        targetX: data.targetX,
        targetZ: data.targetZ,
        attackToken: data.t || 0
      });
    });
    multiplayer.socket.on('enemyAttackMiss', data => {
      if (!data || data.locationId !== (currentLocation?.id || 'settlement')) return;
      createFloatingText(player.x, player.z, 'Промах', '#d8d2b5');
      addLog(`${data.enemyName || 'Противник'} промахивается.`, null, 'combat');
    });
    multiplayer.socket.on('enemyAttack', data => {
      if (!data || data.locationId !== (currentLocation?.id || 'settlement')) return;
      const attacker = enemies.find(e => e && e.id === data.enemyId);
      if (attacker && (data.equipment || data.weapon)) {
        attacker.equipment = enemyEquipmentFromData(data);
        attacker.weapon = attacker.equipment.weapon;
        updateEnemyEquipmentVisuals(attacker);
      }
      if (Number.isFinite(Number(data.maxHp))) player.maxHp = Number(data.maxHp);
      if (Number.isFinite(Number(data.hp))) player.hp = Math.max(0, Number(data.hp));
      applyServerInjuryPayload(data);
      player.invincible = Math.max(player.invincible || 0, 0.18);
      triggerCharacterHitReaction(playerGroup, Number(data.damage || 0) % 2 ? -1 : 1);
      createFloatingText(player.x, player.z, '-' + Math.max(0, Number(data.damage || 0)), '#ff5b4a');
      const absorbedText = Number(data.absorbed || 0) > 0 ? `, броня поглотила ${Math.max(0, Number(data.absorbed || 0))}` : '';
      addLog(`${data.enemyName || 'Монстр'} атакует (${damageTypeLabel(data.damageType || 'ballistic')}): -${Math.max(0, Number(data.damage || 0))} HP${absorbedText}.`, null, 'combat');
      if (data.secondChance) {
        createFloatingText(player.x, player.z, '1 HP', '#ffe28a');
        addLog('⟲ Второй шанс: смертельный удар оставил вас на ногах.', null, 'level');
      }
      renderUI();
    });
    multiplayer.socket.on('playerStatusEffect', data => {
      if (!data || data.effect !== 'infection') return;
      if (Number.isFinite(Number(data.maxHp))) player.maxHp = Math.max(1, Number(data.maxHp));
      if (Number.isFinite(Number(data.hp))) player.hp = Math.max(0, Number(data.hp));
      applyServerInjuryPayload(data);
      if (Number(data.damage || 0) > 0) {
        createFloatingText(player.x, player.z, '-' + Number(data.damage), '#9fcf72');
        addLog('Инфекция: -1 HP. Нужны антибиотики.', null, 'combat');
      }
      renderUI();
    });
    multiplayer.socket.on('playerDamaged', data => {
      if (!data) return;
      if (data.playerId === multiplayer.socket.id) {
        if (Number.isFinite(Number(data.maxHp))) player.maxHp = Number(data.maxHp);
        if (Number.isFinite(Number(data.hp))) player.hp = Math.max(0, Number(data.hp));
        applyServerInjuryPayload(data);
        player.invincible = Math.max(player.invincible || 0, 0.22);
        triggerCharacterHitReaction(playerGroup, Number(data.damage || 0) % 2 ? -1 : 1);
        const critical = data.critical === true;
        const criticalHits = Math.max(1, Math.round(Number(data.criticalHits || 1)));
        const damageText = critical
          ? `КРИТ${criticalHits > 1 ? ` ×${criticalHits}` : ''}! -${Math.max(0, Number(data.damage || 0))}`
          : '-' + Math.max(0, Number(data.damage || 0));
        createFloatingText(player.x, player.z, data.secondChance ? '1 HP' : damageText, data.secondChance || critical ? '#ffe28a' : '#ff5b4a');
        const absorbedText = Number(data.absorbed || 0) > 0 ? `, броня поглотила ${Math.max(0, Number(data.absorbed || 0))}` : '';
        const criticalText = critical ? `КРИТИЧЕСКИЙ ВЫСТРЕЛ${criticalHits > 1 ? ` ×${criticalHits}` : ''}! ` : '';
        addLog(`${criticalText}${data.attackerName || 'Игрок'} атакует (${damageTypeLabel(data.damageType || 'ballistic')}): -${Math.max(0, Number(data.damage || 0))} HP${absorbedText}.`, null, 'combat');
        if (data.secondChance) addLog('⟲ Второй шанс: смертельный удар оставил вас на ногах.', null, 'level');
        renderUI();
        queueSave(true);
        return;
      }
      const row = multiplayer.remotePlayers.get(data.playerId);
      if (row) {
        row.data = { ...row.data, hp: Number(data.hp || 0), maxHp: Number(data.maxHp || row.data.maxHp || 100) };
        triggerCharacterHitReaction(row.group, Number(data.damage || 0) % 2 ? -1 : 1);
        const x = row.group?.position?.x ?? Number(row.data.x || 0);
        const z = row.group?.position?.z ?? Number(row.data.z || 0);
        const critical = data.critical === true;
        const criticalHits = Math.max(1, Math.round(Number(data.criticalHits || 1)));
        const damageText = critical
          ? `КРИТ${criticalHits > 1 ? ` ×${criticalHits}` : ''}! -${Math.max(0, Number(data.damage || 0))}`
          : '-' + Math.max(0, Number(data.damage || 0));
        createFloatingText(x, z, damageText, critical ? '#ffd166' : '#ff5b4a');
      }
      if (Number(data.hp || 0) <= 0) {
        removeRemotePlayerFromNetworkEvent({ id: data.playerId, characterId: data.characterId });
      }
    });
    multiplayer.socket.on('playerHealed', data => {
      if (!data || !networkPayloadIsForCurrentRoom(data)) return;
      if (data.targetId === multiplayer.socket.id) {
        if (Number.isFinite(Number(data.maxHp))) player.maxHp = Number(data.maxHp);
        if (Number.isFinite(Number(data.hp))) player.hp = Math.max(0, Number(data.hp));
        if (data.injuries && typeof data.injuries === 'object') player.injuries = { ...data.injuries };
        if (data.medicalFailed) {
          createFloatingText(player.x, player.z, 'неудача', '#ffbf69');
          addLog(`${data.healerName || 'Игрок'} пытается лечить вас, но лечение не удалось.`, null, 'system');
        } else if (data.curedInjury) {
          const curedName = INJURY_LABELS[data.curedInjury] || 'травма';
          createFloatingText(player.x, player.z, data.itemId === 'antibiotics' ? 'антибиотик' : 'леч.', '#7ce67a');
          addLog(`${data.healerName || 'Игрок'} лечит вас: ${curedName}.`, null, 'system');
        } else {
          createFloatingText(player.x, player.z, '+' + Math.max(0, Number(data.healed || 0)), '#7ce67a');
          addLog(`${data.healerName || 'Игрок'} лечит вас: +${Math.max(0, Number(data.healed || 0))} HP.`, null, 'system');
        }
        renderUI();
        queueSave(true);
        return;
      }
      const row = multiplayer.remotePlayers.get(data.targetId);
      if (row) {
        row.data = {
          ...row.data,
          hp: Number(data.hp || 0),
          maxHp: Number(data.maxHp || row.data.maxHp || 100),
          injuries: data.injuries || row.data.injuries || {}
        };
        const x = row.group?.position?.x ?? Number(row.data.x || 0);
        const z = row.group?.position?.z ?? Number(row.data.z || 0);
        if (data.medicalFailed) createFloatingText(x, z, 'неудача', '#ffbf69');
        else if (data.curedInjury) createFloatingText(x, z, data.itemId === 'antibiotics' ? 'антибиотик' : 'леч.', '#7ce67a');
        else createFloatingText(x, z, '+' + Math.max(0, Number(data.healed || 0)), '#7ce67a');
      }
    });
    multiplayer.socket.on('socialActionReceived', data => {
      if (!data || !networkPayloadIsForCurrentRoom(data)) return;
      const labels = {
        trade: 'предлагает торговлю',
        friend: 'отправляет заявку в друзья',
        clan: 'приглашает в клан'
      };
      const action = labels[data.action] || 'отправляет запрос';
      const fromName = data.fromName || 'Игрок';
      addLog(`${fromName} ${action}.`, null, 'system');
      setReadout(`${fromName} ${action}.`);
      if (typeof registerIncomingSocialAction === 'function') registerIncomingSocialAction(data);
    });
    multiplayer.socket.on('socialStateUpdated', data => {
      if (data?.socialState && typeof applySocialStateSnapshot === 'function') applySocialStateSnapshot(data.socialState);
      if (data?.message) addLog(data.message, null, 'system');
      if (typeof renderPipboyInfoPanels === 'function') renderPipboyInfoPanels();
    });
    multiplayer.socket.on('globalTravelStarted', data => {
      if (typeof handleGlobalTravelStarted === 'function') handleGlobalTravelStarted(data || {});
    });
    multiplayer.socket.on('globalTravelEnteredWorld', data => {
      if (typeof handleGlobalTravelEnteredWorld === 'function') handleGlobalTravelEnteredWorld(data || {});
    });
    multiplayer.socket.on('globalTravelEncounterDecision', data => {
      if (typeof handleGlobalTravelEncounterDecision === 'function') handleGlobalTravelEncounterDecision(data || {});
    });
    multiplayer.socket.on('globalTravelCancelled', data => {
      if (typeof handleGlobalTravelCancelled === 'function') handleGlobalTravelCancelled(data || {});
    });
    multiplayer.socket.on('globalTravelArrived', data => {
      if (typeof handleGlobalTravelArrived === 'function') handleGlobalTravelArrived(data || {});
    });
    multiplayer.socket.on('encounterFactionHostile', data => {
      if (!data || !networkPayloadIsForCurrentRoom(data)) return;
      if (Array.isArray(data.enemies)) applyNetworkEnemies(data.enemies, { allowPositionSync: true, fromServer: true, pruneMissing: false });
      const factionName = typeof globalMapFactionLabel === 'function'
        ? globalMapFactionLabel(data.faction || '')
        : 'враждебная группа';
      addLog(`${data.targetName || 'Игрок'} спровоцировал группу: ${factionName}.`, null, 'combat');
      updateTargetHintFromHover();
    });
    multiplayer.socket.on('enemyTradeUpdated', data => {
      if (!data || !networkPayloadIsForCurrentRoom(data) || !data.enemy) return;
      applyNetworkEnemies([data.enemy], { allowPositionSync: false, fromServer: true, pruneMissing: false });
      const updatedEnemy = enemies.find(e => e.id === data.enemyId);
      if (updatedEnemy && typeof applyServerTraderMarketUpdate === 'function') applyServerTraderMarketUpdate(updatedEnemy);
      if (traderWindowOpen && activeTraderActor && activeTraderActor.id === data.enemyId) renderTraderWindow();
    });
    multiplayer.socket.on('authoritativePlayerState', data => {
      const reason = String(data?.reason || '');
      const positionMode = reason === 'movementCorrection' ? 'correction' : 'preserve';
      if (positionMode === 'correction' && !networkPayloadIsForCurrentRoom(data || {})) return;
      applyServerAuthoritativePlayerState(data || {}, { positionMode });
    });
    multiplayer.socket.on('tradeMachineMarketUpdated', data => {
      if (typeof handleTradeMachineMarketUpdated === 'function') handleTradeMachineMarketUpdated(data || {});
    });
    multiplayer.socket.on('enemyKilled', data => {
      if (!data || !data.enemyId) return;
      const enemy = enemies.find(e => e.id === data.enemyId);
      if (enemy && !enemy.dead) makeCorpse(enemy);
      if (data.killerId === multiplayer.socket.id) {
        const xp = Math.max(0, Number(data.xp || 0));
        if (xp > 0) {
          const killedName = data.name || enemy?.name || 'Монстр';
          createFloatingText(Number(data.x || enemy?.x || player.x), Number(data.z || enemy?.z || player.z), '+' + xp + ' XP', '#e4c56b');
          addLog(`☠ ${killedName} повержен. +${xp} XP. Можно обыскать тело.`, null, 'loot');
          if (isMobileControlsEnabled()) setReadout(`☠ ${killedName}: тело можно обыскать.`);
        }
      }
    });
    function applyServerRespawnState(data = {}) {
      if (!data || !data.ok) return false;
      closeLootWindow();
      closeTraderWindow();
      closeStorageWindow();
      closeAllWindows();
      if (data.cause && data.cause.fullDrop && typeof applyPvpFullDropInventory === 'function') {
        applyPvpFullDropInventory(data.cause.droppedItems || []);
      } else if (data.cause && data.cause.pvp && data.cause.consumableDrop && typeof applyPvpConsumableDropInventory === 'function') {
        applyPvpConsumableDropInventory(data.cause.droppedItems || []);
      }
      clearNetworkRoomEntities({ keepPlayer: true });
      resetNetworkSnapshotStamps();
      multiplayer.roomId = data.roomId || multiplayer.roomId;
      currentLocation = LOCATIONS[data.locationId] || LOCATIONS.settlement;
      if (characterProfile) {
        characterProfile.lastVisitedSettlementId = typeof normalizeLastVisitedSettlementId === 'function'
          ? normalizeLastVisitedSettlementId(data.lastVisitedSettlementId || currentLocation.id)
          : (data.lastVisitedSettlementId || currentLocation.id || 'settlement');
      }
      buildWorld();
      player.hp = Math.max(1, Number(data.hp || Math.ceil(player.maxHp * 0.55)));
      if (Number.isFinite(Number(data.maxHp))) player.maxHp = Number(data.maxHp);
      player.x = Number.isFinite(Number(data.x)) ? Number(data.x) : tileToWorld(currentLocation.spawn.tx, currentLocation.spawn.tz).x;
      player.z = Number.isFinite(Number(data.z)) ? Number(data.z) : tileToWorld(currentLocation.spawn.tx, currentLocation.spawn.tz).z;
      player.y = 0;
      setPlayerCrouching(false, false);
      player.attackTarget = null;
      player.invincible = 1.5;
      if (typeof stopAutoFire === 'function') stopAutoFire();
      if (typeof stopTouchAim === 'function') stopTouchAim();
      if (typeof virtualMove === 'object' && virtualMove) {
        virtualMove.active = false;
        virtualMove.forward = 0;
        virtualMove.right = 0;
        virtualMove.pointerId = null;
      }
      playerGroup.position.set(player.x, 0, player.z);
      playerGroup.rotation.y = player.angle + Math.PI;
      playerGroup.updateMatrixWorld(true);
      if (data.worldState) initWorldSyncFromServer(data.worldState);
      clearRemotePlayers();
      (data.players || []).forEach(p => upsertRemotePlayer(p, { source: 'respawn', forceSnap: true }));
      multiplayer.serverAuthoritativeEnemies = data.serverAuthoritativeEnemies !== false;
      const title = document.getElementById('map-title');
      if (title) title.textContent = currentLocation.name;
      if (data.cause && data.cause.pvp) {
        addLog(`☠ Вас победил ${data.cause.killerName || 'игрок'}. Вы очнулись в поселении.`, null, 'combat');
        setReadout(data.cause.fullDrop
          ? 'Вы погибли в PvP-зоне. Рюкзак выпал на месте смерти.'
          : (data.cause.consumableDrop
            ? 'Вы погибли в PvP-зоне. Часть расходников выпала, экипировка при вас.'
            : 'Вы погибли в PvP-зоне и очнулись в поселении.'));
      } else if (data.cause && data.cause.fullDrop) {
        addLog(`☠ ${data.cause.enemyName || 'Тварь'} одолел вас в зоне полного лута. Рюкзак остался на месте гибели.`, null, 'combat');
        setReadout('Вы погибли в зоне полного лута. Рюкзак выпал на месте смерти.');
      } else {
        addLog('☠ Вы потеряли сознание и очнулись в поселении.', null, 'combat');
        setReadout('Вы очнулись в поселении.');
      }
      if (typeof rebuildRtsFogOfWar === 'function') {
        try { rebuildRtsFogOfWar(); } catch (_) {}
      }
      if (typeof updateVisionShade === 'function') {
        try { updateVisionShade(); } catch (_) {}
      }
      if (typeof refreshNetworkFogVisibilityNow === 'function') {
        try { refreshNetworkFogVisibilityNow(); } catch (_) {}
      }
      if (typeof requestDynamicShadowRefresh === 'function') requestDynamicShadowRefresh();
      if (typeof forceCameraViewportSync === 'function') {
        try { forceCameraViewportSync('server-respawn-apply'); } catch (_) {}
      } else if (typeof updateCamera === 'function') {
        try { updateCamera(0); } catch (_) {}
      }
      drawMinimap();
      renderUI();
      queueSave(true);
      return true;
    }

    async function handleServerRespawn(data = {}) {
      if (!data || !data.ok) return false;
      const targetLocation = LOCATIONS[data.locationId] || LOCATIONS.settlement;
      const subtitle = currentLocation && currentLocation.id !== targetLocation.id
        ? `Возрождение: ${currentLocation.name} → ${targetLocation.name}`
        : `Возрождение: ${targetLocation.name}`;
      const canUseTransition = typeof runLocationTransition === 'function' && !locationTransitionActive;
      if (!canUseTransition) {
        const ok = applyServerRespawnState(data);
        if (ok && typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('server-respawn-fallback');
        return ok;
      }
      const ok = await runLocationTransition(targetLocation, () => applyServerRespawnState(data), { subtitle });
      if (ok) {
        if (typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('server-respawn-ready');
        if (typeof renderStartupRevealFrame === 'function') {
          try { renderStartupRevealFrame('server-respawn-ready'); } catch (_) {}
        }
      }
      return ok;
    }

    function applyServerWorldTransferState(data = {}) {
      if (!data || !data.ok) return false;
      closeLootWindow();
      closeTraderWindow();
      closeStorageWindow();
      closeAllWindows();
      if (typeof closeGlobalMapMiniGame === 'function') {
        try { closeGlobalMapMiniGame({ clearPendingDrop: true, keepEncounterState: true }); } catch (_) {}
      }
      if (typeof globalMapState !== 'undefined' && globalMapState && typeof globalMapState === 'object') {
        globalMapState.pendingEncounterId = data.encounterId || '';
        globalMapState.pendingEncounterRoomId = data.encounterRoomId || data.roomId || '';
        globalMapState.pendingEncounterWorldZoneId = String(data.worldZoneId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
        globalMapState.pendingEncounterWorldPartyId = String(data.partyId || data.worldPartyId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
        globalMapState.currentWorldSiteId = String(data.siteId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
        globalMapState.pendingEncounterWorldPoint = data.worldPoint || null;
        if (data.worldPoint) {
          globalMapState.playerX = Number(data.worldPoint.x || globalMapState.playerX || 0);
          globalMapState.playerY = Number(data.worldPoint.y || globalMapState.playerY || 0);
        }
        const completedWorldTaskId = String(data.completedWorldTaskId || '').trim();
        if (completedWorldTaskId && completedWorldTaskId === String(globalMapState.attachedPartyTaskId || '').trim()) {
          if (typeof clearGlobalMapWorldPartyAttachmentLocal === 'function') {
            clearGlobalMapWorldPartyAttachmentLocal(data.worldPoint, { save: false });
          } else {
            globalMapState.attachedPartyId = '';
            globalMapState.attachedPartyTaskId = '';
          }
        }
      }
      clearNetworkRoomEntities({ keepPlayer: true });
      resetNetworkSnapshotStamps();
      multiplayer.roomId = data.roomId || multiplayer.roomId;
      multiplayer.joined = true;
      currentLocation = LOCATIONS[data.locationId] || LOCATIONS.settlement;
      if (data.lastVisitedSettlementId && characterProfile) {
        characterProfile.lastVisitedSettlementId = typeof normalizeLastVisitedSettlementId === 'function'
          ? normalizeLastVisitedSettlementId(data.lastVisitedSettlementId)
          : data.lastVisitedSettlementId;
      }
      buildWorld();
      if (Number.isFinite(Number(data.maxHp))) player.maxHp = Number(data.maxHp);
      if (Number.isFinite(Number(data.hp))) player.hp = Math.max(1, Number(data.hp));
      const fallbackSpawn = currentLocation.spawn || { tx: 19, tz: 19 };
      const fallback = tileToWorld(fallbackSpawn.tx, fallbackSpawn.tz);
      player.x = Number.isFinite(Number(data.x)) ? Number(data.x) : fallback.x;
      player.z = Number.isFinite(Number(data.z)) ? Number(data.z) : fallback.z;
      player.y = 0;
      player.angle = Number.isFinite(Number(data.angle)) ? Number(data.angle) : player.angle;
      setPlayerCrouching(false, false);
      player.attackTarget = null;
      player.invincible = Math.max(Number(player.invincible || 0), 1);
      if (typeof stopAutoFire === 'function') stopAutoFire();
      if (typeof stopTouchAim === 'function') stopTouchAim();
      if (typeof virtualMove === 'object' && virtualMove) {
        virtualMove.active = false;
        virtualMove.forward = 0;
        virtualMove.right = 0;
        virtualMove.pointerId = null;
      }
      playerGroup.position.set(player.x, 0, player.z);
      playerGroup.rotation.y = player.angle + Math.PI;
      playerGroup.updateMatrixWorld(true);
      clearRemotePlayers();
      (data.players || []).forEach(p => upsertRemotePlayer(p, { source: 'world-transfer', forceSnap: true }));
      if (data.worldState) initWorldSyncFromServer(data.worldState);
      if (data.sim && typeof applyWastelandSimState === 'function') {
        try {
          const sim = data.completedWorldTask && data.completedWorldTaskId
            ? {
              ...data.sim,
              worldTasks: [
                data.completedWorldTask,
                ...(Array.isArray(data.sim.worldTasks) ? data.sim.worldTasks.filter(row => String(row?.id || '') !== String(data.completedWorldTaskId || '')) : [])
              ]
            }
            : data.sim;
          applyWastelandSimState(sim);
        } catch (_) {}
      }
      multiplayer.serverAuthoritativeEnemies = data.serverAuthoritativeEnemies !== false;
      const title = document.getElementById('map-title');
      if (title) title.textContent = currentLocation.name;
      const message = data.message || (data.reason === 'caravanBattle'
        ? 'Караван втянут в бой.'
        : data.reason === 'caravanArrived'
          ? 'Караван прибыл.'
          : `Переход: ${currentLocation.name}.`);
      addLog(message, null, data.reason === 'caravanBattle' ? 'combat' : 'system');
      setReadout(message);
      if (data.completedWorldTaskId && typeof claimWorldTaskReward === 'function') {
        try { claimWorldTaskReward(data.completedWorldTaskId); } catch (_) {}
      }
      if (typeof rebuildRtsFogOfWar === 'function') {
        try { rebuildRtsFogOfWar(); } catch (_) {}
      }
      if (typeof updateVisionShade === 'function') {
        try { updateVisionShade(); } catch (_) {}
      }
      if (typeof refreshNetworkFogVisibilityNow === 'function') {
        try { refreshNetworkFogVisibilityNow(); } catch (_) {}
      }
      if (typeof requestDynamicShadowRefresh === 'function') requestDynamicShadowRefresh();
      if (typeof forceCameraViewportSync === 'function') {
        try { forceCameraViewportSync('server-world-transfer'); } catch (_) {}
      } else if (typeof updateCamera === 'function') {
        try { updateCamera(0); } catch (_) {}
      }
      drawMinimap();
      renderUI();
      queueSave(true);
      return true;
    }

    async function handleServerWorldTransfer(data = {}) {
      if (!data || !data.ok) return false;
      const targetLocation = LOCATIONS[data.locationId] || LOCATIONS.settlement;
      const subtitle = data.reason === 'caravanBattle'
        ? `Стычка: ${targetLocation.name}`
        : data.reason === 'caravanArrived'
          ? `Прибытие: ${targetLocation.name}`
          : `Переход: ${targetLocation.name}`;
      const canUseTransition = typeof runLocationTransition === 'function' && !locationTransitionActive;
      if (!canUseTransition) {
        const ok = applyServerWorldTransferState(data);
        if (ok && typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('server-world-transfer-fallback');
        return ok;
      }
      const ok = await runLocationTransition(targetLocation, () => applyServerWorldTransferState(data), { subtitle });
      if (ok && typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('server-world-transfer-ready');
      return ok;
    }

    multiplayer.socket.on('serverWorldTransfer', data => {
      if (!data || !data.ok) return;
      handleServerWorldTransfer(data).then(ok => {
        if (!ok) {
          applyServerWorldTransferState(data);
          if (typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('server-world-transfer-recover');
        }
      }).catch(err => {
        console.error('Server world transfer failed:', err);
        applyServerWorldTransferState(data);
        if (typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('server-world-transfer-error-recover');
      });
    });

    multiplayer.socket.on('serverRespawn', data => {
      if (!data || !data.ok) return;
      handleServerRespawn(data).then(ok => {
        if (!ok) {
          applyServerRespawnState(data);
          if (typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('server-respawn-recover');
        }
      }).catch(err => {
        console.error('Server respawn failed:', err);
        applyServerRespawnState(data);
        if (typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('server-respawn-error-recover');
      });
    });
    multiplayer.socket.on('shot', data => {
      if (!data || data.shooterId === multiplayer.socket.id) return;
      const sx = Number(data.x || 0), sz = Number(data.z || 0);
      const ex = Number.isFinite(Number(data.endX)) ? Number(data.endX) : sx + Math.sin(Number(data.angle || 0)) * 8;
      const ez = Number.isFinite(Number(data.endZ)) ? Number(data.endZ) : sz + Math.cos(Number(data.angle || 0)) * 8;
      const row = multiplayer.remotePlayers.get(data.shooterId);
      const enemyShooter = row ? null : enemies.find(e => e && e.id === data.shooterId);
      if (row && data.equipment) {
        row.data = { ...row.data, weapon: data.weapon || row.data.weapon, equipment: data.equipment };
        updateRemoteEquipmentVisuals(row.group, row.data);
      }
      if (enemyShooter && (data.equipment || data.weapon)) {
        enemyShooter.equipment = enemyEquipmentFromData(data);
        enemyShooter.weapon = enemyShooter.equipment.weapon;
        updateEnemyEquipmentVisuals(enemyShooter);
      }
      if (enemyShooter?.mesh && typeof triggerActorAttackAnimationPulse === 'function') {
        triggerActorAttackAnimationPulse(enemyShooter.mesh, data.t || 0);
      }
      const start = row ? getRemoteMuzzlePoint(row, data) : getEnemyMuzzlePoint(enemyShooter, data);
      const shotWeaponId = data.weapon || row?.data?.weapon || enemyShooter?.equipment?.weapon || 'pistol';
      const fx = weaponFxProfile(shotWeaponId);
      const shotHandSlot = data.handSlot === 'offhand' ? 'offhand' : 'weapon';
      const remoteWeaponGroup = row?.group && typeof actorWeaponGroupForSlot === 'function'
        ? actorWeaponGroupForSlot(row.group, shotHandSlot)
        : (row?.group && typeof activeActorWeaponGroup === 'function'
          ? activeActorWeaponGroup(row.group)
          : row?.group?.userData?.parts?.weaponGroup);
      triggerWeaponVisualRecoil(remoteWeaponGroup || enemyShooter?.mesh?.userData?.enemyWeaponGroup, shotWeaponId);
      let ox = Number(data.originX);
      let oz = Number(data.originZ);
      if (!Number.isFinite(ox) || !Number.isFinite(oz)) { ox = sx; oz = sz; }
      let dirX = Number(data.dirX);
      let dirZ = Number(data.dirZ);
      let dirLen = Math.hypot(dirX, dirZ);
      if (!Number.isFinite(dirLen) || dirLen <= 0.0001) {
        dirX = Math.sin(Number(data.angle || 0));
        dirZ = Math.cos(Number(data.angle || 0));
        dirLen = Math.hypot(dirX, dirZ) || 1;
      }
      dirX /= dirLen;
      dirZ /= dirLen;
      const projectedEndDist = Number.isFinite(Number(data.endDist))
        ? Number(data.endDist)
        : Math.max(0, (ex - ox) * dirX + (ez - oz) * dirZ);
      if (data.fxSuppressed || projectedEndDist < 0.72) {
        if (typeof spawnBlockedMuzzleFlash === 'function') spawnBlockedMuzzleFlash(start, shotWeaponId);
        return;
      }
      const muzzleX = Number.isFinite(Number(start?.x)) ? Number(start.x) : ox;
      const muzzleZ = Number.isFinite(Number(start?.z)) ? Number(start.z) : oz;
      const muzzleAlong = (muzzleX - ox) * dirX + (muzzleZ - oz) * dirZ;
      const remainingDist = projectedEndDist - Math.max(0, muzzleAlong);
      if (remainingDist < 0.16) {
        if (typeof spawnBlockedMuzzleFlash === 'function') spawnBlockedMuzzleFlash(start, shotWeaponId);
        return;
      }
      const fxStartX = muzzleX;
      const fxStartZ = muzzleZ;
      const fxEndX = muzzleX + dirX * remainingDist;
      const fxEndZ = muzzleZ + dirZ * remainingDist;
      if (shotWeaponId === 'flamethrower') spawnFlameCone(fxStartX, fxStartZ, fxEndX, fxEndZ, start.y, 1.05, fx);
      else {
        spawnTracer(fxStartX, fxStartZ, fxEndX, fxEndZ, start.y, 1.05, fx);
        if (shotWeaponId === 'rocketLauncher') spawnExplosionFx(fxEndX, fxEndZ, Number(data.explosiveRadius || 4.2));
      }
    });
  }

  function changeMultiplayerLocation(options = {}) {
    clearNetworkRoomEntities({ keepPlayer: true });
    resetNetworkSnapshotStamps();
    const previousRoomId = multiplayer.roomId || '';
    multiplayer.roomId = '';
    if (!multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined) {
      if (typeof clientWorldRequiresServer === 'function' && clientWorldRequiresServer()) {
        const timeoutMs = options.timeoutMs || 4500;
        setReadout('Синхронизирую локацию с сервером...');
        return Promise.resolve(connectMultiplayer({ waitForJoin: true, timeoutMs })).then(ok => {
          if (!ok || !(multiplayer.socket && multiplayer.socket.connected && multiplayer.joined)) {
            if (!multiplayer.roomId && previousRoomId && options.restoreRoomOnFail) multiplayer.roomId = previousRoomId;
            setReadout('Нет соединения с сервером: переход в локацию отменён.');
            return false;
          }
          return changeMultiplayerLocation(options);
        });
      }
      connectMultiplayer();
      return Promise.resolve(false);
    }
    const pendingEncounterActive = !!(
      globalMapState?.pendingEncounterRoomId
      || globalMapState?.pendingEncounterId
      || globalMapState?.pendingEncounterWorldZoneId
      || globalMapState?.pendingEncounterWorldPartyId
      || globalMapState?.currentWorldSiteId
      || currentLocation?.encounterOnly
      || currentLocation?.randomTemplate
    );
    multiplayer.socket.emit('changeLocation', {
      locationId: currentLocation?.id || 'settlement',
      lastVisitedSettlementId: typeof rememberCurrentSettlementLocation === 'function' ? rememberCurrentSettlementLocation() : (characterProfile?.lastVisitedSettlementId || 'settlement'),
      roomId: pendingEncounterActive ? (globalMapState?.pendingEncounterRoomId || '') : '',
      encounterId: pendingEncounterActive ? (globalMapState?.pendingEncounterId || '') : '',
      worldZoneId: pendingEncounterActive ? (globalMapState?.pendingEncounterWorldZoneId || '') : '',
      partyId: pendingEncounterActive ? (globalMapState?.pendingEncounterWorldPartyId || '') : '',
      siteId: pendingEncounterActive ? (globalMapState?.currentWorldSiteId || '') : '',
      worldPoint: pendingEncounterActive
        ? (globalMapState?.pendingEncounterWorldPoint || { x: globalMapState?.playerX || 0, y: globalMapState?.playerY || 0 })
        : null,
      pvpMode: currentLocation?.pvpMode || '',
      entryKey: multiplayer.pendingEntryKey || 'spawn',
      deviceType: getDeviceType(),
      controlType: getDeviceControlType(),
      x: player.x,
      z: player.z,
      angle: player.angle,
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
      equipment: multiplayerEquipmentSnapshot(),
      weapon: multiplayerWeaponId(),
      injuries: multiplayerInjurySnapshot()
    }, ack => {
      if (!ack || !ack.ok) {
        setOnlineStatus(`Сеть: ${ack?.error || 'не удалось сменить локацию'}`);
        return;
      }
      multiplayer.roomId = ack.roomId || '';
      if (ack.lastVisitedSettlementId && characterProfile) {
        characterProfile.lastVisitedSettlementId = typeof normalizeLastVisitedSettlementId === 'function'
          ? normalizeLastVisitedSettlementId(ack.lastVisitedSettlementId)
          : ack.lastVisitedSettlementId;
      }
      multiplayer.serverAuthoritativeEnemies = ack.serverAuthoritativeEnemies !== false;
      applyServerAuthoritativePlayerState(ack.self || ack, { positionMode: 'transition' });
      multiplayer.pendingEntryKey = '';
      resetNetworkSnapshotStamps();
      markStartupNetworkEvent('worldState');
      clearNetworkRoomEntities({ keepPlayer: true });
      (ack.players || []).forEach(p => upsertRemotePlayer(p, { source: 'join', forceSnap: true }));
      initWorldSyncFromServer(ack.worldState);
      resolveMultiplayerJoinWaiters(true);
      setOnlineStatus(`Сеть: ${currentLocation?.name || ack.locationId || 'Локация'} · игроков в локации: ${(ack.players || []).length + 1}`);
    });
  }

  function changeMultiplayerLocationReady(options = {}) {
    clearNetworkRoomEntities({ keepPlayer: true });
    resetNetworkSnapshotStamps();
    const previousRoomId = multiplayer.roomId || '';
    multiplayer.roomId = '';
    if (!multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined) {
      if (typeof clientWorldRequiresServer === 'function' && clientWorldRequiresServer()) {
        const timeoutMs = options.timeoutMs || 6500;
        setReadout('Синхронизирую локацию с сервером...');
        return Promise.resolve(connectMultiplayer({ waitForJoin: true, timeoutMs })).then(ok => {
          if (!ok || !(multiplayer.socket && multiplayer.socket.connected && multiplayer.joined)) {
            if (!multiplayer.roomId && previousRoomId && options.restoreRoomOnFail) multiplayer.roomId = previousRoomId;
            setReadout('Нет соединения с сервером: переход в локацию отменён.');
            return false;
          }
          return changeMultiplayerLocationReady(options);
        });
      }
      connectMultiplayer();
      return Promise.resolve(false);
    }
    return new Promise(resolve => {
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        resolve(!!ok);
      };
      const timeout = setTimeout(() => {
        if (!multiplayer.roomId && previousRoomId && options.restoreRoomOnFail) multiplayer.roomId = previousRoomId;
        finish(false);
      }, Math.max(1200, Number(options.timeoutMs || 6500)));
      const pendingEncounterActive = !!(
        globalMapState?.pendingEncounterRoomId
        || globalMapState?.pendingEncounterId
        || globalMapState?.pendingEncounterWorldZoneId
        || globalMapState?.pendingEncounterWorldPartyId
        || globalMapState?.currentWorldSiteId
        || currentLocation?.encounterOnly
        || currentLocation?.randomTemplate
      );
      multiplayer.socket.emit('changeLocation', {
        locationId: currentLocation?.id || 'settlement',
        lastVisitedSettlementId: typeof rememberCurrentSettlementLocation === 'function' ? rememberCurrentSettlementLocation() : (characterProfile?.lastVisitedSettlementId || 'settlement'),
        roomId: pendingEncounterActive ? (globalMapState?.pendingEncounterRoomId || '') : '',
        encounterId: pendingEncounterActive ? (globalMapState?.pendingEncounterId || '') : '',
        worldZoneId: pendingEncounterActive ? (globalMapState?.pendingEncounterWorldZoneId || '') : '',
        partyId: pendingEncounterActive ? (globalMapState?.pendingEncounterWorldPartyId || '') : '',
        siteId: pendingEncounterActive ? (globalMapState?.currentWorldSiteId || '') : '',
        worldPoint: pendingEncounterActive
          ? (globalMapState?.pendingEncounterWorldPoint || { x: globalMapState?.playerX || 0, y: globalMapState?.playerY || 0 })
          : null,
        pvpMode: currentLocation?.pvpMode || '',
        entryKey: multiplayer.pendingEntryKey || 'spawn',
        deviceType: getDeviceType(),
        controlType: getDeviceControlType(),
        x: player.x,
        z: player.z,
        angle: player.angle,
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
        equipment: multiplayerEquipmentSnapshot(),
        weapon: multiplayerWeaponId(),
        injuries: multiplayerInjurySnapshot()
      }, ack => {
        clearTimeout(timeout);
        if (!ack || !ack.ok) {
          if (!multiplayer.roomId && previousRoomId && options.restoreRoomOnFail) multiplayer.roomId = previousRoomId;
          setOnlineStatus(`Сеть: ${ack?.error || 'не удалось сменить локацию'}`);
          finish(false);
          return;
        }
        multiplayer.roomId = ack.roomId || '';
        if (ack.lastVisitedSettlementId && characterProfile) {
          characterProfile.lastVisitedSettlementId = typeof normalizeLastVisitedSettlementId === 'function'
            ? normalizeLastVisitedSettlementId(ack.lastVisitedSettlementId)
            : ack.lastVisitedSettlementId;
        }
        multiplayer.serverAuthoritativeEnemies = ack.serverAuthoritativeEnemies !== false;
        applyServerAuthoritativePlayerState(ack.self || ack, { positionMode: 'transition' });
        multiplayer.pendingEntryKey = '';
        resetNetworkSnapshotStamps();
        markStartupNetworkEvent('worldState');
        clearNetworkRoomEntities({ keepPlayer: true });
        (ack.players || []).forEach(p => upsertRemotePlayer(p, { source: 'join', forceSnap: true }));
        initWorldSyncFromServer(ack.worldState);
        resolveMultiplayerJoinWaiters(true);
        setOnlineStatus(`Сеть: ${currentLocation?.name || ack.locationId || 'Локация'} · игроков в локации: ${(ack.players || []).length + 1}`);
        finish(true);
      });
    });
  }

  function sendMultiplayerState(dt) {
    updateNetworkPing(dt);
    if (!multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined || !characterProfile) return;
    multiplayer.lastStateSent += dt;
    multiplayer.lastHeartbeat += dt;
    // v7.74.48: отправляем компактные координаты чаще, но только как playerState
    // поток движения. Полные snapshot теперь не должны дёргать модель второго игрока.
    const lastSentX = Number.isFinite(Number(multiplayer.lastSentX)) ? Number(multiplayer.lastSentX) : player.x;
    const lastSentZ = Number.isFinite(Number(multiplayer.lastSentZ)) ? Number(multiplayer.lastSentZ) : player.z;
    const lastSentAngle = Number.isFinite(Number(multiplayer.lastSentAngle)) ? Number(multiplayer.lastSentAngle) : player.angle;
    const sendWindowDt = Math.max(0.001, Number(multiplayer.lastStateSent || 0));
    const sendDeltaX = player.x - lastSentX;
    const sendDeltaZ = player.z - lastSentZ;
    const sendDeltaDist = Math.hypot(sendDeltaX, sendDeltaZ);
    const sendWindowSpeed = sendDeltaDist / sendWindowDt;
    const movementIntent = hasLocalMovementIntent();
    const movedSinceLastSend = Math.hypot(player.x - lastSentX, player.z - lastSentZ) > 0.010;
    const angleDeltaSinceLastSend = Math.abs(normalizeAngleForInterpolation(player.angle, lastSentAngle) - lastSentAngle);
    const turnedSinceLastSend = angleDeltaSinceLastSend > 0.020;
    const physicallyMoving = movementIntent || sendWindowSpeed > 0.028;
    const remoteWasMoving = multiplayer.lastSentMoving === true;
    const justStarted = !remoteWasMoving && !!physicallyMoving;
    const justStopped = remoteWasMoving && !physicallyMoving && !movedSinceLastSend;
    const movingNow = !!(physicallyMoving || movedSinceLastSend || turnedSinceLastSend);
    // v7.74.54: движение лучше выглядит при ровном потоке 30-33 Гц, чем при
    // слишком частых 50 Гц с микроджиттером браузера/сети. Полный профиль
    // во время длинного бега отправляем редко, иначе каждые 250 мс возникают
    // JSON/sanitize/GC пики, похожие на небольшие пролагивания.
    multiplayer.lastFullStateSent = Number(multiplayer.lastFullStateSent || 0) + Math.max(0, dt);
    multiplayer.lastHeavyProfileSent = Number(multiplayer.lastHeavyProfileSent || 0) + Math.max(0, dt);
    const stateSendInterval = movingNow ? (IS_MOBILE_DEVICE ? 0.034 : 0.030) : (justStopped ? 0.001 : 0.140);
    if (multiplayer.lastStateSent >= stateSendInterval || justStarted || justStopped) {
      const fullSyncInterval = movingNow ? 1.25 : 2.50;
      const periodicProfileSync = multiplayer.lastFullStateSent >= fullSyncInterval;
      const transitionReliableMotion = justStarted || justStopped;
      const globalMapModeActive = typeof globalMapState !== 'undefined' && !!(globalMapState?.onWorldMap || document.body.classList.contains('global-map-mode'));
      const heavyProfileInterval = globalMapModeActive ? 45.0 : (movingNow ? 8.0 : 30.0);
      const transitionNeedsHeavyProfile = !globalMapModeActive && transitionReliableMotion && multiplayer.lastHeavyProfileSent >= 0.80;
      const includeHeavyProfile = !!(transitionNeedsHeavyProfile || multiplayer.lastHeavyProfileSent >= heavyProfileInterval);
      const rawOutgoingVx = sendDeltaX / Math.max(0.001, multiplayer.lastStateSent || sendWindowDt);
      const rawOutgoingVz = sendDeltaZ / Math.max(0.001, multiplayer.lastStateSent || sendWindowDt);
      const outgoingVx = smoothOutgoingVelocity('x', rawOutgoingVx, physicallyMoving, justStarted, turnedSinceLastSend && physicallyMoving);
      const outgoingVz = smoothOutgoingVelocity('z', rawOutgoingVz, physicallyMoving, justStarted, turnedSinceLastSend && physicallyMoving);
      multiplayer.lastStateSent = 0;
      if (periodicProfileSync || transitionReliableMotion) multiplayer.lastFullStateSent = 0;
      if (includeHeavyProfile) multiplayer.lastHeavyProfileSent = 0;
      multiplayer.lastSentX = player.x;
      multiplayer.lastSentZ = player.z;
      multiplayer.lastSentAngle = player.angle;
      multiplayer.lastSentMoving = !!physicallyMoving;
      const movementPayload = {
        seq: ++multiplayer.movementSeq,
        x: player.x,
        z: player.z,
        vx: outgoingVx,
        vz: outgoingVz,
        angle: player.angle,
        moving: !!physicallyMoving,
        turning: !!(turnedSinceLastSend && physicallyMoving),
        crouching: player.crouching
      };
      // v7.74.63: periodic full profile sync must not carry authoritative motion.
      // The one forward jerk appeared about one second after movement/vector change,
      // exactly when the reliable full state was sent. Movement now always goes via
      // the compact hot-path packet; the heavy reliable packet below is profile-only.
      const movementSocket = transitionReliableMotion ? multiplayer.socket : (multiplayer.socket.volatile || multiplayer.socket);
      movementSocket.emit('state', movementPayload);
      if (periodicProfileSync || transitionReliableMotion) {
        const profilePayload = {
          profileOnly: true,
          reason: periodicProfileSync && !transitionReliableMotion ? 'profile' : (justStopped ? 'idleProfile' : 'startProfile'),
          hp: player.hp,
          maxHp: player.maxHp,
          maxAp: player.maxAp,
          ap: player.ap,
          special: characterProfile?.special || DEFAULT_SPECIAL,
          factionId: characterProfile?.factionId || characterProfile?.worldFactionId || '',
          worldFactionId: characterProfile?.worldFactionId || characterProfile?.factionId || '',
          skillRanks: multiplayerSkillSnapshot(),
          talentRanks: multiplayerTalentSnapshot(),
          traits: multiplayerTraitSnapshot(),
          level: player.level,
          name: characterProfile.name || serverSession.login || 'Игрок',
          deviceType: getDeviceType(),
          controlType: getDeviceControlType(),
          weapon: multiplayerWeaponId(),
          equipment: multiplayerEquipmentSnapshot()
        };
        if (includeHeavyProfile) {
          profilePayload.heavyProfile = true;
          profilePayload.combat = typeof multiplayerCombatSnapshot === 'function' ? multiplayerCombatSnapshot() : null;
          profilePayload.carry = typeof multiplayerCarrySnapshot === 'function' ? multiplayerCarrySnapshot() : null;
          profilePayload.inventory = typeof multiplayerInventorySnapshot === 'function' ? multiplayerInventorySnapshot() : null;
          profilePayload.injuries = multiplayerInjurySnapshot();
        }
        // Start/stop motion was already sent in the reliable packet above. Every
        // companion stays profile-only so it cannot overwrite fresh velocity.
        multiplayer.socket.emit('state', profilePayload);
      }
    }
    if (multiplayer.lastHeartbeat >= 10) {
      multiplayer.lastHeartbeat = 0;
      serverApi('/api/auth/heartbeat', { method: 'POST' }).catch(() => {});
    }
  }
