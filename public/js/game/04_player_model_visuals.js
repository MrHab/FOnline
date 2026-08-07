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
    speed: 5.2,
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
    { id: 'nightVision', icon: '🌙', name: 'Ночное зрение', group: 'Обзор и выживание', max: 2, req: { level: 6, per: 6 }, desc: 'Снижает ночной штраф обзора на 1 клетку за каждый ранг и вечерний штраф на 0.5 клетки за каждый ранг.' },
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

  // ===== WASTELAND ACTOR VISUALS =====
  // v7.53: общий набор материалов и примитивов для персонажа и удалённых игроков.
  // Это не внешние GLTF-ассеты, а лёгкие процедурные модели: мало мешей, общие материалы,
  // читаемый силуэт сверху и отсутствие нагрузки на мобильную версию.
  const actorMats = {
    coat: matStandard({ color: 0x6f4b2e, map: makeNoiseTexture('actor-dust-coat', 0x6f4b2e, 0x8d6440, 0x2b1b11, { seed: 151, repeat: 1.0, lines: 9, specks: 52, lineAlpha: 0.13 }), roughness: 0.9, metalness: 0.03 }),
    pants: matStandard({ color: 0x2e3030, map: makeNoiseTexture('actor-pants-charcoal', 0x2e3030, 0x444540, 0x141616, { seed: 153, repeat: 1.0, lines: 6, specks: 36 }), roughness: 0.88, metalness: 0.04 }),
    armor: matStandard({ color: 0x55584d, map: makeNoiseTexture('actor-scrap-armor', 0x55584d, 0x747467, 0x242723, { seed: 157, repeat: 1.0, lines: 15, specks: 48, lineAlpha: 0.2 }), roughness: 0.58, metalness: 0.38 }),
    rustPlate: matStandard({ color: 0x804727, map: makeNoiseTexture('actor-rust-plate', 0x804727, 0xa46235, 0x29180f, { seed: 159, repeat: 1.0, lines: 12, specks: 80 }), roughness: 0.8, metalness: 0.22 }),
    strap: matStandard({ color: 0x2b1d13, map: makeNoiseTexture('actor-leather-straps', 0x2b1d13, 0x52351e, 0x120d09, { seed: 163, repeat: 1.0, lines: 7, specks: 28 }), roughness: 0.86, metalness: 0.02 }),
    scarf: matStandard({ color: 0xb2925f, map: makeNoiseTexture('actor-dust-scarf', 0xb2925f, 0xd0b176, 0x594326, { seed: 167, repeat: 1.0, lines: 8, specks: 36 }), roughness: 0.94 }),
    glass: matStandard({ color: 0x7fb6a3, emissive: 0x132820, emissiveIntensity: 0.18, roughness: 0.26, metalness: 0.08, transparent: true, opacity: 0.82 }),
    boot: matStandard({ color: 0x1a1713, map: makeNoiseTexture('actor-worn-boots', 0x1a1713, 0x3a2b1d, 0x080706, { seed: 171, repeat: 1.0, lines: 6, specks: 28 }), roughness: 0.78, metalness: 0.08 }),
    pack: matStandard({ color: 0x3e412c, map: makeNoiseTexture('actor-canvas-pack', 0x3e412c, 0x5b5d3c, 0x1c1e14, { seed: 173, repeat: 1.0, lines: 9, specks: 44 }), roughness: 0.92 })
  };

  function makeActorBox(w, h, d, material, x, y, z, rx = 0, ry = 0, rz = 0, castShadow = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    return mesh;
  }

  function makeActorCylinder(r1, r2, h, radial, material, x, y, z, rx = 0, ry = 0, rz = 0, castShadow = true) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, radial), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    return mesh;
  }

  function addWastelandActorDetailPass(root, parts = {}, castShadow = true, isPlayer = false) {
    const detailMeshes = [];
    const add = mesh => {
      if (!mesh) return null;
      mesh.userData.cosmeticLod = true;
      detailMeshes.push(mesh);
      root.add(mesh);
      return mesh;
    };

    const handL = add(makeActorBox(0.16, 0.13, 0.17, mats.skin, -0.60, 0.61, -0.10, 0.03, 0, -0.08, castShadow));
    const handR = add(makeActorBox(0.16, 0.13, 0.17, mats.skin, 0.60, 0.61, -0.10, 0.03, 0, 0.08, castShadow));
    const gloveL = add(makeActorBox(0.18, 0.08, 0.19, actorMats.strap, -0.60, 0.67, -0.09, 0.02, 0, -0.08, castShadow));
    const gloveR = add(makeActorBox(0.18, 0.08, 0.19, actorMats.strap, 0.60, 0.67, -0.09, 0.02, 0, 0.08, castShadow));
    parts.handL = handL;
    parts.handR = handR;
    parts.gloveL = gloveL;
    parts.gloveR = gloveR;

    add(makeActorBox(0.23, 0.10, 0.23, actorMats.rustPlate, -0.18, 0.38, -0.12, 0.08, 0, 0.05, castShadow));
    add(makeActorBox(0.23, 0.10, 0.23, actorMats.armor, 0.18, 0.38, -0.12, -0.06, 0, -0.05, castShadow));
    add(makeActorBox(0.30, 0.055, 0.36, actorMats.boot, -0.17, 0.15, -0.20, 0.03, 0, 0.02, castShadow));
    add(makeActorBox(0.30, 0.055, 0.36, actorMats.boot, 0.17, 0.15, -0.20, 0.03, 0, -0.02, castShadow));

    add(makeActorBox(0.13, 0.13, 0.08, actorMats.rustPlate, 0, 0.73, -0.24, 0, 0, 0.02, castShadow));
    add(makeActorBox(0.12, 0.16, 0.10, actorMats.strap, -0.36, 0.78, -0.20, 0.04, 0, -0.08, castShadow));
    add(makeActorBox(0.12, 0.16, 0.10, actorMats.strap, 0.36, 0.78, -0.20, 0.04, 0, 0.08, castShadow));
    add(makeActorBox(0.18, 0.24, 0.12, actorMats.pack, -0.50, 0.86, 0.12, 0.03, 0, 0.10, castShadow));
    add(makeActorBox(0.18, 0.24, 0.12, actorMats.pack, 0.50, 0.86, 0.12, 0.03, 0, -0.10, castShadow));

    const bandolierA = add(makeActorBox(0.075, 0.78, 0.075, actorMats.strap, -0.18, 1.08, -0.25, 0.12, 0, -0.58, castShadow));
    const bandolierB = add(makeActorBox(0.06, 0.62, 0.06, actorMats.scarf, 0.22, 1.06, -0.255, 0.08, 0, 0.58, castShadow));
    parts.bandolierA = bandolierA;
    parts.bandolierB = bandolierB;
    [-0.18, -0.07, 0.04].forEach((x, i) => {
      add(makeActorBox(0.055, 0.10, 0.045, actorMats.rustPlate, x, 1.02 - i * 0.055, -0.305, 0.1, 0, -0.58, castShadow));
    });

    add(makeActorBox(0.19, 0.045, 0.055, actorMats.armor, -0.11, 1.59, -0.265, 0, 0, 0.02, castShadow));
    add(makeActorBox(0.19, 0.045, 0.055, actorMats.armor, 0.11, 1.59, -0.265, 0, 0, -0.02, castShadow));
    add(makeActorBox(0.045, 0.08, 0.035, actorMats.strap, 0, 1.50, -0.282, 0, 0, 0, castShadow));
    if (isPlayer) {
      const rankPlate = add(makeActorBox(0.18, 0.055, 0.03, actorMats.scarf, 0, 1.205, -0.292, -0.03, 0, 0, castShadow));
      parts.playerRankPlate = rankPlate;
    }

    parts.cosmeticLodMeshes = (parts.cosmeticLodMeshes || []).concat(detailMeshes);
    parts.actorDetailMeshes = detailMeshes;
  }

  function buildWastelandHumanoid(root, parts = {}, options = {}) {
    const castShadow = options.castShadow !== false;
    const isPlayer = !!options.isPlayer;

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(isPlayer ? 0.72 : 0.66, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: isPlayer ? 0.3 : 0.24, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    shadow.visible = true; // v7.74.81: cheap pseudo contact shadow while real shadow maps are disabled
    root.add(shadow);
    parts.shadow = shadow;

    const legs = new THREE.Group();
    const legL = makeActorBox(0.18, 0.56, 0.22, actorMats.pants, -0.17, 0.36, 0.02, 0.05, 0, 0.03, castShadow);
    const legR = makeActorBox(0.18, 0.56, 0.22, actorMats.pants, 0.17, 0.36, 0.02, -0.04, 0, -0.03, castShadow);
    const bootL = makeActorBox(0.26, 0.16, 0.34, actorMats.boot, -0.17, 0.08, -0.04, 0, 0, 0.02, castShadow);
    const bootR = makeActorBox(0.26, 0.16, 0.34, actorMats.boot, 0.17, 0.08, -0.04, 0, 0, -0.02, castShadow);
    legs.add(legL, legR, bootL, bootR);
    root.add(legs);
    parts.legs = legs;
    parts.legL = legL;
    parts.legR = legR;

    const body = makeActorCylinder(0.32, 0.43, 0.88, 10, actorMats.coat, 0, 0.88, 0.03, 0, 0, 0, castShadow);
    root.add(body);
    parts.body = body;

    const chest = makeActorBox(0.74, 0.56, 0.34, actorMats.coat, 0, 1.08, -0.02, 0.03, 0, 0, castShadow);
    root.add(chest);
    parts.chest = chest;

    const chestPlate = makeActorBox(0.54, 0.38, 0.09, actorMats.armor, 0, 1.09, -0.22, -0.06, 0, 0, castShadow);
    const bellyPlate = makeActorBox(0.44, 0.18, 0.08, actorMats.rustPlate, 0.02, 0.82, -0.22, 0.06, 0, -0.02, castShadow);
    const belt = makeActorBox(0.78, 0.12, 0.44, actorMats.strap, 0, 0.72, -0.01, 0, 0, 0, castShadow);
    chestPlate.userData.cosmeticLod = true;
    bellyPlate.userData.cosmeticLod = true;
    root.add(chestPlate, bellyPlate, belt);
    parts.baseChestPlate = chestPlate;
    parts.baseBellyPlate = bellyPlate;
    parts.belt = belt;

    const coatBack = makeActorBox(0.66, 0.5, 0.12, actorMats.coat, 0, 0.67, 0.28, -0.08, 0, 0, castShadow);
    const coatLeft = makeActorBox(0.16, 0.44, 0.17, actorMats.coat, -0.42, 0.72, 0.11, -0.05, 0, 0.1, castShadow);
    const coatRight = makeActorBox(0.16, 0.44, 0.17, actorMats.coat, 0.42, 0.72, 0.11, -0.05, 0, -0.1, castShadow);
    coatBack.userData.cosmeticLod = true;
    coatLeft.userData.cosmeticLod = true;
    coatRight.userData.cosmeticLod = true;
    root.add(coatBack, coatLeft, coatRight);
    parts.coatBack = coatBack;

    const shoulderL = makeActorBox(0.27, 0.14, 0.26, actorMats.rustPlate, -0.49, 1.28, -0.02, 0, 0, -0.2, castShadow);
    const shoulderR = makeActorBox(0.27, 0.14, 0.26, actorMats.armor, 0.49, 1.28, -0.02, 0, 0, 0.2, castShadow);
    shoulderL.userData.cosmeticLod = true;
    shoulderR.userData.cosmeticLod = true;
    root.add(shoulderL, shoulderR);
    parts.baseShoulderL = shoulderL;
    parts.baseShoulderR = shoulderR;

    const armL = makeActorBox(0.15, 0.62, 0.17, actorMats.coat, -0.52, 1.02, 0.0, 0.02, 0, -0.22, castShadow);
    const armR = makeActorBox(0.15, 0.62, 0.17, actorMats.coat, 0.52, 1.02, 0.0, 0.02, 0, 0.22, castShadow);
    const forearmL = makeActorBox(0.15, 0.28, 0.18, actorMats.strap, -0.58, 0.75, -0.06, 0.02, 0, -0.08, castShadow);
    const forearmR = makeActorBox(0.15, 0.28, 0.18, actorMats.strap, 0.58, 0.75, -0.06, 0.02, 0, 0.08, castShadow);
    root.add(armL, armR, forearmL, forearmR);
    parts.armL = armL;
    parts.armR = armR;
    parts.forearmL = forearmL;
    parts.forearmR = forearmR;

    const neckWrap = makeActorCylinder(0.25, 0.28, 0.14, 12, actorMats.scarf, 0, 1.38, -0.02, 0, 0, 0, castShadow);
    root.add(neckWrap);
    parts.neckWrap = neckWrap;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), mats.skin);
    head.position.set(0, 1.6, -0.02);
    head.castShadow = castShadow;
    root.add(head);
    parts.head = head;

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.285, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), actorMats.armor);
    helmet.position.set(0, 1.69, -0.01);
    helmet.castShadow = castShadow;
    root.add(helmet);
    parts.helmet = helmet;

    const goggles = makeActorBox(0.34, 0.11, 0.075, actorMats.glass, 0, 1.59, -0.22, 0, 0, 0, castShadow);
    const mask = makeActorBox(0.19, 0.13, 0.105, actorMats.strap, 0, 1.49, -0.22, 0, 0, 0, castShadow);
    const filterL = makeActorCylinder(0.045, 0.045, 0.11, 8, actorMats.armor, -0.12, 1.48, -0.24, Math.PI / 2, 0, 0, castShadow);
    const filterR = filterL.clone();
    filterR.position.x = 0.12;
    root.add(goggles, mask, filterL, filterR);
    parts.goggles = goggles;
    parts.mask = mask;

    const backpack = makeActorBox(0.58, 0.66, 0.24, actorMats.pack, 0, 1.03, 0.38, 0, 0, 0, castShadow);
    const bedroll = makeActorCylinder(0.11, 0.11, 0.62, 12, actorMats.scarf, 0, 1.37, 0.42, 0, 0, Math.PI / 2, castShadow);
    const packStrap = makeActorBox(0.08, 0.78, 0.06, actorMats.strap, -0.23, 1.04, 0.22, 0.05, 0, 0.06, castShadow);
    const packStrap2 = packStrap.clone();
    packStrap2.position.x = 0.23;
    packStrap2.rotation.z = -0.06;
    root.add(backpack, bedroll, packStrap, packStrap2);
    parts.backpack = backpack;
    parts.bedroll = bedroll;

    addWastelandActorDetailPass(root, parts, castShadow, isPlayer);

    const weaponGroup = new THREE.Group();
    weaponGroup.position.set(0.53, 1.04, -0.27);
    weaponGroup.rotation.set(0.04, 0, -0.08);
    weaponGroup.userData.handSlot = 'weapon';
    root.add(weaponGroup);
    parts.weaponGroup = weaponGroup;

    const offhandWeaponGroup = new THREE.Group();
    offhandWeaponGroup.position.set(-0.53, 1.04, -0.27);
    offhandWeaponGroup.rotation.set(0.04, 0, 0.08);
    offhandWeaponGroup.userData.handSlot = 'offhand';
    root.add(offhandWeaponGroup);
    parts.offhandWeaponGroup = offhandWeaponGroup;

    parts.cosmeticLodMeshes = [
      chestPlate, bellyPlate, coatBack, coatLeft, coatRight, shoulderL, shoulderR,
      goggles, mask, filterL, filterR, bedroll, packStrap, packStrap2,
      ...(parts.actorDetailMeshes || [])
    ];
    parts.baseMaterials = { body: actorMats.coat, chest: actorMats.coat, arm: actorMats.coat, helmet: actorMats.armor, backpack: actorMats.pack };
    root.userData.parts = parts;
    return parts;
  }

  const playerGroup = new THREE.Group();
  scene.add(playerGroup);

  let playerParts = {};

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
    buildModernWastelandHumanoid(playerGroup, playerParts, { castShadow: true, isPlayer: true });
    if (typeof captureCharacterProceduralBaseMeshes === 'function') {
      captureCharacterProceduralBaseMeshes(playerGroup, playerParts);
    }
    buildModernCharacterArmorExtras(playerGroup, playerParts, true);
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

  function buildCharacterArmorExtras(root, parts, castShadow = true) {
    const styleMats = {
      vest: new THREE.MeshStandardMaterial({ color: 0x2e3137, roughness: 0.8, metalness: 0.12 }),
      combat: new THREE.MeshStandardMaterial({ color: 0x596a56, roughness: 0.65, metalness: 0.18 }),
      hazmat: new THREE.MeshStandardMaterial({ color: 0xa4b945, roughness: 0.86 }),
      hazmatDark: new THREE.MeshStandardMaterial({ color: 0x5c6d27, roughness: 0.84 }),
      energy: new THREE.MeshStandardMaterial({ color: 0x315268, roughness: 0.48, metalness: 0.38 }),
      energyGlow: new THREE.MeshStandardMaterial({ color: 0x6ec5ff, emissive: 0x2e9fff, emissiveIntensity: 0.9, roughness: 0.26, metalness: 0.2 }),
      visor: new THREE.MeshStandardMaterial({ color: 0x7bd4b6, emissive: 0x1d5f58, emissiveIntensity: 0.45, transparent: true, opacity: 0.82, roughness: 0.18, metalness: 0.1 }),
      heavy: new THREE.MeshStandardMaterial({ color: 0x70756f, roughness: 0.38, metalness: 0.56 }),
      plateDark: new THREE.MeshStandardMaterial({ color: 0x454a49, roughness: 0.52, metalness: 0.4 }),
      leatherJacket: new THREE.MeshStandardMaterial({ color: 0x6a4125, roughness: 0.86, metalness: 0.04 }),
      leatherTrim: new THREE.MeshStandardMaterial({ color: 0x3f2414, roughness: 0.88, metalness: 0.02 })
    };
    parts.styleMats = styleMats;

    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.48, 0.16), styleMats.plateDark);
    chestPlate.position.set(0, 1.05, -0.12);
    chestPlate.castShadow = castShadow;
    chestPlate.visible = false;
    root.add(chestPlate);

    const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.24), styleMats.heavy);
    shoulderL.position.set(-0.46, 1.26, -0.02);
    shoulderL.rotation.z = -0.22;
    shoulderL.castShadow = castShadow;
    shoulderL.visible = false;
    const shoulderR = shoulderL.clone();
    shoulderR.position.x = 0.46;
    shoulderR.rotation.z = 0.22;
    root.add(shoulderL, shoulderR);

    const energyCore = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.04), styleMats.energyGlow);
    energyCore.position.set(0, 1.02, -0.23);
    energyCore.castShadow = false;
    energyCore.visible = false;
    root.add(energyCore);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.06), styleMats.visor);
    visor.position.set(0, 1.58, -0.2);
    visor.castShadow = castShadow;
    visor.visible = false;
    root.add(visor);

    const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.38, 10), styleMats.hazmatDark);
    canister.rotation.z = Math.PI / 2;
    canister.position.set(0.22, 1.03, 0.34);
    canister.castShadow = castShadow;
    canister.visible = false;
    root.add(canister);

    const helmetVisor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.09), styleMats.visor);
    helmetVisor.position.set(0, 1.58, -0.22);
    helmetVisor.castShadow = castShadow;
    helmetVisor.visible = false;
    root.add(helmetVisor);

    const helmetFront = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.08), styleMats.heavy);
    helmetFront.position.set(0, 1.47, -0.18);
    helmetFront.castShadow = castShadow;
    helmetFront.visible = false;
    root.add(helmetFront);

    const helmetPodL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.08), styleMats.heavy);
    helmetPodL.position.set(-0.24, 1.57, -0.02);
    helmetPodL.castShadow = castShadow;
    helmetPodL.visible = false;
    const helmetPodR = helmetPodL.clone();
    helmetPodR.position.x = 0.24;
    root.add(helmetPodL, helmetPodR);

    const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.28), styleMats.plateDark);
    bootL.position.set(-0.18, 0.08, 0.08);
    bootL.castShadow = castShadow;
    bootL.visible = false;
    const bootR = bootL.clone();
    bootR.position.x = 0.18;
    root.add(bootL, bootR);

    const injuryGroup = new THREE.Group();
    injuryGroup.position.set(0, 2.72, 0);
    injuryGroup.visible = false;
    root.add(injuryGroup);

    const leatherTorso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.54, 0.18), styleMats.leatherJacket);
    leatherTorso.position.set(0, 1.03, -0.11);
    leatherTorso.castShadow = castShadow;
    leatherTorso.visible = false;
    root.add(leatherTorso);

    const leatherSleeveL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.44, 0.16), styleMats.leatherJacket);
    leatherSleeveL.position.set(-0.47, 1.01, 0);
    leatherSleeveL.rotation.z = 0.14;
    leatherSleeveL.castShadow = castShadow;
    leatherSleeveL.visible = false;
    const leatherSleeveR = leatherSleeveL.clone();
    leatherSleeveR.position.x = 0.47;
    leatherSleeveR.rotation.z = -0.14;
    root.add(leatherSleeveL, leatherSleeveR);

    const leatherCollarL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.08), styleMats.leatherTrim);
    leatherCollarL.position.set(-0.12, 1.28, -0.18);
    leatherCollarL.rotation.set(0.55, 0, 0.38);
    leatherCollarL.castShadow = castShadow;
    leatherCollarL.visible = false;
    const leatherCollarR = leatherCollarL.clone();
    leatherCollarR.position.x = 0.12;
    leatherCollarR.rotation.z = -0.38;
    root.add(leatherCollarL, leatherCollarR);

    parts.chestPlate = chestPlate;
    parts.shoulderL = shoulderL;
    parts.shoulderR = shoulderR;
    parts.energyCore = energyCore;
    parts.visor = visor;
    parts.canister = canister;
    parts.helmetVisor = helmetVisor;
    parts.helmetFront = helmetFront;
    parts.helmetPodL = helmetPodL;
    parts.helmetPodR = helmetPodR;
    parts.bootL = bootL;
    parts.bootR = bootR;
    parts.injuryGroup = injuryGroup;
    parts.leatherTorso = leatherTorso;
    parts.leatherSleeveL = leatherSleeveL;
    parts.leatherSleeveR = leatherSleeveR;
    parts.leatherCollarL = leatherCollarL;
    parts.leatherCollarR = leatherCollarR;
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

  function setCharacterArmMaterial(parts, side, material = null, fallbackMaterial = null) {
    const rows = parts?.[`armMaterialMeshes${side}`];
    if (Array.isArray(rows) && rows.length) {
      rows.forEach(row => {
        if (row?.mesh) row.mesh.material = material || row.material;
      });
      return;
    }
    const arm = parts?.[`arm${side}`];
    if (arm?.isMesh && (material || fallbackMaterial)) arm.material = material || fallbackMaterial;
  }

  function applyArmorVisualSet(parts, eq = {}) {
    if (!parts || !parts.chest) return;
    const armorId = String(equipmentVisualBaseId(eq.armor) || '');
    const helmetOn = !!eq.helmet;
    const bootsOn = !!eq.boots;
    const backpackOn = !!eq.backpack;
    const matsSet = parts.styleMats || {};
    const baseMats = parts.baseMaterials || {};
    const clothingMat = baseMats.body || mats.cloth;
    const chestMat = baseMats.chest || mats.leather;
    const armMat = baseMats.arm || clothingMat;

    if (parts.body) parts.body.material = clothingMat;
    setCharacterArmMaterial(parts, 'L', null, armMat);
    setCharacterArmMaterial(parts, 'R', null, armMat);
    if (parts.chest) {
      parts.chest.material = chestMat;
      parts.chest.scale.set(1, 1, 1);
    }
    if (parts.helmet) {
      parts.helmet.material = baseMats.helmet || mats.metal;
      parts.helmet.scale.set(1, parts.modernRig ? 0.72 : 1, 1);
      parts.helmet.visible = helmetOn;
    }
    if (Array.isArray(parts.hairMeshes)) parts.hairMeshes.forEach(mesh => { if (mesh) mesh.visible = !helmetOn; });
    if (parts.boots) parts.boots.visible = true;
    if (parts.backpack) parts.backpack.visible = backpackOn;
    if (Array.isArray(parts.packAccessories)) parts.packAccessories.forEach(mesh => { if (mesh) mesh.visible = backpackOn; });
    ['chestPlate','shoulderL','shoulderR','energyCore','visor','canister','helmetVisor','helmetFront','helmetPodL','helmetPodR','bootL','bootR','leatherTorso','leatherSleeveL','leatherSleeveR','leatherCollarL','leatherCollarR'].forEach(key => { if (parts[key]) parts[key].visible = false; });

    const helmetId = String(equipmentVisualBaseId(eq.helmet) || '');
    if (helmetOn && parts.helmet) {
      if (helmetId === 'tacticalHelmet') {
        parts.helmet.material = mats.darkMetal;
        if (parts.helmetVisor) parts.helmetVisor.visible = true;
      } else if (helmetId === 'assaultHelmet') {
        parts.helmet.material = matsSet.heavy || mats.metal;
        parts.helmet.scale.set(1.05, parts.modernRig ? 0.76 : 1.05, 1.05);
        if (parts.helmetFront) parts.helmetFront.visible = true;
        if (parts.helmetPodL && parts.helmetPodR) { parts.helmetPodL.visible = true; parts.helmetPodR.visible = true; }
        if (parts.helmetVisor) parts.helmetVisor.visible = true;
      }
    }

    const bootsId = String(equipmentVisualBaseId(eq.boots) || '');
    const serviceScoutBootActive = applyServiceScoutBootVisual(parts, bootsOn ? bootsId : '');
    if (!serviceScoutBootActive) {
      if (parts.baseBootL) parts.baseBootL.visible = true;
      if (parts.baseBootR) parts.baseBootR.visible = true;
      if (parts.baseGaiterL) parts.baseGaiterL.visible = true;
      if (parts.baseGaiterR) parts.baseGaiterR.visible = true;
    }
    if (bootsOn && parts.bootL && parts.bootR) {
      parts.bootL.visible = !serviceScoutBootActive;
      parts.bootR.visible = !serviceScoutBootActive;
      parts.bootL.scale.set(1, 1, 1);
      parts.bootR.scale.set(1, 1, 1);
      if (bootsId === 'scoutBoots') {
        parts.bootL.material = mats.leaves2 || mats.darkMetal;
        parts.bootR.material = mats.leaves2 || mats.darkMetal;
        parts.bootL.scale.set(0.88, 0.8, 1.1);
        parts.bootR.scale.set(0.88, 0.8, 1.1);
      } else if (bootsId === 'reinforcedBoots') {
        parts.bootL.material = matsSet.heavy || mats.darkMetal;
        parts.bootR.material = matsSet.heavy || mats.darkMetal;
        parts.bootL.scale.set(1.08, 1.12, 1.05);
        parts.bootR.scale.set(1.08, 1.12, 1.05);
      } else {
        parts.bootL.material = mats.darkMetal;
        parts.bootR.material = mats.darkMetal;
      }
    }

    if (armorId === 'leather') {
      parts.chest.material = matsSet.leatherJacket || mats.leather;
      if (parts.body) parts.body.material = matsSet.leatherTrim || mats.leather;
      if (parts.leatherTorso) parts.leatherTorso.visible = true;
      if (parts.leatherSleeveL) parts.leatherSleeveL.visible = true;
      if (parts.leatherSleeveR) parts.leatherSleeveR.visible = true;
      if (parts.leatherCollarL) parts.leatherCollarL.visible = true;
      if (parts.leatherCollarR) parts.leatherCollarR.visible = true;
    } else if (armorId === 'metalArmor') {
      parts.chest.material = mats.metal;
      if (parts.chestPlate) { parts.chestPlate.visible = true; parts.chestPlate.material = matsSet.plateDark || mats.darkMetal; }
      if (parts.shoulderL && parts.shoulderR) { parts.shoulderL.visible = true; parts.shoulderR.visible = true; }
    } else if (armorId === 'ballisticVest') {
      if (parts.body) parts.body.material = matsSet.vest || mats.darkMetal;
      setCharacterArmMaterial(parts, 'L', matsSet.vest || mats.darkMetal);
      setCharacterArmMaterial(parts, 'R', matsSet.vest || mats.darkMetal);
      parts.chest.material = matsSet.vest || mats.darkMetal;
      if (parts.chestPlate) { parts.chestPlate.visible = true; parts.chestPlate.material = matsSet.vest || mats.darkMetal; }
    } else if (armorId === 'combatArmor') {
      if (parts.body) parts.body.material = matsSet.combat || mats.metal;
      parts.chest.material = matsSet.combat || mats.metal;
      parts.chest.scale.set(1.08, 1.06, 1);
      if (parts.chestPlate) { parts.chestPlate.visible = true; parts.chestPlate.material = matsSet.plateDark || mats.darkMetal; }
      if (parts.shoulderL && parts.shoulderR) { parts.shoulderL.visible = true; parts.shoulderR.visible = true; }
    } else if (armorId === 'hazmatSuit') {
      if (parts.body) parts.body.material = matsSet.hazmat || mats.cloth;
      setCharacterArmMaterial(parts, 'L', matsSet.hazmat || mats.cloth);
      setCharacterArmMaterial(parts, 'R', matsSet.hazmat || mats.cloth);
      parts.chest.material = matsSet.hazmat || mats.cloth;
      if (parts.canister) parts.canister.visible = true;
      if (parts.visor) parts.visor.visible = helmetOn;
      if (parts.helmet) parts.helmet.material = matsSet.hazmatDark || mats.metal;
    } else if (armorId === 'heavyArmor') {
      if (parts.body) parts.body.material = matsSet.heavy || mats.metal;
      parts.chest.material = matsSet.heavy || mats.metal;
      parts.chest.scale.set(1.12, 1.1, 1.04);
      if (parts.chestPlate) { parts.chestPlate.visible = true; parts.chestPlate.scale.set(1.1, 1.12, 1.1); parts.chestPlate.material = matsSet.heavy || mats.metal; }
      if (parts.shoulderL && parts.shoulderR) { parts.shoulderL.visible = true; parts.shoulderR.visible = true; parts.shoulderL.scale.set(1.25, 1.25, 1.25); parts.shoulderR.scale.set(1.25, 1.25, 1.25); }
      if (parts.visor) parts.visor.visible = helmetOn;
    } else if (armorId === 'energySuit') {
      if (parts.body) parts.body.material = matsSet.energy || mats.metal;
      setCharacterArmMaterial(parts, 'L', matsSet.energy || mats.metal);
      setCharacterArmMaterial(parts, 'R', matsSet.energy || mats.metal);
      parts.chest.material = matsSet.energy || mats.metal;
      if (parts.chestPlate) { parts.chestPlate.visible = true; parts.chestPlate.material = matsSet.energy || mats.metal; }
      if (parts.energyCore) parts.energyCore.visible = true;
      if (parts.visor) parts.visor.visible = helmetOn;
    }

    if (armorId !== 'heavyArmor' && parts.shoulderL && parts.shoulderR) {
      parts.shoulderL.scale.set(1, 1, 1);
      parts.shoulderR.scale.set(1, 1, 1);
    }
    if (armorId !== 'heavyArmor' && parts.chestPlate) parts.chestPlate.scale.set(1, 1, 1);
    if (!['hazmatSuit','energySuit','heavyArmor'].includes(armorId) && parts.visor) parts.visor.visible = false;
    if (typeof refreshCharacterGlbEquipmentLayers === 'function' && parts.characterRoot) {
      refreshCharacterGlbEquipmentLayers(parts.characterRoot, eq);
    }
  }

  function makePistolMesh() {
    const g = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.68), mats.darkMetal);
    barrel.position.z = -0.32;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 0.16), mats.darkMetal);
    grip.position.set(0.02, -0.15, 0.04);
    grip.rotation.x = 0.35;
    g.add(barrel, grip);
    return g;
  }

  function makeRifleMesh() {
    const g = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.62), mats.leather);
    stock.position.z = 0.18;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.1), mats.darkMetal);
    barrel.position.z = -0.52;
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.36, 8), mats.metal);
    scope.rotation.z = Math.PI / 2;
    scope.position.set(0, 0.13, -0.28);
    g.add(stock, barrel, scope);
    return g;
  }

  function makeAssaultRifleMesh() {
    const g = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.52), mats.leather);
    stock.position.z = 0.22;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.45), mats.darkMetal);
    body.position.z = -0.16;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.8), mats.metal);
    barrel.position.z = -0.72;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.14), mats.darkMetal);
    mag.position.set(0, -0.18, -0.08);
    g.add(stock, body, barrel, mag);
    return g;
  }

  function makeKnifeMesh() {
    const g = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.58), mats.metal);
    blade.position.z = -0.26;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.25), mats.leather);
    handle.position.z = 0.18;
    g.add(blade, handle);
    return g;
  }

  function makePickaxeMesh() {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.05), mats.leather);
    handle.position.z = -0.22;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.1), mats.metal);
    head.position.set(0, 0.04, -0.76);
    const spikeL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.08), mats.metal);
    spikeL.position.set(-0.44, 0.04, -0.76);
    spikeL.rotation.y = -0.28;
    const spikeR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.08), mats.metal);
    spikeR.position.set(0.44, 0.04, -0.76);
    spikeR.rotation.y = 0.28;
    g.add(handle, head, spikeL, spikeR);
    g.rotation.z = -0.2;
    return g;
  }

  function makeAxeMesh() {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.95), mats.leather);
    handle.position.z = -0.18;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.28), mats.metal);
    head.position.set(0.18, 0.04, -0.66);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, 0.38), mats.metal);
    blade.position.set(0.36, 0.04, -0.66);
    blade.rotation.y = -0.18;
    g.add(handle, head, blade);
    g.rotation.z = 0.16;
    return g;
  }

  function makeHandPumpMesh() {
    const g = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.82), mats.metal);
    tube.position.z = -0.24;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.08), mats.leather);
    handle.position.set(0, 0.1, -0.58);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.1), mats.leather);
    grip.position.set(0.32, -0.05, 0.1);
    const nozzle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.28), mats.darkMetal);
    nozzle.position.z = -0.78;
    g.add(tube, handle, grip, nozzle);
    g.rotation.z = -0.08;
    return g;
  }

  function makeMachineGunMesh() {
    const g = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.5), mats.leather);
    stock.position.z = 0.28;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.7), mats.darkMetal);
    body.position.z = -0.14;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.05), mats.metal);
    barrel.position.z = -0.9;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.34), mats.metal);
    top.position.set(0, 0.12, -0.18);
    const ammoBox = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2), mats.darkMetal);
    ammoBox.position.set(0.02, -0.16, -0.12);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.12), mats.leather);
    grip.position.set(0.02, -0.18, 0.08);
    g.add(stock, body, barrel, top, ammoBox, grip);
    return g;
  }

  function makeLaserPistolMesh() {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.58), mats.darkMetal);
    frame.position.z = -0.2;
    const emitter = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.22), new THREE.MeshStandardMaterial({ color: 0xff708f, emissive: 0xff2f5b, emissiveIntensity: 0.9, roughness: 0.18, metalness: 0.22 }));
    emitter.position.z = -0.58;
    const coil = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.28), new THREE.MeshStandardMaterial({ color: 0x5ec8ff, emissive: 0x2d86ff, emissiveIntensity: 0.8, roughness: 0.15 }));
    coil.position.set(0, 0.08, -0.14);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), mats.darkMetal);
    grip.position.set(0.02, -0.15, 0.08);
    grip.rotation.x = 0.35;
    g.add(frame, emitter, coil, grip);
    return g;
  }

  function makeFlamethrowerMesh() {
    const g = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 10), new THREE.MeshStandardMaterial({ color: 0x6a6c70, roughness: 0.45, metalness: 0.45 }));
    tank.rotation.x = Math.PI / 2;
    tank.position.set(0, -0.02, 0.22);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.78), mats.darkMetal);
    body.position.z = -0.2;
    const nozzle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.38), new THREE.MeshStandardMaterial({ color: 0x6d7780, roughness: 0.34, metalness: 0.5 }));
    nozzle.position.z = -0.76;
    const pilot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.16), new THREE.MeshStandardMaterial({ color: 0xff9234, emissive: 0xff5a00, emissiveIntensity: 1.0 }));
    pilot.position.z = -0.97;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.14), mats.leather);
    grip.position.set(0.03, -0.16, 0.02);
    g.add(tank, body, nozzle, pilot, grip);
    return g;
  }

  function makePlasmaRifleMesh() {
    const g = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.42), mats.darkMetal);
    stock.position.z = 0.28;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.72), new THREE.MeshStandardMaterial({ color: 0x35505e, roughness: 0.36, metalness: 0.35 }));
    body.position.z = -0.12;
    const chamber = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.28), new THREE.MeshStandardMaterial({ color: 0x6df0b1, emissive: 0x17c96f, emissiveIntensity: 1.1, roughness: 0.15 }));
    chamber.position.set(0, 0.08, -0.18);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.82), mats.metal);
    barrel.position.z = -0.82;
    g.add(stock, body, chamber, barrel);
    return g;
  }

  function makeShotgunMesh() {
    const g = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.48), mats.leather);
    stock.position.z = 0.26;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.34), mats.darkMetal);
    receiver.position.z = -0.02;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.95), mats.metal);
    barrel.position.z = -0.74;
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.3), mats.leather);
    pump.position.z = -0.44;
    g.add(stock, receiver, barrel, pump);
    return g;
  }

  function makeRocketLauncherMesh() {
    const g = new THREE.Group();
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x4d5555, roughness: 0.5, metalness: 0.45 });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.25, 14), tubeMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = -0.35;
    const rear = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 14), mats.darkMetal);
    rear.rotation.x = Math.PI / 2;
    rear.position.z = 0.32;
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.18, 14), mats.metal);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.z = -1.02;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), mats.leather);
    grip.position.set(0.02, -0.2, -0.05);
    grip.rotation.x = 0.28;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.22), mats.darkMetal);
    sight.position.set(0, 0.15, -0.42);
    g.add(tube, rear, muzzle, grip, sight);
    return g;
  }

  function makePlayerWeaponMesh(weaponId = '') {
    if (!weaponId || weaponId === 'fists') return null;
    let mesh = typeof makeWeaponModelMesh === 'function' ? makeWeaponModelMesh(weaponId) : null;
    if (!mesh && weaponId === 'pistol') mesh = makePistolMesh();
    else if (!mesh && weaponId === 'rifle') mesh = makeRifleMesh();
    else if (!mesh && weaponId === 'assaultRifle') mesh = makeAssaultRifleMesh();
    else if (!mesh && weaponId === 'machineGun') mesh = makeMachineGunMesh();
    else if (!mesh && weaponId === 'laserPistol') mesh = makeLaserPistolMesh();
    else if (!mesh && weaponId === 'flamethrower') mesh = makeFlamethrowerMesh();
    else if (!mesh && weaponId === 'plasmaRifle') mesh = makePlasmaRifleMesh();
    else if (!mesh && weaponId === 'shotgun') mesh = makeShotgunMesh();
    else if (!mesh && weaponId === 'rocketLauncher') mesh = makeRocketLauncherMesh();
    else if (!mesh && weaponId === 'knife') mesh = makeKnifeMesh();
    else if (!mesh && weaponId === 'pickaxe') mesh = makePickaxeMesh();
    else if (!mesh && weaponId === 'axe') mesh = makeAxeMesh();
    else if (!mesh && weaponId === 'handPump') mesh = makeHandPumpMesh();
    return mesh;
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
      weaponGroup.clear();
      initWeaponVisualState(weaponGroup);
      weaponGroup.userData.handSlot = handSlot;
      weaponGroup.userData.weaponId = slotWeaponId || 'fists';
      const mesh = makePlayerWeaponMesh(slotWeaponId);
      if (mesh) weaponGroup.add(mesh);
    });
    stabilizeCharacterNoCull(playerGroup);

    applyArmorVisualSet(playerParts, equipment);
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
