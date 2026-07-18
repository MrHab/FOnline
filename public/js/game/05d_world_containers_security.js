  // ===== SERVER WORLD CONTAINERS =====
  function clearWorldContainersVisuals() {
    multiplayer.worldContainerMeshes.forEach(mesh => {
      forgetNetworkRevealObject(mesh);
      try { scene.remove(mesh); } catch (_) {}
    });
    multiplayer.worldContainerMeshes.length = 0;
    multiplayer.worldContainers.clear();
  }

  function worldContainerPalette(container = {}) {
    if (container.terminalLocked) return { body: 0x2e5c63, edge: 0x10282d };
    if (container.locked) return { body: 0x5b4b64, edge: 0x241b2a };
    const tier = String(container.tier || 'basic');
    const palettes = {
      survival: { body: 0x6b5b35, edge: 0x2f2a18 },
      settlement: { body: 0x6b5b35, edge: 0x2f2a18 },
      tools: { body: 0x6c4a2e, edge: 0x2d2418 },
      medical: { body: 0x6a3432, edge: 0x2f1515 },
      ammo: { body: 0x4f5b60, edge: 0x20282b },
      wasteland: { body: 0x584d3b, edge: 0x29241a },
      rare: { body: 0x6c5d2f, edge: 0x2f2911 },
      basic: { body: 0x5a4930, edge: 0x2d2418 }
    };
    const palette = palettes[tier] || palettes.basic;
    if (!container.empty) return palette;
    return { body: 0x373229, edge: 0x191713 };
  }

  function createWorldContainerMesh(container = {}) {
    const group = new THREE.Group();
    const palette = worldContainerPalette(container);
    const baseMat = new THREE.MeshStandardMaterial({ color: palette.body, roughness: 0.88, metalness: 0.08 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: palette.edge, roughness: 0.9, metalness: 0.12 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.68, 0.82), baseMat);
    body.position.y = 0.36;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.16, 0.92), edgeMat);
    lid.position.y = 0.78;
    lid.castShadow = true;
    group.add(lid);

    const band1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.78, 0.96), edgeMat);
    band1.position.set(-0.34, 0.42, 0);
    group.add(band1);
    const band2 = band1.clone();
    band2.position.x = 0.34;
    group.add(band2);

    if (container.locked) {
      const lockMat = new THREE.MeshStandardMaterial({ color: 0xc7a35a, roughness: 0.52, metalness: 0.55 });
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.1), lockMat);
      lock.position.set(0, 0.58, -0.47);
      group.add(lock);
    }

    if (container.terminalLocked || Number(container.terminalDifficulty || 0) > 0) {
      const screenMat = new THREE.MeshStandardMaterial({
        color: 0x1f8a8a,
        emissive: 0x0d4c4c,
        emissiveIntensity: container.terminalLocked ? 0.45 : 0.12,
        roughness: 0.46,
        metalness: 0.2
      });
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.32, 0.08), screenMat);
      screen.position.set(0, 0.86, -0.5);
      group.add(screen);
      const postMat = new THREE.MeshStandardMaterial({ color: 0x233033, roughness: 0.78, metalness: 0.32 });
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), postMat);
      post.position.set(0, 0.68, -0.49);
      group.add(post);
    }

    // Лутовые контейнеры не получают надписей над моделью.
    // Игрок понимает доступность по форме объекта и подсказке взаимодействия рядом,
    // без постоянного текста в 3D-мире.
    group.userData.allowsPlayerOverlap = true;
    return group;
  }

  function removeWorldContainerVisual(id) {
    const row = multiplayer.worldContainers.get(id);
    if (!row) return;
    const idx = multiplayer.worldContainerMeshes.indexOf(row.mesh);
    if (idx >= 0) multiplayer.worldContainerMeshes.splice(idx, 1);
    forgetNetworkRevealObject(row.mesh);
    if (row.mesh) scene.remove(row.mesh);
    multiplayer.worldContainers.delete(id);
  }

  function upsertWorldContainer(src) {
    if (!src || !src.id) return;
    let row = multiplayer.worldContainers.get(src.id);
    if (!row) {
      const mesh = createWorldContainerMesh(src);
      row = { ...src, loot: (src.loot || []).map(x => ({ id: x.id, qty: x.qty })), mesh };
      mesh.userData.worldContainer = row;
      mesh.traverse(child => { if (child.isMesh) child.userData.worldContainer = row; });
      scene.add(mesh);
      multiplayer.worldContainers.set(src.id, row);
      multiplayer.worldContainerMeshes.push(mesh);
    } else {
      row.name = src.name || row.name || 'Контейнер';
      row.tier = src.tier || row.tier || 'basic';
      row.locked = !!src.locked;
      row.lockDifficulty = Number(src.lockDifficulty || 0);
      row.lockDifficultyTier = src.lockDifficultyTier || row.lockDifficultyTier || '';
      row.lockDifficultyLabel = src.lockDifficultyLabel || row.lockDifficultyLabel || '';
      row.lockRequiredSkill = Number(src.lockRequiredSkill || row.lockRequiredSkill || 0);
      row.terminalLocked = !!src.terminalLocked;
      row.terminalDifficulty = Number(src.terminalDifficulty || 0);
      row.terminalDifficultyTier = src.terminalDifficultyTier || row.terminalDifficultyTier || '';
      row.terminalDifficultyLabel = src.terminalDifficultyLabel || row.terminalDifficultyLabel || '';
      row.terminalRequiredSkill = Number(src.terminalRequiredSkill || row.terminalRequiredSkill || 0);
      row.terminalUnlocksLock = !!src.terminalUnlocksLock;
      row.terminalName = src.terminalName || row.terminalName || '';
      row.lockCooldownUntil = Math.max(0, Number(src.lockCooldownUntil || 0));
      row.terminalCooldownUntil = Math.max(0, Number(src.terminalCooldownUntil || 0));
      row.x = Number(src.x ?? row.x ?? 0);
      row.z = Number(src.z ?? row.z ?? 0);
      row.tx = Number(src.tx ?? row.tx ?? 0);
      row.tz = Number(src.tz ?? row.tz ?? 0);
      row.loot = (src.loot || []).map(x => ({ id: x.id, qty: x.qty }));
      row.empty = !!src.empty || row.loot.length === 0;
      if (row.mesh) {
        forgetNetworkRevealObject(row.mesh);
        scene.remove(row.mesh);
        const idx = multiplayer.worldContainerMeshes.indexOf(row.mesh);
        if (idx >= 0) multiplayer.worldContainerMeshes.splice(idx, 1);
      }
      row.mesh = createWorldContainerMesh(row);
      row.mesh.userData.worldContainer = row;
      row.mesh.traverse(child => { if (child.isMesh) child.userData.worldContainer = row; });
      scene.add(row.mesh);
      multiplayer.worldContainerMeshes.push(row.mesh);
    }
    if (row.mesh) {
      row.mesh.position.set(Number(row.x || src.x || 0), 0, Number(row.z || src.z || 0));
      applyNetworkFogVisibilityNow(row.mesh, Number(row.x || src.x || 0), Number(row.z || src.z || 0));
    }
  }

  function applyNetworkWorldContainers(containers) {
    if (!Array.isArray(containers)) return;
    const ids = new Set();
    containers.forEach(src => {
      if (!src || !src.id) return;
      ids.add(src.id);
      upsertWorldContainer(src);
    });
    [...multiplayer.worldContainers.keys()].forEach(id => { if (!ids.has(id)) removeWorldContainerVisual(id); });
    if (activeWorldContainer) {
      const fresh = multiplayer.worldContainers.get(activeWorldContainer.id);
      if (fresh) { activeWorldContainer = fresh; renderLootWindow(); }
      else closeLootWindow();
    }
  }

  function findNearestWorldContainer(maxDist = 3.0) {
    let best = null;
    let bestDist = maxDist;
    multiplayer.worldContainers.forEach(row => {
      const d = Math.hypot(Number(row.x || 0) - player.x, Number(row.z || 0) - player.z);
      if (d <= bestDist) { bestDist = d; best = row; }
    });
    return best;
  }

  function findWorldContainerFromEvent(clientX, clientY) {
    updatePointerWorld(clientX, clientY);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(multiplayer.worldContainerMeshes, true);
    for (const h of hits) {
      if (h.object.userData.worldContainer) return h.object.userData.worldContainer;
    }
    return null;
  }

  function multiplayerProgressionSnapshot() {
    return {
      level: player?.level || 1,
      ap: Number(player?.ap || 0),
      maxAp: Number(player?.maxAp || 0),
      inventory: typeof multiplayerInventorySnapshot === 'function' ? multiplayerInventorySnapshot() : null,
      traits: characterProfile?.traits || [],
      special: characterProfile?.special || {},
      skillRanks: { ...skillRanks },
      talentRanks: { ...talentRanks }
    };
  }

  function securityClamp(v, min, max) {
    return Math.max(min, Math.min(max, Number(v || 0)));
  }

  const SECURITY_DIFFICULTY_TIERS = [
    { id: 'veryEasy', label: 'Очень лёгкий', required: 25, difficulty: 10, aliases: ['veryeasy', 'very_easy', 'trivial', 'novice', 'оченьлегкий', 'оченьлёгкий'] },
    { id: 'easy', label: 'Лёгкий', required: 40, difficulty: 25, aliases: ['easy', 'light', 'легкий', 'лёгкий'] },
    { id: 'medium', label: 'Средний', required: 55, difficulty: 45, aliases: ['medium', 'normal', 'средний'] },
    { id: 'hard', label: 'Сложный', required: 75, difficulty: 65, aliases: ['hard', 'сложный'] },
    { id: 'veryHard', label: 'Очень сложный', required: 90, difficulty: 80, aliases: ['veryhard', 'very_hard', 'master', 'оченьсложный'] }
  ];

  function normalizeSecurityDifficultyKey(value = '') {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/g, '');
  }

  function securityDifficultyFromNumber(value = 45) {
    const n = securityClamp(value, 0, 100);
    if (n <= 20) return SECURITY_DIFFICULTY_TIERS[0];
    if (n <= 40) return SECURITY_DIFFICULTY_TIERS[1];
    if (n <= 60) return SECURITY_DIFFICULTY_TIERS[2];
    if (n <= 80) return SECURITY_DIFFICULTY_TIERS[3];
    return SECURITY_DIFFICULTY_TIERS[4];
  }

  function securityDifficultyInfo(value, fallbackId = 'medium') {
    if (value && typeof value === 'object') return securityDifficultyInfo(value.id || value.tier || value.level || value.difficulty, fallbackId);
    if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))) return securityDifficultyFromNumber(Number(value));
    const key = normalizeSecurityDifficultyKey(value || fallbackId);
    const found = SECURITY_DIFFICULTY_TIERS.find(tier => {
      if (normalizeSecurityDifficultyKey(tier.id) === key) return true;
      if (normalizeSecurityDifficultyKey(tier.label) === key) return true;
      return tier.aliases.some(alias => normalizeSecurityDifficultyKey(alias) === key);
    });
    return found || SECURITY_DIFFICULTY_TIERS.find(tier => tier.id === fallbackId) || SECURITY_DIFFICULTY_TIERS[2];
  }

  function securityContainerDifficultyInfo(container = {}, kind = 'lock') {
    const locked = kind === 'terminal' ? !!container.terminalLocked : !!container.locked;
    const fallback = locked ? 'medium' : 'veryEasy';
    const raw = kind === 'terminal'
      ? (container.terminalDifficultyTier || container.terminalDifficulty)
      : (container.lockDifficultyTier || container.lockDifficulty);
    return securityDifficultyInfo(raw, fallback);
  }

  function securityRequirementInfo(container = {}, kind = 'lock') {
    const info = securityContainerDifficultyInfo(container, kind);
    const skillId = kind === 'terminal' ? 'science' : 'lockpick';
    const serverRequired = Number(kind === 'terminal' ? container.terminalRequiredSkill : container.lockRequiredSkill);
    const serverLabel = kind === 'terminal' ? container.terminalDifficultyLabel : container.lockDifficultyLabel;
    return {
      id: info.id,
      label: serverLabel || info.label,
      difficulty: info.difficulty,
      required: Number.isFinite(serverRequired) && serverRequired > 0 ? Math.round(serverRequired) : info.required,
      skillId,
      skillLabel: kind === 'terminal' ? 'Наука' : 'Взлом',
      current: Math.round(typeof skillPercent === 'function' ? skillPercent(skillId) : 20)
    };
  }

  function localSecurityActionChance(container = {}, kind = 'lock') {
    const req = securityRequirementInfo(container, kind);
    if (req.current < req.required) return 0;
    if (kind === 'terminal') {
      const diff = securityContainerDifficultyInfo(container, 'terminal').difficulty;
      const chance = 0.14 +
        skillNorm('science') * 0.58 +
        skillNorm('repair') * 0.12 +
        (statValue('int') - 5) * 0.03 +
        talentLevel('engineer') * 0.035 +
        talentLevel('energyTech') * 0.02 -
        diff * 0.0065;
      return securityClamp(chance, 0.02, 0.90);
    }
    const diff = securityContainerDifficultyInfo(container, 'lock').difficulty;
    const chance = 0.18 +
      skillNorm('lockpick') * 0.55 +
      (statValue('agi') - 5) * 0.025 +
      (statValue('luck') - 5) * 0.012 +
      talentLevel('quickHands') * 0.025 -
      diff * 0.006;
    return securityClamp(chance, 0.03, 0.92);
  }

  function securityChancePercent(container = {}, kind = 'lock') {
    return Math.max(0, Math.round(localSecurityActionChance(container, kind) * 100));
  }

  function securityActionApCost(kind = 'lock') {
    if (kind === 'terminal') return Math.max(3, 4 - Math.floor((talentLevel('engineer') + talentLevel('actionBoy')) / 2));
    return Math.max(2, 3 - Math.floor((talentLevel('quickHands') + talentLevel('actionBoy')) / 2));
  }

  function securityFailureCooldownSeconds(kind = 'lock') {
    const baseMs = kind === 'terminal' ? 11000 : 9000;
    const cooldownMs = baseMs * Math.max(0.55, 1 - skillNorm('traps') * 0.35);
    return Math.max(1, Math.round(cooldownMs / 100) / 10);
  }

  function securityCooldownRemainingMs(container = {}, kind = 'lock') {
    const until = Number(kind === 'terminal' ? container.terminalCooldownUntil : container.lockCooldownUntil);
    return Math.max(0, until - Date.now());
  }

  function formatSecurityApCost(cost = 0) {
    const n = Number(cost || 0);
    return String(Math.max(0, Math.floor(n)));
  }

  function applySecurityActionAck(ack = {}) {
    if (Number.isFinite(Number(ack.maxAp)) && Number(ack.maxAp) > 0) player.maxAp = Number(ack.maxAp);
    if (Number.isFinite(Number(ack.ap))) player.ap = Math.max(0, Number(ack.ap));
    if (typeof sendImmediateMultiplayerState === 'function') sendImmediateMultiplayerState('securityAction');
  }

  function securityActionBlockedText(container = {}, kind = 'lock') {
    const cooldown = securityCooldownRemainingMs(container, kind);
    if (cooldown > 0) return `${kind === 'terminal' ? 'Терминал' : 'Замок'} на перезарядке: ${Math.ceil(cooldown / 1000)} сек.`;
    const req = securityRequirementInfo(container, kind);
    if (req.current < req.required) return `${kind === 'terminal' ? 'Терминал' : 'Замок'}: ${req.label}. Нужен навык ${req.skillLabel} ${req.required}%. Сейчас ${req.current}%.`;
    const apCost = securityActionApCost(kind);
    if (Number(player?.ap || 0) + 0.01 < apCost) return `Нужно ${formatSecurityApCost(apCost)} ОД. Сейчас ${formatSecurityApCost(player?.ap || 0)}.`;
    return '';
  }

  function securityTooltipText(container = {}, kind = 'lock') {
    const req = securityRequirementInfo(container, kind);
    const chance = securityChancePercent(container, kind);
    const apCost = securityActionApCost(kind);
    const cooldown = securityCooldownRemainingMs(container, kind);
    const pieces = [`${kind === 'terminal' ? 'Терминал' : 'Замок'}: ${req.label}`, `нужно ${req.skillLabel} ${req.required}%`, `сейчас ${req.current}%`];
    if (req.current >= req.required) pieces.push(`шанс ${chance}%`, `стоимость ${formatSecurityApCost(apCost)} ОД`, `провал ${securityFailureCooldownSeconds(kind)} сек.`);
    else pieces.push('недостаточно навыка');
    if (cooldown > 0) pieces.push(`перезарядка ${Math.ceil(cooldown / 1000)} сек.`);
    return pieces.join(' · ');
  }

  function securityActionLabel(container = {}, kind = 'lock') {
    const req = securityRequirementInfo(container, kind);
    const base = kind === 'terminal' ? 'Взломать терминал' : 'Взломать замок';
    if (req.current < req.required) return `${base} (${req.label})`;
    return `${base} (${req.label}, ${securityChancePercent(container, kind)}%)`;
  }

  function worldContainerTooltipItem(container = {}) {
    const kind = container.terminalLocked ? 'terminal' : (container.locked ? 'lock' : '');
    const desc = container.terminalLocked
      ? `Защищён терминалом: ${container.terminalName || 'терминал'}.`
      : (container.locked ? 'Заперт на механический замок.' : 'Контейнер открыт.');
    const stat = kind ? securityTooltipText(container, kind) : ((container.empty || !container.loot?.length) ? 'Пусто' : 'Можно открыть');
    return { name: container.name || 'Контейнер', desc, stat };
  }

  function showWorldContainerTooltip(e, container = {}) {
    if (typeof showTooltip !== 'function') return;
    showTooltip(e, worldContainerTooltipItem(container));
    const tip = document.getElementById('tooltip');
    if (tip) tip.dataset.worldContainer = container.id || '1';
  }

  function hideWorldContainerTooltip() {
    const tip = document.getElementById('tooltip');
    if (tip && tip.dataset.worldContainer) {
      tip.dataset.worldContainer = '';
      hideTooltip();
    }
  }

  function awardWorldActionXp(xp = 0, label = 'Опыт') {
    const amount = Math.max(0, Math.floor(Number(xp || 0)));
    if (amount <= 0) return;
    player.xp += amount;
    createFloatingText(player.x, player.z, '+' + amount + ' XP', '#e4c56b');
    addLog(`${label}: +${amount} XP.`, null, 'level');
    if (typeof checkLevelUp === 'function') checkLevelUp();
    queueSave(true);
  }

  function attemptPickLock(container) {
    if (!container) return false;
    if (!worldContainersAreServerAuthoritative()) {
      setReadout('Взлом замков работает в сетевом мире.');
      return false;
    }
    const dist = Math.hypot(Number(container.x || 0) - player.x, Number(container.z || 0) - player.z);
    if (dist > 3.2) {
      setReadout('Подойдите ближе к замку.');
      return false;
    }
    if (container.terminalLocked) {
      return attemptHackTerminal(container);
    }
    const blocked = securityActionBlockedText(container, 'lock');
    if (blocked) {
      setReadout(blocked);
      return false;
    }
    multiplayer.socket.emit('pickLock', { id: container.id, ...multiplayerProgressionSnapshot() }, ack => {
      if (ack?.container) upsertWorldContainer(ack.container);
      if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      if (ack) applySecurityActionAck(ack);
      if (!ack || !ack.ok) {
        const fresh = ack?.container ? (multiplayer.worldContainers.get(ack.container.id) || ack.container) : container;
        if (ack?.cooldownUntil) setReadout(`${ack.error || 'Замок заклинило.'} Осталось ${Math.ceil(Math.max(0, Number(ack.cooldownUntil) - Date.now()) / 1000)} сек.`);
        else setReadout(ack?.error || 'Не удалось взломать замок.');
        if (fresh) upsertWorldContainer(fresh);
        return;
      }
      const chanceText = Math.round(Number.isFinite(Number(ack.chance)) ? Number(ack.chance) * 100 : securityChancePercent(container, 'lock'));
      const fresh = ack.container ? (multiplayer.worldContainers.get(ack.container.id) || ack.container) : container;
      if (ack.success) {
        setReadout(ack.alreadyOpen ? 'Замок уже открыт.' : `Замок открыт. Шанс был ${chanceText}%, потрачено ${formatSecurityApCost(ack.apCost || securityActionApCost('lock'))} ОД.`);
        if (!ack.alreadyOpen) {
          addLog(`Замок открыт: ${fresh.name || 'контейнер'} (${chanceText}%).`, null, 'loot');
          if (Number(ack.xp || 0) > 0) addLog(`Взлом замка: +${Math.floor(Number(ack.xp))} XP.`, null, 'level');
        }
        openWorldContainerWindow(fresh);
      } else {
        const waitText = ack.cooldownUntil ? ` Повтор через ${Math.ceil(Math.max(0, Number(ack.cooldownUntil) - Date.now()) / 1000)} сек.` : '';
        setReadout(`${ack.error || 'Замок не поддался.'} Шанс был ${chanceText}%, потрачено ${formatSecurityApCost(ack.apCost || securityActionApCost('lock'))} ОД.${waitText}`);
        addLog(`Замок не поддался: ${fresh.name || 'контейнер'} (${chanceText}%).`, null, 'combat');
      }
    });
    return true;
  }

  function attemptHackTerminal(container) {
    if (!container) return false;
    if (!worldContainersAreServerAuthoritative()) {
      setReadout('Взлом терминалов работает в сетевом мире.');
      return false;
    }
    const dist = Math.hypot(Number(container.x || 0) - player.x, Number(container.z || 0) - player.z);
    if (dist > 3.2) {
      setReadout('Подойдите ближе к терминалу.');
      return false;
    }
    const blocked = securityActionBlockedText(container, 'terminal');
    if (blocked) {
      setReadout(blocked);
      return false;
    }
    multiplayer.socket.emit('hackTerminal', { id: container.id, ...multiplayerProgressionSnapshot() }, ack => {
      if (ack?.container) upsertWorldContainer(ack.container);
      if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      if (ack) applySecurityActionAck(ack);
      if (!ack || !ack.ok) {
        const fresh = ack?.container ? (multiplayer.worldContainers.get(ack.container.id) || ack.container) : container;
        if (ack?.cooldownUntil) setReadout(`${ack.error || 'Терминал заблокировал ввод.'} Осталось ${Math.ceil(Math.max(0, Number(ack.cooldownUntil) - Date.now()) / 1000)} сек.`);
        else setReadout(ack?.error || 'Не удалось взломать терминал.');
        if (fresh) upsertWorldContainer(fresh);
        return;
      }
      const chanceText = Math.round(Number.isFinite(Number(ack.chance)) ? Number(ack.chance) * 100 : securityChancePercent(container, 'terminal'));
      const fresh = ack.container ? (multiplayer.worldContainers.get(ack.container.id) || ack.container) : container;
      if (ack.success) {
        setReadout(ack.alreadyOpen ? 'Терминал уже открыт.' : `Терминал взломан. Шанс был ${chanceText}%, потрачено ${formatSecurityApCost(ack.apCost || securityActionApCost('terminal'))} ОД.`);
        if (!ack.alreadyOpen) {
          addLog(`Терминал взломан: ${fresh.terminalName || fresh.name || 'контейнер'} (${chanceText}%).`, null, 'loot');
          if (Number(ack.xp || 0) > 0) addLog(`Взлом терминала: +${Math.floor(Number(ack.xp))} XP.`, null, 'level');
          if (ack.questEvent && typeof noteNpcQuestEvent === 'function') noteNpcQuestEvent(ack.questEvent, { containerId: fresh.id, defId: fresh.defId });
        }
        if (fresh.terminalLocked) return;
        if (fresh.locked) attemptPickLock(fresh);
        else openWorldContainerWindow(fresh);
      } else {
        const waitText = ack.cooldownUntil ? ` Повтор через ${Math.ceil(Math.max(0, Number(ack.cooldownUntil) - Date.now()) / 1000)} сек.` : '';
        setReadout(`${ack.error || 'Терминал не поддался.'} Шанс был ${chanceText}%, потрачено ${formatSecurityApCost(ack.apCost || securityActionApCost('terminal'))} ОД.${waitText}`);
        addLog(`Терминал отклонил доступ: ${fresh.terminalName || fresh.name || 'контейнер'} (${chanceText}%).`, null, 'combat');
      }
    });
    return true;
  }

  function openWorldContainerWindow(container) {
    if (!container) return false;
    if (!worldContainersAreServerAuthoritative()) {
      setReadout('Серверные контейнеры работают в сетевой игре.');
      return false;
    }
    const dist = Math.hypot(Number(container.x || 0) - player.x, Number(container.z || 0) - player.z);
    if (dist > 3.2) {
      setReadout('Подойдите ближе к контейнеру.');
      return false;
    }
    if (container.terminalLocked) return attemptHackTerminal(container);
    if (container.locked) return attemptPickLock(container);
    multiplayer.socket.emit('openWorldContainer', { id: container.id, carry: typeof multiplayerCarrySnapshot === 'function' ? multiplayerCarrySnapshot() : null }, ack => {
      if (!ack || !ack.ok) {
        if (ack?.container) upsertWorldContainer(ack.container);
        const fresh = ack?.container ? (multiplayer.worldContainers.get(ack.container.id) || ack.container) : container;
        if (ack?.terminalLocked) { attemptHackTerminal(fresh); return; }
        if (ack?.locked) { attemptPickLock(fresh); return; }
        setReadout(ack?.error || 'Не удалось открыть контейнер.');
        return;
      }
      const row = ack.container || container;
      upsertWorldContainer(row);
      activeLootEnemy = null;
      activeWorldContainer = multiplayer.worldContainers.get(row.id) || row;
      if (typeof hideTooltip === 'function') hideTooltip();
      document.body.classList.add('loot-window-open');
      document.getElementById('loot-window').style.display = 'block';
      renderLootWindow();
      if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    });
    return true;
  }

  function openNearestWorldContainer() {
    const container = findNearestWorldContainer();
    if (!container) return false;
    return openWorldContainerWindow(container);
  }

  function takeWorldContainerItem(id, qty = null) {
    if (!activeWorldContainer || !activeWorldContainer.loot) return;
    const entry = activeWorldContainer.loot.find(x => x.id === id && x.qty > 0);
    if (!entry) return;
    const item = ITEMS[entry.id];
    if (!item) return;
    const available = Math.max(1, Math.floor(Number(entry.qty || 1)));
    const doTake = amount => {
      if (typeof hideTooltip === 'function') hideTooltip();
      const takeQty = Math.max(1, Math.min(available, Math.floor(Number(amount || 1))));
      if (!canCarryItem(entry.id, takeQty)) {
        setReadout(`${item.name}: нет места. ${carryLimitText(entry.id, available)}`);
        renderLootWindow();
        return false;
      }
      const container = activeWorldContainer;
      multiplayer.socket.emit('lootWorldContainer', { id: container.id, itemId: entry.id, qty: takeQty, carry: typeof multiplayerCarrySnapshot === 'function' ? multiplayerCarrySnapshot() : null }, ack => {
        if (!ack || !ack.ok) { setReadout(ack?.error || 'Не удалось забрать предмет.'); return; }
        if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
        else if (Array.isArray(ack.inventory) && typeof applyServerInventorySnapshot === 'function') applyServerInventorySnapshot(ack.inventory);
        (ack.items || []).forEach(taken => {
          const it = ITEMS[taken.id];
          if (it) addLog(`${it.icon} Из контейнера: ${it.name} x${taken.qty}.`, null, 'loot');
        });
        if (ack.container) {
          upsertWorldContainer(ack.container);
          activeWorldContainer = multiplayer.worldContainers.get(ack.container.id) || ack.container;
        }
        renderLootWindow();
        queueSave(true);
      });
      return true;
    };
    if (qty && qty > 0) return doTake(qty);
    return prepareTakeQuantity(entry.id, available, 'Забрать из контейнера', doTake);
  }

  function takeAllWorldContainerLoot() {
    if (typeof hideTooltip === 'function') hideTooltip();
    if (!activeWorldContainer || !activeWorldContainer.loot) return;
    const container = activeWorldContainer;
    const loot = (container.loot || []).filter(entry => entry.qty > 0 && ITEMS[entry.id]);
    if (!loot.length) return;
    if (!canCarryFullLootList(loot)) {
      setReadout('Не хватает переносимого веса, чтобы забрать всё. Выберите предмет или количество вручную.');
      renderLootWindow();
      return;
    }
    const requested = loot.map(entry => ({ id: entry.id, qty: entry.qty }));
    multiplayer.socket.emit('lootWorldContainer', { id: container.id, mode: 'all', requested, carry: typeof multiplayerCarrySnapshot === 'function' ? multiplayerCarrySnapshot() : null }, ack => {
      if (!ack || !ack.ok) { setReadout(ack?.error || 'Не удалось забрать предметы.'); return; }
      if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      else if (Array.isArray(ack.inventory) && typeof applyServerInventorySnapshot === 'function') applyServerInventorySnapshot(ack.inventory);
      let takenCount = 0;
      (ack.items || []).forEach(taken => {
        const it = ITEMS[taken.id];
        if (it) {
          takenCount++;
          addLog(`${it.icon} Из контейнера: ${it.name} x${taken.qty}.`, null, 'loot');
        }
      });
      if (ack.container) {
        upsertWorldContainer(ack.container);
        activeWorldContainer = multiplayer.worldContainers.get(ack.container.id) || ack.container;
      }
      setReadout(takenCount > 0 ? 'Предметы из контейнера забраны.' : 'Нет свободного веса.');
      renderLootWindow();
      queueSave(true);
    });
  }
