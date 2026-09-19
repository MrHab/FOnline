'use strict';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function clean(value = '', max = 80) {
  return String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, max);
}

function positiveRows(input = {}) {
  return Object.fromEntries(Object.entries(input && typeof input === 'object' ? input : {})
    .map(([id, qty]) => [clean(id, 48), Math.max(0, Math.floor(Number(qty || 0)))])
    .filter(([id, qty]) => id && qty > 0));
}

function clanBaseProfile(catalog = {}, baseId = '') {
  const id = clean(baseId, 48);
  return (Array.isArray(catalog.bases) ? catalog.bases : []).find(row => clean(row?.id, 48) === id) || null;
}

function ownedClanBaseContext(store = {}, catalog = {}, clanId = '', requiredLocationId = '') {
  const id = clean(clanId, 80);
  const clan = store?.clans?.[id] || null;
  if (!clan?.baseId) return null;
  const runtime = store?.bases?.[clean(clan.baseId, 48)] || null;
  const profile = clanBaseProfile(catalog, clan.baseId);
  if (!runtime || !profile || clean(runtime.ownerClanId, 80) !== id) return null;
  if (requiredLocationId && clean(profile.locationId, 80) !== clean(requiredLocationId, 80)) return null;
  return { clan, runtime, profile, benefit: { ...(profile.benefit || {}) } };
}

function weeklyGrantForProfile(profile = {}) {
  const grant = positiveRows(profile?.benefit?.weeklyGrant || {});
  const sine = Math.max(0, Math.floor(Number(profile?.benefit?.weeklySine || 0)));
  if (sine > 0) grant.blue = Math.max(Number(grant.blue || 0), sine);
  return grant;
}

function claimWeeklyBaseGrant(store = {}, catalog = {}, clanId = '', now = Date.now()) {
  const context = ownedClanBaseContext(store, catalog, clanId);
  if (!context) return { ok: false, error: 'Клан не владеет стратегической базой.' };
  const { clan, runtime, profile } = context;
  const lastAt = Math.max(0, Number(runtime.lastWeeklyBenefitAt || 0));
  const readyAt = lastAt > 0 ? lastAt + WEEK_MS : 0;
  if (readyAt > Number(now)) return { ok: true, duplicate: true, readyAt, grant: {} };
  const grant = weeklyGrantForProfile(profile);
  if (!Object.keys(grant).length) return { ok: true, duplicate: true, readyAt: 0, grant: {} };
  clan.storage = clan.storage && typeof clan.storage === 'object' ? clan.storage : {};
  for (const [itemId, qty] of Object.entries(grant)) {
    clan.storage[itemId] = Math.max(0, Math.floor(Number(clan.storage[itemId] || 0))) + qty;
  }
  runtime.lastWeeklyBenefitAt = Number(now);
  runtime.history = Array.isArray(runtime.history) ? runtime.history : [];
  runtime.history.push({
    type: 'weekly_benefit',
    clanId: clan.id,
    grant: { ...grant },
    at: Number(now)
  });
  return { ok: true, duplicate: false, readyAt: Number(now) + WEEK_MS, grant };
}

function fractionalUnits(baseQty = 0, pct = 0, previousCredit = 0) {
  const quantity = Math.max(0, Math.floor(Number(baseQty || 0)));
  const rate = Math.max(0, Number(pct || 0));
  const exact = Math.max(0, Number(previousCredit || 0)) + quantity * rate;
  const units = Math.max(0, Math.floor(exact + 1e-9));
  return { units, credit: Number((exact - units).toFixed(6)) };
}

