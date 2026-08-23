  // ===== CHARACTER CREATION / SAVE STATE =====
  const STAT_DEFS = [
    { key: 'str', code: 'ST', name: 'Сила', desc: 'Формулы: переносимый вес = 30 + Сила×8; штраф оружия −5.5 п.п. за каждую недостающую Силу; ближний урон +floor((Сила−5)/2).' },
    { key: 'per', code: 'PE', name: 'Восприятие', desc: 'Формулы: меткость оружием +(Восприятие−5)×2.5 п.п.; обзор = clamp 6–16 клеток: round(5.5 + Восприятие×0.7). Влияет на боевые и технические базовые навыки.' },
    { key: 'end', code: 'EN', name: 'Выносливость', desc: 'Формулы: HP = 55 + Выносливость×9 + уровни×12 + перки; сопротивление = round(Выносливость×0.7)%. Влияет на выживание и базовые навыки.' },
    { key: 'cha', code: 'CH', name: 'Харизма', desc: 'Формулы: продажа +(Харизма−5)×4%; речь +(Харизма−5)×3.5 п.п.; награды квестов +(Харизма−5)×2%. Даёт базу речи и бартера.' },
    { key: 'int', code: 'IN', name: 'Интеллект', desc: 'Формулы: терминалы +(Интеллект−5)×3 п.п.; лечение Доктором +(Интеллект−5)×2.5 п.п.; энергоурон +floor((Интеллект−5)/2). Даёт базу науки, ремонта и медицины.' },
    { key: 'agi', code: 'AG', name: 'Ловкость', desc: 'Формулы: ОД = 5 + floor(Ловкость/2) + Живчик; скорость = 4.35 + Ловкость×0.13; взлом замков получает бонус от Ловкости. Даёт базу оружейных и скрытных навыков.' },
    { key: 'luck', code: 'LK', name: 'Удача', desc: 'Формулы: шанс критического выстрела = Удача%; крит удваивает сырой урон до брони; меткость +max(0, Удача−5)×0.6 п.п.; проверки удачи +max(0, Удача−5)×2.5 п.п.' }
  ];
  const STAT_TOTAL = 40;
  const STAT_MIN = 1;
  const STAT_MAX = 10;
  const START_TRAITS = [
    { id: 'trainedEye', icon: '🎯', name: 'Меткий глаз', desc: '+6% к шансу попадания из огнестрельного оружия.' },
    { id: 'bruiser', icon: '💪', name: 'Тяжёлый удар', desc: '+18 HP и +2 урона в ближнем бою, но немного ниже скорость.' },
    { id: 'scavengerStart', icon: '🧰', name: 'Падальщик', desc: 'Больше полезных находок в трофеях и стартовый запас патронов.' },
    { id: 'traderStart', icon: '🤝', name: 'Барыга', desc: 'Лучшие цены продажи и +15 крышек на старте.' },
    { id: 'craftsmanStart', icon: '⚒️', name: 'Ремесленник', desc: 'Стартовый ремкомплект и бонус к сбору ресурсов.' },
    { id: 'educatedStart', icon: '📚', name: 'Образованный', desc: '+5 свободных очков навыков после создания персонажа.' }
  ];
  const CREATOR_MAX_SKILLS = 2;
  const CREATOR_MAX_PERKS = 2;
  let creatorStats = Object.fromEntries(STAT_DEFS.map(s => [s.key, 5]));
  let creatorSkills = [];
  let creatorTraits = [];
  let quickStartCharacterPending = false;
  let creatorAppearance = typeof defaultCharacterAppearance === 'function'
    ? defaultCharacterAppearance('male')
    : {
      schema: 'realm.character-appearance.v1',
      sex: 'male',
      bodyType: 'medium',
      faceId: 'male_01',
      hairId: 'short_crop',
      skinToneId: 'skin_03',
      hairColorId: 'hair_03'
    };

  function effectiveSpecialStats(profile = characterProfile) {
    const source = profile?.special || DEFAULT_SPECIAL;
    const result = {};
    // This function can be called by earlier game chunks while this input/save block
    // is still in the temporal-dead-zone before STAT_DEFS has been initialized.
    // Keep it independent from STAT_DEFS so statValue() is safe during early model/equipment setup.
    ['str', 'per', 'end', 'cha', 'int', 'agi', 'luck'].forEach(key => {
      const base = Number(source?.[key] ?? 5);
      const bonus = typeof specialBonusFromTalents === 'function' ? specialBonusFromTalents(key) : 0;
      result[key] = Math.max(1, Math.min(15, base + bonus));
    });
    return result;
  }

  function statValue(key) {
    return effectiveSpecialStats(characterProfile)[key] ?? 5;
  }

  function hasStartTrait(id) {
    return !!(characterProfile && Array.isArray(characterProfile.traits) && characterProfile.traits.includes(id));
  }

  function levelVitalBonus(level = player?.level || 1) {
    return Math.max(0, Math.floor(Number(level || 1)) - 1);
  }

  function setCharacterNotice(text) {
    const el = document.getElementById('char-error');
    if (!el) {
      setReadout(text || '');
      return;
    }
    el.textContent = text || '';
    el.classList.toggle('visible', !!text);
  }

  window.addEventListener('error', event => {
    if (!gameStarted) {
      setCharacterNotice('Ошибка запуска: ' + (event.message || 'неизвестная ошибка') + '. Откройте эту исправленную сборку через локальный сервер.');
    }
  });

  window.addEventListener('unhandledrejection', event => {
    if (!gameStarted) {
      const reason = event.reason && (event.reason.message || String(event.reason));
      setCharacterNotice('Ошибка запуска: ' + (reason || 'неизвестная ошибка') + '.');
    }
  });

  function creatorPointsLeft() {
    return STAT_TOTAL - Object.values(creatorStats).reduce((a, b) => a + b, 0);
  }

  function derivedFromStats(stats, traits = []) {
    const has = id => traits.includes(id);
    const maxHp = 55 + stats.end * 9 + (has('bruiser') ? 18 : 0);
    const maxAp = Math.max(5, 5 + Math.floor(stats.agi / 2));
    const speed = 4.35 + stats.agi * 0.13 - (has('bruiser') ? 0.18 : 0);
    const carry = 30 + stats.str * 8;
    const hit = Math.round((stats.per - 5) * 2.5 + (has('trainedEye') ? 6 : 0));
    const sell = Math.round((stats.cha - 5) * 4 + (has('traderStart') ? 15 : 0));
    const craft = Math.round((stats.int - 5) * 3 + (has('craftsmanStart') ? 10 : 0));
    const luckChecks = Math.round(Math.max(0, stats.luck - 5) * 2.5);
    const criticalChance = Math.max(1, Math.min(15, Number(stats.luck) || 5));
    const visionRadius = Math.max(6, Math.min(16, Math.round(5.5 + stats.per * 0.7)));
    const resistAll = Math.max(0, Math.round(stats.end * 0.7));
    return { maxHp, maxAp, speed, carry, hit, sell, craft, luckChecks, criticalChance, visionRadius, resistAll };
  }

  function creatorSkillBasePreview(stats = creatorStats) {
    const calc = id => {
      if (typeof skillBasePercent === 'function') return skillBasePercent(id, {
        special: stats,
        traits: creatorTraits,
        taggedSkills: creatorSkills
      });
      return 20;
    };
    const rows = [
      ['Лёгкое оружие', calc('lightWeapons')],
      ['Тяжёлое оружие', calc('heavyWeapons')],
      ['Наука', calc('science')],
      ['Взлом', calc('lockpick')],
      ['Речь', calc('speech')],
      ['Странник', calc('wanderer')]
    ];
    return rows.map(([name, value]) => `<div>${name}: <b>${value}%</b></div>`).join('');
  }

  function renderCharacterAppearanceStepper(container, options = [], selectedId = '', onSelect, label = '', swatches = false) {
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(options) || !options.length) return;
    const selectedIndex = Math.max(0, options.findIndex(option => option.id === selectedId));
    const selected = options[selectedIndex];
    const stepper = document.createElement('div');
    stepper.className = 'character-appearance-stepper';
    const selectOffset = offset => {
      const nextIndex = (selectedIndex + offset + options.length) % options.length;
      onSelect?.(options[nextIndex]);
    };
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'character-appearance-stepper-arrow';
    previous.setAttribute('aria-label', `Предыдущий вариант: ${label}`);
    previous.textContent = '←';
    previous.addEventListener('click', () => selectOffset(-1));
    const value = document.createElement('div');
    value.className = 'character-appearance-stepper-value';
    value.setAttribute('aria-live', 'polite');
    if (swatches && selected.hex) {
      const swatch = document.createElement('span');
      swatch.className = 'character-hair-color-swatch';
      swatch.style.backgroundColor = selected.hex;
      swatch.setAttribute('aria-hidden', 'true');
      value.appendChild(swatch);
    }
    const valueLabel = document.createElement('span');
    valueLabel.textContent = selected.label;
    value.appendChild(valueLabel);
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'character-appearance-stepper-arrow';
    next.setAttribute('aria-label', `Следующий вариант: ${label}`);
    next.textContent = '→';
    next.addEventListener('click', () => selectOffset(1));
    stepper.append(previous, value, next);
    container.appendChild(stepper);
  }

  function renderCharacterCreator() {
    const statBox = document.getElementById('char-stats');
    const pointsEl = document.getElementById('char-points-left');
    const skillsEl = document.getElementById('creator-skill-list');
    const skillCount = document.getElementById('creator-skill-count');
    const traitsEl = document.getElementById('trait-list');
    const traitCount = document.getElementById('trait-count');
    const derivedEl = document.getElementById('char-derived');
    const startBtn = document.getElementById('char-start-btn');
    const sexOptions = document.getElementById('creator-sex-options');
    const bodyOptions = document.getElementById('creator-body-options');
    const faceOptions = document.getElementById('creator-face-options');
    const hairOptions = document.getElementById('creator-hair-options');
    const hairColorOptions = document.getElementById('creator-hair-color-options');
    const appearanceSummary = document.getElementById('character-appearance-summary');
    if (!statBox || !skillsEl || !traitsEl || !derivedEl) return;
    creatorAppearance = typeof normalizeCharacterAppearance === 'function'
      ? normalizeCharacterAppearance(creatorAppearance)
      : creatorAppearance;
    if (sexOptions) {
      const options = [
        { id: 'female', label: 'Женский' },
        { id: 'male', label: 'Мужской' }
      ];
      renderCharacterAppearanceStepper(
        sexOptions,
        options,
        creatorAppearance.sex,
        option => {
          const next = typeof defaultCharacterAppearance === 'function'
            ? defaultCharacterAppearance(option.id)
            : { ...creatorAppearance, sex: option.id };
          creatorAppearance = {
            ...next,
            bodyType: creatorAppearance.bodyType || 'medium',
            hairId: creatorAppearance.hairId || next.hairId,
            hairColorId: creatorAppearance.hairColorId || next.hairColorId
          };
          renderCharacterCreator();
        },
        'пол'
      );
    }
    if (bodyOptions) {
      const options = [
        { id: 'slim', label: 'Стройное' },
        { id: 'medium', label: 'Среднее' },
        { id: 'large', label: 'Крепкое' }
      ];
      renderCharacterAppearanceStepper(
        bodyOptions,
        options,
        creatorAppearance.bodyType,
        option => {
          creatorAppearance = { ...creatorAppearance, bodyType: option.id };
          renderCharacterCreator();
        },
        'телосложение'
      );
    }
    if (faceOptions) {
      const options = typeof CHARACTER_FACE_OPTIONS === 'object'
        ? (CHARACTER_FACE_OPTIONS[creatorAppearance.sex] || [])
        : [];
      renderCharacterAppearanceStepper(
        faceOptions,
        options,
        creatorAppearance.faceId,
        option => {
          creatorAppearance = { ...creatorAppearance, faceId: option.id };
          renderCharacterCreator();
        },
        'лицо'
      );
    }
    if (hairOptions) {
      const options = typeof characterHairOptionsForSex === 'function'
        ? characterHairOptionsForSex(creatorAppearance.sex)
        : [];
      renderCharacterAppearanceStepper(
        hairOptions,
        options,
        creatorAppearance.hairId,
        option => {
          creatorAppearance = { ...creatorAppearance, hairId: option.id };
          renderCharacterCreator();
        },
        'причёска'
      );
    }
    if (hairColorOptions) {
      const options = typeof CHARACTER_HAIR_COLOR_OPTIONS !== 'undefined' && Array.isArray(CHARACTER_HAIR_COLOR_OPTIONS)
        ? CHARACTER_HAIR_COLOR_OPTIONS
        : [];
      renderCharacterAppearanceStepper(
        hairColorOptions,
        options,
        creatorAppearance.hairColorId,
        option => {
          creatorAppearance = { ...creatorAppearance, hairColorId: option.id };
          renderCharacterCreator();
        },
        'цвет волос',
        true
      );
    }
    if (appearanceSummary) {
      appearanceSummary.textContent = typeof characterAppearanceLabel === 'function'
        ? characterAppearanceLabel(creatorAppearance)
        : `${creatorAppearance.sex} · ${creatorAppearance.bodyType}`;
    }
    if (typeof setCharacterCreationPreviewAppearance === 'function') {
      setCharacterCreationPreviewAppearance(creatorAppearance);
    }
    const points = creatorPointsLeft();
    statBox.innerHTML = '';
    STAT_DEFS.forEach(def => {
      const row = document.createElement('div');
      row.className = 'char-stat-row';
      row.innerHTML = `
        <div class="char-stat-code">${def.code}</div>
        <div class="char-stat-name" data-game-hint="${def.desc}">${def.name}</div>
        <div class="char-stat-val">${creatorStats[def.key]}</div>
        <button class="char-stat-btn" ${creatorStats[def.key] <= STAT_MIN ? 'disabled' : ''}>−</button>
        <button class="char-stat-btn" ${creatorStats[def.key] >= STAT_MAX || points <= 0 ? 'disabled' : ''}>+</button>
      `;
      const buttons = row.querySelectorAll('button');
      buttons[0].addEventListener('click', () => { creatorStats[def.key]--; renderCharacterCreator(); });
      buttons[1].addEventListener('click', () => { creatorStats[def.key]++; renderCharacterCreator(); });
      row.addEventListener('mouseenter', e => {
        if (typeof showTooltip !== 'function') return;
        showTooltip(e, {
          name: `${def.name} (${def.code})`,
          desc: def.desc,
          stat: `Текущее значение: ${creatorStats[def.key]}`
        });
      });
      row.addEventListener('mousemove', e => { if (typeof moveTooltip === 'function') moveTooltip(e); });
      row.addEventListener('mouseleave', () => { if (typeof hideTooltip === 'function') hideTooltip(); });
      statBox.appendChild(row);
    });
    if (pointsEl) pointsEl.textContent = points;
    skillsEl.innerHTML = '';
    SKILLS.forEach(skill => {
      const selected = creatorSkills.includes(skill.id);
      const baseWithoutTag = skillBasePercent(skill.id, { special: creatorStats, traits: creatorTraits, taggedSkills: [] });
      const baseWithTag = skillBasePercent(skill.id, { special: creatorStats, traits: creatorTraits, taggedSkills: [skill.id] });
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'trait-card creator-skill-card' + (selected ? ' selected' : '');
      card.setAttribute('aria-pressed', selected ? 'true' : 'false');
      card.innerHTML = `
        <div class="trait-title">${escapeHtml(skill.icon)} ${escapeHtml(skill.name)}</div>
        <div class="trait-desc">${escapeHtml(skill.group)} · база ${baseWithoutTag}% → ${baseWithTag}%</div>
      `;
      card.addEventListener('click', () => {
        if (selected) creatorSkills = creatorSkills.filter(id => id !== skill.id);
        else if (creatorSkills.length < CREATOR_MAX_SKILLS) creatorSkills.push(skill.id);
        else setReadout(`Можно выбрать не больше ${CREATOR_MAX_SKILLS} профильных навыков.`);
        renderCharacterCreator();
      });
      skillsEl.appendChild(card);
    });
    if (skillCount) skillCount.textContent = `${creatorSkills.length}/${CREATOR_MAX_SKILLS}`;
    traitsEl.innerHTML = '';
    START_TRAITS.forEach(trait => {
      const selected = creatorTraits.includes(trait.id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'trait-card' + (selected ? ' selected' : '');
      card.setAttribute('aria-pressed', selected ? 'true' : 'false');
      card.innerHTML = `<div class="trait-title">${trait.icon} ${trait.name}</div><div class="trait-desc">${trait.desc}</div>`;
      card.addEventListener('click', () => {
        if (selected) creatorTraits = creatorTraits.filter(id => id !== trait.id);
        else if (creatorTraits.length < CREATOR_MAX_PERKS) creatorTraits.push(trait.id);
        else setReadout(`Можно выбрать не больше ${CREATOR_MAX_PERKS} стартовых перков.`);
        renderCharacterCreator();
      });
      traitsEl.appendChild(card);
    });
    if (traitCount) traitCount.textContent = `${creatorTraits.length}/${CREATOR_MAX_PERKS}`;
    const d = derivedFromStats(creatorStats, creatorTraits);
    derivedEl.innerHTML = `
      <div>ОЗ: <b>${d.maxHp}</b></div>
      <div>ОД: <b>${d.maxAp}</b></div>
      <div>Скорость: <b>${d.speed.toFixed(1)}</b></div>
      <div>Переносимый вес: <b>${d.carry}</b></div>
      <div>Меткость: <b>${d.hit >= 0 ? '+' : ''}${d.hit}%</b></div>
      <div>Критический выстрел: <b>${d.criticalChance}% (×2)</b></div>
      <div>Обзор: <b>${d.visionRadius} кл.</b></div>
      <div>Сопротивление: <b>${d.resistAll}%</b></div>
      <div>Продажа: <b>${d.sell >= 0 ? '+' : ''}${d.sell}%</b></div>
      <div>Крафт/сбор: <b>${d.craft >= 0 ? '+' : ''}${d.craft}%</b></div>
      <div>Проверки удачи: <b>+${d.luckChecks} п.п.</b></div>
      ${creatorSkillBasePreview(creatorStats)}
    `;
    const name = (document.getElementById('char-name-input')?.value || '').trim();
    if (startBtn) {
      const ready = !!serverSession.token
        && points === 0
        && name.length >= 2
        && creatorSkills.length > 0
        && creatorTraits.length > 0;
      startBtn.disabled = !ready;
      startBtn.dataset.gameHint = !serverSession.token
        ? 'Сначала войдите или зарегистрируйтесь на сервере.'
        : (points !== 0
          ? `Нужно распределить ещё ${points} очк.`
          : (name.length < 2
            ? 'Введите имя персонажа.'
            : (!creatorSkills.length
              ? 'Выберите хотя бы один профильный навык.'
              : (!creatorTraits.length ? 'Выберите хотя бы один стартовый перк.' : 'Начать игру'))));
      startBtn.removeAttribute('title');
    }
    if (points === 0 && name.length >= 2 && creatorSkills.length > 0 && creatorTraits.length > 0) setCharacterNotice('');
  }

  function applyCharacterProfile(profile, resetVitals = false) {
    profile.appearance = typeof normalizeCharacterAppearance === 'function'
      ? normalizeCharacterAppearance(profile.appearance || {})
      : (profile.appearance || creatorAppearance);
    characterProfile = profile;
    const effectiveSpecial = effectiveSpecialStats(profile);
    const d = derivedFromStats(effectiveSpecial, profile.traits || []);
    const levelBonus = levelVitalBonus();
    player.maxHp = d.maxHp + levelBonus * 12 + talentLevel('toughness') * 12;
    player.maxAp = Math.min(99, d.maxAp + talentLevel('actionBoy'));
    player.speed = d.speed;
    if (resetVitals) {
      player.hp = player.maxHp;
      player.ap = player.maxAp;
    } else {
      player.hp = Math.min(player.maxHp, Math.max(1, player.hp));
      player.ap = Math.min(player.maxAp, Math.max(0, player.ap));
    }
    const nameEl = document.getElementById('player-name');
    if (nameEl) nameEl.textContent = profile.name || player.name || 'Странник';
    if (typeof applyCharacterGlbAppearance === 'function' && playerGroup) {
      applyCharacterGlbAppearance(playerGroup, profile.appearance, {
        castShadow: true,
        equipment
      });
    }
    renderWeaponReadout();
  }

  function resetNewGameInventory(profile = null) {
    inventory.clear();
    storageInventory.clear();
    const startItems = { knife: 1, water: 1, silver: 6 };
    const quickStart = profile?.entryMode === 'quick';
    if (quickStart) {
      startItems.pistol = 1;
      startItems.ammo9 = 18;
    }
    if (creatorTraits.includes('scavengerStart')) startItems.scrap = 3;
    if (creatorTraits.includes('traderStart')) startItems.silver += 12;
    if (creatorTraits.includes('craftsmanStart')) { startItems.pickaxe = 1; startItems.axe = 1; }
    Object.entries(startItems).forEach(([id, qty]) => inventory.set(id, qty));
    baseStorageRestockDay = null;
    traderMarketState = {};
    restockBaseStorage(true, { silent: true, noSave: true, noRender: true });
    Object.keys(equipment).forEach(slot => equipment[slot] = null);
    equipment.weapon = quickStart ? 'pistol' : 'fists';
    normalizeUniqueEquipmentState();
    quickbarSlots.fill(null);
  }

  async function createCharacterFromForm() {
    const nameInput = document.getElementById('char-name-input');
    const rawName = (nameInput?.value || '').trim();
    if (!serverSession.token) {
      setCharacterNotice('Сначала войдите или зарегистрируйтесь на сервере, чтобы персонаж был привязан к логину.');
      setServerAuthStatus('Нужен вход на сервер перед созданием персонажа.', 'err');
      renderCharacterCreator();
      return;
    }
    if (creatorPointsLeft() !== 0) {
      setCharacterNotice(`Распределите все свободные очки SPECIAL. Осталось: ${creatorPointsLeft()}.`);
      renderCharacterCreator();
      return;
    }
    if (rawName.length < 2) {
      setCharacterNotice('Введите имя персонажа минимум из двух символов.');
      renderCharacterCreator();
      return;
    }
    if (!creatorSkills.length) {
      setCharacterNotice('Выберите хотя бы один профильный навык.');
      renderCharacterCreator();
      return;
    }
    if (!creatorTraits.length) {
      setCharacterNotice('Выберите хотя бы один стартовый перк.');
      renderCharacterCreator();
      return;
    }
    const profile = {
      name: rawName.slice(0, 18),
      special: { ...creatorStats },
      taggedSkills: creatorSkills.slice(0, CREATOR_MAX_SKILLS),
      traits: creatorTraits.slice(0, CREATOR_MAX_PERKS),
      appearance: typeof normalizeCharacterAppearance === 'function'
        ? normalizeCharacterAppearance(creatorAppearance)
        : { ...creatorAppearance },
      createdAt: Date.now(),
      yandexName: yandexPlayerName || '',
      entryMode: quickStartCharacterPending ? 'quick' : 'custom',
      lastVisitedSettlementId: 'settlement',
      serverCharacterId: selectedServerCharacterId || makeNewCharacterId()
    };
    setSelectedServerCharacterForSaveContext(profile.serverCharacterId);
    localStorage.setItem(SERVER_CHARACTER_KEY, selectedServerCharacterId);
    const startupTrace = typeof beginClientStartupTrace === 'function'
      ? beginClientStartupTrace('new-character', { characterId: String(profile.serverCharacterId || '').slice(0, 64) })
      : null;
    const markStartup = (phase, details = {}) => typeof markClientStartupPhase === 'function'
      ? markClientStartupPhase(startupTrace, phase, details)
      : null;
    const finishStartup = (outcome, details = {}) => typeof finishClientStartupTrace === 'function'
      ? finishClientStartupTrace(startupTrace, outcome, details)
      : null;
    if (typeof connectMultiplayer === 'function') {
      connectMultiplayer({ prepareOnly: true });
      markStartup('socket-transport-started');
    }
    const startNewWorld = () => {
      resetNewGameInventory(profile);
      player.level = 1;
      player.xp = 0;
      player.xpNeeded = 100;
      player.perkPoints = 0;
      player.skillPoints = profile.traits.includes('educatedStart') ? SKILL_POINTS_PER_LEVEL : 0;
      Object.keys(talentRanks).forEach(k => delete talentRanks[k]);
      Object.keys(skillRanks).forEach(k => delete skillRanks[k]);
      Object.assign(skillRanks, normalizeSkillRanks({}));
      Object.keys(locationStates).forEach(k => delete locationStates[k]);
      currentLocation = LOCATIONS.settlement;
      buildWorld();
      setPlayerToSpawn(currentLocation.spawn);
      clearEnemies();
      spawnInitialEnemies();
      applyCharacterProfile(profile, true);
      updatePlayerEquipmentVisuals();
      renderInventory();
      renderQuickbar();
      renderTalentTree();
      return true;
    };

    let loaded = false;
    if (typeof runGameStartupLoading === 'function') {
      loaded = await runGameStartupLoading(`Персонаж: ${profile.name}`, startNewWorld, {
        location: LOCATIONS.settlement,
        subtitle: 'Создаю нового выжившего и подготавливаю поселение...',
        errorMessage: 'Не удалось создать мир для нового персонажа.',
        criticalAssets: {
          appearance: profile.appearance,
          equipment: { weapon: 'fists', offhand: '', armor: '', helmet: '', boots: '', backpack: '' },
          weaponIds: []
        },
        startupTrace,
        beforeRevealStep: 'Синхронизирую локацию с сервером...',
        beforeRevealProgress: 90,
        beforeReveal: async () => {
          markStartup('network-join-started');
          const networkReady = await connectMultiplayer({ waitForJoin: true, timeoutMs: 4500 });
          markStartup('network-join-finished', { ok: networkReady !== false });
          if (networkReady === false) {
            gameStarted = false;
            activeCharacterLeaseId = '';
            if (typeof invalidateMultiplayerSessionContext === 'function') {
              invalidateMultiplayerSessionContext('character-creation-join-failed', {
                disconnect: true,
                clearWorld: true
              });
            } else {
              multiplayer.joinRequested = false;
              if (multiplayer.socket) { try { multiplayer.socket.disconnect(); } catch (_) {} multiplayer.socket = null; }
            }
            throw new Error('Сервер не разрешил создать игровую сессию для персонажа. Попробуйте ещё раз.');
          }
          // v7.74.67: reveal new character only after the server lease exists.
          hideCharacterCreatorAndStart();
          return true;
        }
      });
    } else {
      loaded = startNewWorld();
      if (loaded) {
        hideCharacterCreatorAndStart();
        connectMultiplayer();
      }
    }
    if (!loaded) {
      finishStartup('failed', { error: 'world-startup-failed' });
      setCharacterNotice('Не удалось подготовить мир. Попробуйте ещё раз.');
      return;
    }
    finishStartup('ready', { locationId: 'settlement' });
    addLog(`Персонаж создан: ${profile.name}.`, null, 'level');
    queueSave(true);
  }


  async function startCharacterCreationSafe() {
    try {
      await createCharacterFromForm();
    } catch (err) {
      console.error(err);
      setCharacterNotice('Ошибка при создании персонажа: ' + (err && err.message ? err.message : String(err)));
    }
  }

  function prepareQuickStartCharacter(name = '') {
    setSelectedServerCharacterForSaveContext(makeNewCharacterId());
    creatorStats = { str: 5, per: 7, end: 6, cha: 5, int: 5, agi: 7, luck: 5 };
    creatorSkills = ['lightWeapons', 'wanderer'];
    creatorTraits = ['trainedEye', 'scavengerStart'];
    creatorAppearance = typeof defaultCharacterAppearance === 'function'
      ? defaultCharacterAppearance('male')
      : creatorAppearance;
    const nameInput = document.getElementById('char-name-input');
    if (nameInput) nameInput.value = String(name || 'Странник').trim().slice(0, 18) || 'Странник';
    quickStartCharacterPending = true;
  }

  async function startQuickCharacterCreationSafe(name = '') {
    try {
      prepareQuickStartCharacter(name);
      await createCharacterFromForm();
    } catch (err) {
      console.error(err);
      setServerAuthStatus('Не удалось подготовить быстрого персонажа: ' + (err && err.message ? err.message : String(err)), 'err');
    } finally {
      quickStartCharacterPending = false;
    }
  }

  function hideCharacterCreatorAndStart() {
    if (typeof releaseCharacterCreationPreview === 'function') {
      releaseCharacterCreationPreview();
    }
    const screen = document.getElementById('character-screen');
    if (screen) screen.classList.remove('visible');
    gameStarted = true;
    paused = false;
    const pauseScreen = document.getElementById('pause-screen');
    if (pauseScreen) pauseScreen.style.display = 'none';
    if (typeof scheduleCameraViewportSync === 'function') scheduleCameraViewportSync('enter-game');
    try {
      if (ysdk && !gameplayMarked) {
        ysdk.features?.GameplayAPI?.start();
        gameplayMarked = true;
      }
    } catch (_) {}
  }

  function showCharacterCreator() {
    gameStarted = false;
    const screen = document.getElementById('character-screen');
    if (screen) screen.classList.add('visible');
    if (serverSession.token) {
      if (!selectedServerCharacterId) setSelectedServerCharacterForSaveContext(makeNewCharacterId());
      const nameInput = document.getElementById('char-name-input');
      if (nameInput && !nameInput.value && yandexPlayerName) nameInput.value = yandexPlayerName.slice(0, 18);
      setAuthStep('create');
    } else {
      setAuthStep('login');
    }
    renderCharacterCreator();
  }

  function inventoryToObject() {
    return Object.fromEntries(Array.from(inventory.entries()).filter(([, qty]) => qty > 0));
  }

  function runtimeItemsToObject() {
    const out = {};
    Object.entries(ITEMS).forEach(([id, item]) => {
      const row = {};
      if (item.runtimeInstance || item.baseId) row.baseId = baseItemId(id);
      if (typeof item.loaded === 'number') row.loaded = item.loaded;
      if (typeof item.condition === 'number') row.condition = item.condition;
      if (item.weaponMods && typeof item.weaponMods === 'object' && Object.keys(item.weaponMods).length) row.weaponMods = { ...item.weaponMods };
      if (Object.keys(row).length) out[id] = row;
    });
    return out;
  }

  function isSettlementLocationId(locationId = '') {
    const loc = LOCATIONS[locationId];
    if (!loc || loc.randomTemplate || loc.encounterOnly) return false;
    return loc.kind === 'settlement'
      || loc.city === true
      || loc.settlement === true
      || loc.respawnAllowed === true;
  }

  function normalizeLastVisitedSettlementId(locationId = '') {
    const id = String(locationId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    return isSettlementLocationId(id) ? id : 'settlement';
  }

  function rememberCurrentSettlementLocation(locationId = currentLocation?.id) {
    if (!characterProfile) return 'settlement';
    const fallback = normalizeLastVisitedSettlementId(characterProfile.lastVisitedSettlementId || 'settlement');
    const id = String(locationId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    characterProfile.lastVisitedSettlementId = isSettlementLocationId(id) ? id : fallback;
    return characterProfile.lastVisitedSettlementId;
  }

  function serializeGameState() {
    if (!characterProfile) return null;
    enforceClientProgressionBudget(player.level, characterProfile.traits || []);
    player.skillPoints = Math.min(Math.max(0, Number(player.skillPoints || 0)), Math.max(0, skillPointsEarnedForLevel(player.level, characterProfile.traits || []) - spentSkillPoints()));
    player.perkPoints = Math.min(Math.max(0, Number(player.perkPoints || 0)), Math.max(0, perksEarnedForLevel(player.level) - learnedTalentCount()));
    saveCurrentLocationState();
    const lastVisitedSettlementId = rememberCurrentSettlementLocation();
    return {
      version: 4,
      savedAt: Date.now(),
      characterProfile,
      lastVisitedSettlementId,
      player: {
        x: player.x,
        z: player.z,
        angle: player.angle,
        hp: player.hp,
        ap: player.ap,
        maxHp: player.maxHp,
        maxAp: player.maxAp,
        xp: player.xp,
        xpNeeded: player.xpNeeded,
        level: player.level,
        perkPoints: player.perkPoints,
        skillPoints: player.skillPoints,
        fireMode: player.fireMode,
        lastVisitedSettlementId,
        injuries: { ...(player.injuries || {}) },
        infectionTimer: player.infectionTimer || 0
      },
      currentLocationId: currentLocation.id,
      inventory: inventoryToObject(),
      storage: storageToObject(),
      baseStorageRestockDay,
      traderMarketState: typeof traderMarketStateSnapshot === 'function' ? traderMarketStateSnapshot() : {},
      equipment: { ...equipment },
      talentRanks: { ...talentRanks },
      skillRanks: typeof clientSkillRanksSnapshot === 'function' ? clientSkillRanksSnapshot() : { ...skillRanks },
      npcQuests: typeof npcQuestState === 'object' ? { ...npcQuestState } : {},
      worldTaskAccepted: typeof worldTaskAcceptedSnapshot === 'function' ? worldTaskAcceptedSnapshot() : [],
      worldTaskTrackedId: typeof worldTaskTrackedSnapshot === 'function' ? worldTaskTrackedSnapshot() : '',
      worldTaskRewardClaims: typeof worldTaskRewardClaimsSnapshot === 'function' ? worldTaskRewardClaimsSnapshot() : [],
      socialState: typeof socialStateSnapshot === 'function' ? socialStateSnapshot() : {},
      quickbarSlots: quickbarSlots.slice(),
      itemRuntime: runtimeItemsToObject(),
      globalMap: typeof serializeGlobalMapState === 'function' ? serializeGlobalMapState() : null,
      locationStates
    };
  }

  function applySavedState(state) {
    if (!state || !state.characterProfile) return false;
    characterProfile = state.characterProfile;
    characterProfile.lastVisitedSettlementId = normalizeLastVisitedSettlementId(
      state.lastVisitedSettlementId || state.player?.lastVisitedSettlementId || characterProfile.lastVisitedSettlementId || state.currentLocationId || 'settlement'
    );
    Object.keys(talentRanks).forEach(k => delete talentRanks[k]);
    Object.assign(talentRanks, state.talentRanks || {});
    Object.keys(skillRanks).forEach(k => delete skillRanks[k]);
    Object.assign(skillRanks, normalizeSkillRanks(state.skillRanks || {}));
    registerSavedRuntimeItems(state.itemRuntime || {});
    inventory.clear();
    Object.entries(state.inventory || {}).forEach(([id, qty]) => {
      if (!ITEMS[id]) ensureSavedRuntimeItem(id, state.itemRuntime?.[id] || {});
      if (ITEMS[id] && qty > 0) inventory.set(id, qty);
    });
    storageInventory.clear();
    Object.entries(state.storage || {}).forEach(([id, qty]) => {
      if (!ITEMS[id]) ensureSavedRuntimeItem(id, state.itemRuntime?.[id] || {});
      if (ITEMS[id] && qty > 0) storageInventory.set(id, qty);
    });
    baseStorageRestockDay = Number.isFinite(Number(state.baseStorageRestockDay)) ? Number(state.baseStorageRestockDay) : null;
    traderMarketState = typeof normalizeTraderMarketState === 'function' ? normalizeTraderMarketState(state.traderMarketState || {}) : {};
    restockBaseStorage(false, { silent: true, noSave: true, noRender: true });
    Object.keys(equipment).forEach(slot => equipment[slot] = state.equipment?.[slot] || null);
    Object.entries(state.itemRuntime || {}).forEach(([id, row]) => {
      if (!ITEMS[id]) ensureSavedRuntimeItem(id, row || {});
      if (!ITEMS[id]) return;
      if (row.baseId) ITEMS[id].baseId = row.baseId;
      if (typeof row.loaded === 'number') ITEMS[id].loaded = row.loaded;
      if (typeof row.condition === 'number') ITEMS[id].condition = row.condition;
      if (ITEMS[id].type === 'weapon' && ITEMS[id].ammoType) {
        ITEMS[id].weaponMods = row.weaponMods && typeof row.weaponMods === 'object' ? { ...row.weaponMods } : {};
      }
      if (typeof applyWeaponModificationStats === 'function') applyWeaponModificationStats(ITEMS[id]);
    });
    normalizeUniqueEquipmentState();
    quickbarSlots.fill(null);
    (state.quickbarSlots || []).slice(0, quickbarSlots.length).forEach((id, i) => {
      if (!id) { quickbarSlots[i] = null; return; }
      if (!ITEMS[id]) ensureSavedRuntimeItem(id, state.itemRuntime?.[id] || {});
      if (ITEMS[id]) quickbarSlots[i] = id;
    });
    reconcileQuickbarUniqueReferences();
    Object.keys(locationStates).forEach(k => delete locationStates[k]);
    Object.assign(locationStates, state.locationStates || {});
    if (typeof npcQuestState === 'object') {
      Object.keys(npcQuestState).forEach(k => delete npcQuestState[k]);
      Object.assign(npcQuestState, state.npcQuests || {});
      if (typeof normalizeNpcQuestState === 'function') normalizeNpcQuestState();
    }
    if (typeof applyWorldTaskRewardClaims === 'function') applyWorldTaskRewardClaims(state.worldTaskRewardClaims || []);
    if (typeof applyWorldTaskAccepted === 'function') applyWorldTaskAccepted(state.worldTaskAccepted || []);
    if (typeof applyWorldTaskTracked === 'function') applyWorldTaskTracked(state.worldTaskTrackedId || '');
    if (typeof applySocialStateSnapshot === 'function') applySocialStateSnapshot(state.socialState || {});
    currentLocation = LOCATIONS[state.currentLocationId] || LOCATIONS.settlement;
    rememberCurrentSettlementLocation(currentLocation.id);
    clearEnemies();
    buildWorld();
    const restored = restoreEnemiesFromState();
    if (!restored) spawnInitialEnemies();
    const pos = state.player || {};
    player.x = typeof pos.x === 'number' ? pos.x : tileToWorld(currentLocation.spawn.tx, currentLocation.spawn.tz).x;
    player.z = typeof pos.z === 'number' ? pos.z : tileToWorld(currentLocation.spawn.tx, currentLocation.spawn.tz).z;
    player.angle = typeof pos.angle === 'number' ? pos.angle : player.angle;
    if (isMobileControlsEnabled && isMobileControlsEnabled()) { player.angle = Math.PI; pointerHasWorld = false; lastTouchAimX = null; lastTouchAimY = null; stopTouchAim(); }
    player.xp = pos.xp || 0;
    player.xpNeeded = pos.xpNeeded || 100;
    player.level = pos.level || 1;
    player.fireMode = typeof pos.fireMode === 'string' ? pos.fireMode : 'single';
    player.injuries = (pos.injuries && typeof pos.injuries === 'object') ? { ...pos.injuries } : {};
    player.infectionTimer = Number(pos.infectionTimer || 0);
    enforceClientProgressionBudget(player.level, characterProfile?.traits || []);
    const legacyProgression = state.version < 2 || typeof pos.skillPoints !== 'number';
    const maxFreeSkillPoints = Math.max(0, skillPointsEarnedForLevel(player.level, characterProfile?.traits || []) - spentSkillPoints());
    const maxFreePerkPoints = Math.max(0, perksEarnedForLevel(player.level) - learnedTalentCount());
    if (legacyProgression) {
      player.skillPoints = maxFreeSkillPoints;
      player.perkPoints = maxFreePerkPoints;
    } else {
      player.skillPoints = Math.min(maxFreeSkillPoints, Math.max(0, pos.skillPoints || 0));
      player.perkPoints = Math.min(maxFreePerkPoints, Math.max(0, pos.perkPoints || 0));
    }
    applyCharacterProfile(characterProfile, false);
    player.hp = Math.min(player.maxHp, typeof pos.hp === 'number' ? pos.hp : player.maxHp);
    player.ap = Math.min(player.maxAp, typeof pos.ap === 'number' ? pos.ap : player.maxAp);
    if (typeof isMobileControlsEnabled === 'function' && isMobileControlsEnabled()) {
      const autoTarget = getActiveAutoTarget();
      if (autoTarget) facePoint(autoTarget.x, autoTarget.z);
    }
    playerGroup.position.set(player.x, 0, player.z);
    updateCamera(0);
    updatePlayerEquipmentVisuals();
    renderInventory();
    renderQuickbar();
    renderTalentTree();
    renderCraftingWindow();
    if (typeof updateNpcQuestPanel === 'function') updateNpcQuestPanel();
    const title = document.getElementById('map-title');
    if (title) title.textContent = currentLocation.name;
    drawMinimap();
    if (typeof applySavedGlobalMapState === 'function') applySavedGlobalMapState(state.globalMap || null);
    return true;
  }

  async function loadPersistedState(options = {}) {
    if (!options.skipServer && serverSession.token && selectedServerCharacterId) {
      return await loadServerState();
    }
    return null;
  }

  async function saveGame(flush = false) {
    if (!characterProfile) return false;
    // A flush captures the current state even if no gameplay action explicitly
    // marked it dirty (for example position changes before tab hide/logout).
    if (flush || !saveDirty) {
      saveDirty = true;
      clientSaveDrain.markDirty();
    }
    saveTimer = 0;
    return await clientSaveDrain.drain();
  }

  function queueSave(immediate = false) {
    if (!characterProfile) return;
    if (typeof clientContextTransitionInFlight !== 'undefined' && clientContextTransitionInFlight) return false;
    saveDirty = true;
    clientSaveDrain.markDirty();
    if (immediate) return saveGame(false);
  }

  function updateAutosave(dt) {
    if (!gameStarted || !characterProfile || !saveDirty) return;
    if (clientSaveDrain.isRunning()) return;
    saveTimer += dt;
    if (saveTimer >= 8) {
      saveTimer = 0;
      saveGame(false);
    }
  }

  async function bootstrapProfile() {
    updateServerAuthUI();
    await initYandexGames();
    updateServerAuthUI();
    const screen = document.getElementById('character-screen');
    if (screen) screen.classList.add('visible');

    if (serverSession.token) {
      try {
        await serverApi('/api/auth/me', { method: 'GET' });
        await showCharacterSelect('Вы уже вошли. Выберите персонажа или создайте нового.');
      } catch (err) {
        setServerSession('', '');
        setAuthStep('login');
        setOnlineStatus('Сервер: войдите или зарегистрируйтесь');
        setServerAuthStatus('Сессия истекла. Войдите заново.', 'err');
      }
    } else {
      setAuthStep('login');
      setOnlineStatus('Сервер: войдите или зарегистрируйтесь');
      setServerAuthStatus('Войдите, чтобы выбрать уже созданного персонажа или создать нового.', '');
    }
    renderUI();
  }
