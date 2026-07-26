  }

  function refreshInventoryDependentUI() {
    renderInventory();
    renderQuickbar();
    renderWeaponReadout();
    if (storageWindowOpen) renderStorageWindow();
    if (typeof updateSortButtonLabels === 'function') updateSortButtonLabels();
    if (typeof updateNpcQuestPanel === 'function') updateNpcQuestPanel();
  }

  function addItem(id, qty = 1, opts = {}) {
    const item = ITEMS[id];
    const count = Math.max(1, Math.floor(Number(qty || 1)));
    if (!item || count <= 0) return false;
    if (!opts.force && !canCarryItem(id, count)) {
      setReadout(`${item.name}: нет места. Вес ${formatWeight(inventoryWeight())}/${formatWeight(carryCapacity())}.`);
      return false;
    }
    if (isUniqueEquipmentItem(id)) {
      for (let i = 0; i < count; i++) {
        let instanceId = null;
        if (isRuntimeItemId(id) && i === 0 && !inventory.has(id)) instanceId = id;
        else instanceId = createRuntimeItemInstance(id);
        if (instanceId) addInventoryRaw(instanceId, 1);
      }
    } else {
      addInventoryRaw(id, count);
    }
    refreshInventoryDependentUI();
    queueSave();
    return true;
  }

  function removeItem(id, qty = 1) {
    const cur = inventory.get(id) || 0;
    if (cur < qty) return false;
    const next = cur - qty;
    if (next <= 0) inventory.delete(id); else inventory.set(id, next);
    clearEquipmentReferencesToMissing();
    refreshInventoryDependentUI();
    queueSave();
    return true;
  }

  normalizeUniqueEquipmentState();

  function currentWeapon() {
    const held = ITEMS[equipment.weapon];
    return held && (held.type === 'weapon' || Array.isArray(held.dmg)) ? held : ITEMS.fists;
  }

  function equippedProtectionItems() {
    return ['armor', 'helmet'].map(slot => ITEMS[equipment[slot]]).filter(Boolean);
  }

  function armorProfile(type = 'ballistic') {
    const safeType = ['ballistic','explosive','energy','fire','radiation','toxic'].includes(type) ? type : 'ballistic';
    let protection = 0;
    let threshold = 0;
    const armorItems = equippedProtectionItems();
    armorItems.forEach(item => {
      protection += Number(item.protection?.[safeType] || 0);
      threshold += Number(item.thresholds?.[safeType] || 0);
    });
    if (armorItems.length) {
      protection += talentLevel('armorTraining') * 0.012;
      threshold += talentLevel('armorTraining');
    }
    protection += Math.max(0, statValue('end')) * 0.0035;
    return { type: safeType, protection: Math.min(0.85, Math.max(0, protection)), threshold: Math.max(0, threshold) };
  }

  function armorValue(type = 'ballistic') {
    const p = armorProfile(type);
    return Math.round(p.threshold + p.protection * 20 + talentLevel('armorTraining') * 2);
  }

  function mitigateIncomingDamage(rawDamage, type = 'ballistic') {
    const raw = Math.max(0, Number(rawDamage || 0));
    if (raw <= 0) return { raw: 0, damage: 0, absorbed: 0, type };
    const p = armorProfile(type);
    const minimum = Math.max(1, Math.floor(raw * 0.12));
    const afterThreshold = Math.max(0, raw - p.threshold);
    const damage = Math.max(minimum, Math.round(afterThreshold * (1 - p.protection)));
    return { raw, damage: Math.max(1, damage), absorbed: Math.max(0, raw - Math.max(1, damage)), type: p.type, protection: p.protection, threshold: p.threshold };
  }

  function trySecondChance(incomingDamage = 0, sourceName = '') {
    const rank = talentLevel('secondChance');
    if (rank <= 0 || player.hp <= 0) return false;
    const dmg = Math.max(0, Number(incomingDamage || 0));
    if (player.hp - dmg > 0) return false;
    const now = Date.now();
    if (now - Number(player.lastSecondChanceAt || 0) < 90000) return false;
    const chance = Math.min(0.72, rank * 0.22 + Math.max(0, statValue('luck') - 5) * 0.025);
    if (Math.random() > chance) return false;
    player.hp = 1;
    player.invincible = Math.max(player.invincible || 0, 1.2);
    player.lastSecondChanceAt = now;
    createFloatingText(player.x, player.z, '1 HP', '#ffe28a');
    addLog(`⟲ Второй шанс: ${sourceName || 'смертельный удар'} оставил вас на ногах.`, null, 'level');
    renderUI();
    queueSave(true);
    return true;
  }

  function enemyArmorProfile(enemy, type = 'ballistic') {
    const name = String(enemy?.name || '').toLowerCase();
    const safeType = ['ballistic','explosive','energy','fire','radiation','toxic'].includes(type) ? type : 'ballistic';
    let protection = 0;
    let threshold = 0;
    if (name.includes('рейдер') && safeType === 'ballistic') { protection = 0.08; threshold = 1; }
    else if (name.includes('супермутант') && safeType === 'ballistic') { protection = 0.10; threshold = 2; }
    else if (name.includes('гуль') && safeType === 'radiation') { protection = 0.35; threshold = 1; }
    return { type: safeType, protection, threshold };
  }

  function mitigateEnemyDamage(rawDamage, enemy, type = 'ballistic') {
    const raw = Math.max(0, Number(rawDamage || 0));
    if (raw <= 0) return { raw: 0, damage: 0, absorbed: 0, type };
    const p = enemyArmorProfile(enemy, type);
    const minimum = Math.max(1, Math.floor(raw * 0.12));
    const afterThreshold = Math.max(0, raw - p.threshold);
    const damage = Math.max(minimum, Math.round(afterThreshold * (1 - p.protection)));
    return { raw, damage: Math.max(1, damage), absorbed: Math.max(0, raw - Math.max(1, damage)), type: p.type, protection: p.protection, threshold: p.threshold };
  }


  const INJURY_META = {
    brokenArm: { icon: '🦴', label: 'перелом руки', effect: 'хуже точность, атака и перезарядка стоят дороже' },
    brokenLeg: { icon: '🦵', label: 'перелом ноги', effect: 'сильно снижена скорость передвижения' },
    concussion: { icon: '💫', label: 'контузия', effect: 'хуже обзор и точность, лечение сложнее' },
    infection: { icon: '☣', label: 'инфекция', effect: 'периодически снимает HP и немного снижает скорость/точность' }
  };

  const INJURY_LABELS = Object.fromEntries(Object.entries(INJURY_META).map(([id, meta]) => [id, meta.label]));

  function activeInjuries() {
    if (!player.injuries || typeof player.injuries !== 'object') player.injuries = {};
    return Object.keys(INJURY_LABELS).filter(id => !!player.injuries[id]);
  }

  function hasInjury(id) {
    return !!(player.injuries && player.injuries[id]);
  }

  function injuryText() {
    const ids = activeInjuries();
    return ids.length ? ids.map(id => INJURY_LABELS[id]).join(', ') : 'нет травм';
  }

  function injuryStatusHtml() {
    const ids = activeInjuries();
    if (!ids.length) return '<div class="injury-status-title">Состояние</div><div class="injury-status-empty">Травм нет.</div>';
    const rows = ids.map(id => {
      const meta = INJURY_META[id] || { icon: '⚕', label: id, effect: '' };
      return `<div class="injury-status-row injury-${id}"><div class="injury-status-icon">${meta.icon}</div><div><div class="injury-status-name">${meta.label}</div><div class="injury-status-effect">${meta.effect}</div></div></div>`;
    }).join('');
    return `<div class="injury-status-title">Состояние персонажа</div><div class="injury-status-list">${rows}</div>`;
  }

  function syncInjuryUiClasses() {
    if (!document || !document.body) return;
    Object.keys(INJURY_META).forEach(id => document.body.classList.toggle(`injury-${id}`, hasInjury(id)));
    document.body.classList.toggle('has-injuries', activeInjuries().length > 0);
  }

  function renderInjuryStatusPanels() {
    const signature = activeInjuries().join('|') || 'none';
    const inv = document.getElementById('inventory-injury-status');
    const prog = document.getElementById('progression-injury-status');
    const bodyDataset = document && document.body ? document.body.dataset : null;
    if (bodyDataset?.injuryStatusSignature === signature
      && (!inv || inv.dataset.injuryStatusSignature === signature)
      && (!prog || prog.dataset.injuryStatusSignature === signature)) return;

    const html = injuryStatusHtml();
    if (inv && inv.dataset.injuryStatusHtml !== html) {
      inv.innerHTML = html;
      inv.dataset.injuryStatusHtml = html;
      inv.dataset.injuryStatusSignature = signature;
    }
    if (prog && prog.dataset.injuryStatusHtml !== html) {
      prog.innerHTML = html;
      prog.dataset.injuryStatusHtml = html;
      prog.dataset.injuryStatusSignature = signature;
    }
    if (bodyDataset) bodyDataset.injuryStatusSignature = signature;
    syncInjuryUiClasses();
  }

  function addInjury(id, reason = '') {
    if (!INJURY_LABELS[id]) return false;
    if (!player.injuries || typeof player.injuries !== 'object') player.injuries = {};
    if (player.injuries[id]) return false;
    player.injuries[id] = true;
    const meta = INJURY_META[id] || { icon: '⚕', label: INJURY_LABELS[id] };
    addLog(`⚕ Получена травма: ${meta.label}${reason ? ' — ' + reason : ''}.`, null, 'system');
    setReadout(`Травма: ${meta.label}. Нужен навык Доктор или подходящее лекарство.`);
    if (typeof createFloatingText === 'function') createFloatingText(player.x, player.z, `${meta.icon} ${meta.label}`, '#ffbf69');
    renderInjuryStatusPanels();
    queueSave();
    if (typeof sendImmediateMultiplayerState === 'function') sendImmediateMultiplayerState('injury');
    return true;
  }

  function removeInjury(id) {
    if (!player.injuries || !player.injuries[id]) return false;
    delete player.injuries[id];
    addLog(`⚕ Вылечено: ${INJURY_LABELS[id]}.`, null, 'system');
    renderInjuryStatusPanels();
    queueSave();
    return true;
  }

  function rollInjuryFromHit(damage, type = 'ballistic', sourceName = '') {
    const dmg = Math.max(0, Number(damage || 0));
    const source = sourceName || damageTypeLabel(type);
    const lowerSource = String(sourceName || '').toLowerCase();
    const isGhoulSource = lowerSource.includes('гуль') || lowerSource.includes('гуля');
    const isBiteSource = lowerSource.includes('укус') || lowerSource.includes('волк');
    const infectionSource = type === 'toxic' || type === 'radiation' || isGhoulSource || isBiteSource;
    if (player.hp <= 0) return;
    // Гули и заражающие укусы часто наносят небольшой чистый урон после брони,
    // поэтому инфекция проверяется даже при слабом попадании, если урон прошёл.
    if (dmg < 10 && !(infectionSource && dmg > 0)) return;
    const enduranceGuard = Math.max(0, statValue('end') - 5) * 0.015 + talentLevel('steadfastness') * 0.025;
    const luckGuard = Math.max(0, statValue('luck') - 5) * 0.01 + talentLevel('lucky') * 0.035;
    const base = Math.max(0.03, Math.min(0.28, dmg / 130 - enduranceGuard - luckGuard));
    if ((type === 'explosive' || dmg >= 22) && Math.random() < Math.min(0.65, base * (type === 'explosive' ? 1.45 : 0.95))) addInjury('concussion', source);
    if ((type === 'ballistic' || type === 'energy' || lowerSource.includes('супермутант')) && Math.random() < Math.min(0.55, base * (lowerSource.includes('супермутант') ? 1.2 : 0.75) * Math.max(0.35, 1 - talentLevel('ironBones') * 0.28))) addInjury(Math.random() < 0.55 ? 'brokenArm' : 'brokenLeg', source);
    if (infectionSource) {
      const ghoulBonus = isGhoulSource ? 0.42 : 0;
      const biteBonus = isBiteSource ? 0.18 : 0;
      const lowDamageBonus = dmg < 10 ? 0.12 : 0;
      const infectionChance = Math.min(0.86, (base * 1.25 + 0.08 + ghoulBonus + biteBonus + lowDamageBonus) * Math.max(0.45, 1 - talentLevel('immunologist') * 0.25));
      if (Math.random() < infectionChance) addInjury('infection', source);
    }
  }

  function rollSelfInjuryFromHit(damage, type = 'explosive', sourceName = 'самоповреждение') {
    const dmg = Math.max(0, Number(damage || 0));
    if (dmg < 8 || player.hp <= 0) return false;
    const enduranceGuard = Math.max(0, statValue('end') - 5) * 0.018 + talentLevel('steadfastness') * 0.028;
    const luckGuard = Math.max(0, statValue('luck') - 5) * 0.012 + talentLevel('lucky') * 0.04;
    const source = sourceName || 'самоповреждение';
    const base = Math.max(0.06, Math.min(0.42, dmg / 105 - enduranceGuard - luckGuard));
    let changed = false;

    if (type === 'explosive') {
      const concussionChance = Math.min(0.92, 0.16 + base * 1.55 + (dmg >= 32 ? 0.14 : 0));
      const fractureChance = Math.min(0.72, (0.04 + base * 0.95 + (dmg >= 28 ? 0.12 : 0)) * Math.max(0.35, 1 - talentLevel('ironBones') * 0.28));
      if (dmg >= 45 || Math.random() < concussionChance) changed = addInjury('concussion', source) || changed;
      if (dmg >= 18 && Math.random() < fractureChance) changed = addInjury(Math.random() < 0.5 ? 'brokenLeg' : 'brokenArm', source) || changed;
    } else {
      const traumaChance = Math.min(0.62, base * 0.95 + (dmg >= 28 ? 0.08 : 0));
      if ((type === 'ballistic' || type === 'energy') && Math.random() < traumaChance) changed = addInjury(Math.random() < 0.55 ? 'brokenArm' : 'brokenLeg', source) || changed;
      if ((type === 'toxic' || type === 'radiation') && Math.random() < Math.min(0.7, base + 0.12)) changed = addInjury('infection', source) || changed;
    }

    if (!changed && dmg >= 30 && Math.random() < 0.25) changed = addInjury('concussion', source) || changed;
    return changed;
  }

  function doctorSuccessChance() {
    return Math.max(0.35, Math.min(0.98, 0.35 + skillNorm('doctor') * 0.55 + Math.max(0, statValue('int') - 5) * 0.025 + talentLevel('surgeon') * 0.08));
  }

  function medicalItemApCost(itemId = '') {
    const id = baseItemId(itemId);
    const base = id === 'doctorBag' ? 3 : (id === 'stim' ? 1 : 2);
    const quickDiscount = talentLevel('quickTreatment') >= 2 ? 1 : 0;
    return Math.max(1, Math.round(base - quickDiscount));
  }

  function medicalItemXp(itemId = '', result = {}) {
    const id = baseItemId(itemId);
    const healed = Math.max(0, Math.round(Number(result.healed || 0)));
    const otherBonus = result.other ? 2 : 0;
    if (id === 'doctorBag') return result.success === false ? 2 : 12 + otherBonus;
    if (id === 'antibiotics') return 8 + otherBonus;
    if (id === 'stim') return Math.max(1, Math.ceil(healed / 10)) + (result.other ? 1 : 0);
    return Math.max(2, Math.ceil(healed / 8)) + otherBonus;
  }

  function awardCharacterActionXp(xp = 0, label = 'Опыт', x = player.x, z = player.z) {
    const amount = Math.max(0, Math.floor(Number(xp || 0)));
    if (amount <= 0) return;
    player.xp += amount;
    createFloatingText(x, z, '+' + amount + ' XP', '#e4c56b');
    addLog(`${label}: +${amount} XP.`, null, 'level');
    if (typeof checkLevelUp === 'function') checkLevelUp();
    queueSave(true);
  }

  function canSpendMedicalItemAp(itemId = '') {
    const apCost = medicalItemApCost(itemId);
    if (Number(player.ap || 0) + 0.01 >= apCost) return true;
    setReadout(`Недостаточно очков действий. Нужно ${apCost} ОД.`);
    return false;
  }

  function spendMedicalItemAp(itemId = '') {
    const apCost = medicalItemApCost(itemId);
    player.ap = Math.max(0, Number(player.ap || 0) - apCost);
    renderWeaponReadout();
    return apCost;
  }

  const INVENTORY_MANIPULATION_AP_COST = 1;

  function canSpendInventoryManipulationAp(action = 'inventory') {
    const apCost = INVENTORY_MANIPULATION_AP_COST;
    if (Number(player.ap || 0) + 0.01 >= apCost) return true;
    setReadout(`Недостаточно очков действий. Любая манипуляция в инвентаре или быстрых слотах требует ${apCost} ОД.`);
    return false;
  }

  function refreshInventoryManipulationApUi() {
    if (typeof renderWeaponReadout === 'function') renderWeaponReadout();
    if (typeof renderPipboyInfoPanels === 'function') renderPipboyInfoPanels();
  }

  function spendInventoryManipulationAp(action = 'inventory') {
    const apCost = INVENTORY_MANIPULATION_AP_COST;
    if (!canSpendInventoryManipulationAp(action)) return 0;
    player.ap = Math.max(0, Number(player.ap || 0) - apCost);
    refreshInventoryManipulationApUi();
    return apCost;
  }

  function refundInventoryManipulationAp(apCost = INVENTORY_MANIPULATION_AP_COST) {
    const cost = Math.max(0, Math.round(Number(apCost || 0)));
    if (cost <= 0) return;
    player.ap = Math.min(Number(player.maxAp || cost), Number(player.ap || 0) + cost);
    refreshInventoryManipulationApUi();
  }

  function requestServerEquipmentAction(slot = '', itemRuntimeId = '', options = {}) {
    if (!multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined) {
      setReadout('Изменение экипировки требует соединения с сервером.');
      return false;
    }
    if (!multiplayer.pendingEquipmentSlots?.add) multiplayer.pendingEquipmentSlots = new Set();
    if (multiplayer.pendingEquipmentSlots.has(slot)) {
      setReadout('Предыдущее изменение этого слота ещё подтверждается сервером.');
      return false;
    }
    if (!canSpendInventoryManipulationAp('equipment')) return false;

    multiplayer.equipmentActionSeq = Math.max(0, Number(multiplayer.equipmentActionSeq || 0)) + 1;
    const requestId = `equipment_${Date.now().toString(36)}_${multiplayer.equipmentActionSeq.toString(36)}`;
    multiplayer.pendingEquipmentSlots.add(slot);
    multiplayer.socket.emit('equipmentAction', {
      requestId,
      expectedRevision: Math.max(0, Math.floor(Number(multiplayer.equipmentRevision || 0))),
      slot,
      itemRuntimeId: String(itemRuntimeId || '').slice(0, 96)
    }, ack => {
      multiplayer.pendingEquipmentSlots.delete(slot);
      if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') {
        applyServerAuthoritativePlayerState(ack.self);
      } else if (Number.isFinite(Number(ack?.equipmentRevision))) {
        multiplayer.equipmentRevision = Math.max(0, Math.floor(Number(ack.equipmentRevision)));
      }
      if (!ack?.ok) {
        setReadout(ack?.error || 'Сервер отклонил изменение экипировки.');
        renderInventory();
        renderQuickbar();
        renderWeaponReadout();
        return;
      }
      if (ack.changed !== false && options.logText) addLog(options.logText, null, 'system');
      if (options.readoutText) setReadout(options.readoutText);
      updatePlayerEquipmentVisuals();
      renderInventory();
      renderQuickbar();
      renderWeaponReadout();
      queueSave(true);
    });
    return true;
  }

  function requestServerSelfMedical(itemId = '', medicalKind = 'aid') {
    const id = baseItemId(itemId);
    if (!multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined) {
      setReadout('Лечение требует соединения с сервером.');
      return false;
    }
    if (!canStartMedicalAction(medicalKind)) return false;
    if (!canSpendMedicalItemAp(id)) return false;
    applyMedicalActionDelay(medicalKind);
    multiplayer.socket.emit('healPlayer', {
      targetId: multiplayer.socket.id,
      itemId: id,
      skillRanks: typeof multiplayerSkillSnapshot === 'function' ? multiplayerSkillSnapshot() : {},
      talentRanks: typeof multiplayerTalentSnapshot === 'function' ? multiplayerTalentSnapshot() : {}
    }, ack => {
      if (!ack || !ack.ok) {
        if (Number.isFinite(Number(ack?.ap))) player.ap = Math.max(0, Number(ack.ap));
        setReadout(ack?.error || 'Сервер отклонил лечение.');
        return;
      }
      if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      else if (Array.isArray(ack.inventory) && typeof applyServerInventorySnapshot === 'function') applyServerInventorySnapshot(ack.inventory);
      if (ack.refundItem === id) addLog('Полевой хирург: медицинский предмет сохранён.', null, 'system');
      queueSave(true);
    });
    return true;
  }

  function useDoctorBag() {
    const treatable = ['brokenArm', 'brokenLeg', 'concussion'].filter(hasInjury);
    if (!treatable.length) {
      addLog('Нет переломов или контузии для лечения набором доктора.', null, 'system');
      return false;
    }
    if (mapBaseQty(inventory, 'doctorBag') <= 0) return false;
    return requestServerSelfMedical('doctorBag', 'doctor');
  }

  function useAntibiotics() {
    if (!hasInjury('infection')) {
      addLog('Инфекции нет.', null, 'system');
      return false;
    }
    if (mapBaseQty(inventory, 'antibiotics') <= 0) return false;
    return requestServerSelfMedical('antibiotics', 'antibiotics');
  }

  function updateMedicalEffects(dt) {
    if (typeof clientWorldRequiresServer === 'function' && clientWorldRequiresServer()) return;
    if (!hasInjury('infection') || player.hp <= 0) return;
    player.infectionTimer = Number(player.infectionTimer || 0) + dt;
    if (player.infectionTimer >= 18) {
      player.infectionTimer = 0;
      player.hp = Math.max(1, player.hp - 1);
      addLog('☣ Инфекция: -1 HP. Нужны антибиотики.', null, 'combat');
      renderUI();
      queueSave();
    }
  }

  function injurySpeedMultiplier() {
    let mul = 1;
    if (hasInjury('brokenLeg')) mul *= 0.68;
    if (hasInjury('infection')) mul *= 0.92;
    return mul;
  }

  function injuryHitPenalty() {
    let p = 0;
    if (hasInjury('brokenArm')) p += 0.12;
    if (hasInjury('concussion')) p += 0.10;
    if (hasInjury('infection')) p += 0.03;
    return p;
  }

  function injuryApPenalty(action = 'attack') {
    if (action === 'reload' && hasInjury('brokenArm')) return 1;
    if (action === 'attack' && hasInjury('brokenArm')) return 1;
    if (action === 'medical' && hasInjury('concussion')) return Math.max(0, 0.25 - talentLevel('quickTreatment') * 0.12);
    return 0;
  }

  function formatMedicalDelay(value = 0) {
    const n = Math.max(0, Number(value || 0));
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  function medicalActionDelay(kind = 'aid') {
    const base = kind === 'doctor' ? 1.05 : (kind === 'antibiotics' ? 0.8 : (kind === 'stim' ? 0.55 : 0.7));
    return Math.max(0.2, base + injuryApPenalty('medical') - talentLevel('quickTreatment') * 0.12);
  }

  function canStartMedicalAction(kind = 'aid') {
    const wait = Math.max(Number(player.fireCooldown || 0), Number(player.reloadTimer || 0));
    if (wait <= 0.01) return true;
    setReadout(`Медицинское действие: подождите ${formatMedicalDelay(wait)} сек.`);
    return false;
  }

  function applyMedicalActionDelay(kind = 'aid') {
    player.fireCooldown = Math.max(Number(player.fireCooldown || 0), medicalActionDelay(kind));
  }

  function speedBonus() {
    const boots = ITEMS[equipment.boots];
    const bootBonus = boots && boots.speed ? boots.speed : 0;
    return bootBonus;
  }

  function weaponDamageText(w = currentWeapon()) {
    return `${w.dmg[0]}-${w.dmg[1]}`;
  }

  function itemStatLine(item) {
    if (!item) return '';
    if (item.stat) return item.stat;
    if (item.type === 'weapon' || (item.type === 'tool' && Array.isArray(item.dmg))) {
      const ammo = item.ammoType ? ` · магазин ${item.loaded}/${item.magSize}` : ' · без патронов';
      const modes = item.ammoType ? (item.automatic ? ' · режимы: одиночный/прицельный/авто' : ' · режимы: одиночный/прицельный') : '';
      const req = item.requiredStrength ? ` · треб. Сила ${item.requiredStrength}` : '';
      const skill = item.weaponSkill ? ` · навык: ${skillName(item.weaponSkill)}` : '';
      const energyRisk = item.weaponSkill === 'energyWeapons' ? ` · риск сбоя ${Math.round(energyFailureChance(item, { id: 'single' }) * 100)}%` : '';
      const condition = typeof item.condition === 'number' ? ` · состояние ${Math.round(item.condition)}%` : '';
      const harvestLabels = { ore: 'руда', wood: 'древесина', liquid: 'вода/нефть' };
      const harvest = item.harvestTool ? ` · добыча: ${harvestLabels[item.harvestTool] || item.harvestTool}` : '';
      return `Урон ${item.dmg[0]}-${item.dmg[1]} · тип ${damageTypeLabel(item.damageType || 'ballistic')} · дальность ${item.range}${ammo}${modes}${req}${skill}${energyRisk}${condition}${harvest} · Вес ${formatWeight(itemWeight(item.id))}`;
    }
    if (item.armor || item.protection || item.thresholds) {
      const condition = typeof item.condition === 'number' ? ` · состояние ${Math.round(item.condition)}%` : '';
      return `${armorProtectionText(item)}${condition} · Вес ${formatWeight(itemWeight(item.id))}`;
    }
    if (item.speed) {
      const condition = typeof item.condition === 'number' ? ` · состояние ${Math.round(item.condition)}%` : '';
      return `Скорость +${item.speed}${condition} · Вес ${formatWeight(itemWeight(item.id))}`;
    }
    if (item.heal) return `Первая помощь +${item.heal} HP · ${medicalItemApCost(item.id)} ОД · Вес ${formatWeight(itemWeight(item.id))}`;
    if (item.doctor) return `Доктор · шанс лечения ${Math.round(doctorSuccessChance() * 100)}% · ${medicalItemApCost(item.id)} ОД · Вес ${formatWeight(itemWeight(item.id))}`;
    if (item.cureInfection) return `Лекарство от инфекции · ${medicalItemApCost(item.id)} ОД · Вес ${formatWeight(itemWeight(item.id))}`;
    if (item.repair) return `Ремонт +${item.repair}% · Вес ${formatWeight(itemWeight(item.id))}`;
    const weightText = `Вес ${formatWeight(itemWeight(item.id))}`;
    if (item.type === 'tool') return `Инструмент · состояние ${Math.round(item.condition ?? 100)}% · ${weightText}`;
    if (typeof item.condition === 'number') return `Состояние ${Math.round(item.condition)}% · ${weightText}`;
    return weightText;
  }

  function equipItem(id) {
    const item = ITEMS[id];
    const slot = itemEquipSlot(item);
    if (!item || !slot || !Object.prototype.hasOwnProperty.call(equipment, slot)) return;
    if ((inventory.get(id) || 0) <= 0) return;
    if (equipment[slot] === id) {
      setReadout(`${item.name}: уже экипировано.`);
      return;
    }
    const actionText = slot === 'weapon' ? 'В руках' : 'Надето';
    requestServerEquipmentAction(slot, id, {
      logText: `${actionText}: ${item.name}. Потрачено ${INVENTORY_MANIPULATION_AP_COST} ОД.`,
      readoutText: `${actionText}: ${item.name}.`
    });
  }


  function unequipSlot(slot) {
    const id = equipment[slot];
    if (!id) return;
    const item = ITEMS[id];
    requestServerEquipmentAction(slot, '', {
      logText: item ? `Снято: ${item.name}. Потрачено ${INVENTORY_MANIPULATION_AP_COST} ОД.` : '',
      readoutText: item ? `Снято: ${item.name}.` : 'Предмет снят.'
    });
  }

  function equippedSlotForItem(id) {
    const key = String(id || '');
    if (!key) return '';
    return Object.keys(equipment).find(slot => equipment[slot] === key) || '';
  }

  function clearEquipmentReferencesToMissing() {
    let changed = false;
    Object.keys(equipment).forEach(slot => {
      const id = equipment[slot];
      if (id && (inventory.get(id) || 0) <= 0) {
        equipment[slot] = null;
        changed = true;
      }
    });
    if (changed) updatePlayerEquipmentVisuals();
    return changed;
  }

  function useMedicalItemOnSelf(id) {
    const item = ITEMS[id];
    if (!item || item.type !== 'consumable') return false;
    if ((inventory.get(id) || 0) <= 0) {
      setReadout(`Нет предмета: ${item.name}.`);
      return false;
    }
    if (item.doctor) return useDoctorBag();
    if (item.cureInfection) return useAntibiotics();
    if (item.heal) {
      if (player.hp >= player.maxHp) {
        addLog('Здоровье уже полное.', null, 'system');
        return false;
      }
      return requestServerSelfMedical(id, baseItemId(id) === 'stim' ? 'stim' : 'aid');
    }
    return false;
  }

  function useInventoryItem(id) {
    const item = ITEMS[id];
    if (!item) return false;
    if (item.type === 'consumable') {
      if (item.repair) {
        setReadout('Выберите предмет для ремонта через ПКМ по оружию, броне или инструменту.');
        return false;
      }
      return useMedicalItemOnSelf(id);
    }
    if (item.type === 'ammo') {
      reloadWeapon();
      return true;
    }
    const equipSlot = itemEquipSlot(item);
    if (equipSlot) {
      equipItem(id);
      return true;
    }
    return false;
  }

  function renderEquipment() {
    const grid = document.getElementById('equipment-grid');
    grid.innerHTML = '';
    Object.keys(SLOT_LABELS).forEach(slot => {
      const item = ITEMS[equipment[slot]];
      const div = document.createElement('div');
      div.className = 'equip-slot' + (item ? '' : ' empty');
      div.dataset.slot = slot;
      div.innerHTML = `<div class="equip-icon">${item ? itemArtHtml(item) : '<span class="item-art-empty">—</span>'}</div><div><div class="equip-name">${item ? item.name : 'Пусто'}</div><div class="equip-type">${SLOT_LABELS[slot]}</div></div>${item ? '<button type="button" class="equip-clear" aria-label="Снять">×</button>' : ''}`;

      div.addEventListener('dragenter', e => { e.preventDefault(); div.classList.add('drag-over'); });
      div.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        div.classList.add('drag-over');
      });
      div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
      div.addEventListener('drop', e => {
        e.preventDefault();
        div.classList.remove('drag-over');
        const itemId = e.dataTransfer.getData('text/item-id') || e.dataTransfer.getData('text/plain') || draggedInventoryItem;
        const dropItem = ITEMS[itemId];
        if (dropItem && itemEquipSlot(dropItem) === slot) equipItem(itemId);
        else setReadout(`В слот «${SLOT_LABELS[slot]}» можно положить только подходящий предмет.`);
        draggedInventoryItem = null;
      });

      if (item) {
        div.addEventListener('contextmenu', e => { e.preventDefault(); showEquippedItemContextMenu(e, slot); });
        const clearBtn = div.querySelector('.equip-clear');
        if (clearBtn) {
          clearBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
          clearBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); unequipSlot(slot); });
        }
        div.addEventListener('mouseenter', e => showTooltip(e, item));
        div.addEventListener('mousemove', moveTooltip);
        div.addEventListener('mouseleave', hideTooltip);
      }
      grid.appendChild(div);
    });

    const stats = document.getElementById('stats-box');
    const held = currentHeldItem();
    const w = currentWeapon();
    const heldItem = held?.item || w;
    const ammoText = w.ammoType ? `${w.loaded}/${w.magSize} · запас ${inventory.get(w.ammoType) || 0}` : 'не нужны';
    const specialRows = specialStatDefs().map(def => {
      const base = Number(characterProfile?.special?.[def.key] ?? DEFAULT_SPECIAL[def.key] ?? 5);
      const bonus = typeof specialBonusFromTalents === 'function' ? specialBonusFromTalents(def.key) : 0;
      const total = typeof statValue === 'function' ? statValue(def.key) : Math.max(1, Math.min(15, base + bonus));
      const bonusText = bonus > 0 ? `<small>+${bonus}</small>` : '';
      const effect = typeof specialEffectDescription === 'function' ? specialEffectDescription(def.key) : def.name;
      return `<div class="special-status-cell" data-special-key="${escapeHtml(def.key)}" title="${escapeHtml(`${def.name}: база ${base}${bonus ? `, бонус перков +${bonus}` : ''}. ${effect}`)}">
        <span>${escapeHtml(def.code)}</span>
        <b>${total}</b>
        ${bonusText}
      </div>`;
    }).join('');
    stats.innerHTML = `
      <div class="special-status-panel">
        <div class="special-status-title">SPECIAL</div>
        <div class="special-status-grid">${specialRows}</div>
      </div>
      <div class="stat-line">В руках: <b>${heldItem.name}</b></div>
      <div class="stat-line">Урон: <b>${weaponDamageText(w)}</b></div>
      <div class="stat-line">Дальность: <b>${w.range}</b></div>
      <div class="stat-line">Патроны: <b>${ammoText}</b></div>
      <div class="stat-line">Броня: <b>${armorValue()}</b></div>
      <div class="stat-line">Скорость: <b>${(player.speed + speedBonus()).toFixed(1)}</b></div>
      <div class="stat-line">Вес: <b>${formatWeight(inventoryWeight())}/${formatWeight(carryCapacity())}</b></div>
      <div class="stat-line">Обзор: <b>${playerVisionRadius()} кл.</b></div>
      <div class="stat-line">ОД: <b>${player.maxAp}</b></div>
      <div class="stat-line">Фракция: <b>${worldFactionLabel(playerWorldFactionId())}</b></div>
      <div class="stat-line">Свободные очки навыков: <b>${player.skillPoints}</b></div>
      <div class="stat-line">Свободные перки: <b>${player.perkPoints}</b></div>
      <div class="stat-line">Навыки выше базы: <b>${learnedSkillCount()}</b></div>
      <div class="stat-line">Изучено перков: <b>${learnedTalentCount()}</b></div>
    `;
    stats.querySelectorAll('.special-status-cell[data-special-key]').forEach(cell => {
      const key = cell.dataset.specialKey;
      const def = specialStatDefs().find(row => row.key === key);
      if (!def) return;
      const base = Number(characterProfile?.special?.[key] ?? DEFAULT_SPECIAL[key] ?? 5);
      const bonus = typeof specialBonusFromTalents === 'function' ? specialBonusFromTalents(key) : 0;
      const effectText = typeof specialEffectDescription === 'function' ? specialEffectDescription(key) : def.desc;
      cell.addEventListener('mouseenter', e => showTooltip(e, {
        name: `${def.name} (${def.code})`,
        desc: `База ${base}${bonus ? `, перки +${bonus}` : ''}. ${def.desc}`,
        stat: effectText
      }));
      cell.addEventListener('mousemove', moveTooltip);
      cell.addEventListener('mouseleave', hideTooltip);
    });
  }

  function equippedSlotSummary(slot, item) {
    if (!item) return 'Перетащите предмет в подходящий слот.';
    if (slot === 'weapon' && Array.isArray(item.dmg)) {
      const ap = Number(item.apCost || 0);
      const range = Number(item.range || 0);
      return `Урон ${item.dmg[0]}-${item.dmg[1]}${range ? ` · ${range} м` : ''}${ap ? ` · ${Math.round(ap)} ОД` : ''}`;
    }
    if (item.armor || item.protection || item.thresholds) {
      if (typeof armorProtectionText === 'function') return armorProtectionText(item);
      return `Броня ${item.armor || 0} · вес ${formatWeight(itemWeight(item.id))}`;
    }
    if (item.speed) return `Скорость +${item.speed} · вес ${formatWeight(itemWeight(item.id))}`;
    if (item.carry) return `Переносимый вес +${formatWeight(item.carry)} · вес ${formatWeight(itemWeight(item.id))}`;
    return itemStatLine(item) || `Вес ${formatWeight(itemWeight(item.id))}`;
  }

  function renderInventoryCharacterPanel() {
    const panel = document.getElementById('inventory-character-panel');
    if (!panel) return;
    const equippedIds = Object.values(equipment).filter(Boolean);
    const characterName = characterProfile?.name || player.name || 'Странник';
    const armor = ITEMS[equipment.armor];
    const helmet = ITEMS[equipment.helmet];
    const weapon = ITEMS[equipment.weapon];
    const stageClasses = [
      'pipboy-character-model',
      armor ? 'has-armor' : '',
      helmet ? 'has-helmet' : '',
      weapon ? 'has-weapon' : ''
    ].filter(Boolean).join(' ');

    panel.innerHTML = `
      <div class="inventory-character-header">
        <div>
          <span>Модель</span>
          <b>${escapeHtml(characterName)}</b>
        </div>
        <small>${equippedIds.length}/${Object.keys(SLOT_LABELS).length} слотов</small>
      </div>
      <div class="inventory-character-stage">
        <div class="inventory-character-grid-glow" aria-hidden="true"></div>
        <div class="${stageClasses}" aria-hidden="true">
          <div class="pcm-head"></div>
          <div class="pcm-neck"></div>
          <div class="pcm-torso"></div>
          <div class="pcm-arm pcm-arm-left"></div>
          <div class="pcm-arm pcm-arm-right"></div>
          <div class="pcm-leg pcm-leg-left"></div>
          <div class="pcm-leg pcm-leg-right"></div>
          <div class="pcm-weapon"></div>
        </div>
        <div id="inventory-equipped-grid" class="inventory-equipped-grid" aria-label="Экипированные предметы"></div>
      </div>
    `;

    const grid = panel.querySelector('#inventory-equipped-grid');
    Object.keys(SLOT_LABELS).forEach(slot => {
      const id = equipment[slot];
      const item = ITEMS[id];
      const slotEl = document.createElement('div');
      slotEl.className = `equip-slot inventory-equip-slot inventory-equip-slot-${slot}${item ? '' : ' empty'}`;
      slotEl.dataset.slot = slot;
      slotEl.innerHTML = `
        <div class="inventory-equip-label">${escapeHtml(SLOT_LABELS[slot])}</div>
        <div class="inventory-equip-icon">${item ? itemArtHtml(item, { className: 'item-art-equipped' }) : '<span class="item-art-empty">—</span>'}</div>
        <div class="inventory-equip-copy">
          <b>${escapeHtml(item ? item.name : 'Пусто')}</b>
          <small>${escapeHtml(equippedSlotSummary(slot, item))}</small>
        </div>
        ${item ? '<button type="button" class="equip-clear inventory-equip-clear" aria-label="Снять">×</button>' : ''}
      `;

      slotEl.addEventListener('dragenter', e => { e.preventDefault(); slotEl.classList.add('drag-over'); });
      slotEl.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        slotEl.classList.add('drag-over');
      });
      slotEl.addEventListener('dragleave', () => slotEl.classList.remove('drag-over'));
      slotEl.addEventListener('drop', e => {
        e.preventDefault();
        slotEl.classList.remove('drag-over');
        const itemId = e.dataTransfer.getData('text/item-id') || e.dataTransfer.getData('text/plain') || draggedInventoryItem;
        const dropItem = ITEMS[itemId];
        if (dropItem && itemEquipSlot(dropItem) === slot) equipItem(itemId);
        else setReadout(`В слот «${SLOT_LABELS[slot]}» можно положить только подходящий предмет.`);
        draggedInventoryItem = null;
      });

      if (item) {
        slotEl.addEventListener('contextmenu', e => { e.preventDefault(); showEquippedItemContextMenu(e, slot); });
        slotEl.addEventListener('mouseenter', e => showTooltip(e, item));
        slotEl.addEventListener('mousemove', moveTooltip);
        slotEl.addEventListener('mouseleave', hideTooltip);
        const clearBtn = slotEl.querySelector('.inventory-equip-clear');
        if (clearBtn) {
          clearBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
          clearBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); unequipSlot(slot); });
        }
      } else {
        slotEl.dataset.gameHint = `Слот «${SLOT_LABELS[slot]}»: перетащите сюда подходящий предмет.`;
      }
      grid.appendChild(slotEl);
    });
  }

  function isSellableItem(id) {
    const item = ITEMS[id];
    return !!(item && id !== 'silver' && (inventory.get(id) || 0) > 0);
  }


  function bindMobileItemLongPress(card, itemId) {
    if (!card) return;
    let timer = null;
    let startX = 0;
    let startY = 0;
    let fired = false;
    let pointerId = null;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pointerId = null;
    };
    card.addEventListener('pointerdown', e => {
      if (!isMobileControlsEnabled() || e.pointerType !== 'touch') return;
      if (e.target && e.target.closest && e.target.closest('.mobile-quick-pick')) return;
      hideTooltip();
      fired = false;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      clearTimeout(timer);
      timer = setTimeout(() => {
        fired = true;
        try { if (navigator.vibrate) navigator.vibrate(18); } catch (_) {}
        hideTooltip();
        showItemContextMenu({ clientX: startX, clientY: startY, preventDefault(){}, stopPropagation(){} }, itemId);
      }, 470);
    }, { passive: false });
    card.addEventListener('pointermove', e => {
      if (!timer || pointerId !== e.pointerId) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 18) clear();
    }, { passive: true });
    card.addEventListener('dragstart', e => { if (isMobileControlsEnabled()) e.preventDefault(); });
    card.addEventListener('contextmenu', e => { if (isMobileControlsEnabled()) e.preventDefault(); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => {
      card.addEventListener(type, e => {
        if (pointerId !== null && e.pointerId !== undefined && pointerId !== e.pointerId) return;
        clear();
      }, { passive: true });
    });
    card.addEventListener('click', e => {
      if (!fired) return;
      e.preventDefault();
      e.stopPropagation();
      fired = false;
    }, true);
  }

  const SORT_MODE_SEQUENCE = ['type', 'weight', 'price'];
  const SORT_MODE_LABELS = { type: 'по типу', weight: 'по весу', price: 'по стоимости' };
  const sortModes = { inventory: 'type', storageInventory: 'type', storage: 'type' };
  const ITEM_CATEGORY_TABS = [
    { id: 'all', label: 'Всё' },
    { id: 'weapons', label: 'Оружие' },
    { id: 'armor', label: 'Броня' },
    { id: 'aid', label: 'Мед.' },
    { id: 'ammo', label: 'Патроны' },
    { id: 'tools', label: 'Инструм.' },
    { id: 'materials', label: 'Материалы' },
    { id: 'misc', label: 'Разное' }
  ];
  const itemCategoryFilters = {
    inventory: 'all',
    storageInventory: 'all',
    storage: 'all',
    traderPlayer: 'all',
    traderVendor: 'all'
  };

  function itemCategoryFor(id) {
    const item = ITEMS[id] || {};
    const type = String(item.type || '').toLowerCase();
    if (id === 'silver' || type === 'money') return 'misc';
    if (type === 'weapon') return 'weapons';
    if (['armor', 'helmet', 'boots', 'backpack'].includes(type) || item.slot === 'armor' || item.slot === 'helmet' || item.slot === 'boots' || item.slot === 'backpack') return 'armor';
    if (type === 'ammo') return 'ammo';
    if (item.heal || item.doctor || item.cureInfection) return 'aid';
    if (type === 'tool' || item.repair) return 'tools';
    if (type === 'material') return 'materials';
    return 'misc';
  }

  function itemMatchesCategory(id, category = 'all') {
    const safeCategory = itemCategoryFilters[category] ? itemCategoryFilters[category] : category;
    if (!safeCategory || safeCategory === 'all') return true;
    return itemCategoryFor(id) === safeCategory;
  }

  function itemCategoryLabel(category = 'all') {
    return ITEM_CATEGORY_TABS.find(tab => tab.id === category)?.label || 'Всё';
  }

  function itemCategoryAvailability(entries = []) {
    const available = new Set(['all']);
    entries.forEach(entry => {
      const id = Array.isArray(entry) ? entry[0] : entry?.id;
      const qty = Array.isArray(entry) ? entry[1] : entry?.qty;
      if (!ITEMS[id] || Number(qty || 0) <= 0) return;
      available.add(itemCategoryFor(id));
    });
    return available;
  }

  function setItemCategoryFilter(scope, category) {
    if (!Object.prototype.hasOwnProperty.call(itemCategoryFilters, scope)) return false;
    itemCategoryFilters[scope] = ITEM_CATEGORY_TABS.some(tab => tab.id === category) ? category : 'all';
    if (scope === 'inventory') renderInventory();
    else if (scope === 'storageInventory' || scope === 'storage') renderStorageWindow();
    else if (scope === 'traderPlayer' || scope === 'traderVendor') renderTraderWindow();
    return true;
  }

  function renderItemCategoryTabs(containerId, scope, entries = []) {
    const root = document.getElementById(containerId);
    if (!root) return;
    const active = itemCategoryFilters[scope] || 'all';
    const available = itemCategoryAvailability(entries);
    const signature = `${scope}|${ITEM_CATEGORY_TABS.map(tab => `${tab.id}:${tab.label}`).join('|')}`;
    if (root.dataset.categorySignature !== signature) {
      root.textContent = '';
      root.dataset.categorySignature = signature;
      root._itemCategoryButtons = [];
      ITEM_CATEGORY_TABS.forEach(tab => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'item-category-tab';
        btn.dataset.category = tab.id;
        btn.setAttribute('role', 'tab');
        btn.textContent = tab.label;
        btn.addEventListener('click', () => setItemCategoryFilter(scope, tab.id));
        root.appendChild(btn);
        root._itemCategoryButtons.push(btn);
      });
    }
    const buttons = root._itemCategoryButtons || Array.from(root.querySelectorAll('.item-category-tab'));
    buttons.forEach(btn => {
      const category = btn.dataset.category || 'all';
      const selected = active === category;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      btn.disabled = category !== 'all' && !available.has(category);
    });
  }

  function itemSortPrice(id) {
    const item = ITEMS[id] || {};
    if (id === 'silver') return 1;
    if (typeof getSellPrice === 'function') {
      try { return Number(getSellPrice(id) || 0); } catch (_) {}
    }
    return Number(item.price || item.value || 0);
  }

  function compareItemEntries(mode = 'type') {
    return ([aId, aQty], [bId, bQty]) => {
      const a = ITEMS[aId] || {}, b = ITEMS[bId] || {};
      if (mode === 'weight') {
        const aw = itemWeight(aId) * (aQty || 1), bw = itemWeight(bId) * (bQty || 1);
        if (bw !== aw) return bw - aw;
      } else if (mode === 'price') {
        const ap = itemSortPrice(aId) * (aQty || 1), bp = itemSortPrice(bId) * (bQty || 1);
        if (bp !== ap) return bp - ap;
      } else {
        const order = { weapon: 1, armor: 2, helmet: 2.1, boots: 2.2, backpack: 2.3, ammo: 3, consumable: 4, tool: 5, material: 6, misc: 7, loot: 8, money: 9 };
        const typeCmp = (order[a.type] || 50) - (order[b.type] || 50);
        if (typeCmp) return typeCmp;
      }
      const nameCmp = String(a.name || aId).localeCompare(String(b.name || bId), 'ru');
      if (nameCmp) return nameCmp;
      return String(aId).localeCompare(String(bId));
    };
  }

  function sortItemMap(map, mode = 'type') {
    const entries = Array.from(map.entries()).filter(([id, qty]) => ITEMS[id] && qty > 0);
    entries.sort(compareItemEntries(mode));
    map.clear();
    entries.forEach(([id, qty]) => map.set(id, qty));
  }

  function nextSortMode(key) {
    const current = sortModes[key] || 'type';
    const idx = SORT_MODE_SEQUENCE.indexOf(current);
    const next = SORT_MODE_SEQUENCE[(idx + 1) % SORT_MODE_SEQUENCE.length];
    sortModes[key] = next;
    return next;
  }

  function updateSortButtonLabels() {
    const set = (id, base, key) => {
      const btn = document.getElementById(id);
      if (btn) btn.innerHTML = `${base} <span class="sort-mode-label">${SORT_MODE_LABELS[sortModes[key] || 'type']}</span>`;
    };
    set('inventory-sort-btn', 'Сортировать', 'inventory');
    set('storage-sort-inventory', 'Сортировать рюкзак', 'storageInventory');
    set('storage-sort-box', 'Сортировать ящик', 'storage');
  }

  function reorderMapEntryAtIndex(map, draggedId, targetId = null, targetIndex = null) {
    if (!draggedId || !map.has(draggedId) || draggedId === targetId) return false;
    const entries = Array.from(map.entries());
    const beforeOrder = entries.map(([id]) => id).join('\u001f');
    const dragged = entries.find(([id]) => id === draggedId);
    if (!dragged) return false;
    const rest = entries.filter(([id]) => id !== draggedId);
    let idx;
    if (Number.isFinite(Number(targetIndex))) idx = Math.max(0, Math.min(rest.length, Math.floor(Number(targetIndex))));
    else idx = targetId ? rest.findIndex(([id]) => id === targetId) : rest.length;
    if (idx < 0) idx = rest.length;
    rest.splice(idx, 0, dragged);
    const afterOrder = rest.map(([id]) => id).join('\u001f');
    if (afterOrder === beforeOrder) return false;
    if (map === inventory && !spendInventoryManipulationAp('inventory-move')) return false;
    map.clear();
    rest.forEach(([id, qty]) => map.set(id, qty));
    queueSave();
    return true;
  }

  function reorderMapEntry(map, draggedId, targetId = null) {
    return reorderMapEntryAtIndex(map, draggedId, targetId, null);
  }


  let manualDragJustEnded = false;

  function normalizeManualDragSource(source) {
    return source === 'inventory-main' ? 'inventory' : source;
  }

  function closestDropTarget(el) {
    if (!el || !el.closest) return null;
    const equip = el.closest('.equip-slot');
    if (equip) return { kind: 'equipment', el: equip };
    const sellZone = el.closest('#trade-sell-zone');
    if (sellZone) return { kind: 'trade-sell', el: sellZone };
    const quick = el.closest('.quick-slot');
    if (quick) return { kind: 'quickbar', el: quick };
    const invSlot = el.closest('#inventory-grid .inv-card');
    if (invSlot) return { kind: 'inventory-main', el: invSlot };
    const storageSlot = el.closest('#storage-inventory-grid .inv-card, #storage-grid .inv-card');
    if (storageSlot) return { kind: storageSlot.closest('#storage-grid') ? 'storage' : 'inventory', el: storageSlot };
    const storageGrid = el.closest('#storage-inventory-grid, #storage-grid');
    if (storageGrid) return { kind: storageGrid.id === 'storage-grid' ? 'storage' : 'inventory', el: storageGrid };
    return null;
  }

  function isPointInsideInventoryWindow(clientX, clientY) {
    const win = document.getElementById('inventory-window');
    if (!win || !win.classList.contains('visible')) return false;
    const r = win.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function handleManualItemDrop(payload, clientX, clientY) {
    if (!payload || !payload.itemId) return false;
    const target = closestDropTarget(document.elementFromPoint(clientX, clientY));
    if (!target) {
      // Выброс за пределы интерфейса тоже должен уважать размер стака.
      // Раньше тут принудительно уходила 1 штука, поэтому игрок не видел выбор количества.
      const inventoryWindow = document.getElementById('inventory-window');
      const inventoryWindowOpen = !!(inventoryWindow && inventoryWindow.classList.contains('visible'));
      if (payload.source === 'inventory-main' && inventoryWindowOpen && !isPointInsideInventoryWindow(clientX, clientY)) {
        return typeof requestDropInventoryItemWithConfirm === 'function'
          ? requestDropInventoryItemWithConfirm(payload.itemId)
          : requestDropInventoryItem(payload.itemId);
      }
      return false;
    }

    // Если быстрый слот перетащили не на другой быстрый слот, очищаем назначение.
    // Сам предмет остаётся в инвентаре: удаляется только привязка к панели быстрого доступа.
    if (payload.source === 'quickbar' && target.kind !== 'quickbar') {
      const idx = Number(payload.quickIndex);
      if (Number.isFinite(idx)) {
        clearQuickSlot(idx);
      }
      return true;
    }

    if (target.kind === 'equipment') {
      const item = ITEMS[payload.itemId];
      const slot = target.el.dataset.slot;
      if (item && itemEquipSlot(item) === slot) {
        equipItem(payload.itemId);
        return true;
      }
      setReadout(slot && SLOT_LABELS[slot] ? `В слот «${SLOT_LABELS[slot]}» можно положить только подходящий предмет.` : 'Сюда нельзя положить этот предмет.');
      return false;
    }

    if (target.kind === 'trade-sell') {
      const source = normalizeManualDragSource(payload.source);
      if (source === 'inventory' && isSellableItem(payload.itemId)) {
        queueSaleFromInventoryWithAmount(payload.itemId);
        return true;
      }
      return false;
    }

    if (target.kind === 'quickbar') {
      const idx = Number(target.el.dataset.quickIndex);
      if (!Number.isFinite(idx)) return false;
      if (payload.source === 'quickbar') moveQuickSlot(Number(payload.quickIndex), idx);
      else assignQuickSlot(idx, payload.itemId);
      return true;
    }

    if (target.kind === 'inventory-main') {
      if (payload.source !== 'inventory-main') return false;
      const targetId = target.el.dataset.itemId || null;
      const idx = Number(target.el.dataset.slotIndex);
      if (reorderMapEntryAtIndex(inventory, payload.itemId, targetId, Number.isFinite(idx) ? idx : null)) {
        renderInventory();
        setReadout('Предмет перемещён в выбранную ячейку рюкзака.');
        return true;
      }
      return false;
    }

    if (target.kind === 'inventory' || target.kind === 'storage') {
      if (!storageWindowOpen) return false;
      const source = normalizeManualDragSource(payload.source);
      const targetSource = target.kind;
      const targetId = target.el && target.el.dataset ? (target.el.dataset.itemId || null) : null;
      const idx = target.el && target.el.dataset ? Number(target.el.dataset.slotIndex) : NaN;
      if (source === targetSource) {
        const map = mapForStorageSource(source);
        if (reorderMapEntryAtIndex(map, payload.itemId, targetId, Number.isFinite(idx) ? idx : null)) {
          renderStorageWindow();
          renderInventory();
          setReadout(source === 'storage' ? 'Предмет перемещён в ячейку хранилища.' : 'Предмет перемещён в ячейку рюкзака.');
          return true;
        }
      } else if ((source === 'inventory' || source === 'storage') && (targetSource === 'inventory' || targetSource === 'storage')) {
        requestStorageTransfer(payload.itemId, source);
        return true;
      }
    }
    return false;
  }

  function bindPointerItemDrag(el, getPayload) {
    if (!el || el.dataset.pointerDragBound === '1') return;
    el.dataset.pointerDragBound = '1';
    el.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button, input, textarea, select, .ctx-option')) return;
      const payload = typeof getPayload === 'function' ? getPayload() : getPayload;
      if (!payload || !payload.itemId) return;
      // На телефоне оставляем обычные предметы без drag, чтобы не ломать скролл окон,
      // но быстрые слоты можно перетаскивать наружу/в другой быстрый слот для очистки или переноса.
      if (isMobileControlsEnabled() && e.pointerType === 'touch' && payload.source !== 'quickbar') return;
      if (payload.source === 'quickbar') {
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
      }
      let startX = e.clientX;
      let startY = e.clientY;
      let dragging = false;
      let ghost = null;
      let cancelled = false;

      const cleanup = () => {
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onCancel, true);
        if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
        document.body.classList.remove('manual-item-dragging');
        draggedInventoryItem = null;
        draggedStorageItem = null;
        draggedQuickSlot = null;
      };
      const startDrag = () => {
        if (dragging || cancelled) return;
        dragging = true;
        manualDragJustEnded = false;
        hideTooltip();
        hideItemContextMenu();
        const source = normalizeManualDragSource(payload.source);
        if (source === 'inventory') draggedInventoryItem = payload.itemId;
        else if (source === 'storage') draggedStorageItem = payload.itemId;
        else if (payload.source === 'quickbar') draggedQuickSlot = Number(payload.quickIndex);
        ghost = el.cloneNode(true);
        ghost.classList.add('manual-drag-ghost');
        ghost.style.left = startX + 'px';
        ghost.style.top = startY + 'px';
        document.body.appendChild(ghost);
        document.body.classList.add('manual-item-dragging');
      };
      const onMove = ev => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) > 8) startDrag();
        if (!dragging) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (ghost) {
          ghost.style.left = ev.clientX + 'px';
          ghost.style.top = ev.clientY + 'px';
        }
      };
      const onUp = ev => {
        if (dragging) {
          ev.preventDefault();
          ev.stopPropagation();
          const dropped = handleManualItemDrop(payload, ev.clientX, ev.clientY);
          if (!dropped && payload.source === 'quickbar') {
            const idx = Number(payload.quickIndex);
            if (Number.isFinite(idx)) clearQuickSlot(idx);
          }
          manualDragJustEnded = true;
          setTimeout(() => { manualDragJustEnded = false; }, 140);
        }
        cleanup();
      };
      const onCancel = () => { cancelled = true; cleanup(); };

      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onCancel, true);
    }, { passive: false });
  }

  function bindInventorySlotDrop(card, targetId = null, targetIndex = null) {
    if (!card) return;
    card.addEventListener('dragover', e => {
      const source = e.dataTransfer?.getData('text/source');
      if (source && source !== 'inventory-main') return;
      e.preventDefault();
      card.classList.add('drag-over-slot');
    });
    card.addEventListener('dragleave', e => {
      if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over-slot');
    });
    card.addEventListener('drop', e => {
      e.preventDefault();
      hideTooltip();
      card.classList.remove('drag-over-slot');
      const source = e.dataTransfer?.getData('text/source');
      if (source && source !== 'inventory-main') return;
      const draggedId = e.dataTransfer?.getData('text/item-id') || draggedInventoryItem;
      const index = targetIndex !== null && targetIndex !== undefined ? targetIndex : Number(card.dataset.slotIndex);
      if (reorderMapEntryAtIndex(inventory, draggedId, targetId, Number.isFinite(index) ? index : null)) {
        draggedInventoryItem = null;
        renderInventory();
        setReadout('Предмет перемещён в выбранную ячейку рюкзака.');
      }
    });
  }

  function renderInventory() {
    const grid = document.getElementById('inventory-grid');
    if (!grid) return;
    renderMobileInventoryQuickbar();
    grid.innerHTML = '';
    renderInventoryCharacterPanel();
    const inventoryEntries = Array.from(inventory.entries()).map(([id, qty], slotIndex) => ({ id, qty, slotIndex }))
      .filter(row => ITEMS[row.id] && row.qty > 0);
    renderItemCategoryTabs('inventory-category-tabs', 'inventory', inventoryEntries.map(row => [row.id, row.qty]));
    const activeCategory = itemCategoryFilters.inventory || 'all';
    const equippedOrder = new Map(Object.values(equipment).filter(Boolean).map((id, index) => [id, index]));
    const visibleEntries = inventoryEntries
      .filter(row => itemMatchesCategory(row.id, activeCategory))
      .sort((a, b) => {
        const aEquipped = equippedOrder.has(a.id);
        const bEquipped = equippedOrder.has(b.id);
        if (aEquipped !== bEquipped) return aEquipped ? -1 : 1;
        if (aEquipped && bEquipped) return equippedOrder.get(a.id) - equippedOrder.get(b.id);
        return a.slotIndex - b.slotIndex;
      });
    if (activeCategory !== 'all' && !visibleEntries.length) {
      grid.innerHTML = `<div class="inventory-category-empty">В разделе «${itemCategoryLabel(activeCategory)}» пока пусто.</div>`;
    }
    visibleEntries.forEach(({ id, qty, slotIndex }) => {
      const item = ITEMS[id];
      if (!item || qty <= 0) return;
      const equipped = Object.values(equipment).includes(id);
      const quickable = isQuickAssignableItem(id);
      const sellable = isSellableItem(id);
      const draggable = true;
      const card = document.createElement('div');
      card.dataset.dragArea = 'inventory-main';
      card.dataset.itemId = id;
      card.dataset.slotIndex = String(slotIndex);
      card.className = 'inv-card' +
        (equipped ? ' equipped' : '') +
        (quickable ? ' quickable' : ' not-quickable') +
        (mobileQuickAssignItem === id ? ' selected-for-quickbar' : '');
      const equippedHint = 'Предмет сейчас на персонаже. Сначала снимите его, если хотите продать, разобрать или заменить.';
      const tag = equipped ? '<div class="inv-tag inv-equipped-badge">ЭКИПИРОВАНО</div>' : (quickable ? '<div class="inv-tag">быстр.</div>' : '');
      const price = traderWindowOpen && sellable ? `<div class="inv-price">${getSellPrice(id)} 🪙</div>` : '';
      const countClass = traderWindowOpen && sellable ? ' has-price' : '';
      const count = qty > 1 || ['ammo', 'money', 'material', 'loot'].includes(item.type) ? `<div class="inv-count${countClass}">${qty}</div>` : '';
      const weight = `<div class="inv-weight">${formatWeight(itemWeight(id) * qty)}</div>`;
      const quickPick = quickable ? '<button type="button" class="mobile-quick-pick" aria-label="Назначить в быстрый доступ">⚡</button>' : '';
      card.innerHTML = `${tag}${weight}<div class="inv-emoji">${itemArtHtml(item)}</div><div class="inv-name">${item.name}</div>${quickPick}${price}${count}`;
      card.setAttribute('draggable', isMobileControlsEnabled() ? 'false' : 'true');
      const hasDirectUse = itemHasInventoryUseAction(item);
      const itemHint = traderWindowOpen && sellable
        ? `Цена продажи: ${getSellPrice(id)} крышек. Перетащите в зону продажи или дважды нажмите, чтобы добавить в продажу.`
        : hasDirectUse
          ? 'Двойной клик — использовать сразу. ПКМ — дополнительные действия с предметом.'
          : itemEquipSlot(item)
            ? 'Двойной клик — экипировать. Перетащите в подходящий слот персонажа.'
            : (quickable ? 'Перетащите в нижний слот 1–8. Двойной клик — использовать.' : 'ПКМ — действия с предметом.');
      card.dataset.gameHint = equipped ? equippedHint : itemHint;
      card.addEventListener('dragstart', e => {
        hideTooltip();
        if (!draggable) { e.preventDefault(); return; }
        draggedInventoryItem = id;
        e.dataTransfer.setData('text/item-id', id);
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.setData('text/source', 'inventory-main');
        e.dataTransfer.effectAllowed = 'copyMove';
      });
      card.addEventListener('dragend', () => { draggedInventoryItem = null; });
      const quickPickBtn = card.querySelector('.mobile-quick-pick');
      if (quickPickBtn) {
        let lastQuickPickAt = 0;
        const pickQuickSlot = e => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation?.();
          const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          if (now - lastQuickPickAt < 160) return;
          lastQuickPickAt = now;
          setMobileQuickAssignItem(id);
        };
        quickPickBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
        quickPickBtn.addEventListener('pointerup', pickQuickSlot, { passive: false });
        quickPickBtn.addEventListener('touchend', pickQuickSlot, { passive: false });
        quickPickBtn.addEventListener('click', pickQuickSlot);
      }
      card.addEventListener('click', e => {
        if (manualDragJustEnded) { e.preventDefault(); e.stopPropagation(); return; }
        if (isMobileControlsEnabled()) {
          e.preventDefault();
          if (traderWindowOpen && sellable) queueSaleFromInventoryWithAmount(id);
          else {
            const tooltip = document.getElementById('tooltip');
            if (tooltip && tooltip.style.display !== 'none' && tooltip.dataset.itemId === id) {
              tooltip.dataset.itemId = '';
              hideTooltip();
            } else {
              if (tooltip) tooltip.dataset.itemId = id;
              showTooltip(e, item);
            }
          }
          return;
        }
        if (traderWindowOpen && sellable) setReadout(`${item.name}: цена продажи ${getSellPrice(id)} крышек. Перетащите в зону продажи.`);
        else if (quickable) setReadout(`${item.name}: перетащите предмет в быстрый слот 1–8.`);
        else setReadout(`${item.name}: ПКМ откроет доступные действия.`);
      });
      card.addEventListener('dblclick', e => {
        e.preventDefault();
        if (traderWindowOpen && sellable) queueSaleFromInventoryWithAmount(id);
        else useInventoryItem(id);
      });
      card.addEventListener('contextmenu', e => {
        e.preventDefault();
        showItemContextMenu(e, id);
      });
      bindMobileItemLongPress(card, id);
      bindPointerItemDrag(card, () => ({ source: 'inventory-main', itemId: id, slotIndex }));
      bindInventorySlotDrop(card, id, slotIndex);
      card.addEventListener('mouseenter', e => showTooltip(e, equipped
        ? { ...item, stat: `${itemStatLine(item)} · экипировано` }
        : traderWindowOpen && sellable
          ? { ...item, stat: `${itemStatLine(item)} · продажа ${getSellPrice(id)} крышек` }
          : item));
      card.addEventListener('mousemove', moveTooltip);
      card.addEventListener('mouseleave', hideTooltip);
      grid.appendChild(card);
    });
    const filledSlots = grid.querySelectorAll('.inv-card:not(.empty-slot)').length;
    const visibleSlots = Math.max(16, Math.ceil(Math.max(filledSlots, 1) / 4) * 4);
    for (let i = filledSlots; i < visibleSlots; i++) {
      const empty = document.createElement('div');
      empty.className = 'inv-card empty-slot';
      empty.dataset.dragArea = 'inventory-main';
      empty.innerHTML = '<div class="empty-slot-mark">·</div>';
      empty.dataset.slotIndex = String(i);
      if (activeCategory === 'all') bindInventorySlotDrop(empty, null, i);
      grid.appendChild(empty);
    }
    updateCarryReadouts();
    renderEquipment();
    renderWeaponReadout();
    renderInjuryStatusPanels();
    renderPipboyInfoPanels();
    setPipboyInventoryPage(pipboyActiveTab, { noRender: true });
    renderTalentTree();
    renderCraftingWindow();
    if (storageWindowOpen) renderStorageWindow();
  }

  function skillFormulaText(id) {
    const value = skillPercent(id);
    const norm = skillNorm(id);
    const pct = n => `${Math.round(Number(n || 0) * 100)}%`;
    const pp = n => `${Math.round(Number(n || 0) * 100)} п.п.`;
    if (id === 'lightWeapons') return `Формула: норма=(${value}-20)/80=${norm.toFixed(2)}; попадание оружием с патронами +${pp(0.30 * norm)}. Авто-режим получает штраф точности 18 п.п. − ${pp(0.08 * norm)}, затем учитываются Сила, движение, присед, состояние и перки. Общий шанс также получает штрафы: состояние<70 −0.25 п.п.×(70−состояние), движение −3.5 п.п., инфекция −3 п.п., контузия −10 п.п., перелом руки −12 п.п.`;
    if (id === 'heavyWeapons') return `Формула: норма=(${value}-20)/80=${norm.toFixed(2)}; попадание тяжёлым оружием +${pp(0.30 * norm)}. Авто-режим получает штраф точности 18 п.п. − ${pp(0.08 * norm)}, затем учитываются Сила, движение, присед, состояние и перки. Общий шанс также получает штрафы: состояние<70 −0.25 п.п.×(70−состояние), движение −3.5 п.п., инфекция −3 п.п., контузия −10 п.п., перелом руки −12 п.п.`;
    if (id === 'energyWeapons') return `Формула: попадание энергооружием +${pp(0.30 * norm)}; сырой урон +floor((ИН−5)/2). Попадание получает штраф состояния<70 −0.25 п.п.×(70−состояние), движения −3.5 п.п., инфекции −3 п.п., контузии −10 п.п. и перелома руки −12 п.п. Риск сбоя = clamp 1–36%: база оружия×(1−0.55×норма) + 0.3 п.п.×(65−состояние, если состояние<65) + авто +4 п.п. − 3.5 п.п.×«Энергетик».`;
    if (id === 'throwing') return `Формула: взрывное оружие получает +${pp(0.08 * norm)} к попаданию и +${(0.45 * norm).toFixed(2)} м к радиусу взрыва.`;
    if (id === 'melee') return `Формула: ближнее попадание +${pp(0.18 * norm)}; урон +${Math.round(norm * 6)} от навыка, плюс Сила и перки.`;
    if (id === 'unarmed') return `Формула: попадание без оружия +${pp(0.18 * norm)}; урон +${Math.round(norm * 4)} от навыка, плюс Сила и перки.`;
    if (id === 'doctor') return `Формула лечения: шанс = 35% + 55%×норма + 2.5 п.п.×(ИН−5) + 8 п.п.×ранг «Хирурга», максимум 98%. Сейчас база навыка: ${pct(0.35 + 0.55 * norm)}.`;
    if (id === 'firstAid') return `Формула лечения HP: итог = clamp 1–95 HP: база предмета + ${Math.round(norm * 24)} HP от навыка + 8 HP×ранг «Полевого санитара»; фактическое лечение не выше недостающего HP.`;
    if (id === 'stealth') return `Формула скрытности: в приседе радиус обнаружения ×max(35%, 1−44%×норма−11%×«Привидение»). Шум действий в приседе ×max(45%, 1−22%×норма−17%×«Привидение»).`;
    if (id === 'lockpick') return `Формула замка: шанс = clamp 3–92%: 18% + 55%×норма + 2.5 п.п.×(ЛВ−5) + 1.2 п.п.×(УД−5) + 2.5 п.п.×«Быстрые руки» − 0.6 п.п.×сложность.`;
    if (id === 'traps') return `Формула ловушек: после провала защитной системы задержка = база 9 сек. для замка или 11 сек. для терминала × max(55%, 1−35%×норма).`;
    if (id === 'science') return `Формула терминала: шанс = clamp 2–90%: 14% + 58%×норма науки + 12%×норма ремонта + 3 п.п.×(ИН−5) + 3.5 п.п.×«Инженер» + 2 п.п.×«Энергетик» − 0.65 п.п.×сложность. Техпроверка Клима = clamp 8–94%: 18% + 50%×норма науки + 12%×норма ремонта + 3.5 п.п.×(ИН−5) + 7 п.п.×«Инженер».`;
    if (id === 'repair') return `Формула ремонта: ремкомплект +40+round(40×норма) состояния; без ремкомплекта +18+round(22×норма), затем не выше 100 состояния. Также влияет на терминалы, крафт и шанс разбора.`;
    if (id === 'speech') return `Формула речи: проверка Клима = clamp 8–94%: 22% + 55%×норма + 3.5 п.п.×max(0, ХР−5) + 8 п.п.×«Дипломат». Награда квестов ×(1 + 18%×норма + 2%×max(0, ХР−5) + 8%×«Дипломат» + бонус договорённости 25–30%).`;
    if (id === 'barter') return `Формула торговли: продажа ×(1 + 30%×норма + 8%×«Торговец» + 4%×(ХР−5)); покупка −(24%×норма + 5%×«Торговец»), максимум скидки 48%; перепродажа товаров торговца ограничена 85% текущей цены покупки.`;
    if (id === 'wanderer') return `Формула находок: очки поиска = «Редкая находка» + «Нюх на тайники» + черта + floor(3×норма). На сервере каждый балл даёт до +2 крышек, шанс патронов +10/14 п.п. и шанс медикаментов +6 п.п.; у врагов балл также повышает патроны +12 п.п., стимулятор +6 п.п. и меднабор +5 п.п. Добыча ресурсов: доп. ресурс +12 п.п.×норма, общий шанс ограничен 78%. Глобальная карта: 1 клетка = 10 км, скорость = 3,6–6,0 км/ч по норме навыка.`;
    return `Формула: значение навыка ${value}%, норма=(${value}-20)/80=${norm.toFixed(2)}.`;
  }

  function talentFormulaText(talentOrId) {
    const id = typeof talentOrId === 'string' ? talentOrId : talentOrId?.id;
    const formulas = {
      gunslinger: 'Формула: одиночный/прицельный выстрел оружием с патронами получает +7 п.п. к попаданию за ранг.',
      automaticMan: 'Формула: штраф точности авто-режима лёгкого оружия −3 п.п. за ранг.',
      heavyShooter: 'Формула: попадание тяжёлым оружием +6 п.п. за ранг.',
      machineGunner: 'Формула: штраф точности авто-режима тяжёлого оружия −4 п.п. за ранг.',
      pyromaniac: 'Формула: огненное оружие получает +4 п.п. к попаданию и +12% сырого урона до брони за ранг.',
      energyTech: 'Формула: энергооружие +5 п.п. к попаданию за ранг; штраф точности авто-режима энергооружия −3 п.п. за ранг; риск сбоя −3.5 п.п. за ранг.',
      grenadier: 'Формула: взрывное оружие +6 п.п. к попаданию и +0.2 м к радиусу взрыва за ранг.',
      meleeBreaker: 'Формула: оружие ближнего боя получает +2 урона за ранг.',
      unarmedFighter: 'Формула: без оружия +4 п.п. к попаданию и +2 урона за ранг.',
      sharpshooter: 'Формула: оружие с патронами получает +2 сырого урона за ранг до брони цели.',
      ambush: 'Формула: атака из приседа по цели вне погони/атаки получает +8 п.п. к попаданию и множитель урона ×(1+14%×ранг).',
      vigilance: 'Формула: радиус обзора +1 клетка за ранг.',
      nightVision: 'Формула: ночной штраф обзора уменьшается на 1 клетку за ранг, вечерний штраф на 0.5 клетки за ранг.',
      awareness: 'Формула: боевой модификатор +0; открывает точные HP цели и прогноз урона текущего оружия после навыков, перков, режима и брони.',
      ghost: 'Формула: в приседе радиус обнаружения −11 п.п. и шум −17 п.п. за ранг в формулах скрытности.',
      fieldMedic: 'Формула: аптечки и стимуляторы лечат +8 HP за ранг.',
      quickTreatment: 'Формула: задержка медицинских действий −0.12 сек. за ранг; штраф контузии к медицине max(0, 0.25−0.12×ранг).',
      surgeon: 'Формула: шанс лечения набором доктора +8 п.п. за ранг.',
      immunologist: 'Формула: шанс инфекции ×max(45%, 1−25%×ранг).',
      fieldSurgeon: 'Формула: шанс сохранить набор доктора = min(70%, 25%×ранг + 8%×норма Доктора).',
      quickHands: 'Формула: стоимость перезарядки max(1 ОД, цена оружия−1×ранг+штраф травмы); замки max(2 ОД, 3−floor((ранг+«Живчик»)/2)).',
      engineer: 'Формула: техкрафт боеприпасов +1 результат за ранг; терминалы безопасности +3.5 п.п. к шансу и целая скидка ОД по floor((ранг+«Живчик»)/2); техпроверка Клима +7 п.п. за ранг; шанс доп. ресурса +2.5 п.п. за ранг; шанс разбора +6 п.п. за ранг; крафт инструментов +4 состояния за ранг.',
      merchant: 'Формула: продажа +8% за ранг, покупка −5 п.п. за ранг в общей формуле Бартера; перепродажа товара торговца ограничена 85% текущей цены покупки.',
      diplomat: 'Формула: проверки диалога +8 п.п. за ранг; награда квестов +8% за ранг.',
      scrounger: 'Формула: очки поиска лута +1 за ранг; каждый балл на сервере даёт до +2 крышек, шанс патронов +10/14 п.п. и шанс медикаментов +6 п.п.; у врагов: патроны +12 п.п., стимулятор +6 п.п., меднабор +5 п.п.',
      cacheSense: 'Формула: очки поиска +1 за ранг; в контейнерах шанс скрытого ремкомплекта/антибиотиков 18%×ранг, трофея 8%×ранг.',
      weaponSmith: 'Формула: ремонт оружия/инструментов +8 состояния с ремкомплектом или +4 без него за ранг; износ выстрела = max(0.25, 0.55−0.12×ранг); потеря состояния при энергосбое = max(0.35, 1−18%×ранг); крафт +7 состояния и шанс разбора оружия/инструментов +6 п.п. за ранг.',
      recycler: 'Формула: открывает разбор; шанс успешного разбора +12 п.п. за ранг; выход материалов фиксирован для каждого предмета; шанс доп. ресурса при добыче +2 п.п. за ранг.',
      actionBoy: 'Формула: максимум ОД +1 за ранг; восстановление ОД +0.35/сек за ранг; участвует в целой скидке действий безопасности по floor((профильный ранг+ранг)/2).',
      toughness: 'Формула: максимум HP +12 за ранг.',
      armorTraining: 'Формула: с бронёй/шлемом защита +1.2 п.п., порог урона +1 и видимый класс брони +2 за ранг; ремонт брони +8/+4 состояния, крафт +5 состояния и шанс разбора брони +5 п.п. за ранг.',
      steadfastness: 'Формула: шанс тяжёлых травм уменьшается на 2.5 п.п. за ранг от входящего урона и на 2.8 п.п. за ранг от самоповреждения.',
      lucky: 'Формула: шанс перелома/контузии уменьшается на 3.5 п.п. за ранг от входящего урона и на 4 п.п. за ранг от самоповреждения.',
      secondChance: 'Формула: раз в 90 сек. смертельный удар оставляет 1 HP с шансом min(72%, 22%×ранг + 2.5 п.п.×(УД−5)).',
      ironBones: 'Формула: шанс перелома руки/ноги ×max(35%, 1−28%×ранг).',
      specialStr: 'Формула: Сила +1 за ранг, максимум +3; переносимый вес +8 кг за каждую Силу, ближний урон +1 за каждые 2 Силы выше 5, штраф требования оружия уменьшается на 1 пункт Силы.',
      specialPer: 'Формула: Восприятие +1 за ранг, максимум +3; попадание оружием +2.5 п.п. за каждое Восприятие выше 5, обзор = round(5.5 + 0.7×Восприятие) плюс перки.',
      specialEnd: 'Формула: Выносливость +1 за ранг, максимум +3; базовый максимум HP +9, итоговый HP = база + 12×(уровень−1) + 12×«Крепкий организм», защита брони +0.35 п.п., риск травм снижается через защиту Выносливости.',
      specialCha: 'Формула: Харизма +1 за ранг, максимум +3; продажа +4%, проверка речи +3.5 п.п., награда квестов +2% за каждую Харизму выше 5.',
      specialInt: 'Формула: Интеллект +1 за ранг, максимум +3; терминалы +3 п.п., лечение Доктором +2.5 п.п., шанс доп. ресурса +2.5 п.п. за каждый Интеллект выше 5; энергоурон +1 за каждые 2 Интеллекта выше 5.',
      specialAgi: 'Формула: Ловкость +1 за ранг, максимум +3; скорость +0.13, взлом замков +2.5 п.п., базовые ОД = 5 + floor(ЛВ/2), итоговые ОД = min(99, базовые ОД + уровень−1 + «Живчик»).',
      specialLuck: 'Формула: Удача +1 за ранг, максимум +3; попадание +0.6 п.п., взлом +1.2 п.п., Второй шанс +2.5 п.п., добыча +1 п.п. и защита от травм за каждую Удачу выше 5.'
    };
    return formulas[id] || 'Формула: эффект применяется по текущему рангу перка.';
  }

  function renderSkillTree() {
    const grid = document.getElementById('skill-grid');
    const pointsEl = document.getElementById('skill-points');
    if (!grid) return;
    if (typeof prunePendingSkillPlan === 'function') prunePendingSkillPlan();
    const plannedSpent = typeof pendingSkillPointsSpent === 'function' ? pendingSkillPointsSpent() : 0;
    const pointsLeft = typeof pendingSkillPointsRemaining === 'function' ? pendingSkillPointsRemaining() : player.skillPoints;
    if (pointsEl) pointsEl.textContent = pointsLeft;
    grid.innerHTML = '';

    const controls = document.createElement('div');
    controls.className = 'skill-plan-controls';
    controls.innerHTML = `
      <div class="skill-plan-readout">
        <span>Свободно</span><b>${pointsLeft}</b>
        <span>В плане</span><b>${plannedSpent}</b>
      </div>
      <div class="skill-plan-actions">
        <button type="button" class="skill-plan-reset" ${plannedSpent > 0 ? '' : 'disabled'}>Сбросить</button>
        <button type="button" class="skill-plan-apply" ${plannedSpent > 0 ? '' : 'disabled'}>Применить</button>
      </div>`;
    controls.querySelector('.skill-plan-reset')?.addEventListener('click', e => { e.preventDefault(); resetPendingSkillPlan(); });
    controls.querySelector('.skill-plan-apply')?.addEventListener('click', e => { e.preventDefault(); applyPendingSkillPlan(); });
    grid.appendChild(controls);

    let lastGroup = '';
    SKILLS.forEach(s => {
      if (s.group && s.group !== lastGroup) {
        lastGroup = s.group;
        const groupTitle = document.createElement('div');
        groupTitle.className = 'skill-group-title';
        groupTitle.textContent = s.group;
        grid.appendChild(groupTitle);
      }
      const value = skillPercent(s.id);
      const plannedSteps = typeof pendingSkillSteps === 'function' ? pendingSkillSteps(s.id) : 0;
      const preview = typeof skillPreviewPercent === 'function' ? skillPreviewPercent(s.id) : value;
      const maxed = preview >= SKILL_MAX_PERCENT;
      const locked = pointsLeft <= 0 && !maxed;
      const formula = skillFormulaText(s.id);
      const valueText = plannedSteps > 0
        ? `Навык ${value}% -> ${preview}% / ${SKILL_MAX_PERCENT}%`
        : `Навык ${value}% / ${SKILL_MAX_PERCENT}%`;
      const card = document.createElement('div');
      card.className = 'talent-card skill-card' + (maxed ? ' maxed' : '') + (locked ? ' locked' : '') + (plannedSteps > 0 ? ' planned' : '');
      card.innerHTML = `
        <div class="talent-name">${escapeHtml(s.icon)} ${escapeHtml(s.name)}</div>
        <div class="talent-desc skill-effect">${escapeHtml(s.desc)}</div>
        <div class="skill-formula">${escapeHtml(formula)}</div>
        <div class="talent-rank">${escapeHtml(valueText)}${maxed ? ' · максимум' : ''}</div>
        <div class="skill-plan-row">
          <button type="button" class="skill-minus" ${plannedSteps > 0 ? '' : 'disabled'}>-</button>
          <span>${plannedSteps > 0 ? `+${plannedSteps}` : '0'}</span>
          <button type="button" class="skill-plus" ${maxed || pointsLeft <= 0 ? 'disabled' : ''}>+${SKILL_STEP_PERCENT}%</button>
        </div>`;
      card.querySelector('.skill-minus')?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); unqueueSkillUpgrade(s.id); });
      card.querySelector('.skill-plus')?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); queueSkillUpgrade(s.id); });
      card.addEventListener('click', e => {
        if (e.target && e.target.closest && e.target.closest('button')) return;
        e.preventDefault();
        queueSkillUpgrade(s.id);
      });
      card.addEventListener('mouseenter', e => showTooltip(e, {
        name: s.name,
        desc: s.desc,
        type: 'skill',
        stat: `${skillCurrentEffect(s.id)} ${plannedSteps > 0 ? `В плане: ${value}% -> ${preview}%. ` : ''}${formula} Нажмите «Применить», чтобы потратить распределённые очки.`
      }));
      card.addEventListener('mousemove', moveTooltip);
      card.addEventListener('mouseleave', hideTooltip);
      grid.appendChild(card);
    });
  }

  function requestSkillUpgradeConfirmation(skill) {
    if (!skill) return;
    queueSkillUpgrade(skill.id);
  }

  const SPECIAL_TALENT_BONUSES = { specialStr: 'str', specialPer: 'per', specialEnd: 'end', specialCha: 'cha', specialInt: 'int', specialAgi: 'agi', specialLuck: 'luck' };

  function specialBonusFromTalents(key) {
    let bonus = 0;
    Object.entries(SPECIAL_TALENT_BONUSES).forEach(([talentId, statKey]) => {
      if (statKey === key) bonus += talentLevel(talentId);
    });
    return bonus;
  }

  function specialEffectDescription(key) {
    const v = statValue(key);
    const d = derivedFromStats({
      str: statValue('str'), per: statValue('per'), end: statValue('end'), cha: statValue('cha'), int: statValue('int'), agi: statValue('agi'), luck: statValue('luck')
    }, characterProfile?.traits || []);
    const levelBonus = Math.max(0, Math.floor(Number(player?.level || 1)) - 1);
    const totalMaxHp = d.maxHp + levelBonus * 12 + talentLevel('toughness') * 12;
    const totalMaxAp = Math.min(99, d.maxAp + talentLevel('actionBoy'));
    const sign = n => n >= 0 ? '+' + n : String(n);
    if (key === 'str') return `Текущий уровень: ${v}. Формулы: переносимый вес ${d.carry} = 30 + Сила×8; штраф оружия −5.5 п.п. за каждую недостающую Силу; ближний урон +floor((Сила−5)/2).`;
    if (key === 'per') return `Текущий уровень: ${v}. Формулы: обзор ${d.visionRadius} кл. = clamp 6–16: round(5.5 + Восприятие×0.7); меткость ${sign(((v - 5) * 2.5).toFixed(1))} п.п. = (Восприятие−5)×2.5.`;
    if (key === 'end') return `Текущий уровень: ${v}. Итоговый максимум HP ${totalMaxHp}: база ${d.maxHp}, уровни +${levelBonus * 12}, «Крепкий организм» +${talentLevel('toughness') * 12}. Даёт сопротивление всем типам урона ${d.resistAll}%.`;
    if (key === 'cha') return `Текущий уровень: ${v}. Формулы: продажа ${sign((v - 5) * 4)}% = (Харизма−5)×4; речь +(Харизма−5)×3.5 п.п.; награды квестов +(Харизма−5)×2%.`;
    if (key === 'int') return `Текущий уровень: ${v}. Формулы: терминалы +(Интеллект−5)×3 п.п.; лечение Доктором +(Интеллект−5)×2.5 п.п.; энергоурон +floor((Интеллект−5)/2).`;
    if (key === 'agi') return `Текущий уровень: ${v}. Итоговые ОД ${totalMaxAp}: база ${d.maxAp} = 5 + floor(Ловкость/2), «Живчик» +${talentLevel('actionBoy')}. Скорость ${d.speed.toFixed(2)} = 4.35 + Ловкость×0.13.`;
    if (key === 'luck') return `Текущий уровень: ${v}. Формулы: меткость +${Math.max(0, (v - 5) * 0.6).toFixed(1)} п.п. = max(0, Удача−5)×0.6; проверки удачи +${d.luckChecks} п.п. = max(0, Удача−5)×2.5.`;
    return `Текущий уровень: ${v}.`;
  }

  function skillCurrentEffect(id) {
    const value = skillPercent(id);
    const base = typeof skillBasePercent === 'function' ? skillBasePercent(id) : SKILL_MIN_PERCENT;
    const norm = skillNorm(id);
    const firearmHit = Math.round(norm * 30);
    const meleeHit = Math.round(norm * 18);
    if (id === 'lightWeapons') return `Текущий навык ${value}% (база SPECIAL ${base}%): +${firearmHit} п.п. к попаданию лёгким оружием с патронами, авто-штраф точности ${Math.round((0.18 - 0.08 * norm) * 100)} п.п. до Силы, движения, приседа, состояния и перков.`;
    if (id === 'heavyWeapons') return `Текущий навык ${value}% (база SPECIAL ${base}%): +${firearmHit} п.п. к попаданию тяжёлым оружием, авто-штраф точности ${Math.round((0.18 - 0.08 * norm) * 100)} п.п. до Силы, движения, приседа, состояния и перков.`;
    if (id === 'energyWeapons') return `Текущий навык ${value}%: +${firearmHit} п.п. к попаданию энергооружием, риск перегрева/сбоя снижен множителем ×${(1 - 0.55 * norm).toFixed(2)} до перков и состояния.`;
    if (id === 'throwing') return `Текущий навык ${value}%: взрывное оружие получает +${Math.round(norm * 8)} п.п. к попаданию и +${(0.45 * norm).toFixed(2)} м к радиусу взрыва.`;
    if (id === 'melee') return `Текущий навык ${value}%: +${meleeHit} п.п. к попаданию и +${Math.round(norm * 6)} урона оружием ближнего боя до перков.`;
    if (id === 'unarmed') return `Текущий навык ${value}%: +${meleeHit} п.п. к попаданию и +${Math.round(norm * 4)} урона без оружия до перков.`;
    if (id === 'doctor') return `Текущий навык ${value}%: шанс лечения набором доктора сейчас ${Math.round(doctorSuccessChance() * 100)}% с учётом Интеллекта и перка «Хирург».`;
    if (id === 'firstAid') return `Текущий навык ${value}%: аптечки и стимуляторы лечат на +${Math.round(norm * 24)} HP больше до перка «Полевой санитар».`;
    if (id === 'stealth') return `Текущий навык ${value}%: в приседе радиус обнаружения снижается на ${Math.round(norm * 44)}% до перка «Привидение», шум действий снижается на ${Math.round(norm * 22)}%.`;
    if (id === 'lockpick') return `Текущий навык ${value}%: даёт +${Math.round(norm * 55)} п.п. к проверке замка до характеристик, сложности и перков.`;
    if (id === 'traps') return `Текущий навык ${value}%: сокращает задержку после провала защитной системы на ${Math.round(norm * 35)}%, минимум 55% базовой задержки.`;
    if (id === 'science') return `Текущий навык ${value}%: даёт +${Math.round(norm * 58)} п.п. к терминалам и до +${Math.floor(norm * 4)} к крафту простых боеприпасов.`;
    if (id === 'repair') return `Текущий навык ${value}%: ремонт ремкомплектом +${40 + Math.round(norm * 40)} состояния, без ремкомплекта +${18 + Math.round(norm * 22)} состояния.`;
    if (id === 'speech') return `Текущий навык ${value}%: +${Math.round(norm * 55)} п.п. к основной проверке речи и +${Math.round(norm * 18)}% к наградам квестов.`;
    if (id === 'barter') return `Текущий навык ${value}%: продажа +${Math.round(norm * 30)}%, покупка дешевле на ${Math.round(norm * 24)} п.п. до перков и Харизмы; перепродажа товара торговца не выше 85% цены покупки.`;
    if (id === 'wanderer') {
      const speed = typeof globalMapTravelSpeedKmh === 'function' ? globalMapTravelSpeedKmh() : 3.6 + norm * 2.4;
      return `Текущий навык ${value}%: даёт ${Math.floor(norm * 3)} серверных очк. поиска для трофеев/контейнеров, повышает добычу ресурсов и скорость глобальной карты до ${speed.toFixed(1).replace('.', ',')} км/ч.`;
    }
    return `Текущий навык ${value}%.`;
  }

  function renderSpecialSummary() {
    const el = document.getElementById('special-summary');
    if (!el) return;
    el.innerHTML = '';
    specialStatDefs().forEach(def => {
      const base = characterProfile?.special?.[def.key] ?? 5;
      const bonus = specialBonusFromTalents(def.key);
      const pill = document.createElement('div');
      pill.className = 'special-pill' + (bonus ? ' bonus' : '');
      const current = base + bonus;
      const effectText = specialEffectDescription(def.key);
      pill.innerHTML = `${def.code}<b>${current}</b>${bonus ? `<small>+${bonus}</small>` : ''}`;
      pill.dataset.gameHint = `${def.name}: базовое ${base}${bonus ? `, перки +${bonus}` : ''}. ${effectText}`;
      pill.addEventListener('mouseenter', e => showTooltip(e, { name: `${def.name} (${def.code})`, desc: def.desc, stat: effectText }));
      pill.addEventListener('mousemove', moveTooltip);
      pill.addEventListener('mouseleave', hideTooltip);
      el.appendChild(pill);
    });
  }

  function setProgressionMode(mode = 'overview', opts = {}) {
    progressionMode = mode === 'perks' ? 'perks' : 'overview';
    const win = document.getElementById('talents-window');
    if (win) {
      win.classList.toggle('progression-mode-perks', progressionMode === 'perks');
      win.classList.toggle('progression-mode-overview', progressionMode !== 'perks');
      if (progressionMode !== 'perks') win.classList.remove('perk-tree-fullscreen');
    }
    const title = document.getElementById('pipboy-progression-title');
    if (title) title.textContent = progressionMode === 'perks' ? 'PERKS' : 'SKILLS';
    document.querySelectorAll('[data-progression-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.progressionMode === progressionMode);
    });
    if (win && win.classList.contains('visible')) updatePipboyTabButtons(progressionMode === 'perks' ? 'perks' : 'skills');
    syncPerkTreeFullscreenButton();
    if (!opts.noRender) renderTalentTree();
  }

  
  