function previewClanCraftBenefit(profile = {}, runtime = {}, recipeId = '', requirements = {}, output = {}) {
  const benefit = profile?.benefit && typeof profile.benefit === 'object' ? profile.benefit : {};
  const recipe = clean(recipeId, 64);
  const nextRequirements = positiveRows(requirements);
  const nextOutput = {
    id: clean(output?.id, 48),
    qty: Math.max(0, Math.floor(Number(output?.qty || 0)))
  };
  const credits = { ...(runtime?.benefitCredits && typeof runtime.benefitCredits === 'object' ? runtime.benefitCredits : {}) };
  const applied = { saved: {}, bonus: {} };

  const discount = (resourceId, rawPct, allowedRecipes = null) => {
    if (allowedRecipes && !allowedRecipes.has(recipe)) return;
    const baseQty = Math.max(0, Number(nextRequirements[resourceId] || 0));
    const pct = Math.max(0, -Number(rawPct || 0));
    if (baseQty <= 0 || pct <= 0) return;
    const key = `cost:${resourceId}`;
    const result = fractionalUnits(baseQty, pct, credits[key]);
    const saved = Math.min(baseQty, result.units);
    credits[key] = result.credit;
    if (saved > 0) {
      nextRequirements[resourceId] = baseQty - saved;
      if (nextRequirements[resourceId] <= 0) delete nextRequirements[resourceId];
      applied.saved[resourceId] = saved;
    }
  };

  discount('oil', benefit.clanStationFuelCostPct);
  discount('chemicals', benefit.filterCostPct, new Set(['reagentcraft', 'medicinecraft', 'hazmatsuitcraft']));
  discount('water', benefit.productionWaterCostPct);

  const outputBonus = (rawPct, allowedOutputs) => {
    const pct = Math.max(0, Number(rawPct || 0));
    if (!allowedOutputs.has(nextOutput.id) || nextOutput.qty <= 0 || pct <= 0) return;
    const key = `output:${nextOutput.id}`;
    const result = fractionalUnits(nextOutput.qty, pct, credits[key]);
    credits[key] = result.credit;
    if (result.units > 0) {
      nextOutput.qty += result.units;
      applied.bonus[nextOutput.id] = Math.max(0, Number(applied.bonus[nextOutput.id] || 0)) + result.units;
    }
  };

  outputBonus(benefit.processedOreOutputPct, new Set(['weaponParts']));
  outputBonus(benefit.reagentOutputPct, new Set(['chemicals']));
  outputBonus(benefit.medicalRawOutputPct, new Set(['medicine']));

  return {
    requirements: nextRequirements,
    output: nextOutput,
    credits,
    applied,
    active: Object.keys(applied.saved).length > 0 || Object.keys(applied.bonus).length > 0
      || JSON.stringify(credits) !== JSON.stringify(runtime?.benefitCredits || {})
  };
}

function commitClanCraftBenefit(runtime = {}, preview = {}) {
  runtime.benefitCredits = preview?.credits && typeof preview.credits === 'object' ? { ...preview.credits } : {};
  return runtime.benefitCredits;
}

/** Доля цены переноса между столицами, которую платит член клана‑владельца (0,85 — скидка 15%). */
function clanFastTravelFeeMultiplier(profile = {}) {
  return 1 - Math.max(0, Math.min(0.5, Number(profile?.benefit?.clanFastTravelDiscountPct || 0)));
}

function benefitOrdersForProfile(profile = {}, runtime = {}, now = Date.now()) {
  const cooldowns = runtime?.benefitOrderCooldowns && typeof runtime.benefitOrderCooldowns === 'object'
    ? runtime.benefitOrderCooldowns : {};
  return (Array.isArray(profile?.benefitOrders) ? profile.benefitOrders : []).map(order => {
    const id = clean(order?.id, 64);
    const readyAt = Math.max(0, Number(cooldowns[id] || 0));
    return {
      id,
      displayName: String(order?.displayName || id).slice(0, 80),
      description: String(order?.description || '').slice(0, 180),
      cost: positiveRows(order?.cost || {}),
      reward: positiveRows(order?.reward || {}),
      cooldownMs: Math.max(60 * 60 * 1000, Number(order?.cooldownMs || 24 * 60 * 60 * 1000)),
      readyAt,
      ready: readyAt <= Number(now)
    };
  }).filter(order => order.id);
}

function markBenefitOrderCompleted(runtime = {}, order = {}, now = Date.now()) {
  const id = clean(order?.id, 64);
  if (!id) return 0;
  runtime.benefitOrderCooldowns = runtime.benefitOrderCooldowns && typeof runtime.benefitOrderCooldowns === 'object'
    ? runtime.benefitOrderCooldowns : {};
  const readyAt = Number(now) + Math.max(60 * 60 * 1000, Number(order?.cooldownMs || 24 * 60 * 60 * 1000));
  runtime.benefitOrderCooldowns[id] = readyAt;
  return readyAt;
}

module.exports = {
  WEEK_MS,
  benefitOrdersForProfile,
  claimWeeklyBaseGrant,
  clanBaseProfile,
  clanFastTravelFeeMultiplier,
  commitClanCraftBenefit,
  markBenefitOrderCompleted,
  ownedClanBaseContext,
  positiveRows,
  previewClanCraftBenefit,
  weeklyGrantForProfile
};
