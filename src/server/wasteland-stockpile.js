'use strict';

const RESOURCE_LABELS = {
  water: 'вода',
  ore: 'руда',
  scrap: 'лом',
  oil: 'нефть',
  chemicals: 'химикаты',
  medicine: 'медикаменты',
  electronics: 'электроника',
  ammoParts: 'детали патронов',
  food: 'еда',
  ammo9: 'патроны 9мм',
  ammo556: 'патроны .223',
  energyCell: 'энергоячейки',
  napalm: 'напалм',
  weaponParts: 'оружейные детали'
};

function emptyStockpile() {
  return {
    silver: 0,
    water: 0,
    ore: 0,
    scrap: 0,
    oil: 0,
    chemicals: 0,
    medicine: 0,
    electronics: 0,
    ammoParts: 0,
    napalm: 0,
    food: 0
  };
}

function addStockpile(target = {}, source = {}, mul = 1) {
  const multiplier = Number.isFinite(Number(mul)) ? Number(mul) : 1;
  for (const [key, value] of Object.entries(source || {})) {
    const amount = Math.max(0, Number(value || 0) * multiplier);
    if (amount <= 0) continue;
    target[key] = Math.max(0, Number(target[key] || 0) + amount);
  }
  return target;
}

function takeStockpile(target = {}, source = {}) {
  const out = {};
  for (const [key, value] of Object.entries(source || {})) {
    const amount = Math.max(0, Math.floor(Number(value || 0)));
    if (amount <= 0) continue;
    const have = Math.max(0, Math.floor(Number(target[key] || 0)));
    const take = Math.min(have, amount);
    if (take > 0) {
      target[key] = have - take;
      out[key] = take;
    }
  }
  return out;
}

function stockpileTotal(stockpile = {}) {
  return Object.values(stockpile || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

function stockpileSummary(stockpile = {}, limit = 4) {
  const rows = Object.entries(stockpile || {})
    .map(([id, value]) => [id, Math.floor(Number(value || 0))])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  if (!rows.length) return 'нет груза';
  return rows.map(([id, value]) => `${value} ${RESOURCE_LABELS[id] || id}`).join(', ');
}

function compactStockpile(stockpile = {}) {
  const out = {};
  for (const [id, value] of Object.entries(stockpile || {})) {
    const amount = Math.floor(Number(value || 0));
    if (amount > 0) out[id] = amount;
  }
  return out;
}

module.exports = {
  addStockpile,
  compactStockpile,
  emptyStockpile,
  stockpileSummary,
  stockpileTotal,
  takeStockpile
};
