const fs = require("fs");
// Генерирует unity-client/Assets/Scripts/Game/RoaItemInfo.cs из ITEMS web-клиента
// (описания и строки характеристик itemStatLine). Запуск: node tools/build-unity-item-info.js
const path = require("path");
const root = path.join(__dirname, "..");
const src = fs.readFileSync(root + "/public/js/game/03_items_inventory_core.js", "utf8");
const m = src.match(/const ITEMS = \{([\s\S]*?)\n  \};/);
const ITEMS = eval("({" + m[1] + "})");
const SK = { lightWeapons: 'Лёгкое оружие', heavyWeapons: 'Тяжёлое оружие', energyWeapons: 'Энергетическое', throwing: 'Метательное', melee: 'Ближний бой', unarmed: 'Без оружия' };
const DT = { ballistic: 'баллистический', explosive: 'взрывной', energy: 'энергетический', fire: 'огненный', radiation: 'радиационный', toxic: 'токсичный' };
const fw = w => { const v = Math.round(w * 10) / 10; return v.toFixed(1).replace('.', ',') + ' кг'; };
function stat(i) {
  if (i.type === 'weapon' || (i.type === 'tool' && Array.isArray(i.dmg))) {
    const grip = ` · ${i.hands === 2 ? 'двуручное' : 'одноручное'}`;
    const ammo = i.ammoType ? '' : ' · без патронов';
    const modes = i.ammoType ? (i.automatic ? ' · режимы: одиночный/прицельный/авто' : ' · режимы: одиночный/прицельный') : '';
    const req = i.requiredStrength ? ` · треб. Сила ${i.requiredStrength}` : '';
    const skill = i.weaponSkill ? ` · навык: ${SK[i.weaponSkill] || i.weaponSkill}` : '';
    const hl = { ore: 'руда', wood: 'древесина', liquid: 'вода/нефть' };
    const harvest = i.harvestTool ? ` · добыча: ${hl[i.harvestTool] || i.harvestTool}` : '';
    return `Урон ${i.dmg[0]}-${i.dmg[1]} · тип ${DT[i.damageType || 'ballistic']}${grip} · дальность ${i.range}${ammo}${modes}${req}${skill}${harvest} · Вес ${fw(i.weight)}`;
  }
  if (i.armor || i.protection || i.thresholds) {
    const rows = []; const p = i.protection || {}, t = i.thresholds || {};
    for (const ty of ['ballistic', 'explosive', 'energy', 'fire', 'radiation', 'toxic']) {
      const pct = Math.round((p[ty] || 0) * 100), th = t[ty] || 0;
      if (pct > 0 || th > 0) rows.push(`${DT[ty]} ${pct}%${th ? ` / порог ${th}` : ''}`);
    }
    return `${rows.length ? `Защита: ${rows.join(' · ')} · без слабостей` : 'Почти не защищает'} · Вес ${fw(i.weight)}`;
  }
  if (i.speed) return `Скорость +${i.speed} · Вес ${fw(i.weight)}`;
  if (i.heal) return `Первая помощь +${i.heal} HP · Вес ${fw(i.weight)}`;
  if (i.doctor) return `Доктор · Вес ${fw(i.weight)}`;
  if (i.cureInfection) return `Лекарство от инфекции · Вес ${fw(i.weight)}`;
  if (i.repair) return `Ремонт +${i.repair}% · Вес ${fw(i.weight)}`;
  return `Вес ${fw(i.weight)}`;
}
const TL = { weapon: 'Оружие', armor: 'Броня', consumable: 'Расходник', ammo: 'Патроны', tool: 'Инструмент', material: 'Материал', money: 'Валюта', loot: 'Трофей', misc: 'Разное' };
const esc = s => String(s || '').split('\\').join('\\\\').split('"').join('\\"');
let out = `using System.Collections.Generic;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Описания и строки характеристик предметов — desc/itemStatLine web
    /// (03_items_inventory_core.js ITEMS, 03b:501). Сгенерировано из каталога web;
    /// динамические части (магазин, состояние, ОД лечения) добавляет вызывающий.
    /// </summary>
    public static class RoaItemInfo
    {
        public sealed class Row
        {
            public readonly string Type, Desc, Stat;
            public readonly int Hands;
            public readonly bool HasAmmo, Usable;
            public Row(string type, string desc, string stat, int hands, bool hasAmmo, bool usable) { Type = type; Desc = desc; Stat = stat; Hands = hands; HasAmmo = hasAmmo; Usable = usable; }
        }

        private static readonly Dictionary<string, Row> Rows = new Dictionary<string, Row>
        {
`;
const lines = [];
for (const i of Object.values(ITEMS)) lines.push(`            { "${i.id}", new Row("${TL[i.type] || i.type || ''}", "${esc(i.desc)}", "${esc(stat(i))}", ${i.hands === 2 ? 2 : 1}, ${i.ammoType ? 'true' : 'false'}, ${(i.type === 'consumable' || i.type === 'ammo') ? 'true' : 'false'}) }`);
out += lines.join(',\n') + '\n';
out += `        };

        public static Row Get(string itemOrRuntimeId)
        {
            string id = RoaArmorData.BaseId(itemOrRuntimeId ?? string.Empty);
            return Rows.TryGetValue(id, out Row row) ? row : null;
        }

        public static string Desc(string id) { Row row = Get(id); return row != null ? row.Desc : string.Empty; }
        public static string Stat(string id) { Row row = Get(id); return row != null ? row.Stat : string.Empty; }
        public static string TypeLabel(string id) { Row row = Get(id); return row != null ? row.Type : string.Empty; }
    }
}
`;
fs.writeFileSync(root + "/unity-client/Assets/Scripts/Game/RoaItemInfo.cs", out.replace(/\r?\n/g, "\n"));
console.log("items:", lines.length);
