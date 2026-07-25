  initMobileTooltipAutoClose();

  // ===== ITEM CONTEXT MENU / REPAIR / CRAFT =====
  const pendingInventoryItemActions = new Set();

  function submitServerInventoryItemAction(action, id, onSuccess) {
    const itemId = baseItemId(id);
    const itemRuntimeId = String(id || '').trim().slice(0, 96);
    const key = `${action}:${itemRuntimeId || itemId}`;
    if (pendingInventoryItemActions.has(key)) return false;
    if (typeof multiplayer === 'undefined' || !multiplayer?.socket?.connected || !multiplayer.joined) {
      setReadout('Действие с предметом недоступно без соединения с сервером мира.');
      return false;
    }
    pendingInventoryItemActions.add(key);
    multiplayer.socket.emit('inventoryItemAction', {
      action,
      itemId,
      itemRuntimeId,
      equipment: typeof multiplayerEquipmentSnapshot === 'function'
        ? multiplayerEquipmentSnapshot()
        : { ...equipment }
    }, ack => {
      pendingInventoryItemActions.delete(key);
      if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      if (ack?.combat && typeof applyServerCombatState === 'function') applyServerCombatState(ack.combat);
      if (!ack?.ok) {
        setReadout(ack?.error || 'Сервер отклонил действие с предметом.');
        return;
      }
      if (typeof onSuccess === 'function') onSuccess(ack);
      renderInventory();
      renderQuickbar();
      renderWeaponReadout();
      queueSave(true);
    });
    return true;
  }

  function hideItemContextMenu() {
    const menu = document.getElementById('item-context-menu');
    if (menu) menu.style.display = 'none';
  }

  function addCtxOption(menu, label, handler, disabled = false) {
    const opt = document.createElement('div');
    opt.className = 'ctx-option' + (disabled ? ' disabled' : '');
    opt.textContent = label;
    opt.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) handler();
      hideItemContextMenu();
    });
    menu.appendChild(opt);
  }

  function itemHasInventoryUseAction(item) {
    return !!(item && (item.type === 'consumable' || item.type === 'ammo'));
  }

  function addQuickAssignCtxOption(menu, id, e) {
    const item = ITEMS[id];
    const canAssignRadial = typeof isQuickAssignableItem === 'function'
      ? isQuickAssignableItem(id)
      : !!(itemEquipSlot(item) || item?.type === 'consumable' || item?.type === 'ammo');
    if (!canAssignRadial) return;
    addCtxOption(menu, 'В быстрый доступ', () => {
      const x = Number(e?.clientX || window.innerWidth * 0.5);
      const y = Number(e?.clientY || window.innerHeight * 0.5);
      setTimeout(() => {
        if (typeof openQuickAssignRadial === 'function') openQuickAssignRadial(id, x, y);
        else if (typeof assignQuickSlot === 'function') assignQuickSlot(0, id);
      }, 0);
    });
  }

  function positionItemContextMenu(menu, e, width = 190, height = 180) {
    menu.style.display = 'block';
    menu.style.left = Math.max(8, Math.min(window.innerWidth - width, Number(e?.clientX || window.innerWidth * 0.5))) + 'px';
    menu.style.top = Math.max(8, Math.min(window.innerHeight - height, Number(e?.clientY || window.innerHeight * 0.5))) + 'px';
  }

  function unloadWeapon(id) {
    const item = ITEMS[id];
    if (!item || item.type !== 'weapon' || !item.ammoType) return;
    const loaded = item.loaded || 0;
    if (loaded <= 0) {
      setReadout(`${item.name}: магазин уже пуст.`);
      return;
    }
    submitServerInventoryItemAction('unload', id, ack => {
      addLog(`${item.name} разряжен. Возвращено патронов: ${Math.max(0, Number(ack.loaded || 0))}.`, null, 'system');
      setReadout(`${item.name}: магазин разряжен.`);
    });
  }

  function repairItem(id) {
    const item = ITEMS[id];
    if (!item) return;
    const canRepair = item.type === 'weapon' || item.slot || item.type === 'tool';
    if (!canRepair) {
      setReadout('Этот предмет нельзя чинить.');
      return;
    }
    item.condition = item.condition ?? 70;
    if (item.condition >= 100) {
      setReadout(`${item.name}: состояние уже 100%.`);
      return;
    }
    if ((inventory.get('repairKit') || 0) <= 0 && ((inventory.get('ore') || 0) < 1 || (inventory.get('wood') || 0) < 1)) {
      setReadout('Нужен ремкомплект или 1 руда + 1 древесина.');
      return;
    }
    submitServerInventoryItemAction('repair', id, ack => {
      const condition = Math.round(Number(ack.condition || 100));
      const label = ack.mode === 'repairKit' ? 'Ремонт' : 'Полевой ремонт';
      addLog(`${label}: ${item.name}, состояние ${condition}%.`, null, 'system');
      setReadout(`${item.name}: состояние ${condition}%.`);
    });
  }

  const SALVAGE_YIELD_BY_ITEM = {
    pistol: { chance: 0.44, out: { ore: 1 } },
    rifle: { chance: 0.42, out: { ore: 2, wood: 1 } },
    assaultRifle: { chance: 0.36, out: { ore: 3, wood: 1 } },
    machineGun: { chance: 0.30, out: { ore: 5, wood: 1 } },
    laserPistol: { chance: 0.32, tech: true, out: { ore: 2, silver: 2 } },
    flamethrower: { chance: 0.28, tech: true, out: { ore: 4, wood: 1, silver: 2 } },
    plasmaRifle: { chance: 0.26, tech: true, out: { ore: 4, silver: 4 } },
    shotgun: { chance: 0.38, out: { ore: 3, wood: 2 } },
    rocketLauncher: { chance: 0.24, tech: true, out: { ore: 5, wood: 1, silver: 3 } },
    knife: { chance: 0.58, out: { ore: 1 } },
    leather: { chance: 0.54, out: { wood: 1 } },
    metalArmor: { chance: 0.36, out: { ore: 3 } },
    ballisticVest: { chance: 0.34, out: { ore: 2, wood: 1 } },
    combatArmor: { chance: 0.28, tech: true, out: { ore: 4, silver: 2 } },
    hazmatSuit: { chance: 0.30, tech: true, out: { wood: 1, silver: 2 } },
    heavyArmor: { chance: 0.24, tech: true, out: { ore: 6, silver: 2 } },
    energySuit: { chance: 0.26, tech: true, out: { ore: 3, silver: 4 } },
    helmet: { chance: 0.46, out: { ore: 1 } },
    tacticalHelmet: { chance: 0.40, out: { ore: 2 } },
    assaultHelmet: { chance: 0.36, out: { ore: 2, silver: 1 } },
    boots: { chance: 0.56, out: { wood: 1 } },
    scoutBoots: { chance: 0.48, out: { wood: 1, silver: 1 } },
    reinforcedBoots: { chance: 0.46, out: { ore: 1, wood: 1 } },
    backpack: { chance: 0.58, out: { wood: 2 } },
    pickaxe: { chance: 0.50, out: { ore: 2, wood: 1 } },
    axe: { chance: 0.52, out: { ore: 1, wood: 2 } },
    handPump: { chance: 0.46, out: { ore: 1, scrap: 2 } },
    repairKit: { chance: 0.42, out: { ore: 1, wood: 1 } }
  };

  function isSalvageCandidateItem(id) {
    const item = ITEMS[id];
    if (!item || id === 'fists' || (inventory.get(id) || 0) <= 0) return false;
    return Boolean(SALVAGE_YIELD_BY_ITEM[baseItemId(id)]);
  }

  function salvageUnavailableReason(id) {
    if (!isSalvageCandidateItem(id)) return 'нельзя разобрать';
    if (Object.values(equipment).includes(id)) return 'сначала снять';
    if (talentLevel('recycler') <= 0) return 'нужен перк Утилизация';
    return '';
  }

  function canSalvageItem(id) {
    return isSalvageCandidateItem(id) && !salvageUnavailableReason(id);
  }

  function salvageYieldForItem(id) {
    const rule = SALVAGE_YIELD_BY_ITEM[baseItemId(id)];
    if (!rule || !rule.out) return [];
    return Object.entries(rule.out)
      .map(([itemId, qty]) => ({ id: itemId, qty: Math.max(0, Math.floor(Number(qty || 0))) }))
      .filter(entry => entry.qty > 0 && ITEMS[entry.id]);
  }

  function salvageSuccessChance(id) {
    const item = ITEMS[id];
    const rule = SALVAGE_YIELD_BY_ITEM[baseItemId(id)];
    if (!item || !rule) return 0;
    const condition = Math.max(10, Math.min(100, Number(item.condition ?? 65)));
    const conditionBonus = (condition - 65) * 0.002;
    const weaponOrTool = item.type === 'weapon' || item.type === 'tool';
    const armorLike = item.slot === 'armor' || item.slot === 'helmet';
    const chance =
      Number(rule.chance || 0.35) +
      conditionBonus +
      skillNorm('repair') * 0.26 +
      skillNorm('science') * (rule.tech ? 0.16 : 0.05) +
      talentLevel('recycler') * 0.12 +
      talentLevel('engineer') * 0.06 +
      (weaponOrTool ? talentLevel('weaponSmith') * 0.06 : 0) +
      (armorLike ? talentLevel('armorTraining') * 0.05 : 0);
    return Math.max(0.12, Math.min(0.95, chance));
  }

  function salvageYieldPreview(id) {
    const yields = salvageYieldForItem(id);
    if (!yields.length) return 'нет материалов';
    return yields.map(entry => `${ITEMS[entry.id]?.name || entry.id} x${entry.qty}`).join(', ');
  }

  function salvageItem(id) {
    const item = ITEMS[id];
    if (!canSalvageItem(id) || !item) {
      setReadout(`Разбор недоступен: ${salvageUnavailableReason(id) || 'этот предмет нельзя разобрать'}.`);
      return;
    }
    const yields = salvageYieldForItem(id);
    if (!yields.length) {
      setReadout('Не удалось получить материалы.');
      return;
    }
    submitServerInventoryItemAction('salvage', id, ack => {
      const chance = Math.round(Number(ack.chance || 0) * 100);
      if (ack.success) {
        const parts = (ack.yields || []).map(entry => `${ITEMS[entry.id]?.name || entry.id} x${entry.qty}`);
        addLog(`Разобрано: ${item.name}. Шанс ${chance}%. Получено: ${parts.join(', ')}.`, null, 'loot');
        setReadout(`Разобрано: ${item.name}.`);
      } else {
        addLog(`Разбор не удался: ${item.name}. Шанс был ${chance}%. Пригодные материалы потеряны.`, null, 'system');
        setReadout(`Разбор не удался: ${item.name}.`);
      }
    });
  }

  function showItemContextMenu(e, id) {
    const item = ITEMS[id];
    if (!item) return;
    const menu = document.getElementById('item-context-menu');
    menu.innerHTML = '';
    const equipSlot = itemEquipSlot(item);
    const equippedSlot = equippedSlotForItem(id);
    if (equippedSlot) addCtxOption(menu, equippedSlot === 'weapon' ? 'Снять из рук' : 'Снять', () => unequipSlot(equippedSlot));
    else if (equipSlot) addCtxOption(menu, equipSlot === 'weapon' ? 'В руки' : 'Надеть', () => equipItem(id));
    if (itemHasInventoryUseAction(item)) addCtxOption(menu, 'Использовать', () => useInventoryItem(id));
    if (equippedSlot === 'weapon' && item.type === 'weapon' && item.ammoType) {
      addCtxOption(menu, 'Разрядить', () => unloadWeapon(id), (item.loaded || 0) <= 0);
    }
    if (item.type === 'weapon' || item.slot || item.type === 'tool') addCtxOption(menu, 'Починить', () => repairItem(id));
    if (isSalvageCandidateItem(id)) {
      const reason = salvageUnavailableReason(id);
      const label = reason
        ? `Разобрать (${reason})`
        : `Разобрать (шанс ${Math.round(salvageSuccessChance(id) * 100)}% · ${salvageYieldPreview(id)})`;
      addCtxOption(menu, label, () => salvageItem(id), Boolean(reason));
    }
    addQuickAssignCtxOption(menu, id, e);
    addCtxOption(menu, equippedSlot ? 'Выбросить на землю (сначала снять)' : 'Выбросить на землю', () => requestDropInventoryItem(id), !!equippedSlot || !groundItemsAreServerAuthoritative() || (inventory.get(id) || 0) <= 0 || id === 'fists');
    if (!menu.children.length) addCtxOption(menu, 'Нет действий', () => {}, true);
    positionItemContextMenu(menu, e);
  }

  function showEquippedItemContextMenu(e, slot) {
    const id = equipment[slot];
    const item = ITEMS[id];
    if (!item) return;
    const menu = document.getElementById('item-context-menu');
    menu.innerHTML = '';
    addCtxOption(menu, slot === 'weapon' ? 'Снять из рук' : 'Снять', () => unequipSlot(slot));
    if (item.type === 'weapon' && item.ammoType) addCtxOption(menu, 'Разрядить', () => unloadWeapon(id), (item.loaded || 0) <= 0);
    if (item.type === 'weapon' || item.slot || item.type === 'tool') addCtxOption(menu, 'Починить', () => repairItem(id));
    addQuickAssignCtxOption(menu, id, e);
    positionItemContextMenu(menu, e);
  }



  function initItemContextAutoClose() {
    if (document.body.dataset.boundItemContextClose === '1') return;
    document.body.dataset.boundItemContextClose = '1';
    document.addEventListener('pointerdown', e => {
      const menu = document.getElementById('item-context-menu');
      if (!menu || menu.style.display === 'none') return;
      if (!menu.contains(e.target)) hideItemContextMenu();
    }, true);
    document.addEventListener('wheel', hideItemContextMenu, true);
    window.addEventListener('blur', hideItemContextMenu);
  }
  initItemContextAutoClose();

  function recipeCostText(recipe) {
    return Object.entries(recipe.cost).map(([id, qty]) => `<span class="recipe-cost-item">${itemArtHtml(id)}<b>${qty}</b></span>`).join(' ');
  }

  function recipeStationDef(recipe) {
    return CRAFT_STATION_DEFS[recipe?.station || ''] || CRAFT_STATION_DEFS.tool_bench;
  }

  function recipeStationLabel(recipe) {
    return recipeStationDef(recipe).label || 'Станок';
  }

  function craftStationFee(recipe) {
    const total = Object.values(recipe?.cost || {}).reduce((sum, qty) => sum + Math.max(0, Number(qty || 0)), 0);
    return Math.max(1, Math.ceil(total / 5));
  }

  function craftingObjectWorldPoint(row = {}) {
    const pos = row.position && typeof row.position === 'object' ? row.position : row;
    if (Number.isFinite(Number(pos.x)) && Number.isFinite(Number(pos.z))) {
      return { x: Number(pos.x), z: Number(pos.z) };
    }
    const tx = Number(pos.tx ?? row.tx);
    const tz = Number(pos.tz ?? row.tz);
    if (Number.isFinite(tx) && Number.isFinite(tz) && typeof tileToWorld === 'function') {
      return tileToWorld(tx, tz);
    }
    return null;
  }

  function craftingObjectText(row = {}) {
    const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
    return [
      row.id, row.name, row.model, row.url, row.category, row.role, row.type,
      entity.id, entity.name, entity.role, entity.type,
      ...(Array.isArray(row.tags) ? row.tags : []),
      ...(Array.isArray(entity.tags) ? entity.tags : [])
    ].map(value => String(value || '').toLowerCase()).join(' ');
  }

  function craftingObjectStationIds(row = {}) {
    const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
    const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
    const values = [
      row.craftingStation,
      row.station,
      row.stationType,
      row.stationId,
      row.workstation,
      row.workstationType,
      row.craftingStations,
      row.stationTypes,
      row.workstationTypes,
      entity.craftingStation,
      entity.station,
      entity.stationType,
      entity.stationId,
      entity.workstation,
      entity.workstationType,
      entity.craftingStations,
      entity.stationTypes,
      entity.workstationTypes,
      interactive.craftingStation,
      interactive.station,
      interactive.stationType,
      interactive.stationId,
      interactive.craftingStations,
      interactive.stationTypes,
      row.tags,
      entity.tags,
      interactive.tags
    ];
    return values
      .flatMap(value => Array.isArray(value) ? value : [value])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean);
  }

  function craftingObjectMatchesStation(row = {}, recipe = {}) {
    const stationId = String(recipe?.station || 'tool_bench').toLowerCase();
    const explicitStations = craftingObjectStationIds(row);
    const def = recipeStationDef(recipe);
    if (explicitStations.length) {
      if (!explicitStations.includes(stationId)) return false;
      const modelUrl = STATIC_MODEL_URLS[row.model] || row.url || row.file || '';
      return !def.modelFile || staticModelFileName(modelUrl) === def.modelFile;
    }
    const text = craftingObjectText(row);
    if (!text) return false;
    if (text.includes('workshop_bench') || text.includes('workshopbench') || text.includes('workbench')) return false;
    return (def.tokens || []).some(token => text.includes(String(token || '').toLowerCase()));
  }

  function nearbyCraftingStation(recipe) {
    const rows = Array.isArray(currentLocation?.objects) ? currentLocation.objects : [];
    let best = null;
    for (const row of rows) {
      if (!craftingObjectMatchesStation(row, recipe)) continue;
      const point = craftingObjectWorldPoint(row);
      if (!point) continue;
      const dist = Math.hypot(Number(player.x || 0) - point.x, Number(player.z || 0) - point.z);
      if (dist > 4.2) continue;
      if (!best || dist < best.dist) best = { row, point, dist };
    }
    return best;
  }

  function openCraftingStationWindow(station = null) {
    openPipboyTab('craft');
    if (station?.name) setReadout(`${station.name}: \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0440\u0435\u0446\u0435\u043f\u0442.`);
    return true;
  }

  function hasRecipeResources(recipe) {
    return Object.entries(recipe.cost).every(([id, qty]) => (inventory.get(id) || 0) >= qty);
  }

  function canCraft(recipe) {
    return hasRecipeResources(recipe)
      && (inventory.get('silver') || 0) >= craftStationFee(recipe)
      && !!nearbyCraftingStation(recipe);
  }

  function craftedItemCondition(recipe) {
    const outId = recipe?.out?.id;
    const outItem = ITEMS[outId];
    if (!outItem || !isUniqueEquipmentItem(outId)) return null;
    let condition = 82 + Math.round(skillNorm('repair') * 10);
    if (outItem.type === 'weapon' || outItem.type === 'tool') condition += talentLevel('weaponSmith') * 7;
    if (outItem.slot === 'armor' || outItem.slot === 'helmet') condition += talentLevel('armorTraining') * 5;
    if (outItem.type === 'tool') condition += talentLevel('engineer') * 4;
    return Math.max(55, Math.min(100, Math.round(condition)));
  }

  function addCraftedItem(recipe, qty = 1) {
    const outId = recipe?.out?.id;
    const count = Math.max(1, Math.floor(Number(qty || 1)));
    const condition = craftedItemCondition(recipe);
    if (condition === null) return addItem(outId, count, { force: true });
    for (let i = 0; i < count; i++) {
      const instanceId = createRuntimeItemInstance(outId, { condition });
      if (instanceId) addInventoryRaw(instanceId, 1);
    }
    refreshInventoryDependentUI();
    return true;
  }

  function craftRecipe(recipeId) {
    const recipe = CRAFT_RECIPES.find(r => r.id === recipeId);
    if (!recipe) return;
    if (pendingCraftRecipes.has(recipe.id)) {
      setReadout('Станок уже выполняет этот заказ.');
      return;
    }
    const station = nearbyCraftingStation(recipe);
    if (!station) {
      setReadout(`Нужен станок рядом: ${recipeStationLabel(recipe)}.`);
      return;
    }
    if (!hasRecipeResources(recipe)) {
      setReadout('Недостаточно ресурсов для крафта.');
      return;
    }
    const fee = craftStationFee(recipe);
    if ((inventory.get('silver') || 0) < fee) {
      setReadout(`Не хватает крышек для комиссии станка: ${fee}.`);
      return;
    }
    const freedWeight = Object.entries(recipe.cost).reduce((sum, [id, qty]) => sum + itemWeight(id) * qty, 0);
    const outQty = skillOutputQty(recipe);
    const resultWeight = itemWeight(recipe.out.id) * outQty;
    if (inventoryWeight() - freedWeight + resultWeight > carryCapacity() + 0.0001) {
      setReadout('После крафта будет перегруз. Освободите место или сложите предметы в хранилище.');
      return;
    }
    if (!multiplayer?.socket?.connected) {
      setReadout('Нужна связь с сервером: станок должен принять комиссию фракции.');
      return;
    }
    {
      pendingCraftRecipes.add(recipe.id);
      renderCraftingWindow();
      multiplayer.socket.emit('craftingStationUsed', {
        recipeId: recipe.id,
        station: recipe.station || '',
        fee,
        locationId: currentLocation?.id || '',
        stationObjectId: station.row?.id || '',
        inventory: multiplayerInventorySnapshot(),
        special: characterProfile?.special || DEFAULT_SPECIAL,
        skillRanks: typeof clientSkillRanksSnapshot === 'function' ? clientSkillRanksSnapshot() : { ...skillRanks },
        talentRanks: { ...talentRanks },
        traits: Array.isArray(characterProfile?.traits) ? characterProfile.traits.slice(0, 2) : [],
        level: player.level
      }, ack => {
        pendingCraftRecipes.delete(recipe.id);
        if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
        if (!ack?.ok) {
          setReadout(ack?.error || 'Станок отклонил заказ.');
          renderCraftingWindow();
          return;
        }
        const serverOutput = ack.output || { id: recipe.out.id, qty: outQty };
        const serverOutputQty = Math.max(1, Math.floor(Number(serverOutput.qty || outQty)));
        const serverOutputName = ITEMS[serverOutput.id]?.name || ITEMS[recipe.out.id].name;
        if (!ack?.self && Array.isArray(ack.inventory)) applyServerInventorySnapshot(ack.inventory);
        addLog(`Создано: ${serverOutputName} x${serverOutputQty}.`, null, 'loot');
        setReadout(`Создано: ${serverOutputName} x${serverOutputQty}.`);
        renderCraftingWindow();
        renderInventory();
        queueSave(true);
        return;
        /*
          setReadout('Ресурсы или крышки для крафта уже недоступны.');
          renderCraftingWindow();
          return;
        */
      });
      return;
    }
    const conditionText = condition === null ? '' : `, состояние ${condition}%`;
    addLog(`⚒ Создано: ${ITEMS[recipe.out.id].name} x${outQty}${conditionText}.`, null, 'loot');
  }

  function renderCraftingWindow() {
    const grid = document.getElementById('craft-grid');
    if (!grid) return;
    grid.innerHTML = '';
    updateProgressionHero();
    CRAFT_RECIPES.forEach(recipe => {
      const outItem = ITEMS[recipe.out.id];
      const ok = canCraft(recipe) && !pendingCraftRecipes.has(recipe.id);
      const station = nearbyCraftingStation(recipe);
      const fee = craftStationFee(recipe);
      const stationText = station
        ? `${recipeStationLabel(recipe)} рядом · комиссия ${fee}`
        : `нужен станок: ${recipeStationLabel(recipe)} · комиссия ${fee}`;
      const card = document.createElement('div');
      card.className = 'recipe-card' + (ok ? '' : ' disabled');
      card.innerHTML = `<div class="recipe-title">${itemArtHtml(recipe.out.id, { className: 'item-art-recipe' })}<span>${recipe.name}</span></div><div class="recipe-desc">${recipe.desc}</div><div class="recipe-cost">Нужно: ${recipeCostText(recipe)} · результат: <span class="recipe-cost-item">${itemArtHtml(recipe.out.id)}<b>x${skillOutputQty(recipe)}</b></span></div>`;
      card.insertAdjacentHTML('beforeend', `<div class="recipe-cost">${stationText}</div>`);
      card.addEventListener('click', () => craftRecipe(recipe.id));
      grid.appendChild(card);
    });
  }


  function updateProgressionHero() {
    const name = characterProfile?.name || player.name || 'Странник';
    const weaponName = ITEMS[equipment.weapon]?.name || 'без оружия';
    const armorName = ITEMS[equipment.armor]?.name || 'обычная одежда';
    const carry = `${formatWeight(inventoryWeight())}/${formatWeight(carryCapacity())}`;
    const heroName = document.getElementById('progression-hero-name');
    const heroSub = document.getElementById('progression-hero-sub');
    const heroStats = document.getElementById('progression-hero-stats');
    if (heroName) heroName.textContent = name;
    if (heroSub) heroSub.textContent = `Уровень ${player.level} · ${weaponName} · ${armorName}`;
    if (heroStats) {
      heroStats.innerHTML = `
        <div class="hero-stat">HP<b>${Math.round(player.hp)}/${player.maxHp}</b></div>
        <div class="hero-stat">Очки действий<b>${Math.round(player.ap)}/${player.maxAp}</b></div>
        <div class="hero-stat">Перки<b>${player.perkPoints}</b></div>
        <div class="hero-stat">Навыки<b>${player.skillPoints}</b></div>
        <div class="hero-stat">Вес<b>${carry}</b></div>
        <div class="hero-stat">Броня<b>${armorValue()}</b></div>
        <div class="hero-stat">Состояние<b>${activeInjuries().length ? 'травма' : 'норма'}</b></div>`;
    }
    renderInjuryStatusPanels();
    const craftName = document.getElementById('craft-hero-name');
    const craftSub = document.getElementById('craft-hero-sub');
    const craftStats = document.getElementById('craft-hero-stats');
    if (craftName) craftName.textContent = '';
    if (craftSub) craftSub.textContent = '';
    if (craftStats) craftStats.innerHTML = '';
  }
