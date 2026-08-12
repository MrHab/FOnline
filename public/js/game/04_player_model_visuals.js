  // ===== PLAYER MODEL =====
  const player = {
    x: 0,
    z: 0,
    y: 0,
    angle: Math.PI * 0.25,
    hp: 100,
    maxHp: 100,
    ap: 10,
    maxAp: 10,
    xp: 0,
    xpNeeded: 100,
    level: 1,
    perkPoints: 0,
    skillPoints: 0,
    // 5.2 выглядело мельтешением: даже клип бега на таком темпе читался
    // как неестественно быстрый шаг. 4.6 — темп уверенного бега.
    speed: 4.2,
    fireCooldown: 0,
    reloadTimer: 0,
    fireMode: 'single',
    invincible: 0,
    attackTarget: null,
    crouching: false,
    crouchBlend: 0,
    injuries: {},
    infectionTimer: 0
  };
  const startSpawn = tileToWorld(currentLocation.spawn.tx, currentLocation.spawn.tz);
  player.x = startSpawn.x;
  player.z = startSpawn.z;

  // Skinned character meshes are far too expensive to raycast recursively in
  // a crowd. Every actor gets one shared low-poly collider used only by input;
  // its material is never submitted to the renderer.
  const actorInteractionProxyGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
  const actorInteractionProxyMaterial = new THREE.MeshBasicMaterial({ visible: false });

  function attachActorInteractionProxy(actor, options = {}) {
    if (!actor?.add) return null;
    const existing = actor.userData?.interactionProxy;
    if (existing) return existing;
    const radius = Math.max(0.38, Number(options.radius || 0.68));
    const height = Math.max(0.75, Number(options.height || 2.1));
    const proxy = new THREE.Mesh(actorInteractionProxyGeometry, actorInteractionProxyMaterial);
    proxy.name = 'actor-interaction-proxy';
    proxy.position.y = height * 0.5;
    proxy.scale.set(radius, height, radius);
    proxy.castShadow = false;
    proxy.receiveShadow = false;
    proxy.userData.actorInteractionProxy = true;
    proxy.userData.forceNoShadow = true;
    actor.add(proxy);
    actor.userData.interactionProxy = proxy;
    return proxy;
  }


  const TALENTS = [
    { id: 'gunslinger', icon: '🎯', name: 'Меткий стрелок', group: 'Боевые', max: 3, req: { level: 3, per: 6, skill: { lightWeapons: 40 } }, desc: '+7 п.п. к шансу попадания одиночным и прицельным выстрелом за каждый ранг.' },
    { id: 'automaticMan', icon: '🔫', name: 'Автоматчик', group: 'Боевые', max: 3, req: { level: 6, skill: { lightWeapons: 50 } }, desc: 'Снижает штраф точности автоматической стрельбы из лёгкого оружия на 3 п.п. за каждый ранг.' },
    { id: 'heavyShooter', icon: '🧨', name: 'Тяжёлый стрелок', group: 'Боевые', max: 3, req: { level: 6, str: 6, skill: { heavyWeapons: 50 } }, desc: '+6 п.п. к шансу попадания из тяжёлого оружия за каждый ранг.' },
    { id: 'machineGunner', icon: '💥', name: 'Пулемётчик', group: 'Боевые', max: 3, req: { level: 9, str: 7, skill: { heavyWeapons: 65 } }, desc: 'Снижает штраф точности автоматической стрельбы из тяжёлого оружия на 4 п.п. за каждый ранг.' },
    { id: 'pyromaniac', icon: '🔥', name: 'Поджигатель', group: 'Боевые', max: 3, req: { level: 6, str: 6, skill: { heavyWeapons: 50 } }, desc: 'Огненное оружие получает +4 п.п. к попаданию и +12% сырого урона до брони за каждый ранг.' },
    { id: 'energyTech', icon: '⚡', name: 'Энергетик', group: 'Боевые', max: 3, req: { level: 6, int: 6, skill: { energyWeapons: 50 } }, desc: '+5 п.п. к попаданию энергооружием, −3 п.п. к штрафу точности авто-режима энергооружия и −3.5 п.п. к риску сбоя за ранг.' },
    { id: 'grenadier', icon: '🚀', name: 'Гренадёр', group: 'Боевые', max: 2, req: { level: 6, skill: { throwing: 50 } }, desc: '+6 п.п. к шансу попадания взрывным оружием и +0.2 м к радиусу взрыва за каждый ранг.' },
    { id: 'meleeBreaker', icon: '🪓', name: 'Костолом', group: 'Боевые', max: 2, req: { level: 6, str: 6, skill: { melee: 50 } }, desc: '+2 к урону оружием ближнего боя за каждый ранг.' },
    { id: 'unarmedFighter', icon: '✊', name: 'Кулачный боец', group: 'Боевые', max: 2, req: { level: 6, skill: { unarmed: 50 } }, desc: '+4 п.п. к шансу попадания и +2 к урону без оружия за каждый ранг.' },
    { id: 'sharpshooter', icon: '🔭', name: 'Прицельная концентрация', group: 'Боевые', max: 2, req: { level: 12, per: 7, luck: 5 }, desc: '+2 к сырому урону оружия с патронами за каждый ранг до расчёта брони цели.' },
    { id: 'ambush', icon: '⌖', name: 'Засада', group: 'Боевые', max: 2, req: { level: 9, agi: 6, skill: { stealth: 60 } }, desc: 'Атака из приседа по врагу вне погони получает +8 п.п. к попаданию и множитель урона ×(1+14%×ранг).' },

    { id: 'vigilance', icon: '👁', name: 'Бдительность', group: 'Обзор и выживание', max: 2, req: { level: 3, per: 6 }, desc: '+1 клетка обзора за каждый ранг.' },
    { id: 'awareness', icon: '📡', name: 'Осведомлённость', group: 'Обзор и выживание', max: 1, req: { level: 3, per: 5 }, desc: 'Интерфейсный перк: +0 к шансу и урону, но показывает точное HP цели и прогноз урона с учётом навыков, перков, режима и защиты.' },
    { id: 'ghost', icon: '🥷', name: 'Привидение', group: 'Обзор и выживание', max: 2, req: { level: 6, agi: 6, skill: { stealth: 60 } }, desc: 'В приседе: обнаружение −11 п.п. и шум −17 п.п. в формуле скрытности за ранг.' },

    { id: 'fieldMedic', icon: '💊', name: 'Полевой санитар', group: 'Медицина', max: 2, req: { level: 3, skill: { firstAid: 50 } }, desc: 'Первая помощь восстанавливает на 8 HP больше за каждый ранг.' },
    { id: 'quickTreatment', icon: '⛑️', name: 'Быстрое лечение', group: 'Медицина', max: 2, req: { level: 6, agi: 5, skill: { firstAid: 60 } }, desc: 'Медицинские действия −0.12 сек. за ранг; штраф контузии к лечению становится max(0, 25%−12%×ранг).' },
    { id: 'surgeon', icon: '🩺', name: 'Хирург', group: 'Медицина', max: 2, req: { level: 9, int: 6, skill: { doctor: 60 } }, desc: '+8 п.п. к шансу вылечить перелом руки, перелом ноги и контузию за каждый ранг.' },
    { id: 'immunologist', icon: '☣', name: 'Иммунолог', group: 'Медицина', max: 2, req: { level: 9, end: 6, skill: { doctor: 50 } }, desc: 'Шанс инфекции и токсичных осложнений ×max(45%, 1−25%×ранг).' },
    { id: 'fieldSurgeon', icon: '✚', name: 'Полевой хирург', group: 'Медицина', max: 2, req: { level: 12, int: 7, skill: { doctor: 70 } }, desc: 'Успешное лечение набором доктора может не израсходовать набор: 25% за ранг + 8%×норма Доктора, максимум 70%.' },

    { id: 'quickHands', icon: '⟳', name: 'Быстрые руки', group: 'Техника и торговля', max: 3, req: { level: 3, agi: 5 }, desc: 'Перезарядка стоит −1 ОД за ранг, минимум 1 ОД. Замки получают целую скидку: −1 ОД за каждые 2 суммарных ранга с «Живчиком».' },
    { id: 'engineer', icon: '🧰', name: 'Инженер', group: 'Техника и торговля', max: 2, req: { level: 6, int: 6, skill: { repair: 50 } }, desc: '+1 результат техкрафта, +3.5 п.п. к терминалам безопасности, +7 п.п. к техпроверке Клима; терминалы получают −1 ОД за каждые 2 суммарных ранга с «Живчиком».' },
    { id: 'merchant', icon: '🤝', name: 'Торговец', group: 'Техника и торговля', max: 3, req: { level: 3, cha: 5, skill: { barter: 50 } }, desc: '+8% к цене продажи и +5 п.п. к скидке покупки за каждый ранг.' },
    { id: 'diplomat', icon: '🗣', name: 'Дипломат', group: 'Техника и торговля', max: 2, req: { level: 6, cha: 6, skill: { speech: 50 } }, desc: '+8 п.п. к проверкам диалога и +8% к наградам квестов за каждый ранг.' },
    { id: 'scrounger', icon: '🧰', name: 'Редкая находка', group: 'Техника и торговля', max: 3, req: { level: 6, luck: 6 }, desc: '+1 очко поиска лута за ранг; каждое очко повышает крышки, патроны, медикаменты и редкие броски добычи.' },
    { id: 'cacheSense', icon: '◇', name: 'Нюх на тайники', group: 'Техника и торговля', max: 2, req: { level: 9, luck: 6, skill: { wanderer: 50 } }, desc: '+1 очко поиска за ранг; в контейнерах: ремкомплект/антибиотики 18%×ранг, трофей 8%×ранг.' },
    { id: 'weaponSmith', icon: '⚙', name: 'Оружейник', group: 'Техника и торговля', max: 2, req: { level: 6, int: 6, skill: { repair: 55 } }, desc: 'Ремонт оружия/инструментов +8/+4, крафт +7 состояния, износ выстрела max(0.25, 0.55−0.12×ранг).' },
    { id: 'recycler', icon: '♻', name: 'Утилизация', group: 'Техника и торговля', max: 2, req: { level: 6, int: 5, skill: { repair: 45 } }, desc: 'Открывает разбор оружия, брони и инструментов; +12 п.п. к шансу успешного разбора и +2 п.п. к шансу доп. ресурса за ранг.' },

    { id: 'actionBoy', icon: '⚡', name: 'Живчик', group: 'Защита и удача', max: 3, req: { level: 6, agi: 6 }, desc: '+1 максимальное ОД и быстрее восстановление ОД за ранг; помогает получить целую скидку ОД на действия безопасности.' },
    { id: 'toughness', icon: '❤️', name: 'Крепкий организм', group: 'Защита и удача', max: 3, req: { level: 3, end: 6 }, desc: '+12 к максимальному HP за каждый ранг.' },
    { id: 'armorTraining', icon: '🛡️', name: 'Бронник', group: 'Защита и удача', max: 3, req: { level: 9, skill: { repair: 60 } }, desc: 'С бронёй/шлемом: защита +1.2 п.п., порог +1, видимый класс брони +2, ремонт +8/+4 и крафт +5 за ранг.' },
    { id: 'steadfastness', icon: '🧱', name: 'Стойкость', group: 'Защита и удача', max: 2, req: { level: 6, end: 7 }, desc: 'Шанс тяжёлых травм −2.5 п.п. от входящего урона и −2.8 п.п. от самоповреждения за ранг.' },
    { id: 'lucky', icon: '🍀', name: 'Счастливчик', group: 'Защита и удача', max: 2, req: { level: 3, luck: 6 }, desc: 'Шанс перелома/контузии −3.5 п.п. от входящего урона и −4 п.п. от самоповреждения за ранг.' },
    { id: 'secondChance', icon: '⟲', name: 'Второй шанс', group: 'Защита и удача', max: 2, req: { level: 12, luck: 7 }, desc: 'Раз в 90 секунд смертельный удар может оставить 1 HP: 22% шанса за каждый ранг плюс бонус Удачи.' },
    { id: 'ironBones', icon: '🦴', name: 'Железные кости', group: 'Защита и удача', max: 2, req: { level: 12, end: 8 }, desc: 'Снижает шанс перелома руки или ноги на 28% за каждый ранг.' },

    { id: 'specialStr', icon: '💪', name: 'Сила +1', group: 'SPECIAL', max: 3, req: { level: 3 }, desc: '+1 к Силе за каждый ранг: выше переносимый вес, ближний урон и ниже штраф к попаданию оружием с требованием Силы.' },
    { id: 'specialPer', icon: '👁', name: 'Восприятие +1', group: 'SPECIAL', max: 3, req: { level: 3 }, desc: '+1 к Восприятию за каждый ранг: больше обзор и +2.5 п.п. к шансу попадания оружием.' },
    { id: 'specialEnd', icon: '🫀', name: 'Выносливость +1', group: 'SPECIAL', max: 3, req: { level: 3 }, desc: '+1 к Выносливости за каждый ранг: больше HP, +0.35 п.п. к защите брони и ниже риск травм.' },
    { id: 'specialCha', icon: '🗣', name: 'Харизма +1', group: 'SPECIAL', max: 3, req: { level: 3 }, desc: '+1 к Харизме за каждый ранг: +4% к продаже, +3.5 п.п. к проверкам речи и +2% к наградам квестов.' },
    { id: 'specialInt', icon: '🧠', name: 'Интеллект +1', group: 'SPECIAL', max: 3, req: { level: 3 }, desc: '+1 к Интеллекту за каждый ранг: +3 п.п. к терминалам, +2.5 п.п. к лечению Доктором, +2.5 п.п. к добыче и бонус энергетическому урону.' },
    { id: 'specialAgi', icon: '🏃', name: 'Ловкость +1', group: 'SPECIAL', max: 3, req: { level: 3 }, desc: '+1 к Ловкости за каждый ранг: выше скорость, больше ОД и +2.5 п.п. к взлому замков.' },
    { id: 'specialLuck', icon: '🍀', name: 'Удача +1', group: 'SPECIAL', max: 3, req: { level: 3 }, desc: '+1 к Удаче за каждый ранг: +1 п.п. к критическому выстрелу, выше точность, взлом, шанс Второго шанса, добыча ресурсов и ниже риск перелома или контузии.' }
  ];

  const SKILL_POINTS_PER_LEVEL = 5;
  const PERK_LEVEL_INTERVAL = 3;
  const SKILL_MIN_PERCENT = 20;
  const SKILL_BASE_MAX_PERCENT = 45;
  const SKILL_MAX_PERCENT = 100;
  const SKILL_STEP_PERCENT = 5;
  const TAGGED_SKILL_BONUS_PERCENT = 5;
  const SKILLS = [
    { id: 'lightWeapons', icon: '🔫', name: 'Лёгкое оружие', group: 'Боевые', desc: 'Шанс попадания и снижение штрафа точности автоматической стрельбы из лёгкого оружия.' },
    { id: 'heavyWeapons', icon: '🧨', name: 'Тяжёлое оружие', group: 'Боевые', desc: 'Шанс попадания и снижение штрафа точности автоматической стрельбы из тяжёлого оружия.' },
    { id: 'energyWeapons', icon: '⚡', name: 'Энергетическое', group: 'Боевые', desc: 'Шанс попадания, снижение штрафа точности авто-режима и ниже шанс перегрева/сбоя.' },
    { id: 'throwing', icon: '💣', name: 'Метательное', group: 'Боевые', desc: 'Точность и радиус поражения взрывного оружия.' },
    { id: 'melee', icon: '🗡️', name: 'Ближний бой', group: 'Боевые', desc: 'Шанс попадания и урон оружием ближнего боя.' },
    { id: 'unarmed', icon: '✊', name: 'Без оружия', group: 'Боевые', desc: 'Шанс попадания и урон без оружия.' },
    { id: 'doctor', icon: '🩺', name: 'Доктор', group: 'Мирные', desc: 'Лечение перелома руки, перелома ноги, контузии и инфекции.' },
    { id: 'firstAid', icon: '💊', name: 'Первая помощь', group: 'Мирные', desc: 'Быстрое восстановление ОЗ.' },
    { id: 'stealth', icon: '🥷', name: 'Скрытность', group: 'Мирные', desc: 'Шанс остаться незамеченным мобами и игроками.' },
    { id: 'lockpick', icon: '🗝️', name: 'Взлом', group: 'Мирные', desc: 'Открытие запертых ящиков, дверей и контейнеров.' },
    { id: 'traps', icon: '🪤', name: 'Ловушки', group: 'Мирные', desc: 'Работа с защитными системами: меньше задержка после провала взлома.' },
    { id: 'science', icon: '🔬', name: 'Наука', group: 'Мирные', desc: 'Технологический крафт, терминалы, техпроверки и энергооружие.' },
    { id: 'repair', icon: '🧰', name: 'Ремонт', group: 'Мирные', desc: 'Починка оружия и брони.' },
    { id: 'speech', icon: '🗣', name: 'Красноречие', group: 'Мирные', desc: 'Повышает шанс проверок диалога, опыт и награды за квесты.' },
    { id: 'barter', icon: '🤝', name: 'Бартер', group: 'Мирные', desc: 'Более выгодные цены у торговцев.' },
    { id: 'wanderer', icon: '🧭', name: 'Странник', group: 'Мирные', desc: 'Находки, добыча ресурсов, встречи и скорость движения по глобальной карте.' }
  ];
  const talentRanks = {};
  const skillRanks = {};
  const pendingSkillUpgrades = {};
  let progressionMode = 'overview';

  function talentLevel(id) {
    return clientTalentRankFrom(talentRanks, id);
  }

  function learnedTalentCount(ranks = talentRanks) {
    return TALENTS.reduce((sum, talent) => sum + clientTalentRankFrom(ranks, talent.id), 0);
  }

  function talentDef(id) {
    return TALENTS.find(t => t.id === id) || null;
  }

  function talentRequirementRows(talent) {
    const req = talent?.req || {};
    const rows = [];
    if (req.level) rows.push({ ok: player.level >= req.level, text: `уровень ${req.level}` });
    specialStatDefs().forEach(def => {
      const need = Number(req[def.key] || 0);
      if (need > 0) rows.push({ ok: statValue(def.key) >= need, text: `${def.code} ${need}` });
    });
    Object.entries(req.skill || {}).forEach(([id, need]) => {
      rows.push({ ok: skillPercent(id) >= Number(need), text: `${skillName(id)} ${need}%` });
    });
    if (req.talent) {
      const ids = Array.isArray(req.talent) ? req.talent : [req.talent];
      ids.forEach(id => rows.push({ ok: talentLevel(id) > 0, text: talentDef(id)?.name || id }));
    }
    return rows;
  }

  function talentRequirementsMet(talent) {
    return talentRequirementRows(talent).every(row => row.ok);
  }

  function talentRequirementText(talent) {
    const rows = talentRequirementRows(talent);
    if (!rows.length) return 'Требований нет';
    return rows.map(row => `${row.ok ? '✓' : '×'} ${row.text}`).join(' · ');
  }

  function clampSkillPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return SKILL_MIN_PERCENT;
    return Math.max(SKILL_MIN_PERCENT, Math.min(SKILL_MAX_PERCENT, Math.round(n)));
  }

  function skillBaseSpecialStats(profile = characterProfile) {
    const source = profile?.special || DEFAULT_SPECIAL;
    const useTalentBonuses = !profile
      || profile === characterProfile
      || (profile?.serverCharacterId && profile.serverCharacterId === characterProfile?.serverCharacterId);
    const stats = {};
    ['str', 'per', 'end', 'cha', 'int', 'agi', 'luck'].forEach(key => {
      const raw = Number(source?.[key] ?? DEFAULT_SPECIAL[key] ?? 5);
      const bonus = useTalentBonuses && typeof specialBonusFromTalents === 'function' ? specialBonusFromTalents(key) : 0;
      stats[key] = Math.max(1, Math.min(15, raw + bonus));
    });
    return stats;
  }

  function skillBasePercent(id, profile = characterProfile) {
    const s = skillBaseSpecialStats(profile);
    const formulas = {
      lightWeapons: 15 + s.agi * 2 + s.per,
      heavyWeapons: 10 + s.str * 2 + s.end,
      energyWeapons: 10 + s.int * 2 + s.per,
      throwing: 10 + s.agi * 2 + s.str,
      melee: 15 + s.str * 2 + s.agi,
      unarmed: 15 + s.str + s.agi + s.end,
      doctor: 10 + s.int * 2 + s.per,
      firstAid: 12 + s.int + s.per + s.end,
      stealth: 10 + s.agi * 2 + s.luck,
      lockpick: 10 + s.agi * 2 + s.per,
      traps: 10 + s.per + s.agi + s.int,
      science: 10 + s.int * 3,
      repair: 10 + s.int * 2 + s.per,
      speech: 10 + s.cha * 3,
      barter: 10 + s.cha * 2 + s.int,
      wanderer: 10 + s.end + s.per + s.luck * 2
    };
    const base = Math.max(SKILL_MIN_PERCENT, Math.min(SKILL_BASE_MAX_PERCENT, Math.round(formulas[id] ?? SKILL_MIN_PERCENT)));
    const tagged = Array.isArray(profile?.taggedSkills) && profile.taggedSkills.includes(id);
    return Math.min(SKILL_BASE_MAX_PERCENT + TAGGED_SKILL_BONUS_PERCENT, base + (tagged ? TAGGED_SKILL_BONUS_PERCENT : 0));
  }

  function skillPercent(id) {
    const pct = skillRankFrom(skillRanks, id);
    return pct === null ? skillBasePercent(id) : pct;
  }

  function skillLevel(id) {
    // v7.40: старое имя функции оставлено для совместимости, но теперь возвращает процент.
    return skillPercent(id);
  }

  function skillNorm(id) {
    return Math.max(0, Math.min(1, (skillPercent(id) - SKILL_MIN_PERCENT) / (SKILL_MAX_PERCENT - SKILL_MIN_PERCENT)));
  }

  function skillName(id) {
    return SKILLS.find(s => s.id === id)?.name || id;
  }

  function skillDef(id) {
    return SKILLS.find(s => s.id === id) || null;
  }

  function skillRankFrom(ranks = {}, id = '') {
    if (!skillDef(id)) return null;
    const raw = Number(ranks?.[id]);
    if (!Number.isFinite(raw)) return null;
    const base = skillBasePercent(id);
    return clampSkillPercent(Math.max(base, raw));
  }

  function clientSkillRanksSnapshot(ranks = skillRanks) {
    const out = {};
    SKILLS.forEach(skill => {
      const pct = skillRankFrom(ranks, skill.id);
      if (pct !== null && pct > skillBasePercent(skill.id)) out[skill.id] = pct;
    });
    return out;
  }

  function learnedSkillCount() {
    return SKILLS.filter(skill => skillPercent(skill.id) > skillBasePercent(skill.id)).length;
  }

  function spentSkillPoints() {
    return SKILLS.reduce((sum, skill) => {
      const aboveBase = Math.max(0, skillPercent(skill.id) - skillBasePercent(skill.id));
      return sum + Math.ceil(aboveBase / SKILL_STEP_PERCENT);
    }, 0);
  }

  function pendingSkillSteps(id) {
    return Math.max(0, Math.floor(Number(pendingSkillUpgrades[id] || 0)));
  }

  function pendingSkillPointsSpent() {
    return Object.values(pendingSkillUpgrades).reduce((sum, v) => sum + Math.max(0, Math.floor(Number(v || 0))), 0);
  }

  function pendingSkillPointsRemaining() {
    return Math.max(0, Math.floor(Number(player.skillPoints || 0)) - pendingSkillPointsSpent());
  }

  function skillPreviewPercent(id) {
    return Math.min(SKILL_MAX_PERCENT, skillPercent(id) + pendingSkillSteps(id) * SKILL_STEP_PERCENT);
  }

  function clearPendingSkillPlan() {
    Object.keys(pendingSkillUpgrades).forEach(k => delete pendingSkillUpgrades[k]);
  }

  function prunePendingSkillPlan() {
    let remaining = Math.max(0, Math.floor(Number(player.skillPoints || 0)));
    SKILLS.forEach(skill => {
      const current = skillPercent(skill.id);
      const maxSteps = Math.max(0, Math.floor((SKILL_MAX_PERCENT - current) / SKILL_STEP_PERCENT));
      const wanted = Math.max(0, Math.floor(Number(pendingSkillUpgrades[skill.id] || 0)));
      const kept = Math.min(wanted, maxSteps, remaining);
      if (kept > 0) pendingSkillUpgrades[skill.id] = kept;
      else delete pendingSkillUpgrades[skill.id];
      remaining -= kept;
    });
  }

  function queueSkillUpgrade(id) {
    const skill = SKILLS.find(s => s.id === id);
    if (!skill) return;
    prunePendingSkillPlan();
    if (skillPreviewPercent(id) >= SKILL_MAX_PERCENT) {
      setReadout('Этот навык уже достиг максимума в плане распределения.');
      return;
    }
    if (pendingSkillPointsRemaining() <= 0) {
      setReadout('Нет свободных очков навыков для распределения.');
      return;
    }
    pendingSkillUpgrades[id] = pendingSkillSteps(id) + 1;
    renderTalentTree();
  }

  function unqueueSkillUpgrade(id) {
    if (pendingSkillSteps(id) <= 0) return;
    pendingSkillUpgrades[id] = pendingSkillSteps(id) - 1;
    if (pendingSkillUpgrades[id] <= 0) delete pendingSkillUpgrades[id];
    renderTalentTree();
  }

  function resetPendingSkillPlan() {
    if (pendingSkillPointsSpent() <= 0) return;
    clearPendingSkillPlan();
    setReadout('Черновик распределения навыков сброшен.');
    renderTalentTree();
  }

  function applyPendingSkillPlan() {
    prunePendingSkillPlan();
    const spent = pendingSkillPointsSpent();
    if (spent <= 0) {
      setReadout('Сначала распределите очки навыков.');
      return;
    }
    if (spent > Math.max(0, Math.floor(Number(player.skillPoints || 0)))) {
      prunePendingSkillPlan();
      if (pendingSkillPointsSpent() <= 0) {
        setReadout('Недостаточно свободных очков навыков.');
        renderTalentTree();
        return;
      }
    }
    const changed = [];
    SKILLS.forEach(skill => {
      const steps = pendingSkillSteps(skill.id);
      if (steps <= 0) return;
      const current = skillPercent(skill.id);
      const next = Math.min(SKILL_MAX_PERCENT, current + steps * SKILL_STEP_PERCENT);
      if (next <= current) return;
      skillRanks[skill.id] = next;
      changed.push(`${skill.name} ${current}%→${next}%`);
    });
    const actualSpent = changed.length ? spent : 0;
    if (actualSpent <= 0) {
      clearPendingSkillPlan();
      renderTalentTree();
      return;
    }
    player.skillPoints = Math.max(0, Math.floor(Number(player.skillPoints || 0)) - actualSpent);
    clearPendingSkillPlan();
    addLog(`◆ Навыки применены: ${changed.join(', ')}.`, null, 'level');
    setReadout(`Распределено очков навыков: ${actualSpent}.`);
    renderTalentTree();
    renderInventory();
    renderTraderWindow();
    queueSave();
  }

  function skillPointsEarnedForLevel(level = player.level, traits = characterProfile?.traits || []) {
    const lvl = Math.max(1, Math.floor(Number(level || 1)));
    const startBonus = Array.isArray(traits) && traits.includes('educatedStart') ? SKILL_POINTS_PER_LEVEL : 0;
    return Math.max(0, (lvl - 1) * SKILL_POINTS_PER_LEVEL + startBonus);
  }

  function clientTalentBudgetOrder() {
    const specials = TALENTS.filter(talent => String(talent.id || '').startsWith('special'));
    const rest = TALENTS.filter(talent => !String(talent.id || '').startsWith('special'));
    return specials.concat(rest);
  }

  function clientTalentRankFrom(ranks = {}, id = '') {
    const talent = talentDef(id);
    if (!talent) return 0;
    const raw = Number(ranks?.[id] || 0);
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(talent.max || 1, Math.floor(raw)));
  }

  function clientStatValueWithTalentRanks(key = '', ranks = {}) {
    const source = characterProfile?.special || DEFAULT_SPECIAL;
    let value = Number(source?.[key] ?? 5);
    Object.entries(SPECIAL_TALENT_BONUSES).forEach(([talentId, statKey]) => {
      if (statKey === key) value += clientTalentRankFrom(ranks, talentId);
    });
    return Math.max(1, Math.min(15, value));
  }

  function clientTalentRequirementsMetForRanks(talent, acceptedRanks = {}, level = player.level) {
    const req = talent?.req || {};
    if (req.level && Math.floor(Number(level || 1)) < Number(req.level)) return false;
    for (const def of specialStatDefs()) {
      const need = Number(req[def.key] || 0);
      if (need > 0 && clientStatValueWithTalentRanks(def.key, acceptedRanks) < need) return false;
    }
    for (const [id, need] of Object.entries(req.skill || {})) {
      if (skillPercent(id) < Number(need)) return false;
    }
    const requiredTalents = req.talent ? (Array.isArray(req.talent) ? req.talent : [req.talent]) : [];
    for (const id of requiredTalents) {
      if (clientTalentRankFrom(acceptedRanks, id) <= 0) return false;
    }
    return true;
  }

  function limitClientSkillRanksByBudget(ranks = skillRanks, budget = 0) {
    let remaining = Math.max(0, Math.floor(Number(budget || 0)));
    const out = {};
    SKILLS.forEach(skill => {
      const base = skillBasePercent(skill.id);
      const pct = skillRankFrom(ranks, skill.id) ?? base;
      const wantedSteps = Math.max(0, Math.ceil((pct - base) / SKILL_STEP_PERCENT));
      const steps = Math.min(wantedSteps, remaining);
      if (steps > 0) out[skill.id] = Math.min(SKILL_MAX_PERCENT, base + steps * SKILL_STEP_PERCENT);
      remaining -= steps;
    });
    return out;
  }

  function limitClientTalentRanksByBudget(ranks = talentRanks, budget = 0, level = player.level) {
    let remaining = Math.max(0, Math.floor(Number(budget || 0)));
    const out = {};
    clientTalentBudgetOrder().forEach(talent => {
      const wanted = Math.max(0, Math.min(talent.max || 1, Math.floor(Number(ranks?.[talent.id] || 0))));
      if (wanted > 0 && !clientTalentRequirementsMetForRanks(talent, out, level)) return;
      const rank = Math.min(wanted, remaining);
      if (rank > 0) out[talent.id] = rank;
      remaining -= rank;
    });
    return out;
  }

  function enforceClientProgressionBudget(level = player.level, traits = characterProfile?.traits || []) {
    const talentBudget = perksEarnedForLevel(level);
    const limitedTalentsBeforeSkills = limitClientTalentRanksByBudget(talentRanks, talentBudget, level);
    Object.keys(talentRanks).forEach(k => delete talentRanks[k]);
    Object.assign(talentRanks, limitedTalentsBeforeSkills);
    const limitedSkills = limitClientSkillRanksByBudget(skillRanks, skillPointsEarnedForLevel(level, traits));
    Object.keys(skillRanks).forEach(k => delete skillRanks[k]);
    Object.assign(skillRanks, limitedSkills);
    const limitedTalents = limitClientTalentRanksByBudget(talentRanks, talentBudget, level);
    Object.keys(talentRanks).forEach(k => delete talentRanks[k]);
    Object.assign(talentRanks, limitedTalents);
  }


  function normalizeSkillRanks(raw = {}) {
    const out = {};
    const knownSkillIds = new Set(SKILLS.map(skill => skill.id));
    const setPct = (id, value) => {
      if (!knownSkillIds.has(id)) return;
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      // Старые сохранения хранили ранги 0–19. Значение 20 в текущих сохранениях уже означает 20%.
      const pct = n > 0 && n < 20 ? SKILL_MIN_PERCENT + Math.max(0, n) * 4 : n;
      out[id] = Math.max(out[id] || SKILL_MIN_PERCENT, clampSkillPercent(pct));
    };
    Object.entries(raw || {}).forEach(([id, value]) => setPct(id, value));
    if (raw.guns != null) setPct('lightWeapons', raw.guns);
    if (raw.melee != null) setPct('melee', raw.melee);
    if (raw.medicine != null) { setPct('firstAid', raw.medicine); setPct('doctor', raw.medicine); }
    if (raw.crafting != null) { setPct('repair', raw.crafting); setPct('science', raw.crafting); }
    if (raw.survival != null) setPct('wanderer', raw.survival);
    if (raw.barter != null) setPct('barter', raw.barter);
    return out;
  }

  function perksEarnedForLevel(level) {
    return Math.floor(Math.max(0, level) / PERK_LEVEL_INTERVAL);
  }

  function skillOutputQty(recipe) {
    let qty = recipe.out.qty;
    if (recipe.id === 'ammo9craft' || recipe.id === 'ammo556craft' || recipe.id === 'shellcraft' || recipe.id === 'napalmcraft') qty += Math.floor(skillNorm('science') * 4) + talentLevel('engineer');
    if (recipe.id === 'rocketammocraft' || recipe.id === 'energycellcraft') qty += talentLevel('engineer');
    return qty;
  }

  function learnSkill(id) {
    const skill = SKILLS.find(s => s.id === id);
    if (!skill) return;
    const current = skillPercent(id);
    if (current >= SKILL_MAX_PERCENT) {
      setReadout('Этот навык уже развит полностью.');
      return;
    }
    if (player.skillPoints <= 0) {
      setReadout(`Нет свободных очков навыков. Каждый новый уровень даёт ${SKILL_POINTS_PER_LEVEL} очков навыков.`);
      return;
    }
    skillRanks[id] = Math.min(SKILL_MAX_PERCENT, current + SKILL_STEP_PERCENT);
    player.skillPoints--;
    addLog(`◆ Навык повышен: ${skill.name} ${skillRanks[id]}%.`, null, 'level');
    renderTalentTree();
    renderInventory();
    renderTraderWindow();
    queueSave();
  }

  function learnTalent(id) {
    const talent = TALENTS.find(t => t.id === id);
    if (!talent) return;
    const rank = talentLevel(id);
    if (rank >= talent.max) {
      setReadout('Этот талант уже изучен полностью.');
      return;
    }
    if (player.perkPoints <= 0) {
      setReadout(`Нет свободных очков перков. Новый перк даётся на каждом ${PERK_LEVEL_INTERVAL}-м уровне.`);
      return;
    }
    if (!talentRequirementsMet(talent)) {
      setReadout(`Перк недоступен. Требования: ${talentRequirementText(talent)}.`);
      return;
    }
    talentRanks[id] = rank + 1;
    player.perkPoints--;
    if (id === 'toughness') {
      player.maxHp += 12;
      player.hp = Math.min(player.maxHp, player.hp + 12);
    }
    if (id === 'actionBoy') {
      player.maxAp += 1;
      player.ap = player.maxAp;
    }
    if (SPECIAL_TALENT_BONUSES[id]) {
      applyCharacterProfile(characterProfile || { name: player.name || 'Игрок', special: DEFAULT_SPECIAL, traits: [] }, false);
    }
    addLog(`★ Изучен талант: ${talent.name} ${talentRanks[id]}/${talent.max}.`, null, 'level');
    renderTalentTree();
    renderInventory();
    queueSave(true);
    renderUI();
  }

  const playerGroup = new THREE.Group();
  scene.add(playerGroup);

  let playerParts = {};

  function buildGlbOnlyHumanoidAnchors(root, parts = {}, options = {}) {
    if (!root?.add || !parts) return parts;
    const weaponGroup = new THREE.Group();
    weaponGroup.position.set(0.5, 1.06, -0.27);
    weaponGroup.rotation.set(0.04, 0, -0.08);
    weaponGroup.userData.handSlot = 'weapon';
    const offhandWeaponGroup = new THREE.Group();
    offhandWeaponGroup.position.set(-0.5, 1.06, -0.27);
    offhandWeaponGroup.rotation.set(0.04, 0, 0.08);
    offhandWeaponGroup.userData.handSlot = 'offhand';
    const injuryGroup = new THREE.Group();
    injuryGroup.position.set(0, 2.45, 0);
    injuryGroup.visible = false;
    root.add(weaponGroup, offhandWeaponGroup, injuryGroup);
    parts.weaponGroup = weaponGroup;
    parts.offhandWeaponGroup = offhandWeaponGroup;
    parts.injuryGroup = injuryGroup;
    parts.glbOnly = true;
    parts.characterRoot = root;
    root.userData.parts = parts;
    root.userData.glbOnlyCharacterVisual = true;
    if (options.interactionProxy && typeof attachActorInteractionProxy === 'function') {
      attachActorInteractionProxy(root, options.interactionProxy);
    }
    return parts;
  }

  function stabilizeCharacterNoCull(root) {
    if (!root || !root.traverse) return;
    root.traverse(obj => {
      if (!obj) return;
      // v7.66: персонаж собран из множества маленьких Mesh-деталей.
      // Стандартный frustum culling может на один кадр выбросить ремень, руку,
      // оружие или бронепластину при движении камеры. Для персонажей culling
      // не нужен — объектов мало, а визуальная стабильность важнее.
      obj.frustumCulled = false;
    });
  }

  function createPlayerModel() {
    if (typeof removeCharacterGlbRuntime === 'function') removeCharacterGlbRuntime(playerGroup);
    playerGroup.clear();
    playerParts = {};
    buildGlbOnlyHumanoidAnchors(playerGroup, playerParts);
    initWeaponVisualState(playerParts.weaponGroup);
    initWeaponVisualState(playerParts.offhandWeaponGroup);
    playerGroup.userData.parts = playerParts;
    stabilizeCharacterNoCull(playerGroup);
    updatePlayerEquipmentVisuals();
    if (typeof applyCharacterGlbAppearance === 'function' && characterProfile?.appearance) {
      applyCharacterGlbAppearance(playerGroup, characterProfile?.appearance || {}, {
        castShadow: true,
        equipment
      });
    }
  }

  function initWeaponVisualState(weaponGroup) {
    if (!weaponGroup) return;
    if (!weaponGroup.userData.basePosition) weaponGroup.userData.basePosition = weaponGroup.position.clone();
    if (!weaponGroup.userData.baseRotation) weaponGroup.userData.baseRotation = new THREE.Euler(weaponGroup.rotation.x, weaponGroup.rotation.y, weaponGroup.rotation.z);
    if (typeof weaponGroup.userData.recoil !== 'number') weaponGroup.userData.recoil = 0;
  }

  function triggerWeaponVisualRecoil(weaponGroup, weaponId = 'pistol') {
    if (!weaponGroup) return;
    initWeaponVisualState(weaponGroup);
    const kick = ({ rocketLauncher: 0.36, machineGun: 0.26, flamethrower: 0.18, plasmaRifle: 0.22, shotgun: 0.24, assaultRifle: 0.2, rifle: 0.17, laserPistol: 0.14, pistol: 0.12, knife: 0.08 })[weaponId] || 0.12;
    weaponGroup.userData.recoil = Math.max(Number(weaponGroup.userData.recoil || 0), kick);
    if (typeof triggerWeaponModelAction === 'function') triggerWeaponModelAction(weaponGroup, 'attack');
  }

  function weaponVisualOwnerPose(weaponGroup, owner = null) {
    if (!weaponGroup || !owner) return null;
    let x = Number(owner.x);
    let z = Number(owner.z);
    const ownerGroup = owner.mesh || owner.group || owner.object3D || owner;
    if ((!Number.isFinite(x) || !Number.isFinite(z)) && ownerGroup?.position) {
      x = Number(ownerGroup.position.x);
      z = Number(ownerGroup.position.z);
    }
    if ((!Number.isFinite(x) || !Number.isFinite(z)) && weaponGroup.parent && typeof weaponGroup.parent.getWorldPosition === 'function') {
      const temp = weaponGroup.userData.ownerWorldPosition || new THREE.Vector3();
      weaponGroup.userData.ownerWorldPosition = temp;
      weaponGroup.parent.getWorldPosition(temp);
      x = temp.x;
      z = temp.z;
    }
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    let angle = Number(owner.angle);
    if (!Number.isFinite(angle) && Number.isFinite(Number(owner.netAngle))) angle = Number(owner.netAngle);
    if (!Number.isFinite(angle) && Number.isFinite(Number(owner.targetAngle))) angle = Number(owner.targetAngle);
    if (!Number.isFinite(angle) && ownerGroup?.userData && Number.isFinite(Number(ownerGroup.userData.targetAngle))) angle = Number(ownerGroup.userData.targetAngle);
    if (!Number.isFinite(angle) && ownerGroup?.rotation) angle = Number(ownerGroup.rotation.y || 0) - Math.PI;
    if (!Number.isFinite(angle)) angle = 0;
    return { x, z, angle };
  }

  // The weapon rides an offset hand, so inheriting body yaw alone leaves the
  // barrel parallel to the aim line instead of pointing down it. Converge the
  // model on the aim point, clamped so point-blank aiming cannot swing the
  // weapon across the body.
  const WEAPON_AIM_CONVERGENCE_LIMIT = 0.28;

  function weaponVisualAimPoint(pose, owner = null) {
    if (!pose) return null;
    const isLocalPlayer = typeof player !== 'undefined'
      && (owner === player || (typeof playerGroup !== 'undefined' && owner === playerGroup));
    if (isLocalPlayer
      && typeof pointerHasWorld !== 'undefined' && pointerHasWorld
      && typeof pointerWorld !== 'undefined' && pointerWorld
      && Number.isFinite(Number(pointerWorld.x)) && Number.isFinite(Number(pointerWorld.z))) {
      return { x: Number(pointerWorld.x), z: Number(pointerWorld.z) };
    }
    const declared = Number(owner?.aimDistance);
    const reach = Number.isFinite(declared) && declared > 0.5 ? declared : 14;
    return { x: pose.x + Math.sin(pose.angle) * reach, z: pose.z + Math.cos(pose.angle) * reach };
  }

  function weaponVisualConvergenceYaw(weaponGroup, pose, owner = null) {
    if (!weaponGroup || !pose) return 0;
    // The approved grip rig already pivots the weapon onto the aim point and
    // rewrites baseRotation from the converged pose. Adding a second delta here
    // would double the toe-in.
    if (weaponGroup.userData?.approvedAimConverged) return 0;
    const aim = weaponVisualAimPoint(pose, owner);
    if (!aim) return 0;
    const muzzle = weaponGroup.userData.aimWorldPosition || new THREE.Vector3();
    weaponGroup.userData.aimWorldPosition = muzzle;
    weaponGroup.getWorldPosition(muzzle);
    const dx = aim.x - muzzle.x;
    const dz = aim.z - muzzle.z;
    if (Math.hypot(dx, dz) < 0.35) return 0;
    let delta = Math.atan2(dx, dz) - pose.angle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return Math.max(-WEAPON_AIM_CONVERGENCE_LIMIT, Math.min(WEAPON_AIM_CONVERGENCE_LIMIT, delta));
  }

  function updateWeaponVisualAnimation(weaponGroup, dt, owner = null) {
    if (!weaponGroup) return;
    initWeaponVisualState(weaponGroup);
    if (typeof updateWeaponModelAnimation === 'function') updateWeaponModelAnimation(weaponGroup, dt);
    // Оружие, посаженное утверждённым хватом, живёт в кисти: позу задаёт
    // монтаж (04d) с его конвергенцией и «поднятым положением». Старые
    // коррекции — отскок от стен, доворот и отдача в локальных осях —
    // писались поверх и уводили модель из рук («оружие летает»).
    if (weaponGroup.userData.approvedGripMounted) {
      weaponGroup.userData.recoil = Math.max(0, Number(weaponGroup.userData.recoil || 0) - dt * 1.85);
      weaponGroup.userData.wallPullback = 0;
      return;
    }
    const basePos = weaponGroup.userData.basePosition;
    const baseRot = weaponGroup.userData.baseRotation;
    let recoil = Number(weaponGroup.userData.recoil || 0);
    recoil = Math.max(0, recoil - dt * 1.85);
    weaponGroup.userData.recoil = recoil;
    const eased = recoil * recoil * 3.5;
    let desiredWallPullback = 0;
    const pose = weaponVisualOwnerPose(weaponGroup, owner);
    if (pose && typeof staticCollisionRayHitDistance === 'function') {
      const fx = Math.sin(pose.angle);
      const fz = Math.cos(pose.angle);
      const hit = staticCollisionRayHitDistance(pose.x, pose.z, fx, fz, 1.65, 0.04, { startPad: 0.28 });
      if (hit !== null) desiredWallPullback = Math.max(0, 1.48 - hit) * 0.96;
    }
    const prevPullback = Number(weaponGroup.userData.wallPullback || 0);
    const pullRate = desiredWallPullback > prevPullback ? 13 : 9;
    let wallPullback = prevPullback + (desiredWallPullback - prevPullback) * Math.min(1, Math.max(0.001, dt || 0.016) * pullRate);
    if (Math.abs(wallPullback) < 0.001) wallPullback = 0;
    weaponGroup.userData.wallPullback = wallPullback;
    const characterPose = weaponGroup.userData.characterPose || {};
    weaponGroup.position.set(
      basePos.x + Number(characterPose.x || 0),
      basePos.y + Number(characterPose.y || 0) + eased * 0.05,
      basePos.z + Number(characterPose.z || 0) + eased * 0.18 + wallPullback
    );
    weaponGroup.rotation.set(
      baseRot.x + Number(characterPose.rx || 0) - eased * 0.48,
      baseRot.y + Number(characterPose.ry || 0) + weaponVisualConvergenceYaw(weaponGroup, pose, owner),
      baseRot.z + Number(characterPose.rz || 0) + eased * 0.1
    );
  }

  function meleeVisualBaseId(id = 'fists') {
    try { return equipmentVisualBaseId(id || 'fists') || 'fists'; }
    catch (_) { return id || 'fists'; }
  }

  function meleeProfileForWeapon(weaponId = 'fists') {
    const id = meleeVisualBaseId(weaponId);
    if (id === 'pickaxe') return { id, family: 'heavy', duration: 0.46, reach: 0.34, arc: 1.1 };
    if (id === 'axe') return { id, family: 'heavy', duration: 0.42, reach: 0.3, arc: 0.95 };
    if (id === 'handPump') return { id, family: 'heavy', duration: 0.38, reach: 0.24, arc: 0.62 };
    if (id === 'knife') return { id, family: 'knife', duration: 0.28, reach: 0.26, arc: 0.42 };
    return { id, family: 'unarmed', duration: 0.26, reach: 0.18, arc: 0.28 };
  }

  function actorAnimationParts(actor) {
    if (!actor) return {};
    return actor.userData?.parts || actor.userData?.actorParts || {};
  }

  function weaponHandSlotFromEquipment(eq = {}, activeWeaponId = '') {
    const primary = equipmentVisualBaseId(eq.weapon || 'fists') || 'fists';
    const offhand = equipmentVisualBaseId(eq.offhand || '');
    const active = equipmentVisualBaseId(activeWeaponId || primary || offhand || 'fists') || 'fists';
    if (offhand && offhand !== 'fists' && (primary === 'fists' || (active === offhand && active !== primary))) return 'offhand';
    return 'weapon';
  }

  function actorWeaponGroupForSlot(actor, slot = 'weapon') {
    const parts = actorAnimationParts(actor);
    return slot === 'offhand' ? (parts.offhandWeaponGroup || null) : (parts.weaponGroup || null);
  }

  function activeActorWeaponGroup(actor) {
    if (!actor) return null;
    const slot = actor.userData?.weaponHandSlot === 'offhand' ? 'offhand' : 'weapon';
    return actorWeaponGroupForSlot(actor, slot)
      || actorAnimationParts(actor).weaponGroup
      || actor.userData?.enemyWeaponGroup
      || null;
  }

  function actorWeaponGroup(actor) {
    if (!actor) return null;
    const activeGroup = activeActorWeaponGroup(actor);
    if (activeGroup) return activeGroup;
    if (actor.userData?.enemyWeaponGroup) return actor.userData.enemyWeaponGroup;
    if (actor.userData?.enemy && typeof ensureEnemyWeaponGroup === 'function') return ensureEnemyWeaponGroup(actor.userData.enemy);
    return null;
  }

  function captureTransform(obj) {
    if (!obj) return null;
    return {
      obj,
      rx: obj.rotation.x, ry: obj.rotation.y, rz: obj.rotation.z,
      px: obj.position.x, py: obj.position.y, pz: obj.position.z
    };
  }

  function restoreCapturedTransform(row) {
    if (!row || !row.obj) return;
    row.obj.rotation.set(row.rx, row.ry, row.rz);
    row.obj.position.set(row.px, row.py, row.pz);
  }

  function applyCapturedOffset(row, rx = 0, ry = 0, rz = 0, px = 0, py = 0, pz = 0) {
    if (!row || !row.obj) return;
    row.obj.rotation.set(row.rx + rx, row.ry + ry, row.rz + rz);
    row.obj.position.set(row.px + px, row.py + py, row.pz + pz);
  }

  function captureMeleeVisualBase(actor, parts, weaponGroup) {
    return {
      armR: captureTransform(parts.armR),
      forearmR: captureTransform(parts.forearmR),
      armL: captureTransform(parts.armL),
      forearmL: captureTransform(parts.forearmL),
      body: captureTransform(parts.body),
      chest: captureTransform(parts.chest),
      head: captureTransform(parts.head),
      tail: captureTransform(parts.tail),
      claws: captureTransform(parts.claws),
      weapon: captureTransform(weaponGroup)
    };
  }

  function restoreMeleeVisualBase(anim) {
    if (!anim?.base) return;
    Object.values(anim.base).forEach(restoreCapturedTransform);
  }

  function triggerMeleeAttackVisual(actor, weaponId = 'fists', opts = {}) {
    if (!actor) return;
    const parts = actorAnimationParts(actor);
    const weaponGroup = actorWeaponGroup(actor);
    const profile = meleeProfileForWeapon(weaponId || opts.weapon || 'fists');
    const now = performance.now();
    if (typeof triggerActorAttackAnimationPulse === 'function') {
      triggerActorAttackAnimationPulse(actor, opts.attackToken || opts.t || 0);
    }
    const current = actor.userData?.meleeAnim;
    const physicalMeleeActive = String(actor.userData?.approvedPhysicalMeleeGripActive || '')
      === String(profile.id || '');
    if (current?.base && !physicalMeleeActive) restoreMeleeVisualBase(current);
    actor.userData.meleeAnim = {
      startedAt: now,
      duration: Math.max(0.18, Number(opts.duration || profile.duration || 0.32)),
      weaponId: profile.id,
      family: opts.family || profile.family,
      reach: Number(opts.reach || profile.reach || 0.2),
      arc: Number(opts.arc || profile.arc || 0.5),
      handSlot: actor.userData?.weaponHandSlot || weaponGroup?.userData?.handSlot || 'weapon',
      base: captureMeleeVisualBase(actor, parts, weaponGroup)
    };
  }

  function updateCreatureMeleeAnimation(actor, anim, phase, strike, recoil) {
    const parts = actorAnimationParts(actor);
    const base = anim.base || {};
    const bite = strike - recoil * 0.4;
    applyCapturedOffset(base.body, -bite * 0.08, 0, Math.sin(phase * Math.PI) * 0.045);
    applyCapturedOffset(base.chest, -bite * 0.06, 0, 0);
    applyCapturedOffset(base.head, -bite * 0.34, 0, Math.sin(phase * Math.PI) * 0.055, 0, 0.01, -strike * 0.08);
    if (parts.kind === 'scorpion') {
      applyCapturedOffset(base.tail, -strike * 0.62, 0, Math.sin(phase * Math.PI) * 0.08, 0, 0.04, -strike * 0.05);
      applyCapturedOffset(base.claws, 0, Math.sin(phase * Math.PI) * 0.14, 0, 0, 0, -strike * 0.04);
    } else if (parts.kind === 'wolf' || parts.kind === 'gecko' || parts.kind === 'mutantAnt') {
      applyCapturedOffset(base.tail, 0, Math.sin(phase * Math.PI) * 0.16, 0);
    }
  }

  function updateHumanoidMeleeAnimation(actor, anim, phase, strike, recoil) {
    const base = anim.base || {};
    const family = anim.family || 'unarmed';
    const heavy = family === 'heavy';
    const knife = family === 'knife';
    const reach = Number(anim.reach || 0.2);
    const arc = Number(anim.arc || 0.45);
    const windup = phase < 0.34 ? (phase / 0.34) : 0;
    const bodyTwist = Math.sin(phase * Math.PI) * (heavy ? 0.13 : 0.07);
    const leftHand = anim.handSlot === 'offhand' && !heavy;
    const primaryArm = leftHand ? base.armL : base.armR;
    const primaryForearm = leftHand ? base.forearmL : base.forearmR;
    const supportArm = leftHand ? base.armR : base.armL;
    const supportForearm = leftHand ? base.forearmR : base.forearmL;
    const handSign = leftHand ? -1 : 1;

    if (heavy) {
      applyCapturedOffset(base.armR, -0.7 * windup + strike * 0.62, -strike * 0.12, 0.42 - strike * 1.35);
      applyCapturedOffset(base.forearmR, -0.48 * windup + strike * 0.7, 0, 0.2 - strike * 0.85);
      applyCapturedOffset(base.armL, -0.28 * windup + strike * 0.22, 0, -0.18 + strike * 0.35);
      applyCapturedOffset(base.forearmL, -0.18 * windup + strike * 0.25, 0, -0.1 + strike * 0.28);
      applyCapturedOffset(base.weapon, -0.86 * windup + strike * 1.12, strike * 0.16, -0.32 - strike * arc, 0, strike * 0.04, -strike * reach);
    } else if (knife) {
      applyCapturedOffset(primaryArm, -0.12 + strike * 0.5, handSign * strike * 0.08, handSign * (0.18 - strike * 0.58));
      applyCapturedOffset(primaryForearm, strike * 0.82, 0, handSign * -strike * 0.28);
      applyCapturedOffset(base.weapon, strike * 0.72, handSign * strike * 0.08, handSign * -strike * 0.34, 0, 0, -strike * reach);
    } else {
      applyCapturedOffset(primaryArm, -0.05 + strike * 0.58, 0, handSign * (0.24 - strike * 0.62));
      applyCapturedOffset(primaryForearm, strike * 0.72, 0, handSign * -strike * 0.36, 0, 0, -strike * 0.05);
      applyCapturedOffset(supportArm, 0, 0, handSign * (-0.12 + recoil * 0.24));
      applyCapturedOffset(supportForearm, recoil * 0.28, 0, handSign * -recoil * 0.18);
      applyCapturedOffset(base.weapon, strike * 0.35, 0, handSign * -strike * 0.22, 0, 0, -strike * reach);
    }
    applyCapturedOffset(base.body, 0, bodyTwist * 0.35, -bodyTwist * 0.22);
    applyCapturedOffset(base.chest, 0, bodyTwist * 0.3, -bodyTwist * 0.18);
    applyCapturedOffset(base.head, 0, bodyTwist * 0.18, 0);
  }

  function updateCharacterMeleeAnimation(actor, dt = 0.016) {
    if (!actor?.userData?.meleeAnim) return;
    const anim = actor.userData.meleeAnim;
    const elapsed = (performance.now() - Number(anim.startedAt || 0)) / 1000;
    const duration = Math.max(0.12, Number(anim.duration || 0.3));
    const phase = Math.max(0, Math.min(1, elapsed / duration));
    const physicalMeleeActive = String(actor.userData?.approvedPhysicalMeleeGripActive || '')
      === String(anim.weaponId || '');
    if (physicalMeleeActive) {
      if (phase >= 1) delete actor.userData.meleeAnim;
      return;
    }
    restoreMeleeVisualBase(anim);
    if (phase >= 1) {
      delete actor.userData.meleeAnim;
      return;
    }
    const strike = phase < 0.42
      ? Math.pow(phase / 0.42, 0.72)
      : Math.max(0, 1 - Math.pow((phase - 0.42) / 0.58, 1.6));
    const recoil = Math.sin(phase * Math.PI);
    const parts = actorAnimationParts(actor);
    const creatureKinds = new Set(['wolf', 'scorpion', 'mutantAnt', 'gecko']);
    if (creatureKinds.has(parts.kind)) updateCreatureMeleeAnimation(actor, anim, phase, strike, recoil);
    else updateHumanoidMeleeAnimation(actor, anim, phase, strike, recoil);
  }


  function equipmentVisualBaseId(id) {
    if (!id) return '';
    try { return baseItemId(id) || id; }
    catch (_) { return id; }
  }

  function applyArmorVisualSet(parts, eq = {}) {
    const actor = parts?.characterRoot;
    if (!actor?.userData?.glbOnlyCharacterVisual) return;
    if (typeof refreshCharacterGlbEquipmentLayers === 'function') {
      refreshCharacterGlbEquipmentLayers(actor, eq);
    }
    if (typeof setCharacterProceduralBaseVisible === 'function') {
      setCharacterProceduralBaseVisible(actor, false);
    }
  }

  function makePlayerWeaponMesh(weaponId = '') {
    if (!weaponId || weaponId === 'fists') return null;
    return typeof makeWeaponModelMesh === 'function' ? makeWeaponModelMesh(weaponId) : null;
  }

  function updatePlayerEquipmentVisuals() {
    if (!playerParts.weaponGroup) return;
    const w = currentWeapon();
    const weaponId = equipmentVisualBaseId(w?.id || equipment.weapon || 'fists') || 'fists';
    const rightWeaponId = equipmentVisualBaseId(equipment.weapon || 'fists') || 'fists';
    const leftWeaponId = equipmentVisualBaseId(equipment.offhand || '');
    const activeHandSlot = typeof activeWeaponEquipmentSlot === 'function'
      ? activeWeaponEquipmentSlot()
      : weaponHandSlotFromEquipment(equipment, weaponId);
    playerGroup.userData.weaponId = weaponId;
    playerGroup.userData.weaponHandSlot = activeHandSlot;
    playerGroup.userData.equipment = equipment;

    [
      [playerParts.weaponGroup, rightWeaponId, 'weapon'],
      [playerParts.offhandWeaponGroup, leftWeaponId, 'offhand']
    ].forEach(([weaponGroup, slotWeaponId, handSlot]) => {
      if (!weaponGroup) return;
      if (typeof cancelWeaponGlbForGroup === 'function') cancelWeaponGlbForGroup(weaponGroup);
      weaponGroup.clear();
      weaponGroup.userData.weaponGlbRequestId = Number(weaponGroup.userData.weaponGlbRequestId || 0) + 1;
      initWeaponVisualState(weaponGroup);
      weaponGroup.userData.handSlot = handSlot;
      weaponGroup.userData.weaponId = slotWeaponId || 'fists';
      const mesh = makePlayerWeaponMesh(slotWeaponId);
      if (typeof setWeaponGlbGroupVisibility === 'function') {
        setWeaponGlbGroupVisibility(weaponGroup, !!mesh);
      } else weaponGroup.visible = !!mesh;
      if (mesh) weaponGroup.add(mesh);
      else if (slotWeaponId && slotWeaponId !== 'fists' && typeof requestWeaponGlbForGroup === 'function') {
        requestWeaponGlbForGroup(weaponGroup, slotWeaponId, {
          onReady() {
            stabilizeCharacterNoCull(playerGroup);
            if (typeof invalidateModernProceduralRigAnimationCache === 'function') {
              invalidateModernProceduralRigAnimationCache(playerGroup, playerParts);
            }
          }
        });
      }
    });
    stabilizeCharacterNoCull(playerGroup);

    applyArmorVisualSet(playerParts, equipment);
    if (typeof invalidateModernProceduralRigAnimationCache === 'function') {
      invalidateModernProceduralRigAnimationCache(playerGroup, playerParts);
    }
    renderEquipment();
    renderWeaponReadout();
    updateTargetHintFromHover();
  }
  function setPlayerCrouching(enabled, notify = true) {
    const next = !!enabled;
    if (player.crouching === next) return;
    player.crouching = next;
    document.body.classList.toggle('player-crouching', player.crouching);
    syncMobileCrouchButton();
    if (notify) setReadout(player.crouching ? 'Вы присели. За низкими укрытиями вас сложнее заметить.' : 'Вы встали.');
    if (multiplayer.socket && multiplayer.socket.connected && multiplayer.joined) {
      multiplayer.socket.emit('state', {
        x: player.x,
        z: player.z,
        angle: player.angle,
        crouching: player.crouching,
        hp: player.hp,
        maxHp: player.maxHp,
        maxAp: player.maxAp,
        carry: typeof multiplayerCarrySnapshot === 'function' ? multiplayerCarrySnapshot() : null,
        special: characterProfile?.special || DEFAULT_SPECIAL,
        factionId: characterProfile?.factionId || characterProfile?.worldFactionId || '',
        worldFactionId: characterProfile?.worldFactionId || characterProfile?.factionId || '',
        skillRanks: typeof multiplayerSkillSnapshot === 'function' ? multiplayerSkillSnapshot() : {},
        talentRanks: typeof multiplayerTalentSnapshot === 'function' ? multiplayerTalentSnapshot() : {},
        traits: typeof multiplayerTraitSnapshot === 'function' ? multiplayerTraitSnapshot() : [],
        level: player.level,
        name: characterProfile?.name || serverSession.login || 'Игрок',
        deviceType: getDeviceType(),
        controlType: getDeviceControlType(),
        weapon: multiplayerWeaponId(),
        equipment: multiplayerEquipmentSnapshot(),
        injuries: multiplayerInjurySnapshot()
      });
    }
  }

  function togglePlayerCrouch() {
    setPlayerCrouching(!player.crouching);
  }


  function normalizedInjuryState(injuries = {}) {
    const out = {};
    Object.keys(INJURY_META).forEach(id => { out[id] = !!(injuries && injuries[id]); });
    return out;
  }

  function makeGroupFaceCamera(group) {
    if (!group || typeof THREE === 'undefined' || !camera) return;
    const parent = group.parent;
    if (!parent) {
      group.quaternion.copy(camera.quaternion);
      return;
    }
    const parentWorldQuat = group.userData.parentWorldQuat || new THREE.Quaternion();
    group.userData.parentWorldQuat = parentWorldQuat;
    parent.getWorldQuaternion(parentWorldQuat);
    parentWorldQuat.invert();
    group.quaternion.copy(parentWorldQuat).multiply(camera.quaternion);
  }

  function updateInjurySignGroup(parts, injuries = {}) {
    const group = parts?.injuryGroup;
    if (!group) return;
    makeGroupFaceCamera(group);
    const ids = Object.keys(INJURY_META).filter(id => injuries && injuries[id]);
    const key = ids.join('|');
    if (group.userData.injuryKey !== key) {
      group.children.forEach(child => {
        if (child.material && child.material.map && child.material.map.dispose) child.material.map.dispose();
        if (child.material && child.material.dispose) child.material.dispose();
      });
      group.clear();
      ids.slice(0, 4).forEach((id, index) => {
        const meta = INJURY_META[id];
        const sprite = makeInjuryIconSprite(meta.icon, id === 'infection' ? '#8ee86f' : '#ffbf69');
        sprite.position.set((index - (ids.length - 1) / 2) * 0.48, 0, 0);
        group.add(sprite);
      });
      group.userData.injuryKey = key;
    }
    group.visible = ids.length > 0;
    if (ids.length) {
      const t = performance.now() / 420;
      group.position.y = 2.72 + Math.sin(t) * 0.08;
      makeGroupFaceCamera(group);
    }
  }

  function applyCharacterInjuryVisual(group, injuries = {}, dt = 0.016) {
    if (!group) return;
    const parts = group.userData.parts || (group === playerGroup ? playerParts : {});
    const state = normalizedInjuryState(injuries);
    updateInjurySignGroup(parts, state);

    const wobble = state.concussion ? Math.sin(performance.now() / 120) * 0.06 : 0;
    group.rotation.z = state.brokenLeg ? Math.sin(performance.now() / 260) * 0.035 : 0;
    if (parts.legs) parts.legs.rotation.z = state.brokenLeg ? -0.09 : 0;
    if (parts.armR) {
      if (parts.modernRig) {
        if (state.brokenArm) {
          parts.armR.rotation.z += 0.72;
          parts.armR.rotation.x -= 0.35;
        }
      } else {
        parts.armR.rotation.z = state.brokenArm ? 0.95 : 0.22;
        parts.armR.rotation.x = state.brokenArm ? -0.35 : 0;
      }
    }
    if (parts.head) parts.head.rotation.z = parts.modernRig ? parts.head.rotation.z + wobble : wobble;
    if (parts.body) parts.body.rotation.z = state.concussion ? wobble * 0.4 : 0;
  }

  function applyCharacterCrouchVisual(group, enabled, dt = 0.016) {
    if (!group) return;
    const target = enabled ? 1 : 0;
    if (group.userData?.parts?.modernRig) {
      group.userData.crouching = !!enabled;
      return;
    }
    const current = Number(group.userData.crouchBlend || 0);
    const k = Math.min(1, Math.max(0.08, dt * 12));
    const blend = current + (target - current) * k;
    group.userData.crouchBlend = blend;
    const yScale = 1 - blend * 0.27;
    group.scale.set(1, yScale, 1);
  }

  function syncMobileCrouchButton() {
    const btn = document.getElementById('mobile-crouch-toggle');
    if (!btn) return;
    btn.classList.toggle('active', !!player.crouching);
    btn.setAttribute('aria-label', player.crouching ? 'Встать' : 'Присесть');
    btn.textContent = player.crouching ? '⇧' : '⇩';
  }
