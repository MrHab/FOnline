  // ===== ITEMS / INVENTORY / EQUIPMENT =====
  const ITEMS = {
    pistol: { id: 'pistol', weight: 1.5, name: '9mm пистолет', icon: '🔫', type: 'weapon', slot: 'weapon', hands: 1, dualWield: true, weaponSkill: 'lightWeapons', damageType: 'ballistic', requiredStrength: 2, desc: 'Лёгкое одноручное оружие. Два пистолета открывают поочерёдный огонь и режим «Парный залп».', dmg: [18, 26], range: 12, ammoType: 'ammo9', magSize: 1, loaded: 1, fireRate: 0.48, apCost: 3, reloadApCost: 2 },
    revolver: { id: 'revolver', weight: 2.0, name: 'Ржавый револьвер', icon: '🔫', type: 'weapon', slot: 'weapon', hands: 1, weaponSkill: 'lightWeapons', damageType: 'ballistic', requiredStrength: 3, desc: 'Кустарный барабанник под 9мм. Шесть камор, честный бой на средней дистанции.', dmg: [22, 32], range: 14, ammoType: 'ammo9', magSize: 6, loaded: 6, fireRate: 0.55, apCost: 3, reloadApCost: 3 },
    sawedOffShotgun: { id: 'sawedOffShotgun', weight: 2.4, name: 'Обрез', icon: '💥', type: 'weapon', slot: 'weapon', hands: 1, weaponSkill: 'lightWeapons', damageType: 'ballistic', requiredStrength: 4, desc: 'Спиленная двустволка. Два заряда дроби в упор — и разговор окончен.', dmg: [30, 44], range: 7, ammoType: 'shotgunShell', magSize: 2, loaded: 2, fireRate: 0.6, apCost: 4, reloadApCost: 3 },
    smg: { id: 'smg', weight: 3.2, name: 'Самодельный ПП', icon: '🔫', type: 'weapon', slot: 'weapon', hands: 2, weaponSkill: 'lightWeapons', damageType: 'ballistic', requiredStrength: 4, desc: 'Трещотка из гнутого листа и трубы. Двуручное автоматическое оружие под 9мм.', dmg: [12, 17], range: 14, ammoType: 'ammo9', magSize: 24, loaded: 24, fireRate: 0.26, apCost: 4, reloadApCost: 3, automatic: true },
    rifle: { id: 'rifle', weight: 4.0, name: 'Охотничья винтовка', icon: '🟫', type: 'weapon', slot: 'weapon', hands: 2, weaponSkill: 'lightWeapons', damageType: 'ballistic', requiredStrength: 4, desc: 'Двуручное лёгкое оружие большой дальности. Режимы: одиночный и прицельный.', dmg: [28, 40], range: 24, ammoType: 'ammo556', magSize: 5, loaded: 5, fireRate: 0.9, apCost: 4, reloadApCost: 3 },
    assaultRifle: { id: 'assaultRifle', weight: 4.8, name: 'Ржавый автомат', icon: '🔫', type: 'weapon', slot: 'weapon', hands: 2, weaponSkill: 'lightWeapons', damageType: 'ballistic', requiredStrength: 5, desc: 'Двуручное автоматическое лёгкое оружие под .223. Режимы: одиночный, прицельный и автоматический. Автоматический режим стреляет одиночными пулями при удержании кнопки.', dmg: [13, 19], range: 18, ammoType: 'ammo556', magSize: 30, loaded: 30, fireRate: 0.42, apCost: 4, reloadApCost: 4, automatic: true },
    machineGun: { id: 'machineGun', weight: 8.8, name: 'Самодельный пулемёт', icon: '🧨', type: 'weapon', slot: 'weapon', hands: 2, weaponSkill: 'heavyWeapons', damageType: 'ballistic', requiredStrength: 7, desc: 'Двуручное тяжёлое автоматическое оружие. Автоматический режим стреляет одиночными пулями при удержании кнопки. Требует высокой Силы.', dmg: [12, 18], range: 20, ammoType: 'ammo556', magSize: 45, loaded: 45, fireRate: 0.58, apCost: 5, reloadApCost: 6, automatic: true },
    laserPistol: { id: 'laserPistol', weight: 2.2, name: 'Лазерный пистолет', icon: '🔴', type: 'weapon', slot: 'weapon', hands: 1, dualWield: true, weaponSkill: 'energyWeapons', damageType: 'energy', requiredStrength: 3, energyFailureBase: 0.18, desc: 'Одноручное энергетическое оружие. Два пистолета открывают поочерёдный огонь и режим «Парный залп». Может перегреться или дать сбой.', dmg: [22, 32], range: 16, ammoType: 'energyCell', magSize: 12, loaded: 12, fireRate: 0.62, apCost: 4, reloadApCost: 4 },
    flamethrower: { id: 'flamethrower', weight: 7.4, name: 'Огнемёт', icon: '🔥', type: 'weapon', slot: 'weapon', hands: 2, weaponSkill: 'heavyWeapons', damageType: 'fire', requiredStrength: 6, desc: 'Двуручное тяжёлое оружие ближнего боя. Наносит огненный урон струёй, поддерживает автоматический режим. Использует напалм.', dmg: [14, 22], range: 8, ammoType: 'napalm', magSize: 30, loaded: 30, fireRate: 0.34, apCost: 5, reloadApCost: 6, automatic: true },
    plasmaRifle: { id: 'plasmaRifle', weight: 5.1, name: 'Плазменное ружьё', icon: '🟢', type: 'weapon', slot: 'weapon', hands: 2, weaponSkill: 'energyWeapons', damageType: 'energy', requiredStrength: 5, energyFailureBase: 0.14, desc: 'Мощное двуручное энергетическое ружьё. Тяжёлое, точное и опасное.', dmg: [32, 48], range: 18, ammoType: 'energyCell', magSize: 14, loaded: 14, fireRate: 0.48, apCost: 5, reloadApCost: 5 },
    shotgun: { id: 'shotgun', weight: 4.2, name: 'Дробовик', icon: '💥', type: 'weapon', slot: 'weapon', hands: 2, weaponSkill: 'lightWeapons', damageType: 'ballistic', requiredStrength: 5, desc: 'Двуручное оружие для ближней и средней дистанции. Стреляет дробовым зарядом.', dmg: [26, 40], range: 11, ammoType: 'shotgunShell', magSize: 6, loaded: 6, fireRate: 0.52, apCost: 5, reloadApCost: 4 },
    rocketLauncher: { id: 'rocketLauncher', weight: 9.6, name: 'Ракетница', icon: '🚀', type: 'weapon', slot: 'weapon', hands: 2, weaponSkill: 'heavyWeapons', damageType: 'explosive', requiredStrength: 7, desc: 'Двуручное тяжёлое оружие с взрывным уроном по области. Взрыв задевает всех в радиусе, включая стрелка.', dmg: [54, 78], range: 22, ammoType: 'rocketAmmo', magSize: 1, loaded: 1, fireRate: 1.1, apCost: 6, reloadApCost: 7, explosiveRadius: 4.2 },
    knife: { id: 'knife', weight: 0.5, name: 'Боевой нож', icon: '🗡️', type: 'weapon', slot: 'weapon', hands: 1, weaponSkill: 'melee', damageType: 'ballistic', requiredStrength: 1, desc: 'Одноручное оружие ближнего боя. Не требует патронов.', dmg: [9, 15], range: 2.1, ammoType: null, magSize: 0, loaded: 0, fireRate: 0.55, apCost: 2 },
    fists: { id: 'fists', weight: 0, name: 'Кулаки', icon: '✊', type: 'weapon', hands: 1, weaponSkill: 'unarmed', damageType: 'ballistic', requiredStrength: 1, desc: 'Без оружия. Низкий урон, но всегда доступно.', dmg: [2, 4], range: 1.35, ammoType: null, magSize: 0, loaded: 0, fireRate: 0.62, apCost: 2 },
    leather: { id: 'leather', weight: 3.0, name: 'Кожаная куртка', icon: '🧥', type: 'armor', slot: 'armor', desc: 'Лёгкая броня. Немного защищает от баллистического урона: слабые удары, укусы, ножи, когти.', armor: 3, protection: { ballistic: 0.08, fire: 0.03 }, thresholds: { ballistic: 1 } },
    metalArmor: { id: 'metalArmor', weight: 7.5, name: 'Металлическая броня', icon: '🦾', type: 'armor', slot: 'armor', desc: 'Металлическая броня. Защищает от баллистического урона и частично от взрывного.', armor: 6, protection: { ballistic: 0.16, explosive: 0.06, fire: 0.08 }, thresholds: { ballistic: 2, explosive: 1 } },
    ballisticVest: { id: 'ballisticVest', weight: 5.5, name: 'Бронежилет', icon: '🎽', type: 'armor', slot: 'armor', desc: 'Бронежилет. Хорошо защищает от баллистического урона и немного от взрывного.', armor: 7, protection: { ballistic: 0.26, explosive: 0.05 }, thresholds: { ballistic: 4 } },
    combatArmor: { id: 'combatArmor', weight: 9.0, name: 'Боевая броня', icon: '🛡️', type: 'armor', slot: 'armor', desc: 'Боевая броня. Защищает от нескольких типов урона, но не имеет искусственных слабостей.', armor: 9, protection: { ballistic: 0.28, explosive: 0.14, energy: 0.10, fire: 0.12, radiation: 0.04, toxic: 0.04 }, thresholds: { ballistic: 4, explosive: 1, energy: 1, fire: 1 } },
    hazmatSuit: { id: 'hazmatSuit', weight: 4.2, name: 'Костюм химзащиты', icon: '☣️', type: 'armor', slot: 'armor', desc: 'Костюм химзащиты. Защищает от токсичного и радиационного урона.', armor: 2, protection: { radiation: 0.32, toxic: 0.38, energy: 0.04, fire: 0.18 }, thresholds: { radiation: 2, toxic: 2, fire: 1 } },
    heavyArmor: { id: 'heavyArmor', weight: 14.0, name: 'Тяжёлая броня', icon: '🪖', type: 'armor', slot: 'armor', desc: 'Тяжёлая броня. Хорошо защищает от баллистического и взрывного урона, частично от энергетического.', armor: 12, protection: { ballistic: 0.34, explosive: 0.22, energy: 0.12, fire: 0.18 }, thresholds: { ballistic: 6, explosive: 3, energy: 1, fire: 2 } },
    energySuit: { id: 'energySuit', weight: 6.8, name: 'Энергозащитный костюм', icon: '🔷', type: 'armor', slot: 'armor', desc: 'Энергозащитный костюм. Защищает от энергетического и радиационного урона.', armor: 5, protection: { energy: 0.30, radiation: 0.16, fire: 0.10 }, thresholds: { energy: 3, radiation: 1, fire: 1 } },
    preWarHelmet: { id: 'preWarHelmet', weight: 2.6, name: 'Довоенный боевой шлем', icon: '🪖', type: 'helmet', slot: 'helmet', armor: 5, desc: 'Армейский шлем старого мира: оливковая эмаль, визор, связь в наушнике. Такие больше не делают.', condition: 100 },
    weldedHelmet: { id: 'weldedHelmet', weight: 2.4, name: 'Сварной шлем', icon: '🪖', type: 'helmet', slot: 'helmet', armor: 1, desc: 'Купол из четырёх листов, сваренных крестом. Проволока вместо ремня, ржавчина вместо краски — но голову держит.', condition: 100 },
    helmet: { id: 'helmet', weight: 2.0, name: 'Стальной шлем', icon: '⛑️', type: 'helmet', slot: 'helmet', desc: 'Защита головы. Небольшая баллистическая защита.', armor: 2, protection: { ballistic: 0.05 }, thresholds: { ballistic: 1 } },
    tacticalHelmet: { id: 'tacticalHelmet', weight: 1.9, name: 'Тактический шлем', icon: '🪖', type: 'helmet', slot: 'helmet', desc: 'Современный шлем с закрытым визором. Лучше держит осколки и пули.', armor: 3, protection: { ballistic: 0.09, explosive: 0.03, fire: 0.02 }, thresholds: { ballistic: 1, explosive: 1 } },
    assaultHelmet: { id: 'assaultHelmet', weight: 2.8, name: 'Штурмовой шлем', icon: '🤖', type: 'helmet', slot: 'helmet', desc: 'Тяжёлый шлем с усиленной лицевой частью.', armor: 4, protection: { ballistic: 0.12, explosive: 0.05, energy: 0.03, fire: 0.05 }, thresholds: { ballistic: 2, explosive: 1 } },
    boots: { id: 'boots', weight: 1.5, name: 'Армейские ботинки', icon: '🥾', type: 'boots', slot: 'boots', desc: 'Уверенный шаг по пустоши.', speed: 0.22 },
    scoutBoots: { id: 'scoutBoots', weight: 1.1, name: 'Разведботинки', icon: '👢', type: 'boots', slot: 'boots', desc: 'Лёгкая обувь для быстрого передвижения.', speed: 0.34 },
    assaultBoots: { id: 'assaultBoots', weight: 2.6, name: 'Штурмовые ботинки', icon: '🥾', type: 'boots', slot: 'boots', desc: 'Армейская обувь с композитными накладками и полимерной защитой. Пара к штурмовому шлему.', speed: 0.12 },
    reinforcedBoots: { id: 'reinforcedBoots', weight: 2.2, name: 'Усиленные ботинки', icon: '🥾', type: 'boots', slot: 'boots', desc: 'Тяжёлая обувь с защитными накладками.', speed: 0.14 },
    backpack: { id: 'backpack', weight: 1.2, name: 'Рюкзак', icon: '🎒', type: 'backpack', slot: 'backpack', desc: 'Позволяет носить больше добычи.', carry: 20 },
    ammo9: { id: 'ammo9', weight: 0.025, name: 'Патроны 9mm', icon: '▪', type: 'ammo', desc: 'Боеприпасы для 9mm пистолета.' },
    ammo556: { id: 'ammo556', weight: 0.04, name: 'Патроны .223', icon: '▰', type: 'ammo', desc: 'Боеприпасы для винтовки, автомата и пулемёта.' },
    energyCell: { id: 'energyCell', weight: 0.03, name: 'Энергозаряды', icon: '🔋', type: 'ammo', desc: 'Боеприпасы для энергетического оружия.' },
    napalm: { id: 'napalm', weight: 0.08, name: 'Напалм', icon: '🔥', type: 'ammo', desc: 'Густая горючая смесь для огнемёта.' },
    shotgunShell: { id: 'shotgunShell', weight: 0.05, name: 'Патроны 12 калибра', icon: '◉', type: 'ammo', desc: 'Боеприпасы для дробовика.' },
    rocketAmmo: { id: 'rocketAmmo', weight: 0.85, name: 'Ракета', icon: '🚀', type: 'ammo', desc: 'Боеприпас для ракетницы. Даёт взрывной урон по области.' },
    medkit: { id: 'medkit', weight: 0.6, name: 'Аптечка', icon: '💊', type: 'consumable', equipSlot: 'weapon', desc: 'Первая помощь: восстанавливает 35 HP. Не лечит переломы, контузию и инфекцию.', heal: 35 },
    stim: { id: 'stim', weight: 0.2, name: 'Стимулятор', icon: '🧪', type: 'consumable', equipSlot: 'weapon', desc: 'Быстро восстанавливает 18 HP. Не лечит травмы.', heal: 18 },
    doctorBag: { id: 'doctorBag', weight: 0.9, name: 'Набор доктора', icon: '🩺', type: 'consumable', equipSlot: 'weapon', desc: 'Лечит перелом руки, перелом ноги или контузию. Шанс зависит от навыка Доктор.', doctor: true },
    antibiotics: { id: 'antibiotics', weight: 0.15, name: 'Антибиотики', icon: '🧫', type: 'consumable', equipSlot: 'weapon', desc: 'Лечат инфекцию.', cureInfection: true },
    ore: { id: 'ore', weight: 2.0, name: 'Железная руда', icon: '⛏️', type: 'material', desc: 'Материал для ремонта и торговли.' },
    wood: { id: 'wood', weight: 1.2, name: 'Древесина', icon: '🪵', type: 'material', desc: 'Материал для костров и ремонта.' },
    scrap: { id: 'scrap', weight: 1.4, name: 'Металлолом', icon: 'M', type: 'material', desc: 'Лом, трубы и крепёж. Нужен для ремонта, крафта и торговли.' },
    oil: { id: 'oil', weight: 1.5, name: 'Канистра нефти', icon: 'O', type: 'material', desc: 'Густая нефть из старых насосов. Нужна для топлива, огнемётов и производства.' },
    chemicals: { id: 'chemicals', weight: 0.45, name: 'Химикаты', icon: 'C', type: 'material', desc: 'Реактивы, кислоты и растворители для медицины, напалма и электроники.' },
    medicine: { id: 'medicine', weight: 0.35, name: 'Медикаменты', icon: '+', type: 'material', desc: 'Бинты, порошки и лекарственные компоненты для медицинского производства.' },
    electronics: { id: 'electronics', weight: 0.6, name: 'Электроника', icon: 'E', type: 'material', desc: 'Платы, реле и исправные детали для энергооружия и сложного ремонта.' },
    ammoParts: { id: 'ammoParts', weight: 0.18, name: 'Детали патронов', icon: 'A', type: 'material', desc: 'Капсюли, гильзы и мелкие детали для производства боеприпасов.' },
    food: { id: 'food', weight: 0.65, name: 'Пища', icon: 'F', type: 'misc', desc: 'Съедобные припасы для поселений, караванов и рабочих смен.' },
    weaponParts: { id: 'weaponParts', weight: 0.85, name: 'Оружейные детали', icon: 'W', type: 'material', desc: 'Стволы, затворы и пригодные механизмы для сборки оружия.' },
    silver: { id: 'silver', weight: 0, name: 'Крышки', icon: '🪙', type: 'money', desc: 'Местная валюта.' },
    trophy: { id: 'trophy', weight: 0.5, name: 'Трофей', icon: '💎', type: 'loot', desc: 'Добыча с редкого противника.' },
    water: { id: 'water', weight: 1.0, name: 'Фляга воды', icon: '🍶', type: 'misc', desc: 'Чистая вода. Ценный предмет в пепельной зоне.' },
    pickaxe: { id: 'pickaxe', weight: 3.0, name: 'Кирка', icon: '⛏️', type: 'tool', equipSlot: 'weapon', hands: 2, weaponSkill: 'melee', damageType: 'ballistic', requiredStrength: 4, desc: 'Двуручный инструмент для добычи железной руды. В бою работает как тяжёлое оружие ближнего боя.', condition: 100, harvestTool: 'ore', dmg: [13, 21], range: 2.0, ammoType: null, magSize: 0, loaded: 0, fireRate: 0.68, apCost: 3 },
    axe: { id: 'axe', weight: 2.5, name: 'Топор', icon: '🪓', type: 'tool', equipSlot: 'weapon', hands: 2, weaponSkill: 'melee', damageType: 'ballistic', requiredStrength: 3, desc: 'Двуручный инструмент для заготовки древесины. В бою работает как оружие ближнего боя.', condition: 100, harvestTool: 'wood', dmg: [11, 19], range: 2.1, ammoType: null, magSize: 0, loaded: 0, fireRate: 0.62, apCost: 3 },
    handPump: { id: 'handPump', weight: 2.7, name: 'Ручной насос', icon: 'P', type: 'tool', equipSlot: 'weapon', hands: 2, weaponSkill: 'melee', damageType: 'ballistic', requiredStrength: 3, desc: 'Двуручный инструмент для откачки воды и нефти. В бою работает как короткое тяжёлое оружие ближнего боя.', condition: 100, harvestTool: 'liquid', dmg: [7, 12], range: 1.8, ammoType: null, magSize: 0, loaded: 0, fireRate: 0.72, apCost: 3 },
    repairKit: { id: 'repairKit', weight: 1.5, name: 'Ремкомплект', icon: '🧰', type: 'consumable', desc: 'Позволяет починить оружие, броню или инструмент.', repair: 40 }
  };

  const SLOT_LABELS = {
    weapon: 'Правая рука',
    offhand: 'Левая рука',
    armor: 'Корпус',
    helmet: 'Голова',
    boots: 'Ноги',
    backpack: 'Спина'
  };

  const CRAFT_RECIPES = [
    { id: 'ammo9craft', name: 'Самодельные патроны 9mm', icon: '▪', out: { id: 'ammo9', qty: 8 }, cost: { ore: 1, wood: 1 }, desc: 'Простые боеприпасы для пистолета.' },
    { id: 'ammo556craft', name: 'Патроны .223', icon: '▰', out: { id: 'ammo556', qty: 5 }, cost: { ore: 2, wood: 1 }, desc: 'Боеприпасы для винтовки.' },
    { id: 'energycellcraft', name: 'Энергозаряды', icon: '🔋', out: { id: 'energyCell', qty: 8 }, cost: { ore: 2, wood: 1 }, desc: 'Боеприпасы для энергетического оружия.' },
    { id: 'napalmcraft', name: 'Напалм', icon: '🔥', out: { id: 'napalm', qty: 12 }, cost: { oil: 2, scrap: 1, wood: 1 }, desc: 'Горючая смесь для огнемёта.' },
    { id: 'shellcraft', name: 'Патроны 12 калибра', icon: '◉', out: { id: 'shotgunShell', qty: 6 }, cost: { ore: 2, wood: 1 }, desc: 'Боеприпасы для дробовика.' },
    { id: 'rocketammocraft', name: 'Ракета', icon: '🚀', out: { id: 'rocketAmmo', qty: 2 }, cost: { ore: 5, wood: 1, oil: 1, silver: 4 }, desc: 'Боеприпасы для ракетницы.' },
    { id: 'stimcraft', name: 'Стимулятор', icon: '🧪', out: { id: 'stim', qty: 3 }, cost: { medicine: 2, chemicals: 1 }, desc: 'Быстрое средство первой помощи.' },
    { id: 'medkitcraft', name: 'Аптечка', icon: '💊', out: { id: 'medkit', qty: 2 }, cost: { medicine: 4, chemicals: 1, scrap: 1 }, desc: 'Комплект для восстановления здоровья.' },
    { id: 'doctorbagcraft', name: 'Набор доктора', icon: '🩺', out: { id: 'doctorBag', qty: 1 }, cost: { medicine: 5, electronics: 1, scrap: 2 }, desc: 'Медицинский набор для лечения тяжёлых травм.' },
    { id: 'antibioticscraft', name: 'Антибиотики', icon: '🧫', out: { id: 'antibiotics', qty: 2 }, cost: { medicine: 3, chemicals: 2 }, desc: 'Препарат для лечения инфекции.' },
    { id: 'repairkitcraft', name: 'Ремкомплект', icon: '🧰', out: { id: 'repairKit', qty: 1 }, cost: { ore: 2, wood: 2 }, desc: 'Набор для ремонта оружия и брони.' },
    { id: 'knifecraft', name: 'Боевой нож', icon: '🗡️', out: { id: 'knife', qty: 1 }, cost: { ore: 2, wood: 1 }, desc: 'Запасное оружие ближнего боя.' },
    { id: 'pistolcraft', name: '9mm пистолет', icon: '🔫', out: { id: 'pistol', qty: 1 }, cost: { weaponParts: 1, scrap: 4, ammoParts: 2 }, desc: 'Лёгкий одноручный пистолет.' },
    { id: 'revolvercraft', name: 'Ржавый револьвер', icon: '🔫', out: { id: 'revolver', qty: 1 }, cost: { ore: 4, scrap: 4, wood: 2 }, desc: 'Надёжный шестизарядный револьвер.' },
    { id: 'sawedoffcraft', name: 'Обрез', icon: '💥', out: { id: 'sawedOffShotgun', qty: 1 }, cost: { scrap: 5, wood: 3 }, desc: 'Компактное двуствольное оружие ближнего боя.' },
    { id: 'smgcraft', name: 'Самодельный ПП', icon: '🔫', out: { id: 'smg', qty: 1 }, cost: { scrap: 8, weaponParts: 3, wood: 2 }, desc: 'Автоматическое оружие под патрон 9mm.' },
    { id: 'riflecraft', name: 'Охотничья винтовка', icon: '🟫', out: { id: 'rifle', qty: 1 }, cost: { weaponParts: 2, scrap: 5, wood: 2 }, desc: 'Дальнобойная винтовка с продольно-скользящим затвором.' },
    { id: 'assaultcraft', name: 'Ржавый автомат', icon: '🔫', out: { id: 'assaultRifle', qty: 1 }, cost: { ore: 6, wood: 3 }, desc: 'Автоматическое оружие с одиночным, прицельным и автоматическим режимом.' },
    { id: 'machineguncraft', name: 'Самодельный пулемёт', icon: '🧨', out: { id: 'machineGun', qty: 1 }, cost: { ore: 10, wood: 4 }, desc: 'Тяжёлое автоматическое оружие для навыка Тяжёлое оружие.' },
    { id: 'lasercraft', name: 'Лазерный пистолет', icon: '🔴', out: { id: 'laserPistol', qty: 1 }, cost: { ore: 5, wood: 2 }, desc: 'Энергетическое оружие с риском перегрева/сбоя.' },
    { id: 'flamercraft', name: 'Огнемёт', icon: '🔥', out: { id: 'flamethrower', qty: 1 }, cost: { ore: 9, wood: 3, oil: 2 }, desc: 'Тяжёлое оружие с огненной струёй.' },
    { id: 'plasmacraft', name: 'Плазменное ружьё', icon: '🟢', out: { id: 'plasmaRifle', qty: 1 }, cost: { ore: 10, wood: 2, silver: 10 }, desc: 'Мощное энергетическое ружьё.' },
    { id: 'shotguncraft', name: 'Дробовик', icon: '💥', out: { id: 'shotgun', qty: 1 }, cost: { ore: 7, wood: 4 }, desc: 'Надёжное оружие ближней и средней дистанции.' },
    { id: 'rocketcrafter', name: 'Ракетница', icon: '🚀', out: { id: 'rocketLauncher', qty: 1 }, cost: { ore: 14, wood: 4, silver: 14 }, desc: 'Тяжёлое взрывное оружие с уроном по области.' },
    { id: 'leathercraft', name: 'Кожаная куртка', icon: '🧥', out: { id: 'leather', qty: 1 }, cost: { scrap: 5, chemicals: 1 }, desc: 'Лёгкая броня из кожи и подручных материалов.' },
    { id: 'metalarmorcraft', name: 'Металлическая броня', icon: '🦾', out: { id: 'metalArmor', qty: 1 }, cost: { scrap: 12, ore: 4 }, desc: 'Прочная броня из металлических пластин.' },
    { id: 'ballisticvestcraft', name: 'Бронежилет', icon: '🎽', out: { id: 'ballisticVest', qty: 1 }, cost: { scrap: 10, ammoParts: 5, chemicals: 2 }, desc: 'Бронежилет с усиленной баллистической защитой.' },
    { id: 'combatarmorcraft', name: 'Боевая броня', icon: '🛡️', out: { id: 'combatArmor', qty: 1 }, cost: { scrap: 18, electronics: 6, chemicals: 4 }, desc: 'Комплексная защита для тяжёлых боёв.' },
    { id: 'hazmatsuitcraft', name: 'Костюм химзащиты', icon: '☣️', out: { id: 'hazmatSuit', qty: 1 }, cost: { chemicals: 10, scrap: 6 }, desc: 'Защитный костюм от токсинов и радиации.' },
    { id: 'heavyarmorcraft', name: 'Тяжёлая броня', icon: '🪖', out: { id: 'heavyArmor', qty: 1 }, cost: { scrap: 26, ore: 10, electronics: 6 }, desc: 'Тяжёлый комплект с высокой общей защитой.' },
    { id: 'energysuitcraft', name: 'Энергозащитный костюм', icon: '🔷', out: { id: 'energySuit', qty: 1 }, cost: { electronics: 16, chemicals: 8, scrap: 10 }, desc: 'Специализированная защита от энергетического урона.' },
    { id: 'prewarhelmetcraft', name: 'Довоенный боевой шлем', icon: '🪖', out: { id: 'preWarHelmet', qty: 1 }, cost: { scrap: 6, electronics: 3 }, desc: 'Восстановленный армейский шлем старого мира.' },
    { id: 'weldedhelmetcraft', name: 'Сварной шлем', icon: '🪖', out: { id: 'weldedHelmet', qty: 1 }, cost: { scrap: 4 }, desc: 'Простой шлем из сваренных листов металла.' },
    { id: 'helmetcraft', name: 'Стальной шлем', icon: '⛑️', out: { id: 'helmet', qty: 1 }, cost: { scrap: 4 }, desc: 'Базовая защита головы.' },
    { id: 'tacticalhelmetcraft', name: 'Тактический шлем', icon: '🪖', out: { id: 'tacticalHelmet', qty: 1 }, cost: { scrap: 6, electronics: 2 }, desc: 'Усиленный шлем с закрытым визором.' },
    { id: 'assaulthelmetcraft', name: 'Штурмовой шлем', icon: '🤖', out: { id: 'assaultHelmet', qty: 1 }, cost: { scrap: 8, electronics: 3 }, desc: 'Тяжёлый шлем с усиленной лицевой защитой.' },
    { id: 'bootscraft', name: 'Армейские ботинки', icon: '🥾', out: { id: 'boots', qty: 1 }, cost: { scrap: 3, chemicals: 1 }, desc: 'Надёжные ботинки для пустоши.' },
    { id: 'scoutbootscraft', name: 'Разведботинки', icon: '👢', out: { id: 'scoutBoots', qty: 1 }, cost: { scrap: 4, chemicals: 2 }, desc: 'Лёгкие ботинки для быстрого передвижения.' },
    { id: 'assaultbootscraft', name: 'Штурмовые ботинки', icon: '🥾', out: { id: 'assaultBoots', qty: 1 }, cost: { scrap: 5, wood: 1 }, desc: 'Защитные ботинки с композитными накладками.' },
    { id: 'reinforcedbootscraft', name: 'Усиленные ботинки', icon: '🥾', out: { id: 'reinforcedBoots', qty: 1 }, cost: { scrap: 6, ore: 2 }, desc: 'Тяжёлая обувь с защитными накладками.' },
    { id: 'backpackcraft', name: 'Рюкзак', icon: '🎒', out: { id: 'backpack', qty: 1 }, cost: { scrap: 5, chemicals: 1 }, desc: 'Рюкзак, увеличивающий переносимый вес.' },
    { id: 'pickaxecraft', name: 'Кирка', icon: '⛏️', out: { id: 'pickaxe', qty: 1 }, cost: { ore: 2, wood: 2 }, desc: 'Инструмент для добычи руды.' },
    { id: 'axecraft', name: 'Топор', icon: '🪓', out: { id: 'axe', qty: 1 }, cost: { ore: 1, wood: 3 }, desc: 'Инструмент для заготовки древесины.' },
    { id: 'handpumpcraft', name: 'Ручной насос', icon: 'P', out: { id: 'handPump', qty: 1 }, cost: { ore: 3, wood: 1, scrap: 2 }, desc: 'Инструмент для откачки воды и нефти.' },
    { id: 'weaponpartscraft', name: 'Оружейные детали', icon: '⚙️', out: { id: 'weaponParts', qty: 2 }, cost: { ore: 6, scrap: 5 }, desc: 'Пружины, штифты и заготовки стволов. Нужны почти для любой модификации оружия.' },
    { id: 'electronicscraft', name: 'Электроника', icon: '📟', out: { id: 'electronics', qty: 2 }, cost: { scrap: 3, chemicals: 1 }, desc: 'Платы и датчики. Нужны для прицелов и энергетических модификаций.' }
  ];

  const CRAFT_STATION_DEFS = {
    ammo_bench: { label: 'Патронный станок', modelKey: 'craftStationAmmo', modelFile: 'craft_station_ammo.glb', tokens: ['ammo_bench', 'ammo', 'munition'] },
    weapon_bench: { label: 'Оружейный верстак', modelKey: 'craftStationWeapon', modelFile: 'craft_station_weapon.glb', tokens: ['weapon_bench', 'weapon', 'armory'] },
    tool_bench: { label: 'Инструментальный верстак', modelKey: 'craftStationTools', modelFile: 'craft_station_tools.glb', tokens: ['tool_bench', 'tool'] },
    repair_bench: { label: 'Ремонтный верстак', modelKey: 'craftStationRepair', modelFile: 'craft_station_repair.glb', tokens: ['repair_bench', 'repair'] },
    energy_bench: { label: 'Энергетический стенд', modelKey: 'craftStationEnergy', modelFile: 'craft_station_energy.glb', tokens: ['energy_bench', 'energy', 'relay', 'electronics'] },
    chem_station: { label: 'Химический стол', modelKey: 'craftStationChem', modelFile: 'craft_station_chem.glb', tokens: ['chem_station', 'chem', 'lab', 'medicine'] }
  };

  const CRAFT_RECIPE_STATIONS = {
    ammo9craft: 'ammo_bench',
    ammo556craft: 'ammo_bench',
    shellcraft: 'ammo_bench',
    rocketammocraft: 'ammo_bench',
    napalmcraft: 'chem_station',
    stimcraft: 'chem_station',
    medkitcraft: 'chem_station',
    doctorbagcraft: 'chem_station',
    antibioticscraft: 'chem_station',
    repairkitcraft: 'repair_bench',
    knifecraft: 'weapon_bench',
    pistolcraft: 'weapon_bench',
    revolvercraft: 'weapon_bench',
    sawedoffcraft: 'weapon_bench',
    smgcraft: 'weapon_bench',
    riflecraft: 'weapon_bench',
    assaultcraft: 'weapon_bench',
    machineguncraft: 'weapon_bench',
    lasercraft: 'energy_bench',
    flamercraft: 'weapon_bench',
    plasmacraft: 'energy_bench',
    shotguncraft: 'weapon_bench',
    rocketcrafter: 'weapon_bench',
    energycellcraft: 'energy_bench',
    leathercraft: 'repair_bench',
    metalarmorcraft: 'repair_bench',
    ballisticvestcraft: 'repair_bench',
    combatarmorcraft: 'repair_bench',
    hazmatsuitcraft: 'chem_station',
    heavyarmorcraft: 'repair_bench',
    energysuitcraft: 'energy_bench',
    prewarhelmetcraft: 'energy_bench',
    weldedhelmetcraft: 'tool_bench',
    helmetcraft: 'repair_bench',
    tacticalhelmetcraft: 'repair_bench',
    assaulthelmetcraft: 'repair_bench',
    bootscraft: 'tool_bench',
    scoutbootscraft: 'tool_bench',
    assaultbootscraft: 'tool_bench',
    reinforcedbootscraft: 'repair_bench',
    backpackcraft: 'tool_bench',
    pickaxecraft: 'tool_bench',
    axecraft: 'tool_bench',
    handpumpcraft: 'tool_bench',
    weaponpartscraft: 'weapon_bench',
    electronicscraft: 'energy_bench'
  };

  CRAFT_RECIPES.forEach(recipe => {
    recipe.station = CRAFT_RECIPE_STATIONS[recipe.id] || 'tool_bench';
  });

  const inventory = new Map();
  const pendingCraftRecipes = new Set();
  const storageInventory = new Map();
  const DEFAULT_SPECIAL = { str: 5, per: 5, end: 5, cha: 5, int: 5, agi: 5, luck: 5 };
  const SPECIAL_STAT_DEFS_FALLBACK = [
    { key: 'str', code: 'ST', name: 'Сила', desc: 'Переносимый вес, требования оружия и ближний урон.' },
    { key: 'per', code: 'PE', name: 'Восприятие', desc: 'Обзор, меткость и часть технических проверок.' },
    { key: 'end', code: 'EN', name: 'Выносливость', desc: 'Максимум HP, сопротивление и выживание.' },
    { key: 'cha', code: 'CH', name: 'Харизма', desc: 'Речь, торговля и награды заданий.' },
    { key: 'int', code: 'IN', name: 'Интеллект', desc: 'Терминалы, медицина, ремонт и наука.' },
    { key: 'agi', code: 'AG', name: 'Ловкость', desc: 'Очки действия, скорость, скрытность и взлом.' },
    { key: 'luck', code: 'LK', name: 'Удача', desc: 'Шанс критического выстрела (Удача%), проверки удачи, травмы, добыча и второй шанс.' }
  ];

  function specialStatDefs() {
    try {
      if (Array.isArray(STAT_DEFS)) return STAT_DEFS;
    } catch (_) {}
    return SPECIAL_STAT_DEFS_FALLBACK;
  }
  const equipment = {
    weapon: 'pistol',
    offhand: null,
    armor: 'leather',
    helmet: 'helmet',
    boots: 'boots',
    backpack: 'backpack'
  };

  function formatWeight(v) {
    return (Math.round(v * 10) / 10).toFixed(1).replace('.0', '');
  }

  function itemWeight(id) {
    const item = ITEMS[id];
    return item && typeof item.weight === 'number' ? item.weight : 0;
  }

  function itemEquipSlot(itemOrId) {
    const item = typeof itemOrId === 'string' ? ITEMS[itemOrId] : itemOrId;
    if (!item) return '';
    return item.slot || item.equipSlot || '';
  }

  const HAND_EQUIPMENT_SLOTS = ['weapon', 'offhand'];

  function itemHands(itemOrId) {
    const item = typeof itemOrId === 'string' ? ITEMS[itemOrId] : itemOrId;
    return Number(item?.hands) === 2 ? 2 : 1;
  }

  function isHandEquipmentSlot(slot = '') {
    return HAND_EQUIPMENT_SLOTS.includes(String(slot || ''));
  }

  function itemFitsEquipmentSlot(itemOrId, slot = '') {
    const item = typeof itemOrId === 'string' ? ITEMS[itemOrId] : itemOrId;
    if (!item) return false;
    const preferred = itemEquipSlot(item);
    return isHandEquipmentSlot(slot) ? preferred === 'weapon' : preferred === slot;
  }

  function primaryTwoHandedItem() {
    const item = ITEMS[equipment.weapon];
    return item && itemHands(item) === 2 ? item : null;
  }

  function equipmentItemForSlot(slot = '') {
    if (slot === 'offhand') return ITEMS[equipment.offhand] || primaryTwoHandedItem();
    return ITEMS[equipment[slot]] || null;
  }

  function equipmentSlotIsTwoHandedOccupancy(slot = '') {
    return slot === 'offhand' && !equipment.offhand && Boolean(primaryTwoHandedItem());
  }

  function activeWeaponEquipmentSlot() {
    const primary = ITEMS[equipment.weapon];
    if (primary && primary.id !== 'fists' && (primary.type === 'weapon' || Array.isArray(primary.dmg))) return 'weapon';
    const secondary = ITEMS[equipment.offhand];
    if (secondary && secondary.id !== 'fists' && (secondary.type === 'weapon' || Array.isArray(secondary.dmg))) return 'offhand';
    return 'weapon';
  }

  function currentHeldItem() {
    const primaryId = equipment.weapon;
    const id = primaryId && primaryId !== 'fists' ? primaryId : (equipment.offhand || primaryId);
    const item = id ? ITEMS[id] : null;
    return item ? { id, item } : null;
  }

  let uniqueItemCounter = 0;

  function parseRuntimeItemBaseId(id) {
    const m = String(id || '').match(/^ui_([a-zA-Z0-9]+)_[a-z0-9]+_[a-z0-9]+$/);
    return m ? m[1] : null;
  }

  function baseItemId(id) {
    const item = ITEMS[id];
    if (item && item.baseId) return item.baseId;
    return parseRuntimeItemBaseId(id) || id;
  }

  function itemArtSvg(body) {
    return `<svg class="item-art-svg" viewBox="0 0 64 64" focusable="false" aria-hidden="true"><rect class="item-art-bg" x="3" y="3" width="58" height="58" rx="8"></rect><path class="item-art-sheen" d="M9 12c8-5 34-7 47 2v18c-13-6-34-5-47 1z"></path>${body}</svg>`;
  }

  const ITEM_ART_DEFS = {
    pistol: itemArtSvg(`<path d="M11 28h34l6-4h7v8l-10 2-7 5 3 12H33l-5-14H14z" fill="#383834" stroke="#070605" stroke-width="2"/><path d="M16 25h30" stroke="#c4a76a" stroke-width="3" stroke-linecap="round"/><path d="M32 35h8" stroke="#0b0a08" stroke-width="3"/><circle cx="50" cy="28" r="2" fill="#e2bc61"/>`),
    rifle: itemArtSvg(`<path d="M6 34c6-8 14-11 25-10h24l5 3-5 4H32c-7 0-13 4-18 10H7z" fill="#6f4422" stroke="#070605" stroke-width="2"/><path d="M25 26h30" stroke="#7f7a68" stroke-width="5" stroke-linecap="round"/><path d="M50 23h9" stroke="#c9b074" stroke-width="2"/><path d="M33 34l4 13h-9l-2-12z" fill="#2a2924" stroke="#070605" stroke-width="2"/>`),
    assaultRifle: itemArtSvg(`<path d="M7 35l11-9h34l7 4-5 5H23L12 42z" fill="#5a3a20" stroke="#070605" stroke-width="2"/><path d="M20 25h32" stroke="#8d8877" stroke-width="5" stroke-linecap="round"/><path d="M37 36l4 17h-9l-4-17z" fill="#22221f" stroke="#070605" stroke-width="2"/><path d="M50 24h10" stroke="#e1bd66" stroke-width="2"/><circle cx="26" cy="31" r="3" fill="#c56c2e"/>`),
    machineGun: itemArtSvg(`<path d="M6 33l10-7h34l8 5-5 6H19L11 43z" fill="#34332d" stroke="#070605" stroke-width="2"/><path d="M18 25h39" stroke="#9d9279" stroke-width="6" stroke-linecap="round"/><circle cx="30" cy="39" r="9" fill="#22221f" stroke="#c7a45d" stroke-width="2"/><path d="M42 37l4 16h-9l-3-15z" fill="#1a1917" stroke="#070605" stroke-width="2"/><path d="M55 24h6" stroke="#e1bd66" stroke-width="2"/>`),
    laserPistol: itemArtSvg(`<path d="M11 29h31l7-5h7v9l-9 2-6 5 2 10H32l-5-14H14z" fill="#273b39" stroke="#06100f" stroke-width="2"/><path d="M17 25h29" stroke="#8ccbc4" stroke-width="3" stroke-linecap="round"/><circle cx="51" cy="28" r="4" fill="#ff584e" stroke="#ffd1a8" stroke-width="1"/><path d="M24 36h12" stroke="#68f0e7" stroke-width="2"/>`),
    flamethrower: itemArtSvg(`<path d="M9 35l10-8h26l7 4-5 6H20l-8 7z" fill="#5a3518" stroke="#070605" stroke-width="2"/><path d="M19 26h29" stroke="#b07b3d" stroke-width="6" stroke-linecap="round"/><path d="M49 25h9" stroke="#d9b06a" stroke-width="3"/><path d="M55 21c5 4 4 9-1 12 1-4-4-6-1-11z" fill="#ff7a2f"/><circle cx="30" cy="39" r="8" fill="#3f3a31" stroke="#d09652" stroke-width="2"/>`),
    plasmaRifle: itemArtSvg(`<path d="M7 34l12-9h32l7 5-6 6H22l-10 8z" fill="#24362a" stroke="#06100a" stroke-width="2"/><path d="M20 25h32" stroke="#73b67b" stroke-width="6" stroke-linecap="round"/><circle cx="39" cy="31" r="7" fill="#65ff87" opacity="0.75"/><path d="M34 36l3 14h-9l-3-14z" fill="#1c241d" stroke="#06100a" stroke-width="2"/><path d="M51 25h9" stroke="#b6ffc0" stroke-width="2"/>`),
    shotgun: itemArtSvg(`<path d="M6 36c7-8 15-11 26-10h22l5 4-5 4H32c-8 0-14 4-20 11H6z" fill="#734522" stroke="#070605" stroke-width="2"/><path d="M24 24h31" stroke="#8d8570" stroke-width="4" stroke-linecap="round"/><path d="M24 30h31" stroke="#c8b071" stroke-width="4" stroke-linecap="round"/><path d="M34 36l3 13h-8l-3-13z" fill="#27241f" stroke="#070605" stroke-width="2"/>`),
    rocketLauncher: itemArtSvg(`<path d="M9 25h38l11 7-11 7H9z" fill="#6b6759" stroke="#070605" stroke-width="2"/><path d="M8 30h44" stroke="#c5ae73" stroke-width="4"/><path d="M49 24l10 8-10 8z" fill="#b34b32" stroke="#070605" stroke-width="2"/><path d="M28 38l5 13h-9l-4-13z" fill="#34322b" stroke="#070605" stroke-width="2"/>`),
    knife: itemArtSvg(`<path d="M11 39h16" stroke="#6d3e1d" stroke-width="8" stroke-linecap="round"/><path d="M24 38l28-21 6 4-22 27z" fill="#c9c0a6" stroke="#080706" stroke-width="2"/><path d="M30 35l20-14" stroke="#f0dfad" stroke-width="2"/><circle cx="16" cy="39" r="3" fill="#d8b364"/>`),
    fists: itemArtSvg(`<path d="M15 30c0-8 7-13 16-9 5-5 16 0 15 9l-1 12c-1 7-7 11-15 10S16 48 15 41z" fill="#8a6040" stroke="#070605" stroke-width="2"/><path d="M20 30h25" stroke="#3b2417" stroke-width="3"/><path d="M24 22v13M32 21v14M40 24v12" stroke="#bf9164" stroke-width="2"/>`),
    leather: itemArtSvg(`<path d="M20 14l10 6 10-6 12 9-6 31H18l-6-31z" fill="#6b4428" stroke="#070605" stroke-width="2"/><path d="M30 20v34M18 30h28" stroke="#b37b4e" stroke-width="2"/><path d="M22 18l8 8 8-8" fill="none" stroke="#d0a06a" stroke-width="2"/>`),
    metalArmor: itemArtSvg(`<path d="M19 13l13 6 13-6 9 11-7 29H17l-7-29z" fill="#60625a" stroke="#070605" stroke-width="2"/><path d="M20 29h24M22 39h20M32 19v33" stroke="#b8ae88" stroke-width="2"/><circle cx="32" cy="30" r="5" fill="#34342e"/>`),
    ballisticVest: itemArtSvg(`<path d="M19 13l13 6 13-6 8 10-6 31H17l-6-31z" fill="#2f3430" stroke="#070605" stroke-width="2"/><path d="M20 26h24v20H20z" fill="#4c4e41" stroke="#c4a866" stroke-width="2"/><path d="M24 32h16M24 39h16" stroke="#171713" stroke-width="3"/>`),
    combatArmor: itemArtSvg(`<path d="M18 12l14 7 14-7 10 12-8 30H16L8 24z" fill="#38443d" stroke="#070605" stroke-width="2"/><path d="M18 28h28M22 40h20M32 20v32" stroke="#9fc07d" stroke-width="2"/><path d="M23 22l9 7 9-7" fill="none" stroke="#d8c27a" stroke-width="2"/>`),
    hazmatSuit: itemArtSvg(`<path d="M21 13l11 7 11-7 9 10-5 31H17l-5-31z" fill="#b78d28" stroke="#070605" stroke-width="2"/><circle cx="32" cy="29" r="8" fill="#20241f" stroke="#f3df78" stroke-width="2"/><path d="M22 42h20M32 37v15" stroke="#4b3511" stroke-width="3"/><path d="M31 27l-5-3m6 4l6-2m-5 2v7" stroke="#b8ff75" stroke-width="2"/>`),
    heavyArmor: itemArtSvg(`<path d="M16 12l16 6 16-6 11 13-9 29H14L5 25z" fill="#4f554f" stroke="#070605" stroke-width="2"/><path d="M17 29h30M20 41h24M32 18v35" stroke="#c6b16d" stroke-width="3"/><path d="M11 24l7 8m35-8l-7 8" stroke="#838b78" stroke-width="4"/>`),
    energySuit: itemArtSvg(`<path d="M19 13l13 7 13-7 9 10-6 31H16l-6-31z" fill="#243c43" stroke="#061012" stroke-width="2"/><path d="M32 18v34M19 35h26" stroke="#7ee7ff" stroke-width="2"/><path d="M35 25l-9 13h8l-5 12 11-17h-8z" fill="#78d7ff"/>`),
    helmet: itemArtSvg(`<path d="M14 36c1-14 9-22 19-22s17 8 18 22l-4 12H18z" fill="#6d7067" stroke="#070605" stroke-width="2"/><path d="M18 36h29" stroke="#c7b078" stroke-width="3"/><path d="M24 43h17" stroke="#1b1a17" stroke-width="5"/><path d="M33 15v21" stroke="#9d936f" stroke-width="2"/>`),
    tacticalHelmet: itemArtSvg(`<path d="M13 35c1-13 9-21 20-21s18 8 19 21l-4 13H18z" fill="#3d4943" stroke="#070605" stroke-width="2"/><path d="M18 34h31" stroke="#9fc07d" stroke-width="3"/><path d="M23 40h20" stroke="#080a09" stroke-width="6"/><rect x="36" y="25" width="13" height="7" rx="2" fill="#8fd4c5" stroke="#07110f" stroke-width="1"/>`),
    assaultHelmet: itemArtSvg(`<path d="M11 35c2-15 10-23 22-23s20 8 21 23l-5 15H17z" fill="#4d5350" stroke="#070605" stroke-width="2"/><path d="M18 34h32" stroke="#d2b66d" stroke-width="3"/><path d="M22 41h23" stroke="#070605" stroke-width="7"/><path d="M45 32l8 7-7 6" fill="#2c312f" stroke="#070605" stroke-width="2"/>`),
    boots: itemArtSvg(`<path d="M17 17h14v24l-5 7H11l2-10 4-3z" fill="#49301f" stroke="#070605" stroke-width="2"/><path d="M35 19h13v22l6 6H35l-3-9z" fill="#5a3822" stroke="#070605" stroke-width="2"/><path d="M12 48h43" stroke="#c09b5c" stroke-width="3"/>`),
    scoutBoots: itemArtSvg(`<path d="M18 17h13v22l-6 8H10l2-9 5-3z" fill="#5f4425" stroke="#070605" stroke-width="2"/><path d="M36 18h12v22l7 7H36l-3-9z" fill="#72512b" stroke="#070605" stroke-width="2"/><path d="M20 28h9M38 28h8" stroke="#d0b06b" stroke-width="2"/>`),
    reinforcedBoots: itemArtSvg(`<path d="M16 17h15v23l-5 8H10l2-11 4-3z" fill="#3b3128" stroke="#070605" stroke-width="2"/><path d="M35 18h14v22l6 8H35l-3-10z" fill="#44362b" stroke="#070605" stroke-width="2"/><path d="M13 47h42M18 33h11M37 33h11" stroke="#bba567" stroke-width="3"/>`),
    backpack: itemArtSvg(`<path d="M19 18c2-7 24-7 26 0l5 34H14z" fill="#55402a" stroke="#070605" stroke-width="2"/><path d="M22 21c3-5 17-5 20 0M19 34h26M24 42h16" stroke="#c2a067" stroke-width="2"/><path d="M13 25c-7 7-7 15 0 21m38-21c7 7 7 15 0 21" fill="none" stroke="#2a2017" stroke-width="4"/>`),
    ammo9: itemArtSvg(`<path d="M18 42h8V22l-4-7-4 7z" fill="#cfa95f" stroke="#070605" stroke-width="2"/><path d="M30 42h8V22l-4-7-4 7z" fill="#d6b66e" stroke="#070605" stroke-width="2"/><path d="M42 42h8V22l-4-7-4 7z" fill="#b48745" stroke="#070605" stroke-width="2"/><path d="M16 43h36" stroke="#6d4c24" stroke-width="3"/>`),
    ammo556: itemArtSvg(`<path d="M14 44h7V19l-3-7-4 7z" fill="#cfa95f" stroke="#070605" stroke-width="2"/><path d="M25 44h7V19l-3-7-4 7z" fill="#d7ba73" stroke="#070605" stroke-width="2"/><path d="M36 44h7V19l-3-7-4 7z" fill="#cfa95f" stroke="#070605" stroke-width="2"/><path d="M47 44h7V19l-3-7-4 7z" fill="#b58745" stroke="#070605" stroke-width="2"/>`),
    energyCell: itemArtSvg(`<rect x="21" y="13" width="22" height="39" rx="4" fill="#26383a" stroke="#061012" stroke-width="2"/><rect x="25" y="18" width="14" height="26" rx="2" fill="#6ef0d7" opacity="0.85"/><path d="M29 24h7l-5 9h6l-9 12 3-10h-6z" fill="#f9ff96"/><path d="M24 12h16M24 53h16" stroke="#b9e7db" stroke-width="3"/>`),
    napalm: itemArtSvg(`<path d="M22 16h20l4 8v24c0 4-4 7-14 7s-14-3-14-7V24z" fill="#4d2d18" stroke="#070605" stroke-width="2"/><path d="M22 16h20l2 6H20z" fill="#b66a2e" stroke="#070605" stroke-width="2"/><path d="M23 31h18v15H23z" fill="#16120d" opacity="0.55"/><path d="M31 44c-7-5-2-11 1-16 0 5 6 6 4 12 3-2 4-5 4-8 5 7 1 15-8 16z" fill="#ff8b32"/><path d="M32 46c-3-3-1-6 2-9 0 4 3 5 1 8z" fill="#ffe06d"/>`),
    shotgunShell: itemArtSvg(`<path d="M18 18h10v28l-5 5-5-5z" fill="#a4322c" stroke="#070605" stroke-width="2"/><path d="M36 18h10v28l-5 5-5-5z" fill="#bd3d35" stroke="#070605" stroke-width="2"/><path d="M18 18h10M36 18h10M18 42h10M36 42h10" stroke="#d6b66e" stroke-width="3"/>`),
    rocketAmmo: itemArtSvg(`<path d="M16 36h28l10 6-10 6H16z" fill="#646158" stroke="#070605" stroke-width="2"/><path d="M44 36l10 6-10 6z" fill="#b54831" stroke="#070605" stroke-width="2"/><path d="M18 31l7 5m-7 17l7-5" stroke="#c7a45d" stroke-width="3"/><path d="M25 39h18" stroke="#d8c27a" stroke-width="3"/>`),
    medkit: itemArtSvg(`<rect x="13" y="21" width="38" height="29" rx="4" fill="#8f2e2d" stroke="#070605" stroke-width="2"/><path d="M24 21v-6h16v6" fill="none" stroke="#d9c18b" stroke-width="3"/><path d="M32 27v17M23 35h18" stroke="#ffe5b2" stroke-width="6" stroke-linecap="round"/><path d="M16 25h32" stroke="#c77d58" stroke-width="2"/>`),
    stim: itemArtSvg(`<path d="M17 43l23-23 7 7-23 23z" fill="#87d9d8" stroke="#070605" stroke-width="2"/><path d="M38 18l6-6 8 8-6 6z" fill="#cfd8cf" stroke="#070605" stroke-width="2"/><path d="M23 38l11-11" stroke="#ff6e59" stroke-width="4"/><path d="M14 46l6 6" stroke="#d9c18b" stroke-width="4"/>`),
    doctorBag: itemArtSvg(`<rect x="13" y="20" width="38" height="30" rx="6" fill="#27343d" stroke="#070605" stroke-width="2"/><path d="M24 20v-6h16v6" fill="none" stroke="#b9d2d8" stroke-width="3"/><path d="M24 35h16M32 27v16" stroke="#8fe7ff" stroke-width="5" stroke-linecap="round"/><circle cx="47" cy="47" r="5" fill="#d6b66e" stroke="#070605" stroke-width="2"/>`),
    antibiotics: itemArtSvg(`<rect x="18" y="13" width="28" height="39" rx="7" fill="#d7dfeb" stroke="#070605" stroke-width="2"/><path d="M18 27h28" stroke="#7fb7ff" stroke-width="5"/><circle cx="32" cy="39" r="8" fill="#34c36d" stroke="#070605" stroke-width="2"/><path d="M28 39h8M32 35v8" stroke="#eefbe8" stroke-width="3"/>`),
    ore: itemArtSvg(`<path d="M13 42l8-20 19-9 13 17-6 19H22z" fill="#5f5b50" stroke="#070605" stroke-width="2"/><path d="M22 31l13-12 9 12-7 10H25z" fill="#8b8472"/><path d="M28 24l4 14m8-7l-18 2" stroke="#cbb06d" stroke-width="2"/>`),
    wood: itemArtSvg(`<path d="M15 42c9-13 21-20 35-25l4 8c-13 6-23 13-31 25z" fill="#71451f" stroke="#070605" stroke-width="2"/><path d="M10 34c9-9 20-15 33-19l3 7c-12 5-22 10-30 18z" fill="#87552a" stroke="#070605" stroke-width="2"/><path d="M21 39c9-8 17-13 29-17" stroke="#d0a06a" stroke-width="2"/>`),
    scrap: itemArtSvg(`<path d="M13 40l8-17 14 4 10-11 8 7-8 11 8 7-7 9-14-5-11 8z" fill="#6f6b60" stroke="#070605" stroke-width="2"/><path d="M20 32h21M29 22l12 25M18 45l22-19" stroke="#c9b36b" stroke-width="2"/><circle cx="45" cy="24" r="4" fill="#2b2b28" stroke="#d7c47c" stroke-width="2"/>`),
    oil: itemArtSvg(`<path d="M21 16h22l4 8-4 6 5 21H16l5-21-4-6z" fill="#5b3b1e" stroke="#070605" stroke-width="2"/><path d="M21 36h26l2 15H15z" fill="#18130e"/><path d="M22 16h20M22 29h20" stroke="#c9a05a" stroke-width="3"/><path d="M34 27c7 8 9 14 0 19-9-5-7-11 0-19z" fill="#0b0806" stroke="#b98d45" stroke-width="2"/>`),
    silver: itemArtSvg(`<circle cx="25" cy="34" r="14" fill="#c5a75d" stroke="#070605" stroke-width="2"/><circle cx="39" cy="31" r="14" fill="#e0c878" stroke="#070605" stroke-width="2"/><path d="M33 24c8 3 8 11 0 14" fill="none" stroke="#80602b" stroke-width="2"/><path d="M20 34h10m5-3h9" stroke="#fff0a6" stroke-width="2"/>`),
    trophy: itemArtSvg(`<path d="M32 12l7 14 15 2-11 11 3 15-14-7-14 7 3-15-11-11 15-2z" fill="#64cbd4" stroke="#070605" stroke-width="2"/><path d="M32 18l4 10 10 1-7 8 1 10-8-5-8 5 1-10-7-8 10-1z" fill="#9df4ff" opacity="0.65"/>`),
    water: itemArtSvg(`<path d="M24 14h17l2 8-3 4 5 23H20l5-23-3-4z" fill="#d5ded7" stroke="#070605" stroke-width="2"/><path d="M24 34h17l2 13H21z" fill="#5ec5ff" opacity="0.8"/><path d="M25 14h15M26 25h13" stroke="#8aa4a3" stroke-width="3"/><circle cx="34" cy="39" r="4" fill="#c8f0ff"/>`),
    pickaxe: itemArtSvg(`<path d="M19 15c12-7 27-6 38 2l-3 7c-11-5-22-5-33 1z" fill="#8b8170" stroke="#070605" stroke-width="2"/><path d="M30 24l9 30" stroke="#6a3f20" stroke-width="7" stroke-linecap="round"/><path d="M29 25l7-2" stroke="#d2b66d" stroke-width="3"/><path d="M12 24c7-5 13-7 21-7" stroke="#c7b078" stroke-width="3"/>`),
    axe: itemArtSvg(`<path d="M28 13l8 3-14 38-8-3z" fill="#724522" stroke="#070605" stroke-width="2"/><path d="M31 14c12 0 20 7 23 18-9 4-17 2-26-8z" fill="#8c8a7e" stroke="#070605" stroke-width="2"/><path d="M35 21c6 1 10 4 13 8" stroke="#ded1a2" stroke-width="2"/><path d="M19 49l9 3" stroke="#d2a15c" stroke-width="3"/>`),
    handPump: itemArtSvg(`<path d="M17 41h31v8H17z" fill="#4b463c" stroke="#070605" stroke-width="2"/><path d="M28 18v23M42 22v19" stroke="#7a7162" stroke-width="6" stroke-linecap="round"/><path d="M18 23h35l-5 8H23z" fill="#8b8170" stroke="#070605" stroke-width="2"/><path d="M43 31l9 7-7 7" fill="none" stroke="#caa35e" stroke-width="5" stroke-linecap="round"/><path d="M29 18l-5-7h12l-5 7z" fill="#b78b46" stroke="#070605" stroke-width="2"/>`),
    repairKit: itemArtSvg(`<rect x="14" y="20" width="36" height="29" rx="4" fill="#5d4630" stroke="#070605" stroke-width="2"/><path d="M22 20v-6h20v6" fill="none" stroke="#c59f5d" stroke-width="3"/><path d="M23 40l18-18" stroke="#dfe1d0" stroke-width="5" stroke-linecap="round"/><path d="M38 22l6 6m-24 9l6 6" stroke="#070605" stroke-width="2"/><circle cx="44" cy="43" r="4" fill="#d9b36d"/>`),
    misc: itemArtSvg(`<path d="M17 18h30l7 10-22 25L10 28z" fill="#7b6d4a" stroke="#070605" stroke-width="2"/><path d="M19 28h28M24 20l8 33m8-33l-8 33" stroke="#d9c37a" stroke-width="2"/>`)
  };

  function itemArtEscape(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function itemArtKey(itemOrId) {
    const id = typeof itemOrId === 'string' ? itemOrId : (itemOrId?.id || itemOrId?.baseId || '');
    const item = typeof itemOrId === 'string' ? ITEMS[id] : itemOrId;
    return item?.baseId || baseItemId(id || item?.id || '') || item?.type || 'misc';
  }

  function itemArtHtml(itemOrId, options = {}) {
    const key = itemArtKey(itemOrId);
    const id = typeof itemOrId === 'string' ? itemOrId : (itemOrId?.id || key);
    const item = typeof itemOrId === 'string' ? (ITEMS[id] || ITEMS[key]) : (itemOrId || ITEMS[key]);
    const art = ITEM_ART_DEFS[key] || ITEM_ART_DEFS[item?.type] || ITEM_ART_DEFS.misc;
    const classKey = String(key || 'misc').replace(/[^a-zA-Z0-9_-]/g, '');
    const extraClass = String(options.className || '').replace(/[^a-zA-Z0-9_ -]/g, '').trim();
    const label = item?.name || ITEMS[key]?.name || 'Item';
    const classes = ['item-art', `item-art-${classKey}`, extraClass].filter(Boolean).join(' ');
    return `<span class="${classes}" role="img" aria-label="${itemArtEscape(label)}">${art}</span>`;
  }

  function isRuntimeItemId(id) {
    const item = ITEMS[id];
    return Boolean(item && item.runtimeInstance) || Boolean(parseRuntimeItemBaseId(id));
  }

  function isUniqueEquipmentItem(id) {
    const item = ITEMS[id];
    if (!item || id === 'fists') return false;
    return Boolean(item.slot || item.type === 'weapon' || item.type === 'tool' || typeof item.condition === 'number');
  }

  function registerRuntimeItem(id, baseId, source = {}) {
    const base = ITEMS[baseId];
    if (!id || !base) return null;
    const row = { ...base, ...source, id, baseId, runtimeInstance: true };
    if (base.type === 'weapon' && base.ammoType) {
      row.weaponMods = source.weaponMods && typeof source.weaponMods === 'object'
        ? { ...source.weaponMods }
        : {};
    }
    if (isUniqueEquipmentItem(baseId) && typeof row.condition !== 'number') row.condition = 100;
    ITEMS[id] = row;
    if (typeof weaponModificationStatsReady !== 'undefined' && weaponModificationStatsReady && typeof applyWeaponModificationStats === 'function') applyWeaponModificationStats(row);
    return id;
  }

  function makeRuntimeItemId(baseId) {
    uniqueItemCounter += 1;
    return `ui_${baseId}_${Date.now().toString(36)}_${uniqueItemCounter.toString(36)}`;
  }

  function createRuntimeItemInstance(sourceId, source = null) {
    const baseId = baseItemId(sourceId);
    const src = source || ITEMS[sourceId] || ITEMS[baseId];
    const id = makeRuntimeItemId(baseId);
    return registerRuntimeItem(id, baseId, src);
  }

  function ensureSavedRuntimeItem(id, row = {}) {
    if (ITEMS[id]) return true;
    const parsedBase = row.baseId || parseRuntimeItemBaseId(id);
    if (!parsedBase || !ITEMS[parsedBase]) return false;
    registerRuntimeItem(id, parsedBase, row);
    return true;
  }

  function registerSavedRuntimeItems(rows = {}) {
    Object.entries(rows || {}).forEach(([id, row]) => ensureSavedRuntimeItem(id, row || {}));
  }

  function mapBaseQty(mapObj, wantedBaseId) {
    let total = 0;
    mapObj.forEach((qty, id) => {
      if (baseItemId(id) === wantedBaseId) total += Math.max(0, Number(qty || 0));
    });
    return total;
  }

  function findFirstItemInstanceInMap(mapObj, wantedBaseId, slot = null, excludedIds = null) {
    for (const [id, qty] of mapObj.entries()) {
      if (qty <= 0 || baseItemId(id) !== wantedBaseId) continue;
      if (excludedIds?.has?.(id)) continue;
      const item = ITEMS[id];
      if (slot && itemEquipSlot(item) !== slot) continue;
      return id;
    }
    return null;
  }

  function normalizeUniqueItemMap(mapObj) {
    if (!mapObj || typeof mapObj.forEach !== 'function') return false;
    let changed = false;
    const additions = [];
    Array.from(mapObj.entries()).forEach(([id, qty]) => {
      const item = ITEMS[id];
      const count = Math.max(0, Math.floor(Number(qty || 0)));
      if (!item || count <= 0) { mapObj.delete(id); changed = true; return; }
      if (!isUniqueEquipmentItem(id)) return;
      if (isRuntimeItemId(id)) {
        if (count > 1) {
          mapObj.set(id, 1);
          for (let i = 1; i < count; i++) additions.push(createRuntimeItemInstance(id));
          changed = true;
        }
        return;
      }
      mapObj.delete(id);
      for (let i = 0; i < count; i++) additions.push(createRuntimeItemInstance(id));
      changed = true;
    });
    additions.filter(Boolean).forEach(id => mapObj.set(id, 1));
    return changed;
  }

  function normalizeEquipmentReferencesToUnique() {
    let changed = false;
    const claimedRuntimeIds = new Set(Object.values(equipment).filter(id => isRuntimeItemId(id)));
    Object.keys(equipment).forEach(slot => {
      const id = equipment[slot];
      if (!id) return;
      const item = ITEMS[id];
      if (!item) { equipment[slot] = null; changed = true; return; }
      if (isUniqueEquipmentItem(id) && !isRuntimeItemId(id)) {
        const runtimeId = findFirstItemInstanceInMap(inventory, id, itemEquipSlot(item) || slot, claimedRuntimeIds);
        if (runtimeId) {
          equipment[slot] = runtimeId;
          claimedRuntimeIds.add(runtimeId);
          changed = true;
        }
      }
    });
    return changed;
  }

  function normalizeUniqueEquipmentState() {
    const invChanged = normalizeUniqueItemMap(inventory);
    const storageChanged = normalizeUniqueItemMap(storageInventory);
    const equipChanged = normalizeEquipmentReferencesToUnique();
    return invChanged || storageChanged || equipChanged;
  }

  function addInventoryRaw(id, qty = 1) {
    inventory.set(id, (inventory.get(id) || 0) + qty);
  }

  function mapWeight(mapObj) {
    let total = 0;
    mapObj.forEach((qty, id) => { total += itemWeight(id) * qty; });
    return total;
  }

  function inventoryWeight() { return mapWeight(inventory); }
  function storageWeight() { return mapWeight(storageInventory); }

  function carryCapacity() {
    const stats = typeof effectiveSpecialStats === 'function' ? effectiveSpecialStats(characterProfile) : (characterProfile?.special || DEFAULT_SPECIAL);
    const d = derivedFromStats(stats, characterProfile?.traits || []);
    const pack = ITEMS[equipment.backpack];
    const packBonus = pack && pack.carry ? pack.carry : 0;
    return d.carry + packBonus;
  }

  function canCarryItem(id, qty = 1) {
    return inventoryWeight() + itemWeight(id) * qty <= carryCapacity() + 0.0001;
  }


  function multiplayerCarrySnapshot() {
    const weight = inventoryWeight();
    const capacity = carryCapacity();
    return {
      weight: Math.round(weight * 1000) / 1000,
      capacity: Math.round(capacity * 1000) / 1000,
      free: Math.round(Math.max(0, capacity - weight) * 1000) / 1000
    };
  }

  function multiplayerInventorySnapshot(options = {}) {
    const includeEquipped = options.includeEquipped === true;
    const equippedIds = new Set(Object.values(equipment).filter(Boolean));
    const out = [];
    inventory.forEach((qty, id) => {
      const count = Math.max(0, Math.floor(Number(qty || 0)));
      if (!id || id === 'fists' || count <= 0) return;
      if (!includeEquipped && equippedIds.has(id)) return;
      const baseId = baseItemId(id);
      if (!ITEMS[baseId]) return;
      out.push({ id: baseId, qty: count });
    });
    return out.slice(0, 120);
  }

  function applyServerInventorySnapshot(rows = []) {
    if (!Array.isArray(rows)) return false;
    const next = new Map();
    Object.values(equipment || {}).forEach(id => {
      if (!id || id === 'fists' || !ITEMS[baseItemId(id)]) return;
      next.set(id, Math.max(1, Math.floor(Number(inventory.get(id) || 1))));
    });
    rows.slice(0, 160).forEach(row => {
      const id = baseItemId(row?.id || row?.itemId || '');
      const qty = Math.max(0, Math.floor(Number(row?.qty ?? row?.count ?? 0)));
      if (!id || id === 'fists' || !ITEMS[id] || qty <= 0) return;
      let remaining = qty;
      if (isUniqueEquipmentItem(id)) {
        for (const [runtimeId, runtimeQty] of inventory.entries()) {
          if (remaining <= 0) break;
          if (runtimeQty <= 0 || !isRuntimeItemId(runtimeId) || baseItemId(runtimeId) !== id || next.has(runtimeId)) continue;
          next.set(runtimeId, 1);
          remaining -= 1;
        }
      }
      if (remaining > 0) next.set(id, Math.max(0, Math.floor(Number(next.get(id) || 0))) + remaining);
    });
    inventory.clear();
    next.forEach((qty, id) => inventory.set(id, qty));
    clearEquipmentReferencesToMissing();
    refreshInventoryDependentUI();
    if (typeof renderInventory === 'function') renderInventory();
    if (typeof renderCraftingWindow === 'function') renderCraftingWindow();
    queueSave(true);
    return true;
  }

  // ===== СИЛА: тиры экипировки (зеркало серверных таблиц) =====
  const GEAR_ITEM_TIERS = Object.freeze({
  fists: 1, knife: 1, pickaxe: 1, axe: 1, handPump: 1, pistol: 1,
  rifle: 2, revolver: 2, sawedOffShotgun: 2,
  shotgun: 3, assaultRifle: 3, machineGun: 3, smg: 3,
  laserPistol: 4, flamethrower: 4,
  plasmaRifle: 5, rocketLauncher: 5,
  leather: 1, hazmatSuit: 1,
  metalArmor: 2, energySuit: 2,
  ballisticVest: 3,
  combatArmor: 4,
  heavyArmor: 5,
  weldedHelmet: 1, helmet: 2, tacticalHelmet: 3, assaultHelmet: 4, preWarHelmet: 5,
  boots: 1, scoutBoots: 2, reinforcedBoots: 3, assaultBoots: 4,
  backpack: 2
});
  const GEAR_TIER_POINTS = Object.freeze({ 1: 10, 2: 18, 3: 30, 4: 45, 5: 65 });
  const GEAR_SLOT_WEIGHTS = Object.freeze({ weapon: 1.0, offhand: 0.5, armor: 0.8, helmet: 0.4, boots: 0.3, backpack: 0.2 });
  const GEAR_MOD_POINTS = 4;
  const GEAR_TIER_INFO = Object.freeze({
    1: { short: 'Т1', label: 'Самодельное', color: '#8a939b' },
    2: { short: 'Т2', label: 'Рабочее', color: '#d8d2c0' },
    3: { short: 'Т3', label: 'Боевое', color: '#efd078' },
    4: { short: 'Т4', label: 'Армейское', color: '#9fd7ff' },
    5: { short: 'Т5', label: 'Довоенное', color: '#ff9a54' }
  });

  function gearTierOf(itemId) {
    return Number(GEAR_ITEM_TIERS[baseItemId(itemId)] || 0);
  }

  function gearTierInfo(itemId) {
    return GEAR_TIER_INFO[gearTierOf(itemId)] || null;
  }

  function gearPowerBreakdown() {
    const rows = [];
    let total = 0;
    for (const [slot, weight] of Object.entries(GEAR_SLOT_WEIGHTS)) {
      const equippedId = equipment?.[slot];
      if (!equippedId) continue;
      const tier = gearTierOf(equippedId);
      if (!tier) continue;
      const item = ITEMS[equippedId] || {};
      const condition = Math.max(1, Math.min(100, Number(item.condition ?? 100)));
      let points = GEAR_TIER_POINTS[tier] * weight * condition / 100;
      if ((slot === 'weapon' || slot === 'offhand') && typeof weaponModificationCount === 'function') {
        points += weaponModificationCount(item) * GEAR_MOD_POINTS;
      }
      points = Math.round(points);
      total += points;
      rows.push({ slot, id: equippedId, name: item.name || equippedId, tier, points });
    }
    return { total, rows };
  }

  function gearPowerTotal() {
    return gearPowerBreakdown().total;
  }

  function applyServerItemConditions(conditions = {}) {
    if (!conditions || typeof conditions !== 'object') return false;
    Object.entries(conditions).forEach(([rawId, rawCondition]) => {
      const id = baseItemId(rawId);
      const condition = Math.max(1, Math.min(100, Number(rawCondition || 100)));
      Object.entries(ITEMS).forEach(([itemId, item]) => {
        if (!item || baseItemId(itemId) !== id) return;
        if (isUniqueEquipmentItem(itemId) || typeof item.condition === 'number') item.condition = condition;
      });
    });
    renderQuickbar();
    renderWeaponReadout();
    return true;
  }

  function applyPvpFullDropInventory(droppedItems = []) {
    const equippedIds = new Set(Object.values(equipment).filter(Boolean));
    let changed = false;
    Array.from(inventory.keys()).forEach(id => {
      if (id === 'fists' || equippedIds.has(id)) return;
      inventory.delete(id);
      changed = true;
    });
    if (!changed) return false;
    clearEquipmentReferencesToMissing();
    refreshInventoryDependentUI();
    const count = Array.isArray(droppedItems) ? droppedItems.reduce((sum, item) => sum + Math.max(0, Number(item?.qty || 0)), 0) : 0;
    addLog(`☠ PvP: рюкзак выпал на землю${count > 0 ? ` (${count} шт.)` : ''}.`, null, 'loot');
    queueSave(true);
    return true;
  }

  function applyPvpConsumableDropInventory(droppedItems = []) {
    // Средний режим PvP: сервер уронил половину стопок расходников —
    // вычитаем те же количества локально, экипировка не тронута.
    let changed = false;
    let count = 0;
    (Array.isArray(droppedItems) ? droppedItems : []).forEach(item => {
      const id = String(item?.itemId || item?.id || '');
      const qty = Math.max(0, Math.floor(Number(item?.qty || 0)));
      if (!id || qty <= 0 || !inventory.has(id)) return;
      const left = Math.max(0, (inventory.get(id) || 0) - qty);
      if (left > 0) inventory.set(id, left);
      else inventory.delete(id);
      count += qty;
      changed = true;
    });
    if (!changed) return false;
    refreshInventoryDependentUI();
    addLog(`☠ PvP: часть расходников выпала на месте смерти (${count} шт.).`, null, 'loot');
    queueSave(true);
    return true;
  }

  function maxCarryableQty(id) {
    const w = itemWeight(id);
    if (w <= 0) return Number.MAX_SAFE_INTEGER;
    return Math.max(0, Math.floor((carryCapacity() - inventoryWeight()) / w));
  }

  function updateCarryReadouts() {
    const cur = inventoryWeight();
    const max = carryCapacity();
    const text = `Вес: <b>${formatWeight(cur)}</b> / <b>${formatWeight(max)}</b>`;
    const carryLine = document.getElementById('carry-line');
    if (carryLine) {
      const html = text + (cur > max ? ' · перегруз' : '');
      if (carryLine.dataset.carryHtml !== html) {
        carryLine.innerHTML = html;
        carryLine.dataset.carryHtml = html;
      }
      carryLine.classList.toggle('overweight', cur > max);
    }
    const storageCarry = document.getElementById('storage-carry-info');
    if (storageCarry) {
      const html = text.replace('Вес:', '');
      if (storageCarry.dataset.carryHtml !== html) {
        storageCarry.innerHTML = html;
        storageCarry.dataset.carryHtml = html;
      }
    }
    const storageInfo = document.getElementById('storage-weight-info');
    if (storageInfo) {
      const textValue = `${formatWeight(storageWeight())} кг`;
      if (storageInfo.textContent !== textValue) storageInfo.textContent = textValue;
    }
  }
